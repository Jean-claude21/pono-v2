import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

/** Stable codes from the API, translated here (D-009). An unknown code shows as it is. */
const tables: Record<string, Record<string, () => string>> = {
  state: {
    healthy: m.state_healthy,
    active: m.state_active,
    warning: m.state_warning,
    failing: m.state_failing,
    idle: m.state_idle,
  },
  reason: {
    production_down: m.reason_production_down,
    deployment_failed: m.reason_deployment_failed,
    connection_expired: m.reason_connection_expired,
    deployment_in_progress: m.reason_deployment_in_progress,
    recent_activity: m.reason_recent_activity,
    no_recent_activity: m.reason_no_recent_activity,
    nominal: m.reason_nominal,
  },
  link: { up: m.link_up, down: m.link_down, unknown: m.link_unknown, missing: m.link_missing },
  found: { found: m.found_found, missing: m.found_missing, unknown: m.found_unknown },
  deploy: {
    succeeded: m.deploy_succeeded,
    failed: m.deploy_failed,
    building: m.deploy_building,
    cancelled: m.deploy_cancelled,
  },
  env: { production: m.env_production, preview: m.env_preview },
  action: {
    'organization.created': m.action_organization_created,
    'connection.created': m.action_connection_created,
    'connection.revoked': m.action_connection_revoked,
    'project.imported': m.action_project_imported,
    'project.refreshed': m.action_project_refreshed,
    'usage.read': m.action_usage_read,
    'subscription.declared': m.action_subscription_declared,
    'subscription.ended': m.action_subscription_ended,
  },
  channel: { console: m.channel_console, mcp: m.channel_mcp, system: m.channel_system },
  kind: {
    code_host: m.connections_kind_code_host,
    hosting: m.connections_kind_hosting,
    database: m.connections_kind_database,
    ai: m.connections_kind_ai,
  },
  field: { token: m.field_token, accountId: m.field_accountId },
  source: {
    measured: m.source_measured,
    estimated: m.source_estimated,
    declared: m.source_declared,
    unavailable: m.source_unavailable,
  },
  unavailableReason: { permission: m.reason_permission, no_answer: m.reason_no_answer },
  meter: {
    'hosting.bandwidth': m.meter_hosting_bandwidth,
    'hosting.requests': m.meter_hosting_requests,
    'database.storage': m.meter_database_storage,
    'database.compute': m.meter_database_compute,
    'database.transfer': m.meter_database_transfer,
    'code.actions_minutes': m.meter_code_actions_minutes,
    'ai.cost_30d': m.meter_ai_cost_30d,
    'servers.compute': m.meter_servers_compute,
    account: m.meter_account,
  },
  error: {
    'connection.rejected': m.error_connection_rejected,
    'connection.unreachable': m.error_connection_unreachable,
    'connection.exists': m.error_connection_exists,
    'connection.code_host_missing': m.error_connection_code_host_missing,
    'project.already_imported': m.error_project_already_imported,
  },
};

export function label(table: keyof typeof tables | string, code: string): string {
  const message = tables[table]?.[code];
  if (message) return message();
  return table === 'error' ? m.error_generic({ code }) : code;
}

/** A date in the person's language; « jamais » when there is none. */
export function when(iso: string | null | undefined): string {
  if (!iso) return m.never();
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

/** « il y a 3 h », « 3 hours ago ». */
export function ago(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return m.never();
  const seconds = (new Date(iso).getTime() - now.getTime()) / 1000;
  const format = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(Math.round(seconds), 'second');
}

/** Micro-dollars as money in the person's language. */
export function money(micros: number): string {
  return new Intl.NumberFormat(getLocale(), { style: 'currency', currency: 'USD' }).format(
    micros / 1_000_000,
  );
}

/** A number in the person's language. */
export function figure(value: number): string {
  return new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 }).format(value);
}
