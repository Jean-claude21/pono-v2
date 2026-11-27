import { label } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

// What /v1/usage answers (apps/api/src/features/usage).
export interface Reading {
  provider: string;
  meter: string;
  subject: string;
  used: number | null;
  quota: number | null;
  unit: string;
  costMicros: number | null;
  source: string;
  reason: string | null;
  readAt: string;
}

export interface Subscription {
  id: string;
  service: string;
  plan: string | null;
  priceMicros: number;
  cycle: 'month' | 'year';
  renewsOn: string | null;
}

export interface Alert {
  id: string;
  kind: string;
  level: string;
  detail: Record<string, string | number>;
}

export interface UsageView {
  total: { totalMicros: number; bySource: Record<string, number>; unavailable: number };
  readings: Reading[];
  subscriptions: Subscription[];
  alerts: Alert[];
}

export function alertText(a: Alert): string {
  if (a.kind === 'renewal')
    return m.alert_renewal({ service: String(a.detail.service), days: String(a.detail.days) });
  if (a.kind === 'plan')
    return m.alert_plan({
      plan: a.detail.plan === 'pro' ? m.plan_pro() : m.plan_solo(),
      date: new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'long' }).format(
        new Date(String(a.detail.until)),
      ),
    });
  return m.alert_quota({
    meter: label('meter', String(a.detail.meter)),
    subject: String(a.detail.subject ?? ''),
    percent: String(Math.round(Number(a.detail.ratio) * 100)),
  });
}
