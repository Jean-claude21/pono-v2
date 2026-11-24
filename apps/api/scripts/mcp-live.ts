/**
 * A whole project made by a chat agent over MCP alone, for real (D-036 to D-038): the way ChatGPT or
 * Claude.ai drive Pono. Running console (http://localhost:3000), API with PONO_SERVER_TEMPLATE=pono-web.
 *   list_templates → launch_project « site » → start_dev → preview_screenshot → edit_file → the
 *   preview follows without start_dev → push_changes → put_online → production shows the edit →
 *   get_network, backup_server, list_backups → server, site and repository released (KEEP=1 keeps).
 * Prints what it sees, never a key.
 *
 *   GITHUB_TOKEN=$(gh auth token) node --env-file=../../../.secrets/.admin.env --import tsx scripts/mcp-live.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

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
  return { status: r.status, body: (text.startsWith('{') ? JSON.parse(text) : null) as T };
}

let r = await fetch(`${BASE}/auth/sign-in/dev?login=jean-claude`, { redirect: 'manual' });
keep(r);
r = await fetch(r.headers.get('location')!, { redirect: 'manual', headers: { cookie: jar() } });
keep(r);
await call('/v1/connections', 'POST', { provider: 'github', fields: { token: GH } });
await call('/v1/connections', 'POST', { provider: 'netlify', fields: { token: NETLIFY } });
for (const s of (await call('/v1/servers')).body.servers as { id: string; status: string }[])
  if (s.status === 'running') await call(`/v1/servers/${s.id}/sleep`, 'POST');

const token = (await call('/v1/agents', 'POST', { name: 'chat agent', scope: 'act' })).body
  .token as string;
const client = new Client({ name: 'chat-agent', version: '1.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }),
);
type Content = { type: string; text?: string; data?: string; mimeType?: string };
const tool = async (name: string, args: Record<string, unknown> = {}) => {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: Content[];
    isError?: boolean;
  };
  const text = res.content.find((c) => c.type === 'text')?.text ?? '{}';
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { text };
  }
  return { json, content: res.content, error: Boolean(res.isError) };
};

const templates = (await tool('list_templates')).json;
check(JSON.stringify(templates).includes('"site"'), 'list_templates shows « site »');

const name = `pono-proof-${Date.now().toString(36)}`;
const launched = await tool('launch_project', { template: 'site', name, agent: 'none' });
check(!launched.error, `launch_project (${JSON.stringify(launched.json).slice(0, 160)})`);
const projectId = (launched.json.projectId ??
  (launched.json.project as { id?: string })?.id) as string;
const repository = launched.json.repository as string;
log('project', { repository });
let siteHost: string | null = null;
try {
  const started = await tool('start_dev', { projectId });
  check(!started.error, 'start_dev');
  check(started.json.reloads === true, 'Pono says the preview reloads by itself');
  let dev = started.json;
  for (let i = 0; i < 60 && !(dev.phase === 'running' && dev.http === 200); i++) {
    await sleep(5000);
    dev = (await tool('dev_status', { projectId })).json;
  }
  check(dev.phase === 'running' && dev.http === 200, 'the dev server answers');

  const first = await tool('preview_screenshot', { projectId, device: 'mobile' });
  const image = first.content.find((c) => c.type === 'image');
  check(Boolean(image?.data && image.mimeType === 'image/jpeg'), 'the agent sees the preview');
  log('capture', {
    kb: Math.round(((image?.data?.length ?? 0) * 3) / 4 / 1024),
    meta: first.content.find((c) => c.type === 'text')?.text?.slice(0, 160),
  });

  const marker = `Lumière ${Date.now().toString(36)}`;
  const edited = await tool('edit_file', {
    projectId,
    path: 'src/content.ts',
    edits: [{ old_text: "name: 'Atelier Lumière'", new_text: `name: 'Atelier ${marker}'` }],
  });
  check(!edited.error, `edit_file (${JSON.stringify(edited.json).slice(0, 120)})`);
  let followed = false;
  for (let i = 0; i < 10 && !followed; i++) {
    await sleep(2000);
    const out = await tool('run_command', { projectId, command: 'curl -s http://127.0.0.1:3000/' });
    followed = JSON.stringify(out.json).includes(marker);
  }
  check(followed, 'the preview follows the edit without start_dev');
  const second = await tool('preview_screenshot', { projectId, device: 'desktop' });
  check(
    second.content.some((c) => c.type === 'image'),
    'a second look after the edit',
  );

  const pushed = await tool('push_changes', { projectId, message: 'Le nom du site' });
  check(!pushed.error, `push_changes (${JSON.stringify(pushed.json).slice(0, 120)})`);
  const online = await tool('put_online', { projectId });
  check(!online.error, `put_online (${JSON.stringify(online.json).slice(0, 160)})`);
  const url = online.json.productionUrl as string;
  siteHost = new URL(url).host;
  const shows = async (text: string) => {
    for (let i = 0; i < 40; i++) {
      await sleep(10_000);
      const page = await fetch(url).catch(() => null);
      if (page?.ok && (await page.text()).includes(text)) return true;
    }
    return false;
  };
  check(await shows('Atelier Lumière'), `production answers from the default branch (${url})`);

  // Production follows the default branch: the edit reaches it only by a proposal (D-039).
  let proposed = await tool('propose_release', { projectId });
  log('propose_release', proposed.json);
  check(
    !proposed.error && Boolean((proposed.json.proposal as { url?: string } | null)?.url),
    'propose_release opens the proposal from dev',
  );
  // The preview of dev builds at the hosting: as the tool says, call again in a minute.
  type Release = { id: string; status: string; guards?: unknown };
  let waiting: Release | undefined;
  for (let i = 0; i < 12 && !waiting; i++) {
    const releases = (proposed.json.releases ?? []) as Release[];
    waiting = releases.find((x) => x.status === 'waiting');
    if (!waiting) {
      await sleep(15_000);
      proposed = await tool('propose_release', { projectId });
    }
  }
  check(Boolean(waiting), 'the proposal waits for the person once its preview is built');
  if (waiting) {
    const approved = await call(`/v1/releases/${waiting.id}/approve`, 'POST', {});
    log('the person approves', { status: approved.status, body: approved.body });
  }
  check(await shows(marker), 'production shows the edit once the person approves');

  const network = (await tool('get_network', { projectId })).json;
  log('network', network);
  const backup = await tool('backup_server', { projectId });
  check(!backup.error, `backup_server (${JSON.stringify(backup.json).slice(0, 120)})`);
  const backups = (await tool('list_backups', { projectId })).json;
  check(
    JSON.stringify(backups).length > 20,
    `list_backups (${JSON.stringify(backups).slice(0, 160)})`,
  );
} finally {
  await client.close();
  if (process.env.KEEP !== '1') {
    const servers = (await call('/v1/servers')).body.servers as {
      id: string;
      projectId?: string;
    }[];
    for (const s of servers.filter((x) => x.projectId === projectId))
      await call(`/v1/servers/${s.id}`, 'DELETE');
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
