import { randomBytes } from 'node:crypto';
import { inject } from 'vitest';
import { createApp, type AppDeps } from '../../src/app.js';
import type { Connectable } from '../../src/features/connections/index.js';
import { loadCatalog } from '../../src/features/catalog/index.js';
import { devIdentity } from '../../src/features/identity/index.js';
import type {
  CodeHost,
  Database,
  Deployment,
  HostedSite,
  Hosting,
  LinkChecker,
  Repository,
} from '../../src/features/projects/index.js';
import type { ChangedFile } from '../../src/features/releases/guards.js';
import type { Proposal } from '../../src/features/projects/ports.js';
import type { HostedServer, ProjectServerHost } from '../../src/features/servers/index.js';
import type { Reading, UsageSource } from '../../src/features/usage/index.js';
import { createPool, type Pool } from '../../src/platform/db.js';
import { ProviderError } from '../../src/platform/http.js';
import { Sealer } from '../../src/platform/secrets.js';
import { devBilling } from '../../src/infrastructure/providers/stripe.js';

export const PUBLIC_URL = 'http://console.test';

/** A provider in memory: accepts the key `good`, refuses any other. */
export function fakeConnectable(id: string, kind: Connectable['kind']): Connectable {
  return {
    id,
    kind,
    fields: ['token'],
    async verify(fields) {
      if (fields.token === 'down') throw new ProviderError(id, null, 'No answer');
      if (fields.token !== 'good') throw new ProviderError(id, 401, 'Answered 401');
      return { account: `${id}-account`, credential: `${id}:${fields.token}` };
    },
  };
}

/** Usage in memory: what `world.usage` holds, or a refusal when it is null. */
export function fakeUsage(w: World): UsageSource {
  return {
    id: 'host',
    async read() {
      if (w.usage === null) throw new ProviderError('host', 403, 'Answered 403');
      return w.usage;
    },
  };
}

/** Servers in memory, like the host would keep them. */
export function fakeServerHost(w: World): ProjectServerHost {
  let next = 0;
  return {
    id: 'servers',
    async create(input) {
      const externalId = `srv${++next}`;
      const server: HostedServer = {
        externalId,
        status: 'running',
        url: `https://${externalId}.servers.test`,
        size: '2 vCPU · 4 GB',
        monthlyMicros: 4_760_000,
      };
      w.servers.set(externalId, { ...server, env: input.env });
      return server;
    },
    async get(id) {
      return w.servers.get(id) ?? null;
    },
    async sleep(id) {
      w.servers.get(id)!.status = 'sleeping';
    },
    async wake(id) {
      w.servers.get(id)!.status = 'running';
    },
    async destroy(id) {
      w.servers.delete(id);
    },
  };
}

export interface World {
  proposals: Map<string, Proposal[]>;
  proposalFiles: Map<string, ChangedFile[]>;
  statuses: { fullName: string; sha: string; state: string }[];
  merged: string[];
  /** Pull requests Pono opened with files: `fullName` → the last one. */
  opened: Map<string, { branch: string; title: string; files: Record<string, string> }>;
  rollbacks: string[];
  files: Map<string, Record<string, string>>;
  servers: Map<string, HostedServer & { env: Record<string, string> }>;
  usage: Reading[] | null;
  repositories: Repository[];
  sites: Map<string, HostedSite & { repository: string }>;
  deployments: Map<string, Deployment[]>;
  databases: Map<string, string>;
  links: Map<string, 'up' | 'down'>;
  /** Credentials the adapters were called with: never anything else than the sealed one, opened. */
  seen: string[];
}

export function world(): World {
  return {
    usage: [],
    proposals: new Map(),
    proposalFiles: new Map(),
    statuses: [],
    merged: [],
    opened: new Map(),
    rollbacks: [],
    files: new Map(),
    servers: new Map(),
    repositories: [],
    sites: new Map(),
    deployments: new Map(),
    databases: new Map(),
    links: new Map(),
    seen: [],
  };
}

export function fakeAdapters(w: World): AppDeps['adapters'] {
  const codeHost: CodeHost = {
    id: 'code',
    async listRepositories(credential) {
      w.seen.push(credential);
      return w.repositories;
    },
    async createRepository(credential, input) {
      w.seen.push(credential);
      if (w.repositories.some((r) => r.name === input.name))
        throw new ProviderError('code', 409, 'exists');
      const repository = {
        fullName: `jc/${input.name}`,
        name: input.name,
        defaultBranch: 'main',
        url: '',
        private: input.private,
        pushedAt: null,
      };
      w.repositories.push(repository);
      w.files.set(repository.fullName, input.files);
      return repository;
    },
    async listProposals(_c, fullName) {
      return w.proposals.get(fullName) ?? [];
    },
    async proposalFiles(_c, fullName, number) {
      return w.proposalFiles.get(`${fullName}#${number}`) ?? [];
    },
    async fileAt(_c, fullName, path) {
      return w.files.get(fullName)?.[path] ?? null;
    },
    async proposeFiles(credential, fullName, input) {
      w.seen.push(credential);
      w.opened.set(fullName, { branch: input.branch, title: input.title, files: input.files });
      return { number: 99, url: `https://code.test/${fullName}/pull/99` };
    },
    async setReleaseStatus(_c, fullName, sha, state) {
      w.statuses.push({ fullName, sha, state });
    },
    async merge(_c, fullName, number, sha) {
      const open = w.proposals.get(fullName) ?? [];
      const proposal = open.find((x) => x.number === number);
      if (!proposal || proposal.headSha !== sha) throw new ProviderError('code', 409, 'head moved');
      w.merged.push(`${fullName}#${number}@${sha}`);
      w.proposals.set(
        fullName,
        open.filter((x) => x.number !== number),
      );
    },
    async protect(_c, fullName) {
      return fullName.includes('private') ? 'unavailable_on_plan' : 'protected';
    },
    async repository(credential, fullName) {
      w.seen.push(credential);
      return w.repositories.find((r) => r.fullName === fullName) ?? null;
    },
  };
  const hosting: Hosting = {
    id: 'host',
    async findSite(credential, repository) {
      w.seen.push(credential);
      return [...w.sites.values()].find((s) => s.repository === repository.fullName) ?? null;
    },
    async site(_credential, ref) {
      return w.sites.get(ref) ?? null;
    },
    async deployments(_credential, ref) {
      return w.deployments.get(ref) ?? [];
    },
    async rollback(_credential, ref) {
      w.rollbacks.push(ref);
    },
  };
  const database: Database = {
    id: 'db',
    async findProject(_credential, name) {
      const ref = w.databases.get(name);
      return ref ? { ref } : null;
    },
  };
  const links: LinkChecker = { check: async (url) => w.links.get(url) ?? 'up' };
  return { codeHosts: [codeHost], hostings: [hosting], databases: [database], links };
}

export interface TestApp {
  app: ReturnType<typeof createApp>;
  pool: Pool;
  world: World;
  now: { value: Date };
}

export function testApp(): TestApp {
  const pool = createPool(inject('appUrl'));
  const w = world();
  const now = { value: new Date('2026-11-12T12:00:00Z') };
  const app: ReturnType<typeof createApp> = createApp({
    pool,
    sealer: new Sealer(randomBytes(32).toString('base64')),
    publicUrl: PUBLIC_URL,
    secureCookies: false,
    identity: [devIdentity()],
    connectable: [
      fakeConnectable('code', 'code_host'),
      fakeConnectable('host', 'hosting'),
      fakeConnectable('db', 'database'),
    ],
    adapters: fakeAdapters(w),
    usageSources: [fakeUsage(w)],
    serverHost: fakeServerHost(w),
    serverBudgetMicros: 5_000_000,
    serverIdleSeconds: 1800,
    catalog: loadCatalog(),
    billing: devBilling({
      secret: 'billing-test',
      publicUrl: PUBLIC_URL,
      apiUrl: 'http://api.test',
      fetch: (url, init) =>
        Promise.resolve(
          app.request(String(url).replace('http://api.test', ''), init as RequestInit),
        ),
    }),
    admins: ['operator'],
    now: () => now.value,
  });
  return { app, pool, world: w, now };
}

function cookieOf(response: Response, name: string): string | null {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const [key, value] = pair!.split('=');
    if (key === name) return value ?? null;
  }
  return null;
}

/** Signs in through the development provider, as the browser would; returns the session cookie. */
export async function signIn(t: TestApp, login: string): Promise<string> {
  const start = await t.app.request(`/auth/sign-in/dev?login=${login}`);
  const state = cookieOf(start, 'pono_oauth_state');
  const location = new URL(start.headers.get('location')!);
  const back = await t.app.request(`${location.pathname}${location.search}`, {
    headers: { cookie: `pono_oauth_state=${state}` },
  });
  if (back.status !== 302) throw new Error(`Sign-in failed: ${back.status} ${await back.text()}`);
  return `pono_session=${cookieOf(back, 'pono_session')}`;
}

/** What the tests read of an answer: any shape, checked by the assertions. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;
export interface TestResponse extends Response {
  json(): Promise<Json>;
}

/** A JSON request with the session cookie. */
export function call(
  t: TestApp,
  cookie: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<TestResponse> {
  return Promise.resolve(
    t.app.request(path, {
      method: init.method ?? 'GET',
      headers: {
        cookie,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
  );
}
