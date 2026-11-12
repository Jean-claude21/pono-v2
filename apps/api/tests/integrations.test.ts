import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { serve, type ServerType } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, signIn, testApp, type TestApp } from './support/app.js';

const run = promisify(execFile);
const SCRIPT = fileURLToPath(
  new URL('../../../integrations/claude-code/scripts/pono.mjs', import.meta.url),
);

let t: TestApp;
let server: ServerType;
let base: string;
beforeAll(async () => {
  t = testApp();
  server = serve({ fetch: t.app.fetch, port: 0 });
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.close();
  await t.pool.end();
});

describe('the Claude Code plugin script (D-021)', () => {
  it('tells a session which Pono project its folder is, and fits one status line', async () => {
    const cookie = await signIn(t, `i${randomUUID().slice(0, 8)}`);
    await call(t, cookie, '/v1/connections', {
      method: 'POST',
      body: { provider: 'code', fields: { token: 'good' } },
    });
    const name = `plug-${randomUUID().slice(0, 6)}`;
    t.world.repositories.push({
      fullName: `jc/${name}`,
      name,
      defaultBranch: 'main',
      url: '',
      private: true,
      pushedAt: null,
    });
    t.world.files.set(`jc/${name}`, { 'pono.yaml': `version: 1\nname: ${name}\n` });
    const { id } = await (
      await call(t, cookie, '/v1/projects', { method: 'POST', body: { repository: `jc/${name}` } })
    ).json();
    await call(t, cookie, `/v1/projects/${id}/server`, {
      method: 'POST',
      body: { agent: 'claude-code' },
    });
    const { token } = await (
      await call(t, cookie, '/v1/agents', {
        method: 'POST',
        body: { name: 'Claude Code', scope: 'read' },
      })
    ).json();

    const folder = mkdtempSync(join(tmpdir(), 'pono-plugin-'));
    execFileSync('git', ['init', '-q'], { cwd: folder });
    execFileSync('git', ['remote', 'add', 'origin', `git@github.com:jc/${name}.git`], {
      cwd: folder,
    });
    const env = { ...process.env, PONO_URL: base, PONO_TOKEN: token };

    const context = await run('node', [SCRIPT, 'context'], { cwd: folder, env });
    expect(context.stdout).toContain(`Pono project « ${name} »`);
    expect(context.stdout).toContain('Its Pono server is running');
    expect(context.stdout).toContain('you never merge to production yourself');
    expect(context.stdout).toContain('check_secrets');

    const line = await run('node', [SCRIPT, 'statusline'], { cwd: folder, env });
    expect(line.stdout).toBe(`pono · ${name} · server running · release ask`);

    const elsewhere = mkdtempSync(join(tmpdir(), 'pono-plugin-'));
    const silent = await run('node', [SCRIPT, 'context'], { cwd: elsewhere, env });
    expect(silent.stdout).toBe('');
    const noToken = await run('node', [SCRIPT, 'context'], {
      cwd: folder,
      env: { ...process.env, PONO_URL: base },
    });
    expect(noToken.stdout).toBe('');
  }, 30_000);
});
