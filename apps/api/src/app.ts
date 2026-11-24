import { Hono } from 'hono';
import { adminRoutes } from './features/admin/index.js';
import { analyticsRoutes, type SiteAnalytics } from './features/analytics/index.js';
import { billingWebhook, planRoutes, type BillingProvider } from './features/billing/index.js';
import type { LicenceProvider } from './features/billing/licences.js';
import { offerRoutes } from './features/offers/index.js';
import { agentRoutes, mcpHandler } from './features/agents/index.js';
import { oauthMetadata, oauthRoutes } from './features/agents/oauth.js';
import { variableRoutes } from './features/variables/index.js';
import { devRoutes } from './features/devloop/index.js';
import { codeHook } from './features/devloop/webhook.js';
import { rateLimit } from './platform/rate-limit.js';
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
  /** A limited server network (D-031): what every server reaches, and each service's domains. */
  networkBase?: string[];
  serviceDomains?: Record<string, readonly string[]>;
  catalog: Catalog;
  billing: BillingProvider;
  /** Plans sold as licence keys (D-041), and the environment's values of the operator's settings. */
  licences?: LicenceProvider;
  settingsEnv?: Partial<Record<string, string>>;
  /** Where projects' visits are counted (D-017): Umami, PostHog. */
  analytics?: SiteAnalytics[];
  admins: string[];
  serverAccount?: () => Promise<{ balanceMicros: number; activeLimit: number } | null>;
  walletTopUp?: (amountUsd: number) => Promise<string>;
  /** Signs the code host's push events (D-020). */
  webhookSecret?: string;
  /** Requests per minute and per caller; tests raise them. */
  rateLimits?: { auth: number; v1: number; mcp: number };
  now: () => Date;
}

/** The API: every route, and errors in one shape with a stable code (FR-008). */
export function createApp(appDeps: AppDeps): Hono<AppEnv> {
  const deps: AppDeps & ManifestDeps & { analytics: SiteAnalytics[] } = {
    ...appDeps,
    analytics: appDeps.analytics ?? [],
    afterImport: async (actor, projectId, options) => {
      await syncManifest(deps, actor, projectId, options);
    },
  };
  const app = new Hono<AppEnv>();
  const limits = appDeps.rateLimits ?? { auth: 30, v1: 600, mcp: 240 };
  app.use('/auth/*', rateLimit({ name: 'auth', windowMs: 60_000, max: limits.auth }));
  app.use('/oauth/*', rateLimit({ name: 'oauth', windowMs: 60_000, max: limits.auth }));
  app.use('/v1/*', rateLimit({ name: 'v1', windowMs: 60_000, max: limits.v1 }));
  app.use('/mcp', rateLimit({ name: 'mcp', windowMs: 60_000, max: limits.mcp }));
  app.route('/.well-known', oauthMetadata(deps));
  app.route('/oauth', oauthRoutes(deps));
  app.route('/health', healthRoutes({ databaseUp: () => ping(deps.pool) }));
  app.route('/auth', authRoutes(deps));
  // Read signed out, before the session check of /v1: the landing shows the plans as sold.
  app.route('/v1/offers', offerRoutes(deps));

  const v1 = new Hono<AppEnv>();
  v1.use('*', requireSession(deps));
  v1.route('/me', meRoutes(deps));
  v1.route('/connections', connectionRoutes(deps));
  v1.route('/', projectRoutes(deps));
  v1.route('/', manifestRoutes(deps));
  v1.route('/', analyticsRoutes(deps));
  v1.route('/', variableRoutes(deps));
  v1.route('/', devRoutes(deps));
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
  app.route('/hooks', codeHook(deps));

  app.notFound((c) => c.json(errorBody('route.not_found', 'No such route.'), 404));
  app.onError((error, c) => {
    // A link opened in a browser while signed out (a private preview, D-031): to the sign-in page.
    if (
      error instanceof AppError &&
      error.status === 401 &&
      c.req.method === 'GET' &&
      (c.req.header('accept') ?? '').includes('text/html')
    )
      return c.redirect('/');
    if (error instanceof AppError)
      return c.json(errorBody(error.code, error.message, error.detail), error.status);
    console.error(error);
    return c.json(errorBody('internal', 'Something went wrong.'), 500);
  });
  return app;
}
