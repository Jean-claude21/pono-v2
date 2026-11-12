import { fetchJson, type Fetch } from '../../../platform/http.js';
import type { IdentityProvider, SignedInPerson } from '../ports.js';

interface TokenAnswer {
  access_token?: string;
  error?: string;
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
        codeHostToken: token.access_token,
      };
    },
  };
}
