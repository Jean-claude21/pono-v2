import { describe, expect, it } from 'vitest';
import { decodeVercel, vercelHosting } from '../src/infrastructure/providers/vercel.js';

/** A Vercel that answers what the adapter asks, and keeps every call. */
function fakeVercel() {
  const calls: { method: string; url: URL; body: unknown; auth: string | null }[] = [];
  const project = {
    id: 'prj_1',
    name: 'shop',
    updatedAt: 1_700_000_000_000,
    link: { type: 'github', org: 'Jc', repo: 'Shop', productionBranch: 'main' },
    targets: { production: { alias: ['shop-jc.vercel.app'] } },
  };
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({
      method,
      url,
      body,
      auth: new Headers(init?.headers).get('authorization'),
    });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (url.pathname === '/v2/user')
      return json({ user: { name: 'Ada', username: 'ada', defaultTeamId: 'team_9' } });
    if (url.pathname === '/v10/projects')
      return json({
        projects: [project, { ...project, id: 'prj_2', link: { org: 'x', repo: 'y' } }],
      });
    if (url.pathname === '/v9/projects/prj_1') return json(project);
    if (url.pathname === '/v9/projects/missing') return json({ error: {} }, 404);
    if (url.pathname === '/v11/projects' && method === 'POST') return json(project);
    if (url.pathname === '/v13/deployments') return json({ id: 'dpl_new' });
    if (url.pathname === '/v7/deployments')
      return json({
        deployments: [
          {
            uid: 'd3',
            readyState: 'READY',
            target: 'production',
            url: 'a.vercel.app',
            createdAt: 3,
            meta: { githubCommitSha: 'c3' },
          },
          {
            uid: 'd2',
            readyState: 'BUILDING',
            target: null,
            url: 'b.vercel.app',
            createdAt: 2,
            meta: { githubCommitSha: 'c2' },
          },
          {
            uid: 'd1',
            readyState: 'READY',
            target: 'production',
            url: 'c.vercel.app',
            createdAt: 1,
          },
        ].filter(
          (d) => url.searchParams.get('target') !== 'production' || d.target === 'production',
        ),
      });
    if (url.pathname.startsWith('/v1/projects/prj_1/rollback/')) return json({});
    return json({ error: { message: 'unexpected' } }, 500);
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

describe('Vercel as hosting (D-042)', () => {
  it('keeps the team the token acts in, and sends it with every call', async () => {
    const v = fakeVercel();
    const host = vercelHosting(v.fetch);
    const verified = await host.verify({ token: 'tok' });
    expect(verified.account).toBe('Ada');
    expect(decodeVercel(verified.credential)).toEqual({ token: 'tok', team: 'team_9' });
    await host.site(verified.credential, 'prj_1');
    const last = v.calls.at(-1)!;
    expect(last.url.searchParams.get('teamId')).toBe('team_9');
    expect(last.auth).toBe('Bearer tok');
  });

  it('finds the project linked to the repository, and its production address', async () => {
    const host = vercelHosting(fakeVercel().fetch);
    const found = await host.findSite('vc1::tok', {
      fullName: 'jc/shop',
      name: 'shop',
      defaultBranch: 'main',
      url: '',
      private: true,
      pushedAt: null,
    });
    expect(found).toMatchObject({
      ref: 'prj_1',
      productionUrl: 'https://shop-jc.vercel.app',
      productionBranch: 'main',
    });
    expect(await host.site('vc1::tok', 'missing')).toBeNull();
  });

  it('reads deployments with the commit each one built: a branch build is a preview', async () => {
    const host = vercelHosting(fakeVercel().fetch);
    const d = await host.deployments('vc1::tok', 'prj_1');
    expect(d[1]).toMatchObject({ environment: 'preview', status: 'building', commitSha: 'c2' });
    expect(d[0]).toMatchObject({ environment: 'production', status: 'succeeded' });
  });

  it('creates a project linked to the repository, builds production and dev', async () => {
    const v = fakeVercel();
    const host = vercelHosting(v.fetch);
    const { site } = await host.createLinkedSite!('vc1:team_9:tok', {
      name: 'shop',
      repository: 'Jc/Shop',
      branch: 'main',
    });
    expect(site.ref).toBe('prj_1');
    const created = v.calls.find((c) => c.url.pathname === '/v11/projects')!;
    expect(created.body).toEqual({
      name: 'shop',
      gitRepository: { type: 'github', repo: 'Jc/Shop' },
    });
    const builds = v.calls.filter((c) => c.url.pathname === '/v13/deployments').map((c) => c.body);
    expect(builds).toEqual([
      expect.objectContaining({
        target: 'production',
        gitSource: { type: 'github', org: 'Jc', repo: 'Shop', ref: 'main' },
      }),
      expect.objectContaining({
        gitSource: { type: 'github', org: 'Jc', repo: 'Shop', ref: 'dev' },
      }),
    ]);
    expect(builds[1]).not.toHaveProperty('target');
  });

  it('rolls production back to the deployment before the current one', async () => {
    const v = fakeVercel();
    await vercelHosting(v.fetch).rollback('vc1::tok', 'prj_1');
    expect(v.calls.at(-1)!.url.pathname).toBe('/v1/projects/prj_1/rollback/d1');
  });
});
