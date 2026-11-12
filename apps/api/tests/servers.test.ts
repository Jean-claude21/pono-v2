import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { estimatedMonthToDate } from '../src/features/servers/domain.js';
import { withOrganization } from '../src/platform/db.js';
import { call, signIn, testApp, type TestApp } from './support/app.js';

let t: TestApp;
beforeAll(() => {
  t = testApp();
});
afterAll(async () => t.pool.end());

/** A workshop with its code host and `count` imported projects; returns the cookie and the ids. */
async function workshop(
  count: number,
  plan: 'free' | 'solo' | 'pro' = 'free',
): Promise<{ cookie: string; projects: string[]; org: string }> {
  const cookie = await signIn(t, `s${randomUUID().slice(0, 8)}`);
  await call(t, cookie, '/v1/connections', {
    method: 'POST',
    body: { provider: 'code', fields: { token: 'good' } },
  });
  const org = (await (await call(t, cookie, '/v1/me')).json()).organization.id as string;
  await withOrganization(t.pool, org, (client) =>
    client.query('UPDATE organizations SET plan = $1', [plan]),
  );
  const projects: string[] = [];
  for (let i = 0; i < count; i++) {
    const name = `p${randomUUID().slice(0, 6)}`;
    t.world.repositories.push({
      fullName: `jc/${name}`,
      name,
      defaultBranch: 'main',
      url: '',
      private: true,
      pushedAt: null,
    });
    projects.push(
      (
        await (
          await call(t, cookie, '/v1/projects', {
            method: 'POST',
            body: { repository: `jc/${name}` },
          })
        ).json()
      ).id,
    );
  }
  return { cookie, projects, org };
}

describe('project servers (D-004)', () => {
  it('gives a project its server, with the project and no production key in its variables', async () => {
    const { cookie, projects } = await workshop(1);
    const res = await call(t, cookie, `/v1/projects/${projects[0]}/server`, {
      method: 'POST',
      body: { agent: 'claude-code' },
    });
    expect(res.status).toBe(201);
    const { server } = await res.json();
    expect(server).toMatchObject({
      status: 'running',
      agent: 'claude-code',
      monthlyMicros: 4_760_000,
    });
    const hosted = [...t.world.servers.values()].at(-1)!;
    expect(Object.keys(hosted.env)).toEqual(['PONO_PROJECT']);
    const list = await (await call(t, cookie, '/v1/servers')).json();
    expect(list).toMatchObject({ plan: 'free', limit: 1, active: 1 });
  });

  it('refuses a second active server on the free plan, and names the one that holds the place', async () => {
    const { cookie, projects } = await workshop(2);
    await call(t, cookie, `/v1/projects/${projects[0]}/server`, { method: 'POST', body: {} });
    const res = await call(t, cookie, `/v1/projects/${projects[1]}/server`, {
      method: 'POST',
      body: {},
    });
    expect(res.status).toBe(409);
    const { error } = await res.json();
    expect(error.code).toBe('servers.limit_reached');
    expect(error.detail.active).toHaveLength(1);
  });

  it('puts the chosen server to sleep first, then gives the place', async () => {
    const { cookie, projects } = await workshop(2);
    const first = (
      await (
        await call(t, cookie, `/v1/projects/${projects[0]}/server`, { method: 'POST', body: {} })
      ).json()
    ).server;
    const res = await call(t, cookie, `/v1/projects/${projects[1]}/server`, {
      method: 'POST',
      body: { sleepServerId: first.id },
    });
    expect(res.status).toBe(201);
    const list = await (await call(t, cookie, '/v1/servers')).json();
    expect(list.servers.map((s: { status: string }) => s.status).sort()).toEqual([
      'running',
      'sleeping',
    ]);
  });

  it('does not count sleeping servers, and refuses to wake one past the limit', async () => {
    const { cookie, projects } = await workshop(2, 'free');
    const a = (
      await (
        await call(t, cookie, `/v1/projects/${projects[0]}/server`, { method: 'POST', body: {} })
      ).json()
    ).server;
    await call(t, cookie, `/v1/servers/${a.id}/sleep`, { method: 'POST' });
    const b = (
      await (
        await call(t, cookie, `/v1/projects/${projects[1]}/server`, { method: 'POST', body: {} })
      ).json()
    ).server;
    expect(b.status).toBe('running');
    const wake = await call(t, cookie, `/v1/servers/${a.id}/wake`, { method: 'POST', body: {} });
    expect(wake.status).toBe(409);
    expect(
      (
        await call(t, cookie, `/v1/servers/${a.id}/wake`, {
          method: 'POST',
          body: { sleepServerId: b.id },
        })
      ).status,
    ).toBe(204);
  });

  it('allows three active servers on the Solo plan', async () => {
    const { cookie, projects } = await workshop(4, 'solo');
    for (const p of projects.slice(0, 3))
      expect(
        (await call(t, cookie, `/v1/projects/${p}/server`, { method: 'POST', body: {} })).status,
      ).toBe(201);
    expect(
      (await call(t, cookie, `/v1/projects/${projects[3]}/server`, { method: 'POST', body: {} }))
        .status,
    ).toBe(409);
  });

  it('follows the host: a server that fell asleep there is shown asleep', async () => {
    const { cookie, projects } = await workshop(1);
    const s = (
      await (
        await call(t, cookie, `/v1/projects/${projects[0]}/server`, { method: 'POST', body: {} })
      ).json()
    ).server;
    const hosted = [...t.world.servers.values()].at(-1)!;
    hosted.status = 'sleeping';
    const list = await (await call(t, cookie, '/v1/servers')).json();
    expect(list.servers.find((x: { id: string }) => x.id === s.id).status).toBe('sleeping');
    expect(list.active).toBe(0);
  });

  it('releases a server at the host, and journals every gesture', async () => {
    const { cookie, projects, org } = await workshop(1);
    const s = (
      await (
        await call(t, cookie, `/v1/projects/${projects[0]}/server`, { method: 'POST', body: {} })
      ).json()
    ).server;
    const before = t.world.servers.size;
    expect((await call(t, cookie, `/v1/servers/${s.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(t.world.servers.size).toBe(before - 1);
    expect((await (await call(t, cookie, '/v1/servers')).json()).servers).toEqual([]);
    const actions = await withOrganization(t.pool, org, async (c) =>
      (
        await c.query("SELECT action FROM journal WHERE action LIKE 'server.%' ORDER BY id")
      ).rows.map((r) => r.action),
    );
    expect(actions).toEqual(['server.allocated', 'server.released']);
  });

  it('counts each server in the month as an estimate', async () => {
    const { cookie, projects } = await workshop(1);
    await call(t, cookie, `/v1/projects/${projects[0]}/server`, { method: 'POST', body: {} });
    await call(t, cookie, '/v1/usage/refresh', { method: 'POST' });
    const usage = await (await call(t, cookie, '/v1/usage')).json();
    const servers = usage.readings.filter((r: { meter: string }) => r.meter === 'servers.compute');
    expect(servers).toHaveLength(1);
    expect(servers[0].source).toBe('estimated');
    expect(usage.total.bySource.estimated).toBeGreaterThan(0);
  });

  it('estimates half a month at mid-month', () => {
    expect(estimatedMonthToDate(3_000_000, new Date('2026-11-16T00:00:00Z'))).toBe(1_500_000);
  });
});
