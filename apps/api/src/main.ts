import { coolifyHosting } from './infrastructure/providers/coolify.js';
import { resendNotifier } from './infrastructure/providers/resend.js';
import { startJobs } from './features/operations/index.js';
import { serversUsage } from './features/servers/index.js';
import { posthogAnalytics } from './infrastructure/providers/posthog.js';
import { umamiCloud, umamiSelfHosted } from './infrastructure/providers/umami.js';
import { serve } from '@hono/node-server';
import { createApp, type AppDeps } from './app.js';
import { loadCatalog } from './features/catalog/index.js';
import { devIdentity, githubIdentity, type IdentityProvider } from './features/identity/index.js';
import { agent37Account, agent37Host, agent37TopUp } from './infrastructure/providers/agent37.js';
import {
  devBilling,
  stripeBilling,
  unavailableBilling,
} from './infrastructure/providers/stripe.js';
import { monerooBilling } from './infrastructure/providers/moneroo.js';
import { unavailableServerHost } from './infrastructure/providers/no-server-host.js';
import { cloudflareHosting } from './infrastructure/providers/cloudflare.js';
import { githubCodeHost } from './infrastructure/providers/github.js';
import { httpLinkChecker } from './infrastructure/providers/links.js';
import { netlifyHosting } from './infrastructure/providers/netlify.js';
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

const github = githubCodeHost(fetch);
const netlify = netlifyHosting(
  fetch,
  config.NETLIFY_OAUTH_CLIENT_ID && config.NETLIFY_OAUTH_CLIENT_SECRET
    ? { clientId: config.NETLIFY_OAUTH_CLIENT_ID, clientSecret: config.NETLIFY_OAUTH_CLIENT_SECRET }
    : undefined,
);
const coolify = coolifyHosting(fetch);
const cloudflare = cloudflareHosting(fetch);
const neon = neonDatabase(fetch);
const openai = openaiUsage(fetch);
const umami = umamiCloud(fetch);
const umamiSelf = umamiSelfHosted(fetch);
const posthog = posthogAnalytics(fetch);

const deps: AppDeps = {
  pool: createPool(config.PONO_DATABASE_URL),
  sealer: new Sealer(config.PONO_SECRETS_KEY),
  publicUrl: config.PONO_PUBLIC_URL,
  secureCookies: config.NODE_ENV === 'production',
  identity,
  connectable: [github, netlify, cloudflare, coolify, neon, openai, umami, umamiSelf, posthog],
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
    hostings: [netlify, cloudflare, coolify],
    databases: [neon],
    links: httpLinkChecker(fetch),
  },
  serverHost: config.AGENT37_API_KEY
    ? agent37Host({ apiKey: config.AGENT37_API_KEY, fetch })
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
if (config.PONO_JOBS === '1' && config.PONO_DATABASE_OWNER_URL) {
  const notifier =
    config.RESEND_API_KEY && config.PONO_ALERTS_FROM
      ? resendNotifier({ apiKey: config.RESEND_API_KEY, from: config.PONO_ALERTS_FROM, fetch })
      : undefined;
  void startJobs(config.PONO_DATABASE_OWNER_URL, {
    ...deps,
    internalUsage: [serversUsage()],
    publicUrl: config.PONO_PUBLIC_URL,
    ...(notifier ? { notifier } : {}),
  }).then(
    () => console.log(`Periodic task on (alerts by email: ${notifier ? 'yes' : 'no'})`),
    (error: Error) => console.error(`Periodic task not started: ${error.message}`),
  );
}

serve({ fetch: app.fetch, port: config.PONO_API_PORT }, (info) => {
  console.log(
    `Pono API on http://localhost:${info.port} (sign-in: ${identity.map((p) => p.id).join(', ') || 'none'})`,
  );
});
