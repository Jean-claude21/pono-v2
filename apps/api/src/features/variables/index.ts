import { Hono } from 'hono';
import { z } from 'zod';
import type { Actor, AppEnv } from '../../platform/context.js';
import { withOrganization, type Pool } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import type { Sealer } from '../../platform/secrets.js';
import { record } from '../journal/index.js';
import { secretsGuard, type ChangedFile } from '../releases/guards.js';

export interface VariablesDeps {
  pool: Pool;
  sealer: Sealer;
}

export const variableName = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
  .refine((n) => !n.startsWith('PONO_'), 'PONO_ names are Pono’s own.');

export interface VariableView {
  name: string;
  set: boolean;
  requestedReason: string | null;
  setAt: string | null;
}

/** A project's development variables, by name: values are never read back (D-007). */
export async function listVariables(
  deps: VariablesDeps,
  actor: Actor,
  projectId: string,
): Promise<VariableView[]> {
  return withOrganization(deps.pool, actor.organizationId, async (client) => {
    const p = await client.query('SELECT 1 FROM projects WHERE id = $1', [projectId]);
    if (!p.rowCount) throw new AppError('project.not_found', 404, 'No such project.');
    const { rows } = await client.query<{
      name: string;
      set: boolean;
      requested_reason: string | null;
      set_at: Date | null;
    }>(
      'SELECT name, sealed_value IS NOT NULL AS set, requested_reason, set_at FROM project_variables WHERE project_id = $1 ORDER BY name',
      [projectId],
    );
    return rows.map((r) => ({
      name: r.name,
      set: r.set,
      requestedReason: r.requested_reason,
      setAt: r.set_at?.toISOString() ?? null,
    }));
  });
}

/** A person sets a development value, in the console only; it is sealed at once. */
export async function setVariable(
  deps: VariablesDeps,
  actor: Actor,
  projectId: string,
  name: string,
  value: string,
): Promise<void> {
  if (actor.channel !== 'console')
    throw new AppError('variables.person_only', 403, 'A value is set by a person, in the console.');
  await withOrganization(deps.pool, actor.organizationId, async (client) => {
    const p = await client.query('SELECT 1 FROM projects WHERE id = $1', [projectId]);
    if (!p.rowCount) throw new AppError('project.not_found', 404, 'No such project.');
    await client.query(
      `INSERT INTO project_variables (organization_id, project_id, name, sealed_value, set_by, set_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (project_id, name) DO UPDATE
         SET sealed_value = excluded.sealed_value, set_by = excluded.set_by, set_at = now()`,
      [actor.organizationId, projectId, name, deps.sealer.seal(value), actor.personId],
    );
    await client.query(
      'UPDATE alerts SET resolved_at = now() WHERE key = $1 AND resolved_at IS NULL',
      [`variable:${projectId}:${name}`],
    );
    // The name only: never the value, never its length.
    await record(client, {
      organizationId: actor.organizationId,
      projectId,
      action: 'variable.set',
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: { name },
    });
  });
}

export async function removeVariable(
  deps: VariablesDeps,
  actor: Actor,
  projectId: string,
  name: string,
): Promise<void> {
  if (actor.channel !== 'console')
    throw new AppError('variables.person_only', 403, 'A value is set by a person, in the console.');
  await withOrganization(deps.pool, actor.organizationId, async (client) => {
    const deleted = await client.query(
      'DELETE FROM project_variables WHERE project_id = $1 AND name = $2',
      [projectId, name],
    );
    if (!deleted.rowCount) throw new AppError('variable.not_found', 404, 'No such variable.');
    await record(client, {
      organizationId: actor.organizationId,
      projectId,
      action: 'variable.removed',
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: { name },
    });
  });
}

/**
 * An agent asks for a variable it needs: a name and why. The person sees the request in the
 * console and sets the value there; the value never passes through a conversation (D-007).
 */
export async function requestVariable(
  deps: VariablesDeps,
  actor: Actor,
  projectId: string,
  name: string,
  reason: string,
): Promise<{ requested: string; setIn: string }> {
  await withOrganization(deps.pool, actor.organizationId, async (client) => {
    const p = await client.query('SELECT 1 FROM projects WHERE id = $1', [projectId]);
    if (!p.rowCount) throw new AppError('project.not_found', 404, 'No such project.');
    await client.query(
      `INSERT INTO project_variables (organization_id, project_id, name, requested_reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, name) DO UPDATE SET requested_reason = excluded.requested_reason`,
      [actor.organizationId, projectId, name, reason.slice(0, 280)],
    );
    await client.query(
      `INSERT INTO alerts (organization_id, key, kind, level, detail) VALUES ($1, $2, 'server', 'warn', $3)
       ON CONFLICT (organization_id, key) WHERE resolved_at IS NULL DO UPDATE SET detail = excluded.detail`,
      [actor.organizationId, `variable:${projectId}:${name}`, { projectId, name }],
    );
    await record(client, {
      organizationId: actor.organizationId,
      projectId,
      action: 'variable.requested',
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: { name },
    });
  });
  return { requested: name, setIn: `/projects/${projectId}` };
}

/**
 * The secrets guard on files about to be committed, before they leave the server (D-007): the
 * same rules as the release guard, findings by file and line, never the value.
 */
export function checkSecrets(files: { path: string; content: string }[]) {
  const changed: ChangedFile[] = files.map((f) => {
    const lines = f.content.split('\n');
    return {
      path: f.path,
      status: 'added',
      patch: `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}`,
      binary: false,
    };
  });
  const result = secretsGuard(changed);
  return { clean: result.passed, findings: result.findings };
}

const uuid = z.uuid();
function ids(projectRaw: string, nameRaw?: string): { projectId: string; name: string } {
  if (!uuid.safeParse(projectRaw).success)
    throw new AppError('project.not_found', 404, 'No such project.');
  const name = nameRaw === undefined ? '' : variableName.safeParse(nameRaw);
  if (typeof name !== 'string' && !name.success)
    throw new AppError(
      'variable.invalid_name',
      400,
      'A name in CAPITALS, not starting with PONO_.',
    );
  return { projectId: projectRaw, name: typeof name === 'string' ? '' : name.data };
}

/** `/v1/projects/:id/variables`: names for everyone, values written by a person only. */
export function variableRoutes(deps: VariablesDeps): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .get('/projects/:id/variables', async (c) => {
      const { projectId } = ids(c.req.param('id'));
      return c.json({ variables: await listVariables(deps, c.var.actor, projectId) });
    })
    .put('/projects/:id/variables/:name', async (c) => {
      const { projectId, name } = ids(c.req.param('id'), c.req.param('name'));
      const body = z
        .object({ value: z.string().min(1).max(10_000) })
        .safeParse(await c.req.json().catch(() => null));
      if (!body.success) throw new AppError('request.invalid', 400, 'Expected a value.');
      await setVariable(deps, c.var.actor, projectId, name, body.data.value);
      return c.body(null, 204);
    })
    .delete('/projects/:id/variables/:name', async (c) => {
      const { projectId, name } = ids(c.req.param('id'), c.req.param('name'));
      await removeVariable(deps, c.var.actor, projectId, name);
      return c.body(null, 204);
    });
}
