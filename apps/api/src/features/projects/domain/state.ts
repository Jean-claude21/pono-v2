/** A project's state and why (FR-007). No provider here: only what was read. */

export type ProjectState = 'healthy' | 'active' | 'warning' | 'failing' | 'idle';
export type StateReason =
  | 'production_down'
  | 'deployment_failed'
  | 'connection_expired'
  | 'deployment_in_progress'
  | 'recent_activity'
  | 'no_recent_activity'
  | 'nominal';
export type LinkStatus = 'up' | 'down' | 'unknown' | 'missing';
export type DeploymentStatus = 'building' | 'succeeded' | 'failed' | 'cancelled';

export const ACTIVE_WINDOW_MS = 24 * 3_600_000;
export const IDLE_AFTER_MS = 30 * 86_400_000;

export interface StateFacts {
  link: LinkStatus;
  /** The latest production deployment, if one is known. */
  latestProduction: { status: DeploymentStatus; createdAt: Date } | null;
  lastCommitAt: Date | null;
  /** A connection this project reads through has expired. */
  connectionExpired: boolean;
  now: Date;
}

/** The first rule that matches decides; the order is the order of urgency. */
export function projectState(facts: StateFacts): { state: ProjectState; reason: StateReason } {
  if (facts.link === 'down') return { state: 'failing', reason: 'production_down' };
  if (facts.latestProduction?.status === 'failed')
    return { state: 'failing', reason: 'deployment_failed' };
  if (facts.connectionExpired) return { state: 'warning', reason: 'connection_expired' };
  if (facts.latestProduction?.status === 'building')
    return { state: 'active', reason: 'deployment_in_progress' };
  const activity = [facts.lastCommitAt, facts.latestProduction?.createdAt ?? null]
    .filter((d): d is Date => d !== null)
    .reduce<Date | null>((latest, d) => (!latest || d > latest ? d : latest), null);
  if (activity) {
    const age = facts.now.getTime() - activity.getTime();
    if (age <= ACTIVE_WINDOW_MS) return { state: 'active', reason: 'recent_activity' };
    if (age > IDLE_AFTER_MS) return { state: 'idle', reason: 'no_recent_activity' };
  }
  return { state: 'healthy', reason: 'nominal' };
}
