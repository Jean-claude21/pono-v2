import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  loadCatalog,
  parseSkillFile,
  renderSkillFile,
  skillInput,
} from '../src/features/catalog/index.js';
import { LIMITS, readCode, TOOLBOX } from '../src/features/devloop/code.js';
import { call, signIn, testApp, type TestApp } from './support/app.js';

describe('skills as the Agent Skills standard keeps them (D-028)', () => {
  it('reads a SKILL.md: front matter, family, body; refuses what breaks the rules', () => {
    const skill = parseSkillFile(
      '---\nname: clear-copy\ndescription: Write plain words. Use for any visible text.\nmetadata:\n  family: design\n---\n\nShort sentences.\n',
      'clear-copy',
    );
    expect(skill).toEqual({
      name: 'clear-copy',
      family: 'design',
      description: 'Write plain words. Use for any visible text.',
      body: 'Short sentences.',
    });
    expect(parseSkillFile(renderSkillFile(skill))).toEqual(skill);
    expect(() => parseSkillFile('no front matter')).toThrow(/front matter/);
    expect(() => parseSkillFile('---\nname: Bad_Name\ndescription: x\n---\nb')).toThrow(
      /lowercase/,
    );
    expect(() =>
      parseSkillFile('---\nname: ok-name\ndescription: d\n---\nb', 'other-folder'),
    ).toThrow(/folder/);
    expect(() => parseSkillFile('---\nname: ok-name\n---\nb')).toThrow(/description/);
  });

  it("loads Pono's skills from their folders, with their files", () => {
    const { skills } = loadCatalog();
    const basics = skills.find((s) => s.name === 'pono-basics')!;
    expect(basics.family).toBe('safety');
    expect(Object.keys(basics.files ?? {})).toEqual(['references/workbench.md']);
    expect(basics.body).toContain('references/workbench.md');
    expect(skills.length).toBeGreaterThanOrEqual(11);
  });

  it('accepts files only under references, scripts and assets', () => {
    const base = {
      name: 'my-way',
      family: 'opinion',
      description: 'How we do it here.',
      body: 'x'.repeat(30),
    };
    expect(skillInput.safeParse({ ...base, files: { 'references/a.md': 'a' } }).success).toBe(true);
    expect(skillInput.safeParse({ ...base, files: { 'src/a.ts': 'a' } }).success).toBe(false);
    expect(skillInput.safeParse({ ...base, files: { 'references/../x': 'a' } }).success).toBe(
      false,
    );
  });

  it('installs skills on the server where agents look, out of git, never over the repository’s own', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pono-skills-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    mkdirSync(join(dir, '.claude', 'skills', 'mine'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'skills', 'mine', 'SKILL.md'), 'their own');
    const run = (skills: unknown) =>
      readCode(
        execFileSync(process.execPath, ['-e', TOOLBOX], {
          cwd: dir,
          env: {
            ...process.env,
            PONO_IN: Buffer.from(JSON.stringify({ op: 'skills', skills, limits: LIMITS })).toString(
              'base64',
            ),
          },
          encoding: 'utf8',
        }),
      );
    const answer = run([
      {
        name: 'pono-basics',
        text: '---\nname: pono-basics\n---\nx',
        files: { 'references/w.md': 'w' },
      },
      { name: 'mine', text: 'replaced?', files: {} },
    ]);
    expect(answer.installed).toEqual([
      '.claude/skills/pono-basics',
      '.agents/skills/pono-basics',
      '.agents/skills/mine',
    ]);
    expect(
      readFileSync(join(dir, '.claude', 'skills', 'pono-basics', 'references', 'w.md'), 'utf8'),
    ).toBe('w');
    expect(readFileSync(join(dir, '.claude', 'skills', 'mine', 'SKILL.md'), 'utf8')).toBe(
      'their own',
    );
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(status).not.toContain('pono-basics');
    expect(status).toContain('.claude/skills/mine');
    expect(run([{ name: 'pono-basics', text: 'again', files: {} }]).installed).toHaveLength(2);
  });
});

let t: TestApp;
beforeAll(() => {
  t = testApp();
});
afterAll(async () => t.pool.end());

async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  const client = new Client({ name: 'skills-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://pono.test/mcp'), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: (url, init) =>
        Promise.resolve(
          t.app.request(String(url).replace('http://pono.test', ''), init as RequestInit),
        ),
    }),
  );
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  await client.close();
  return { error: result.isError === true, body: JSON.parse(result.content[0]!.text) };
}

describe('skills over MCP, a little at a time (D-028)', () => {
  it('lists names and descriptions, then the body, then a file on demand; keeps a new skill with its files', async () => {
    const cookie = await signIn(t, `s${randomUUID().slice(0, 8)}`);
    const { token } = await (
      await call(t, cookie, '/v1/agents', {
        method: 'POST',
        body: { name: 'Claude', scope: 'act' },
      })
    ).json();

    const listed = await tool(token, 'list_skills');
    const basics = listed.body.skills.find((s: { name: string }) => s.name === 'pono-basics');
    expect(basics).toMatchObject({ family: 'safety', files: ['references/workbench.md'] });
    expect(basics.body).toBeUndefined();

    const got = await tool(token, 'get_skill', { name: 'pono-basics' });
    expect(got.body.body).toContain('dev');
    expect(got.body.files).toEqual(['references/workbench.md']);

    const file = await tool(token, 'get_skill_file', {
      name: 'pono-basics',
      path: 'references/workbench.md',
    });
    expect(file.body.content).toContain('apply_patch');
    expect(
      await tool(token, 'get_skill_file', { name: 'pono-basics', path: 'references/none.md' }),
    ).toMatchObject({ error: true });

    const created = await tool(token, 'create_skill', {
      name: 'house-style',
      family: 'design',
      description: 'Our colours and tone. Use for any visible change.',
      body: 'Calm, plain words; one accent colour.',
      files: { 'references/palette.md': '# Palette' },
    });
    expect(created.error).toBe(false);
    const again = await tool(token, 'get_skill_file', {
      name: 'house-style',
      path: 'references/palette.md',
    });
    expect(again.body.content).toBe('# Palette');
  });
});
