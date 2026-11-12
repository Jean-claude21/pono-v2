import { Hono } from 'hono';
import { z } from 'zod';
import type { Actor, AppEnv } from '../../platform/context.js';
import { withOrganization, type Client, type Pool } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { record } from '../journal/index.js';
import type { InternalUsage, Reading } from '../usage/index.js';
import {
  activeLimit,
  estimatedMonthToDate,
  isActive,
  type Agent,
  type Plan,
  type ServerStatus,
} from './domain.js';
import type { ProjectServerHost } from './ports.js';

export type { ProjectServerHost, HostedServer, CreateServer } from './ports.js';
export {
  PLANS,
  activeLimit,
  isActive,
  type Agent,
  type Plan,
  type ServerStatus,
} from './domain.js';

export interface ServersDeps {
  pool: Pool;
  serverHost: ProjectServerHost;
  /** A server's spending cap for the month (D-004). */
  serverBudgetMicros: number;
  serverIdleSeconds: number;
  now: () => Date;
}

export interface ServerView {
  id: string;
  projectId: string;
  projectName: string;
  agent: string;
  status: ServerStatus;
  size: string;
  url: string | null;
  monthlyMicros: number;
  createdAt: string;
  statusAt: string;
}

interface ServerRow {
  id: string;
  project_id: string;
  project_name: string;
  external_id: string;
  agent: string;
  status: ServerStatus;
  size: string;
  url: string | null;
  monthly_micros: string;
  created_at: Date;
  status_at: Date;
}

const SELECT = `SELECT s.id, s.project_id, p.name AS project_name, s.external_id, s.agent, s.status, s.size, s.url,
  s.monthly_micros, s.created_at, s.status_at FROM project_servers s JOIN projects p ON p.id = s.project_id`;

function view(r: ServerRow): ServerView {
  return {
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name,
    agent: r.agent,
    status: r.status,
    size: r.size,
    url: r.url,
    monthlyMicros: Number(r.monthly_micros),
    createdAt: r.created_at.toISOString(),
    statusAt: r.status_at.toISOString(),
  };
}

async function rows(
  client: Client,
  where = "s.status <> 'released'",
  params: unknown[] = [],
): Promise<ServerRow[]> {
  return (await client.query<ServerRow>(`${SELECT} WHERE ${where} ORDER BY s.created_at`, params))
    .rows;
}

export async function planOf(client: Client): Promise<Plan> {
  const { rows: r } = await client.query<{ plan: Plan }>('SELECT plan FROM organizations');
  return r[0]?.plan ?? 'free';
}

export async function serversView(client: Client) {
  const plan = await planOf(client);
  const servers = (await rows(client)).map(view);
  return {
    plan,
    limit: activeLimit(plan),
    active: servers.filter((s) => isActive(s.status)).length,
    servers,
  };
}

/** Refuses when the plan's active servers are all taken; names them so the person can choose (D-004). */
async function ensureRoom(client: Client): Promise<void> {
  const { plan, limit, active, servers } = await serversView(client);
  if (active < limit) return;
  throw new AppError('servers.limit_reached', 409, 'Every active server of the plan is taken.', {
    plan,
    limit,
    active: servers
      .filter((s) => isActive(s.status))
      .map((s) => ({ id: s.id, projectName: s.projectName })),
  });
}

async function one(client: Client, id: string): Promise<ServerRow> {
  if (!z.uuid().safeParse(id).success)
    throw new AppError('server.not_found', 404, 'No such server.');
  const r = (await rows(client, "s.id = $1 AND s.status <> 'released'", [id]))[0];
  if (!r) throw new AppError('server.not_found', 404, 'No such server.');
  return r;
}

async function setStatus(
  client: Client,
  id: string,
  status: ServerStatus,
  extra: { url?: string | null } = {},
): Promise<void> {
  await client.query(
    `UPDATE project_servers SET status = $2, status_at = now(), url = coalesce($3, url),
       released_at = CASE WHEN $2 = 'released' THEN now() ELSE released_at END WHERE id = $1`,
    [id, status, extra.url ?? null],
  );
}

/** Puts a server to sleep first when the person chose one to free a place. */
async function freePlace(
  deps: ServersDeps,
  actor: Actor,
  sleepServerId: string | undefined,
): Promise<void> {
  if (sleepServerId) await sleepServer(deps, actor, sleepServerId);
}

/** Gives a project its server (US: a sentence, and the project has its server). */
export async function allocateServer(
  deps: ServersDeps,
  actor: Actor,
  projectId: string,
  options: { agent: Agent; env?: Record<string, string>; sleepServerId?: string },
): Promise<ServerView> {
  await freePlace(deps, actor, options.sleepServerId);
  const project = await withOrganization(deps.pool, actor.organizationId, async (client) => {
    const { rows: p } = await client.query<{ id: string; name: string; repository: string }>(
      'SELECT id, name, repository FROM projects WHERE id = $1',
      [projectId],
    );
    if (!p[0]) throw new AppError('project.not_found', 404, 'No such project.');
    const existing = await client.query(
      "SELECT 1 FROM project_servers WHERE project_id = $1 AND status <> 'released'",
      [projectId],
    );
    if (existing.rowCount)
      throw new AppError('server.exists', 409, 'This project already has its server.');
    await ensureRoom(client);
    return p[0];
  });
  const hosted = await deps.serverHost.create({
    name: `pono-${project.name}`,
    agent: options.agent,
    env: { PONO_PROJECT: project.repository, ...(options.env ?? {}) },
    metadata: { organization: actor.organizationId, project: project.id },
    budgetMicros: deps.serverBudgetMicros,
    idleSeconds: deps.serverIdleSeconds,
  });
  return withOrganization(deps.pool, actor.organizationId, async (client) => {
    const { rows: inserted } = await client.query<{ id: string }>(
      `INSERT INTO project_servers (organization_id, project_id, provider, external_id, agent, status, size, url, monthly_micros, budget_micros, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        actor.organizationId,
        project.id,
        deps.serverHost.id,
        hosted.externalId,
        options.agent,
        hosted.status,
        hosted.size,
        hosted.url,
        hosted.monthlyMicros,
        deps.serverBudgetMicros,
        actor.personId,
      ],
    );
    await record(client, {
      organizationId: actor.organizationId,
      projectId: project.id,
      action: 'server.allocated',
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: { agent: options.agent, size: hosted.size },
    });
    return view((await rows(client, 's.id = $1', [inserted[0]!.id]))[0]!);
  });
}

export async function sleepServer(deps: ServersDeps, actor: Actor, id: string): Promise<void> {
  const server = await withOrganization(deps.pool, actor.organizationId, (client) =>
    one(client, id),
  );
  if (server.status !== 'sleeping' && server.status !== 'stopped')
    await deps.serverHost.sleep(server.external_id);
  await withOrganization(deps.pool, actor.organizationId, async (client) => {
    await setStatus(client, id, 'sleeping');
    await record(client, {
      organizationId: actor.organizationId,
      projectId: server.project_id,
      action: 'server.slept',
      actorPerson: actor.personId,
      channel: actor.channel,
    });
  });
}

export async function wakeServer(
  deps: ServersDeps,
  actor: Actor,
  id: string,
  sleepServerId?: string,
): Promise<void> {
  await freePlace(deps, actor, sleepServerId);
  const server = await withOrganization(deps.pool, actor.organizationId, async (client) => {
    const s = await one(client, id);
    if (!isActive(s.status)) await ensureRoom(client);
    return s;
  });
  await deps.serverHost.wake(server.external_id);
  await withOrganization(deps.pool, actor.organizationId, async (client) => {
    await setStatus(client, id, 'running');
    await record(client, {
      organizationId: actor.organizationId,
      projectId: server.project_id,
      action: 'server.woken',
      actorPerson: actor.personId,
      channel: actor.channel,
    });
  });
}

export async function releaseServer(deps: ServersDeps, actor: Actor, id: string): Promise<void> {
  const server = await withOrganization(deps.pool, actor.organizationId, (client) =>
    one(client, id),
  );
  await deps.serverHost.destroy(server.external_id);
  await withOrganization(deps.pool, actor.organizationId, async (client) => {
    await setStatus(client, id, 'released');
    await record(client, {
      organizationId: actor.organizationId,
      projectId: server.project_id,
      action: 'server.released',
      actorPerson: actor.personId,
      channel: actor.channel,
    });
  });
}

/** Reads every server's status at the host: auto-sleep happens there (FR). */
export async function syncServers(deps: ServersDeps, organizationId: string): Promise<void> {
  const servers = await withOrganization(deps.pool, organizationId, (client) => rows(client));
  for (const s of servers) {
    const hosted = await deps.serverHost.get(s.external_id).catch(() => undefined);
    if (hosted === undefined) continue;
    const status: ServerStatus = hosted === null ? 'released' : hosted.status;
    if (status !== s.status)
      await withOrganization(deps.pool, organizationId, (client) =>
        setStatus(client, s.id, status, { url: hosted?.url ?? null }),
      );
  }
}

/** What the servers cost this month, estimated (D-005): one reading per server not released. */
export function serversUsage(): InternalUsage {
  return async (client, now) => {
    const servers = await rows(client);
    return servers.map((s): Reading => ({
      provider: 'pono',
      meter: 'servers.compute',
      subject: s.project_name,
      used: Math.round(estimatedMonthToDate(Number(s.monthly_micros), now) / 10_000) / 100,
      quota: Number(s.monthly_micros) / 1_000_000,
      unit: 'USD',
      costMicros: estimatedMonthToDate(Number(s.monthly_micros), now),
      source: 'estimated',
      reason: null,
      periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    }));
  };
}

const agentSchema = z.enum(['claude-code', 'codex', 'opencode', 'none']);

/** `/v1/servers` and `/v1/projects/:id/server`. */
export function serverRoutes(deps: ServersDeps): Hono<AppEnv> {
  const optionalId = z.object({ sleepServerId: z.uuid().optional() });
  return new Hono<AppEnv>()
    .get('/servers', async (c) => {
      await syncServers(deps, c.var.actor.organizationId);
      return c.json(await withOrganization(deps.pool, c.var.actor.organizationId, serversView));
    })
    .post('/projects/:id/server', async (c) => {
      const body = optionalId
        .extend({ agent: agentSchema.default('claude-code') })
        .safeParse((await c.req.json().catch(() => ({}))) ?? {});
      if (!body.success) throw new AppError('request.invalid', 400, 'Expected an agent.');
      const id = c.req.param('id');
      if (!z.uuid().safeParse(id).success)
        throw new AppError('project.not_found', 404, 'No such project.');
      const server = await allocateServer(deps, c.var.actor, id, {
        agent: body.data.agent,
        ...(body.data.sleepServerId ? { sleepServerId: body.data.sleepServerId } : {}),
      });
      return c.json({ server }, 201);
    })
    .post('/servers/:id/sleep', async (c) => {
      await sleepServer(deps, c.var.actor, c.req.param('id'));
      return c.body(null, 204);
    })
    .post('/servers/:id/wake', async (c) => {
      const body = optionalId.safeParse((await c.req.json().catch(() => ({}))) ?? {});
      await wakeServer(
        deps,
        c.var.actor,
        c.req.param('id'),
        body.success ? body.data.sleepServerId : undefined,
      );
      return c.body(null, 204);
    })
    .delete('/servers/:id', async (c) => {
      await releaseServer(deps, c.var.actor, c.req.param('id'));
      return c.body(null, 204);
    });
}
