import { createHash, randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AppEnv } from '../../platform/context.js';
import { withOrganization, type Pool } from '../../platform/db.js';
import { AppError, errorBody } from '../../platform/errors.js';
import { hashToken, newToken } from '../../platform/secrets.js';
import { SESSION_COOKIE } from '../identity/index.js';
import { record } from '../journal/index.js';

/**
 * OAuth 2.1 for MCP clients (D-019), as the Claude.ai connector expects: protected-resource and
 * authorization-server metadata, dynamic registration of public clients, authorization code with
 * PKCE (S256 only), approval by a person in the console. The grant is an agent token: listed and
 * cut in the console like any other.
 */
export interface OAuthDeps {
  pool: Pool;
  publicUrl: string;
}

const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

/** https anywhere; http only on the person's own machine (native and CLI clients). */
const redirectUri = z
  .string()
  .max(500)
  .refine((u) => {
    try {
      const url = new URL(u);
      if (url.hash) return false;
      return (
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      );
    } catch {
      return false;
    }
  }, 'https, or http on localhost');

const authorizeQuery = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1).max(100),
  redirect_uri: redirectUri,
  code_challenge: z.string().regex(/^[\w-]{43,128}$/),
  code_challenge_method: z.literal('S256'),
  state: z.string().max(500).optional(),
  scope: z.string().max(100).optional(),
  resource: z.string().max(500).optional(),
});

async function client(pool: Pool, id: string) {
  const { rows } = await pool.query<{ id: string; name: string; redirect_uris: string[] }>(
    'SELECT * FROM oauth_client($1)',
    [id],
  );
  return rows[0] ?? null;
}

async function personOf(pool: Pool, sessionToken: string | undefined) {
  if (!sessionToken) return null;
  const { rows } = await pool.query<{ id: string; login: string }>(
    'SELECT id, login FROM person_by_session($1)',
    [hashToken(sessionToken)],
  );
  const person = rows[0];
  if (!person) return null;
  const orgs = await pool.query<{ id: string }>('SELECT id FROM organizations_of($1)', [person.id]);
  return orgs.rows[0] ? { ...person, organizationId: orgs.rows[0].id } : null;
}

const oauthError = (error: string, description: string, status: 400 | 401 = 400) =>
  new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/** Where an MCP client learns how to get a token (RFC 9728, RFC 8414). */
export function oauthMetadata(deps: OAuthDeps): Hono<AppEnv> {
  const issuer = deps.publicUrl;
  return new Hono<AppEnv>()
    .get('/oauth-protected-resource', (c) =>
      c.json({
        resource: `${issuer}/mcp`,
        authorization_servers: [issuer],
        scopes_supported: ['read', 'act'],
        bearer_methods_supported: ['header'],
      }),
    )
    .get('/oauth-protected-resource/mcp', (c) =>
      c.json({
        resource: `${issuer}/mcp`,
        authorization_servers: [issuer],
        scopes_supported: ['read', 'act'],
      }),
    )
    .get('/oauth-authorization-server', (c) =>
      c.json({
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        registration_endpoint: `${issuer}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['read', 'act'],
      }),
    );
}

export function oauthRoutes(deps: OAuthDeps): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .post('/register', async (c) => {
      const body = z
        .object({
          client_name: z.string().trim().min(1).max(100).default('MCP client'),
          redirect_uris: z.array(redirectUri).min(1).max(10),
        })
        .safeParse(await c.req.json().catch(() => null));
      if (!body.success)
        return oauthError('invalid_client_metadata', 'redirect_uris: https, or http on localhost.');
      const id = `pono-client-${randomBytes(12).toString('base64url')}`;
      await deps.pool.query('SELECT oauth_register($1, $2, $3)', [
        id,
        body.data.client_name,
        body.data.redirect_uris,
      ]);
      return c.json(
        {
          client_id: id,
          client_name: body.data.client_name,
          redirect_uris: body.data.redirect_uris,
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        },
        201,
      );
    })
    .get('/authorize', async (c) => {
      const query = authorizeQuery.safeParse(c.req.query());
      if (!query.success)
        return oauthError(
          'invalid_request',
          'Missing or invalid parameters (PKCE S256 is required).',
        );
      const known = await client(deps.pool, query.data.client_id);
      // An unknown client or redirect is never redirected to: the error is shown here (RFC 6749 4.1.2.1).
      if (!known || !known.redirect_uris.includes(query.data.redirect_uri))
        return oauthError('invalid_client', 'Unknown client or redirect address.');
      const here = `/oauth/authorize?${new URLSearchParams(c.req.query()).toString()}`;
      const person = await personOf(deps.pool, getCookie(c, SESSION_COOKIE));
      if (!person) return c.redirect(`${deps.publicUrl}/?next=${encodeURIComponent(here)}`);
      return c.redirect(
        `${deps.publicUrl}/authorize?${new URLSearchParams(c.req.query()).toString()}`,
      );
    })
    .get('/client', async (c) => {
      const known = await client(deps.pool, c.req.query('client_id') ?? '');
      if (!known) throw new AppError('oauth.unknown_client', 404, 'Unknown client.');
      return c.json({ name: known.name });
    })
    .post('/decision', async (c) => {
      const person = await personOf(deps.pool, getCookie(c, SESSION_COOKIE));
      if (!person) throw new AppError('auth.required', 401, 'Sign in first.');
      const body = z
        .object({
          approve: z.boolean(),
          scope: z.enum(['read', 'act']),
          query: z.record(z.string(), z.string()),
        })
        .safeParse(await c.req.json().catch(() => null));
      if (!body.success) throw new AppError('request.invalid', 400, 'Expected the decision.');
      const query = authorizeQuery.safeParse(body.data.query);
      if (!query.success)
        throw new AppError('request.invalid', 400, 'Invalid authorization request.');
      const known = await client(deps.pool, query.data.client_id);
      if (!known || !known.redirect_uris.includes(query.data.redirect_uri))
        throw new AppError('oauth.unknown_client', 404, 'Unknown client.');
      const back = new URL(query.data.redirect_uri);
      if (query.data.state) back.searchParams.set('state', query.data.state);
      if (!body.data.approve) {
        back.searchParams.set('error', 'access_denied');
        return c.json({ redirect: back.toString() });
      }
      const code = randomBytes(32).toString('base64url');
      await deps.pool.query('SELECT oauth_issue_code($1, $2, $3, $4, $5, $6, $7)', [
        hashToken(code),
        known.id,
        person.organizationId,
        person.id,
        query.data.redirect_uri,
        query.data.code_challenge,
        body.data.scope,
      ]);
      await withOrganization(deps.pool, person.organizationId, (cl) =>
        record(cl, {
          organizationId: person.organizationId,
          action: 'agent.granted',
          actorPerson: person.id,
          channel: 'console',
          detail: { name: known.name, scope: body.data.scope, via: 'oauth' },
        }),
      );
      back.searchParams.set('code', code);
      return c.json({ redirect: back.toString() });
    })
    .post('/token', async (c) => {
      const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
      const get = (k: string) => (typeof form[k] === 'string' ? (form[k] as string) : '');
      if (get('grant_type') !== 'authorization_code')
        return oauthError('unsupported_grant_type', 'Only authorization_code.');
      const { rows } = await deps.pool.query<{
        client_id: string;
        organization_id: string;
        person_id: string;
        redirect_uri: string;
        code_challenge: string;
        scope: 'read' | 'act';
      }>('SELECT * FROM oauth_redeem_code($1)', [hashToken(get('code'))]);
      const grant = rows[0];
      if (
        !grant ||
        grant.client_id !== get('client_id') ||
        grant.redirect_uri !== get('redirect_uri') ||
        s256(get('code_verifier')) !== grant.code_challenge
      )
        return oauthError(
          'invalid_grant',
          'The code is unknown, used, expired, or does not match.',
        );
      const known = await client(deps.pool, grant.client_id);
      const { token, hash } = newToken();
      await withOrganization(deps.pool, grant.organization_id, (cl) =>
        cl.query(
          'INSERT INTO agent_tokens (organization_id, person_id, name, scope, token_hash) VALUES ($1, $2, $3, $4, $5)',
          [
            grant.organization_id,
            grant.person_id,
            (known?.name ?? 'MCP client').slice(0, 60),
            grant.scope,
            hash,
          ],
        ),
      );
      return new Response(
        JSON.stringify({ access_token: `pono_${token}`, token_type: 'Bearer', scope: grant.scope }),
        {
          status: 200,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        },
      );
    });
}

/** What `/mcp` answers without a token: where to get one. */
export function mcpUnauthorized(publicUrl: string): Response {
  return new Response(JSON.stringify(errorBody('auth.required', 'An agent token is required.')), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'www-authenticate': `Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource"`,
    },
  });
}
