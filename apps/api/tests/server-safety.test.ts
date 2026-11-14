import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blockedByNetwork, networkInput, networkPolicy } from '../src/features/servers/index.js';
import { networkBody } from '../src/infrastructure/providers/agent37.js';
import { call, signIn, testApp, type TestApp } from './support/app.js';

let t: TestApp;
beforeAll(() => {
  t = testApp();
});
afterAll(async () => t.pool.end());

async function project() {
  const cookie = await signIn(t, `s${randomUUID().slice(0, 8)}`);
  await call(t, cookie, '/v1/connections', {
    method: 'POST',
    body: { provider: 'code', fields: { token: 'good' } },
  });
  const name = `safe-${randomUUID().slice(0, 6)}`;
  t.world.repositories.push({
    fullName: `jc/${name}`,
    name,
    defaultBranch: 'main',
    url: '',
    private: true,
    pushedAt: null,
  });
  t.world.files.set(`jc/${name}`, { 'pono.yaml': `version: 1\nname: ${name}\n` });
  const { id } = await (
    await call(t, cookie, '/v1/projects', { method: 'POST', body: { repository: `jc/${name}` } })
  ).json();
  return { cookie, id: id as string };
}

async function withServer() {
  const p = await project();
  const { server } = await (
    await call(t, p.cookie, `/v1/projects/${p.id}/server`, {
      method: 'POST',
      body: { agent: 'claude-code' },
    })
  ).json();
  const externalId = [...t.world.servers.keys()].pop()!;
  return { ...p, serverId: server.id as string, externalId };
}

describe('the network of a project server (D-031)', () => {
  it('reads domains and IPv4 only, as the person wrote them or pasted a link', () => {
    const ok = networkInput.parse({
      mode: 'limited',
      extra: ['https://API.Stripe.com/v1', '*.supabase.co', '203.0.113.0/24'],
    });
    expect(ok.extra).toEqual(['api.stripe.com', '*.supabase.co', '203.0.113.0/24']);
    expect(networkInput.safeParse({ mode: 'limited', extra: ['not a domain'] }).success).toBe(
      false,
    );
    expect(networkInput.safeParse({ mode: 'limited', extra: ['a.*.com'] }).success).toBe(false);
    expect(networkPolicy('open', ['a.com'], [], [])).toBe('open');
    expect(networkPolicy('limited', ['a.com'], ['b.com'], ['a.com', 'c.com'])).toEqual({
      allow: ['a.com', 'b.com', 'c.com'],
    });
    expect(networkBody('open')).toBe('allow-all');
    expect(networkBody('closed')).toBe('deny-all');
    expect(networkBody({ allow: ['GitHub.com', 'github.com'] })).toEqual({ allow: ['github.com'] });
    expect(blockedByNetwork('Error: ERR_SSL_TLSV1_ALERT_ACCESS_DENIED')).toBe(true);
    expect(blockedByNetwork('npm ERR! 404')).toBe(false);
  });

  it('is open by default; limited, the server reaches the registries, its services and what the person added', async () => {
    const p = await withServer();
    const first = await (await call(t, p.cookie, `/v1/projects/${p.id}/network`)).json();
    expect(first).toMatchObject({ mode: 'open', extra: [], enforced: true });
    expect(first.base).toEqual(['registry.npmjs.org', 'api.servers.test']);
    expect(first.services).toEqual([{ provider: 'code', domains: ['code.test'] }]);

    const set = await call(t, p.cookie, `/v1/projects/${p.id}/network`, {
      method: 'PUT',
      body: { mode: 'limited', extra: ['api.stripe.com'] },
    });
    expect(set.status).toBe(200);
    expect(t.world.network.get(p.externalId)).toEqual({
      allow: ['registry.npmjs.org', 'api.servers.test', 'code.test', 'api.stripe.com'],
    });
    await call(t, p.cookie, `/v1/projects/${p.id}/network`, {
      method: 'PUT',
      body: { mode: 'open', extra: ['api.stripe.com'] },
    });
    expect(t.world.network.get(p.externalId)).toBe('open');
    const bad = await call(t, p.cookie, `/v1/projects/${p.id}/network`, {
      method: 'PUT',
      body: { mode: 'limited', extra: ['http://'] },
    });
    expect(bad.status).toBe(400);
  });

  it('keeps a limited network on a server given later', async () => {
    const p = await project();
    await call(t, p.cookie, `/v1/projects/${p.id}/network`, {
      method: 'PUT',
      body: { mode: 'limited', extra: [] },
    });
    await call(t, p.cookie, `/v1/projects/${p.id}/server`, {
      method: 'POST',
      body: { agent: 'none' },
    });
    const externalId = [...t.world.servers.keys()].pop()!;
    expect(t.world.network.get(externalId)).toMatchObject({ allow: expect.any(Array) });
  });
});

describe('restore points of a project server (D-031)', () => {
  it('takes one on demand, refuses a second within 15 minutes, lists them newest first', async () => {
    const p = await withServer();
    const made = await call(t, p.cookie, `/v1/servers/${p.serverId}/backups`, { method: 'POST' });
    expect(made.status).toBe(201);
    const backup = await made.json();
    expect(backup).toMatchObject({ kind: 'manual' });
    const again = await call(t, p.cookie, `/v1/servers/${p.serverId}/backups`, { method: 'POST' });
    expect(again.status).toBe(429);
    expect((await again.json()).error.code).toBe('server.backup_too_soon');
    const listed = await (await call(t, p.cookie, `/v1/servers/${p.serverId}/backups`)).json();
    expect(listed).toMatchObject({ restoring: false, backups: [{ id: backup.id }] });
  });

  it('restores only a known backup, in the background, and the dev server must start again', async () => {
    const p = await withServer();
    const backup = await (
      await call(t, p.cookie, `/v1/servers/${p.serverId}/backups`, { method: 'POST' })
    ).json();
    const unknown = await call(t, p.cookie, `/v1/servers/${p.serverId}/restore`, {
      method: 'POST',
      body: { backup: 'nothing-here' },
    });
    expect(unknown.status).toBe(404);
    const res = await call(t, p.cookie, `/v1/servers/${p.serverId}/restore`, {
      method: 'POST',
      body: { backup: backup.id },
    });
    expect(res.status).toBe(202);
    for (let i = 0; i < 20 && !t.world.restored.includes(`${p.externalId}:${backup.id}`); i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(t.world.restored).toContain(`${p.externalId}:${backup.id}`);
  });

  it("refuses another person's server", async () => {
    const p = await withServer();
    const other = await signIn(t, `o${randomUUID().slice(0, 8)}`);
    const res = await call(t, other, `/v1/servers/${p.serverId}/backups`);
    expect(res.status).toBe(404);
  });
});
