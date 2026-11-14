import { fetchJson, type Fetch } from '../../../platform/http.js';
import { encodeExpiring, type Refresher } from '../../connections/refresh.js';
import type { IdentityProvider, SignedInPerson } from '../ports.js';

interface TokenAnswer {
  access_token?: string;
  /** Present when the GitHub App's user tokens expire (8 h), with a refresh token (6 months). */
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}

/** The token to seal: an expiring pair when GitHub gave one (D-032), the bare token otherwise. */
function credentialOf(token: TokenAnswer, now: number): string {
  return token.refresh_token && token.expires_in
    ? encodeExpiring({
        access: token.access_token!,
        refresh: token.refresh_token,
        expiresAt: now + token.expires_in * 1000,
      })
    : token.access_token!;
}

/** Renews a GitHub App user token with its refresh token; the refresh token turns too. */
export function githubRefresher(options: {
  clientId: string;
  clientSecret: string;
  fetch: Fetch;
}): Refresher {
  return async (refreshToken) => {
    const token = await fetchJson<TokenAnswer>(options.fetch, {
      provider: 'github',
      url: 'https://github.com/login/oauth/access_token',
      method: 'POST',
      body: {
        client_id: options.clientId,
        client_secret: options.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
    });
    if (!token.access_token || !token.refresh_token || !token.expires_in)
      throw new Error(`Refresh refused: ${token.error ?? 'no token'}`);
    return {
      access: token.access_token,
      refresh: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    };
  };
}
interface UserAnswer {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
}
interface EmailAnswer {
  email: string;
  primary: boolean;
  verified: boolean;
}

/** Sign-in with GitHub (an OAuth app or a GitHub App's user authorization). */
export function githubIdentity(options: {
  clientId: string;
  clientSecret: string;
  fetch: Fetch;
}): IdentityProvider {
  const provider = 'github';
  return {
    id: provider,
    codeHostProvider: provider,
    authorizeUrl(state, redirectUri) {
      const url = new URL('https://github.com/login/oauth/authorize');
      url.searchParams.set('client_id', options.clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      // Used by an OAuth app; a GitHub App takes its permissions from its own settings.
      url.searchParams.set('scope', 'read:user user:email repo');
      return url.toString();
    },
    async exchange(code, redirectUri): Promise<SignedInPerson> {
      const token = await fetchJson<TokenAnswer>(options.fetch, {
        provider,
        url: 'https://github.com/login/oauth/access_token',
        method: 'POST',
        body: {
          client_id: options.clientId,
          client_secret: options.clientSecret,
          code,
          redirect_uri: redirectUri,
        },
      });
      if (!token.access_token) throw new Error(`Sign-in refused: ${token.error ?? 'no token'}`);
      const headers = { authorization: `Bearer ${token.access_token}`, 'user-agent': 'pono' };
      const user = await fetchJson<UserAnswer>(options.fetch, {
        provider,
        url: 'https://api.github.com/user',
        headers,
      });
      let email = user.email;
      if (!email) {
        const emails = await fetchJson<EmailAnswer[]>(options.fetch, {
          provider,
          url: 'https://api.github.com/user/emails',
          headers,
        }).catch(() => []);
        email = emails.find((e) => e.primary && e.verified)?.email ?? null;
      }
      return {
        externalId: `${provider}:${user.id}`,
        login: user.login,
        name: user.name,
        email,
        codeHostToken: credentialOf(token, Date.now()),
      };
    },
  };
}
