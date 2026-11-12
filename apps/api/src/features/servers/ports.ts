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
}
