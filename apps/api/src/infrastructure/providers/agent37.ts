import type { Agent, ServerStatus } from '../../features/servers/domain.js';
import type {
  CreateServer,
  HostedServer,
  ProjectServerHost,
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
}): ProjectServerHost {
  const headers = { authorization: `Bearer ${options.apiKey}` };
  const call = <T>(path: string, method = 'GET', body?: unknown) =>
    fetchJson<T>(options.fetch, {
      provider: ID,
      url: `${API}${path}`,
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    });

  return {
    id: ID,
    async create(input: CreateServer) {
      const answer = await call<InstanceAnswer>('/instances', 'POST', {
        template: TEMPLATES[input.agent],
        resources: RESOURCES,
        region: options.region ?? 'us',
        name: input.name.slice(0, 64),
        metadata: input.metadata,
        env: input.env,
        budget: { monthly_cap_micros: input.budgetMicros },
        auto_sleep: true,
        idle_timeout_seconds: input.idleSeconds,
      });
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
