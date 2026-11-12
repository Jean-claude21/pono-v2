import { Hono } from 'hono';
import { adminRoutes } from './features/admin/index.js';
import { analyticsRoutes, type SiteAnalytics } from './features/analytics/index.js';
import { billingWebhook, planRoutes, type BillingProvider } from './features/billing/index.js';
import { agentRoutes, mcpHandler } from './features/agents/index.js';
import { catalogRoutes, type Catalog } from './features/catalog/index.js';
import { connectionRoutes, type Connectable } from './features/connections/index.js';
import { healthRoutes } from './features/health/index.js';
import {
  authRoutes,
  meRoutes,
  requireSession,
  type IdentityProvider,
} from './features/identity/index.js';
import { launchRoutes } from './features/launch/index.js';
import { manifestRoutes, syncManifest, type ManifestDeps } from './features/manifest/index.js';
import { projectRoutes, type WorkshopAdapters } from './features/projects/index.js';
import { releaseRoutes } from './features/releases/index.js';
import { serverRoutes, serversUsage, type ProjectServerHost } from './features/servers/index.js';
import { usageRoutes, type InternalUsage, type UsageSource } from './features/usage/index.js';
import type { AppEnv } from './platform/context.js';
import { ping, type Pool } from './platform/db.js';
import { AppError, errorBody } from './platform/errors.js';
import type { Sealer } from './platform/secrets.js';

export interface AppDeps {
  pool: Pool;
  sealer: Sealer;
  publicUrl: string;
  secureCookies: boolean;
  identity: IdentityProvider[];
  connectable: Connectable[];
  adapters: WorkshopAdapters;
  usageSources: UsageSource[];
  internalUsage?: InternalUsage[];
  serverHost: ProjectServerHost;
  serverBudgetMicros: number;
  serverIdleSeconds: number;
  catalog: Catalog;
  billing: BillingProvider;
  /** Where projects' visits are counted (D-017): Umami, PostHog. */
  analytics?: SiteAnalytics[];
  admins: string[];
  serverAccount?: () => Promise<{ balanceMicros: number; activeLimit: number } | null>;
  now: () => Date;
}

/** The API: every route, and errors in one shape with a stable code (FR-008). */
export function createApp(appDeps: AppDeps): Hono<AppEnv> {
  const deps: AppDeps & ManifestDeps & { analytics: SiteAnalytics[] } = {
    ...appDeps,
    analytics: appDeps.analytics ?? [],
    afterImport: async (actor, projectId) => {
      await syncManifest(deps, actor, projectId);
    },
  };
  const app = new Hono<AppEnv>();
  app.route('/health', healthRoutes({ databaseUp: () => ping(deps.pool) }));
  app.route('/auth', authRoutes(deps));

  const v1 = new Hono<AppEnv>();
  v1.use('*', requireSession(deps));
  v1.route('/me', meRoutes(deps));
  v1.route('/connections', connectionRoutes(deps));
  v1.route('/', projectRoutes(deps));
  v1.route('/', manifestRoutes(deps));
  v1.route('/', analyticsRoutes(deps));
  v1.route(
    '/',
    usageRoutes({ ...deps, internalUsage: [...(deps.internalUsage ?? []), serversUsage()] }),
  );
  v1.route('/', serverRoutes(deps));
  v1.route('/', releaseRoutes(deps));
  v1.route('/catalog', catalogRoutes(deps));
  v1.route('/launch', launchRoutes(deps));
  v1.route('/agents', agentRoutes(deps));
  v1.route('/plan', planRoutes(deps));
  v1.route('/admin', adminRoutes(deps));
  app.route('/v1', v1);
  app.all('/mcp', mcpHandler(deps));
  app.route('/billing', billingWebhook(deps));

  app.notFound((c) => c.json(errorBody('route.not_found', 'No such route.'), 404));
  app.onError((error, c) => {
    if (error instanceof AppError)
      return c.json(errorBody(error.code, error.message, error.detail), error.status);
    console.error(error);
    return c.json(errorBody('internal', 'Something went wrong.'), 500);
  });
  return app;
}
