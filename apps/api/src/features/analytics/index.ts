import { Hono } from 'hono';
import { z } from 'zod';
import type { Actor, AppEnv } from '../../platform/context.js';
import { withOrganization } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { ProviderError } from '../../platform/http.js';
import { activeCredentials } from '../connections/index.js';
import { record } from '../journal/index.js';
import { proposeManifestChange, type ManifestDeps } from '../manifest/index.js';
import type { Site, SiteAnalytics, SiteStats } from './ports.js';

export type * from './ports.js';

export interface AnalyticsDeps extends ManifestDeps {
  analytics: SiteAnalytics[];
}

type Reach = Pick<AnalyticsDeps, 'pool' | 'sealer' | 'analytics'>;

async function connectedAnalytics(deps: Reach, organizationId: string) {
  const creds = await withOrganization(deps.pool, organizationId, (client) =>
    activeCredentials(client, deps.sealer, 'analytics'),
  );
  return deps.analytics.flatMap((adapter) => {
    const credential = creds.find((c) => c.provider === adapter.id)?.credential;
    return credential ? [{ adapter, credential }] : [];
  });
}

export type SiteMetrics =
  | { source: 'measured'; provider: string; site: string; days: number; stats: SiteStats }
  | {
      source: 'unavailable';
      reason: 'not_linked' | 'not_connected' | 'provider_refused';
      provider?: string;
    };

/** A project's visits over the last days, measured at its provider, or a gap that says why (D-005). */
export async function siteMetrics(
  deps: AnalyticsDeps,
  actor: Actor,
  projectId: string,
  days: number,
): Promise<SiteMetrics> {
  const link = await withOrganization(deps.pool, actor.organizationId, async (client) => {
    const { rows } = await client.query<{
      analytics_provider: string | null;
      analytics_site: string | null;
      manifest: { analytics?: { provider: string; website: string } } | null;
      manifest_status: string;
    }>(
      'SELECT analytics_provider, analytics_site, manifest, manifest_status FROM projects WHERE id = $1',
      [projectId],
    );
    if (!rows[0]) throw new AppError('project.not_found', 404, 'No such project.');
    const fromFile =
      rows[0].manifest_status === 'present' ? rows[0].manifest?.analytics : undefined;
    if (fromFile) return { provider: fromFile.provider, site: fromFile.website };
    return rows[0].analytics_provider && rows[0].analytics_site
      ? { provider: rows[0].analytics_provider, site: rows[0].analytics_site }
      : null;
  });
  if (!link) return { source: 'unavailable', reason: 'not_linked' };
  const connected = (await connectedAnalytics(deps, actor.organizationId)).find(
    (c) => c.adapter.id === link.provider || c.adapter.id.startsWith(`${link.provider}-`),
  );
  if (!connected)
    return { source: 'unavailable', reason: 'not_connected', provider: link.provider };
  const to = deps.now();
  const from = new Date(to.getTime() - days * 86_400_000);
  try {
    const stats = await connected.adapter.stats(connected.credential, link.site, { from, to });
    return { source: 'measured', provider: link.provider, site: link.site, days, stats };
  } catch (error) {
    if (error instanceof ProviderError)
      return { source: 'unavailable', reason: 'provider_refused', provider: link.provider };
    throw error;
  }
}

/** The sites of every connected analytics provider, to link a project to one. */
export async function listSites(
  deps: AnalyticsDeps,
  actor: Actor,
): Promise<{ provider: string; sites: Site[] }[]> {
  const out = [];
  for (const { adapter, credential } of await connectedAnalytics(deps, actor.organizationId)) {
    const sites = await adapter.listSites(credential).catch(() => []);
    out.push({ provider: adapter.id, sites });
  }
  return out;
}

/** The family name written in pono.yaml: `umami` for Umami Cloud or self-hosted. */
const family = (adapterId: string) => (adapterId.startsWith('umami') ? 'umami' : adapterId);

/**
 * Links a project to a site: kept at once, and proposed in pono.yaml so the repository says it too.
 */
export async function linkSite(
  deps: AnalyticsDeps,
  actor: Actor,
  projectId: string,
  input: { provider: string; site: string },
): Promise<{ proposalUrl: string | null }> {
  const connected = (await connectedAnalytics(deps, actor.organizationId)).find(
    (c) => c.adapter.id === input.provider,
  );
  if (!connected)
    throw new AppError('analytics.not_connected', 409, 'Connect the analytics provider first.');
  const sites = await connected.adapter.listSites(connected.credential);
  if (!sites.some((s) => s.ref === input.site))
    throw new AppError('analytics.site_not_found', 404, 'No such site at the provider.');
  const provider = family(input.provider);
  await withOrganization(deps.pool, actor.organizationId, async (client) => {
    const updated = await client.query(
      'UPDATE projects SET analytics_provider = $2, analytics_site = $3 WHERE id = $1',
      [projectId, provider, input.site],
    );
    if (!updated.rowCount) throw new AppError('project.not_found', 404, 'No such project.');
    await record(client, {
      organizationId: actor.organizationId,
      projectId,
      action: 'analytics.linked',
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: { provider },
    });
  });
  const proposal = await proposeManifestChange(
    deps,
    actor,
    projectId,
    (m) => ({
      ...m,
      analytics: { provider: provider as 'umami' | 'posthog', website: input.site },
    }),
    { branch: 'pono/analytics', title: 'Name the analytics site in pono.yaml' },
  ).catch(() => null);
  return { proposalUrl: proposal?.url ?? null };
}

/**
 * At launch: a site created at the first connected provider that creates sites (Umami), with the
 * script the agent adds once to the root layout. Null when none is connected.
 */
export async function siteForLaunch(
  deps: Reach,
  actor: Actor,
  name: string,
): Promise<{ provider: 'umami' | 'posthog'; site: string; script: string } | null> {
  for (const { adapter, credential } of await connectedAnalytics(deps, actor.organizationId)) {
    const created = await adapter.createSite(credential, { name, domain: name }).catch(() => null);
    if (created)
      return {
        provider: family(adapter.id) as 'umami' | 'posthog',
        site: created.ref,
        script: created.script,
      };
  }
  return null;
}

const uuid = z.uuid();

/** `/v1/projects/:id/analytics` and `/v1/analytics/sites`. */
export function analyticsRoutes(deps: AnalyticsDeps): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .get('/analytics/sites', async (c) => c.json({ providers: await listSites(deps, c.var.actor) }))
    .get('/projects/:id/analytics', async (c) => {
      const id = c.req.param('id');
      if (!uuid.safeParse(id).success)
        throw new AppError('project.not_found', 404, 'No such project.');
      const days = Math.min(90, Math.max(1, Number(c.req.query('days') ?? 30) || 30));
      return c.json(await siteMetrics(deps, c.var.actor, id, days));
    })
    .put('/projects/:id/analytics', async (c) => {
      const id = c.req.param('id');
      const body = z
        .object({ provider: z.string().min(1).max(50), site: z.string().min(1).max(200) })
        .safeParse(await c.req.json().catch(() => null));
      if (!uuid.safeParse(id).success || !body.success)
        throw new AppError('request.invalid', 400, 'Expected a provider and a site.');
      return c.json(await linkSite(deps, c.var.actor, id, body.data));
    });
}
