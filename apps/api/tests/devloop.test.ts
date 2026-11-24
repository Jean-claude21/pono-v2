import { execFileSync, spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  devPlan,
  prepareCommand,
  pushCommand,
  readPrepared,
  readStatus,
  redact,
  stagedCommand,
  startCommand,
  statusCommand,
  stopCommand,
} from '../src/features/devloop/domain.js';
import { createApp } from '../src/app.js';
import { call, signIn, testApp, type TestApp } from './support/app.js';

describe('the dev plan (D-020)', () => {
  it('reads package.json: package manager by lockfile, port, host for vite and next', () => {
    const lectio = devPlan({
      packageJson: JSON.stringify({ scripts: { dev: 'vite dev --port 3000' } }),
      files: ['package.json', 'pnpm-lock.yaml'],
    });
    expect(lectio).toEqual({
      install: 'npx --yes pnpm@10 install --config.confirmModulesPurge=false',
      command: 'npx --yes pnpm@10 run dev --host 0.0.0.0',
      port: 3000,
    });
    const pinned = devPlan({
      packageJson: JSON.stringify({ packageManager: 'pnpm@11.0.9', scripts: { dev: 'vite' } }),
      files: ['pnpm-lock.yaml'],
    });
    expect(pinned).toMatchObject({
      command: 'npx --yes pnpm@11.0.9 run dev --host 0.0.0.0',
      port: 5173,
    });
    expect(
      devPlan({ packageJson: JSON.stringify({ scripts: { dev: 'next dev' } }), files: [] }),
    ).toMatchObject({ command: 'npm run dev -- -H 0.0.0.0', port: 3000 });
    expect(
      devPlan({
        manifestDev: { command: 'go run .', port: 8080 },
        packageJson: null,
        files: ['go.mod'],
      }),
    ).toEqual({ install: null, command: 'go run .', port: 8080 });
    expect(devPlan({ packageJson: '{}', files: [] })).toBeNull();
    expect(devPlan({ packageJson: null, files: ['go.mod'] })).toBeNull();
  });

  it('reads what the server printed, and hides development values from logs', () => {
    const prepared = readPrepared(
      'noise\n<<<files>>>\n.\npackage.json\npnpm-lock.yaml\n<<<package>>>\n{"a":1}\n<<<manifest>>>\n',
    );
    expect(prepared).toEqual({
      files: ['.', 'package.json', 'pnpm-lock.yaml'],
      packageJson: '{"a":1}',
      manifest: null,
    });
    const state = readStatus(
      '<<<phase>>>\nstarting\n<<<alive>>>\nyes\n<<<http>>>\n200\n<<<branch>>>\ndev\nabc1234\n2\n<<<logs>>>\nready\n',
    );
    expect(state).toMatchObject({
      phase: 'running',
      alive: true,
      http: 200,
      branch: 'dev',
      commit: 'abc1234',
      changedFiles: 2,
      logs: 'ready',
    });
    expect(readStatus('<<<phase>>>\nabsent\n').phase).toBe('absent');
    expect(redact('key=dev-value-abcdef1234 ok', ['dev-value-abcdef1234'])).toBe('key=•••• ok');
  });
});

/** The real commands in a real shell: clone, start, status, change, push, stop (Linux, as on servers). */
describe.skipIf(process.platform === 'win32')('the dev loop commands in a real shell', () => {
  it('clones on dev, runs the dev server, sees a change, pushes to dev only, stops', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pono-dev-'));
    const home = join(root, 'home');
    const origin = join(root, 'origin.git');
    const seed = join(root, 'seed');
    const sh = (command: string) =>
      execFileSync('sh', ['-c', command], {
        env: { ...process.env, HOME: home },
        encoding: 'utf8',
      });
    const port = 41000 + Math.floor(Math.random() * 2000);
    sh(`mkdir -p "${home}" "${seed}" && git init -q --bare -b main "${origin}"`);
    writeFileSync(
      join(seed, 'server.js'),
      "const fs=require('fs');require('http').createServer((q,r)=>r.end(fs.readFileSync('message.txt'))).listen(process.env.PORT);\n",
    );
    writeFileSync(join(seed, 'message.txt'), 'hello');
    writeFileSync(
      join(seed, 'pono.yaml'),
      `version: 1\nname: probe\ndev:\n  command: node server.js\n  port: ${port}\n`,
    );
    sh(
      `cd "${seed}" && git init -q -b main && git add -A && git -c user.name=t -c user.email=t@t commit -qm seed && git push -q "${origin}" main`,
    );

    const repository = 'jc/probe';
    const out = sh(
      prepareCommand({
        repository,
        url: origin,
        header: 'X-Test: 1',
        defaultBranch: 'main',
        author: { name: 'Pono', email: 'p@pono.test' },
      }),
    );
    const seen = readPrepared(out);
    expect(seen.files).toContain('server.js');
    expect(seen.manifest).toContain(`port: ${port}`);
    const plan = devPlan({
      manifestDev: { command: 'node server.js', port },
      packageJson: seen.packageJson,
      files: seen.files,
    });

    const child = spawn(
      'sh',
      ['-c', startCommand({ repository, plan: plan!, hostSuffix: '.servers.test' })],
      {
        env: { ...process.env, HOME: home },
        stdio: 'ignore',
        detached: true,
      },
    );
    child.unref();
    let state = readStatus(sh(statusCommand(repository, port)));
    for (let i = 0; i < 50 && state.phase !== 'running'; i++) {
      await new Promise((r) => setTimeout(r, 200));
      state = readStatus(sh(statusCommand(repository, port)));
    }
    expect(state).toMatchObject({ phase: 'running', alive: true, http: 200, branch: 'dev' });
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe('hello');

    const dir = join(home, 'work', 'probe');
    writeFileSync(join(dir, 'message.txt'), 'changed on the server');
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe('changed on the server');
    const staged = sh(stagedCommand(repository))
      .split('\n')
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l));
    expect(staged).toEqual([{ path: 'message.txt', content: 'changed on the server' }]);
    expect(staged.map((f: { path: string }) => f.path)).not.toContain('.pono/dev.log');
    sh(pushCommand(repository, 'X-Test: 1', 'Change the message'));
    expect(sh(`git --git-dir="${origin}" show dev:message.txt`)).toBe('changed on the server');
    expect(sh(`git --git-dir="${origin}" show main:message.txt`)).toBe('hello');

    sh(stopCommand(repository));
    // The process group takes a moment to end: wait for it, as a person would.
    state = readStatus(sh(statusCommand(repository, port)));
    for (let i = 0; i < 25 && (state.alive || state.phase !== 'stopped'); i++) {
      await new Promise((r) => setTimeout(r, 200));
      state = readStatus(sh(statusCommand(repository, port)));
    }
    expect(state).toMatchObject({ phase: 'stopped', alive: false });
    expect(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8')).toContain('.pono/');
  }, 30_000);
});

let t: TestApp;
beforeAll(() => {
  t = testApp();
});
afterAll(async () => t.pool.end());

async function withServer() {
  const cookie = await signIn(t, `d${randomUUID().slice(0, 8)}`);
  await call(t, cookie, '/v1/connections', {
    method: 'POST',
    body: { provider: 'code', fields: { token: 'good' } },
  });
  const name = `dev-${randomUUID().slice(0, 6)}`;
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
  const { id } = await (
    await call(t, cookie, '/v1/projects', { method: 'POST', body: { repository: fullName } })
  ).json();
  const res = await call(t, cookie, `/v1/projects/${id}/server`, {
    method: 'POST',
    body: { agent: 'claude-code' },
  });
  const { server } = await res.json();
  return { cookie, id: id as string, fullName, serverId: server.id as string };
}

const prepared = (manifest: string) => ({
  exitCode: 0,
  stdout: `<<<files>>>\npono.yaml\n<<<package>>>\n<<<manifest>>>\n${manifest}`,
  stderr: '',
});

describe('the dev loop through Pono', () => {
  it('starts the dev server from pono.yaml, publishes its port, and never writes the token anywhere it stays', async () => {
    const p = await withServer();
    t.world.shell = (command) =>
      command.includes('<<<files>>>')
        ? prepared('version: 1\nname: x\ndev:\n  command: node server.js\n  port: 4000\n')
        : command.includes('<<<phase>>>')
          ? {
              exitCode: 0,
              stdout:
                '<<<phase>>>\nstarting\n<<<alive>>>\nyes\n<<<http>>>\n200\n<<<branch>>>\ndev\nabc\n0\n<<<logs>>>\nready\n',
              stderr: '',
            }
          : { exitCode: 0, stdout: '', stderr: '' };
    const res = await call(t, p.cookie, `/v1/projects/${p.id}/dev/start`, { method: 'POST' });
    expect(res.status).toBe(200);
    const view = await res.json();
    expect(view).toMatchObject({ phase: 'running', http: 200, port: 4000 });
    // Private (D-031): the address opens through Pono; no port stays open to the internet.
    expect(view.previewUrl).toBe(`http://console.test/v1/projects/${p.id}/preview`);
    expect(view.private).toBe(true);
    expect(t.world.unpublished.some((u) => u.endsWith(':4000'))).toBe(true);
    const sent = t.world.commands.filter((c) => c.command.includes(p.fullName.split('/')[1]!));
    expect(
      sent.some(
        (c) =>
          c.command.includes('clone') && c.command.includes(`https://code.test/${p.fullName}.git`),
      ),
    ).toBe(true);
    const start = t.world.commands.find((c) => c.background)!;
    expect(start.command).toContain('PORT=4000');
    expect(start.command).toContain("__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS='.servers.test'");
    expect(start.command).not.toContain('AUTHORIZATION');
    const preview = await call(t, p.cookie, `/v1/projects/${p.id}/preview`);
    expect(preview.headers.get('location')).toMatch(/-4000\.servers\.test\/\?token=t43200$/);
    const shared = await call(t, p.cookie, `/v1/projects/${p.id}/preview/share`, {
      method: 'POST',
      body: { hours: 24 },
    });
    expect(await shared.json()).toMatchObject({
      shared: true,
      url: expect.stringMatching(/token=t86400$/),
    });
    const tooLong = await call(t, p.cookie, `/v1/projects/${p.id}/preview/share`, {
      method: 'POST',
      body: { hours: 500 },
    });
    expect(tooLong.status).toBe(400);
  });

  it('refuses to push a secret, naming file and line, never the value', async () => {
    const p = await withServer();
    const leaked = 'sk_live_' + 'c'.repeat(24);
    t.world.shell = (command) =>
      command.includes('git diff --cached')
        ? {
            exitCode: 0,
            stdout: `${JSON.stringify({ path: 'src/pay.ts', content: `const k = '${leaked}';` })}\n`,
            stderr: '',
          }
        : { exitCode: 0, stdout: '', stderr: '' };
    const res = await (
      await call(t, p.cookie, `/v1/projects/${p.id}/dev/push`, {
        method: 'POST',
        body: { message: 'pay' },
      })
    ).json();
    expect(res).toMatchObject({ pushed: false, files: 1 });
    expect(res.findings[0]).toMatchObject({ file: 'src/pay.ts', line: 1 });
    expect(JSON.stringify(res)).not.toContain(leaked);
    expect(
      t.world.commands.some(
        (c) => c.command.includes('git commit') && c.command.includes(p.fullName.split('/')[1]!),
      ),
    ).toBe(false);
  });

  it('says what to do when the server sleeps or nothing says how the project runs', async () => {
    const p = await withServer();
    t.world.shell = (command) =>
      command.includes('<<<files>>>') ? prepared('') : { exitCode: 0, stdout: '', stderr: '' };
    const unknown = await call(t, p.cookie, `/v1/projects/${p.id}/dev/start`, { method: 'POST' });
    expect((await unknown.json()).error.code).toBe('dev.unknown');
    await call(t, p.cookie, `/v1/servers/${p.serverId}/sleep`, { method: 'POST' });
    const asleep = await call(t, p.cookie, `/v1/projects/${p.id}/dev`);
    expect((await asleep.json()).error.code).toBe('dev.server_asleep');
  });

  it('pulls a push to dev made elsewhere, on a signed event only', async () => {
    const p = await withServer();
    t.world.shell = (command) =>
      command.includes('<<<files>>>')
        ? prepared('version: 1\nname: x\ndev:\n  command: node s.js\n  port: 4100\n')
        : command.includes('pull --ff-only')
          ? { exitCode: 0, stdout: 'f00d123\n', stderr: '' }
          : { exitCode: 0, stdout: '', stderr: '' };
    await call(t, p.cookie, `/v1/projects/${p.id}/dev/start`, { method: 'POST' });
    const hooked = createApp({ ...t.deps, webhookSecret: 'a-webhook-secret-of-test' });
    const body = JSON.stringify({ ref: 'refs/heads/dev', repository: { full_name: p.fullName } });
    const sign = (s: string) => `sha256=${createHmac('sha256', s).update(body).digest('hex')}`;
    const bad = await hooked.request('/hooks/code', {
      method: 'POST',
      body,
      headers: { 'x-hub-signature-256': sign('wrong-secret-wrong') },
    });
    expect(bad.status).toBe(401);
    const good = await hooked.request('/hooks/code', {
      method: 'POST',
      body,
      headers: {
        'x-hub-signature-256': sign('a-webhook-secret-of-test'),
        'x-github-event': 'push',
      },
    });
    expect(await good.json()).toEqual({ pulled: 1 });
    const detail = await (await call(t, p.cookie, `/v1/projects/${p.id}`)).json();
    expect(detail.journal.find((j: { action: string }) => j.action === 'dev.pulled').channel).toBe(
      'system',
    );
  });
});

describe('the agent sees what it builds (D-038)', () => {
  it('runs a plain Node server under --watch, and says when the preview follows the files', async () => {
    const { watching, reloads } = await import('../src/features/devloop/domain.js');
    expect(watching('node server.mjs')).toBe('node --watch server.mjs');
    expect(watching('node --watch server.mjs')).toBe('node --watch server.mjs');
    expect(watching('npx --yes pnpm@10 dev')).toBe('npx --yes pnpm@10 dev');
    expect(reloads('node --watch server.mjs')).toBe(true);
    expect(reloads('npx --yes pnpm@10 run dev --host 0.0.0.0')).toBe(true);
    expect(reloads('vite --port 3000')).toBe(true);
    expect(reloads('npx --yes pnpm@10 dev')).toBe(true);
    expect(reloads('npm run dev')).toBe(true);
    expect(reloads('pnpm devtools')).toBe(false);
    expect(reloads('python3 -m http.server 3000')).toBe(false);
    expect(reloads(null)).toBe(false);
  });

  it('reads a capture of the preview, its answer and console errors; says when there is no browser', async () => {
    const { readShot, shotCommand, PREVIEW_PATH } = await import('../src/features/devloop/shot.js');
    const img = Buffer.from('jpeg-bytes').toString('base64');
    expect(
      readShot(`noise\n<<<meta>>>{"status":200,"errors":["boom"]}\n<<<shot>>>${img}\n`),
    ).toEqual({ ok: true, image: img, status: 200, errors: ['boom'] });
    expect(readShot('<<<shot>>>no_browser\n')).toEqual({ ok: false, reason: 'no_browser' });
    expect(readShot('Traceback…')).toEqual({ ok: false, reason: 'no_answer' });
    expect(shotCommand({ port: 3000, path: '/blog', device: 'mobile' })).toContain(
      '"url":"http://127.0.0.1:3000/blog","width":390',
    );
    expect(PREVIEW_PATH.test('/a/b?x=1')).toBe(true);
    expect(PREVIEW_PATH.test('http://evil.test')).toBe(false);
    expect(PREVIEW_PATH.test("/'; rm -rf /")).toBe(false);
  });

  it('captures through the API, and refuses a path that leaves the site', async () => {
    const p = await withServer();
    const img = Buffer.from('jpeg').toString('base64');
    t.world.shell = (command) =>
      command.includes('<<<files>>>')
        ? prepared('version: 1\nname: x\ndev:\n  command: node server.mjs\n  port: 4000\n')
        : command.includes('/usr/bin/python3 -c')
          ? {
              exitCode: 0,
              stdout: `<<<meta>>>{"status":200,"errors":[]}\n<<<shot>>>${img}\n`,
              stderr: '',
            }
          : { exitCode: 0, stdout: '', stderr: '' };
    await call(t, p.cookie, `/v1/projects/${p.id}/dev/start`, { method: 'POST' });
    const start = t.world.commands.filter((c) => c.background).pop()!;
    expect(start.command).toContain('node --watch server.mjs');
    const { previewShot } = await import('../src/features/devloop/index.js');
    const me = await (await call(t, p.cookie, '/v1/me')).json();
    const actor = {
      personId: me.person.id,
      organizationId: me.organization.id,
      login: me.person.login,
      name: null,
      channel: 'mcp' as const,
    };
    const shot = await previewShot(t.deps as never, actor as never, p.id, {
      path: '/',
      device: 'desktop',
    });
    expect(shot).toMatchObject({ image: img, status: 200, errors: [] });
    await expect(
      previewShot(t.deps as never, actor as never, p.id, { path: 'http://x', device: 'desktop' }),
    ).rejects.toMatchObject({ code: 'preview.bad_path' });
  });
});
