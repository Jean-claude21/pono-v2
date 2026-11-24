import type { Agent, ServerStatus } from './domain.js';

export interface HostedServer {
  externalId: string;
  status: ServerStatus;
  url: string | null;
  size: string;
  /** What it costs awake for a whole month. */
  monthlyMicros: number;
}

export interface CreateServer {
  name: string;
  agent: Agent;
  /** Development variables only: never a production key (D-007). */
  env: Record<string, string>;
  metadata: Record<string, string>;
  budgetMicros: number;
  idleSeconds: number;
}

/** Where a server may connect: anywhere, nowhere, or only the listed domains and IPv4 ranges. */
export type NetworkPolicy = 'open' | 'closed' | { allow: string[] };

/** A restore point of a server's files. */
export interface ServerBackup {
  id: string;
  kind: 'automatic' | 'manual';
  createdAt: Date;
  sizeBytes: number;
}

/** Where project servers run. The id is an opaque adapter id (D-003). */
export interface ProjectServerHost {
  readonly id: string;
  create(input: CreateServer): Promise<HostedServer>;
  /** null when the provider no longer knows it. */
  get(externalId: string): Promise<HostedServer | null>;
  sleep(externalId: string): Promise<void>;
  /**
   * What each server spent since the start of the UTC month, awake time and paid calls together, by
   * external id (D-040). The host caps only paid calls: Pono holds the rest of the budget itself.
   */
  monthSpend?(now: Date): Promise<Map<string, number>>;
  wake(externalId: string): Promise<void>;
  destroy(externalId: string): Promise<void>;
  /** Runs a shell command on the server and waits for it (D-020). A failing command still answers. */
  run(
    externalId: string,
    command: string,
    options?: { timeoutMs?: number },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  /** Starts a long command in the background (the project's dev server); answers its process id. */
  start(externalId: string, command: string): Promise<{ pid: number }>;
  /** Opens a port of the server to the internet; answers its address (stable for this server). */
  publishPort(
    externalId: string,
    port: number,
    label: string,
    /** A readable start of the address (`boutique-lome-…`), when the provider allows one. */
    prefix?: string,
  ): Promise<{ url: string }>;
  /** How the server holds up: restarts, memory exhausted; null fields when unknown. */
  health?(externalId: string): Promise<{
    running: boolean | null;
    restarts: number;
    outOfMemory: boolean;
    verdict: string | null;
  }>;
  /** A private, time-boxed address of a port for a browser (D-031); no address stays open after. */
  previewLink?(
    externalId: string,
    port: number,
    ttlSeconds: number,
  ): Promise<{ url: string; expiresAt: Date }>;
  /** Closes a port opened with publishPort; nothing when it was not open. */
  unpublishPort?(externalId: string, port: number): Promise<void>;
  /** Applies where the server may connect, without a restart (D-031). */
  setNetwork?(externalId: string, policy: NetworkPolicy): Promise<void>;
  /** Domains the host itself needs reachable from the server (its own API, its tools). */
  readonly networkNeeds?: string[];
  /** Restore points: nightly ones, and one taken on demand (D-031). */
  backups?: {
    list(externalId: string): Promise<ServerBackup[]>;
    create(externalId: string): Promise<ServerBackup>;
    /** Replaces the server's files with a backup, in place; files written after it are lost. */
    restore(externalId: string, backupId: string): Promise<void>;
  };
  /** The host suffix of published addresses, for dev servers that check their host (`.example.app`). */
  readonly publicHostSuffix: string | null;
}
