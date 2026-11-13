import type { Actor } from '../../platform/context.js';
import { withOrganization, type Pool } from '../../platform/db.js';
import type { Connectable, ConnectionKind } from '../connections/index.js';

/**
 * What a person must have connected for what they ask (D-029): the agent reads it before an action,
 * and tells a beginner, in plain words, which service to connect, with the link.
 */
export type Goal = 'code' | 'preview' | 'publish' | 'database' | 'visits' | 'ai';

const NEEDS: Record<Goal, ConnectionKind[]> = {
  code: ['code_host'],
  preview: ['code_host'],
  publish: ['code_host', 'hosting'],
  database: ['code_host', 'database'],
  visits: ['code_host', 'analytics'],
  ai: ['ai'],
};

/** Why each kind is needed, said to the person by the agent. */
const WHY: Record<ConnectionKind, string> = {
  code_host:
    'Your code lives on GitHub: Pono reads it, gives it a server and saves the work there.',
  hosting: 'To put the site on the internet, Pono needs the account that will host it.',
  database: 'To keep data (accounts, orders, messages), the project needs a database account.',
  analytics: 'To count visits, Pono needs a visits account.',
  ai: 'To follow AI costs, Pono needs the AI provider account.',
};

/** What a refusal means, when it is a missing connection: the kind to connect. */
export const MISSING_BY_CODE: Record<string, ConnectionKind> = {
  'connection.code_host_missing': 'code_host',
  'release.no_hosting': 'hosting',
};

export const connectUrl = (publicUrl: string, target: string) =>
  `${publicUrl}/connections?connect=${encodeURIComponent(target)}`;

export interface Missing {
  kind: ConnectionKind;
  why: string;
  connectUrl: string;
  options: { provider: string; signIn: boolean; connectUrl: string }[];
}

export async function whatIsMissing(
  deps: { pool: Pool; connectable: Connectable[]; publicUrl: string },
  actor: Actor,
  goal: Goal,
): Promise<{
  goal: Goal;
  ready: boolean;
  connected: { kind: ConnectionKind; provider: string; account: string }[];
  missing: Missing[];
  say: string;
}> {
  const rows = await withOrganization(
    deps.pool,
    actor.organizationId,
    async (client) =>
      (
        await client.query<{ kind: ConnectionKind; provider: string; account: string }>(
          `SELECT kind, provider, account FROM connections WHERE status = 'active' ORDER BY created_at`,
        )
      ).rows,
  );
  const have = new Set(rows.map((r) => r.kind));
  const missing = NEEDS[goal]
    .filter((kind) => !have.has(kind))
    .map((kind) => ({
      kind,
      why: WHY[kind],
      connectUrl: connectUrl(deps.publicUrl, kind),
      options: deps.connectable
        .filter((p) => p.kind === kind)
        .map((p) => ({
          provider: p.id,
          signIn: kind === 'code_host' || Boolean(p.oauth),
          connectUrl: connectUrl(deps.publicUrl, p.id),
        })),
    }));
  return {
    goal,
    ready: missing.length === 0,
    connected: rows,
    missing,
    say: missing.length
      ? `Before that, one thing to connect: ${missing.map((m) => m.why).join(' ')} Open ${missing[0]!.connectUrl}, connect it, then tell me and I continue.`
      : 'Everything needed is connected.',
  };
}
