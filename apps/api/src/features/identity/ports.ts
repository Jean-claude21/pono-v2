/** Who signed in, as the identity provider says (no provider name leaves the adapter). */
export interface SignedInPerson {
  externalId: string;
  login: string;
  name: string | null;
  email: string | null;
  /** A token that reads the person's code host, kept sealed as a connection; null when none. */
  codeHostToken: string | null;
}

export interface IdentityProvider {
  /** An opaque adapter id, used in the sign-in URL. */
  readonly id: string;
  /** The code host connection this provider's token opens, if any. */
  readonly codeHostProvider: string | null;
  /** `hint` is a login suggested by the caller; only the development provider uses it. */
  authorizeUrl(state: string, redirectUri: string, hint?: string): string;
  exchange(code: string, redirectUri: string): Promise<SignedInPerson>;
}
