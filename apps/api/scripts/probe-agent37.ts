/**
 * Proves the Agent37 adapter on Pono's real workspace: create the smallest server, sleep it,
 * wake it, delete it. Costs a fraction of a cent. Prints statuses and timings, never the key.
 *   PONO_SECRETS_ENV=../../../.secrets/.admin.env pnpm tsx scripts/probe-agent37.ts
 */
import { readFileSync } from 'node:fs';
import { agent37Host } from '../src/infrastructure/providers/agent37.js';

const env = Object.fromEntries(
  readFileSync(process.env.PONO_SECRETS_ENV ?? '../../../.secrets/.admin.env', 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => [m[1]!, m[2]!.trim()]),
);
const host = agent37Host({ apiKey: env.AGENT37_API_KEY!, fetch });
const t0 = Date.now();
const lap = (label: string, extra = '') => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${label} ${extra}`);
const waitFor = async (id: string, wanted: string[], max = 180) => {
  for (let i = 0; i < max; i++) {
    const s = await host.get(id);
    if (s && wanted.includes(s.status)) return s;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`never reached ${wanted.join('/')}`);
};
const created = await host.create({
  name: 'pono-probe',
  agent: 'none',
  env: { PONO_PROJECT: 'probe/probe' },
  metadata: { purpose: 'adapter-probe' },
  budgetMicros: 100_000,
  idleSeconds: 300,
});
lap('created', `${created.externalId} ${created.status} ${created.size} ${created.monthlyMicros / 1e6}$/month`);
try {
  const up = await waitFor(created.externalId, ['running']);
  lap('running', up.url ?? '');
  await host.sleep(created.externalId);
  const slept = await waitFor(created.externalId, ['sleeping']);
  lap('sleeping', slept.status);
  await host.wake(created.externalId);
  const woke = await waitFor(created.externalId, ['running']);
  lap('woken', woke.status);
} finally {
  await host.destroy(created.externalId);
  lap('deleted', String((await host.get(created.externalId)) === null));
}
