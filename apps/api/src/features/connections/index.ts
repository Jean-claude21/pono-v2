import { Hono } from 'hono';
import { z } from 'zod';
import type { Actor, AppEnv } from '../../platform/context.js';
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
  /** The console's address: where a provider sends the person back after an OAuth sign-in. */
  publicUrl: string;
}

/** Ten minutes to come back from the provider. */
const STATE_MS = 10 * 60 * 1000;

/**
 * Keeps a verified credential as the organization's connection to its provider, journaled; refuses a
 * second one for the same provider.
 */
async function keep(
  deps: ConnectionsDeps,
  actor: Pick<Actor, 'organizationId' | 'personId' | 'channel'>,
  provider: Connectable,
  verified: { account: string; credential: string },
) {
  return withOrganization(deps.pool, actor.organizationId, async (client) => {
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
  return (
    new Hono<AppEnv>()
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
            optionalFields: p.optionalFields ?? [],
            keyUrl: p.keyUrl ?? null,
            keyScopes: p.keyScopes ?? null,
            // Sign-in at the provider (D-029): GitHub's is Pono's own sign-in.
            signIn:
              p.kind === 'code_host'
                ? `/auth/sign-in/${p.id}`
                : p.oauth
                  ? `/v1/connections/oauth/${p.id}`
                  : null,
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
        const optional = new Set(provider.optionalFields ?? []);
        const missing = provider.fields.filter((f) => !parsed.data.fields[f] && !optional.has(f));
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
        const row = await keep(deps, actor, provider, verified);
        return c.json({ connection: view(row) }, 201);
      })
      // Sign-in at the provider (D-029): out to its page, back with a code turned into a credential.
      .get('/oauth/:provider', async (c) => {
        const provider = byId.get(c.req.param('provider'));
        if (!provider?.oauth)
          throw new AppError('connection.no_sign_in', 404, 'This provider connects with a key.');
        const state = deps.sealer.seal(
          JSON.stringify({
            o: c.var.actor.organizationId,
            p: c.var.actor.personId,
            v: provider.id,
            e: Date.now() + STATE_MS,
          }),
        );
        const back = `${deps.publicUrl}/v1/connections/oauth/${provider.id}/callback`;
        return c.redirect(provider.oauth.authorizeUrl(state, back));
      })
      .get('/oauth/:provider/callback', async (c) => {
        const actor = c.var.actor;
        const provider = byId.get(c.req.param('provider'));
        const done = (outcome: string) =>
          c.redirect(`${deps.publicUrl}/connections?${outcome}=${provider?.id ?? 'unknown'}`);
        if (!provider?.oauth) return done('failed');
        const raw = deps.sealer.open(c.req.query('state') ?? '');
        const state = raw
          ? (JSON.parse(raw) as { o: string; p: string; v: string; e: number })
          : null;
        if (
          !state ||
          state.o !== actor.organizationId ||
          state.p !== actor.personId ||
          state.v !== provider.id ||
          state.e < Date.now()
        )
          return done('failed');
        const code = c.req.query('code');
        if (!code) return done('cancelled');
        try {
          const verified = await provider.oauth.exchange(
            code,
            `${deps.publicUrl}/v1/connections/oauth/${provider.id}/callback`,
          );
          await keep(deps, actor, provider, verified);
        } catch (error) {
          if (error instanceof AppError && error.code === 'connection.exists')
            return done('connected');
          return done('failed');
        }
        return done('connected');
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
      })
  );
}
