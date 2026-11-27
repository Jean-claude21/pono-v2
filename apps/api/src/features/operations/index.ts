import { systemActor } from '../../platform/context.js';
import { withOrganization, type Pool } from '../../platform/db.js';
import type { ProjectsDeps } from '../projects/application.js';
import { refreshProject } from '../projects/application.js';
import { autoRollback } from '../releases/index.js';
import { syncServers, type ServersDeps } from '../servers/index.js';
import { readUsage, type UsageDeps } from '../usage/index.js';
import { reportError } from '../../platform/monitor.js';

/** Sends a short message to people (D-018). The provider id is an opaque adapter id. */
export interface Notifier {
  readonly id: string;
  send(input: { to: string[]; subject: string; text: string }): Promise<void>;
}

export interface OperationsDeps extends ProjectsDeps, ServersDeps, UsageDeps {
  notifier?: Notifier;
  publicUrl: string;
}

export interface CycleReport {
  organizations: number;
  projects: number;
  rolledBack: number;
  notified: number;
  failures: number;
}

const ALERT_SUBJECT: Record<string, string> = {
  quota: 'A subscription is near its limit',
  renewal: 'A subscription renews soon',
  spend: 'A spend crossed its threshold',
  server: 'A project server needs you',
  release: 'A release needs you',
};

/** Tells the members of an organization about the alerts that opened since the last cycle. */
async function notifyAlerts(deps: OperationsDeps, organizationId: string): Promise<number> {
  if (!deps.notifier) return 0;
  const { alerts, to } = await withOrganization(deps.pool, organizationId, async (client) => {
    const alerts = (
      await client.query<{ id: string; kind: string; level: string; key: string }>(
        'SELECT id, kind, level, key FROM alerts WHERE resolved_at IS NULL AND notified_at IS NULL ORDER BY created_at',
      )
    ).rows;
    const to = (
      await client.query<{ email: string }>('SELECT email FROM organization_recipients($1)', [
        organizationId,
      ])
    ).rows.map((r) => r.email);
    return { alerts, to };
  });
  if (!alerts.length || !to.length) return 0;
  const lines = alerts.map((a) => `- ${ALERT_SUBJECT[a.kind] ?? a.kind} (${a.level})`);
  await deps.notifier.send({
    to,
    subject:
      alerts.length === 1
        ? `Pono — ${ALERT_SUBJECT[alerts[0]!.kind] ?? 'An alert'}`
        : `Pono — ${alerts.length} alerts`,
    // Never a secret, never a figure that is not already in the console.
    text: [...lines, '', `Open the console: ${deps.publicUrl}/usage`].join('\n'),
  });
  await withOrganization(deps.pool, organizationId, (client) =>
    client.query('UPDATE alerts SET notified_at = now() WHERE id = ANY($1::uuid[])', [
      alerts.map((a) => a.id),
    ]),
  );
  return alerts.length;
}

/**
 * One cycle of Pono's periodic task (D-018), for every organization: servers and projects read
 * again at their providers, usage read, an automatic merge that broke production rolled back, new
 * alerts sent. One organization failing never stops the others.
 */
export async function runCycle(deps: OperationsDeps, only?: string[]): Promise<CycleReport> {
  const report: CycleReport = {
    organizations: 0,
    projects: 0,
    rolledBack: 0,
    notified: 0,
    failures: 0,
  };
  // Paid periods that ended go back to the free plan first (D-023).
  await deps.pool.query('SELECT expire_paid_plans()').catch(() => undefined);
  const orgs = (
    await deps.pool.query<{ id: string }>('SELECT id FROM system_organizations()')
  ).rows.filter((o) => !only || only.includes(o.id));
  for (const { id } of orgs) {
    report.organizations++;
    const actor = systemActor(id);
    try {
      await syncServers(deps, id).catch(() => undefined);
      const projects = await withOrganization(
        deps.pool,
        id,
        async (client) =>
          (
            await client.query<{ id: string }>(
              'SELECT id FROM projects ORDER BY refreshed_at NULLS FIRST',
            )
          ).rows,
      );
      for (const p of projects) {
        await refreshProject(deps, actor, p.id).then(
          () => report.projects++,
          () => report.failures++,
        );
      }
      await readUsage(deps, actor).catch(() => report.failures++);
      report.rolledBack += (await autoRollback(deps, actor)).length;
      report.notified += await notifyAlerts(deps, id);
    } catch (error) {
      report.failures++;
      reportError(error, { where: 'job:cycle', organizationId: id });
    }
  }
  return report;
}

/** Pono's periodic task on pg-boss (D-002): one cycle every 15 minutes, one runner at a time. */
export async function startJobs(
  ownerUrl: string,
  deps: OperationsDeps,
  every = '*/15 * * * *',
): Promise<() => Promise<void>> {
  const { PgBoss } = await import('pg-boss');
  const boss = new PgBoss(ownerUrl);
  boss.on('error', (error: Error) => reportError(error, { where: 'job:runner' }));
  await boss.start();
  await boss.createQueue('cycle', { policy: 'singleton' });
  await boss.schedule('cycle', every);
  await boss.work('cycle', async () => {
    const report = await runCycle(deps);
    console.log(`cycle: ${JSON.stringify(report)}`);
  });
  return () => boss.stop({ graceful: true });
}

export type { Pool };
