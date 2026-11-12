/**
 * A local Postgres 17 for development, without Docker: `pnpm db:dev`.
 * Creates `.pono-dev-db/` at the repository's root on first run, starts it on port 54340 (PONO_DEV_DB_PORT), creates
 * the two roles and the `pono` database, applies the migrations, and writes `apps/api/.env` with a
 * fresh secrets key when it does not exist. Nothing here is used in production.
 */
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { createPool } from '../src/platform/db.js';
import { migrate } from '../src/platform/migrate.js';

const PORT = Number(process.env.PONO_DEV_DB_PORT ?? 54340);
const bin = process.env.PONO_PG_BIN ?? 'C:\\Users\\messa\\dev-tools\\pgsql\\bin';
const exe = (name: string) => join(bin, process.platform === 'win32' ? `${name}.exe` : name);
const root = resolve(import.meta.dirname, '../../..');
const dataDir = join(root, '.pono-dev-db');

if (!existsSync(join(dataDir, 'PG_VERSION'))) {
  execFileSync(
    exe('initdb'),
    ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--no-locale'],
    { stdio: 'ignore' },
  );
}

const running = (() => {
  try {
    execFileSync(exe('pg_ctl'), ['status', '-D', dataDir], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!running) {
  await new Promise<void>((done, fail) => {
    const child = spawn(
      exe('pg_ctl'),
      [
        'start',
        '-D',
        dataDir,
        '-w',
        '-l',
        join(dataDir, 'postgres.log'),
        '-o',
        `-p ${PORT} -c listen_addresses=127.0.0.1`,
      ],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    child.on('error', fail);
    child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`pg_ctl exited ${code}`))));
  });
}

const admin = new pg.Client({ connectionString: `postgres://postgres@127.0.0.1:${PORT}/postgres` });
await admin.connect();
for (const role of ['pono_owner', 'pono_app']) {
  const { rowCount } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  if (!rowCount) await admin.query(`CREATE ROLE ${role} LOGIN NOBYPASSRLS PASSWORD '${role}'`);
}
const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'pono'");
if (!rowCount) await admin.query('CREATE DATABASE pono OWNER pono_owner');
await admin.end();

const ownerUrl = `postgres://pono_owner:pono_owner@127.0.0.1:${PORT}/pono`;
const owner = createPool(ownerUrl);
const applied = await migrate(owner);
await owner.end();

const envFile = join(root, 'apps/api/.env');
if (!existsSync(envFile)) {
  writeFileSync(
    envFile,
    [
      `PONO_DATABASE_URL=postgres://pono_app:pono_app@127.0.0.1:${PORT}/pono`,
      `PONO_DATABASE_OWNER_URL=${ownerUrl}`,
      `PONO_SECRETS_KEY=${randomBytes(32).toString('base64')}`,
      'PONO_PUBLIC_URL=http://localhost:3000',
      'PONO_DEV_SIGN_IN=1',
      '',
    ].join('\n'),
  );
}
console.log(
  `Postgres on ${PORT}; migrations applied: ${applied.join(', ') || 'none new'}; env: apps/api/.env`,
);
