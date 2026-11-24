import type { Actor } from '../../platform/context.js';
import { withOrganization, type Client, type Pool } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { ProviderError } from '../../platform/http.js';
import type { Sealer } from '../../platform/secrets.js';
import { activeCredentials } from '../connections/index.js';
import { record } from '../journal/index.js';
import { projectState, type LinkStatus } from './domain/state.js';
import type { CodeHost, Deployment, HostedSite, Repository, WorkshopAdapters } from './ports.js';

export interface ProjectsDeps {
  pool: Pool;
  sealer: Sealer;
  adapters: WorkshopAdapters;
  now: () => Date;
  /** Called once a project is imported: the manifest is read, or proposed (D-014). */
  afterImport?: (actor: Actor, projectId: string, options: { propose: boolean }) => Promise<void>;
}

type Found = 'found' | 'missing' | 'unknown';

interface Credentials {
  byProvider: Map<string, string>;
}

/** Reads the opened credentials in a short transaction: providers are called outside of it. */
async function credentials(deps: ProjectsDeps, organizationId: string): Promise<Credentials> {
  const rows = await withOrganization(deps.pool, organizationId, (client) =>
    activeCredentials(client, deps.sealer),
  );
  return { byProvider: new Map(rows.map((r) => [r.provider, r.credential])) };
}

function connected<T extends { id: string }>(
  adapters: T[],
  creds: Credentials,
): { adapter: T; credential: string }[] {
  return adapters.flatMap((adapter) => {
    const credential = creds.byProvider.get(adapter.id);
    return credential ? [{ adapter, credential }] : [];
  });
}

function codeHostOf(
  deps: ProjectsDeps,
  creds: Credentials,
): { adapter: CodeHost; credential: string } {
  const host = connected(deps.adapters.codeHosts, creds)[0];
  if (!host)
    throw new AppError('connection.code_host_missing', 409, 'Connect your code host first.');
  return host;
}

/** The repositories a person can import. */
export async function listRepositories(deps: ProjectsDeps, actor: Actor): Promise<Repository[]> {
  const host = codeHostOf(deps, await credentials(deps, actor.organizationId));
  return host.adapter.listRepositories(host.credential);
}

/** Imports a repository: hosting, database, address and deployments found, never typed (US3). */
export async function importProject(
  deps: ProjectsDeps,
  actor: Actor,
  fullName: string,
  from: { origin: 'template' | 'adopted'; template?: string; proposeManifest?: boolean } = {
    origin: 'adopted',
  },
): Promise<string> {
  const creds = await credentials(deps, actor.organizationId);
  const host = codeHostOf(deps, creds);
  const repository = await host.adapter.repository(host.credential, fullName);
  if (!repository) throw new AppError('project.repository_not_found', 404, 'No such repository.');

  const existing = await withOrganization(deps.pool, actor.organizationId, (client) =>
    client.query('SELECT 1 FROM projects WHERE repository = $1', [repository.fullName]),
  );
  if (existing.rowCount)
    throw new AppError('project.already_imported', 409, 'Already in the workshop.');

  let hosting: { provider: string; site: HostedSite } | null = null;
  let hostingStatus: Found = 'missing';
  const sites: { provider: string; site: HostedSite }[] = [];
  for (const { adapter, credential } of connected(deps.adapters.hostings, creds)) {
    try {
      const site = await adapter.findSite(credential, repository);
      if (site) sites.push({ provider: adapter.id, site });
    } catch {
      hostingStatus = 'unknown';
    }
  }
  if (sites.length) {
    // Two sites of one repository: the one that builds the default branch, else the latest one.
    sites.sort((a, b) => {
      const branch = (s: HostedSite) => (s.productionBranch === repository.defaultBranch ? 1 : 0);
      return (
        branch(b.site) - branch(a.site) ||
        (b.site.updatedAt?.getTime() ?? 0) - (a.site.updatedAt?.getTime() ?? 0)
      );
    });
    hosting = sites[0]!;
    hostingStatus = 'found';
  }

  let database: { provider: string; ref: string } | null = null;
  let databaseStatus: Found = 'missing';
  for (const { adapter, credential } of connected(deps.adapters.databases, creds)) {
    try {
      const found = await adapter.findProject(credential, repository.name);
      if (found && !database) {
        database = { provider: adapter.id, ref: found.ref };
        databaseStatus = 'found';
      }
    } catch {
      if (!database) databaseStatus = 'unknown';
    }
  }

  const id = await withOrganization(deps.pool, actor.organizationId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO projects (organization_id, name, repository, default_branch, hosting_provider, hosting_ref,
         hosting_status, database_provider, database_ref, database_status, production_url, link_status,
         last_commit_at, state, state_reason, origin, template)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'unknown', $12, 'healthy', 'nominal', $13, $14)
       RETURNING id`,
      [
        actor.organizationId,
        repository.name,
        repository.fullName,
        repository.defaultBranch,
        hosting?.provider ?? null,
        hosting?.site.ref ?? null,
        hostingStatus,
        database?.provider ?? null,
        database?.ref ?? null,
        databaseStatus,
        hosting?.site.productionUrl ?? null,
        repository.pushedAt,
        from.origin,
        from.template ?? null,
      ],
    );
    const projectId = rows[0]!.id;
    await record(client, {
      organizationId: actor.organizationId,
      projectId,
      action: 'project.imported',
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: { repository: repository.fullName, hosting: hostingStatus, database: databaseStatus },
    });
    return projectId;
  });
  await refreshProject(deps, actor, id);
  // The manifest never blocks an import: a failure leaves it to be read again later.
  await deps
    .afterImport?.(actor, id, { propose: from.proposeManifest ?? true })
    .catch(() => undefined);
  return id;
}

interface ProjectRow {
  id: string;
  repository: string;
  hosting_provider: string | null;
  hosting_ref: string | null;
  production_url: string | null;
  last_commit_at: Date | null;
  state: string;
  state_reason: string | null;
  link_status: string;
}

/** Reads the project again at its providers, then writes its state (US4). */
export async function refreshProject(
  deps: ProjectsDeps,
  actor: Actor,
  projectId: string,
): Promise<void> {
  const project = await withOrganization(deps.pool, actor.organizationId, async (client) => {
    const { rows } = await client.query<ProjectRow>(
      'SELECT id, repository, hosting_provider, hosting_ref, production_url, last_commit_at, state, state_reason, link_status FROM projects WHERE id = $1',
      [projectId],
    );
    return rows[0];
  });
  if (!project) throw new AppError('project.not_found', 404, 'No such project.');
  const creds = await credentials(deps, actor.organizationId);

  let lastCommitAt = project.last_commit_at;
  const host = connected(deps.adapters.codeHosts, creds)[0];
  if (host) {
    const repository = await host.adapter
      .repository(host.credential, project.repository)
      .catch(() => null);
    if (repository?.pushedAt) lastCommitAt = repository.pushedAt;
  }

  let productionUrl = project.production_url;
  let deployments: Deployment[] = [];
  let connectionExpired = false;
  const hosting = deps.adapters.hostings.find((h) => h.id === project.hosting_provider);
  if (hosting && project.hosting_ref) {
    const credential = creds.byProvider.get(hosting.id);
    if (!credential) connectionExpired = true;
    else {
      const site = await hosting.site(credential, project.hosting_ref).catch(() => null);
      if (site?.productionUrl) productionUrl = site.productionUrl;
      deployments = await hosting.deployments(credential, project.hosting_ref).catch(() => []);
    }
  }

  const link: LinkStatus = productionUrl
    ? await deps.adapters.links.check(productionUrl)
    : 'missing';
  const latestProduction =
    deployments
      .filter((d) => d.environment === 'production')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  const { state, reason } = projectState({
    link,
    latestProduction,
    lastCommitAt,
    connectionExpired,
    now: deps.now(),
  });

  await withOrganization(deps.pool, actor.organizationId, async (client) => {
    await client.query(
      `UPDATE projects SET production_url = $2, link_status = $3, last_commit_at = $4, state = $5,
         state_reason = $6, refreshed_at = now() WHERE id = $1`,
      [projectId, productionUrl, link, lastCommitAt, state, reason],
    );
    await saveDeployments(client, actor.organizationId, projectId, deployments);
    // The periodic reading journals only what changed: a person's own refresh always shows.
    const changed =
      state !== project.state || reason !== project.state_reason || link !== project.link_status;
    if (actor.channel === 'system' && !changed) return;
    await record(client, {
      organizationId: actor.organizationId,
      projectId,
      action: 'project.refreshed',
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: { state, reason, link },
    });
  });
}

async function saveDeployments(
  client: Client,
  organizationId: string,
  projectId: string,
  deployments: Deployment[],
): Promise<void> {
  for (const d of deployments.slice(0, 20)) {
    await client.query(
      `INSERT INTO deployments (organization_id, project_id, environment, external_id, status, url, commit_sha, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (project_id, external_id) DO UPDATE SET status = excluded.status, url = excluded.url`,
      [
        organizationId,
        projectId,
        d.environment,
        d.externalId,
        d.status,
        d.url,
        d.commitSha,
        d.createdAt,
      ],
    );
  }
}

/**
 * Puts a project online (D-037): the site that builds its repository is created at the connected
 * hosting, which reads the repository with a read-only key and builds on every push to the
 * default branch, starting now. Production still changes only by a proposal, under the project's
 * release rule. A project that already has its site is left as it is.
 */
export async function putOnline(
  deps: ProjectsDeps,
  actor: Actor,
  projectId: string,
): Promise<{ created: boolean; provider: string; productionUrl: string | null }> {
  const project = await withOrganization(deps.pool, actor.organizationId, async (client) => {
    const { rows } = await client.query<{
      repository: string;
      default_branch: string;
      hosting_provider: string | null;
      hosting_ref: string | null;
      production_url: string | null;
    }>(
      'SELECT repository, default_branch, hosting_provider, hosting_ref, production_url FROM projects WHERE id = $1',
      [projectId],
    );
    return rows[0];
  });
  if (!project) throw new AppError('project.not_found', 404, 'No such project.');
  if (project.hosting_provider && project.hosting_ref)
    return {
      created: false,
      provider: project.hosting_provider,
      productionUrl: project.production_url,
    };

  const creds = await credentials(deps, actor.organizationId);
  const code = codeHostOf(deps, creds);
  const hosting = connected(deps.adapters.hostings, creds).find(
    (h) => h.adapter.newDeployKey && h.adapter.createSite,
  );
  if (!hosting)
    throw new AppError(
      'release.no_hosting',
      409,
      'Connect a hosting that Pono can create a site at (Netlify).',
    );
  if (!code.adapter.grantReadKey || !code.adapter.sshUrl)
    throw new AppError('hosting.unsupported', 501, 'This code host cannot lend a deploy key.');

  const h = hosting.adapter;
  const key = await h.newDeployKey!(hosting.credential);
  await code.adapter
    .grantReadKey(code.credential, project.repository, 'Hosting (Pono)', key.publicKey)
    .catch((error: unknown) => {
      if (error instanceof ProviderError && (error.status === 403 || error.status === 404))
        throw new AppError(
          'code_host.permission_missing',
          403,
          'The code host refused to add a deploy key: Pono needs the Administration permission on this repository.',
        );
      throw error;
    });
  const base = project.repository
    .split('/')[1]!
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-');
  let created: Awaited<ReturnType<NonNullable<typeof h.createSite>>> | null = null;
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    const name = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 7)}`;
    created = await h.createSite!(hosting.credential, {
      name: name.slice(0, 60),
      gitUrl: code.adapter.sshUrl(project.repository),
      branch: project.default_branch,
      deployKeyId: key.id,
      previewBranches: project.default_branch === 'dev' ? [] : ['dev'],
    }).catch((error: unknown) => {
      // A name taken by someone else at the host: another one, then.
      if (error instanceof ProviderError && error.status === 422) return null;
      throw error;
    });
  }
  if (!created) throw new AppError('hosting.name_taken', 409, 'No free site name was found.');
  if (created.pushHookUrl && code.adapter.addPushHook)
    await code.adapter
      .addPushHook(code.credential, project.repository, created.pushHookUrl)
      .catch(() => undefined);
  await h.startBuild?.(hosting.credential, created.site.ref).catch(() => undefined);
  // dev may hold work pushed before the site existed: its preview is built now, not at the next push.
  if (project.default_branch !== 'dev')
    await h.buildBranch?.(hosting.credential, created.site.ref, 'dev').catch(() => undefined);

  await withOrganization(deps.pool, actor.organizationId, async (client) => {
    await client.query(
      // The address exists from now on; whether it answers is the next reading's (« unknown » until then).
      `UPDATE projects SET hosting_provider = $2, hosting_ref = $3, hosting_status = 'found',
         production_url = $4, link_status = 'unknown' WHERE id = $1`,
      [projectId, h.id, created.site.ref, created.site.productionUrl],
    );
    await record(client, {
      organizationId: actor.organizationId,
      projectId,
      action: 'project.site_created',
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: { provider: h.id, url: created.site.productionUrl },
    });
  });
  return { created: true, provider: h.id, productionUrl: created.site.productionUrl };
}
