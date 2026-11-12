import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  call,
  PUBLIC_URL,
  signIn,
  testApp,
  type TestApp,
  type TestResponse,
} from './support/app.js';

let t: TestApp;
beforeAll(() => {
  t = testApp();
});
afterAll(async () => t.pool.end());

const req = (path: string, init?: RequestInit) =>
  Promise.resolve(t.app.request(path, init)) as Promise<TestResponse>;

async function project() {
  const cookie = await signIn(t, `v${randomUUID().slice(0, 8)}`);
  await call(t, cookie, '/v1/connections', {
    method: 'POST',
    body: { provider: 'code', fields: { token: 'good' } },
  });
  const name = `var-${randomUUID().slice(0, 6)}`;
  const fullName = `jc/${name}`;
  t.world.repositories.push({
    fullName,
    name,
    defaultBranch: 'main',
    url: '',
    private: true,
    pushedAt: null,
  });
  t.world.files.set(fullName, { 'pono.yaml': `version: 1\nname: ${name}\n` });
  const { id } = await (
    await call(t, cookie, '/v1/projects', { method: 'POST', body: { repository: fullName } })
  ).json();
  return { cookie, id: id as string };
}

async function agent(cookie: string, scope: 'read' | 'act' = 'act') {
  const { token } = await (
    await call(t, cookie, '/v1/agents', { method: 'POST', body: { name: 'Claude Code', scope } })
  ).json();
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${PUBLIC_URL}/mcp`), {
      fetch: (url, init) =>
        Promise.resolve(req(String(url).replace(PUBLIC_URL, ''), init as RequestInit)),
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

async function tool(client: Client, name: string, args: Record<string, unknown>) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { body: JSON.parse(res.content[0]!.text), error: res.isError === true };
}

describe('development variables (D-007, D-019)', () => {
  it('seals a value set by a person, sends it to the server only, and never shows it', async () => {
    const p = await project();
    const value = `dev-${randomBytes(8).toString('hex')}`;
    expect(
      (
        await call(t, p.cookie, `/v1/projects/${p.id}/variables/STRIPE_KEY`, {
          method: 'PUT',
          body: { value },
        })
      ).status,
    ).toBe(204);
    const list = await (await call(t, p.cookie, `/v1/projects/${p.id}/variables`)).json();
    expect(list.variables).toEqual([expect.objectContaining({ name: 'STRIPE_KEY', set: true })]);
    expect(JSON.stringify(list)).not.toContain(value);
    const res = await call(t, p.cookie, `/v1/projects/${p.id}/server`, {
      method: 'POST',
      body: { agent: 'claude-code' },
    });
    expect(res.status).toBe(201);
    const env = [...t.world.servers.values()].map((s) => s.env).find((e) => e.STRIPE_KEY === value);
    expect(env).toBeDefined();
    const detail = await (await call(t, p.cookie, `/v1/projects/${p.id}`)).json();
    expect(JSON.stringify(detail.journal)).not.toContain(value);
    const { rows } = await t.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM journal WHERE detail::text LIKE '%' || $1 || '%'",
      [value],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('refuses a PONO_ name, and lets an agent ask for a name, never set a value', async () => {
    const p = await project();
    expect(
      (
        await call(t, p.cookie, `/v1/projects/${p.id}/variables/PONO_PROJECT`, {
          method: 'PUT',
          body: { value: 'x' },
        })
      ).status,
    ).toBe(400);
    const client = await agent(p.cookie);
    const asked = await tool(client, 'request_variable', {
      projectId: p.id,
      name: 'RESEND_KEY',
      reason: 'The booking reminders send emails.',
    });
    expect(asked.body.requested).toBe('RESEND_KEY');
    const names = (await tool(client, 'list_variables', { projectId: p.id })).body;
    expect(names).toEqual([expect.objectContaining({ name: 'RESEND_KEY', set: false })]);
    const usage = await (await call(t, p.cookie, '/v1/usage')).json();
    expect(JSON.stringify(usage.alerts)).toContain('RESEND_KEY');
    await client.close();
  });

  it('checks files for secrets before a commit, without repeating the value', async () => {
    const p = await project();
    const client = await agent(p.cookie, 'read');
    const leaked = 'sk_live_' + 'b'.repeat(24);
    const found = await tool(client, 'check_secrets', {
      files: [
        { path: 'src/pay.ts', content: `export const key = '${leaked}';\n` },
        { path: 'src/ok.ts', content: 'export const key = process.env.STRIPE_KEY;\n' },
      ],
    });
    expect(found.body.clean).toBe(false);
    expect(found.body.findings[0]).toMatchObject({ file: 'src/pay.ts', line: 1 });
    expect(JSON.stringify(found.body)).not.toContain(leaked);
    await client.close();
  });
});

describe('OAuth 2.1 for MCP clients (D-019)', () => {
  it('registers a client, has a person approve it, and gives a token that opens /mcp', async () => {
    const meta = await (await req('/.well-known/oauth-authorization-server')).json();
    expect(meta.code_challenge_methods_supported).toEqual(['S256']);
    const unauth = await req('/mcp', { method: 'POST' });
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get('www-authenticate')).toContain(
      '/.well-known/oauth-protected-resource',
    );

    const redirect = 'https://claude.ai/api/mcp/auth_callback';
    const reg = await (
      await req('/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirect] }),
      })
    ).json();
    const verifier = randomBytes(32).toString('base64url');
    const query = {
      response_type: 'code',
      client_id: reg.client_id,
      redirect_uri: redirect,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      state: 'xyz',
      scope: 'read act',
    };
    const qs = new URLSearchParams(query).toString();

    const anonymous = await req(`/oauth/authorize?${qs}`);
    expect(anonymous.headers.get('location')).toContain('/?next=');
    const cookie = await signIn(t, `oa${randomUUID().slice(0, 6)}`);
    const signedIn = await req(`/oauth/authorize?${qs}`, { headers: { cookie } });
    expect(signedIn.headers.get('location')).toBe(`${PUBLIC_URL}/authorize?${qs}`);

    const decision = await (
      await call(t, cookie, '/oauth/decision', {
        method: 'POST',
        body: { approve: true, scope: 'read', query },
      })
    ).json();
    const back = new URL(decision.redirect);
    expect(back.origin + back.pathname).toBe(redirect);
    expect(back.searchParams.get('state')).toBe('xyz');
    const code = back.searchParams.get('code')!;

    const exchange = (verify: string) =>
      req('/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirect,
          client_id: reg.client_id,
          code_verifier: verify,
        }).toString(),
      });
    const wrong = await exchange('not-the-verifier-not-the-verifier-not-the-verifier');
    expect(wrong.status).toBe(400);
    // The code was spent by the failed attempt: a code is used once, whatever happens.
    const again = await exchange(verifier);
    expect((await again.json()).error).toBe('invalid_grant');
  });

  it('exchanges the code once for a token the console lists and cuts', async () => {
    const redirect = 'http://localhost:7777/callback';
    const reg = await (
      await req('/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_name: 'Local client', redirect_uris: [redirect] }),
      })
    ).json();
    const verifier = randomBytes(32).toString('base64url');
    const query = {
      response_type: 'code',
      client_id: reg.client_id,
      redirect_uri: redirect,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    };
    const cookie = await signIn(t, `ob${randomUUID().slice(0, 6)}`);
    const { redirect: to } = await (
      await call(t, cookie, '/oauth/decision', {
        method: 'POST',
        body: { approve: true, scope: 'act', query },
      })
    ).json();
    const res = await req('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: new URL(to).searchParams.get('code')!,
        redirect_uri: redirect,
        client_id: reg.client_id,
        code_verifier: verifier,
      }).toString(),
    });
    const token = await res.json();
    expect(token).toMatchObject({ token_type: 'Bearer', scope: 'act' });
    expect(token.access_token).toMatch(/^pono_/);
    const mcp = await req('/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token.access_token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(mcp.status).toBe(200);
    const listed = await (await call(t, cookie, '/v1/agents')).json();
    expect(listed.agents.map((a: { name: string }) => a.name)).toContain('Local client');

    const refused = await req('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }),
    });
    expect(refused.status).toBe(400);
  });
});

describe('rate limits', () => {
  it('answers 429 past the limit, with when to try again', async () => {
    const limited = createApp({ ...t.deps, rateLimits: { auth: 2, v1: 2, mcp: 2 } });
    const hit = () =>
      limited.request('/auth/providers', { headers: { 'x-forwarded-for': '203.0.113.9' } });
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    const third = await hit();
    expect(third.status).toBe(429);
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
