// Browser error monitoring (D-046). The tracker loads only when a DSN was set at build time, after the
// page is interactive; nothing personal is sent: no cookie, header, body, query string or name.
import type * as SentryBrowser from '@sentry/react';

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

let loading: Promise<void> | null = null;

/** The environment as people name it, read from the address the page is served from. */
export function browserEnvironment(hostname: string): string {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'development';
  return hostname.includes('staging') ? 'staging' : 'production';
}

export function initBrowserMonitoring(): Promise<void> {
  if (!DSN || typeof window === 'undefined') return Promise.resolve();
  loading ??= import('@sentry/react')
    .then((sentry: typeof SentryBrowser) => {
      sentry.init({
        dsn: DSN,
        environment: browserEnvironment(window.location.hostname),
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: false,
          httpBodies: [],
          urlQueryParams: false,
        },
        tracesSampleRate: 0,
        // Noise from extensions and lost connections is not ours to fix.
        ignoreErrors: [
          'ResizeObserver loop',
          'Failed to fetch',
          'NetworkError',
          'Load failed',
          'AbortError',
        ],
        denyUrls: [/extensions\//iu, /^chrome:\/\//iu, /^moz-extension:\/\//iu],
        beforeSend(event) {
          const url = event.request?.url;
          if (event.request) event.request = url ? { url: url.split('?')[0]! } : {};
          if (event.user) {
            if (event.user.id !== undefined) event.user = { id: event.user.id };
            else delete event.user;
          }
          return event;
        },
      });
    })
    .catch(() => undefined);
  return loading;
}
