/**
 * Sends one test error to the error tracker (D-046), as the API would, to prove the DSN works.
 * Usage (from apps/api): PONO_SENTRY_DSN=… pnpm exec tsx scripts/sentry-probe.ts
 */
import { flushMonitoring, initMonitoring, reportError } from '../src/platform/monitor.js';

const on = initMonitoring({
  dsn: process.env.PONO_SENTRY_DSN,
  publicUrl: process.env.PONO_PUBLIC_URL ?? 'https://pono.kete.digital',
  nodeEnv: 'production',
  release: 'sentry-probe',
});
if (!on) throw new Error('PONO_SENTRY_DSN is not set');
const id = reportError(new Error('Pono: test du branchement Sentry (D-046)'), {
  where: 'probe',
  extra: { route: '/v1/probe' },
});
await flushMonitoring(5000);
console.log(`sent: ${id}`);
