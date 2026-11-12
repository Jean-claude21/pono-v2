import type { IdentityProvider } from '../ports.js';

/**
 * Sign-in for development and tests only: `/auth/sign-in/dev?login=jc` signs in as `jc`. Never
 * wired when NODE_ENV is production (FR-001).
 */
export function devIdentity(): IdentityProvider {
  return {
    id: 'dev',
    codeHostProvider: null,
    authorizeUrl(state, redirectUri, hint) {
      const url = new URL(redirectUri);
      url.searchParams.set('code', `dev:${hint && /^[a-z0-9-]{1,39}$/i.test(hint) ? hint : 'dev'}`);
      url.searchParams.set('state', state);
      return url.toString();
    },
    async exchange(code) {
      const login = code.startsWith('dev:') ? code.slice(4) : 'dev';
      return {
        externalId: `dev:${login}`,
        login,
        name: login,
        email: `${login}@dev.pono.test`,
        codeHostToken: null,
      };
    },
  };
}
