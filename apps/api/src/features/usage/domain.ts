/** Usage rules: where a figure comes from, what a month costs, what needs an alert (D-005). */

export type Source = 'measured' | 'estimated' | 'declared' | 'unavailable';

export interface Reading {
  provider: string;
  /** A stable code, translated by the console: `hosting.bandwidth`, `database.storage`… */
  meter: string;
  /** What the meter is about inside the provider (a project, a site), or ''. */
  subject: string;
  used: number | null;
  quota: number | null;
  unit: string;
  costMicros: number | null;
  source: Source;
  /** Why a figure is unavailable: `permission`, `no_answer`, `not_exposed`. */
  reason: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
}

export interface Subscription {
  priceMicros: number;
  cycle: 'month' | 'year';
  renewsOn: Date | null;
}

export const ALERT_RATIO = 0.8;
export const CRITICAL_RATIO = 0.95;
export const RENEWAL_DAYS = 7;

/** A subscription brought back to one month. */
export function monthly(subscription: Subscription): number {
  return subscription.cycle === 'year'
    ? Math.round(subscription.priceMicros / 12)
    : subscription.priceMicros;
}

export interface MonthTotal {
  totalMicros: number;
  bySource: Record<Exclude<Source, 'unavailable'>, number>;
  /** Meters that could not be read: the total does not include them, and says so. */
  unavailable: number;
}

/** The month: declared subscriptions plus measured and estimated costs; gaps are counted, not zeroed. */
export function monthTotal(subscriptions: Subscription[], readings: Reading[]): MonthTotal {
  const bySource = { measured: 0, estimated: 0, declared: 0 };
  for (const s of subscriptions) bySource.declared += monthly(s);
  let unavailable = 0;
  for (const r of readings) {
    if (r.source === 'unavailable') unavailable += 1;
    else if (r.costMicros !== null) bySource[r.source] += r.costMicros;
  }
  return {
    totalMicros: bySource.measured + bySource.estimated + bySource.declared,
    bySource,
    unavailable,
  };
}

export interface AlertCondition {
  key: string;
  kind: 'quota' | 'renewal';
  level: 'warn' | 'bad';
  detail: Record<string, unknown>;
}

/** The alerts that should be open now; every other open alert is resolved. */
export function alertsFor(
  readings: Reading[],
  subscriptions: (Subscription & { id: string; service: string })[],
  now: Date,
): AlertCondition[] {
  const out: AlertCondition[] = [];
  for (const r of readings) {
    if (r.used === null || r.quota === null || r.quota <= 0) continue;
    const ratio = r.used / r.quota;
    if (ratio < ALERT_RATIO) continue;
    out.push({
      key: `quota:${r.provider}:${r.meter}:${r.subject}`,
      kind: 'quota',
      level: ratio >= CRITICAL_RATIO ? 'bad' : 'warn',
      detail: {
        provider: r.provider,
        meter: r.meter,
        subject: r.subject,
        used: r.used,
        quota: r.quota,
        unit: r.unit,
        ratio: Math.round(ratio * 100) / 100,
      },
    });
  }
  for (const s of subscriptions) {
    if (!s.renewsOn) continue;
    const days = Math.ceil((s.renewsOn.getTime() - now.getTime()) / 86_400_000);
    if (days >= 0 && days <= RENEWAL_DAYS) {
      out.push({
        key: `renewal:${s.id}`,
        kind: 'renewal',
        level: 'warn',
        detail: { service: s.service, days, priceMicros: s.priceMicros },
      });
    }
  }
  return out;
}
