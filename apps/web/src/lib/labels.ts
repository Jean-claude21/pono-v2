import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

/** Stable codes from the API, translated here (D-009). An unknown code shows as it is. */
const tables: Record<string, Record<string, () => string>> = {
  category: {
    free: m.category_free,
    services: m.category_services,
    commerce: m.category_commerce,
    software: m.category_software,
    presence: m.category_presence,
  },
  serverStatus: {
    provisioning: m.server_status_provisioning,
    running: m.server_status_running,
    waking: m.server_status_waking,
    sleeping: m.server_status_sleeping,
    stopped: m.server_status_stopped,
    failed: m.server_status_failed,
    released: m.server_status_released,
  },
  plan: { free: m.plan_free, solo: m.plan_solo, pro: m.plan_pro },
  mode: { ask: m.mode_ask, auto: m.mode_auto, bypass: m.mode_bypass },
  verdict: { passed: m.verdict_passed, warned: m.verdict_warned, refused: m.verdict_refused },
  releaseStatus: {
    waiting: m.release_status_waiting,
    merged: m.release_status_merged,
    refused: m.release_status_refused,
    declined: m.release_status_declined,
    superseded: m.release_status_superseded,
    failed: m.release_status_failed,
  },
  guard: { secrets: m.guard_secrets, migrations: m.guard_migrations, preview: m.guard_preview },
  protection: {
    protected: m.protection_protected,
    unprotected: m.protection_unprotected,
    unavailable_on_plan: m.protection_unavailable_on_plan,
    unknown: m.protection_unknown,
  },
  agent: {
    'claude-code': m.agent_claude_code,
    codex: m.agent_codex,
    opencode: m.agent_opencode,
    none: m.agent_none,
  },
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
    'server.allocated': m.action_server_allocated,
    'server.slept': m.action_server_slept,
    'server.woken': m.action_server_woken,
    'server.released': m.action_server_released,
    'project.launched': m.action_project_launched,
    'release.evaluated': m.action_release_evaluated,
    'release.refused': m.action_release_refused,
    'release.approved': m.action_release_approved,
    'release.auto_merged': m.action_release_auto_merged,
    'release.declined': m.action_release_declined,
    'release.mode_changed': m.action_release_mode_changed,
    'release.protected': m.action_release_protected,
    'release.rolled_back': m.action_release_rolled_back,
    'release.rollback_requested': m.action_release_rollback_requested,
    'agent.granted': m.action_agent_granted,
    'agent.revoked': m.action_agent_revoked,
    'plan.changed': m.action_plan_changed,
    'admin.server_slept': m.action_admin_server_slept,
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
    'servers.limit_reached': m.error_servers_limit_reached,
    'launch.name_taken': m.error_launch_name_taken,
    'release.changed': m.error_release_changed,
    'release.person_only': m.error_release_person_only,
    'servers.unavailable': m.error_servers_unavailable,
    'admin.forbidden': m.error_admin_forbidden,
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
