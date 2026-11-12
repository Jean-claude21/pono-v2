import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from './db.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

const FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;

/**
 * Applies the SQL migrations in order, each once and in its own transaction, as the owner role.
 * Returns the versions applied by this call.
 */
export async function migrate(ownerPool: Pool, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  await ownerPool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const files = (await readdir(dir)).filter((name) => FILE.test(name)).sort();
  const { rows } = await ownerPool.query<{ version: string }>(
    'SELECT version FROM schema_migrations',
  );
  const done = new Set(rows.map((row) => row.version));
  const applied: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (done.has(version)) continue;
    const sql = await readFile(join(dir, file), 'utf8');
    const client = await ownerPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      await client.query('COMMIT');
      applied.push(version);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${version} failed: ${(error as Error).message}`, {
        cause: error,
      });
    } finally {
      client.release();
    }
  }
  return applied;
}
