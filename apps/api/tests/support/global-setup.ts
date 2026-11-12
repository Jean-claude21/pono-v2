import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { createPool } from '../../src/platform/db.js';
import { migrate } from '../../src/platform/migrate.js';

const run = promisify(execFile);
const DEFAULT_PG_BIN = 'C:\\Users\\messa\\dev-tools\\pgsql\\bin';
const OWNER_PASSWORD = 'pono_owner_test';
const APP_PASSWORD = 'pono_app_test';

declare module 'vitest' {
  export interface ProvidedContext {
    ownerUrl: string;
    appUrl: string;
  }
}

function startServer(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`pg_ctl exited ${code}`)),
    );
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address ? resolve(address.port) : reject(),
      );
    });
  });
}

function withCredentials(url: string, user: string, password: string, database: string): string {
  const parsed = new URL(url);
  parsed.username = user;
  parsed.password = password;
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** Creates the two roles and a fresh database owned by the owner role. */
async function prepare(
  adminUrl: string,
  database: string,
): Promise<{ ownerUrl: string; appUrl: string }> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    for (const [role, password] of [
      ['pono_owner', OWNER_PASSWORD],
      ['pono_app', APP_PASSWORD],
    ] as const) {
      const { rowCount } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
      if (!rowCount)
        await admin.query(`CREATE ROLE ${role} LOGIN NOBYPASSRLS PASSWORD '${password}'`);
    }
    await admin.query(`DROP DATABASE IF EXISTS ${database}`);
    await admin.query(`CREATE DATABASE ${database} OWNER pono_owner`);
  } finally {
    await admin.end();
  }
  return {
    ownerUrl: withCredentials(adminUrl, 'pono_owner', OWNER_PASSWORD, database),
    appUrl: withCredentials(adminUrl, 'pono_app', APP_PASSWORD, database),
  };
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const database = 'pono_test';
  let adminUrl = process.env.PONO_TEST_DATABASE_URL;
  let stop = async (): Promise<void> => {};

  if (!adminUrl) {
    const bin = process.env.PONO_PG_BIN ?? DEFAULT_PG_BIN;
    const exe = (name: string): string =>
      join(bin, process.platform === 'win32' ? `${name}.exe` : name);
    if (!existsSync(exe('initdb'))) {
      throw new Error(
        'No Postgres for the tests: set PONO_TEST_DATABASE_URL, or PONO_PG_BIN to the Postgres 17 binaries.',
      );
    }
    const dataDir = await mkdtemp(join(tmpdir(), 'pono-pg-'));
    const port = await freePort();
    await run(exe('initdb'), [
      '-D',
      dataDir,
      '-U',
      'postgres',
      '-A',
      'trust',
      '-E',
      'UTF8',
      '--no-locale',
    ]);
    // pg_ctl leaves the server holding its standard handles: wait for pg_ctl's exit, not for its
    // streams to close, or the start never returns on Windows.
    await startServer(exe('pg_ctl'), [
      'start',
      '-D',
      dataDir,
      '-w',
      '-l',
      join(dataDir, 'postgres.log'),
      '-o',
      `-p ${port} -c listen_addresses=127.0.0.1`,
    ]);
    adminUrl = `postgres://postgres@127.0.0.1:${port}/postgres`;
    stop = async () => {
      await run(exe('pg_ctl'), ['stop', '-D', dataDir, '-m', 'fast', '-w']);
      await rm(dataDir, { recursive: true, force: true });
    };
  }

  const urls = await prepare(adminUrl, database);
  const owner = createPool(urls.ownerUrl);
  try {
    await migrate(owner);
  } finally {
    await owner.end();
  }
  project.provide('ownerUrl', urls.ownerUrl);
  project.provide('appUrl', urls.appUrl);
  return stop;
}
