import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  codeCommand,
  jobCommand,
  readCode,
  readRun,
  runCommand,
  safePath,
} from '../src/features/devloop/code.js';
import { call, signIn, testApp, type TestApp } from './support/app.js';

describe('paths the agent gives (D-027)', () => {
  it('keeps them inside the repository, away from .git, node_modules and .pono', () => {
    expect(safePath('src/app.ts')).toBe('src/app.ts');
    expect(safePath('./src//app.ts')).toBe('src/app.ts');
    expect(safePath('src\\app.ts')).toBe('src/app.ts');
    for (const bad of [
      '',
      '/etc/passwd',
      'C:/Windows',
      '../secret',
      'src/../../x',
      '.git/config',
      'node_modules/x/index.js',
      '.pono/run.log',
      'a\0b',
    ])
      expect(safePath(bad)).toBeNull();
  });

  it('reads what a command printed: exit code, time out, background job', () => {
    expect(readRun('<<<not_ready>>>')).toMatchObject({ ready: false });
    expect(readRun('<<<exit>>>0\nok')).toMatchObject({ done: true, exitCode: 0, output: 'ok' });
    expect(readRun('<<<exit>>>124\n')).toMatchObject({ timedOut: true });
    expect(readRun('<<<job>>>1731500000123')).toMatchObject({ job: '1731500000123', done: false });
    expect(readRun('still going')).toMatchObject({ done: false, output: 'still going' });
    expect(readCode('noise\n{"total":1}\n')).toEqual({ total: 1 });
    expect(readCode('')).toEqual({ error: 'no_answer' });
  });
});

/** The real commands in a real git repository and shell (Linux, as on project servers). */
describe.skipIf(process.platform === 'win32')('the hand that writes, in a real shell', () => {
  const root = mkdtempSync(join(tmpdir(), 'pono-code-'));
  const home = join(root, 'home');
  const dir = join(home, 'work', 'probe');
  const repository = 'jc/probe';
  const sh = (command: string) =>
    execFileSync('sh', ['-c', command], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  const op = (input: Parameters<typeof codeCommand>[1]) =>
    readCode(sh(codeCommand(repository, input)));

  beforeAll(() => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'app.ts'), 'const title = "Hello";\nexport { title };\n');
    writeFileSync(join(dir, 'src', 'page.tsx'), 'export const Page = () => <h1>Hi</h1>;\n');
    writeFileSync(join(dir, 'README.md'), 'one\ntwo\nthree\nfour\nfive\n');
    writeFileSync(join(dir, 'crlf.txt'), 'alpha\r\nbeta\r\n');
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'x', 'index.js'), 'ignored');
    sh(
      `cd "${dir}" && git init -q -b dev && mkdir -p .pono && echo '.pono/' >> .git/info/exclude && git add -A && git -c user.name=t -c user.email=t@t commit -qm seed`,
    );
  });

  it('lists files without ignored ones, narrowed by folder and glob', () => {
    const all = op({ op: 'list', path: null, pattern: null });
    expect(all.files).toEqual(
      expect.arrayContaining(['src/app.ts', 'src/page.tsx', 'README.md', 'crlf.txt']),
    );
    expect(JSON.stringify(all.files)).not.toContain('node_modules');
    expect(op({ op: 'list', path: 'src', pattern: '*.tsx' }).files).toEqual(['src/page.tsx']);
    expect(op({ op: 'list', path: null, pattern: 'src/**/*.ts' }).files).toEqual(['src/app.ts']);
  });

  it('reads by ranges, lines numbered', () => {
    const part = op({ op: 'read', path: 'README.md', offset: 2, limit: 2 });
    expect(part).toMatchObject({ from: 2, to: 3, totalLines: 6, truncated: true });
    expect(part.content).toBe('     2\ttwo\n     3\tthree');
    expect(op({ op: 'read', path: 'nope.txt', offset: 1, limit: 10 })).toMatchObject({
      error: 'not_found',
    });
  });

  it('searches content with file and line', () => {
    const found = op({ op: 'search', pattern: 'title', path: null, glob: null, ignoreCase: false });
    expect(found.matches).toEqual([
      'src/app.ts:1:const title = "Hello";',
      'src/app.ts:2:export { title };',
    ]);
    expect(
      op({ op: 'search', pattern: 'HI', path: 'src', glob: '*.tsx', ignoreCase: true }).total,
    ).toBe(1);
  });

  it('edits exactly, all or nothing, with a diff; a dry run writes nothing', () => {
    const preview = op({
      op: 'edit',
      path: 'src/app.ts',
      dryRun: true,
      edits: [{ old: '"Hello"', new: '"Bonjour"', all: false }],
    });
    expect(preview).toMatchObject({ action: 'preview' });
    expect(preview.diff).toContain('+const title = "Bonjour";');
    expect(readFileSync(join(dir, 'src', 'app.ts'), 'utf8')).toContain('"Hello"');

    const missing = op({
      op: 'edit',
      path: 'src/app.ts',
      dryRun: false,
      edits: [
        { old: '"Hello"', new: '"Bonjour"', all: false },
        { old: 'const title = "Helo"', new: 'x', all: false },
      ],
    });
    expect(missing).toMatchObject({ error: 'edit_not_found' });
    expect(readFileSync(join(dir, 'src', 'app.ts'), 'utf8')).toContain('"Hello"');

    expect(
      op({
        op: 'edit',
        path: 'src/app.ts',
        dryRun: false,
        edits: [{ old: 'title', new: 'heading', all: false }],
      }),
    ).toMatchObject({ error: 'edit_ambiguous', count: 2 });

    const done = op({
      op: 'edit',
      path: 'src/app.ts',
      dryRun: false,
      edits: [{ old: 'title', new: 'heading', all: true }],
    });
    expect(done).toMatchObject({ action: 'edited' });
    expect(readFileSync(join(dir, 'src', 'app.ts'), 'utf8')).toBe(
      'const heading = "Hello";\nexport { heading };\n',
    );

    op({
      op: 'edit',
      path: 'crlf.txt',
      dryRun: false,
      edits: [{ old: 'alpha\nbeta', new: 'a\nb', all: false }],
    });
    expect(readFileSync(join(dir, 'crlf.txt'), 'utf8')).toBe('a\r\nb\r\n');
  });

  it('writes, moves and deletes files, then shows the changes', () => {
    expect(
      op({ op: 'write', path: 'src/new/contact.ts', content: 'export const c = 1;\n' }),
    ).toMatchObject({
      action: 'created',
    });
    expect(readFileSync(join(dir, 'src', 'new', 'contact.ts'), 'utf8')).toBe(
      'export const c = 1;\n',
    );
    expect(op({ op: 'move', path: 'README.md', to: 'docs/README.md' })).toMatchObject({
      to: 'docs/README.md',
    });
    expect(op({ op: 'move', path: 'src/page.tsx', to: 'src/app.ts' })).toMatchObject({
      error: 'exists',
    });
    expect(op({ op: 'delete', path: 'crlf.txt' })).toMatchObject({ deleted: 'crlf.txt' });
    const changes = op({ op: 'changes' });
    expect(JSON.stringify(changes.files)).toContain('src/new/');
    expect(changes.diff).toContain('heading');
  });

  it('runs a command, bounded in time, and a background job read later', async () => {
    const ok = readRun(sh(runCommand(repository, 'echo hi && exit 3', 10, false)));
    expect(ok).toMatchObject({ done: true, exitCode: 3, output: 'hi' });
    expect(readRun(sh(runCommand(repository, 'sleep 5', 1, false)))).toMatchObject({
      timedOut: true,
    });
    const started = readRun(sh(runCommand(repository, 'sleep 1; echo later', 10, true)));
    expect(started.job).toMatch(/^\d+$/);
    let job = readRun(sh(jobCommand(repository, started.job!)));
    for (let i = 0; i < 30 && !job.done; i++) {
      await new Promise((r) => setTimeout(r, 200));
      job = readRun(sh(jobCommand(repository, started.job!)));
    }
    expect(job).toMatchObject({ done: true, exitCode: 0, output: 'later' });
  }, 20_000);
});

let t: TestApp;
beforeAll(() => {
  t = testApp();
});
afterAll(async () => t.pool.end());

async function agent(token: string): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('http://pono.test/mcp'), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: (url, init) =>
      Promise.resolve(
        t.app.request(String(url).replace('http://pono.test', ''), init as RequestInit),
      ),
  });
  await client.connect(transport);
  return client;
}

async function tool(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { error: result.isError === true, body: JSON.parse(result.content[0]!.text) };
}

/** A person, a project with an awake server, and agents with each scope. */
async function workshop() {
  const cookie = await signIn(t, `c${randomUUID().slice(0, 8)}`);
  await call(t, cookie, '/v1/connections', {
    method: 'POST',
    body: { provider: 'code', fields: { token: 'good' } },
  });
  const name = `code-${randomUUID().slice(0, 6)}`;
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
  await call(t, cookie, `/v1/projects/${id}/server`, {
    method: 'POST',
    body: { agent: 'claude-code' },
  });
  const token = async (scope: 'read' | 'act') =>
    (
      await (
        await call(t, cookie, '/v1/agents', { method: 'POST', body: { name: scope, scope } })
      ).json()
    ).token as string;
  return { cookie, id: id as string, name, read: await token('read'), act: await token('act') };
}

describe('the hand that writes, through Pono (D-027)', () => {
  it('offers the coding tools, reading to every agent, writing only to one that may act', async () => {
    const w = await workshop();
    t.world.shell = (command) =>
      command.includes('PONO_IN=')
        ? { exitCode: 0, stdout: '{"path":"src/a.ts","action":"edited","diff":"+x"}', stderr: '' }
        : { exitCode: 0, stdout: '', stderr: '' };

    const reader = await agent(w.read);
    const names = (await reader.listTools()).tools.map((x) => x.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_files',
        'read_file',
        'search_code',
        'edit_file',
        'write_file',
        'move_file',
        'delete_file',
        'show_changes',
        'run_command',
        'command_output',
      ]),
    );
    const refused = await tool(reader, 'edit_file', {
      projectId: w.id,
      path: 'src/a.ts',
      edits: [{ old_text: 'a', new_text: 'b' }],
    });
    expect(refused).toMatchObject({
      error: true,
      body: { error: { code: 'agent.scope_insufficient' } },
    });

    const actor = await agent(w.act);
    const edited = await tool(actor, 'edit_file', {
      projectId: w.id,
      path: './src/a.ts',
      edits: [{ old_text: 'a', new_text: 'b' }],
    });
    expect(edited).toMatchObject({ error: false, body: { action: 'edited' } });
    const sent = t.world.commands.filter(
      (c) => c.command.includes(w.name) && c.command.includes('PONO_IN='),
    );
    const payload = JSON.parse(
      Buffer.from(/PONO_IN='([^']+)'/.exec(sent.at(-1)!.command)![1]!, 'base64').toString(),
    );
    expect(payload).toMatchObject({
      op: 'edit',
      path: 'src/a.ts',
      edits: [{ old: 'a', new: 'b' }],
    });

    const outside = await tool(actor, 'write_file', { projectId: w.id, path: '../x', content: '' });
    expect(outside).toMatchObject({ error: true, body: { error: { code: 'code.bad_path' } } });

    const journal = await (await call(t, w.cookie, `/v1/projects/${w.id}`)).json();
    expect(JSON.stringify(journal)).toContain('code.edit');
  });

  it('says to start dev first, and hides development values from what a command prints', async () => {
    const w = await workshop();
    t.world.shell = () => ({ exitCode: 0, stdout: '{"error":"not_ready"}', stderr: '' });
    const actor = await agent(w.act);
    expect(await tool(actor, 'read_file', { projectId: w.id, path: 'a.ts' })).toMatchObject({
      error: true,
      body: { error: { code: 'dev.not_ready' } },
    });
    await call(t, w.cookie, `/v1/projects/${w.id}/variables/API_KEY`, {
      method: 'PUT',
      body: { value: 'dev-secret-value-123456' },
    });
    t.world.shell = () => ({
      exitCode: 0,
      stdout: '<<<exit>>>0\nkey is dev-secret-value-123456',
      stderr: '',
    });
    const ran = await tool(actor, 'run_command', { projectId: w.id, command: 'env' });
    expect(ran.body.output).toBe('key is ••••');
  });
});
