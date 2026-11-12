import type { LinkChecker } from '../../features/projects/index.js';
import type { Fetch } from '../../platform/http.js';

/** An address answers when it returns below 400 within 10 s; otherwise it is down (US4). */
export function httpLinkChecker(fetchImpl: Fetch, timeoutMs = 10_000): LinkChecker {
  return {
    async check(url) {
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          redirect: 'follow',
          headers: { 'user-agent': 'pono-link-check' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        await response.body?.cancel();
        return response.status < 400 ? 'up' : 'down';
      } catch {
        return 'down';
      }
    },
  };
}
