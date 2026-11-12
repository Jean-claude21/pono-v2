import { Hono } from 'hono';
import { z } from 'zod';
import type { Actor, AppEnv } from '../../platform/context.js';
import { withOrganization, type Client, type Pool } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { ProviderError } from '../../platform/http.js';
import type { Sealer } from '../../platform/secrets.js';
import { activeCredentials } from '../connections/index.js';
import { record } from '../journal/index.js';
import { alertsFor, monthTotal, type Reading } from './domain.js';

export type { Reading, Source } from './domain.js';
export { monthTotal, alertsFor, monthly } from './domain.js';

/** A provider that says what is consumed. The id is the connection's provider id. */
export interface UsageSource {
  readonly id: string;
  read(credential: string, now: Date): Promise<Reading[]>;
}

/** Readings Pono makes itself (its own servers), whatever the connections. */
export type InternalUsage = (client: Client, now: Date) => Promise<Reading[]>;

export interface UsageDeps {
  pool: Pool;
  sealer: Sealer;
  usageSources: UsageSource[];
  internalUsage?: InternalUsage[];
  now: () => Date;
}

function unavailable(provider: string, reason: string): Reading {
  return {
    provider,
    meter: 'account',
    subject: '',
    used: null,
    quota: null,
    unit: '',
    costMicros: null,
    source: 'unavailable',
    reason,
    periodStart: null,
    periodEnd: null,
  };
}

async function saveReadings(
  client: Client,
  organizationId: string,
  readings: Reading[],
): Promise<void> {
  for (const r of readings) {
    await client.query(
      `INSERT INTO usage_readings (organization_id, provider, meter, subject, used, quota, unit, cost_micros, source, reason, period_start, period_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        organizationId,
        r.provider,
        r.meter,
        r.subject,
        r.used,
        r.quota,
        r.unit,
        r.costMicros,
        r.source,
        r.reason,
        r.periodStart,
        r.periodEnd,
      ],
    );
  }
}

interface ReadingRow {
  provider: string;
  meter: string;
  subject: string;
  used: string | null;
  quota: string | null;
  unit: string;
  cost_micros: string | null;
  source: Reading['source'];
  reason: string | null;
  period_start: Date | null;
  period_end: Date | null;
  read_at: Date;
}

async function latestReadings(client: Client): Promise<(Reading & { readAt: Date })[]> {
  const { rows } = await client.query<ReadingRow>(
    `SELECT DISTINCT ON (provider, meter, subject) provider, meter, subject, used, quota, unit, cost_micros, source, reason, period_start, period_end, read_at
     FROM usage_readings ORDER BY provider, meter, subject, read_at DESC, id DESC`,
  );
  const num = (v: string | null) => (v === null ? null : Number(v));
  return rows.map((r) => ({
    provider: r.provider,
    meter: r.meter,
    subject: r.subject,
    used: num(r.used),
    quota: num(r.quota),
    unit: r.unit,
    costMicros: num(r.cost_micros),
    source: r.source,
    reason: r.reason,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    readAt: r.read_at,
  }));
}

interface SubscriptionRow {
  id: string;
  service: string;
  plan: string | null;
  price_micros: string;
  cycle: 'month' | 'year';
  renews_on: Date | null;
  project_id: string | null;
  created_at: Date;
}

async function activeSubscriptions(client: Client) {
  const { rows } = await client.query<SubscriptionRow>(
    'SELECT id, service, plan, price_micros, cycle, renews_on, project_id, created_at FROM subscriptions WHERE ended_at IS NULL ORDER BY service',
  );
  return rows.map((r) => ({
    id: r.id,
    service: r.service,
    plan: r.plan,
    priceMicros: Number(r.price_micros),
    cycle: r.cycle,
    renewsOn: r.renews_on,
    projectId: r.project_id,
  }));
}

/** Opens the alerts whose condition holds, resolves the others (FR-005). */
export async function syncAlerts(
  client: Client,
  organizationId: string,
  now: Date,
  kinds: string[] = ['quota', 'renewal'],
): Promise<void> {
  const conditions = alertsFor(
    await latestReadings(client),
    await activeSubscriptions(client),
    now,
  );
  const keys = conditions.map((c) => c.key);
  await client.query(
    `UPDATE alerts SET resolved_at = now() WHERE resolved_at IS NULL AND kind = ANY($1) AND NOT (key = ANY($2))`,
    [kinds, keys],
  );
  for (const c of conditions) {
    await client.query(
      `INSERT INTO alerts (organization_id, key, kind, level, detail) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (organization_id, key) WHERE resolved_at IS NULL DO UPDATE SET level = excluded.level, detail = excluded.detail`,
      [organizationId, c.key, c.kind, c.level, c.detail],
    );
  }
}

/** Reads every connected provider, keeps what it says, and updates the alerts (US1). */
export async function readUsage(
  deps: UsageDeps,
  actor: Pick<Actor, 'organizationId' | 'personId' | 'channel'>,
): Promise<number> {
  const now = deps.now();
  const creds = await withOrganization(deps.pool, actor.organizationId, (client) =>
    activeCredentials(client, deps.sealer),
  );
  const readings: Reading[] = [];
  for (const source of deps.usageSources) {
    const credential = creds.find((c) => c.provider === source.id)?.credential;
    if (!credential) continue;
    try {
      readings.push(...(await source.read(credential, now)));
    } catch (error) {
      readings.push(
        unavailable(
          source.id,
          error instanceof ProviderError && error.unauthorized ? 'permission' : 'no_answer',
        ),
      );
    }
  }
  await withOrganization(deps.pool, actor.organizationId, async (client) => {
    for (const internal of deps.internalUsage ?? [])
      readings.push(...(await internal(client, now)));
    await saveReadings(client, actor.organizationId, readings);
    await syncAlerts(client, actor.organizationId, now);
    await record(client, {
      organizationId: actor.organizationId,
      action: 'usage.read',
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: {
        readings: readings.length,
        unavailable: readings.filter((r) => r.source === 'unavailable').length,
      },
    });
  });
  return readings.length;
}

/** What the console and the agents read about usage. */
export async function usageView(client: Client) {
  const readings = await latestReadings(client);
  const subscriptions = await activeSubscriptions(client);
  const total = monthTotal(subscriptions, readings);
  const { rows: alerts } = await client.query<{
    id: string;
    key: string;
    kind: string;
    level: string;
    detail: Record<string, unknown>;
    created_at: Date;
  }>(
    'SELECT id, key, kind, level, detail, created_at FROM alerts WHERE resolved_at IS NULL ORDER BY level DESC, created_at DESC',
  );
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    total,
    readings: readings.map((r) => ({
      ...r,
      periodStart: iso(r.periodStart),
      periodEnd: iso(r.periodEnd),
      readAt: r.readAt.toISOString(),
    })),
    subscriptions: subscriptions.map((s) => ({
      ...s,
      renewsOn: s.renewsOn ? s.renewsOn.toISOString().slice(0, 10) : null,
    })),
    alerts: alerts.map((a) => ({
      id: a.id,
      key: a.key,
      kind: a.kind,
      level: a.level,
      detail: a.detail,
      createdAt: a.created_at.toISOString(),
    })),
  };
}

const subscriptionBody = z.object({
  service: z.string().trim().min(1).max(80),
  plan: z.string().trim().max(80).nullish(),
  priceUsd: z.number().min(0).max(100_000),
  cycle: z.enum(['month', 'year']),
  renewsOn: z.iso.date().nullish(),
  projectId: z.uuid().nullish(),
});

/** `/v1/usage`, `/v1/subscriptions`, `/v1/alerts` (US2, US3). */
export function usageRoutes(deps: UsageDeps): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .get('/usage', async (c) =>
      c.json(await withOrganization(deps.pool, c.var.actor.organizationId, usageView)),
    )
    .post('/usage/refresh', async (c) => {
      const count = await readUsage(deps, c.var.actor);
      return c.json({ readings: count });
    })
    .post('/subscriptions', async (c) => {
      const actor = c.var.actor;
      const body = subscriptionBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success)
        throw new AppError('request.invalid', 400, 'Expected service, priceUsd and cycle.');
      const id = await withOrganization(deps.pool, actor.organizationId, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO subscriptions (organization_id, service, plan, price_micros, cycle, renews_on, project_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            actor.organizationId,
            body.data.service,
            body.data.plan ?? null,
            Math.round(body.data.priceUsd * 1_000_000),
            body.data.cycle,
            body.data.renewsOn ?? null,
            body.data.projectId ?? null,
            actor.personId,
          ],
        );
        await record(client, {
          organizationId: actor.organizationId,
          action: 'subscription.declared',
          actorPerson: actor.personId,
          channel: actor.channel,
          detail: { service: body.data.service },
        });
        await syncAlerts(client, actor.organizationId, deps.now());
        return rows[0]!.id;
      });
      return c.json({ id }, 201);
    })
    .delete('/subscriptions/:id', async (c) => {
      const actor = c.var.actor;
      const id = c.req.param('id');
      if (!z.uuid().safeParse(id).success)
        throw new AppError('subscription.not_found', 404, 'No such subscription.');
      await withOrganization(deps.pool, actor.organizationId, async (client) => {
        const { rows } = await client.query<{ service: string }>(
          'UPDATE subscriptions SET ended_at = now() WHERE id = $1 AND ended_at IS NULL RETURNING service',
          [id],
        );
        if (!rows[0]) throw new AppError('subscription.not_found', 404, 'No such subscription.');
        await record(client, {
          organizationId: actor.organizationId,
          action: 'subscription.ended',
          actorPerson: actor.personId,
          channel: actor.channel,
          detail: { service: rows[0].service },
        });
        await syncAlerts(client, actor.organizationId, deps.now());
      });
      return c.body(null, 204);
    });
}
