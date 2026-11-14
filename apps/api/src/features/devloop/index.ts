import { Hono } from 'hono';
import { z } from 'zod';
import type { Actor, AppEnv } from '../../platform/context.js';
import { withOrganization } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { activeCredentials } from '../connections/index.js';
import { record } from '../journal/index.js';
import { readManifest } from '../manifest/domain.js';
import type { ProjectsDeps } from '../projects/application.js';
import type { ServersDeps } from '../servers/index.js';
import { checkSecrets } from '../variables/index.js';
import {
  devPlan,
  prepareCommand,
  pullCommand,
  pushCommand,
  readPrepared,
  readStatus,
  redact,
  stagedCommand,
  startCommand,
  statusCommand,
  stopCommand,
  type DevState,
} from './domain.js';
import {
  codeCommand,
  devProblems,
  jobCommand,
  WRITING_OPS,
  LIMITS,
  readCode,
  readRun,
  runCommand,
  safePath,
  type CodeOp,
  type RunResult,
} from './code.js';

export * from './domain.js';
export * from './code.js';

export type DevLoopDeps = ProjectsDeps & ServersDeps;

interface Target {
  projectId: string;
  repository: string;
  defaultBranch: string;
  serverId: string;
  externalId: string;
  status: string;
  devPort: number | null;
  previewUrl: string | null;
  values: string[];
}

/** The project's awake server, and the development values to hide from logs. */
async function target(deps: DevLoopDeps, actor: Actor, projectId: string): Promise<Target> {
  if (!z.uuid().safeParse(projectId).success)
    throw new AppError('project.not_found', 404, 'No such project.');
  return withOrganization(deps.pool, actor.organizationId, async (client) => {
    const { rows } = await client.query<{
      repository: string;
      default_branch: string;
      server_id: string | null;
      external_id: string | null;
      status: string | null;
      dev_port: number | null;
      preview_url: string | null;
    }>(
      `SELECT p.repository, p.default_branch, s.id AS server_id, s.external_id, s.status, s.dev_port, s.preview_url
       FROM projects p LEFT JOIN project_servers s ON s.project_id = p.id AND s.status <> 'released'
       WHERE p.id = $1`,
      [projectId],
    );
    const row = rows[0];
    if (!row) throw new AppError('project.not_found', 404, 'No such project.');
    if (!row.server_id || !row.external_id)
      throw new AppError('dev.no_server', 409, 'Give this project a server first.');
    if (row.status !== 'running')
      throw new AppError('dev.server_asleep', 409, 'The server sleeps: wake it first.', {
        serverId: row.server_id,
      });
    const sealed = await client.query<{ sealed_value: string }>(
      'SELECT sealed_value FROM project_variables WHERE project_id = $1 AND sealed_value IS NOT NULL',
      [projectId],
    );
    return {
      projectId,
      repository: row.repository,
      defaultBranch: row.default_branch,
      serverId: row.server_id,
      externalId: row.external_id,
      status: row.status,
      devPort: row.dev_port,
      previewUrl: row.preview_url,
      values: sealed.rows.flatMap((v) => deps.sealer.open(v.sealed_value) ?? []),
    };
  });
}

async function gitAccess(deps: DevLoopDeps, actor: Actor, repository: string) {
  const creds = await withOrganization(deps.pool, actor.organizationId, (client) =>
    activeCredentials(client, deps.sealer, 'code_host'),
  );
  for (const host of deps.adapters.codeHosts) {
    const credential = creds.find((c) => c.provider === host.id)?.credential;
    if (credential) return host.gitAccess(credential, repository);
  }
  throw new AppError('connection.code_host_missing', 409, 'Connect your code host first.');
}

async function journal(
  deps: DevLoopDeps,
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

export interface DevView extends DevState {
  previewUrl: string | null;
  port: number | null;
}

/**
 * Starts the project's dev server on its project server (D-020): the repository cloned or fetched
 * on `dev`, the plan read from pono.yaml or package.json, installed and run in the background, its
 * port published. The preview address stays the same for this server.
 */
export async function startDev(
  deps: DevLoopDeps,
  actor: Actor,
  projectId: string,
): Promise<DevView> {
  const t = await target(deps, actor, projectId);
  const access = await gitAccess(deps, actor, t.repository);
  const prepared = await deps.serverHost.run(
    t.externalId,
    prepareCommand({
      repository: t.repository,
      url: access.url,
      header: access.header,
      defaultBranch: t.defaultBranch,
      author: { name: actor.name ?? actor.login, email: `${actor.login}@users.noreply.pono.dev` },
    }),
  );
  if (prepared.exitCode !== 0)
    throw new AppError(
      'dev.clone_failed',
      502,
      'The repository could not be fetched on the server.',
      {
        output: redact(`${prepared.stdout}\n${prepared.stderr}`, [
          access.header,
          ...t.values,
        ]).slice(-1500),
      },
    );
  const seen = readPrepared(prepared.stdout);
  const manifest = seen.manifest ? readManifest(seen.manifest) : null;
  const plan = devPlan({
    manifestDev: manifest?.ok ? manifest.manifest.dev : undefined,
    packageJson: seen.packageJson,
    files: seen.files,
  });
  if (!plan)
    throw new AppError(
      'dev.unknown',
      422,
      'Nothing says how this project runs: add `dev:` (install, command, port) to pono.yaml.',
    );
  await deps.serverHost.run(t.externalId, stopCommand(t.repository));
  await deps.serverHost.start(
    t.externalId,
    startCommand({ repository: t.repository, plan, hostSuffix: deps.serverHost.publicHostSuffix }),
  );
  const { url } = await deps.serverHost.publishPort(t.externalId, plan.port, 'preview');
  await withOrganization(deps.pool, actor.organizationId, (client) =>
    client.query(
      'UPDATE project_servers SET dev_port = $2, dev_command = $3, preview_url = $4, dev_started_at = now() WHERE id = $1',
      [t.serverId, plan.port, plan.command, url],
    ),
  );
  await journal(deps, actor, projectId, 'dev.started', { port: plan.port, command: plan.command });
  return { ...(await devStatus(deps, actor, projectId)), previewUrl: url, port: plan.port };
}

/** Where the dev server stands: phase, process, what its port answers, branch, the logs' end. */
export async function devStatus(
  deps: DevLoopDeps,
  actor: Actor,
  projectId: string,
  lines = 20,
): Promise<DevView> {
  const t = await target(deps, actor, projectId);
  if (!t.devPort)
    return {
      phase: 'absent',
      alive: false,
      http: 0,
      branch: null,
      commit: null,
      changedFiles: 0,
      logs: '',
      previewUrl: null,
      port: null,
    };
  const out = await deps.serverHost.run(
    t.externalId,
    statusCommand(t.repository, t.devPort, lines),
  );
  const state = readStatus(out.stdout);
  return {
    ...state,
    logs: redact(state.logs, t.values),
    previewUrl: t.previewUrl,
    port: t.devPort,
  };
}

export async function stopDev(deps: DevLoopDeps, actor: Actor, projectId: string): Promise<void> {
  const t = await target(deps, actor, projectId);
  await deps.serverHost.run(t.externalId, stopCommand(t.repository));
  await journal(deps, actor, projectId, 'dev.stopped');
}

/** Takes what was pushed to `dev` elsewhere; the dev server reloads by itself. */
export async function pullChanges(
  deps: DevLoopDeps,
  actor: Actor,
  projectId: string,
): Promise<{ commit: string }> {
  const t = await target(deps, actor, projectId);
  const access = await gitAccess(deps, actor, t.repository);
  const out = await deps.serverHost.run(t.externalId, pullCommand(t.repository, access.header));
  if (out.exitCode !== 0)
    throw new AppError(
      'dev.pull_failed',
      409,
      'The server could not take the changes (diverged?).',
      {
        output: redact(`${out.stdout}\n${out.stderr}`, [access.header, ...t.values]).slice(-1500),
      },
    );
  const commit = out.stdout.trim().split('\n').pop() ?? '';
  await journal(deps, actor, projectId, 'dev.pulled', { commit });
  return { commit };
}

/**
 * Commits what changed on the server and pushes it to `dev`, after the secrets guard (D-007): a
 * finding stops the push and names file and line, never the value. Production is reached only by a
 * proposal, under the release rule.
 */
export async function pushChanges(
  deps: DevLoopDeps,
  actor: Actor,
  projectId: string,
  message: string,
): Promise<{ pushed: boolean; commit?: string; files: number; findings?: unknown[] }> {
  const t = await target(deps, actor, projectId);
  const staged = await deps.serverHost.run(t.externalId, stagedCommand(t.repository));
  if (staged.exitCode !== 0)
    throw new AppError(
      'dev.not_ready',
      409,
      'The repository is not on the server yet: start dev first.',
    );
  const files = staged.stdout
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as { path: string; content: string });
  if (!files.length) return { pushed: false, files: 0 };
  const check = checkSecrets(files);
  if (!check.clean) {
    await journal(deps, actor, projectId, 'dev.push_refused', {
      files: files.length,
      findings: check.findings.length,
    });
    return { pushed: false, files: files.length, findings: check.findings };
  }
  const access = await gitAccess(deps, actor, t.repository);
  const out = await deps.serverHost.run(
    t.externalId,
    pushCommand(t.repository, access.header, message.slice(0, 200) || 'Work from the Pono server'),
  );
  if (out.exitCode !== 0)
    throw new AppError('dev.push_failed', 409, 'The push was refused (not on dev, or behind).', {
      output: redact(`${out.stdout}\n${out.stderr}`, [access.header, ...t.values]).slice(-1500),
    });
  const commit = out.stdout.trim().split('\n').pop() ?? '';
  await journal(deps, actor, projectId, 'dev.pushed', { commit, files: files.length });
  return { pushed: true, commit, files: files.length };
}

/** Paths the agent gave, made safe; a path outside the repository is refused, never guessed. */
function pathOf(path: string): string {
  const clean = safePath(path);
  if (!clean)
    throw new AppError(
      'code.bad_path',
      400,
      'Give a path relative to the repository, without `..`, outside .git and node_modules.',
    );
  return clean;
}

/**
 * One file operation in the project's repository on its server (D-027): read, list, search, edit,
 * write, move, delete, or the changes so far. Writes are journaled with their paths; nothing that
 * leaves the server carries a development value.
 */
export async function codeOn(
  deps: DevLoopDeps,
  actor: Actor,
  projectId: string,
  input: CodeOp,
): Promise<Record<string, unknown>> {
  const op: CodeOp =
    'path' in input && input.path !== null ? { ...input, path: pathOf(input.path) } : input;
  if (op.op === 'move') op.to = pathOf(op.to);
  if (
    (op.op === 'write' && op.content.length > LIMITS.writeChars) ||
    (op.op === 'patch' && op.patch.length > LIMITS.writeChars)
  )
    throw new AppError('code.too_large', 413, 'Write large files in several smaller parts.');
  const t = await target(deps, actor, projectId);
  const out = await deps.serverHost.run(t.externalId, codeCommand(t.repository, op), {
    timeoutMs: 60_000,
  });
  const problems = redact(devProblems(out.stdout).join('\n'), t.values);
  const answer = readCode(out.stdout);
  if (answer.error === 'not_ready')
    throw new AppError(
      'dev.not_ready',
      409,
      'The repository is not on the server yet: call start_dev first.',
    );
  if (answer.error === 'no_answer')
    throw new AppError('code.server_failed', 502, 'The server did not answer.', {
      output: redact(out.stderr, t.values).slice(-1500),
    });
  const wrote = !answer.error && WRITING_OPS.has(op.op) && !(op.op === 'edit' && op.dryRun);
  if (wrote)
    await journal(deps, actor, projectId, `code.${op.op}`, {
      path: 'path' in op ? op.path : null,
      ...(op.op === 'move' ? { to: op.to } : {}),
      ...(op.op === 'patch' && Array.isArray(answer.applied)
        ? { files: (answer.applied as { path: string }[]).map((a) => a.path).slice(0, 50) }
        : {}),
    });
  const safe = JSON.parse(redact(JSON.stringify(answer), t.values)) as Record<string, unknown>;
  return wrote && problems ? { ...safe, devServer: problems.split('\n') } : safe;
}

/**
 * A shell command in the project's repository on its server (D-027): install a package, run the
 * tests, build. Bounded in time; in the background, read later with `jobOutput`. The command is
 * journaled; its output never carries a development value.
 */
export async function runOn(
  deps: DevLoopDeps,
  actor: Actor,
  projectId: string,
  command: string,
  seconds: number,
  background: boolean,
): Promise<RunResult> {
  const t = await target(deps, actor, projectId);
  const limit = Math.min(Math.max(1, Math.round(seconds)), LIMITS.seconds);
  const out = await deps.serverHost.run(
    t.externalId,
    runCommand(t.repository, command, limit, background),
    { timeoutMs: background ? 30_000 : (limit + 30) * 1000 },
  );
  const result = readRun(out.stdout);
  if (!result.ready)
    throw new AppError(
      'dev.not_ready',
      409,
      'The repository is not on the server yet: call start_dev first.',
    );
  await journal(deps, actor, projectId, 'code.run', {
    command: redact(command, t.values).slice(0, 200),
    ...(result.job ? { job: result.job } : { exitCode: result.exitCode }),
  });
  return { ...result, output: redact(result.output, t.values) };
}

/** A background command's output so far, and its exit code once it ended. */
export async function jobOutput(
  deps: DevLoopDeps,
  actor: Actor,
  projectId: string,
  job: string,
): Promise<RunResult> {
  if (!/^\d{6,24}$/.test(job)) throw new AppError('code.no_job', 404, 'No such job.');
  const t = await target(deps, actor, projectId);
  const out = await deps.serverHost.run(t.externalId, jobCommand(t.repository, job));
  const result = readRun(out.stdout);
  if (!result.ready) throw new AppError('code.no_job', 404, 'No such job.');
  return { ...result, job, output: redact(result.output, t.values) };
}

/** `/v1/projects/:id/dev/*`. */
export function devRoutes(deps: DevLoopDeps): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .get('/projects/:id/dev', async (c) =>
      c.json(
        await devStatus(
          deps,
          c.var.actor,
          c.req.param('id'),
          Math.min(200, Number(c.req.query('lines') ?? 20) || 20),
        ),
      ),
    )
    .post('/projects/:id/dev/start', async (c) =>
      c.json(await startDev(deps, c.var.actor, c.req.param('id'))),
    )
    .post('/projects/:id/dev/stop', async (c) => {
      await stopDev(deps, c.var.actor, c.req.param('id'));
      return c.body(null, 204);
    })
    .post('/projects/:id/dev/pull', async (c) =>
      c.json(await pullChanges(deps, c.var.actor, c.req.param('id'))),
    )
    .post('/projects/:id/dev/push', async (c) => {
      const body = z
        .object({ message: z.string().min(1).max(200) })
        .safeParse(await c.req.json().catch(() => null));
      if (!body.success) throw new AppError('request.invalid', 400, 'Expected a commit message.');
      return c.json(await pushChanges(deps, c.var.actor, c.req.param('id'), body.data.message));
    })
    .get('/projects/:id/preview', async (c) => {
      const t = await target(deps, c.var.actor, c.req.param('id')).catch(() => null);
      if (!t?.previewUrl) throw new AppError('dev.no_preview', 404, 'No preview yet: start dev.');
      return c.redirect(t.previewUrl);
    });
}
