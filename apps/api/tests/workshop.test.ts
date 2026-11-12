import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPool, withOrganization, type Pool } from '../src/platform/db.js';
import {
  call,
  PUBLIC_URL,
  signIn,
  testApp,
  type TestApp,
  type TestResponse,
} from './support/app.js';

let t: TestApp;
let owner: Pool;
beforeAll(() => {
  t = testApp();
  owner = createPool(inject('ownerUrl'));
});
afterAll(async () => {
  await t.pool.end();
  await owner.end();
});

async function organizationOf(cookie: string): Promise<string> {
  return ((await (await call(t, cookie, '/v1/me')).json()) as { organization: { id: string } })
    .organization.id;
}

const login = () => `p${randomUUID().slice(0, 8)}`;

describe('US1 — entering one’s workshop', () => {
  it('creates the person, their workshop and a session at the first sign-in', async () => {
    const who = login();
    const cookie = await signIn(t, who);
    const res = await call(t, cookie, '/v1/me');
    expect(res.status).toBe(200);
    const me = (await res.json()) as { person: { login: string }; organization: { role: string } };
    expect(me.person.login).toBe(who);
    expect(me.organization.role).toBe('owner');
  });

  it('does not create a second workshop when the person comes back', async () => {
    const who = login();
    const first = await (await call(t, await signIn(t, who), '/v1/me')).json();
    const again = await (await call(t, await signIn(t, who), '/v1/me')).json();
    expect(again.organization.id).toBe(first.organization.id);
  });

  it('sends the browser back to the console', async () => {
    const start = await t.app.request('/auth/sign-in/dev?login=back');
    expect(start.status).toBe(302);
    expect(start.headers.get('location')).toMatch(new RegExp(`^${PUBLIC_URL}/auth/callback/dev`));
  });

  it('refuses a callback that did not start here', async () => {
    const res = (await t.app.request('/auth/callback/dev?code=dev:x&state=forged', {
      headers: { cookie: 'pono_oauth_state=other' },
    })) as TestResponse;
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('auth.state_mismatch');
  });

  it('answers 401 without a session, or with an unknown one', async () => {
    for (const cookie of ['', 'pono_session=forged']) {
      const res = await call(t, cookie, '/v1/me');
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('auth.required');
    }
  });

  it('ends the session at sign-out', async () => {
    const cookie = await signIn(t, login());
    expect((await call(t, cookie, '/auth/sign-out', { method: 'POST' })).status).toBe(204);
    expect((await call(t, cookie, '/v1/me')).status).toBe(401);
  });

  it('refuses an expired session', async () => {
    const cookie = await signIn(t, login());
    await owner.query("UPDATE sessions SET expires_at = now() - interval '1 minute'");
    expect((await call(t, cookie, '/v1/me')).status).toBe(401);
  });
});

describe('US2 — connections', () => {
  it('verifies, seals and lists a connection without its key', async () => {
    const cookie = await signIn(t, login());
    const res = await call(t, cookie, '/v1/connections', {
      method: 'POST',
      body: { provider: 'host', fields: { token: 'good' } },
    });
    expect(res.status).toBe(201);
    const listed = await (await call(t, cookie, '/v1/connections')).text();
    expect(listed).toContain('host-account');
    expect(listed).not.toContain('good');
    expect(listed).not.toContain('v1.');
  });

  it('keeps no clear byte of a key (SC-002)', async () => {
    const cookie = await signIn(t, login());
    await call(t, cookie, '/v1/connections', {
      method: 'POST',
      body: { provider: 'db', fields: { token: 'good' } },
    });
    const org = await organizationOf(cookie);
    const { rows } = await withOrganization(t.pool, org, (client) =>
      client.query<{ sealed_credential: string }>(
        "SELECT sealed_credential FROM connections WHERE provider = 'db'",
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.sealed_credential).toMatch(/^v1\./);
      expect(row.sealed_credential).not.toContain('good');
    }
  });

  it('keeps nothing when the provider refuses the key', async () => {
    const cookie = await signIn(t, login());
    const res = await call(t, cookie, '/v1/connections', {
      method: 'POST',
      body: { provider: 'host', fields: { token: 'bad' } },
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('connection.rejected');
    const list = await (await call(t, cookie, '/v1/connections')).json();
    expect(list.connections).toEqual([]);
  });

  it('says when the provider does not answer', async () => {
    const cookie = await signIn(t, login());
    const res = await call(t, cookie, '/v1/connections', {
      method: 'POST',
      body: { provider: 'host', fields: { token: 'down' } },
    });
    expect(res.status).toBe(502);
  });

  it('refuses a second connection to the same provider', async () => {
    const cookie = await signIn(t, login());
    const body = { provider: 'host', fields: { token: 'good' } };
    await call(t, cookie, '/v1/connections', { method: 'POST', body });
    const again = await call(t, cookie, '/v1/connections', { method: 'POST', body });
    expect(again.status).toBe(409);
  });

  it('erases the key when the connection is cut, and journals it', async () => {
    const cookie = await signIn(t, login());
    const created = await (
      await call(t, cookie, '/v1/connections', {
        method: 'POST',
        body: { provider: 'code', fields: { token: 'good' } },
      })
    ).json();
    const id = created.connection.id as string;
    expect((await call(t, cookie, `/v1/connections/${id}`, { method: 'DELETE' })).status).toBe(204);
    const org = await organizationOf(cookie);
    const { rows, journal } = await withOrganization(t.pool, org, async (client) => ({
      rows: (
        await client.query('SELECT status, sealed_credential FROM connections WHERE id = $1', [id])
      ).rows,
      journal: (await client.query('SELECT action FROM journal ORDER BY id')).rows,
    }));
    expect(rows[0]).toEqual({ status: 'revoked', sealed_credential: null });
    expect(journal.map((r) => r.action)).toEqual([
      'organization.created',
      'connection.created',
      'connection.revoked',
    ]);
  });

  it('cannot cut the connection of another organization', async () => {
    const a = await signIn(t, login());
    const b = await signIn(t, login());
    const created = await (
      await call(t, a, '/v1/connections', {
        method: 'POST',
        body: { provider: 'code', fields: { token: 'good' } },
      })
    ).json();
    expect(
      (await call(t, b, `/v1/connections/${created.connection.id}`, { method: 'DELETE' })).status,
    ).toBe(404);
  });
});

describe('US3 and US4 — projects', () => {
  async function workshop(): Promise<string> {
    const cookie = await signIn(t, login());
    for (const provider of ['code', 'host', 'db']) {
      await call(t, cookie, '/v1/connections', {
        method: 'POST',
        body: { provider, fields: { token: 'good' } },
      });
    }
    return cookie;
  }

  function repo(name: string, pushedAt: Date | null) {
    const fullName = `jc/${name}`;
    t.world.repositories.push({
      fullName,
      name,
      defaultBranch: 'main',
      url: `https://code.test/${fullName}`,
      private: false,
      pushedAt,
    });
    return fullName;
  }

  it('asks for the code host first', async () => {
    const cookie = await signIn(t, login());
    const res = await call(t, cookie, '/v1/repositories');
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('connection.code_host_missing');
  });

  it('imports a repository with its site, database, address and deployments, nothing typed', async () => {
    const cookie = await workshop();
    const fullName = repo('lectio', new Date('2026-11-12T10:00:00Z'));
    t.world.sites.set('site-lectio', {
      ref: 'site-lectio',
      repository: fullName,
      productionUrl: 'https://lectio.test',
      productionBranch: 'main',
      updatedAt: null,
    });
    t.world.deployments.set('site-lectio', [
      {
        externalId: 'd2',
        environment: 'production',
        status: 'succeeded',
        url: 'https://d2.test',
        commitSha: 'abc',
        createdAt: new Date('2026-11-12T10:05:00Z'),
      },
      {
        externalId: 'd1',
        environment: 'preview',
        status: 'failed',
        url: null,
        commitSha: 'abd',
        createdAt: new Date('2026-11-11T10:00:00Z'),
      },
    ]);
    t.world.databases.set('lectio', 'neon-lectio');

    const res = await call(t, cookie, '/v1/projects', {
      method: 'POST',
      body: { repository: fullName },
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const detail = await (await call(t, cookie, `/v1/projects/${id}`)).json();
    expect(detail.project).toMatchObject({
      name: 'lectio',
      hosting: { provider: 'host', status: 'found' },
      database: { provider: 'db', status: 'found' },
      productionUrl: 'https://lectio.test',
      linkStatus: 'up',
      state: 'active',
      stateReason: 'recent_activity',
    });
    expect(detail.deployments.map((d: { commit: string }) => d.commit)).toEqual(['abc', 'abd']);
    expect(detail.journal.map((j: { action: string }) => j.action)).toEqual([
      'manifest.proposed',
      'project.refreshed',
      'project.imported',
    ]);
    expect(t.world.seen.every((credential) => /^(code|host):good$/.test(credential))).toBe(true);
  });

  it('marks what it did not find, and invents nothing', async () => {
    const cookie = await workshop();
    const fullName = repo('alone', new Date('2026-10-30T00:00:00Z'));
    const { id } = await (
      await call(t, cookie, '/v1/projects', { method: 'POST', body: { repository: fullName } })
    ).json();
    const { project } = await (await call(t, cookie, `/v1/projects/${id}`)).json();
    expect(project).toMatchObject({
      hosting: { provider: null, status: 'missing' },
      database: { provider: null, status: 'missing' },
      productionUrl: null,
      linkStatus: 'missing',
      state: 'healthy',
    });
  });

  it('refuses to import the same repository twice', async () => {
    const cookie = await workshop();
    const fullName = repo('twice', null);
    await call(t, cookie, '/v1/projects', { method: 'POST', body: { repository: fullName } });
    const again = await call(t, cookie, '/v1/projects', {
      method: 'POST',
      body: { repository: fullName },
    });
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe('project.already_imported');
  });

  it('marks a project failing when its address stops answering, at the next refresh', async () => {
    const cookie = await workshop();
    const fullName = repo('nyatefe', new Date('2026-10-01T00:00:00Z'));
    t.world.sites.set('site-nyatefe', {
      ref: 'site-nyatefe',
      repository: fullName,
      productionUrl: 'https://nyatefe.test',
      productionBranch: 'main',
      updatedAt: null,
    });
    const { id } = await (
      await call(t, cookie, '/v1/projects', { method: 'POST', body: { repository: fullName } })
    ).json();
    t.world.links.set('https://nyatefe.test', 'down');
    expect((await call(t, cookie, `/v1/projects/${id}/refresh`, { method: 'POST' })).status).toBe(
      204,
    );
    const { projects } = await (await call(t, cookie, '/v1/projects')).json();
    expect(projects.find((p: { id: string }) => p.id === id)).toMatchObject({
      state: 'failing',
      stateReason: 'production_down',
      linkStatus: 'down',
    });
  });

  it('shows another organization nothing of a project', async () => {
    const a = await workshop();
    const b = await workshop();
    const fullName = repo('private-one', null);
    const { id } = await (
      await call(t, a, '/v1/projects', { method: 'POST', body: { repository: fullName } })
    ).json();
    expect((await call(t, b, `/v1/projects/${id}`)).status).toBe(404);
    expect((await (await call(t, b, '/v1/projects')).json()).projects).toEqual([]);
  });
});
