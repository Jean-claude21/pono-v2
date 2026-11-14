/**
 * Credentials that expire (D-032): a sign-in at a provider's application answers a short access
 * token and a refresh token. Both stay sealed together; the access token is renewed shortly before
 * it ends, and the refresh token turns with it.
 */

export interface Expiring {
  access: string;
  refresh: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

const PREFIX = 'rt1:';

/** Renews before the end, so that a command started now does not fail halfway. */
export const RENEW_BEFORE_MS = 10 * 60_000;

export function encodeExpiring(e: Expiring): string {
  return PREFIX + Buffer.from(JSON.stringify(e)).toString('base64url');
}

export function decodeExpiring(credential: string): Expiring | null {
  if (!credential.startsWith(PREFIX)) return null;
  try {
    const e = JSON.parse(Buffer.from(credential.slice(PREFIX.length), 'base64url').toString());
    return typeof e.access === 'string' &&
      typeof e.refresh === 'string' &&
      typeof e.expiresAt === 'number'
      ? e
      : null;
  } catch {
    return null;
  }
}

/** What a provider adapter does to renew: a fresh pair, or a throw when the refresh is refused. */
export type Refresher = (refreshToken: string) => Promise<Expiring>;

const refreshers = new Map<string, Refresher>();

/** Set once at start by the composition root, for each provider whose tokens expire. */
export function setRefresher(provider: string, refresher: Refresher | null): void {
  if (refresher) refreshers.set(provider, refresher);
  else refreshers.delete(provider);
}

export const refresherOf = (provider: string) => refreshers.get(provider);
