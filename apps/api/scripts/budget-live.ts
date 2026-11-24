/**
 * A server's monthly budget held by Pono, for real (D-040). The host caps only paid calls and
 * settles awake time hourly, so Pono reads what each server spent this month and puts it to sleep
 * at its budget:
 *   the month's spend read by server (settled amounts of the workspace's servers) → a throwaway
 *   server whose budget is reached → put to sleep → asleep at the host → released.
 * Prints amounts, never a key.
 *
 *   node --env-file=../../../.secrets/.admin.env --import tsx scripts/budget-live.ts
 */
import { agent37Host } from '../src/infrastructure/providers/agent37.js';

const host = agent37Host({ apiKey: process.env.AGENT37_API_KEY!, fetch });
const t0 = Date.now();
const log = (s: string, d: unknown = '') =>
  console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s  ${s}`, JSON.stringify(d));
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  log(`ok  ${what}`);
};

const spend = await host.monthSpend!(new Date());
log('spent this month, by server', { servers: spend.size, micros: [...spend.values()] });
check(
  [...spend.values()].some((m) => m > 0),
  'the host reports settled spend by server',
);

const s = await host.create({
  name: 'pono-budget-probe',
  agent: 'none',
  env: {},
  metadata: { probe: 'budget' },
  budgetMicros: 300_000,
  idleSeconds: 3600,
});
try {
  for (let i = 0; i < 40 && (await host.get(s.externalId))?.status !== 'running'; i++)
    await new Promise((r) => setTimeout(r, 3000));
  // A budget of 0: whatever it spent, it reached it, as the cycle reads it.
  const spent = (await host.monthSpend!(new Date())).get(s.externalId) ?? 0;
  check(spent >= 0, `the cycle's decision: ${spent} micros spent ≥ a budget of 0`);
  await host.sleep(s.externalId);
  let status = '';
  for (let i = 0; i < 20 && status !== 'sleeping'; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    status = (await host.get(s.externalId))?.status ?? '';
  }
  check(status === 'sleeping', 'put to sleep at its budget');
} finally {
  await host.destroy(s.externalId);
  log('server released');
}
