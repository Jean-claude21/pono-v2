export type ConnectionKind = 'code_host' | 'hosting' | 'database' | 'ai';

/** A provider a person connects with a key (US2). The id is an opaque adapter id. */
export interface Connectable {
  readonly id: string;
  readonly kind: ConnectionKind;
  /** What the person gives, e.g. `['token']`, or `['token', 'accountId']`. */
  readonly fields: readonly string[];
  /**
   * Checks the key with the provider and names the account. Returns the credential to seal (the
   * fields, encoded). Throws a ProviderError when the provider refuses.
   */
  verify(fields: Record<string, string>): Promise<{ account: string; credential: string }>;
}
