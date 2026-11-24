import type { Agent, ServerStatus } from '../../features/servers/domain.js';
import type {
  CreateServer,
  HostedServer,
  NetworkPolicy,
  ProjectServerHost,
  ServerBackup,
} from '../../features/servers/ports.js';
import { fetchJson, ProviderError, type Fetch } from '../../platform/http.js';

const ID = 'agent37';
const API = 'https://api.agent37.com/v1';

/** The agent a project works with, as an Agent37 template (checked 2026-11-12). */
const TEMPLATES: Record<Agent, string> = {
  'claude-code': 'agent37-claude-code',
  codex: 'agent37-codex',
  opencode: 'agent37-opencode',
  none: 'agent37-base',
};

/** The smallest shape: 2 vCPU, 4 GB, 4 GB of disk — $4.76 a month awake (billing page, 2026-11-12). */
const RESOURCES = { cpu: 2, memory: 4, disk: 4 };
const MONTHLY_MICROS = Math.round((2 * 0.8 + 4 * 0.7 + 4 * 0.09) * 1_000_000);

interface InstanceAnswer {
  id: string;
  status: string;
  url: string | null;
  resources?: { cpu: number; memory: number; disk: number };
}

export function serverStatus(status: string): ServerStatus {
  switch (status) {
    case 'provisioning':
      return 'provisioning';
    case 'running':
    case 'starting':
    case 'restarting':
    case 'updating':
      return 'running';
    case 'waking':
      return 'waking';
    case 'sleeping':
      return 'sleeping';
    case 'stopping':
    case 'stopped':
      return 'stopped';
    default:
      return 'failed';
  }
}

/** Agent37's own words for a network policy (docs: instance-network, 2026-11-14). */
export function networkBody(policy: NetworkPolicy): unknown {
  if (policy === 'open') return 'allow-all';
  if (policy === 'closed') return 'deny-all';
  return { allow: [...new Set(policy.allow.map((d) => d.toLowerCase()))].slice(0, 100) };
}

interface BackupAnswer {
  id: string;
  kind: string;
  created: number;
  size_bytes: number;
}

const backup = (b: BackupAnswer): ServerBackup => ({
  id: b.id,
  kind: b.kind === 'manual' ? 'manual' : 'automatic',
  createdAt: new Date(b.created * 1000),
  sizeBytes: b.size_bytes,
});

function hosted(i: InstanceAnswer): HostedServer {
  const r = i.resources ?? RESOURCES;
  return {
    externalId: i.id,
    status: serverStatus(i.status),
    url: i.url,
    size: `${r.cpu} vCPU · ${r.memory} GB`,
    monthlyMicros: Math.round((r.cpu * 0.8 + r.memory * 0.7 + r.disk * 0.09) * 1_000_000),
  };
}

/** Agent37 sandboxes as project servers, on Pono's own workspace key (D-003). */
export function agent37Host(options: {
  apiKey: string;
  fetch: Fetch;
  region?: 'us' | 'eu';
  /**
   * Pono's own server template (D-034), for the projects that do not ask for another agent: pnpm,
   * Spec Kit, a Postgres client and a browser already there.
   */
  ponoTemplate?: string;
}): ProjectServerHost {
  const templateOf = (agent: Agent) =>
    options.ponoTemplate && (agent === 'claude-code' || agent === 'none')
      ? options.ponoTemplate
      : TEMPLATES[agent];
  const headers = { authorization: `Bearer ${options.apiKey}` };
  const call = <T>(path: string, method = 'GET', body?: unknown, timeoutMs?: number) =>
    fetchJson<T>(options.fetch, {
      provider: ID,
      url: `${API}${path}`,
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      ...(timeoutMs ? { timeoutMs } : {}),
    });

  return {
    id: ID,
    async create(input: CreateServer) {
      const answer = await call<InstanceAnswer>(
        '/instances',
        'POST',
        {
          template: templateOf(input.agent),
          resources: RESOURCES,
          region: options.region ?? 'us',
          name: input.name.slice(0, 64),
          metadata: input.metadata,
          env: input.env,
          budget: { monthly_cap_micros: input.budgetMicros },
          auto_sleep: true,
          idle_timeout_seconds: input.idleSeconds,
          // A larger template (Pono's, with its browser) can take a minute on a cold machine.
        },
        120_000,
      );
      return { ...hosted(answer), monthlyMicros: hosted(answer).monthlyMicros || MONTHLY_MICROS };
    },
    async get(externalId) {
      try {
        return hosted(await call<InstanceAnswer>(`/instances/${externalId}`));
      } catch (error) {
        if (error instanceof ProviderError && error.status === 404) return null;
        throw error;
      }
    },
    async sleep(externalId) {
      await call(`/instances/${externalId}/sleep`, 'POST');
    },
    async wake(externalId) {
      await call(`/instances/${externalId}/start`, 'POST');
    },
    async monthSpend(now) {
      // The workspace's usage since the first of the UTC month, by instance (GET /v1/usage).
      const from = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
      const usage = await call<{ instances?: { id: string; total_micros: number }[] }>(
        `/usage?from=${from}`,
      );
      return new Map((usage.instances ?? []).map((i) => [i.id, i.total_micros]));
    },
    publicHostSuffix: '.agent37.app',
    async run(externalId, command, runOptions) {
      const answer = await call<{ exit_code: number; stdout: string; stderr: string }>(
        `/instances/${externalId}/exec`,
        'POST',
        { command },
        runOptions?.timeoutMs,
      );
      return { exitCode: answer.exit_code, stdout: answer.stdout, stderr: answer.stderr };
    },
    async start(externalId, command) {
      return call<{ pid: number }>(`/instances/${externalId}/exec`, 'POST', {
        command,
        background: true,
        name: 'pono-dev',
      });
    },
    async health(externalId) {
      const answer = await call<{
        health?: {
          running?: boolean;
          restart_count?: number;
          oom_suspected?: boolean;
          resource_verdict?: string;
        };
      }>(`/instances/${externalId}/logs?tail=1`);
      const h = answer.health ?? {};
      return {
        running: h.running ?? null,
        restarts: h.restart_count ?? 0,
        outOfMemory: h.oom_suspected ?? false,
        verdict: h.resource_verdict ?? null,
      };
    },
    async publishPort(externalId, port, label, prefix) {
      const listed = await call<
        { port: number; url: string }[] | { public_ports?: { port: number; url: string }[] }
      >(`/instances/${externalId}/public-ports`);
      const ports = Array.isArray(listed) ? listed : (listed.public_ports ?? []);
      const known = ports.find((p) => p.port === port);
      if (known) return { url: known.url };
      const opened = await call<{ url: string }>(`/instances/${externalId}/public-ports`, 'POST', {
        port,
        label: label.slice(0, 40),
        ...(prefix ? { prefix } : {}),
      });
      return { url: opened.url };
    },
    async previewLink(externalId, port, ttlSeconds) {
      const answer = await call<{ url: string; expires_at: number }>(
        `/instances/${externalId}/signed-url`,
        'POST',
        { port, ttl_seconds: Math.min(Math.max(60, Math.round(ttlSeconds)), 7 * 24 * 3600) },
      );
      return { url: answer.url, expiresAt: new Date(answer.expires_at * 1000) };
    },
    async unpublishPort(externalId, port) {
      try {
        await call(`/instances/${externalId}/public-ports/${port}`, 'DELETE');
      } catch (error) {
        if (error instanceof ProviderError && error.status === 404) return;
        throw error;
      }
    },
    async setNetwork(externalId, policy) {
      const body = { network: networkBody(policy) };
      try {
        await call(`/instances/${externalId}`, 'PATCH', body);
      } catch (error) {
        // 503 try_again: saved, reaches the server within two minutes; asked once more to confirm.
        if (error instanceof ProviderError && error.status === 503)
          await call(`/instances/${externalId}`, 'PATCH', body);
        else throw error;
      }
    },
    networkNeeds: ['api.agent37.com'],
    backups: {
      async list(externalId) {
        const answer = await call<{ data: BackupAnswer[] }>(`/instances/${externalId}/backups`);
        return answer.data.map(backup);
      },
      async create(externalId) {
        return backup(
          await call<BackupAnswer>(
            `/instances/${externalId}/backups`,
            'POST',
            undefined,
            15 * 60_000,
          ),
        );
      },
      async restore(externalId, backupId) {
        await call(`/instances/${externalId}/restore`, 'POST', { backup: backupId }, 13 * 60_000);
      },
    },
    async destroy(externalId) {
      try {
        await call(`/instances/${externalId}`, 'DELETE');
      } catch (error) {
        if (error instanceof ProviderError && error.status === 404) return;
        throw error;
      }
    },
  };
}

/** The workspace wallet: balance and how many instances may be awake at once (GET /v1/billing). */
export function agent37Account(options: { apiKey: string; fetch: Fetch }) {
  return async (): Promise<{ balanceMicros: number; activeLimit: number }> => {
    const billing = await fetchJson<{ balance_usd: number; instance_limit: number }>(
      options.fetch,
      {
        provider: ID,
        url: `${API}/billing`,
        headers: { authorization: `Bearer ${options.apiKey}` },
      },
    );
    return {
      balanceMicros: Math.round(billing.balance_usd * 1_000_000),
      activeLimit: billing.instance_limit,
    };
  };
}

/** A top-up of the workspace wallet: the provider answers a payment page (POST /v1/billing/top-up). */
export function agent37TopUp(options: { apiKey: string; fetch: Fetch }) {
  return async (amountUsd: number): Promise<string> => {
    const answer = await fetchJson<{ url: string }>(options.fetch, {
      provider: ID,
      url: `${API}/billing/top-up`,
      method: 'POST',
      headers: { authorization: `Bearer ${options.apiKey}` },
      body: { amount_usd: amountUsd },
    });
    return answer.url;
  };
}
