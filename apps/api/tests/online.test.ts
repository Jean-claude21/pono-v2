import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, signIn, testApp, type TestApp } from './support/app.js';

let t: TestApp;
beforeAll(() => {
  t = testApp();
});
afterAll(async () => t.pool.end());

async function launched(hosting: boolean, name = `on-${randomUUID().slice(0, 6)}`) {
  const cookie = await signIn(t, `o${randomUUID().slice(0, 8)}`);
  await call(t, cookie, '/v1/connections', {
    method: 'POST',
    body: { provider: 'code', fields: { token: 'good' } },
  });
  if (hosting)
    await call(t, cookie, '/v1/connections', {
      method: 'POST',
      body: { provider: 'host', fields: { token: 'good' } },
    });
  const res = await call(t, cookie, '/v1/launch', {
    method: 'POST',
    body: { template: 'site', name },
  });
  const { projectId } = await res.json();
  return { cookie, projectId: projectId as string, name };
}

describe('putting a project online (D-037)', () => {
  it('creates the site, lends it a read-only key and a push hook, starts the build, once', async () => {
    const p = await launched(true);
    const res = await call(t, p.cookie, `/v1/projects/${p.projectId}/online`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ created: true, provider: 'host' });
    expect(body.productionUrl).toMatch(/\.host\.test$/);
    expect(t.world.keys.some((k) => k.includes(p.name))).toBe(true);
    expect(t.world.hooks.some((h) => h.includes(p.name))).toBe(true);
    const project = await (await call(t, p.cookie, `/v1/projects/${p.projectId}`)).json();
    expect(project.project?.productionUrl ?? project.productionUrl).toBe(body.productionUrl);

    const again = await (
      await call(t, p.cookie, `/v1/projects/${p.projectId}/online`, { method: 'POST' })
    ).json();
    expect(again).toMatchObject({ created: false, productionUrl: body.productionUrl });
  });

  it('takes another name when the first one is taken at the host', async () => {
    const p = await launched(true);
    // Someone else's site already holds the repository's name at the host.
    t.world.sites.set(p.name, {
      ref: p.name,
      productionUrl: `https://${p.name}.host.test`,
      productionBranch: 'main',
      updatedAt: null,
      repository: 'someone/else',
    });
    const res = await call(t, p.cookie, `/v1/projects/${p.projectId}/online`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await res.json()).productionUrl).not.toBe(`https://${p.name}.host.test`);
  });

  it('says what is missing: no hosting connected, or a code host that refuses the key', async () => {
    const p = await launched(false);
    const res = await call(t, p.cookie, `/v1/projects/${p.projectId}/online`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('release.no_hosting');

    const locked = await launched(true, `locked-${randomUUID().slice(0, 4)}`);
    const refused = await call(t, locked.cookie, `/v1/projects/${locked.projectId}/online`, {
      method: 'POST',
    });
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.code).toBe('code_host.permission_missing');
  });
});

describe('a launch from a starter (D-036)', () => {
  it("writes Pono's manifest and keeps how the starter runs on its server", async () => {
    t.world.files.set('kete-africa/pono-starter-site', {
      'pono.yaml': 'version: 1\nname: site\ndev:\n  command: npx --yes pnpm@10 dev\n  port: 3000\n',
      'package.json': '{}',
    });
    const p = await launched(false);
    const files = t.world.files.get(`jc/${p.name}`)!;
    expect(files['pono.yaml']).toContain('template: site');
    expect(files['pono.yaml']).toContain('command: npx --yes pnpm@10 dev');
    expect(files['pono.yaml']).toContain('port: 3000');
  });
});
