/** The person behind a request, and the organization they act in (principle 9: who, through what). */
export interface Actor {
  personId: string;
  login: string;
  name: string | null;
  organizationId: string;
  /** `system`: Pono's own periodic tasks, which act for no person. */
  channel: 'console' | 'mcp' | 'system';
}

/** The actor of Pono's periodic tasks in one organization. */
export function systemActor(organizationId: string): Actor {
  return {
    personId: '00000000-0000-0000-0000-000000000000',
    login: 'pono',
    name: 'Pono',
    organizationId,
    channel: 'system',
  };
}

export interface AppEnv {
  Variables: { actor: Actor; sessionHash: string };
}
