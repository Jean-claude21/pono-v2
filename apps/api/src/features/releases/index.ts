import { Hono } from 'hono';
import { z } from 'zod';
import type { Actor, AppEnv } from '../../platform/context.js';
import { withOrganization, type Client } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { activeCredentials } from '../connections/index.js';
import { record } from '../journal/index.js';
import type { ProjectsDeps } from '../projects/application.js';
import type { CodeHost, Hosting } from '../projects/ports.js';
import {
  declaredDestructions,
  migrationsGuard,
  nextStep,
  previewGuard,
  secretsGuard,
  verdict,
  waitedForPreview,
  type GuardResult,
  type ReleaseMode,
} from './guards.js';

export * from './guards.js';

interface ProjectRow {
  id: string;
  repository: string;
  default_branch: string;
  hosting_provider: string | null;
  hosting_ref: string | null;
  release_mode: ReleaseMode;
  release_mode_until: Date | null;
}

export interface ReleaseView {
  id: string;
  number: number;
  title: string;
  headSha: string;
  branch: string;
  url: string | null;
  mode: string;
  verdict: string;
  guards: GuardResult[];
  status: string;
  createdAt: string;
  decidedAt: string | null;
}

interface ReleaseRow {
  id: string;
  project_id: string;
  number: number;
  title: string;
  head_sha: string;
  branch: string;
  url: string | null;
  mode: string;
  verdict: string;
  guards: GuardResult[];
  status: string;
  created_at: Date;
  decided_at: Date | null;
}

function view(r: ReleaseRow): ReleaseView {
  return {
    id: r.id,
    number: r.number,
    title: r.title,
    headSha: r.head_sha,
    branch: r.branch,
    url: r.url,
    mode: r.mode,
    verdict: r.verdict,
    guards: r.guards,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    decidedAt: r.decided_at?.toISOString() ?? null,
  };
}

/** The mode in force: a `bypass` past its end is `ask` again (D-006). */
export function modeInForce(
  row: Pick<ProjectRow, 'release_mode' | 'release_mode_until'>,
  now: Date,
): ReleaseMode {
  if (row.release_mode === 'bypass' && (!row.release_mode_until || row.release_mode_until <= now))
    return 'ask';
  return row.release_mode;
}

/** A person, in the console: agents never validate, never change the mode, never roll back (principle 5). */
function personOnly(actor: Actor): void {
  if (actor.channel !== 'console')
    throw new AppError('release.person_only', 403, 'Only a person, in the console, decides this.');
}

async function project(client: Client, id: string): Promise<ProjectRow> {
  if (!z.uuid().safeParse(id).success)
    throw new AppError('project.not_found', 404, 'No such project.');
  const { rows } = await client.query<ProjectRow>(
    'SELECT id, repository, default_branch, hosting_provider, hosting_ref, release_mode, release_mode_until FROM projects WHERE id = $1',
    [id],
  );
  if (!rows[0]) throw new AppError('project.not_found', 404, 'No such project.');
  return rows[0];
}

async function tools(
  deps: ProjectsDeps,
  actor: Actor,
  p: ProjectRow,
): Promise<{ host: CodeHost; code: string; hosting: Hosting | null; hostingCred: string | null }> {
  const creds = await withOrganization(deps.pool, actor.organizationId, (client) =>
    activeCredentials(client, deps.sealer),
  );
  const host = deps.adapters.codeHosts.find((h) => creds.some((c) => c.provider === h.id));
  const code = creds.find((c) => c.provider === host?.id)?.credential;
  if (!host || !code)
    throw new AppError('connection.code_host_missing', 409, 'Connect your code host first.');
  const hosting = deps.adapters.hostings.find((h) => h.id === p.hosting_provider) ?? null;
  const hostingCred = creds.find((c) => c.provider === hosting?.id)?.credential ?? null;
  return { host, code, hosting, hostingCred };
}

/**
 * Opens the proposal `dev` → the production branch, or finds the one open (D-039): an agent in a
 * chat pushes to `dev` through Pono and has no other way to propose it. Null when `dev` holds
 * nothing production lacks. Pono only proposes; what ships stays the release rule's.
 */
export async function proposeFromDev(
  deps: ProjectsDeps,
  actor: Actor,
  projectId: string,
): Promise<{ number: number; url: string } | null> {
  const p = await withOrganization(deps.pool, actor.organizationId, (client) =>
    project(client, projectId),
  );
  const { host, code } = await tools(deps, actor, p);
  if (!host.openProposal || p.default_branch === 'dev') return null;
  const opened = await host.openProposal(code, p.repository, {
    base: p.default_branch,
    branch: 'dev',
    title: 'Release dev',
    body: "Proposed by Pono from the dev branch. What ships follows the project's release rule.",
  });
  if (opened)
    await withOrganization(deps.pool, actor.organizationId, (client) =>
      record(client, {
        organizationId: actor.organizationId,
        projectId: p.id,
        action: 'release.proposed',
        actorPerson: actor.personId,
        channel: actor.channel,
        detail: { number: opened.number },
      }),
    );
  return opened;
}

/**
 * Reads the open proposals, evaluates every new head, publishes `pono/release`, and ships what the
 * mode lets ship (D-006). A proposal already evaluated at the same head is not evaluated twice.
 */
export async function evaluateReleases(
  deps: ProjectsDeps,
  actor: Actor,
  projectId: string,
): Promise<ReleaseView[]> {
  const p = await withOrganization(deps.pool, actor.organizationId, (client) =>
    project(client, projectId),
  );
  const mode = modeInForce(p, deps.now());
  const { host, code, hosting, hostingCred } = await tools(deps, actor, p);
  const proposals = await host.listProposals(code, p.repository, p.default_branch);
  const deployments =
    hosting && hostingCred && p.hosting_ref
      ? await hosting.deployments(hostingCred, p.hosting_ref).catch(() => [])
      : [];

  for (const proposal of proposals) {
    const known = await withOrganization(deps.pool, actor.organizationId, (client) =>
      client.query<{ verdict: string; guards: GuardResult[] }>(
        'SELECT verdict, guards FROM releases WHERE project_id = $1 AND number = $2 AND head_sha = $3 ORDER BY created_at DESC LIMIT 1',
        [p.id, proposal.number, proposal.headSha],
      ),
    );
    // A head refused only because its preview was not built yet is read again (D-039).
    if (known.rows[0] && !waitedForPreview(known.rows[0])) continue;
    const files = await host.proposalFiles(code, p.repository, proposal.number);
    const manifest = await host
      .fileAt(code, p.repository, 'pono.yaml', proposal.headSha)
      .catch(() => null);
    const preview =
      deployments.find((d) => d.environment === 'preview' && d.commitSha === proposal.headSha) ??
      null;
    const guards = [
      secretsGuard(files),
      migrationsGuard(files, declaredDestructions(manifest)),
      previewGuard(preview),
    ];
    const v = verdict(guards, mode);
    const step = nextStep(v, mode);
    const status = step === 'refused' ? 'refused' : 'waiting';
    const releaseId = await withOrganization(deps.pool, actor.organizationId, async (client) => {
      await client.query(
        "UPDATE releases SET status = 'superseded' WHERE project_id = $1 AND number = $2 AND status = 'waiting'",
        [p.id, proposal.number],
      );
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO releases (organization_id, project_id, number, title, head_sha, branch, url, mode, verdict, guards, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (project_id, number, head_sha) DO UPDATE
           SET mode = EXCLUDED.mode, verdict = EXCLUDED.verdict, guards = EXCLUDED.guards,
               status = EXCLUDED.status, created_at = now()
         RETURNING id`,
        [
          actor.organizationId,
          p.id,
          proposal.number,
          proposal.title,
          proposal.headSha,
          proposal.branch,
          proposal.url,
          mode,
          v,
          JSON.stringify(guards),
          status,
        ],
      );
      await record(client, {
        organizationId: actor.organizationId,
        projectId: p.id,
        action: v === 'refused' ? 'release.refused' : 'release.evaluated',
        actorPerson: actor.personId,
        channel: actor.channel,
        detail: {
          number: proposal.number,
          verdict: v,
          mode,
          failed: guards.filter((g) => !g.passed).map((g) => g.guard),
        },
      });
      return rows[0]!.id;
    });
    const description =
      v === 'refused'
        ? `Refused: ${guards
            .filter((g) => !g.passed)
            .map((g) => g.guard)
            .join(', ')}`
        : step === 'waiting'
          ? 'Waiting for a person'
          : 'Guards passed';
    await host.setReleaseStatus(
      code,
      p.repository,
      proposal.headSha,
      v === 'refused' ? 'failure' : step === 'waiting' ? 'pending' : 'success',
      description,
    );
    if (step === 'ship')
      await ship(deps, actor, p, releaseId, host, code, proposal.number, proposal.headSha, null);
  }
  return listReleases(deps, actor, projectId);
}

async function ship(
  deps: ProjectsDeps,
  actor: Actor,
  p: ProjectRow,
  releaseId: string,
  host: CodeHost,
  code: string,
  number: number,
  sha: string,
  decidedBy: string | null,
): Promise<void> {
  await host.setReleaseStatus(
    code,
    p.repository,
    sha,
    'success',
    decidedBy ? 'Validated by a person' : 'Shipped by the project mode',
  );
  try {
    await host.merge(code, p.repository, number, sha);
  } catch {
    await withOrganization(deps.pool, actor.organizationId, (client) =>
      client.query("UPDATE releases SET status = 'failed', decided_at = now() WHERE id = $1", [
        releaseId,
      ]),
    );
    throw new AppError(
      'release.merge_failed',
      409,
      'The code host refused the merge (the head may have moved).',
    );
  }
  await withOrganization(deps.pool, actor.organizationId, async (client) => {
    await client.query(
      "UPDATE releases SET status = 'merged', decided_by = $2, decided_at = now() WHERE id = $1",
      [releaseId, decidedBy],
    );
    await record(client, {
      organizationId: actor.organizationId,
      projectId: p.id,
      action: decidedBy ? 'release.approved' : 'release.auto_merged',
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: { number, sha },
    });
  });
}

export async function listReleases(
  deps: ProjectsDeps,
  actor: Actor,
  projectId: string,
): Promise<ReleaseView[]> {
  return withOrganization(deps.pool, actor.organizationId, async (client) => {
    await project(client, projectId);
    const { rows } = await client.query<ReleaseRow>(
      'SELECT * FROM releases WHERE project_id = $1 ORDER BY created_at DESC LIMIT 30',
      [projectId],
    );
    return rows.map(view);
  });
}

async function waitingRelease(
  deps: ProjectsDeps,
  actor: Actor,
  releaseId: string,
): Promise<{ release: ReleaseRow; p: ProjectRow }> {
  if (!z.uuid().safeParse(releaseId).success)
    throw new AppError('release.not_found', 404, 'No such release.');
  return withOrganization(deps.pool, actor.organizationId, async (client) => {
    const { rows } = await client.query<ReleaseRow>('SELECT * FROM releases WHERE id = $1', [
      releaseId,
    ]);
    const release = rows[0];
    if (!release) throw new AppError('release.not_found', 404, 'No such release.');
    if (release.status !== 'waiting')
      throw new AppError('release.not_waiting', 409, 'This release is not waiting for a decision.');
    return { release, p: await project(client, release.project_id) };
  });
}

/** A person validates this exact version (US: validation on an exact version). */
export async function approveRelease(
  deps: ProjectsDeps,
  actor: Actor,
  releaseId: string,
): Promise<void> {
  personOnly(actor);
  const { release, p } = await waitingRelease(deps, actor, releaseId);
  const { host, code } = await tools(deps, actor, p);
  const current = (await host.listProposals(code, p.repository, p.default_branch)).find(
    (x) => x.number === release.number,
  );
  if (!current || current.headSha !== release.head_sha)
    throw new AppError('release.changed', 409, 'The proposal changed since it was evaluated.');
  await ship(
    deps,
    actor,
    p,
    release.id,
    host,
    code,
    release.number,
    release.head_sha,
    actor.personId,
  );
}

export async function declineRelease(
  deps: ProjectsDeps,
  actor: Actor,
  releaseId: string,
): Promise<void> {
  personOnly(actor);
  const { release, p } = await waitingRelease(deps, actor, releaseId);
  const { host, code } = await tools(deps, actor, p);
  await host.setReleaseStatus(
    code,
    p.repository,
    release.head_sha,
    'failure',
    'Declined by a person',
  );
  await withOrganization(deps.pool, actor.organizationId, async (client) => {
    await client.query(
      "UPDATE releases SET status = 'declined', decided_by = $2, decided_at = now() WHERE id = $1",
      [release.id, actor.personId],
    );
    await record(client, {
      organizationId: actor.organizationId,
      projectId: p.id,
      action: 'release.declined',
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: { number: release.number },
    });
  });
}

/** Changes the project's mode; `bypass` always has an end (D-006). */
export async function setReleaseMode(
  deps: ProjectsDeps,
  actor: Actor,
  projectId: string,
  mode: ReleaseMode,
  hours: number | null,
): Promise<void> {
  personOnly(actor);
  if (mode === 'bypass' && !hours)
    throw new AppError(
      'release.bypass_needs_end',
      400,
      'The mode without validation needs an end.',
    );
  const until = mode === 'bypass' ? new Date(deps.now().getTime() + hours! * 3_600_000) : null;
  await withOrganization(deps.pool, actor.organizationId, async (client) => {
    await project(client, projectId);
    await client.query(
      'UPDATE projects SET release_mode = $2, release_mode_until = $3 WHERE id = $1',
      [projectId, mode, until],
    );
    await record(client, {
      organizationId: actor.organizationId,
      projectId,
      action: 'release.mode_changed',
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: { mode, until: until?.toISOString() ?? null },
    });
  });
}

export async function protectProduction(
  deps: ProjectsDeps,
  actor: Actor,
  projectId: string,
): Promise<string> {
  personOnly(actor);
  const p = await withOrganization(deps.pool, actor.organizationId, (client) =>
    project(client, projectId),
  );
  const { host, code } = await tools(deps, actor, p);
  const result = await host.protect(code, p.repository, p.default_branch);
  await withOrganization(deps.pool, actor.organizationId, async (client) => {
    await client.query('UPDATE projects SET production_protection = $2 WHERE id = $1', [
      projectId,
      result,
    ]);
    await record(client, {
      organizationId: actor.organizationId,
      projectId,
      action: 'release.protected',
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: { result },
    });
  });
  return result;
}

export async function rollbackProduction(
  deps: ProjectsDeps,
  actor: Actor,
  projectId: string,
): Promise<void> {
  personOnly(actor);
  const p = await withOrganization(deps.pool, actor.organizationId, (client) =>
    project(client, projectId),
  );
  const { hosting, hostingCred } = await tools(deps, actor, p);
  if (!hosting || !hostingCred || !p.hosting_ref)
    throw new AppError('release.no_hosting', 409, 'This project has no hosting to roll back.');
  await hosting.rollback(hostingCred, p.hosting_ref);
  await withOrganization(deps.pool, actor.organizationId, (client) =>
    record(client, {
      organizationId: actor.organizationId,
      projectId,
      action: 'release.rolled_back',
      actorPerson: actor.personId,
      channel: actor.channel,
    }),
  );
}

/** An agent may ask for a rollback; a person decides (it waits as an alert). */
export async function requestRollback(
  deps: ProjectsDeps,
  actor: Actor,
  projectId: string,
  reason: string,
): Promise<void> {
  await withOrganization(deps.pool, actor.organizationId, async (client) => {
    await project(client, projectId);
    await client.query(
      `INSERT INTO alerts (organization_id, key, kind, level, detail) VALUES ($1, $2, 'release', 'bad', $3)
       ON CONFLICT (organization_id, key) WHERE resolved_at IS NULL DO UPDATE SET detail = excluded.detail`,
      [actor.organizationId, `rollback:${projectId}`, { projectId, reason: reason.slice(0, 280) }],
    );
    await record(client, {
      organizationId: actor.organizationId,
      projectId,
      action: 'release.rollback_requested',
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: { reason: reason.slice(0, 280) },
    });
  });
}

/** How long after an automatic merge Pono watches production and rolls back by itself. */
export const AUTO_ROLLBACK_WINDOW_MS = 60 * 60 * 1000;

/**
 * D-006, mode 2: after Pono merged a change by itself, if production stops answering, Pono puts the
 * previous deployment back, once, and says so. Never after a person's own merge, never in `ask`.
 * Run by Pono's periodic task, after the projects are read again.
 */
export async function autoRollback(deps: ProjectsDeps, actor: Actor): Promise<string[]> {
  if (actor.channel !== 'system') throw new AppError('release.person_only', 403, 'Pono only.');
  const candidates = await withOrganization(deps.pool, actor.organizationId, async (client) => {
    const { rows } = await client.query<ProjectRow & { release_id: string; number: number }>(
      `SELECT p.id, p.repository, p.default_branch, p.hosting_provider, p.hosting_ref, p.release_mode,
         p.release_mode_until, r.id AS release_id, r.number
       FROM projects p JOIN releases r ON r.project_id = p.id
       WHERE p.link_status = 'down' AND r.status = 'merged' AND r.decided_by IS NULL
         AND r.decided_at >= now() - make_interval(secs => $1)
         AND NOT EXISTS (SELECT 1 FROM journal j WHERE j.project_id = p.id
           AND j.action = 'release.auto_rolled_back' AND j.created_at >= r.decided_at)
       ORDER BY r.decided_at DESC`,
      [AUTO_ROLLBACK_WINDOW_MS / 1000],
    );
    return rows;
  });
  const done: string[] = [];
  for (const p of candidates) {
    if (done.includes(p.id) || modeInForce(p, deps.now()) !== 'auto') continue;
    const { hosting, hostingCred } = await tools(deps, actor, p).catch(() => ({
      hosting: null,
      hostingCred: null,
    }));
    if (!hosting || !hostingCred || !p.hosting_ref) continue;
    await hosting.rollback(hostingCred, p.hosting_ref);
    await withOrganization(deps.pool, actor.organizationId, async (client) => {
      await record(client, {
        organizationId: actor.organizationId,
        projectId: p.id,
        action: 'release.auto_rolled_back',
        actorPerson: null,
        channel: 'system',
        detail: { number: p.number, reason: 'production_down' },
      });
      await client.query(
        `INSERT INTO alerts (organization_id, key, kind, level, detail) VALUES ($1, $2, 'release', 'bad', $3)
         ON CONFLICT (organization_id, key) WHERE resolved_at IS NULL DO UPDATE SET detail = excluded.detail`,
        [
          actor.organizationId,
          `rolled-back:${p.id}`,
          { projectId: p.id, number: p.number, reason: 'production_down' },
        ],
      );
    });
    done.push(p.id);
  }
  return done;
}

/** Release routes (phase 5). */
export function releaseRoutes(deps: ProjectsDeps): Hono<AppEnv> {
  const modeBody = z.object({
    mode: z.enum(['ask', 'auto', 'bypass']),
    hours: z.number().int().min(1).max(720).nullish(),
  });
  return (
    new Hono<AppEnv>()
      .get('/projects/:id/releases', async (c) => {
        const releases = await listReleases(deps, c.var.actor, c.req.param('id'));
        const p = await withOrganization(deps.pool, c.var.actor.organizationId, (client) =>
          client.query<{
            release_mode: ReleaseMode;
            release_mode_until: Date | null;
            production_protection: string;
          }>(
            'SELECT release_mode, release_mode_until, production_protection FROM projects WHERE id = $1',
            [c.req.param('id')],
          ),
        );
        const row = p.rows[0]!;
        return c.json({
          mode: modeInForce(row, deps.now()),
          modeUntil: row.release_mode_until?.toISOString() ?? null,
          protection: row.production_protection,
          releases,
        });
      })
      // Like the agents' propose_release: what dev holds is proposed, then every proposal is read.
      .post('/projects/:id/releases/evaluate', async (c) => {
        const proposal = await proposeFromDev(deps, c.var.actor, c.req.param('id'));
        return c.json({
          proposal,
          releases: await evaluateReleases(deps, c.var.actor, c.req.param('id')),
        });
      })
      .post('/releases/:id/approve', async (c) => {
        await approveRelease(deps, c.var.actor, c.req.param('id'));
        return c.body(null, 204);
      })
      .post('/releases/:id/decline', async (c) => {
        await declineRelease(deps, c.var.actor, c.req.param('id'));
        return c.body(null, 204);
      })
      .put('/projects/:id/release-mode', async (c) => {
        const body = modeBody.safeParse(await c.req.json().catch(() => null));
        if (!body.success) throw new AppError('request.invalid', 400, 'Expected a mode.');
        await setReleaseMode(
          deps,
          c.var.actor,
          c.req.param('id'),
          body.data.mode,
          body.data.hours ?? null,
        );
        return c.body(null, 204);
      })
      .post('/projects/:id/protect', async (c) =>
        c.json({ protection: await protectProduction(deps, c.var.actor, c.req.param('id')) }),
      )
      .post('/projects/:id/rollback', async (c) => {
        await rollbackProduction(deps, c.var.actor, c.req.param('id'));
        return c.body(null, 204);
      })
  );
}
