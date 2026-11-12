import type { Client } from '../../platform/db.js';

export interface JournalEntry {
  organizationId: string;
  projectId?: string | null;
  /** A stable code, translated by the console: `connection.created`, `project.imported`… */
  action: string;
  actorPerson: string | null;
  channel: 'console' | 'mcp' | 'system';
  /** Never a secret. */
  detail?: Record<string, unknown>;
}

/** Writes one gesture to the journal; the app role can only add, never change (FR-008). */
export async function record(client: Client, entry: JournalEntry): Promise<void> {
  await client.query(
    `INSERT INTO journal (organization_id, project_id, action, actor_person, channel, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entry.organizationId,
      entry.projectId ?? null,
      entry.action,
      entry.actorPerson,
      entry.channel,
      entry.detail ?? {},
    ],
  );
}

export interface JournalLine {
  id: string;
  projectId: string | null;
  action: string;
  actorLogin: string | null;
  channel: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export async function readJournal(
  client: Client,
  options: { projectId?: string; limit?: number } = {},
): Promise<JournalLine[]> {
  const { rows } = await client.query<{
    id: string;
    project_id: string | null;
    action: string;
    actor_person: string | null;
    channel: string;
    detail: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT id, project_id, action, actor_person, channel, detail, created_at FROM journal
     WHERE ($1::uuid IS NULL OR project_id = $1) ORDER BY id DESC LIMIT $2`,
    [options.projectId ?? null, options.limit ?? 50],
  );
  return rows.map((row) => ({
    id: String(row.id),
    projectId: row.project_id,
    action: row.action,
    actorLogin: null,
    channel: row.channel,
    detail: row.detail,
    createdAt: row.created_at.toISOString(),
  }));
}
