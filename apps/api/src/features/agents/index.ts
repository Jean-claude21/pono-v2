import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../platform/context.js';
import { withOrganization, type Pool } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { newToken } from '../../platform/secrets.js';
import { record } from '../journal/index.js';

export { recognize, repositoryOf, type Candidate, type Recognition } from './recognize.js';
export { mcpHandler, type McpDeps } from './mcp.js';

const createBody = z.object({
  name: z.string().trim().min(1).max(60),
  scope: z.enum(['read', 'act']),
});

/** `/v1/agents`: a person gives an agent access, sees it, cuts it — in the console only (principle 5). */
export function agentRoutes(deps: { pool: Pool }): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .get('/', async (c) => {
      const rows = await withOrganization(
        deps.pool,
        c.var.actor.organizationId,
        async (client) =>
          (
            await client.query<{
              id: string;
              name: string;
              scope: string;
              created_at: Date;
              last_used_at: Date | null;
            }>(
              'SELECT id, name, scope, created_at, last_used_at FROM agent_tokens WHERE revoked_at IS NULL ORDER BY created_at',
            )
          ).rows,
      );
      return c.json({
        agents: rows.map((r) => ({
          id: r.id,
          name: r.name,
          scope: r.scope,
          createdAt: r.created_at.toISOString(),
          lastUsedAt: r.last_used_at?.toISOString() ?? null,
        })),
      });
    })
    .post('/', async (c) => {
      const actor = c.var.actor;
      if (actor.channel !== 'console')
        throw new AppError('agents.person_only', 403, 'Only a person gives an agent access.');
      const body = createBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) throw new AppError('request.invalid', 400, 'Expected a name and a scope.');
      const { token, hash } = newToken();
      const id = await withOrganization(deps.pool, actor.organizationId, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          'INSERT INTO agent_tokens (organization_id, person_id, name, scope, token_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [actor.organizationId, actor.personId, body.data.name, body.data.scope, hash],
        );
        await record(client, {
          organizationId: actor.organizationId,
          action: 'agent.granted',
          actorPerson: actor.personId,
          channel: actor.channel,
          detail: { name: body.data.name, scope: body.data.scope },
        });
        return rows[0]!.id;
      });
      // The token is shown once, here; Pono keeps only its hash.
      return c.json({ id, token: `pono_${token}` }, 201);
    })
    .delete('/:id', async (c) => {
      const actor = c.var.actor;
      const id = c.req.param('id');
      if (!z.uuid().safeParse(id).success)
        throw new AppError('agent.not_found', 404, 'No such agent.');
      await withOrganization(deps.pool, actor.organizationId, async (client) => {
        const { rows } = await client.query<{ name: string }>(
          'UPDATE agent_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING name',
          [id],
        );
        if (!rows[0]) throw new AppError('agent.not_found', 404, 'No such agent.');
        await record(client, {
          organizationId: actor.organizationId,
          action: 'agent.revoked',
          actorPerson: actor.personId,
          channel: actor.channel,
          detail: { name: rows[0].name },
        });
      });
      return c.body(null, 204);
    });
}
