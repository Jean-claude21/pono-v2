/**
 * Several people, each in their own workshop, each given a real project server at Agent37, through
 * the running console (http://localhost:3000). Proves: one server per free plan, the second refused
 * by name, no workshop sees another's project, the operator sees every server, and everything is
 * released at the end. Imports without proposing pono.yaml: it writes nothing at GitHub.
 * Prints what it sees, never a key.
 *
 *   GITHUB_TOKEN=$(gh auth token) pnpm --filter @pono/api exec tsx scripts/multi-user-live.ts
 */
const BASE = process.env.PONO_CONSOLE_URL ?? 'http://localhost:3000';
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('GITHUB_TOKEN is required (gh auth token).');
const REPOS = (
  process.env.PONO_LIVE_REPOS ?? 'Jean-claude21/lectio,Jean-claude21/fluxio-runtime-test'
).split(',');

const t0 = Date.now();
const log = (step: string, detail: unknown = '') =>
  console.log(
    `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${step}`,
    typeof detail === 'string' ? detail : JSON.stringify(detail),
  );

class Person {
  private cookies = new Map<string, string>();
  constructor(readonly login: string) {}
  private jar() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  private keep(r: Response) {
    for (const h of r.headers.getSetCookie()) {
      const [pair] = h.split(';');
      const [k, v] = pair!.split('=');
      this.cookies.set(k!, v ?? '');
    }
  }
  async signIn() {
    let r = await fetch(`${BASE}/auth/sign-in/dev?login=${this.login}`, { redirect: 'manual' });
    this.keep(r);
    r = await fetch(r.headers.get('location')!, {
      redirect: 'manual',
      headers: { cookie: this.jar() },
    });
    this.keep(r);
    return this;
  }
  async call<T>(
    path: string,
    method = 'GET',
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const r = await fetch(`${BASE}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        cookie: this.jar(),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    this.keep(r);
    const text = await r.text();
    return { status: r.status, body: (text ? JSON.parse(text) : null) as T };
  }
}

type Project = { id: string; name: string };
type ServerView = { id: string; status: string; projectName?: string };
const people = ['mu-alice', 'mu-bob', 'mu-carol'].map((l) => new Person(l));
const servers: { person: Person; id: string }[] = [];

try {
  const projects = new Map<Person, Project[]>();
  for (const p of people) {
    await p.signIn();
    await p.call('/v1/me/level', 'PUT', { level: 'guided' });
    const connected = await p.call('/v1/connections', 'POST', {
      provider: 'github',
      fields: { token: TOKEN },
    });
    if (connected.status !== 201 && connected.status !== 409)
      throw new Error(`${p.login}: code host not connected (${connected.status})`);
    const mine: Project[] = [];
    for (const repository of REPOS) {
      const imported = await p.call<{ id: string; error?: { code: string } }>(
        '/v1/projects',
        'POST',
        {
          repository,
          proposeManifest: false,
        },
      );
      if (imported.status === 201) mine.push({ id: imported.body.id, name: repository });
      else {
        const list = (
          await p.call<{ projects: (Project & { repository: string })[] }>('/v1/projects')
        ).body;
        const found = list.projects.find(
          (x) => x.repository.toLowerCase() === repository.toLowerCase(),
        );
        if (found) mine.push({ id: found.id, name: repository });
      }
    }
    projects.set(p, mine);
    log(
      `${p.login} signed in, own workshop`,
      mine.map((m) => m.name),
    );
  }

  // Each person is given a real server for their first project, at the same time.
  const started = await Promise.all(
    people.map(async (p) => {
      const first = projects.get(p)![0]!;
      const r = await p.call<{ server: ServerView; error?: { code: string } }>(
        `/v1/projects/${first.id}/server`,
        'POST',
        { agent: 'none' },
      );
      return { p, r };
    }),
  );
  for (const { p, r } of started) {
    if (r.status !== 201)
      throw new Error(`${p.login}: no server (${r.status} ${JSON.stringify(r.body)})`);
    servers.push({ person: p, id: r.body.server.id });
    log(`${p.login} server`, { status: r.body.server.status });
  }

  // The free plan holds one active server: the second is refused and names the first.
  const alice = people[0]!;
  const second = projects.get(alice)![1];
  if (second) {
    const refused = await alice.call<{
      error: { code: string; detail: { active: { projectName: string }[] } };
    }>(`/v1/projects/${second.id}/server`, 'POST', { agent: 'none' });
    log('alice second server', {
      status: refused.status,
      code: refused.body.error?.code,
      occupiedBy: refused.body.error?.detail?.active?.map((a) => a.projectName),
    });
  }

  // No one sees another's project.
  const bob = people[1]!;
  const theirs = projects.get(alice)![0]!;
  const peek = await bob.call(`/v1/projects/${theirs.id}`);
  log('bob reads alice project', { status: peek.status });
  const bobServers = (await bob.call<{ servers: ServerView[] }>('/v1/servers')).body.servers;
  log('bob sees servers', bobServers.length);

  // The operator sees every server, across organizations.
  const operator = await new Person('jean-claude').signIn();
  const all = (
    await operator.call<{ servers: { organization: string; status: string }[] }>(
      '/v1/admin/servers',
    )
  ).body.servers.filter((s) => s.status !== 'released');
  log(
    'operator sees',
    all.map((s) => `${s.organization}:${s.status}`),
  );
  const overview = (
    await operator.call<{ activeServers: number; organizations: number }>('/v1/admin/overview')
  ).body;
  log('operator overview', {
    activeServers: overview.activeServers,
    organizations: overview.organizations,
  });
} finally {
  // Everything this run or an earlier one left active is released.
  for (const person of people) {
    const left = (await person.call<{ servers: ServerView[] }>('/v1/servers')).body?.servers ?? [];
    for (const s of left)
      if (s.status !== 'released' && !servers.some((x) => x.id === s.id))
        servers.push({ person, id: s.id });
  }
  for (const { person, id } of servers) {
    const r = await person.call(`/v1/servers/${id}`, 'DELETE');
    log(`${person.login} server released`, { status: r.status });
  }
}
log('done');
