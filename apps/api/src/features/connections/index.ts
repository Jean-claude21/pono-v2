import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../platform/context.js';
import { withOrganization, type Client, type Pool } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { ProviderError } from '../../platform/http.js';
import type { Sealer } from '../../platform/secrets.js';
import { record } from '../journal/index.js';
import type { Connectable, ConnectionKind } from './ports.js';

export type { Connectable, ConnectionKind } from './ports.js';

export interface ConnectionView {
  id: string;
  provider: string;
  kind: ConnectionKind;
  account: string;
  status: 'active' | 'expired' | 'revoked';
  createdAt: string;
}

export interface ConnectionsDeps {
  pool: Pool;
  sealer: Sealer;
  connectable: Connectable[];
}

const COLUMNS = 'id, provider, kind, account, status, created_at';

function view(row: {
  id: string;
  provider: string;
  kind: ConnectionKind;
  account: string;
  status: ConnectionView['status'];
  created_at: Date;
}): ConnectionView {
  return {
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    account: row.account,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

/** Keeps the code host token of a sign-in, sealed, replacing the previous one (FR-004). */
export async function saveCodeHostConnection(
  client: Client,
  sealer: Sealer,
  input: {
    organizationId: string;
    provider: string;
    account: string;
    token: string;
    personId: string;
  },
): Promise<void> {
  const sealed = sealer.seal(input.token);
  const updated = await client.query(
    `UPDATE connections SET sealed_credential = $1, account = $2, status = 'active'
     WHERE provider = $3 AND status <> 'revoked'`,
    [sealed, input.account, input.provider],
  );
  if (updated.rowCount) return;
  await client.query(
    `INSERT INTO connections (organization_id, provider, kind, account, status, sealed_credential, created_by)
     VALUES ($1, $2, 'code_host', $3, 'active', $4, $5)`,
    [input.organizationId, input.provider, input.account, sealed, input.personId],
  );
  await record(client, {
    organizationId: input.organizationId,
    action: 'connection.created',
    actorPerson: input.personId,
    channel: 'console',
    detail: { provider: input.provider, account: input.account },
  });
}

/** The active connections of the organization in context, with their opened credential. */
export async function activeCredentials(
  client: Client,
  sealer: Sealer,
  kind?: ConnectionKind,
): Promise<{ provider: string; kind: ConnectionKind; credential: string }[]> {
  const { rows } = await client.query<{
    provider: string;
    kind: ConnectionKind;
    sealed_credential: string;
  }>(
    `SELECT provider, kind, sealed_credential FROM connections
     WHERE status = 'active' AND ($1::text IS NULL OR kind = $1)`,
    [kind ?? null],
  );
  return rows.flatMap((row) => {
    const credential = sealer.open(row.sealed_credential);
    return credential === null ? [] : [{ provider: row.provider, kind: row.kind, credential }];
  });
}

const connectBody = z.object({
  provider: z.string().min(1),
  fields: z.record(z.string(), z.string().min(1).max(4096)),
});

/** `/v1/connections` (US2). No response ever carries a credential. */
export function connectionRoutes(deps: ConnectionsDeps): Hono<AppEnv> {
  const byId = new Map(deps.connectable.map((p) => [p.id, p]));
  return new Hono<AppEnv>()
    .get('/', async (c) => {
      const rows = await withOrganization(
        deps.pool,
        c.var.actor.organizationId,
        async (client) =>
          (
            await client.query(
              `SELECT ${COLUMNS} FROM connections WHERE status <> 'revoked' ORDER BY created_at`,
            )
          ).rows,
      );
      return c.json({
        connections: rows.map(view),
        available: deps.connectable.map((p) => ({
          provider: p.id,
          kind: p.kind,
          fields: p.fields,
        })),
      });
    })
    .post('/', async (c) => {
      const actor = c.var.actor;
      const parsed = connectBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success)
        throw new AppError('request.invalid', 400, 'Expected a provider and its fields.');
      const provider = byId.get(parsed.data.provider);
      if (!provider) throw new AppError('connection.unknown_provider', 404, 'No such provider.');
      const missing = provider.fields.filter((f) => !parsed.data.fields[f]);
      if (missing.length)
        throw new AppError('request.invalid', 400, `Missing: ${missing.join(', ')}`);
      let verified: { account: string; credential: string };
      try {
        verified = await provider.verify(parsed.data.fields);
      } catch (error) {
        if (error instanceof ProviderError && error.unauthorized) {
          throw new AppError('connection.rejected', 422, 'The provider refused this key.');
        }
        throw new AppError('connection.unreachable', 502, 'The provider did not answer.');
      }
      const row = await withOrganization(deps.pool, actor.organizationId, async (client) => {
        const exists = await client.query(
          `SELECT 1 FROM connections WHERE provider = $1 AND status <> 'revoked'`,
          [provider.id],
        );
        if (exists.rowCount) throw new AppError('connection.exists', 409, 'Already connected.');
        const inserted = await client.query(
          `INSERT INTO connections (organization_id, provider, kind, account, status, sealed_credential, created_by)
           VALUES ($1, $2, $3, $4, 'active', $5, $6) RETURNING ${COLUMNS}`,
          [
            actor.organizationId,
            provider.id,
            provider.kind,
            verified.account,
            deps.sealer.seal(verified.credential),
            actor.personId,
          ],
        );
        await record(client, {
          organizationId: actor.organizationId,
          action: 'connection.created',
          actorPerson: actor.personId,
          channel: actor.channel,
          detail: { provider: provider.id, account: verified.account },
        });
        return inserted.rows[0];
      });
      return c.json({ connection: view(row) }, 201);
    })
    .delete('/:id', async (c) => {
      const actor = c.var.actor;
      const id = c.req.param('id');
      if (!z.uuid().safeParse(id).success)
        throw new AppError('connection.not_found', 404, 'No such connection.');
      await withOrganization(deps.pool, actor.organizationId, async (client) => {
        const { rows } = await client.query<{ provider: string; account: string }>(
          `UPDATE connections SET status = 'revoked', sealed_credential = NULL, revoked_at = now()
           WHERE id = $1 AND status <> 'revoked' RETURNING provider, account`,
          [id],
        );
        const revoked = rows[0];
        if (!revoked) throw new AppError('connection.not_found', 404, 'No such connection.');
        await record(client, {
          organizationId: actor.organizationId,
          action: 'connection.revoked',
          actorPerson: actor.personId,
          channel: actor.channel,
          detail: { provider: revoked.provider, account: revoked.account },
        });
      });
      return c.body(null, 204);
    });
}
