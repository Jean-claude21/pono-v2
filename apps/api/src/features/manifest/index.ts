import { Hono } from 'hono';
import { z } from 'zod';
import type { Actor, AppEnv } from '../../platform/context.js';
import { withOrganization, type Client } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import type { Catalog } from '../catalog/index.js';
import { activeCredentials } from '../connections/index.js';
import { record } from '../journal/index.js';
import type { ProjectsDeps } from '../projects/application.js';
import {
  LEGACY_FILES,
  MANIFEST_PATH,
  prefill,
  readLegacy,
  readManifest,
  resolveSkills,
  writeManifest,
  type Draft,
  type Manifest,
  type ProjectOrigin,
  type SkillChoice,
} from './domain.js';

export * from './domain.js';

export interface ManifestDeps extends ProjectsDeps {
  catalog: Catalog;
}

const ADOPTION_BRANCH = 'pono/manifest';

interface ProjectRow {
  id: string;
  name: string;
  repository: string;
  default_branch: string;
  hosting_provider: string | null;
  hosting_ref: string | null;
  production_url: string | null;
  database_provider: string | null;
  database_ref: string | null;
  origin: ProjectOrigin;
  template: string | null;
  manifest_status: string;
  manifest: Manifest | null;
  manifest_problems: { path: string; message: string }[] | null;
  manifest_proposal_url: string | null;
  manifest_read_at: Date | null;
}

async function project(client: Client, id: string): Promise<ProjectRow> {
  const { rows } = await client.query<ProjectRow>(
    `SELECT id, name, repository, default_branch, hosting_provider, hosting_ref, production_url,
       database_provider, database_ref, origin, template, manifest_status, manifest, manifest_problems,
       manifest_proposal_url, manifest_read_at FROM projects WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw new AppError('project.not_found', 404, 'No such project.');
  return rows[0];
}

async function codeHost(deps: ManifestDeps, organizationId: string) {
  const creds = await withOrganization(deps.pool, organizationId, (client) =>
    activeCredentials(client, deps.sealer, 'code_host'),
  );
  for (const host of deps.adapters.codeHosts) {
    const credential = creds.find((c) => c.provider === host.id)?.credential;
    if (credential) return { host, credential };
  }
  throw new AppError('connection.code_host_missing', 409, 'Connect your code host first.');
}

function templateSkills(deps: ManifestDeps, template: string | null): string[] {
  return deps.catalog.templates.find((t) => t.id === template)?.skills ?? [];
}

/** The skills of a project, as its manifest and its origin decide them. */
export function skillsOf(deps: { catalog: Catalog }, row: ProjectRow): SkillChoice[] {
  return resolveSkills(
    deps.catalog.skills,
    row.origin,
    deps.catalog.templates.find((t) => t.id === row.template)?.skills ?? [],
    row.manifest?.skills,
  );
}

/** What a project's draft manifest would be, from what the repository and providers already say. */
async function draftManifest(
  deps: ManifestDeps,
  row: ProjectRow,
  read: (path: string) => Promise<string | null>,
): Promise<Manifest> {
  let draft: Draft | null = null;
  for (const path of LEGACY_FILES) {
    const content = await read(path).catch(() => null);
    draft = content ? readLegacy(path, content) : null;
    if (draft) break;
  }
  const manifest = prefill(
    {
      repositoryName: row.name,
      defaultBranch: row.default_branch,
      hosting:
        row.hosting_provider && row.hosting_ref
          ? {
              provider: row.hosting_provider,
              site: row.hosting_ref,
              url: row.production_url,
              branch: row.default_branch,
            }
          : null,
      database:
        row.database_provider && row.database_ref
          ? { provider: row.database_provider, ref: row.database_ref }
          : null,
    },
    draft,
  );
  if (row.template) manifest.template = row.template;
  // An adopted project gets the safety skills written down; the rest stays the person's choice.
  manifest.skills = {
    use: deps.catalog.skills
      .filter((s) =>
        row.origin === 'template'
          ? templateSkills(deps, row.template).includes(s.name)
          : s.family === 'safety',
      )
      .map((s) => s.name),
    local: '.pono/skills/',
  };
  return manifest;
}

export interface ManifestView {
  status: string;
  manifest: Manifest | null;
  problems: { path: string; message: string }[] | null;
  proposalUrl: string | null;
  readAt: string | null;
  origin: ProjectOrigin;
  template: string | null;
  skills: SkillChoice[];
}

function view(deps: { catalog: Catalog }, row: ProjectRow): ManifestView {
  return {
    status: row.manifest_status,
    manifest: row.manifest,
    problems: row.manifest_problems,
    proposalUrl: row.manifest_proposal_url,
    readAt: row.manifest_read_at?.toISOString() ?? null,
    origin: row.origin,
    template: row.template,
    skills: skillsOf(deps, row),
  };
}

/**
 * Reads `pono.yaml` from the production branch. Present: it is the project's truth. Missing: Pono
 * proposes one in a pull request, pre-filled, for the person to complete and merge (adoption).
 */
export async function syncManifest(
  deps: ManifestDeps,
  actor: Actor,
  projectId: string,
  options: { propose: boolean } = { propose: true },
): Promise<ManifestView> {
  const row = await withOrganization(deps.pool, actor.organizationId, (c) => project(c, projectId));
  const { host, credential } = await codeHost(deps, actor.organizationId);
  const read = (path: string) => host.fileAt(credential, row.repository, path, row.default_branch);

  let content: string | null;
  try {
    content = await read(MANIFEST_PATH);
  } catch {
    await withOrganization(deps.pool, actor.organizationId, (c) =>
      c.query("UPDATE projects SET manifest_status = 'unknown' WHERE id = $1", [projectId]),
    );
    return view(deps, { ...row, manifest_status: 'unknown' });
  }

  if (content !== null) {
    const reading = readManifest(content);
    const next = reading.ok
      ? { status: 'present', manifest: reading.manifest, problems: null }
      : { status: 'invalid', manifest: null, problems: reading.problems };
    await withOrganization(deps.pool, actor.organizationId, async (c) => {
      await c.query(
        `UPDATE projects SET manifest_status = $2, manifest = $3, manifest_problems = $4,
           manifest_proposal_url = CASE WHEN $2 = 'present' THEN NULL ELSE manifest_proposal_url END,
           manifest_read_at = now(),
           hosting_provider = coalesce(hosting_provider, $5), hosting_ref = coalesce(hosting_ref, $6),
           hosting_status = CASE WHEN hosting_provider IS NULL AND $5::text IS NOT NULL THEN 'found' ELSE hosting_status END,
           database_provider = coalesce(database_provider, $7), database_ref = coalesce(database_ref, $8),
           database_status = CASE WHEN database_provider IS NULL AND $7::text IS NOT NULL THEN 'found' ELSE database_status END
         WHERE id = $1`,
        [
          projectId,
          next.status,
          next.manifest ? JSON.stringify(next.manifest) : null,
          next.problems ? JSON.stringify(next.problems) : null,
          next.manifest?.environments?.production?.hosting ?? null,
          next.manifest?.environments?.production?.site ?? null,
          next.manifest?.database?.provider ?? null,
          next.manifest?.database?.project ?? null,
        ],
      );
      if (row.manifest_status !== next.status)
        await record(c, {
          organizationId: actor.organizationId,
          projectId,
          action: next.status === 'present' ? 'manifest.read' : 'manifest.invalid',
          actorPerson: actor.personId,
          channel: actor.channel,
          detail: next.problems ? { problems: next.problems.length } : {},
        });
    });
    return view(deps, {
      ...row,
      manifest_status: next.status,
      manifest: next.manifest,
      manifest_problems: next.problems,
      manifest_proposal_url: next.status === 'present' ? null : row.manifest_proposal_url,
      manifest_read_at: deps.now(),
    });
  }

  if (row.manifest_status === 'proposed' || !options.propose) return view(deps, row);

  const manifest = await draftManifest(deps, row, read);
  const proposal = await host.proposeFiles(credential, row.repository, {
    base: row.default_branch,
    branch: ADOPTION_BRANCH,
    title: 'Add pono.yaml',
    body: [
      'Pono proposes the manifest of this project, pre-filled from what the repository and the',
      'connected providers already say. Complete it, then merge: from then on, it is the truth Pono',
      'reads. It holds identifiers only, never a secret, and never the release mode.',
    ].join('\n'),
    files: { [MANIFEST_PATH]: writeManifest(manifest) },
  });
  await withOrganization(deps.pool, actor.organizationId, async (c) => {
    await c.query(
      `UPDATE projects SET manifest_status = 'proposed', manifest = $2, manifest_proposal_url = $3,
         manifest_read_at = now() WHERE id = $1`,
      [projectId, JSON.stringify(manifest), proposal.url],
    );
    await record(c, {
      organizationId: actor.organizationId,
      projectId,
      action: 'manifest.proposed',
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: { number: proposal.number },
    });
  });
  return view(deps, {
    ...row,
    manifest_status: 'proposed',
    manifest,
    manifest_proposal_url: proposal.url,
  });
}

/** Turns skills on or off: Pono proposes the change of `pono.yaml`, the file stays the truth. */
export async function proposeSkills(
  deps: ManifestDeps,
  actor: Actor,
  projectId: string,
  change: { use: string[]; off: string[] },
): Promise<{ url: string }> {
  const known = new Set(deps.catalog.skills.map((s) => s.name));
  const unknown = [...change.use, ...change.off].filter((n) => !known.has(n));
  if (unknown.length)
    throw new AppError('skill.not_found', 404, 'No such skill.', { skills: unknown });
  const row = await withOrganization(deps.pool, actor.organizationId, (c) => project(c, projectId));
  const { host, credential } = await codeHost(deps, actor.organizationId);
  const base =
    row.manifest ??
    (await draftManifest(deps, row, (path) =>
      host.fileAt(credential, row.repository, path, row.default_branch),
    ));
  const use = new Set([...(base.skills?.use ?? []), ...change.use]);
  const off = new Set([...(base.skills?.off ?? []), ...change.off]);
  for (const n of change.use) off.delete(n);
  for (const n of change.off) use.delete(n);
  const manifest: Manifest = {
    ...base,
    skills: {
      ...base.skills,
      ...(use.size ? { use: [...use].sort() } : { use: [] }),
      ...(off.size ? { off: [...off].sort() } : {}),
    },
  };
  const proposal = await host.proposeFiles(credential, row.repository, {
    base: row.default_branch,
    branch: row.manifest_status === 'present' ? 'pono/skills' : ADOPTION_BRANCH,
    title: row.manifest_status === 'present' ? 'Update the skills in pono.yaml' : 'Add pono.yaml',
    body: 'The skills chosen for this project, written in its manifest. Merge to apply.',
    files: { [MANIFEST_PATH]: writeManifest(manifest) },
  });
  await withOrganization(deps.pool, actor.organizationId, async (c) => {
    if (row.manifest_status !== 'present')
      await c.query(
        "UPDATE projects SET manifest_status = 'proposed', manifest = $2, manifest_proposal_url = $3 WHERE id = $1",
        [projectId, JSON.stringify(manifest), proposal.url],
      );
    await record(c, {
      organizationId: actor.organizationId,
      projectId,
      action: 'skills.proposed',
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: { use: change.use, off: change.off, number: proposal.number },
    });
  });
  return { url: proposal.url };
}

export async function manifestView(
  deps: ManifestDeps,
  actor: Actor,
  projectId: string,
): Promise<ManifestView> {
  return withOrganization(deps.pool, actor.organizationId, async (c) =>
    view(deps, await project(c, projectId)),
  );
}

const uuid = z.uuid();
function idOf(raw: string): string {
  if (!uuid.safeParse(raw).success)
    throw new AppError('project.not_found', 404, 'No such project.');
  return raw;
}

const skillChange = z.object({
  use: z.array(z.string().min(1).max(100)).max(50).default([]),
  off: z.array(z.string().min(1).max(100)).max(50).default([]),
});

/** `/v1/projects/:id/manifest` and `/v1/projects/:id/skills`. */
export function manifestRoutes(deps: ManifestDeps): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .get('/projects/:id/manifest', async (c) =>
      c.json(await manifestView(deps, c.var.actor, idOf(c.req.param('id')))),
    )
    .post('/projects/:id/manifest/sync', async (c) =>
      c.json(await syncManifest(deps, c.var.actor, idOf(c.req.param('id')))),
    )
    .put('/projects/:id/skills', async (c) => {
      const body = skillChange.safeParse(await c.req.json().catch(() => null));
      if (!body.success) throw new AppError('request.invalid', 400, 'Expected use and off lists.');
      return c.json(await proposeSkills(deps, c.var.actor, idOf(c.req.param('id')), body.data));
    });
}
