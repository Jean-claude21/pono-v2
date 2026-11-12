import { Hono, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { AppEnv } from '../../platform/context.js';
import { withOrganization, type Pool } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { hashToken, newToken, type Sealer } from '../../platform/secrets.js';
import { saveCodeHostConnection } from '../connections/index.js';
import { record } from '../journal/index.js';
import type { IdentityProvider } from './ports.js';

export type { IdentityProvider, SignedInPerson } from './ports.js';
export { devIdentity } from './infrastructure/dev.js';
export { githubIdentity } from './infrastructure/github.js';

export const SESSION_COOKIE = 'pono_session';
const STATE_COOKIE = 'pono_oauth_state';
const SESSION_DAYS = 30;

export interface IdentityDeps {
  pool: Pool;
  sealer: Sealer;
  /** The console's address: the browser's only origin; the console relays /auth and /v1. */
  publicUrl: string;
  secureCookies: boolean;
  identity: IdentityProvider[];
  now: () => Date;
}

/** Resolves the session cookie to an actor, or answers 401 `auth.required`. */
export function requireSession(deps: Pick<IdentityDeps, 'pool'>): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) throw new AppError('auth.required', 401, 'Sign in first.');
    const hash = hashToken(token);
    const { rows } = await deps.pool.query<{ id: string; login: string; name: string | null }>(
      'SELECT id, login, name FROM person_by_session($1)',
      [hash],
    );
    const person = rows[0];
    if (!person) throw new AppError('auth.required', 401, 'Sign in first.');
    const orgs = await deps.pool.query<{ id: string }>('SELECT id FROM organizations_of($1)', [
      person.id,
    ]);
    const organizationId = orgs.rows[0]?.id;
    if (!organizationId) throw new AppError('auth.required', 401, 'Sign in first.');
    c.set('actor', {
      personId: person.id,
      login: person.login,
      name: person.name,
      organizationId,
      channel: 'console',
    });
    c.set('sessionHash', hash);
    await next();
  };
}

/** `/auth/*`: sign in through a provider, come back, sign out (US1). */
export function authRoutes(deps: IdentityDeps): Hono<AppEnv> {
  const providers = new Map(deps.identity.map((p) => [p.id, p]));
  const redirectUri = (id: string) => `${deps.publicUrl}/auth/callback/${id}`;
  const cookieOptions = {
    httpOnly: true,
    secure: deps.secureCookies,
    sameSite: 'Lax',
    path: '/',
  } as const;

  return new Hono<AppEnv>()
    .get('/providers', (c) => c.json({ providers: deps.identity.map((p) => p.id) }))
    .get('/sign-in/:provider', (c) => {
      const provider = providers.get(c.req.param('provider'));
      if (!provider) throw new AppError('auth.unknown_provider', 404, 'No such sign-in.');
      const state = randomBytes(16).toString('base64url');
      setCookie(c, STATE_COOKIE, state, { ...cookieOptions, maxAge: 600 });
      return c.redirect(
        provider.authorizeUrl(state, redirectUri(provider.id), c.req.query('login')),
      );
    })
    .get('/callback/:provider', async (c) => {
      const provider = providers.get(c.req.param('provider'));
      if (!provider) throw new AppError('auth.unknown_provider', 404, 'No such sign-in.');
      const expected = getCookie(c, STATE_COOKIE);
      deleteCookie(c, STATE_COOKIE, { path: '/' });
      const { code, state } = c.req.query();
      if (!code || !state || state !== expected) {
        throw new AppError('auth.state_mismatch', 400, 'The sign-in did not start here.');
      }
      const signed = await provider.exchange(code, redirectUri(provider.id));
      const { rows } = await deps.pool.query<{ id: string }>(
        'SELECT upsert_person($1, $2, $3, $4) AS id',
        [signed.externalId, signed.login, signed.name, signed.email],
      );
      const personId = rows[0]!.id;
      const orgs = await deps.pool.query<{ id: string }>('SELECT id FROM organizations_of($1)', [
        personId,
      ]);
      let organizationId = orgs.rows[0]?.id;
      const firstTime = !organizationId;
      if (!organizationId) {
        const created = await deps.pool.query<{ id: string }>(
          'SELECT create_organization($1, $2) AS id',
          [(signed.name ?? signed.login).slice(0, 120), personId],
        );
        organizationId = created.rows[0]!.id;
      }
      await withOrganization(deps.pool, organizationId, async (client) => {
        if (firstTime) {
          await record(client, {
            organizationId: organizationId!,
            action: 'organization.created',
            actorPerson: personId,
            channel: 'console',
          });
        }
        if (signed.codeHostToken && provider.codeHostProvider) {
          await saveCodeHostConnection(client, deps.sealer, {
            organizationId: organizationId!,
            provider: provider.codeHostProvider,
            account: signed.login,
            token: signed.codeHostToken,
            personId,
          });
        }
      });
      const session = newToken();
      const expires = new Date(deps.now().getTime() + SESSION_DAYS * 86_400_000);
      await deps.pool.query('SELECT open_session($1, $2, $3)', [personId, session.hash, expires]);
      setCookie(c, SESSION_COOKIE, session.token, { ...cookieOptions, expires });
      return c.redirect(`${deps.publicUrl}/`);
    })
    .post('/sign-out', async (c) => {
      const token = getCookie(c, SESSION_COOKIE);
      if (token) await deps.pool.query('SELECT close_session($1)', [hashToken(token)]);
      deleteCookie(c, SESSION_COOKIE, { path: '/' });
      return c.body(null, 204);
    });
}

export const LEVELS = ['guided', 'choosing', 'expert'] as const;
export type Level = (typeof LEVELS)[number];

/** What an agent does at each level (D-015): the same words in the console and over MCP. */
export const LEVEL_GUIDANCE: Record<Level | 'unknown', string> = {
  guided:
    'The person wants it done for them: ask only about their need, in their words, never about technology. Choose the template on Pono’s base yourself, launch, and explain what you did in plain words.',
  choosing:
    'The person wants to choose a little: offer two or three templates and a few options (payment, accounts, database), in plain words, then launch what they pick.',
  expert:
    'The person knows what they do: their technology and their architecture come first. Offer adopt_project for an existing repository; Pono’s architecture and design skills stay off unless they turn them on.',
  unknown:
    'The person has not said how much they want to decide. Ask in one question whether they want you to handle everything, to choose among a few options, or to bring their own technology; save the answer with set_level.',
};

export async function levelOf(pool: Pool, personId: string): Promise<Level | null> {
  const { rows } = await pool.query<{ level: Level | null }>('SELECT person_level($1) AS level', [
    personId,
  ]);
  return rows[0]?.level ?? null;
}

export async function setLevel(pool: Pool, personId: string, level: Level): Promise<void> {
  await pool.query('SELECT set_person_level($1, $2)', [personId, level]);
}

/** `/v1/me`: who is signed in, where they act, and how much they want to decide. */
export function meRoutes(deps: Pick<IdentityDeps, 'pool'> & { admins?: string[] }): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .get('/', async (c) => {
      const actor = c.var.actor;
      const orgs = await deps.pool.query<{ id: string; name: string; role: string }>(
        'SELECT id, name, role FROM organizations_of($1)',
        [actor.personId],
      );
      return c.json({
        person: {
          id: actor.personId,
          login: actor.login,
          name: actor.name,
          level: await levelOf(deps.pool, actor.personId),
        },
        organization: orgs.rows.find((o) => o.id === actor.organizationId) ?? null,
        isAdmin: (deps.admins ?? []).includes(actor.login),
      });
    })
    .put('/level', async (c) => {
      const body = z
        .object({ level: z.enum(LEVELS) })
        .safeParse(await c.req.json().catch(() => null));
      if (!body.success)
        throw new AppError('request.invalid', 400, 'Expected guided, choosing or expert.');
      await setLevel(deps.pool, c.var.actor.personId, body.data.level);
      return c.body(null, 204);
    });
}
