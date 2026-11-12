import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { healthRoutes } from '../src/features/health/index.js';
import { testApp } from './support/app.js';
import { ConfigError, loadConfig } from '../src/platform/config.js';
import { createPool, ping, type Pool } from '../src/platform/db.js';
import { migrate } from '../src/platform/migrate.js';

const KEY = Buffer.alloc(32, 7).toString('base64');

let owner: Pool;
let app: Pool;
beforeAll(() => {
  owner = createPool(inject('ownerUrl'));
  app = createPool(inject('appUrl'));
});
afterAll(async () => {
  await owner.end();
  await app.end();
});

describe('GET /health', () => {
  it('says ok when the database answers', async () => {
    const res = await healthRoutes({ databaseUp: () => ping(app) }).request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('says the database is down when it does not answer', async () => {
    const dead = createPool('postgres://nobody:nothing@127.0.0.1:1/none');
    const res = await healthRoutes({ databaseUp: () => ping(dead) }).request('/');
    await dead.end();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'degraded', database: 'down' });
  });
});

describe('errors', () => {
  it('answers an unknown route with a stable code', async () => {
    const t = testApp();
    const res = await t.app.request('/nowhere');
    await t.pool.end();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'route.not_found', message: 'No such route.' },
    });
  });
});

describe('configuration', () => {
  it('names the missing variables, never a value', () => {
    const secret = 'postgres://u:very-secret@h/d';
    try {
      loadConfig({
        PONO_DATABASE_OWNER_URL: 'not a url',
        PONO_API_PORT: secret,
        PONO_SECRETS_KEY: secret,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as Error).message;
      expect(message).toContain('PONO_DATABASE_URL');
      expect(message).toContain('PONO_DATABASE_OWNER_URL');
      expect(message).not.toContain('very-secret');
    }
  });

  it('applies the default port', () => {
    expect(
      loadConfig({ PONO_DATABASE_URL: 'postgres://a@b/c', PONO_SECRETS_KEY: KEY }).PONO_API_PORT,
    ).toBe(8787);
  });

  it('refuses the development sign-in in production', () => {
    expect(() =>
      loadConfig({
        PONO_DATABASE_URL: 'postgres://a@b/c',
        PONO_SECRETS_KEY: KEY,
        NODE_ENV: 'production',
        PONO_DEV_SIGN_IN: '1',
      }),
    ).toThrow(/PONO_DEV_SIGN_IN/);
  });
});

describe('migrations', () => {
  it('does not apply a migration twice', async () => {
    expect(await migrate(owner)).toEqual([]);
  });

  it('applies nothing of a migration that fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pono-mig-'));
    await writeFile(
      join(dir, '9001_broken.sql'),
      'CREATE TABLE half_done (id int); SELECT * FROM no_such_table;',
    );
    await expect(migrate(owner, dir)).rejects.toThrow(/9001_broken failed/);
    const { rows } = await owner.query("SELECT to_regclass('half_done') AS t");
    expect(rows[0].t).toBeNull();
  });
});
