import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../platform/context.js';
import { withOrganization } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { readJournal } from '../journal/index.js';
import {
  importProject,
  listRepositories,
  refreshProject,
  type ProjectsDeps,
} from './application.js';

export type { ProjectsDeps } from './application.js';
export type * from './ports.js';
export { projectState } from './domain/state.js';

const PROJECT_COLUMNS = `id, name, repository, default_branch, hosting_provider, hosting_status,
  database_provider, database_status, production_url, link_status, last_commit_at, state,
  state_reason, refreshed_at, created_at`;

interface ProjectRow {
  id: string;
  name: string;
  repository: string;
  default_branch: string;
  hosting_provider: string | null;
  hosting_status: string;
  database_provider: string | null;
  database_status: string;
  production_url: string | null;
  link_status: string;
  last_commit_at: Date | null;
  state: string;
  state_reason: string;
  refreshed_at: Date | null;
  created_at: Date;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function projectView(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    repository: row.repository,
    defaultBranch: row.default_branch,
    hosting: { provider: row.hosting_provider, status: row.hosting_status },
    database: { provider: row.database_provider, status: row.database_status },
    productionUrl: row.production_url,
    linkStatus: row.link_status,
    lastCommitAt: iso(row.last_commit_at),
    state: row.state,
    stateReason: row.state_reason,
    refreshedAt: iso(row.refreshed_at),
    createdAt: row.created_at.toISOString(),
  };
}

interface DeploymentRow {
  project_id: string;
  environment: string;
  status: string;
  url: string | null;
  commit_sha: string | null;
  created_at: Date;
}

function deploymentView(row: DeploymentRow) {
  return {
    environment: row.environment,
    status: row.status,
    url: row.url,
    commit: row.commit_sha,
    createdAt: row.created_at.toISOString(),
  };
}

const uuid = z.uuid();
function projectId(raw: string): string {
  if (!uuid.safeParse(raw).success)
    throw new AppError('project.not_found', 404, 'No such project.');
  return raw;
}

/** `/v1/repositories` and `/v1/projects` (US3, US4). */
export function projectRoutes(deps: ProjectsDeps): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .get('/repositories', async (c) => {
      const repositories = await listRepositories(deps, c.var.actor);
      return c.json({
        repositories: repositories.map((r) => ({
          fullName: r.fullName,
          private: r.private,
          pushedAt: iso(r.pushedAt),
        })),
      });
    })
    .get('/projects', async (c) => {
      const { projects, latest } = await withOrganization(
        deps.pool,
        c.var.actor.organizationId,
        async (client) => {
          const projects = (
            await client.query<ProjectRow>(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY name`)
          ).rows;
          const latest = (
            await client.query<DeploymentRow>(
              `SELECT DISTINCT ON (project_id) project_id, environment, status, url, commit_sha, created_at
             FROM deployments WHERE environment = 'production' ORDER BY project_id, created_at DESC`,
            )
          ).rows;
          return { projects, latest };
        },
      );
      const byProject = new Map(latest.map((d) => [d.project_id, deploymentView(d)]));
      return c.json({
        projects: projects.map((p) => ({
          ...projectView(p),
          latestProduction: byProject.get(p.id) ?? null,
        })),
      });
    })
    .post('/projects', async (c) => {
      const body = z
        .object({ repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/) })
        .safeParse(await c.req.json().catch(() => null));
      if (!body.success)
        throw new AppError('request.invalid', 400, 'Expected a repository: owner/name.');
      const id = await importProject(deps, c.var.actor, body.data.repository);
      return c.json({ id }, 201);
    })
    .get('/projects/:id', async (c) => {
      const id = projectId(c.req.param('id'));
      const found = await withOrganization(
        deps.pool,
        c.var.actor.organizationId,
        async (client) => {
          const project = (
            await client.query<ProjectRow>(
              `SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = $1`,
              [id],
            )
          ).rows[0];
          if (!project) return null;
          const deployments = (
            await client.query<DeploymentRow>(
              `SELECT project_id, environment, status, url, commit_sha, created_at FROM deployments
             WHERE project_id = $1 ORDER BY created_at DESC LIMIT 10`,
              [id],
            )
          ).rows;
          const journal = await readJournal(client, { projectId: id, limit: 20 });
          return { project, deployments, journal };
        },
      );
      if (!found) throw new AppError('project.not_found', 404, 'No such project.');
      return c.json({
        project: projectView(found.project),
        deployments: found.deployments.map(deploymentView),
        journal: found.journal,
      });
    })
    .post('/projects/:id/refresh', async (c) => {
      await refreshProject(deps, c.var.actor, projectId(c.req.param('id')));
      return c.body(null, 204);
    });
}
