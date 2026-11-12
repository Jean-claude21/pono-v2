import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, signIn, testApp, type TestApp } from './support/app.js';

let t: TestApp;
beforeAll(() => {
  t = testApp();
});
afterAll(async () => t.pool.end());

async function workshop(login = `c${randomUUID().slice(0, 8)}`): Promise<string> {
  const cookie = await signIn(t, login);
  await call(t, cookie, '/v1/connections', {
    method: 'POST',
    body: { provider: 'code', fields: { token: 'good' } },
  });
  return cookie;
}

const skill = (name: string, family = 'opinion') => ({
  name,
  family,
  description: 'How we write invoices here.',
  body: '- Every invoice has a number, a date and a total, in the person’s currency.',
});

const names = async (cookie: string, kind: 'skills' | 'templates') => {
  const body = await (await call(t, cookie, `/v1/catalog/${kind}`)).json();
  return (body[kind] as { name?: unknown; id?: string }[]).map((x) => x.id ?? x.name);
};

describe('the catalog on three levels (D-016)', () => {
  it('keeps an organization’s skill to itself, and safety to Pono', async () => {
    const a = await workshop();
    const b = await workshop();
    const name = `invoices-${randomUUID().slice(0, 6)}`;
    const created = await call(t, a, '/v1/catalog/skills', { method: 'POST', body: skill(name) });
    expect(created.status).toBe(201);
    expect(await names(a, 'skills')).toContain(name);
    expect(await names(b, 'skills')).not.toContain(name);
    const safety = await call(t, a, '/v1/catalog/skills', {
      method: 'POST',
      body: skill(`s-${randomUUID().slice(0, 6)}`, 'safety'),
    });
    expect(safety.status).toBe(403);
    const taken = await call(t, a, '/v1/catalog/skills', {
      method: 'POST',
      body: skill('no-secrets'),
    });
    expect(taken.status).toBe(409);
  });

  it('shares only what the operator approves', async () => {
    const a = await workshop();
    const b = await workshop();
    const operator = await workshop('operator');
    const name = `shared-${randomUUID().slice(0, 6)}`;
    await call(t, a, '/v1/catalog/skills', { method: 'POST', body: skill(name) });
    expect((await call(t, a, `/v1/catalog/skills/${name}/share`, { method: 'POST' })).status).toBe(
      204,
    );
    expect(await names(b, 'skills')).not.toContain(name);
    expect((await call(t, a, '/v1/admin/catalog')).status).toBe(403);
    const { entries } = await (await call(t, operator, '/v1/admin/catalog')).json();
    const entry = entries.find((e: { name: string }) => e.name === name);
    expect(entry.sharing).toBe('proposed');
    const review = await call(t, operator, `/v1/admin/catalog/${entry.id}/review`, {
      method: 'POST',
      body: { decision: 'shared' },
    });
    expect(review.status).toBe(204);
    expect(await names(b, 'skills')).toContain(name);
    const got = await (await call(t, b, `/v1/catalog/skills/${name}`)).json();
    expect(got.skill.scope).toBe('shared');
  });

  it('imports an official template from a repository, with its skills and its starter', async () => {
    const operator = await workshop('operator');
    const id = `dash-${randomUUID().slice(0, 6)}`;
    const starter = `jc/${id}-starter`;
    t.world.repositories.push({
      fullName: starter,
      name: `${id}-starter`,
      defaultBranch: 'main',
      url: '',
      private: false,
      pushedAt: null,
    });
    t.world.files.set(starter, {
      'pono-template.yaml': `id: ${id}\ncategory: software\nname: { fr: Tableau de bord, en: Dashboard }\ndescription: { fr: Des chiffres lisibles, en: Readable figures }\nstack: [Hono, TanStack Start]\nskills: [safe-migrations, ${id}-charts]\n`,
      [`.pono/skills/${id}-charts.md`]: `## ${id}-charts · opinion\n\n_Draw charts that read at a glance, on every screen._\n\n- One measure per chart, its unit in the title, no 3D.\n`,
      'src/app.ts': 'export {};\n',
    });
    const res = await call(t, operator, '/v1/admin/catalog/import', {
      method: 'POST',
      body: { repository: starter },
    });
    expect(res.status).toBe(201);
    expect(t.world.templates.has(starter)).toBe(true);

    const someone = await workshop();
    const { templates } = await (await call(t, someone, '/v1/catalog/templates')).json();
    const imported = templates.find((x: { id: string }) => x.id === id);
    expect(imported).toMatchObject({ scope: 'official', starter });
    expect(await names(someone, 'skills')).toContain(`${id}-charts`);

    const name = `my-${randomUUID().slice(0, 6)}`;
    const launched = await call(t, someone, '/v1/launch', {
      method: 'POST',
      body: { template: id, name },
    });
    expect(launched.status).toBe(201);
    const files = t.world.files.get(`jc/${name}`)!;
    expect(files['src/app.ts']).toBe('export {};\n');
    expect(files['pono.yaml']).toContain(`${id}-charts`);
  });

  it('refuses a template repository that does not read', async () => {
    const operator = await workshop('operator');
    const repo = `jc/bad-${randomUUID().slice(0, 6)}`;
    t.world.repositories.push({
      fullName: repo,
      name: repo.slice(3),
      defaultBranch: 'main',
      url: '',
      private: false,
      pushedAt: null,
    });
    t.world.files.set(repo, { 'pono-template.yaml': 'id: Bad Name\n' });
    const res = await call(t, operator, '/v1/admin/catalog/import', {
      method: 'POST',
      body: { repository: repo },
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('catalog.unreadable');
  });

  it('turns a project into the organization’s own template', async () => {
    const a = await workshop();
    const name = `base-${randomUUID().slice(0, 6)}`;
    const launched = await (
      await call(t, a, '/v1/launch', { method: 'POST', body: { template: 'blank', name } })
    ).json();
    const id = `mine-${randomUUID().slice(0, 6)}`;
    const created = await call(t, a, '/v1/catalog/templates', {
      method: 'POST',
      body: {
        id,
        category: 'free',
        name: { fr: 'Ma base', en: 'My base' },
        description: { fr: 'Ma base à moi', en: 'My own base' },
        stack: ['Go'],
        skills: ['safe-migrations'],
        starter: launched.repository,
      },
    });
    expect(created.status).toBe(201);
    expect(await names(a, 'templates')).toContain(id);
    const b = await workshop();
    expect(await names(b, 'templates')).not.toContain(id);
  });
});
