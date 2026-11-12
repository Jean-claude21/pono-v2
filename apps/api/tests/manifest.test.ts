import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  prefill,
  readLegacy,
  readManifest,
  resolveSkills,
  writeManifest,
} from '../src/features/manifest/domain.js';
import { call, signIn, testApp, type TestApp } from './support/app.js';

describe('pono.yaml (D-014)', () => {
  it('reads a manifest and writes it back the same', () => {
    const text = writeManifest({
      version: 1,
      name: 'lectio',
      environments: {
        production: { branch: 'main', hosting: 'netlify', site: 's1', url: 'https://lectio.app' },
      },
      database: { provider: 'neon', project: 'p1', branches: { production: 'main' } },
      skills: { use: ['safe-migrations'], off: ['seo'] },
      release: { declared_destructions: ['db/0004.sql'] },
      analytics: { provider: 'umami', website: 'w1' },
    });
    expect(text.startsWith('# yaml-language-server: $schema=')).toBe(true);
    const reading = readManifest(text);
    expect(reading.ok && reading.manifest.environments?.production?.site).toBe('s1');
  });

  it('names every problem, and refuses the release mode in the repository', () => {
    const bad = readManifest('version: 1\nname: x\nhosting: netlify\n');
    expect(bad.ok).toBe(false);
    const mode = readManifest('version: 1\nname: x\nrelease:\n  mode: bypass\n');
    expect(!mode.ok && mode.problems[0]!.path).toBe('release.mode');
    expect(readManifest(': : :').ok).toBe(false);
  });

  it('pre-fills from Fluxio, Livio and the studio, detection only completing', () => {
    const fluxio = readLegacy(
      '.fluxio/project.json',
      JSON.stringify({
        fluxioVersion: 1,
        slug: 'flux',
        github: { defaultBranch: 'main', devBranch: 'dev' },
        netlify: { siteId: 'n1', url: 'https://flux.app' },
        neon: { projectId: 'np', branches: { main: 'b1', dev: 'b2' } },
      }),
    );
    const m = prefill(
      {
        repositoryName: 'repo',
        defaultBranch: 'main',
        hosting: { provider: 'cloudflare', site: 'c9', url: null, branch: 'main' },
        database: null,
      },
      fluxio,
    );
    expect(m.name).toBe('flux');
    expect(m.environments?.production).toMatchObject({ hosting: 'netlify', site: 'n1' });
    expect(m.database).toMatchObject({ provider: 'neon', project: 'np' });

    const livio = readLegacy(
      'stack.hcl',
      'livio { version = "1" }\nproject { name = "liv" }\ndatabase {\n  provider = "neon"\n  branches { prod = "main" }\n}\n',
    );
    expect(livio).toMatchObject({ source: 'livio', name: 'liv', database: { provider: 'neon' } });
    expect(readLegacy('project.yaml', 'name: studio\n')).toMatchObject({ name: 'studio' });
    expect(readLegacy('stack.hcl', 'nothing = "here"')).toBeNull();
  });

  it('turns opinion skills on for a template, off for an adopted project', () => {
    const catalog = [
      { name: 'safe', family: 'safety' as const },
      { name: 'arch', family: 'opinion' as const },
      { name: 'look', family: 'design' as const },
    ];
    const template = resolveSkills(catalog, 'template', ['safe', 'arch', 'look'], undefined);
    expect(template.every((s) => s.active)).toBe(true);
    const adopted = resolveSkills(catalog, 'adopted', [], undefined);
    expect(adopted.map((s) => s.active)).toEqual([true, false, false]);
    const chosen = resolveSkills(catalog, 'adopted', [], { use: ['look'], off: ['safe'] });
    expect(chosen.map((s) => [s.active, s.because])).toEqual([
      [false, 'turned_off'],
      [false, 'not_chosen'],
      [true, 'chosen'],
    ]);
  });
});

let t: TestApp;
beforeAll(() => {
  t = testApp();
});
afterAll(async () => t.pool.end());

async function workshop(): Promise<string> {
  const cookie = await signIn(t, `m${randomUUID().slice(0, 8)}`);
  await call(t, cookie, '/v1/connections', {
    method: 'POST',
    body: { provider: 'code', fields: { token: 'good' } },
  });
  return cookie;
}

function repository(name: string, files: Record<string, string> = {}) {
  const fullName = `jc/${name}`;
  t.world.repositories.push({
    fullName,
    name,
    defaultBranch: 'main',
    url: '',
    private: true,
    pushedAt: null,
  });
  t.world.files.set(fullName, files);
  return fullName;
}

async function importIt(cookie: string, fullName: string): Promise<string> {
  const res = await call(t, cookie, '/v1/projects', {
    method: 'POST',
    body: { repository: fullName },
  });
  expect(res.status).toBe(201);
  return (await res.json()).id;
}

describe('adopting any repository', () => {
  it('proposes a pre-filled pono.yaml when the repository has none', async () => {
    const cookie = await workshop();
    const name = `adopt-${randomUUID().slice(0, 6)}`;
    const fullName = repository(name, {
      'stack.hcl': 'livio { v = "1" }\nproject { name = "lectio" }\n',
    });
    const id = await importIt(cookie, fullName);

    const opened = t.world.opened.get(fullName)!;
    expect(opened.branch).toBe('pono/manifest');
    const proposed = readManifest(opened.files['pono.yaml']!);
    expect(proposed.ok && proposed.manifest.name).toBe('lectio');
    expect(proposed.ok && proposed.manifest.skills?.use).toContain('safe-migrations');
    expect(proposed.ok && proposed.manifest.skills?.use).not.toContain('feature-architecture');

    const view = await (await call(t, cookie, `/v1/projects/${id}/manifest`)).json();
    expect(view).toMatchObject({ status: 'proposed', origin: 'adopted' });
    expect(view.proposalUrl).toContain('/pull/');
    const arch = view.skills.find((s: { name: string }) => s.name === 'feature-architecture');
    expect(arch).toMatchObject({ active: false, family: 'opinion' });
  });

  it('reads the file once merged, and it fills what detection missed', async () => {
    const cookie = await workshop();
    const name = `has-${randomUUID().slice(0, 6)}`;
    const fullName = repository(name, {
      'pono.yaml':
        'version: 1\nname: has\nenvironments:\n  production:\n    hosting: host\n    site: s-77\ndatabase:\n  provider: db\n  project: p-77\nskills:\n  use: [feature-architecture]\n',
    });
    const id = await importIt(cookie, fullName);
    expect(t.world.opened.has(fullName)).toBe(false);
    const view = await (await call(t, cookie, `/v1/projects/${id}/manifest`)).json();
    expect(view.status).toBe('present');
    expect(
      view.skills.find((s: { name: string }) => s.name === 'feature-architecture').active,
    ).toBe(true);
    const { project } = await (await call(t, cookie, `/v1/projects/${id}`)).json();
    expect(project.hosting).toMatchObject({ provider: 'host', status: 'found' });
    expect(project.database).toMatchObject({ provider: 'db', status: 'found' });
  });

  it('says what is wrong with an invalid file, and proposes nothing over it', async () => {
    const cookie = await workshop();
    const fullName = repository(`bad-${randomUUID().slice(0, 6)}`, {
      'pono.yaml': 'version: 1\nname: bad\nrelease:\n  mode: bypass\n',
    });
    const id = await importIt(cookie, fullName);
    const view = await (await call(t, cookie, `/v1/projects/${id}/manifest`)).json();
    expect(view.status).toBe('invalid');
    expect(view.problems[0].path).toBe('release.mode');
    expect(t.world.opened.has(fullName)).toBe(false);
  });

  it('proposes a skills change in the file, never writes it directly', async () => {
    const cookie = await workshop();
    const fullName = repository(`sk-${randomUUID().slice(0, 6)}`, {
      'pono.yaml': 'version: 1\nname: sk\nskills:\n  use: [safe-migrations]\n',
    });
    const id = await importIt(cookie, fullName);
    const res = await call(t, cookie, `/v1/projects/${id}/skills`, {
      method: 'PUT',
      body: { use: ['impeccable'], off: ['safe-migrations'] },
    });
    expect(res.status).toBe(200);
    const opened = t.world.opened.get(fullName)!;
    expect(opened.branch).toBe('pono/skills');
    const next = readManifest(opened.files['pono.yaml']!);
    expect(next.ok && next.manifest.skills).toMatchObject({
      use: ['impeccable'],
      off: ['safe-migrations'],
    });
    expect(t.world.files.get(fullName)!['pono.yaml']).toContain('safe-migrations');
    const unknown = await call(t, cookie, `/v1/projects/${id}/skills`, {
      method: 'PUT',
      body: { use: ['nothing'] },
    });
    expect(unknown.status).toBe(404);
  });

  it('a launched project reads its own manifest at once, as a template project', async () => {
    const cookie = await workshop();
    const name = `tpl-${randomUUID().slice(0, 6)}`;
    const res = await call(t, cookie, '/v1/launch', {
      method: 'POST',
      body: { template: 'booking', name },
    });
    expect(res.status).toBe(201);
    const { projectId } = await res.json();
    const view = await (await call(t, cookie, `/v1/projects/${projectId}/manifest`)).json();
    expect(view).toMatchObject({ status: 'present', origin: 'template', template: 'booking' });
    expect(view.manifest).not.toHaveProperty('release.mode');
    expect(
      view.skills.find((s: { name: string }) => s.name === 'feature-architecture').active,
    ).toBe(true);
  });
});

describe('importing without a proposal', () => {
  it('follows the project and proposes pono.yaml only when asked', async () => {
    const cookie = await workshop();
    const fullName = repository(`quiet-${randomUUID().slice(0, 6)}`);
    const res = await call(t, cookie, '/v1/projects', {
      method: 'POST',
      body: { repository: fullName, proposeManifest: false },
    });
    const { id } = await res.json();
    expect(t.world.opened.has(fullName)).toBe(false);
    expect((await (await call(t, cookie, `/v1/projects/${id}/manifest`)).json()).status).toBe(
      'missing',
    );
    await call(t, cookie, `/v1/projects/${id}/manifest/sync`, { method: 'POST' });
    expect(t.world.opened.get(fullName)!.branch).toBe('pono/manifest');
  });
});
