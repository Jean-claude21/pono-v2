/**
 * The dev loop for real (D-020), through the running console (http://localhost:3000), on a real
 * Agent37 server and a real GitHub repository (the author's private `pono-devloop-probe`):
 *   start dev → public preview answers → an edit on the server reaches the browser over HMR →
 *   push to `dev` (and a secret refused) → a push made elsewhere pulled back → status over MCP →
 *   a real TanStack Start project (lectio) runs too → everything released.
 * Prints what it sees, never a key.
 *
 *   GITHUB_TOKEN=$(gh auth token) node --env-file=../../../.secrets/.admin.env --import tsx scripts/devloop-live.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE = process.env.PONO_CONSOLE_URL ?? 'http://localhost:3000';
const GH = process.env.GITHUB_TOKEN;
const A37 = process.env.AGENT37_API_KEY;
if (!GH || !A37) throw new Error('GITHUB_TOKEN and AGENT37_API_KEY are required.');
const PROBE = 'Jean-claude21/pono-devloop-probe';
const LECTIO = 'Jean-claude21/lectio';

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
/** What the console answers: any shape, read by the steps below. */
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
const github = (path: string, init: RequestInit = {}) =>
  fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${GH}`,
      accept: 'application/vnd.github+json',
      ...(init.headers ?? {}),
    },
  });
const exec = async (instance: string, command: string) => {
  const r = await fetch(`https://api.agent37.com/v1/instances/${instance}/exec`, {
    method: 'POST',
    headers: { authorization: `Bearer ${A37}`, 'content-type': 'application/json' },
    body: JSON.stringify({ command }),
  });
  return (await r.json()) as { exit_code: number; stdout: string; stderr: string };
};

let r = await fetch(`${BASE}/auth/sign-in/dev?login=jean-claude`, { redirect: 'manual' });
keep(r);
r = await fetch(r.headers.get('location')!, { redirect: 'manual', headers: { cookie: jar() } });
keep(r);
const connected = await call('/v1/connections', 'POST', {
  provider: 'github',
  fields: { token: GH },
});
log('code host', { status: connected.status });

async function project(repository: string): Promise<string> {
  const imported = await call('/v1/projects', 'POST', { repository, proposeManifest: false });
  if (imported.status === 201) return imported.body.id;
  const list = await call('/v1/projects');
  return list.body.projects.find(
    (p: { repository: string }) => p.repository.toLowerCase() === repository.toLowerCase(),
  ).id;
}
const released: string[] = [];
async function server(projectId: string): Promise<{ id: string; externalId: string }> {
  const current = (await call('/v1/servers')).body.servers as {
    id: string;
    projectId: string;
    status: string;
  }[];
  let mine = current.find((s) => s.projectId === projectId && s.status !== 'released');
  if (!mine) {
    let res = await call(`/v1/projects/${projectId}/server`, 'POST', { agent: 'claude-code' });
    if (res.status === 409 && res.body.error.code === 'servers.limit_reached') {
      const busy = res.body.error.detail.active[0].id;
      res = await call(`/v1/projects/${projectId}/server`, 'POST', {
        agent: 'claude-code',
        sleepServerId: busy,
      });
    }
    if (res.status !== 201) throw new Error(`no server: ${res.status} ${JSON.stringify(res.body)}`);
    mine = res.body.server;
  } else if (mine.status !== 'running') await call(`/v1/servers/${mine.id}/wake`, 'POST', {});
  released.push(mine!.id);
  const admin = (await call('/v1/admin/servers')).body.servers as {
    id: string;
    externalId: string;
  }[];
  return { id: mine!.id, externalId: admin.find((s) => s.id === mine!.id)!.externalId };
}
async function untilRunning(projectId: string, label: string, limitS = 300) {
  for (let i = 0; i < limitS / 3; i++) {
    const s = (await call(`/v1/projects/${projectId}/dev?lines=8`)).body;
    if (s.phase === 'running' && s.http > 0 && s.http < 500) return s;
    if (s.phase === 'install_failed' || s.phase === 'crashed') {
      const full = (await call(`/v1/projects/${projectId}/dev?lines=60`)).body;
      throw new Error(`${label}: ${s.phase}\n${full.logs}`);
    }
    if (i % 5 === 0)
      log(`${label} waiting`, {
        phase: s.phase,
        http: s.http,
        alive: s.alive,
        logs: String(s.logs ?? '')
          .split(String.fromCharCode(10))
          .slice(-3),
      });
    await sleep(3000);
  }
  throw new Error(`${label}: not running in time`);
}

try {
  // 1. The probe: a small Vite app, `dev:` written in its pono.yaml.
  if (process.env.PONO_LIVE_PROBE !== '0') {
    const probe = await project(PROBE);
    const probeServer = await server(probe);
    log('probe server', { status: 'running' });
    const started = await call(`/v1/projects/${probe}/dev/start`, 'POST');
    if (started.status !== 200) throw new Error(`start: ${JSON.stringify(started.body)}`);
    log('dev started', { port: started.body.port, preview: started.body.previewUrl });
    const running = await untilRunning(probe, 'probe');
    log('dev running', { http: running.http, branch: running.branch, commit: running.commit });

    const preview = started.body.previewUrl as string;
    const page = await (await fetch(preview)).text();
    log('public preview', { answers: page.includes('hello from the server') });

    // 2. HMR through the public address: an edit on the server reaches the browser by itself.
    const client = await (await fetch(`${preview}/@vite/client`)).text();
    const token = client.match(/const wsToken = "([^"]+)"/)?.[1] ?? '';
    const ws = new WebSocket(
      `${preview.replace(/^http/, 'ws')}/?token=${encodeURIComponent(token)}`,
      'vite-hmr',
    );
    const messages: string[] = [];
    ws.onmessage = (e) => messages.push(String(e.data));
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('HMR socket refused'));
      setTimeout(() => reject(new Error('HMR socket timeout')), 15000);
    });
    await (await fetch(`${preview}/main.js`)).text(); // the browser has loaded the module
    const version = Date.now();
    const edited = await exec(
      probeServer.externalId,
      `echo "export const version = ${version};" > "$HOME/work/pono-devloop-probe/main.js"`,
    );
    for (let i = 0; i < 30 && !messages.some((m) => /"type":"(update|full-reload)"/.test(m)); i++)
      await sleep(300);
    const hmr = messages.find((m) => /"type":"(update|full-reload)"/.test(m));
    log('HMR after an edit on the server', {
      edited: edited.exit_code === 0,
      event: hmr ? JSON.parse(hmr).type : 'none',
    });
    const served = await (await fetch(`${preview}/main.js`)).text();
    log('served module', { changed: served.includes(String(version)) });

    // 3. Push to dev, after the secrets check; a secret is refused.
    await exec(
      probeServer.externalId,
      `printf "const k = '%s';\\n" "sk_live_$(printf 'x%.0s' $(seq 24))" > "$HOME/work/pono-devloop-probe/leak.js"`,
    );
    const refused = await call(`/v1/projects/${probe}/dev/push`, 'POST', { message: 'Try a key' });
    log('push with a secret', { pushed: refused.body.pushed, finding: refused.body.findings?.[0] });
    await exec(
      probeServer.externalId,
      'cd "$HOME/work/pono-devloop-probe" && rm -f leak.js && git reset -q',
    );
    const pushed = await call(`/v1/projects/${probe}/dev/push`, 'POST', {
      message: 'Bump the version from the Pono server',
    });
    log('push to dev', pushed.body);
    const onDev = await (await github(`/repos/${PROBE}/contents/main.js?ref=dev`)).json();
    log('GitHub dev branch', {
      hasEdit: Buffer.from(onDev.content ?? '', 'base64')
        .toString()
        .includes(String(version)),
    });

    // 4. A push made elsewhere (the person's own machine) is pulled; the preview follows.
    const local = version + 1;
    const put = await github(`/repos/${PROBE}/contents/main.js`, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Change made on my machine',
        branch: 'dev',
        sha: onDev.sha,
        content: Buffer.from(`export const version = ${local};\n`).toString('base64'),
      }),
    });
    log('commit pushed elsewhere', { status: put.status });
    const pulled = await call(`/v1/projects/${probe}/dev/pull`, 'POST');
    log('pulled on the server', pulled.body);
    await sleep(1000);
    const after = await (await fetch(`${preview}/main.js`)).text();
    log('preview follows', { changed: after.includes(String(local)) });
    ws.close();

    // 5. The same, as an agent sees it over MCP.
    const granted = await call('/v1/agents', 'POST', { name: 'devloop probe', scope: 'act' });
    const mcp = new Client({ name: 'devloop-live', version: '1' });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${granted.body.token}` } },
      }),
    );
    const status = (await mcp.callTool({
      name: 'dev_status',
      arguments: { projectId: probe, lines: 3 },
    })) as { content: { text: string }[] };
    const seen = JSON.parse(status.content[0]!.text);
    log('dev_status over MCP', {
      phase: seen.phase,
      preview: seen.previewUrl === preview,
      branch: seen.branch,
    });
    await mcp.close();

    // The Claude Code plugin, in a folder of this repository: what a session would be told.
    const folder = mkdtempSync(join(tmpdir(), 'pono-live-'));
    execFileSync('git', ['init', '-q'], { cwd: folder });
    execFileSync('git', ['remote', 'add', 'origin', `https://github.com/${PROBE}.git`], {
      cwd: folder,
    });
    const script = fileURLToPath(
      new URL('../../../integrations/claude-code/scripts/pono.mjs', import.meta.url),
    );
    const env = { ...process.env, PONO_URL: BASE, PONO_TOKEN: granted.body.token as string };
    const context = execFileSync('node', [script, 'context'], {
      cwd: folder,
      env,
      encoding: 'utf8',
    });
    const statusLine = execFileSync('node', [script, 'statusline'], {
      cwd: folder,
      env,
      encoding: 'utf8',
    });
    log(
      'plugin: session context',
      context.split(String.fromCharCode(10)).filter(Boolean).slice(0, 3),
    );
    log('plugin: status line', statusLine);
    await call(`/v1/agents/${granted.body.id}`, 'DELETE');
  }

  // 6. A real TanStack Start project, read from its package.json (no dev: in pono.yaml).
  if (process.env.PONO_LIVE_LECTIO !== '0') {
    const lectio = await project(LECTIO);
    await server(lectio);
    const s = await call(`/v1/projects/${lectio}/dev/start`, 'POST');
    if (s.status !== 200) throw new Error(`lectio start: ${JSON.stringify(s.body)}`);
    log('lectio started', { port: s.body.port, preview: s.body.previewUrl });
    const ok = await untilRunning(lectio, 'lectio', 150);
    const html = await (await fetch(s.body.previewUrl)).text();
    log('lectio preview', { http: ok.http, html: html.slice(0, 15).replace(/\s+/g, ' ') });
  }
} finally {
  for (const id of released) {
    const res = await call(`/v1/servers/${id}`, 'DELETE');
    log('server released', { status: res.status });
  }
}
log('done');
