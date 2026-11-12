import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCatalog, parseSkills } from '../src/features/catalog/index.js';
import { call, signIn, testApp, type TestApp } from './support/app.js';

let t: TestApp;
beforeAll(() => {
  t = testApp();
});
afterAll(async () => t.pool.end());

async function workshop(): Promise<string> {
  const cookie = await signIn(t, `l${randomUUID().slice(0, 8)}`);
  await call(t, cookie, '/v1/connections', {
    method: 'POST',
    body: { provider: 'code', fields: { token: 'good' } },
  });
  return cookie;
}

describe('catalog (phase 6)', () => {
  it('reads every skill a template names', () => {
    const catalog = loadCatalog();
    expect(catalog.templates.length).toBeGreaterThanOrEqual(7);
    expect(catalog.skills.map((s) => s.name)).toContain('safe-migrations');
    for (const s of catalog.skills) expect(s.description.length).toBeGreaterThan(10);
  });

  it('parses a skill section', () => {
    expect(
      parseSkills('## a · safety\n_Does a._\n\n- one\n## b · design\n_Does b._\nbody'),
    ).toEqual([
      { name: 'a', family: 'safety', description: 'Does a.', body: '- one' },
      { name: 'b', family: 'design', description: 'Does b.', body: 'body' },
    ]);
    expect(() => parseSkills('## a\n_Does a._\n')).toThrow(/family/);
  });

  it('serves templates and skills to a signed-in person', async () => {
    const cookie = await workshop();
    const templates = await (await call(t, cookie, '/v1/catalog/templates')).json();
    expect(templates.templates.find((x: { id: string }) => x.id === 'booking').skills).toContain(
      'payments',
    );
    const skill = await (await call(t, cookie, '/v1/catalog/skills/no-secrets')).json();
    expect(skill.skill.body).toContain('environment variable');
    expect((await call(t, cookie, '/v1/catalog/skills/nothing')).status).toBe(404);
  });
});

describe('launching a project (phases 4 and 6)', () => {
  it('creates the repository with its manifest, imports it, and gives it a server with the skills', async () => {
    const cookie = await workshop();
    const name = `book-${randomUUID().slice(0, 6)}`;
    const res = await call(t, cookie, '/v1/launch', {
      method: 'POST',
      body: { template: 'booking', name },
    });
    expect(res.status).toBe(201);
    const launched = await res.json();
    expect(launched.repository).toBe(`jc/${name}`);
    expect(launched.server.status).toBe('running');
    expect(launched.durationMs).toBeGreaterThanOrEqual(0);
    expect(t.world.files.get(`jc/${name}`)!['pono.yaml']).toContain('  - payments');
    const hosted = [...t.world.servers.values()].at(-1)!;
    expect(hosted.env).toMatchObject({
      PONO_TEMPLATE: 'booking',
      PONO_SKILLS: expect.stringContaining('safe-migrations'),
    });
    const detail = await (await call(t, cookie, `/v1/projects/${launched.projectId}`)).json();
    expect(detail.journal.map((j: { action: string }) => j.action)).toContain('project.launched');
  });

  it('creates nothing when the plan has no place left', async () => {
    const cookie = await workshop();
    await call(t, cookie, '/v1/launch', {
      method: 'POST',
      body: { template: 'blank', name: `a-${randomUUID().slice(0, 6)}` },
    });
    const before = t.world.repositories.length;
    const res = await call(t, cookie, '/v1/launch', {
      method: 'POST',
      body: { template: 'blank', name: `b-${randomUUID().slice(0, 6)}` },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('servers.limit_reached');
    expect(t.world.repositories.length).toBe(before);
  });

  it('puts the chosen server to sleep when the person says so', async () => {
    const cookie = await workshop();
    const first = await (
      await call(t, cookie, '/v1/launch', {
        method: 'POST',
        body: { template: 'blank', name: `c-${randomUUID().slice(0, 6)}` },
      })
    ).json();
    const res = await call(t, cookie, '/v1/launch', {
      method: 'POST',
      body: {
        template: 'site',
        name: `d-${randomUUID().slice(0, 6)}`,
        sleepServerId: first.server.id,
      },
    });
    expect(res.status).toBe(201);
  });

  it('refuses an unknown template, a bad name, and a taken name', async () => {
    const cookie = await workshop();
    expect(
      (
        await call(t, cookie, '/v1/launch', {
          method: 'POST',
          body: { template: 'nope', name: 'fine-name' },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(t, cookie, '/v1/launch', {
          method: 'POST',
          body: { template: 'blank', name: 'Bad Name' },
        })
      ).status,
    ).toBe(400);
    const name = `e-${randomUUID().slice(0, 6)}`;
    t.world.repositories.push({
      fullName: `jc/${name}`,
      name,
      defaultBranch: 'main',
      url: '',
      private: true,
      pushedAt: null,
    });
    const taken = await call(t, cookie, '/v1/launch', {
      method: 'POST',
      body: { template: 'blank', name },
    });
    expect((await taken.json()).error.code).toBe('launch.name_taken');
  });
});
