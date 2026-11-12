/**
 * Reads the author's real consumption, read-only, through the usage sources. Prints figures,
 * never a key.  PONO_SECRETS_ENV=../../../.secrets/.admin.env GITHUB_TOKEN=$(gh auth token) pnpm tsx scripts/probe-usage.ts
 */
import { readFileSync } from 'node:fs';
import {
  cloudflareUsage,
  githubUsage,
  netlifyUsage,
  neonUsage,
  openaiUsage,
} from '../src/infrastructure/providers/usage.js';

const env = Object.fromEntries(
  readFileSync(process.env.PONO_SECRETS_ENV ?? '../../../.secrets/.admin.env', 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => [m[1]!, m[2]!.trim()]),
);
const now = new Date();
const runs: [string, () => Promise<unknown[]>][] = [
  ['github', () => githubUsage(fetch).read(process.env.GITHUB_TOKEN ?? '', now)],
  ['netlify', () => netlifyUsage(fetch).read(env.NETLIFY_AUTH_TOKEN ?? '', now)],
  [
    'cloudflare',
    () =>
      cloudflareUsage(fetch).read(
        JSON.stringify({ token: env.CLOUDFLARE_API_TOKEN, accountId: env.CLOUDFLARE_ACCOUNT_ID }),
        now,
      ),
  ],
  ['neon', () => neonUsage(fetch).read(env.NEON_API_TOKEN ?? '', now)],
  ['openai', () => openaiUsage(fetch).read(env.OPENAI_API_KEY ?? '', now)],
];
for (const [name, run] of runs) {
  try {
    const readings = (await run()) as {
      meter: string;
      subject: string;
      used: number | null;
      quota: number | null;
      unit: string;
      source: string;
      reason: string | null;
    }[];
    for (const r of readings.slice(0, 6))
      console.log(name, r.meter, r.subject, r.used, '/', r.quota, r.unit, r.source, r.reason ?? '');
    if (readings.length > 6) console.log(name, `… ${readings.length} readings`);
  } catch (error) {
    console.log(name, 'FAILED', (error as Error).message);
  }
}
