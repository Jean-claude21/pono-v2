/**
 * Drives the running console (http://localhost:3000) like a person and an agent would, against the
 * author's real providers: usage, a real project server (Agent37) put to sleep, woken and released,
 * an agent token used over MCP through the console's origin, the plan, and the operator's view.
 * It writes nothing at GitHub. Prints what it sees, never a key.
 *
 *   pnpm --filter @pono/api exec tsx scripts/e2e-live.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE = process.env.PONO_CONSOLE_URL ?? 'http://localhost:3000';
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

async function call<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<{ status: number; body: T }> {
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
  return { status: r.status, body: (text ? JSON.parse(text) : null) as T };
}

// A person signs in (development sign-in) and lands in their workshop.
let r = await fetch(`${BASE}/auth/sign-in/dev?login=jean-claude`, { redirect: 'manual' });
keep(r);
r = await fetch(r.headers.get('location')!, { redirect: 'manual', headers: { cookie: jar() } });
keep(r);
const me = (
  await call<{ person: { login: string }; organization: { name: string }; isAdmin: boolean }>(
    '/v1/me',
  )
).body;
log('signed in', { login: me.person.login, operator: me.isAdmin });

const projects = (
  await call<{ projects: { id: string; name: string; state: string }[] }>('/v1/projects')
).body.projects;
log('workshop', projects.map((p) => `${p.name}:${p.state}`).join(' '));

// Usage, read at the real providers.
const read = await call<{ readings: number }>('/v1/usage/refresh', 'POST');
const usage = (
  await call<{
    total: { totalMicros: number; unavailable: number };
    alerts: { key: string; level: string }[];
    readings: { source: string }[];
  }>('/v1/usage')
).body;
log('usage read', {
  readings: read.body.readings,
  unavailable: usage.total.unavailable,
  alerts: usage.alerts.map((a) => `${a.key}:${a.level}`),
});

// A real project server: given, put to sleep, woken, released.
const lectio = projects.find((p) => p.name === 'lectio-reads')!;
const given = await call<{ server: { id: string; status: string; url: string } }>(
  `/v1/projects/${lectio.id}/server`,
  'POST',
  { agent: 'none' },
);
log('server given', {
  status: given.status,
  server: given.body.server?.status,
  url: given.body.server?.url,
});
const serverId = given.body.server.id;
const second = projects.find((p) => p.name === 'fluxio-runtime-test')!;
const refused = await call<{ error: { code: string; detail: unknown } }>(
  `/v1/projects/${second.id}/server`,
  'POST',
  { agent: 'none' },
);
log('second server on the free plan', {
  status: refused.status,
  code: refused.body.error?.code,
  detail: refused.body.error?.detail,
});
log('sleep', (await call(`/v1/servers/${serverId}/sleep`, 'POST')).status);
log(
  'servers',
  (await call<{ active: number; limit: number; servers: { status: string }[] }>('/v1/servers'))
    .body,
);
log('wake', (await call(`/v1/servers/${serverId}/wake`, 'POST', {})).status);

// An agent token, then Claude-like calls over MCP through the console's own origin.
const token = (
  await call<{ token: string }>('/v1/agents', 'POST', { name: 'e2e agent', scope: 'act' })
).body.token;
const client = new Client({ name: 'e2e-agent', version: '1.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }),
);
const tools = await client.listTools();
log('mcp tools', tools.tools.length);
const text = async (name: string, args: Record<string, unknown> = {}) => {
  const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
  return JSON.parse(res.content[0]!.text) as Record<string, unknown>;
};
const byName = await text('find_project', { query: 'on continue lectio' === 'x' ? '' : 'lectio' });
log('find_project « lectio »', {
  kind: byName.kind,
  project: (byName.project as { name?: string } | undefined)?.name,
});
const byRemote = await text('find_project', {
  repository: 'git@github.com:Jean-claude21/fluxio-runtime-test.git',
});
log('find_project by git remote', {
  kind: byRemote.kind,
  by: byRemote.by,
  project: (byRemote.project as { name?: string } | undefined)?.name,
});
const resumed = await text('resume_project', { projectId: lectio.id });
log('resume_project', {
  server: (resumed.project as { server_status: string }).server_status,
  skills: (resumed.skills as { name: string }[]).map((s) => s.name),
});
const usageByAgent = await text('read_usage');
log('read_usage by the agent', {
  totalMicros: (usageByAgent.total as { totalMicros: number }).totalMicros,
});
await client.close();

// The plan, through development billing; then the operator's view.
log(
  'checkout solo',
  (await call<{ url: string }>('/v1/plan/checkout', 'POST', { plan: 'solo' })).body,
);
log('servers after solo', (await call<{ limit: number }>('/v1/servers')).body.limit);
const overview = (await call<Record<string, unknown>>('/v1/admin/overview')).body;
log('admin overview', overview);

// Clean up: release the real server, cut the agent.
log('release', (await call(`/v1/servers/${serverId}`, 'DELETE')).status);
const agents = (await call<{ agents: { id: string; name: string }[] }>('/v1/agents')).body.agents;
for (const a of agents.filter((x) => x.name === 'e2e agent'))
  await call(`/v1/agents/${a.id}`, 'DELETE');
log('done');
