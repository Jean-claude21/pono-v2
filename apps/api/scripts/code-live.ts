/**
 * The hand that writes, live (D-027): an agent codes on a real project server through Pono's MCP
 * only, as Claude.ai on a phone would. Signs in (development), imports the probe repository, gives
 * it a real Agent37 server, then over MCP: start_dev → list_files, search_code, read_file →
 * edit_file → the public preview changes → write_file, run_command, a background job →
 * show_changes → push_changes → the edit is on GitHub's dev branch. The server is released at the
 * end. Needs the local console and API, GITHUB_TOKEN and AGENT37_API_KEY.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE = process.env.PONO_CONSOLE_URL ?? 'http://localhost:3000';
const GH = process.env.GITHUB_TOKEN;
if (!GH) throw new Error('GITHUB_TOKEN is required.');
const PROBE = 'Jean-claude21/pono-devloop-probe';

const t0 = Date.now();
const log = (step: string, detail: unknown = '') =>
  console.log(
    `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${step}`,
    typeof detail === 'string' ? detail : JSON.stringify(detail),
  );
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cookies = new Map<string, string>();
const jar = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
const keep = (r: Response) => {
  for (const h of r.headers.getSetCookie()) {
    const [pair] = h.split(';');
    const [k, v] = pair!.split('=');
    cookies.set(k!, v ?? '');
  }
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function call(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<{ status: number; body: Json }> {
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
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

let r = await fetch(`${BASE}/auth/sign-in/dev?login=jean-claude`, { redirect: 'manual' });
keep(r);
r = await fetch(r.headers.get('location')!, { redirect: 'manual', headers: { cookie: jar() } });
keep(r);
await call('/v1/connections', 'POST', { provider: 'github', fields: { token: GH } });

const imported = await call('/v1/projects', 'POST', { repository: PROBE, proposeManifest: false });
const projectId: string =
  imported.status === 201
    ? imported.body.id
    : (await call('/v1/projects')).body.projects.find(
        (p: { repository: string }) => p.repository.toLowerCase() === PROBE.toLowerCase(),
      ).id;

const released: string[] = [];
const granted = await call('/v1/agents', 'POST', { name: 'chat probe', scope: 'act' });
const mcp = new Client({ name: 'code-live', version: '1' });

async function tool(name: string, args: Record<string, unknown>): Promise<Json> {
  const res = (await mcp.callTool({ name, arguments: { projectId, ...args } })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  const body = JSON.parse(res.content[0]!.text);
  if (res.isError) throw new Error(`${name}: ${JSON.stringify(body)}`);
  return body;
}

try {
  // A server for the project, as the console gives it.
  const current = (await call('/v1/servers')).body.servers as {
    id: string;
    projectId: string;
    status: string;
  }[];
  let mine = current.find((s) => s.projectId === projectId && s.status !== 'released');
  if (!mine) {
    const res = await call(`/v1/projects/${projectId}/server`, 'POST', { agent: 'claude-code' });
    if (res.status !== 201) throw new Error(`no server: ${res.status} ${JSON.stringify(res.body)}`);
    mine = res.body.server;
  } else if (mine.status !== 'running') await call(`/v1/servers/${mine.id}/wake`, 'POST', {});
  released.push(mine!.id);
  log('server', 'running');

  await mcp.connect(
    new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${granted.body.token}` } },
    }),
  );
  const tools = (await mcp.listTools()).tools.map((x) => x.name);
  log('MCP tools', {
    count: tools.length,
    coding: tools.filter((n) => /file|code|command|changes/.test(n)),
  });

  const started = await tool('start_dev', {});
  const preview = started.previewUrl as string;
  log('start_dev', { preview, skills: started.skills });
  for (let i = 0; i < 100; i++) {
    const s = await tool('dev_status', { lines: 5 });
    if (s.phase === 'running' && s.http > 0 && s.http < 500) break;
    if (s.phase === 'install_failed' || s.phase === 'crashed')
      throw new Error(`dev: ${s.phase} ${s.logs}`);
    await sleep(3000);
  }
  log('dev running');

  const files = await tool('list_files', {});
  log('list_files', files.files);
  const found = await tool('search_code', { pattern: 'id="msg"' });
  log('search_code', found.matches);
  const page = await tool('read_file', { path: 'index.html' });
  log('read_file', { lines: page.totalLines });

  const before = await (await fetch(preview)).text();
  const current1 = /<h1 id="msg">([^<]*)<\/h1>/.exec(before)?.[1] ?? 'hello from the server';
  const stamp = `hello from a chat ${Date.now()}`;
  const edited = await tool('edit_file', {
    path: 'index.html',
    edits: [{ old_text: `<h1 id="msg">${current1}</h1>`, new_text: `<h1 id="msg">${stamp}</h1>` }],
  });
  log('edit_file', {
    action: edited.action,
    diff: String(edited.diff)
      .split('\n')
      .filter((l) => /^[+-]</.test(l)),
  });
  let after = '';
  for (let i = 0; i < 20 && !after.includes(stamp); i++) {
    await sleep(500);
    after = await (await fetch(preview)).text();
  }
  log('preview shows the edit', { changed: after.includes(stamp) });

  const wrong = await mcp.callTool({
    name: 'edit_file',
    arguments: {
      projectId,
      path: 'index.html',
      edits: [{ old_text: 'not in the file', new_text: 'x' }],
    },
  });
  log('edit_file refuses a missing text', {
    refused: JSON.stringify(wrong).includes('edit_not_found'),
  });

  const map = await tool('project_map', {});
  log('project_map', String(map.map).split(String.fromCharCode(10)).slice(0, 6));

  const broken = await mcp.callTool({
    name: 'edit_file',
    arguments: {
      projectId,
      path: 'vite.config.js',
      edits: [{ old_text: 'export default', new_text: 'export default {' }],
    },
  });
  log('edit_file refuses a broken syntax', {
    refused: JSON.stringify(broken).includes('syntax_broken'),
  });

  const patched = await tool('apply_patch', {
    patch: [
      '*** Begin Patch',
      '*** Add File: notes/patch.md',
      '+Added by apply_patch from a chat.',
      '*** Update File: index.html',
      '@@',
      '-<html><head><meta charset="utf-8"><title>Pono probe</title></head>',
      '+<html><head><meta charset="utf-8"><title>Pono probe · patched</title></head>',
      '*** End Patch',
    ].join(String.fromCharCode(10)),
  });
  log('apply_patch', patched.applied);
  const undone = await tool('undo_edit', { path: 'index.html' });
  const title = await (await fetch(preview)).text();
  log('undo_edit', {
    action: undone.action,
    titleBack: !title.includes('patched') && title.includes(stamp),
  });

  const note = await tool('write_file', {
    path: 'notes/chat.md',
    content: `Written from a chat: ${stamp}\n`,
  });
  log('write_file', { action: note.action });
  const ran = await tool('run_command', {
    command: 'node -v && git status --short',
    timeout_seconds: 30,
  });
  log('run_command', { exitCode: ran.exitCode, output: ran.output });
  const job = await tool('run_command', { command: 'sleep 2; echo job done', background: true });
  let out = await tool('command_output', { job: job.job });
  for (let i = 0; i < 20 && !out.done; i++) {
    await sleep(500);
    out = await tool('command_output', { job: job.job });
  }
  log('background job', { done: out.done, exitCode: out.exitCode, output: out.output });

  const changes = await tool('show_changes', {});
  log('show_changes', changes.files);
  const pushed = await tool('push_changes', { message: 'Edit from a chat, through Pono' });
  log('push_changes', pushed);
  const onDev = await (
    await fetch(`https://api.github.com/repos/${PROBE}/contents/index.html?ref=dev`, {
      headers: { authorization: `Bearer ${GH}`, accept: 'application/vnd.github+json' },
    })
  ).json();
  log('GitHub dev branch', {
    hasEdit: Buffer.from(onDev.content ?? '', 'base64')
      .toString()
      .includes(stamp),
  });
} finally {
  await mcp.close().catch(() => undefined);
  await call(`/v1/agents/${granted.body.id}`, 'DELETE');
  for (const id of released)
    log('server released', { status: (await call(`/v1/servers/${id}`, 'DELETE')).status });
}
log('done');
