/**
 * Reads the author's real accounts, read-only, to prove the adapters against the providers' real
 * answers. Prints accounts, names and states, never a key.
 *
 *   PONO_SECRETS_ENV=../../../.secrets/.admin.env GITHUB_TOKEN=$(gh auth token) \
 *     pnpm tsx scripts/probe-providers.ts owner/repo [owner/repo...]
 */
import { readFileSync } from 'node:fs';
import { cloudflareHosting } from '../src/infrastructure/providers/cloudflare.js';
import { githubCodeHost } from '../src/infrastructure/providers/github.js';
import { httpLinkChecker } from '../src/infrastructure/providers/links.js';
import { netlifyHosting } from '../src/infrastructure/providers/netlify.js';
import { neonDatabase } from '../src/infrastructure/providers/neon.js';

function loadEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]!] = match[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv(process.env.PONO_SECRETS_ENV ?? '../../../.secrets/.admin.env');
const github = githubCodeHost(fetch);
const netlify = netlifyHosting(fetch);
const cloudflare = cloudflareHosting(fetch);
const neon = neonDatabase(fetch);
const links = httpLinkChecker(fetch);

async function step<T>(label: string, work: () => Promise<T>): Promise<T | null> {
  try {
    const result = await work();
    return result;
  } catch (error) {
    console.log(`  ${label}: FAILED ${(error as Error).message}`);
    return null;
  }
}

const creds = {
  github: process.env.GITHUB_TOKEN
    ? (await step('github verify', () => github.verify({ token: process.env.GITHUB_TOKEN! })))
        ?.credential
    : undefined,
  netlify: env.NETLIFY_AUTH_TOKEN
    ? await step('netlify verify', () => netlify.verify({ token: env.NETLIFY_AUTH_TOKEN! }))
    : null,
  cloudflare:
    env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID
      ? await step('cloudflare verify', () =>
          cloudflare.verify({
            token: env.CLOUDFLARE_API_TOKEN!,
            accountId: env.CLOUDFLARE_ACCOUNT_ID!,
          }),
        )
      : null,
  neon: env.NEON_API_TOKEN
    ? await step('neon verify', () => neon.verify({ token: env.NEON_API_TOKEN! }))
    : null,
};
console.log('Accounts:', {
  github: creds.github ? 'ok' : 'none',
  netlify: creds.netlify?.account ?? 'none',
  cloudflare: creds.cloudflare?.account ?? 'none',
  neon: creds.neon?.account ?? 'none',
});

if (creds.github) {
  const repos = await step('github list', () => github.listRepositories(creds.github!));
  console.log(`Repositories readable: ${repos?.length ?? 0}`);
}

for (const fullName of process.argv.slice(2)) {
  console.log(`\n${fullName}`);
  const repo = creds.github
    ? await step('repository', () => github.repository(creds.github!, fullName))
    : null;
  if (!repo) {
    console.log('  repository: not found');
    continue;
  }
  console.log(
    `  repository: default ${repo.defaultBranch}, pushed ${repo.pushedAt?.toISOString() ?? '—'}`,
  );
  for (const [name, hosting, cred] of [
    ['netlify', netlify, creds.netlify?.credential],
    ['cloudflare', cloudflare, creds.cloudflare?.credential],
  ] as const) {
    if (!cred) continue;
    const site = await step(`${name} findSite`, () => hosting.findSite(cred, repo));
    if (!site) {
      console.log(`  ${name}: no site`);
      continue;
    }
    const deployments =
      (await step(`${name} deployments`, () => hosting.deployments(cred, site.ref))) ?? [];
    const latest = deployments.find((d) => d.environment === 'production');
    const link = site.productionUrl ? await links.check(site.productionUrl) : 'missing';
    console.log(
      `  ${name}: ${site.productionUrl} (${link}), branch ${site.productionBranch}, ${deployments.length} deployments, latest production ${latest?.status ?? '—'} at ${latest?.createdAt.toISOString() ?? '—'}`,
    );
  }
  if (creds.neon) {
    const db = await step('neon findProject', () =>
      neon.findProject(creds.neon!.credential, repo.name),
    );
    console.log(`  neon: ${db ? 'found' : 'no project named ' + repo.name}`);
  }
}
