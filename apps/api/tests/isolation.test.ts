import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  createPool,
  withOrganization,
  withoutOrganization,
  type Pool,
} from '../src/platform/db.js';

// 001 SC-002, 002 SC-003: no row of an organization is readable from another, on every table of
// an organization.
const ORGANIZATION_TABLES = [
  'organizations',
  'members',
  'connections',
  'projects',
  'deployments',
  'journal',
] as const;

let app: Pool;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  app = createPool(inject('appUrl'));
  orgA = await create('A', randomUUID());
  orgB = await create('B', randomUUID());
  for (const org of [orgA, orgB]) await fill(org);
});
afterAll(async () => app.end());

async function create(name: string, person: string): Promise<string> {
  const { rows } = await app.query<{ id: string }>('SELECT create_organization($1, $2) AS id', [
    name,
    person,
  ]);
  return rows[0]!.id;
}

/** One row in every table of the organization. */
async function fill(org: string): Promise<void> {
  await withOrganization(app, org, async (client) => {
    await client.query(
      `INSERT INTO connections (organization_id, provider, kind, account, status, sealed_credential, created_by)
       VALUES ($1, 'hosting-a', 'hosting', 'acct', 'active', 'v1.x.y.z', $2)`,
      [org, randomUUID()],
    );
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO projects (organization_id, name, repository, default_branch, hosting_status,
         database_status, link_status, state, state_reason)
       VALUES ($1, 'p', $2, 'main', 'missing', 'missing', 'missing', 'healthy', 'nominal') RETURNING id`,
      [org, `owner/${org}`],
    );
    const project = rows[0]!.id;
    await client.query(
      `INSERT INTO deployments (organization_id, project_id, environment, external_id, status, created_at)
       VALUES ($1, $2, 'production', 'd1', 'succeeded', now())`,
      [org, project],
    );
    await client.query(
      `INSERT INTO journal (organization_id, project_id, action, channel) VALUES ($1, $2, 'test', 'system')`,
      [org, project],
    );
  });
}

describe('organization isolation', () => {
  it('shows an organization only its own rows, on every table', async () => {
    for (const table of ORGANIZATION_TABLES) {
      const column = table === 'organizations' ? 'id' : 'organization_id';
      const seen = await withOrganization(app, orgA, async (client) => {
        const { rows } = await client.query<{ org: string }>(
          `SELECT ${column} AS org FROM ${table}`,
        );
        return rows.map((row) => row.org);
      });
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((org) => org === orgA)).toBe(true);
      expect(seen).not.toContain(orgB);
    }
  });

  it('shows nothing without an organization', async () => {
    for (const table of ORGANIZATION_TABLES) {
      const count = await withoutOrganization(app, async (client) => {
        const { rows } = await client.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
        return Number(rows[0]!.n);
      });
      expect(count).toBe(0);
    }
  });

  it('refuses to write a row into another organization', async () => {
    await expect(
      withOrganization(app, orgA, (client) =>
        client.query('INSERT INTO members (organization_id, person_id, role) VALUES ($1, $2, $3)', [
          orgB,
          randomUUID(),
          'member',
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('refuses to create an organization outside of create_organization', async () => {
    await expect(app.query("INSERT INTO organizations (name) VALUES ('rogue')")).rejects.toThrow(
      /permission denied/,
    );
  });

  it('cannot switch row-level security off', async () => {
    await expect(app.query('ALTER TABLE members DISABLE ROW LEVEL SECURITY')).rejects.toThrow(
      /must be owner/,
    );
    const { rows } = await app.query<{ rolbypassrls: boolean }>(
      "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'pono_app'",
    );
    expect(rows[0]!.rolbypassrls).toBe(false);
  });

  it('keeps the journal append-only', async () => {
    await expect(
      withOrganization(app, orgA, (client) => client.query("UPDATE journal SET action = 'forged'")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withOrganization(app, orgA, (client) => client.query('DELETE FROM journal')),
    ).rejects.toThrow(/permission denied/);
  });

  it('gives the app role no direct access to people and sessions', async () => {
    await expect(app.query('SELECT * FROM people')).rejects.toThrow(/permission denied/);
    await expect(app.query('SELECT * FROM sessions')).rejects.toThrow(/permission denied/);
  });

  it('gives the first member the owner role', async () => {
    const roles = await withOrganization(app, orgB, async (client) => {
      const { rows } = await client.query<{ role: string }>('SELECT role FROM members');
      return rows.map((row) => row.role);
    });
    expect(roles).toEqual(['owner']);
  });
});
