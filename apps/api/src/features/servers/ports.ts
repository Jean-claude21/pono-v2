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

/** Where project servers run. The id is an opaque adapter id (D-003). */
export interface ProjectServerHost {
  readonly id: string;
  create(input: CreateServer): Promise<HostedServer>;
  /** null when the provider no longer knows it. */
  get(externalId: string): Promise<HostedServer | null>;
  sleep(externalId: string): Promise<void>;
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
  publishPort(externalId: string, port: number, label: string): Promise<{ url: string }>;
  /** The host suffix of published addresses, for dev servers that check their host (`.example.app`). */
  readonly publicHostSuffix: string | null;
}
