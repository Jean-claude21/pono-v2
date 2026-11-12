import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { posthogAnalytics } from '../src/infrastructure/providers/posthog.js';
import { umamiCloud, umamiSelfHosted } from '../src/infrastructure/providers/umami.js';
import { readManifest } from '../src/features/manifest/domain.js';
import { call, signIn, testApp, type TestApp } from './support/app.js';

/** A provider answering from recorded payloads, by method and path. */
function recorded(
  answers: Record<string, unknown>,
  seen: { url: string; init?: RequestInit }[] = [],
) {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, ...(init ? { init } : {}) });
    const u = new URL(url);
    const key = `${init?.method ?? 'GET'} ${u.pathname}${u.searchParams.get('type') ? `?type=${u.searchParams.get('type')}` : ''}`;
    if (!(key in answers)) return new Response('{}', { status: 400 });
    return new Response(JSON.stringify(answers[key]), { status: 200 });
  }) as typeof fetch;
}

const range = { from: new Date('2026-10-13T00:00:00Z'), to: new Date('2026-11-12T00:00:00Z') };

describe('Umami (D-017)', () => {
  it('reads both shapes of its stats, and the script of a new site', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const v2 = umamiCloud(
      recorded(
        {
          'GET /v1/websites': { data: [{ id: 'w1', name: 'lectio', domain: 'lectio.app' }] },
          'GET /v1/websites/w1/stats': {
            pageviews: { value: 1200, prev: 900 },
            visitors: { value: 400, prev: 300 },
            visits: { value: 500, prev: 380 },
            bounces: { value: 200, prev: 150 },
            totaltime: { value: 9000, prev: 7000 },
          },
          'GET /v1/websites/w1/metrics?type=url': [{ x: '/', y: 800 }],
          'GET /v1/websites/w1/metrics?type=referrer': [
            { x: '', y: 300 },
            { x: 'google.com', y: 120 },
          ],
          'POST /v1/websites': { id: 'w2', name: 'new', domain: 'new' },
        },
        seen,
      ),
    );
    expect((await v2.verify({ apiKey: 'k' })).account).toBe('1 sites');
    const stats = await v2.stats('k', 'w1', range);
    expect(stats).toMatchObject({ pageviews: 1200, visitors: 400, visits: 500, bounceRate: 0.4 });
    expect(stats.topReferrers[0]).toEqual({ source: '(direct)', visits: 300 });
    expect(seen[1]!.init?.headers).toMatchObject({ 'x-umami-api-key': 'k' });
    const created = await v2.createSite('k', { name: 'new', domain: 'new' });
    expect(created!.script).toContain('data-website-id="w2"');

    const v3 = umamiCloud(
      recorded({
        'GET /v1/websites/w1/stats': {
          pageviews: 10,
          visitors: 4,
          visits: 5,
          bounces: 1,
          totaltime: 3,
        },
        'GET /v1/websites/w1/metrics?type=path': [{ x: '/a', y: 10 }],
        'GET /v1/websites/w1/metrics?type=referrer': [],
      }),
    );
    const s3 = await v3.stats('k', 'w1', range);
    expect(s3).toMatchObject({ pageviews: 10, visits: 5, bounceRate: 0.2 });
    expect(s3.topPages).toEqual([{ path: '/a', views: 10 }]);
  });

  it('signs in to a self-hosted Umami for each use, and refuses a plain http address', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const self = umamiSelfHosted(
      recorded(
        {
          'POST /api/auth/login': { token: 't0' },
          'GET /api/websites': [{ id: 'w1', name: 'site', domain: null }],
        },
        seen,
      ),
    );
    const v = await self.verify({
      url: 'https://stats.example.org/',
      username: 'u',
      password: 'p',
    });
    expect(v.account).toBe('1 sites');
    expect(seen[1]!.init?.headers).toMatchObject({ authorization: 'Bearer t0' });
    await expect(
      self.verify({ url: 'http://stats.example.org', username: 'u', password: 'p' }),
    ).rejects.toThrow(/https/);
  });
});

describe('PostHog (D-017)', () => {
  it('reads visits with HogQL, by region', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    let n = 0;
    const answers = [
      [[300, 120, 150]],
      [
        ['/', 200],
        ['/pricing', 100],
      ],
      [
        ['$direct', 90],
        ['google.com', 40],
      ],
    ];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({ url, ...(init ? { init } : {}) });
      if (url.endsWith('/api/projects/'))
        return new Response(JSON.stringify({ results: [{ id: 42, name: 'site' }] }));
      return new Response(JSON.stringify({ results: answers[n++] }));
    }) as typeof fetch;
    const ph = posthogAnalytics(fetchImpl);
    const v = await ph.verify({ apiKey: 'phx', host: 'eu' });
    expect(seen[0]!.url).toBe('https://eu.posthog.com/api/projects/');
    const stats = await ph.stats(v.credential, '42', range);
    expect(stats).toMatchObject({ pageviews: 300, visitors: 120, visits: 150, bounceRate: null });
    expect(stats.topReferrers[0]).toEqual({ source: '(direct)', visits: 90 });
    expect(String(seen[1]!.init?.body)).toContain("event = '$pageview'");
    expect(await ph.createSite(v.credential, { name: 'x', domain: 'x' })).toBeNull();
    await expect(ph.stats(v.credential, '42; DROP', range)).rejects.toThrow();
  });
});

let t: TestApp;
beforeAll(() => {
  t = testApp();
});
afterAll(async () => t.pool.end());

async function workshop(analytics: boolean): Promise<string> {
  const cookie = await signIn(t, `a${randomUUID().slice(0, 8)}`);
  await call(t, cookie, '/v1/connections', {
    method: 'POST',
    body: { provider: 'code', fields: { token: 'good' } },
  });
  if (analytics)
    await call(t, cookie, '/v1/connections', {
      method: 'POST',
      body: { provider: 'umami', fields: { token: 'good' } },
    });
  return cookie;
}

describe('a project’s visits', () => {
  it('counts a launched project from its first day, the site named in pono.yaml', async () => {
    const cookie = await workshop(true);
    const name = `seen-${randomUUID().slice(0, 6)}`;
    const launched = await (
      await call(t, cookie, '/v1/launch', { method: 'POST', body: { template: 'blank', name } })
    ).json();
    const manifest = readManifest(t.world.files.get(`jc/${name}`)!['pono.yaml']!);
    const site = manifest.ok ? manifest.manifest.analytics!.website : '';
    expect(site).toContain(name);
    const scripts = [...t.world.servers.values()].map((x) => x.env.PONO_ANALYTICS_SCRIPT ?? '');
    expect(scripts.some((x) => x.includes(site))).toBe(true);
    t.world.analyticsSites.get(site)!.pageviews = 90;
    const metrics = await (
      await call(t, cookie, `/v1/projects/${launched.projectId}/analytics?days=7`)
    ).json();
    expect(metrics).toMatchObject({ source: 'measured', provider: 'umami', days: 7 });
    expect(metrics.stats.pageviews).toBe(90);
  });

  it('says why when nothing is linked or connected, never zero', async () => {
    const cookie = await workshop(false);
    const name = `blind-${randomUUID().slice(0, 6)}`;
    const launched = await (
      await call(t, cookie, '/v1/launch', { method: 'POST', body: { template: 'blank', name } })
    ).json();
    const metrics = await (
      await call(t, cookie, `/v1/projects/${launched.projectId}/analytics`)
    ).json();
    expect(metrics).toEqual({ source: 'unavailable', reason: 'not_linked' });
  });

  it('links an adopted project to an existing site, and proposes it in the file', async () => {
    const cookie = await workshop(true);
    const name = `adopt-${randomUUID().slice(0, 6)}`;
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
    t.world.analyticsSites.set('existing', { name: 'existing', pageviews: 5 });
    const { id } = await (
      await call(t, cookie, '/v1/projects', { method: 'POST', body: { repository: fullName } })
    ).json();
    const sites = await (await call(t, cookie, '/v1/analytics/sites')).json();
    expect(sites.providers[0].sites.map((s: { ref: string }) => s.ref)).toContain('existing');
    const missing = await call(t, cookie, `/v1/projects/${id}/analytics`, {
      method: 'PUT',
      body: { provider: 'umami', site: 'nope' },
    });
    expect(missing.status).toBe(404);
    const linked = await call(t, cookie, `/v1/projects/${id}/analytics`, {
      method: 'PUT',
      body: { provider: 'umami', site: 'existing' },
    });
    expect((await linked.json()).proposalUrl).toContain('/pull/');
    expect(t.world.opened.get(fullName)!.branch).toBe('pono/analytics');
    const metrics = await (await call(t, cookie, `/v1/projects/${id}/analytics`)).json();
    expect(metrics.stats.pageviews).toBe(5);
  });
});
