/** The person behind a request, and the organization they act in (principle 9: who, through what). */
export interface Actor {
  personId: string;
  login: string;
  name: string | null;
  organizationId: string;
  channel: 'console' | 'mcp';
}

export interface AppEnv {
  Variables: { actor: Actor; sessionHash: string };
}
