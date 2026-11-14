/**
 * A template taken to production through Pono, for real (D-033, D-034, D-036, D-037): the running
 * console (http://localhost:3000) and API started with PONO_SERVER_TEMPLATE=pono-web; GitHub,
 * Agent37 and Netlify for real.
 *   launch « site » → repository generated from kete-africa/pono-starter-site → server on the Pono
 *   template → dev server and private preview → put online at Netlify → production answers →
 *   the template's value counts it → server, site and repository released (KEEP=1 keeps them).
 * Prints what it sees, never a key.
 *
 *   GITHUB_TOKEN=$(gh auth token) node --env-file=../../../.secrets/.admin.env --import tsx scripts/template-live.ts
 */
const BASE = process.env.PONO_CONSOLE_URL ?? 'http://localhost:3000';
const GH = process.env.GITHUB_TOKEN;
const NETLIFY = process.env.NETLIFY_AUTH_TOKEN;
if (!GH || !NETLIFY) throw new Error('GITHUB_TOKEN and NETLIFY_AUTH_TOKEN are required.');

const cookies = new Map<string, string>();
const jar = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
const keep = (r: Response) => {
  for (const h of r.headers.getSetCookie()) {
    const [pair] = h.split(';');
    const [k, v] = pair!.split('=');
    cookies.set(k!, v ?? '');
  }
};
const t0 = Date.now();
const log = (step: string, detail: unknown = '') =>
  console.log(
    `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${step}`,
    typeof detail === 'string' ? detail : JSON.stringify(detail),
  );
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  log(`ok  ${what}`);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call<T = any>(path: string, method = 'GET', body?: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      cookie: jar(),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  keep(r);
  const text = await r.text();
  return {
    status: r.status,
    location: r.headers.get('location'),
    body: (text && text.startsWith('{') ? JSON.parse(text) : null) as T,
  };
}

let r = await fetch(`${BASE}/auth/sign-in/dev?login=jean-claude`, { redirect: 'manual' });
keep(r);
r = await fetch(r.headers.get('location')!, { redirect: 'manual', headers: { cookie: jar() } });
keep(r);
log('signed in', (await call('/v1/me')).body.person.login);

await call('/v1/connections', 'POST', { provider: 'github', fields: { token: GH } });
await call('/v1/connections', 'POST', { provider: 'netlify', fields: { token: NETLIFY } });
const connections = (await call('/v1/connections')).body.connections as {
  provider: string;
  status: string;
}[];
check(
  ['github', 'netlify'].every((p) =>
    connections.some((c) => c.provider === p && c.status === 'active'),
  ),
  'GitHub and Netlify connected',
);

// Room for one more server: the free plan keeps one awake.
const servers = (await call('/v1/servers')).body.servers as { id: string; status: string }[];
for (const s of servers.filter((x) => x.status === 'running'))
  await call(`/v1/servers/${s.id}/sleep`, 'POST');

const name = `pono-proof-${Date.now().toString(36)}`;
const launched = await call('/v1/launch', 'POST', { template: 'site', name, private: true });
check(launched.status === 201, `launched from « site » (${launched.status})`);
const { projectId, repository, server, durationMs } = launched.body;
log('project', { repository, server: server.status, seconds: Math.round(durationMs / 1000) });

const serverId = server.id as string;
let siteHost: string | null = null;
try {
  const started = await call(`/v1/projects/${projectId}/dev/start`, 'POST');
  check(
    started.status === 200,
    `dev started (${started.status} ${started.body?.error?.code ?? ''})`,
  );
  let dev = started.body;
  for (let i = 0; i < 60 && !(dev.phase === 'running' && dev.http === 200); i++) {
    await sleep(5000);
    dev = (await call(`/v1/projects/${projectId}/dev`)).body;
    if (i % 4 === 0) log('dev', { phase: dev.phase, http: dev.http });
  }
  check(dev.phase === 'running' && dev.http === 200, 'the dev server answers on the server');
  check(dev.private === true, 'the preview is private');
  const entry = await call(`/v1/projects/${projectId}/preview`);
  const preview = await fetch(entry.location!);
  check(
    preview.status === 200 && (await preview.text()).includes('Atelier'),
    'the private link serves the preview',
  );

  const online = await call(`/v1/projects/${projectId}/online`, 'POST');
  check(
    online.status === 200 && online.body.created,
    `site created (${online.status} ${online.body?.error?.code ?? ''})`,
  );
  const url = online.body.productionUrl as string;
  siteHost = new URL(url).host;
  log('production address', url);
  let live = false;
  for (let i = 0; i < 40 && !live; i++) {
    await sleep(10_000);
    const page = await fetch(url).catch(() => null);
    live = Boolean(page?.ok && (await page.text()).includes('Atelier'));
    if (i % 3 === 0) log('production', live ? 'up' : 'building');
  }
  check(live, 'production answers with the site');
  await call(`/v1/projects/${projectId}/refresh`, 'POST');
  const gallery = (await call('/v1/catalog/templates')).body.templates as {
    id: string;
    value: { launched: number; live: number };
  }[];
  const site = gallery.find((t) => t.id === 'site')!;
  log('value of « site »', site.value);
  check(site.value.launched >= 1 && site.value.live >= 1, 'the template counts a live project');
} finally {
  if (process.env.KEEP !== '1') {
    await call(`/v1/servers/${serverId}`, 'DELETE');
    // Netlify takes the site's own host name as its id.
    if (siteHost)
      await fetch(`https://api.netlify.com/api/v1/sites/${siteHost}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${NETLIFY}` },
      });
    await fetch(`https://api.github.com/repos/${repository}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${GH}`, 'user-agent': 'pono' },
    });
    log('released: server, site, repository');
  }
}
