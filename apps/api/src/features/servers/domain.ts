/** Project servers: what counts against a plan, and what a server costs (D-004). */

export type Plan = 'free' | 'solo' | 'pro';
export type ServerStatus =
  'provisioning' | 'running' | 'waking' | 'sleeping' | 'stopped' | 'failed' | 'released';
export type Agent = 'claude-code' | 'codex' | 'opencode' | 'none';

export const PLANS: Record<Plan, { activeServers: number; priceMicros: number }> = {
  free: { activeServers: 1, priceMicros: 0 },
  solo: { activeServers: 3, priceMicros: 12_000_000 },
  pro: { activeServers: 10, priceMicros: 39_000_000 },
};

/** Servers that hold compute count; sleeping, stopped and released ones never do. */
export function isActive(status: ServerStatus): boolean {
  return status === 'provisioning' || status === 'running' || status === 'waking';
}

export function activeLimit(plan: Plan): number {
  return PLANS[plan].activeServers;
}

/** A server's cost so far this month when it ran all along: an estimate, said as such (D-005). */
export function estimatedMonthToDate(monthlyMicros: number, now: Date): number {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.round((monthlyMicros * (now.getTime() - start)) / (end - start));
}
