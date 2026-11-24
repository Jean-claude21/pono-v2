import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  approveRelease,
  evaluateReleases,
  proposeFromDev,
  setReleaseMode,
} from '../src/features/releases/index.js';
import type { ChangedFile } from '../src/features/releases/guards.js';
import { call, signIn, testApp, type TestApp } from './support/app.js';

let t: TestApp;
beforeAll(() => {
  t = testApp();
});
afterAll(async () => t.pool.end());

const patch = (lines: string[]) =>
  `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}`;

/** A project with a site, a waiting proposal #n at head `sha`, and its files. */
async function setup(files: ChangedFile[], options: { preview?: boolean; manifest?: string } = {}) {
  const cookie = await signIn(t, `r${randomUUID().slice(0, 8)}`);
  for (const provider of ['code', 'host'])
    await call(t, cookie, '/v1/connections', {
      method: 'POST',
      body: { provider, fields: { token: 'good' } },
    });
  const name = `rel-${randomUUID().slice(0, 6)}`;
  const fullName = `jc/${name}`;
  t.world.repositories.push({
    fullName,
    name,
    defaultBranch: 'main',
    url: '',
    private: false,
    pushedAt: null,
  });
  t.world.sites.set(`site-${name}`, {
    ref: `site-${name}`,
    repository: fullName,
    productionUrl: `https://${name}.test`,
    productionBranch: 'main',
    updatedAt: null,
  });
  const sha = randomUUID().replace(/-/g, '').slice(0, 12);
  t.world.proposals.set(fullName, [
    {
      number: 7,
      title: 'Add notes',
      headSha: sha,
      branch: 'dev',
      url: `https://code.test/${fullName}/pull/7`,
    },
  ]);
  t.world.proposalFiles.set(`${fullName}#7`, files);
  t.world.deployments.set(
    `site-${name}`,
    options.preview === false
      ? []
      : [
          {
            externalId: `p-${sha}`,
            environment: 'preview',
            status: 'succeeded',
            url: null,
            commitSha: sha,
            createdAt: new Date(),
          },
        ],
  );
  if (options.manifest) t.world.files.set(fullName, { 'pono.yaml': options.manifest });
  const { id } = await (
    await call(t, cookie, '/v1/projects', { method: 'POST', body: { repository: fullName } })
  ).json();
  const me = await (await call(t, cookie, '/v1/me')).json();
  return {
    cookie,
    id: id as string,
    fullName,
    sha,
    actor: {
      personId: me.person.id,
      login: me.person.login,
      name: null,
      organizationId: me.organization.id,
      channel: 'mcp' as const,
    },
  };
}

const additive: ChangedFile = {
  path: 'db/migrations/0002.sql',
  status: 'added',
  binary: false,
  patch: patch(['ALTER TABLE books ADD COLUMN notes text;']),
};
const destructive: ChangedFile = {
  path: 'db/migrations/0003.sql',
  status: 'added',
  binary: false,
  patch: patch(['ALTER TABLE "books" DROP COLUMN "notes";']),
};
const secret: ChangedFile = {
  path: 'src/pay.ts',
  status: 'modified',
  binary: false,
  patch: patch([`const k = 'sk_live_${'b'.repeat(24)}';`]),
};

describe('guarded releases (phase 5)', () => {
  it('waits for a person in the default mode, then merges exactly the validated version', async () => {
    const s = await setup([additive]);
    const { releases } = await (
      await call(t, s.cookie, `/v1/projects/${s.id}/releases/evaluate`, { method: 'POST' })
    ).json();
    expect(releases[0]).toMatchObject({
      number: 7,
      verdict: 'passed',
      status: 'waiting',
      mode: 'ask',
    });
    expect(t.world.statuses.at(-1)).toMatchObject({ sha: s.sha, state: 'pending' });
    expect(
      (await call(t, s.cookie, `/v1/releases/${releases[0].id}/approve`, { method: 'POST' }))
        .status,
    ).toBe(204);
    expect(t.world.merged).toContain(`${s.fullName}#7@${s.sha}`);
    const after = await (await call(t, s.cookie, `/v1/projects/${s.id}/releases`)).json();
    expect(after.releases[0].status).toBe('merged');
  });

  it('refuses a destructive migration and publishes the failure on the commit', async () => {
    const s = await setup([destructive]);
    const { releases } = await (
      await call(t, s.cookie, `/v1/projects/${s.id}/releases/evaluate`, { method: 'POST' })
    ).json();
    expect(releases[0]).toMatchObject({ verdict: 'refused', status: 'refused' });
    expect(
      releases[0].guards.find((g: { guard: string }) => g.guard === 'migrations').findings[0].what,
    ).toBe('drop_column');
    expect(t.world.statuses.at(-1)).toMatchObject({ sha: s.sha, state: 'failure' });
    expect(
      (await call(t, s.cookie, `/v1/releases/${releases[0].id}/approve`, { method: 'POST' }))
        .status,
    ).toBe(409);
  });

  it('lets a declared destruction through when it comes alone', async () => {
    const s = await setup([destructive], {
      manifest:
        'version: 1\nname: shop\nrelease:\n  declared_destructions:\n    - db/migrations/0003.sql\n',
    });
    const { releases } = await (
      await call(t, s.cookie, `/v1/projects/${s.id}/releases/evaluate`, { method: 'POST' })
    ).json();
    expect(releases[0].verdict).toBe('passed');
  });

  it('merges by itself in the automatic mode when every guard is green', async () => {
    const s = await setup([additive]);
    expect(
      (
        await call(t, s.cookie, `/v1/projects/${s.id}/release-mode`, {
          method: 'PUT',
          body: { mode: 'auto' },
        })
      ).status,
    ).toBe(204);
    const { releases } = await (
      await call(t, s.cookie, `/v1/projects/${s.id}/releases/evaluate`, { method: 'POST' })
    ).json();
    expect(releases[0].status).toBe('merged');
    expect(t.world.merged).toContain(`${s.fullName}#7@${s.sha}`);
  });

  it('waits in the automatic mode when the preview is missing', async () => {
    const s = await setup([additive], { preview: false });
    await call(t, s.cookie, `/v1/projects/${s.id}/release-mode`, {
      method: 'PUT',
      body: { mode: 'auto' },
    });
    const { releases } = await (
      await call(t, s.cookie, `/v1/projects/${s.id}/releases/evaluate`, { method: 'POST' })
    ).json();
    expect(releases[0]).toMatchObject({ verdict: 'refused', status: 'refused' });
  });

  it('ships a destructive change in bypass with a warning, never a secret', async () => {
    const a = await setup([destructive]);
    expect(
      (
        await call(t, a.cookie, `/v1/projects/${a.id}/release-mode`, {
          method: 'PUT',
          body: { mode: 'bypass' },
        })
      ).status,
    ).toBe(400);
    await call(t, a.cookie, `/v1/projects/${a.id}/release-mode`, {
      method: 'PUT',
      body: { mode: 'bypass', hours: 24 },
    });
    const shipped = (
      await (
        await call(t, a.cookie, `/v1/projects/${a.id}/releases/evaluate`, { method: 'POST' })
      ).json()
    ).releases[0];
    expect(shipped).toMatchObject({ verdict: 'warned', status: 'merged', mode: 'bypass' });

    const b = await setup([secret]);
    await call(t, b.cookie, `/v1/projects/${b.id}/release-mode`, {
      method: 'PUT',
      body: { mode: 'bypass', hours: 24 },
    });
    const refused = (
      await (
        await call(t, b.cookie, `/v1/projects/${b.id}/releases/evaluate`, { method: 'POST' })
      ).json()
    ).releases[0];
    expect(refused).toMatchObject({ verdict: 'refused', status: 'refused' });
    expect(JSON.stringify(refused)).not.toContain('bbbbbbbb');
  });

  it('goes back to asking when the bypass has ended', async () => {
    const s = await setup([destructive]);
    await call(t, s.cookie, `/v1/projects/${s.id}/release-mode`, {
      method: 'PUT',
      body: { mode: 'bypass', hours: 1 },
    });
    t.now.value = new Date(t.now.value.getTime() + 2 * 3_600_000);
    const res = await (await call(t, s.cookie, `/v1/projects/${s.id}/releases`)).json();
    expect(res.mode).toBe('ask');
    t.now.value = new Date(t.now.value.getTime() - 2 * 3_600_000);
  });

  it('refuses to merge when the proposal changed after its evaluation', async () => {
    const s = await setup([additive]);
    const { releases } = await (
      await call(t, s.cookie, `/v1/projects/${s.id}/releases/evaluate`, { method: 'POST' })
    ).json();
    t.world.proposals.get(s.fullName)![0]!.headSha = 'moved';
    const res = await call(t, s.cookie, `/v1/releases/${releases[0].id}/approve`, {
      method: 'POST',
    });
    expect((await res.json()).error.code).toBe('release.changed');
  });

  it('never lets an agent validate, change the mode, or roll back', async () => {
    const s = await setup([additive]);
    const { releases } = await (
      await call(t, s.cookie, `/v1/projects/${s.id}/releases/evaluate`, { method: 'POST' })
    ).json();
    const deps = { pool: t.pool } as never;
    await expect(approveRelease(deps, s.actor, releases[0].id)).rejects.toMatchObject({
      code: 'release.person_only',
    });
    await expect(setReleaseMode(deps, s.actor, s.id, 'bypass', 24)).rejects.toMatchObject({
      code: 'release.person_only',
    });
  });

  it('protects production and rolls back at the host, journaled', async () => {
    const s = await setup([additive]);
    expect(
      await (await call(t, s.cookie, `/v1/projects/${s.id}/protect`, { method: 'POST' })).json(),
    ).toEqual({ protection: 'protected' });
    expect(
      (await call(t, s.cookie, `/v1/projects/${s.id}/rollback`, { method: 'POST' })).status,
    ).toBe(204);
    expect(t.world.rollbacks.at(-1)).toMatch(/^site-rel-/);
    const detail = await (await call(t, s.cookie, `/v1/projects/${s.id}`)).json();
    expect(detail.journal.map((j: { action: string }) => j.action)).toEqual(
      expect.arrayContaining(['release.protected', 'release.rolled_back']),
    );
  });
});

describe('a chat agent proposes dev for production (D-039)', () => {
  it('opens the proposal from dev once, answers it again after, and has nothing to open when dev is level', async () => {
    const s = await setup([additive]);
    t.world.proposals.set(s.fullName, []);
    expect(await proposeFromDev(t.deps, s.actor, s.id)).toBeNull();

    t.world.branchHeads.set(`${s.fullName}@dev`, s.sha);
    const first = await proposeFromDev(t.deps, s.actor, s.id);
    expect(first?.url).toContain(s.fullName);
    const again = await proposeFromDev(t.deps, s.actor, s.id);
    expect(again?.number).toBe(first?.number);
    expect(t.world.proposals.get(s.fullName)).toHaveLength(1);

    const releases = await evaluateReleases(t.deps, s.actor, s.id);
    expect(releases.map((r) => r.number)).toContain(first?.number);
    const detail = await (await call(t, s.cookie, `/v1/projects/${s.id}`)).json();
    expect(detail.journal.map((j: { action: string }) => j.action)).toContain('release.proposed');
  });
});

describe('a preview still building (D-039)', () => {
  it('refuses for now, then evaluates the same head again once the preview is built', async () => {
    const s = await setup([additive], { preview: false });
    const site = [...t.world.sites.values()].find((x) => x.repository === s.fullName)!;
    const preview = (status: 'building' | 'succeeded') => [
      {
        externalId: `p-${s.sha}`,
        environment: 'preview' as const,
        status,
        url: null,
        commitSha: s.sha,
        createdAt: new Date(),
      },
    ];
    t.world.deployments.set(site.ref, preview('building'));
    const first = await evaluateReleases(t.deps, s.actor, s.id);
    expect(first.find((r) => r.number === 7)?.status).toBe('refused');

    t.world.deployments.set(site.ref, preview('succeeded'));
    const second = await evaluateReleases(t.deps, s.actor, s.id);
    expect(second.find((r) => r.number === 7)?.status).toBe('waiting');
    // Evaluated once more, then left alone: a head that passed is not read again.
    await evaluateReleases(t.deps, s.actor, s.id);
    const detail = await (await call(t, s.cookie, `/v1/projects/${s.id}`)).json();
    const evaluations = detail.journal.filter((j: { action: string }) =>
      ['release.refused', 'release.evaluated'].includes(j.action),
    );
    expect(evaluations).toHaveLength(2);
  });
});
