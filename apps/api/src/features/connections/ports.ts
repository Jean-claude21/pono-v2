export type ConnectionKind = 'code_host' | 'hosting' | 'database' | 'ai' | 'analytics';

/** Pono's application at a provider: where to send the person, and how to turn the code into a credential. */
export interface ProviderOAuth {
  authorizeUrl(state: string, redirectUri: string): string;
  exchange(code: string, redirectUri: string): Promise<{ account: string; credential: string }>;
}

/** A provider a person connects with a key (US2). The id is an opaque adapter id. */
export interface Connectable {
  readonly id: string;
  readonly kind: ConnectionKind;
  /** What the person gives, e.g. `['token']`, or `['token', 'accountId']`. */
  readonly fields: readonly string[];
  /** Fields the person may leave empty: the provider finds them from the key. */
  readonly optionalFields?: readonly string[];
  /** The provider's page where the key is created, opened from the console: no searching. */
  readonly keyUrl?: string;
  /** What the key must be allowed to do, said in the provider's words. */
  readonly keyScopes?: string;
  /**
   * Sign-in at the provider instead of a key (OAuth), when Pono has an application there: the
   * person clicks, allows, and comes back connected.
   */
  readonly oauth?: ProviderOAuth;
  /**
   * Checks the key with the provider and names the account. Returns the credential to seal (the
   * fields, encoded). Throws a ProviderError when the provider refuses.
   */
  verify(fields: Record<string, string>): Promise<{ account: string; credential: string }>;
}
