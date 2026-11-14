import { z } from 'zod';
import type { Actor } from '../../platform/context.js';
import { withOrganization, type Client } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { ProviderError } from '../../platform/http.js';
import { record } from '../journal/index.js';
import type { NetworkPolicy, ProjectServerHost, ServerBackup } from './ports.js';
import type { Pool } from '../../platform/db.js';

/**
 * A project server's safety nets (D-031): where it may connect, and its restore points. The person
 * decides both from the console; an agent may take a backup, never restore one nor open the network.
 */
export interface SafetyDeps {
  pool: Pool;
  serverHost: ProjectServerHost;
  /** What every limited server reaches: the package registries (composed at start). */
  networkBase?: string[];
  /** What each connected service needs reachable, by provider id. */
  serviceDomains?: Record<string, readonly string[]>;
}

export type NetworkMode = 'open' | 'limited';

/** A domain (`example.com`, `*.example.com`) or an IPv4 address or range; nothing else. */
export const NETWORK_ENTRY =
  /^(?:(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}|(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?)$/;

export const networkInput = z.object({
  mode: z.enum(['open', 'limited']),
  extra: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .transform((d) => {
          const bare = d.replace(/^https?:\/\//, '');
          // An IPv4 range keeps its /24; a pasted link loses its path and port.
          return /^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(bare)
            ? bare
            : bare.replace(/[/:].*$/, '');
        })
        .pipe(z.string().regex(NETWORK_ENTRY)),
    )
    .max(60)
    .default([]),
});

/** The policy a mode gives: limited is the base, the connected services, then the person's own. */
export function networkPolicy(
  mode: NetworkMode,
  base: readonly string[],
  services: readonly string[],
  extra: readonly string[],
): NetworkPolicy {
  if (mode === 'open') return 'open';
  return { allow: [...new Set([...base, ...services, ...extra])].slice(0, 100) };
}

export interface NetworkView {
  mode: NetworkMode;
  /** Always reachable when limited: registries, the code host, the server's own tools. */
  base: string[];
  /** Reachable because the service is connected. */
  services: { provider: string; domains: string[] }[];
  extra: string[];
  /** false when the host cannot limit a server: the setting is kept, not enforced. */
  enforced: boolean;
}

async function networkRow(client: Client, projectId: string) {
  if (!z.uuid().safeParse(projectId).success)
    throw new AppError('project.not_found', 404, 'No such project.');
  const { rows } = await client.query<{
    network: NetworkMode;
    network_allow: string[];
    external_id: string | null;
  }>(
    `SELECT p.network, p.network_allow, s.external_id FROM projects p
     LEFT JOIN project_servers s ON s.project_id = p.id AND s.status <> 'released' WHERE p.id = $1`,
    [projectId],
  );
  if (!rows[0]) throw new AppError('project.not_found', 404, 'No such project.');
  const providers = (
    await client.query<{ provider: string }>(
      "SELECT DISTINCT provider FROM connections WHERE status = 'active' ORDER BY provider",
    )
  ).rows.map((r) => r.provider);
  return { ...rows[0], providers };
}

function viewOf(
  deps: SafetyDeps,
  row: { network: NetworkMode; network_allow: string[]; providers: string[] },
): NetworkView {
  return {
    mode: row.network,
    base: [...new Set([...(deps.networkBase ?? []), ...(deps.serverHost.networkNeeds ?? [])])],
    services: row.providers.flatMap((provider) => {
      const domains = deps.serviceDomains?.[provider];
      return domains?.length ? [{ provider, domains: [...domains] }] : [];
    }),
    extra: row.network_allow,
    enforced: Boolean(deps.serverHost.setNetwork),
  };
}

const policyOf = (v: NetworkView) =>
  networkPolicy(
    v.mode,
    v.base,
    v.services.flatMap((s) => s.domains),
    v.extra,
  );

export async function networkView(
  deps: SafetyDeps,
  actor: Actor,
  projectId: string,
): Promise<NetworkView> {
  return withOrganization(deps.pool, actor.organizationId, async (client) =>
    viewOf(deps, await networkRow(client, projectId)),
  );
}

/** Applies the project's network to its server, when it has one; a missing server is no error. */
export async function applyNetwork(
  deps: SafetyDeps,
  actor: Actor,
  projectId: string,
): Promise<NetworkView> {
  const { view, externalId } = await withOrganization(
    deps.pool,
    actor.organizationId,
    async (client) => {
      const row = await networkRow(client, projectId);
      return { view: viewOf(deps, row), externalId: row.external_id };
    },
  );
  if (externalId && deps.serverHost.setNetwork)
    await deps.serverHost.setNetwork(externalId, policyOf(view));
  return view;
}

/** The person's choice (console only): saved, journaled, applied within seconds, no restart. */
export async function setNetwork(
  deps: SafetyDeps,
  actor: Actor,
  projectId: string,
  input: z.infer<typeof networkInput>,
): Promise<NetworkView> {
  await withOrganization(deps.pool, actor.organizationId, async (client) => {
    await networkRow(client, projectId);
    await client.query('UPDATE projects SET network = $2, network_allow = $3 WHERE id = $1', [
      projectId,
      input.mode,
      [...new Set(input.extra)],
    ]);
    await record(client, {
      organizationId: actor.organizationId,
      projectId,
      action: 'server.network_set',
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: { mode: input.mode, extra: input.extra.length },
    });
  });
  return applyNetwork(deps, actor, projectId);
}

/** Words a blocked connection leaves in a command's output, under a limited network. */
export function blockedByNetwork(output: string): boolean {
  return /tlsv1 alert access denied|ERR_SSL_TLSV1_ALERT_ACCESS_DENIED/i.test(output);
}

// --- Restore points ---------------------------------------------------------------------------

export interface BackupView {
  id: string;
  kind: 'automatic' | 'manual';
  createdAt: string;
  sizeBytes: number;
}

const backupView = (b: ServerBackup): BackupView => ({
  id: b.id,
  kind: b.kind,
  createdAt: b.createdAt.toISOString(),
  sizeBytes: b.sizeBytes,
});

async function serverOf(deps: SafetyDeps, actor: Actor, serverId: string) {
  if (!z.uuid().safeParse(serverId).success)
    throw new AppError('server.not_found', 404, 'No such server.');
  const row = await withOrganization(
    deps.pool,
    actor.organizationId,
    async (client) =>
      (
        await client.query<{ project_id: string; external_id: string; status: string }>(
          "SELECT project_id, external_id, status FROM project_servers WHERE id = $1 AND status <> 'released'",
          [serverId],
        )
      ).rows[0],
  );
  if (!row) throw new AppError('server.not_found', 404, 'No such server.');
  if (!deps.serverHost.backups)
    throw new AppError('server.no_backups', 501, 'This server host keeps no restore points.');
  return { ...row, backups: deps.serverHost.backups };
}

async function journal(
  deps: SafetyDeps,
  actor: Actor,
  projectId: string,
  action: string,
  detail: Record<string, unknown> = {},
) {
  await withOrganization(deps.pool, actor.organizationId, (client) =>
    record(client, {
      organizationId: actor.organizationId,
      projectId,
      action,
      actorPerson: actor.personId,
      channel: actor.channel,
      detail,
    }),
  );
}

/** Restore points, newest first: up to seven nightly ones and the last one taken on demand. */
export async function listBackups(
  deps: SafetyDeps,
  actor: Actor,
  serverId: string,
): Promise<{ backups: BackupView[]; restoring: boolean }> {
  const s = await serverOf(deps, actor, serverId);
  const backups = await s.backups.list(s.external_id);
  return {
    backups: backups.sort((a, b) => +b.createdAt - +a.createdAt).map(backupView),
    restoring: restoring.has(serverId),
  };
}

/** A restore point now, without pausing the server; one every 15 minutes. */
export async function backupServer(
  deps: SafetyDeps,
  actor: Actor,
  serverId: string,
): Promise<BackupView> {
  const s = await serverOf(deps, actor, serverId);
  try {
    const b = await s.backups.create(s.external_id);
    await journal(deps, actor, s.project_id, 'server.backed_up', { backup: b.id });
    return backupView(b);
  } catch (error) {
    if (error instanceof ProviderError && error.status === 429)
      throw new AppError(
        'server.backup_too_soon',
        429,
        'One backup on demand every 15 minutes: the last one is kept.',
      );
    if (error instanceof ProviderError && error.status === 400)
      throw new AppError('server.cold', 409, 'Wake the server first, then back it up.');
    throw error;
  }
}

/** Restores in flight, by server: a second one waits for the first. */
const restoring = new Set<string>();

/**
 * Puts the server's files back as they were at a backup (console only, the person confirmed): the
 * server is recreated, the dev server stops, files written since are lost. It takes minutes, so it
 * runs on after the answer; the journal says when it ended, or why it failed.
 */
export async function restoreServer(
  deps: SafetyDeps,
  actor: Actor,
  serverId: string,
  backupId: string,
  wake: () => Promise<void>,
): Promise<{ restoring: true }> {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(backupId))
    throw new AppError('server.no_backup', 404, 'No such backup.');
  const s = await serverOf(deps, actor, serverId);
  if (restoring.has(serverId))
    throw new AppError('server.restoring', 409, 'A restore is already under way.');
  const known = await s.backups.list(s.external_id);
  if (!known.some((b) => b.id === backupId))
    throw new AppError('server.no_backup', 404, 'No such backup.');
  if (s.status === 'sleeping' || s.status === 'waking') await wake();
  restoring.add(serverId);
  await journal(deps, actor, s.project_id, 'server.restore_started', { backup: backupId });
  void (async () => {
    try {
      await s.backups.restore(s.external_id, backupId);
      await withOrganization(deps.pool, actor.organizationId, (client) =>
        client.query(
          'UPDATE project_servers SET dev_port = NULL, dev_command = NULL WHERE id = $1',
          [serverId],
        ),
      );
      await journal(deps, actor, s.project_id, 'server.restored', { backup: backupId });
    } catch (error) {
      await journal(deps, actor, s.project_id, 'server.restore_failed', {
        backup: backupId,
        reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
      }).catch(() => undefined);
    } finally {
      restoring.delete(serverId);
    }
  })();
  return { restoring: true };
}
