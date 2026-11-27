import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CYCLE_MINUTES,
  runCycle,
  untilNextTick,
  type Notifier,
} from '../src/features/operations/index.js';
import { serversUsage } from '../src/features/servers/index.js';
import { coolifyHosting, coolifyStatus } from '../src/infrastructure/providers/coolify.js';
import { call, signIn, testApp, type TestApp } from './support/app.js';

let t: TestApp;
const sent: { to: string[]; subject: string; text: string }[] = [];
const notifier: Notifier = { id: 'mail', send: async (m) => void sent.push(m) };
beforeAll(() => {
  t = testApp();
});
afterAll(async () => t.pool.end());

const cycle = (orgs: string[]) =>
  runCycle(
    { ...t.deps, internalUsage: [serversUsage()], notifier, publicUrl: 'http://console.test' },
    orgs,
  );

/** A project in the automatic mode whose last change Pono merged by itself. */
async function autoMerged() {
  const login = `o${randomUUID().slice(0, 8)}`;
  const cookie = await signIn(t, login);
  for (const provider of ['code', 'host'])
    await call(t, cookie, '/v1/connections', {
      method: 'POST',
      body: { provider, fields: { token: 'good' } },
    });
  const name = `ops-${randomUUID().slice(0, 6)}`;
  const fullName = `jc/${name}`;
  const url = `https://${name}.test`;
  t.world.repositories.push({
    fullName,
    name,
    defaultBranch: 'main',
    url: '',
    private: false,
    pushedAt: null,
  });
  t.world.sites.set(`site-${name}`, {
    ref: `site-${name}`,
    repository: fullName,
    productionUrl: url,
    productionBranch: 'main',
    updatedAt: null,
  });
  const sha = randomUUID().replace(/-/g, '').slice(0, 12);
  t.world.proposals.set(fullName, [
    {
      number: 3,
      title: 'Notes',
      headSha: sha,
      branch: 'dev',
      url: `https://code.test/${fullName}/pull/3`,
    },
  ]);
  t.world.proposalFiles.set(`${fullName}#3`, [
    {
      path: 'src/notes.ts',
      status: 'added',
      patch: '@@ -0,0 +1 @@\n+export const n = 1;',
      binary: false,
    },
  ]);
  t.world.deployments.set(`site-${name}`, [
    {
      externalId: `p-${sha}`,
      environment: 'preview',
      status: 'succeeded',
      url: null,
      commitSha: sha,
      createdAt: new Date(),
    },
  ]);
  const { id } = await (
    await call(t, cookie, '/v1/projects', { method: 'POST', body: { repository: fullName } })
  ).json();
  await call(t, cookie, `/v1/projects/${id}/release-mode`, {
    method: 'PUT',
    body: { mode: 'auto' },
  });
  const { releases } = await (
    await call(t, cookie, `/v1/projects/${id}/releases/evaluate`, { method: 'POST' })
  ).json();
  expect(releases[0].status).toBe('merged');
  const me = await (await call(t, cookie, '/v1/me')).json();
  return { cookie, id, url, site: `site-${name}`, org: me.organization.id as string, login };
}

describe('Pono’s periodic task (D-018)', () => {
  it('rolls back once when production stops answering after an automatic merge, and says so', async () => {
    const p = await autoMerged();
    t.world.links.set(p.url, 'down');
    const report = await cycle([p.org]);
    expect(report).toMatchObject({ organizations: 1, rolledBack: 1 });
    expect(t.world.rollbacks).toContain(p.site);
    const detail = await (await call(t, p.cookie, `/v1/projects/${p.id}`)).json();
    const entry = detail.journal.find(
      (j: { action: string }) => j.action === 'release.auto_rolled_back',
    );
    expect(entry.channel).toBe('system');
    expect(sent.at(-1)!.to).toEqual([`${p.login}@dev.pono.test`]);
    expect(sent.at(-1)!.text).toContain('http://console.test/usage');

    const again = await cycle([p.org]);
    expect(again.rolledBack).toBe(0);
    expect(t.world.rollbacks.filter((r) => r === p.site)).toHaveLength(1);
  });

  it('never rolls back a change a person merged, nor in the ask mode', async () => {
    const p = await autoMerged();
    await call(t, p.cookie, `/v1/projects/${p.id}/release-mode`, {
      method: 'PUT',
      body: { mode: 'ask' },
    });
    t.world.links.set(p.url, 'down');
    expect((await cycle([p.org])).rolledBack).toBe(0);
    expect(t.world.rollbacks).not.toContain(p.site);
  });

  it('reads a healthy workshop again without rolling anything back', async () => {
    const p = await autoMerged();
    const report = await cycle([p.org]);
    expect(report).toMatchObject({ organizations: 1, projects: 1, rolledBack: 0 });
    // The periodic reading journals a refresh only when something changed (D-038).
    const systemRefreshes = async () =>
      (await (await call(t, p.cookie, `/v1/projects/${p.id}`)).json()).journal.filter(
        (j: { action: string; channel: string }) =>
          j.action === 'project.refreshed' && j.channel === 'system',
      ).length;
    const before = await systemRefreshes();
    await cycle([p.org]);
    expect(await systemRefreshes()).toBe(before);
    t.world.links.set(p.url, 'down');
    await cycle([p.org]);
    expect(await systemRefreshes()).toBe(before + 1);
  });
});

describe('Coolify (D-018)', () => {
  const recorded = (calls: { url: string; method: string; body?: string }[]) =>
    (async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        ...(init?.body ? { body: String(init.body) } : {}),
      });
      const path = new URL(url).pathname;
      if (path === '/api/v1/applications')
        return new Response(
          JSON.stringify([
            {
              uuid: 'a1',
              name: 'api',
              git_repository: 'jc/go-api',
              git_branch: 'main',
              fqdn: 'https://api.go.test,https://www.go.test',
            },
            {
              uuid: 'a2',
              name: 'other',
              git_repository: 'https://github.com/jc/other.git',
              git_branch: 'main',
              fqdn: null,
            },
          ]),
        );
      if (path === '/api/v1/deployments/applications/a1')
        return new Response(
          JSON.stringify({
            count: 3,
            deployments: [
              {
                deployment_uuid: 'd3',
                status: 'finished',
                commit: 'ccc',
                created_at: '2026-11-12T10:00:00Z',
              },
              {
                deployment_uuid: 'd2',
                status: 'failed',
                commit: 'bbb',
                created_at: '2026-11-12T09:00:00Z',
              },
              {
                deployment_uuid: 'd1',
                status: 'finished',
                commit: 'aaa',
                created_at: '2026-11-11T09:00:00Z',
              },
            ],
          }),
        );
      return new Response('{}');
    }) as typeof fetch;

  it('finds the application of a repository, reads its deployments, and rolls back by pinning', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const coolify = coolifyHosting(recorded(calls));
    const v = await coolify.verify({ url: 'https://coolify.example.org/', token: 'tok' });
    expect(v.account).toBe('coolify.example.org · 2 apps');
    const repo = {
      fullName: 'jc/go-api',
      name: 'go-api',
      defaultBranch: 'main',
      url: '',
      private: true,
      pushedAt: null,
    };
    const site = await coolify.findSite(v.credential, repo);
    expect(site).toMatchObject({ ref: 'a1', productionUrl: 'https://api.go.test' });
    const deployments = await coolify.deployments(v.credential, 'a1');
    expect(deployments.map((d) => d.status)).toEqual(['succeeded', 'failed', 'succeeded']);
    await coolify.rollback(v.credential, 'a1');
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(JSON.parse(patch.body!)).toEqual({ git_commit_sha: 'aaa' });
    expect(calls.at(-1)!.url).toContain('/api/v1/deploy?uuid=a1');
    await expect(coolify.verify({ url: 'http://coolify.example.org', token: 'x' })).rejects.toThrow(
      /https/,
    );
    expect(coolifyStatus('cancelled-by-user')).toBe('cancelled');
  });
});

describe('the hourly cycle (D-047)', () => {
  it('falls on the hour, so several jobs share one wake-up of the database', () => {
    expect(untilNextTick(new Date('2026-11-27T10:59:00Z'))).toBe(60_000);
    expect(untilNextTick(new Date('2026-11-27T10:00:00Z'))).toBe(3_600_000);
    expect(untilNextTick(new Date('2026-11-27T10:30:30Z'))).toBe(29.5 * 60_000);
    expect(CYCLE_MINUTES).toBeGreaterThanOrEqual(60);
  });
});
