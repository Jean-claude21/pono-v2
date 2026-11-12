import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  createPool,
  withOrganization,
  withoutOrganization,
  type Pool,
} from '../src/platform/db.js';

// SC-002: no row of an organization is readable from another, on every table created.
const ORGANIZATION_TABLES = ['organizations', 'members'] as const;

let app: Pool;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  app = createPool(inject('appUrl'));
  orgA = await create('A', randomUUID());
  orgB = await create('B', randomUUID());
});
afterAll(async () => app.end());

async function create(name: string, person: string): Promise<string> {
  const { rows } = await app.query<{ id: string }>('SELECT create_organization($1, $2) AS id', [
    name,
    person,
  ]);
  return rows[0]!.id;
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

  it('gives the first member the owner role', async () => {
    const roles = await withOrganization(app, orgB, async (client) => {
      const { rows } = await client.query<{ role: string }>('SELECT role FROM members');
      return rows.map((row) => row.role);
    });
    expect(roles).toEqual(['owner']);
  });
});
