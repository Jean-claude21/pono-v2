import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../platform/context.js';
import { withOrganization, type Pool } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { readTemplateRepository, skillInput } from '../catalog/index.js';
import { activeCredentials } from '../connections/index.js';
import { record } from '../journal/index.js';
import type { WorkshopAdapters } from '../projects/index.js';
import type { Sealer } from '../../platform/secrets.js';
import { PLANS, type Plan, type ProjectServerHost } from '../servers/index.js';

export interface AdminDeps {
  pool: Pool;
  sealer: Sealer;
  adapters: WorkshopAdapters;
  serverHost: ProjectServerHost;
  /** Logins of the platform's operators (`PONO_ADMIN_LOGINS`). */
  admins: string[];
  /** The server provider's workspace wallet, when it says it. */
  serverAccount?: () => Promise<{ balanceMicros: number; activeLimit: number } | null>;
}

function onlyAdmins(deps: AdminDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!deps.admins.includes(c.var.actor.login) || c.var.actor.channel !== 'console') {
      throw new AppError('admin.forbidden', 403, 'Reserved to the platform’s operators.');
    }
    await next();
  };
}

/** `/v1/admin/*`: the operator's view across organizations — counts and states, never code, data or keys. */
export function adminRoutes(deps: AdminDeps): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .use('*', onlyAdmins(deps))
    .get('/overview', async (c) => {
      const orgs = (
        await deps.pool.query<{
          plan: Plan;
          active_servers: string;
          sleeping_servers: string;
          server_micros: string;
          projects: string;
        }>('SELECT * FROM admin_organizations()')
      ).rows;
      const revenue = orgs.reduce((sum, o) => sum + PLANS[o.plan].priceMicros, 0);
      const serverCost = orgs.reduce((sum, o) => sum + Number(o.server_micros), 0);
      const account = (await deps.serverAccount?.().catch(() => null)) ?? null;
      return c.json({
        organizations: orgs.length,
        paying: orgs.filter((o) => o.plan !== 'free').length,
        projects: orgs.reduce((s, o) => s + Number(o.projects), 0),
        activeServers: orgs.reduce((s, o) => s + Number(o.active_servers), 0),
        sleepingServers: orgs.reduce((s, o) => s + Number(o.sleeping_servers), 0),
        monthlyRevenueMicros: revenue,
        monthlyServerCostMicros: serverCost,
        serverAccount: account,
        plans: Object.fromEntries(
          (Object.keys(PLANS) as Plan[]).map((p) => [p, orgs.filter((o) => o.plan === p).length]),
        ),
      });
    })
    .get('/organizations', async (c) => {
      const { rows } = await deps.pool.query<{
        id: string;
        name: string;
        plan: Plan;
        created_at: Date;
        projects: string;
        active_servers: string;
        sleeping_servers: string;
        server_micros: string;
      }>('SELECT * FROM admin_organizations()');
      return c.json({
        organizations: rows.map((o) => ({
          id: o.id,
          name: o.name,
          plan: o.plan,
          createdAt: o.created_at.toISOString(),
          projects: Number(o.projects),
          activeServers: Number(o.active_servers),
          sleepingServers: Number(o.sleeping_servers),
          serverMicros: Number(o.server_micros),
          revenueMicros: PLANS[o.plan].priceMicros,
        })),
      });
    })
    .get('/servers', async (c) => {
      const { rows } = await deps.pool.query<{
        id: string;
        organization_id: string;
        organization: string;
        project: string;
        provider: string;
        external_id: string;
        status: string;
        size: string;
        monthly_micros: string;
        status_at: Date;
      }>('SELECT * FROM admin_servers()');
      return c.json({
        servers: rows.map((s) => ({
          id: s.id,
          organizationId: s.organization_id,
          organization: s.organization,
          project: s.project,
          provider: s.provider,
          externalId: s.external_id,
          status: s.status,
          size: s.size,
          monthlyMicros: Number(s.monthly_micros),
          statusAt: s.status_at.toISOString(),
        })),
      });
    })
    .post('/servers/:id/sleep', async (c) => {
      const id = c.req.param('id');
      if (!z.uuid().safeParse(id).success)
        throw new AppError('server.not_found', 404, 'No such server.');
      const server = (
        await deps.pool.query<{ organization_id: string; external_id: string; status: string }>(
          'SELECT organization_id, external_id, status FROM admin_servers() WHERE id = $1',
          [id],
        )
      ).rows[0];
      if (!server) throw new AppError('server.not_found', 404, 'No such server.');
      await deps.serverHost.sleep(server.external_id);
      await withOrganization(deps.pool, server.organization_id, async (client) => {
        const updated = await client.query<{ project_id: string }>(
          "UPDATE project_servers SET status = 'sleeping', status_at = now() WHERE id = $1 RETURNING project_id",
          [id],
        );
        await record(client, {
          organizationId: server.organization_id,
          projectId: updated.rows[0]?.project_id ?? null,
          action: 'admin.server_slept',
          actorPerson: c.var.actor.personId,
          channel: 'console',
          detail: { operator: c.var.actor.login },
        });
      });
      return c.body(null, 204);
    })
    .get('/catalog', async (c) => {
      const { rows } = await deps.pool.query<{
        id: string;
        organization_id: string | null;
        organization_name: string | null;
        kind: string;
        name: string;
        body: unknown;
        sharing: string;
        updated_at: Date;
      }>('SELECT * FROM admin_catalog_entries()');
      return c.json({
        entries: rows.map((r) => ({
          id: r.id,
          organization: r.organization_name,
          kind: r.kind,
          name: r.name,
          body: r.body,
          sharing: r.sharing,
          updatedAt: r.updated_at.toISOString(),
        })),
      });
    })
    .post('/catalog/import', async (c) => {
      const body = z
        .object({ repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/) })
        .safeParse(await c.req.json().catch(() => null));
      if (!body.success)
        throw new AppError('request.invalid', 400, 'Expected a repository: owner/name.');
      const actor = c.var.actor;
      const creds = await withOrganization(deps.pool, actor.organizationId, (client) =>
        activeCredentials(client, deps.sealer, 'code_host'),
      );
      const host = deps.adapters.codeHosts.find((h) => creds.some((x) => x.provider === h.id));
      const credential = creds.find((x) => x.provider === host?.id)?.credential;
      if (!host || !credential)
        throw new AppError('connection.code_host_missing', 409, 'Connect your code host first.');
      const repository = await host.repository(credential, body.data.repository);
      if (!repository)
        throw new AppError('project.repository_not_found', 404, 'No such repository.');
      const ref = repository.defaultBranch;
      const templateFile = await host.fileAt(
        credential,
        repository.fullName,
        'pono-template.yaml',
        ref,
      );
      if (!templateFile)
        throw new AppError('catalog.unreadable', 422, 'The repository has no pono-template.yaml.');
      const names = (
        await host.listDirectory(credential, repository.fullName, '.pono/skills', ref)
      ).filter((n) => n.endsWith('.md'));
      const skillFiles: string[] = [];
      for (const n of names) {
        const content = await host.fileAt(
          credential,
          repository.fullName,
          `.pono/skills/${n}`,
          ref,
        );
        if (content) skillFiles.push(content);
      }
      const { template, skills } = readTemplateRepository(
        repository.fullName,
        templateFile,
        skillFiles,
      );
      for (const skill of skills)
        await deps.pool.query('SELECT admin_catalog_publish($1, $2, $3)', [
          'skill',
          skill.name,
          JSON.stringify(skillInput.parse(skill)),
        ]);
      await host.markAsTemplate(credential, repository.fullName);
      await deps.pool.query('SELECT admin_catalog_publish($1, $2, $3)', [
        'template',
        template.id,
        JSON.stringify(template),
      ]);
      await withOrganization(deps.pool, actor.organizationId, (client) =>
        record(client, {
          organizationId: actor.organizationId,
          action: 'admin.catalog_imported',
          actorPerson: actor.personId,
          channel: 'console',
          detail: { repository: repository.fullName, template: template.id, skills: skills.length },
        }),
      );
      return c.json({ template, skills: skills.map((s) => s.name) }, 201);
    })
    .post('/catalog/:id/review', async (c) => {
      const id = c.req.param('id');
      const body = z
        .object({ decision: z.enum(['shared', 'refused', 'private']) })
        .safeParse(await c.req.json().catch(() => null));
      if (!z.uuid().safeParse(id).success || !body.success)
        throw new AppError('request.invalid', 400, 'Expected shared, refused or private.');
      const { rows } = await deps.pool.query<{ org: string | null }>(
        'SELECT admin_catalog_review($1, $2) AS org',
        [id, body.data.decision],
      );
      const org = rows[0]?.org;
      if (!org) throw new AppError('catalog.not_found', 404, 'No such entry.');
      await withOrganization(deps.pool, org, (client) =>
        record(client, {
          organizationId: org,
          action: `catalog.${body.data.decision === 'shared' ? 'shared' : body.data.decision === 'refused' ? 'refused' : 'unshared'}`,
          actorPerson: c.var.actor.personId,
          channel: 'console',
          detail: { operator: c.var.actor.login },
        }),
      );
      return c.body(null, 204);
    })
    .delete('/catalog/:id', async (c) => {
      const id = c.req.param('id');
      if (!z.uuid().safeParse(id).success)
        throw new AppError('catalog.not_found', 404, 'No such entry.');
      await deps.pool.query('SELECT admin_catalog_remove($1)', [id]);
      return c.body(null, 204);
    });
}
