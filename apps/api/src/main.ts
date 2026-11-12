import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { devIdentity, githubIdentity, type IdentityProvider } from './features/identity/index.js';
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
const netlify = netlifyHosting(fetch);
const cloudflare = cloudflareHosting(fetch);
const neon = neonDatabase(fetch);
const openai = openaiUsage(fetch);

const app = createApp({
  pool: createPool(config.PONO_DATABASE_URL),
  sealer: new Sealer(config.PONO_SECRETS_KEY),
  publicUrl: config.PONO_PUBLIC_URL,
  secureCookies: config.NODE_ENV === 'production',
  identity,
  connectable: [github, netlify, cloudflare, neon, openai],
  usageSources: [
    githubUsage(fetch),
    netlifyUsage(fetch),
    cloudflareUsage(fetch),
    neonUsage(fetch),
    openai,
  ],
  adapters: {
    codeHosts: [github],
    hostings: [netlify, cloudflare],
    databases: [neon],
    links: httpLinkChecker(fetch),
  },
  now: () => new Date(),
});

serve({ fetch: app.fetch, port: config.PONO_API_PORT }, (info) => {
  console.log(
    `Pono API on http://localhost:${info.port} (sign-in: ${identity.map((p) => p.id).join(', ') || 'none'})`,
  );
});
