import { coolifyHosting } from './infrastructure/providers/coolify.js';
import { resendNotifier } from './infrastructure/providers/resend.js';
import { startJobs } from './features/operations/index.js';
import { serversUsage } from './features/servers/index.js';
import { posthogAnalytics } from './infrastructure/providers/posthog.js';
import { umamiCloud, umamiSelfHosted } from './infrastructure/providers/umami.js';
import { serve } from '@hono/node-server';
import { initMonitoring, reportError } from './platform/monitor.js';
import { createApp, type AppDeps } from './app.js';
import { loadCatalog } from './features/catalog/index.js';
import { devIdentity, githubIdentity, type IdentityProvider } from './features/identity/index.js';
import { githubRefresher } from './features/identity/infrastructure/github.js';
import { setRefresher } from './features/connections/index.js';
import { agent37Account, agent37Host, agent37TopUp } from './infrastructure/providers/agent37.js';
import {
  devBilling,
  stripeBilling,
  unavailableBilling,
} from './infrastructure/providers/stripe.js';
import { chariowLicences } from './infrastructure/providers/chariow.js';
import { monerooBilling } from './infrastructure/providers/moneroo.js';
import { unavailableServerHost } from './infrastructure/providers/no-server-host.js';
import { cloudflareHosting } from './infrastructure/providers/cloudflare.js';
import { githubCodeHost } from './infrastructure/providers/github.js';
import { httpLinkChecker } from './infrastructure/providers/links.js';
import { netlifyHosting } from './infrastructure/providers/netlify.js';
import { vercelHosting } from './infrastructure/providers/vercel.js';
import { neonDatabase } from './infrastructure/providers/neon.js';
import {
  cloudflareUsage,
  githubUsage,
  netlifyUsage,
  neonUsage,
  openaiUsage,
} from './infrastructure/providers/usage.js';
import { loadConfig } from './platform/config.js';
import { createPool } from './platform/db.js';
import { Sealer } from './platform/secrets.js';

const config = loadConfig();
// Unexpected errors go to the tracker when it is configured (D-046).
initMonitoring({
  dsn: config.PONO_SENTRY_DSN,
  publicUrl: config.PONO_PUBLIC_URL,
  nodeEnv: config.NODE_ENV,
  release: process.env.SOURCE_COMMIT,
});

const identity: IdentityProvider[] = [];
if (config.PONO_GITHUB_CLIENT_ID && config.PONO_GITHUB_CLIENT_SECRET) {
  identity.push(
    githubIdentity({
      clientId: config.PONO_GITHUB_CLIENT_ID,
      clientSecret: config.PONO_GITHUB_CLIENT_SECRET,
      fetch,
    }),
  );
}
if (config.PONO_DEV_SIGN_IN === '1') identity.push(devIdentity());
// A GitHub App's user tokens last 8 hours: renewed with their refresh token (D-032).
setRefresher(
  'github',
  config.PONO_GITHUB_CLIENT_ID && config.PONO_GITHUB_CLIENT_SECRET
    ? githubRefresher({
        clientId: config.PONO_GITHUB_CLIENT_ID,
        clientSecret: config.PONO_GITHUB_CLIENT_SECRET,
        fetch,
      })
    : null,
);

const github = githubCodeHost(fetch);
const netlify = netlifyHosting(
  fetch,
  config.NETLIFY_OAUTH_CLIENT_ID && config.NETLIFY_OAUTH_CLIENT_SECRET
    ? { clientId: config.NETLIFY_OAUTH_CLIENT_ID, clientSecret: config.NETLIFY_OAUTH_CLIENT_SECRET }
    : undefined,
);
const vercel = vercelHosting(fetch);
const coolify = coolifyHosting(fetch);
const cloudflare = cloudflareHosting(fetch);
const neon = neonDatabase(fetch);
const openai = openaiUsage(fetch);
const umami = umamiCloud(fetch);
const umamiSelf = umamiSelfHosted(fetch);
const posthog = posthogAnalytics(fetch);

const connectable = [
  github,
  netlify,
  vercel,
  cloudflare,
  coolify,
  neon,
  openai,
  umami,
  umamiSelf,
  posthog,
];

/**
 * What a server with a limited network always reaches (D-031): the package registries, so that an
 * install works; the code host and the connected services are added from their own adapters.
 */
const NETWORK_BASE = [
  'registry.npmjs.org',
  '*.npmjs.org',
  'registry.yarnpkg.com',
  'repo.yarnpkg.com',
  'nodejs.org',
  'pypi.org',
  'files.pythonhosted.org',
  ...(github.serverDomains ?? []),
];

const deps: AppDeps = {
  pool: createPool(config.PONO_DATABASE_URL),
  sealer: new Sealer(config.PONO_SECRETS_KEY),
  publicUrl: config.PONO_PUBLIC_URL,
  secureCookies: config.NODE_ENV === 'production',
  identity,
  connectable,
  networkBase: NETWORK_BASE,
  serviceDomains: Object.fromEntries(
    connectable.flatMap((p) => (p.serverDomains ? [[p.id, p.serverDomains]] : [])),
  ),
  analytics: [umami, umamiSelf, posthog],
  usageSources: [
    githubUsage(fetch),
    netlifyUsage(fetch),
    cloudflareUsage(fetch),
    neonUsage(fetch),
    openai,
  ],
  adapters: {
    codeHosts: [github],
    hostings: [netlify, vercel, cloudflare, coolify],
    databases: [neon],
    links: httpLinkChecker(fetch),
  },
  serverHost: config.AGENT37_API_KEY
    ? agent37Host({
        apiKey: config.AGENT37_API_KEY,
        fetch,
        ...(config.PONO_SERVER_TEMPLATE ? { ponoTemplate: config.PONO_SERVER_TEMPLATE } : {}),
      })
    : unavailableServerHost(),
  serverBudgetMicros: Math.round(config.PONO_SERVER_BUDGET_USD * 1_000_000),
  serverIdleSeconds: config.PONO_SERVER_IDLE_MINUTES * 60,
  catalog: loadCatalog(),
  billing:
    config.MONEROO_SECRET_KEY && config.MONEROO_WEBHOOK_SECRET
      ? monerooBilling({
          secretKey: config.MONEROO_SECRET_KEY,
          webhookSecret: config.MONEROO_WEBHOOK_SECRET,
          currency: config.PONO_MONEROO_CURRENCY,
          fetch,
        })
      : config.STRIPE_SECRET_KEY &&
          config.STRIPE_WEBHOOK_SECRET &&
          config.PONO_STRIPE_PRICE_SOLO &&
          config.PONO_STRIPE_PRICE_PRO
        ? stripeBilling({
            secretKey: config.STRIPE_SECRET_KEY,
            webhookSecret: config.STRIPE_WEBHOOK_SECRET,
            prices: { solo: config.PONO_STRIPE_PRICE_SOLO, pro: config.PONO_STRIPE_PRICE_PRO },
            fetch,
          })
        : config.PONO_DEV_SIGN_IN === '1'
          ? devBilling({
              secret: config.PONO_SECRETS_KEY,
              publicUrl: config.PONO_PUBLIC_URL,
              apiUrl: config.PONO_API_URL,
              fetch,
            })
          : unavailableBilling(),
  // Licences are always offered to the operator: the store key may come from the console (D-041).
  licences: chariowLicences(fetch),
  settingsEnv: {
    ...(config.CHARIOW_API_KEY ? { CHARIOW_API_KEY: config.CHARIOW_API_KEY } : {}),
    ...(config.CHARIOW_PULSE_SECRET ? { CHARIOW_PULSE_SECRET: config.CHARIOW_PULSE_SECRET } : {}),
    ...(config.CHARIOW_STORE_URL ? { CHARIOW_STORE_URL: config.CHARIOW_STORE_URL } : {}),
    ...(config.PONO_SALES_CONTACT_URL
      ? { PONO_SALES_CONTACT_URL: config.PONO_SALES_CONTACT_URL }
      : {}),
  },
  admins: config.PONO_ADMIN_LOGINS.split(',')
    .map((l) => l.trim())
    .filter(Boolean),
  ...(config.AGENT37_API_KEY
    ? {
        serverAccount: agent37Account({ apiKey: config.AGENT37_API_KEY, fetch }),
        walletTopUp: agent37TopUp({ apiKey: config.AGENT37_API_KEY, fetch }),
      }
    : {}),
  ...(config.PONO_WEBHOOK_SECRET ? { webhookSecret: config.PONO_WEBHOOK_SECRET } : {}),
  now: () => new Date(),
};
const app = createApp(deps);

// Pono's periodic task (D-018): every workshop read again, automatic rollbacks, alerts by email.
if (config.PONO_JOBS === '1') {
  const notifier =
    config.RESEND_API_KEY && config.PONO_ALERTS_FROM
      ? resendNotifier({ apiKey: config.RESEND_API_KEY, from: config.PONO_ALERTS_FROM, fetch })
      : undefined;
  void startJobs({
    ...deps,
    internalUsage: [serversUsage()],
    publicUrl: config.PONO_PUBLIC_URL,
    ...(notifier ? { notifier } : {}),
  }).then(
    () => console.log(`Periodic task on (alerts by email: ${notifier ? 'yes' : 'no'})`),
    (error: Error) => reportError(error, { where: 'job:start' }),
  );
}

serve({ fetch: app.fetch, port: config.PONO_API_PORT }, (info) => {
  console.log(
    `Pono API on http://localhost:${info.port} (sign-in: ${identity.map((p) => p.id).join(', ') || 'none'})`,
  );
});
