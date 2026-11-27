// Error monitoring (D-046): unexpected errors of the API and of the periodic task go to the error
// tracker with where they happened. Nothing personal and nothing secret is sent: no cookie, header,
// body or query string, no name or e-mail; only ids. Without PONO_SENTRY_DSN (development, tests)
// errors stay in the log only.
import * as Sentry from '@sentry/node';

let enabled = false;

/** The environment as people name it, read from the public address. */
export function deployEnvironment(publicUrl: string, nodeEnv: string): string {
  if (nodeEnv !== 'production') return nodeEnv;
  return /staging/u.test(publicUrl) ? 'staging' : 'production';
}

type Event = Parameters<NonNullable<Sentry.NodeOptions['beforeSend']>>[0];

/** Keeps only what locates an error: the method and the path, and a person's id. */
export function scrub<E extends Pick<Event, 'request' | 'user'>>(event: E): E {
  if (event.request) {
    const { method, url } = event.request;
    event.request = { ...(method ? { method } : {}), ...(url ? { url: url.split('?')[0]! } : {}) };
  }
  if (event.user) {
    if (event.user.id !== undefined) event.user = { id: event.user.id };
    else delete event.user;
  }
  return event;
}

export function initMonitoring(options: {
  dsn: string | undefined;
  publicUrl: string;
  nodeEnv: string;
  release?: string | undefined;
}): boolean {
  if (enabled || !options.dsn || options.nodeEnv === 'test') return enabled;
  Sentry.init({
    dsn: options.dsn,
    environment: deployEnvironment(options.publicUrl, options.nodeEnv),
    ...(options.release ? { release: options.release } : {}),
    // Nothing personal: no user fields, cookies, headers, bodies or query strings.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
    },
    tracesSampleRate: 0,
    beforeSend: (event) => scrub(event),
  });
  enabled = true;
  return enabled;
}

export interface ErrorContext {
  /** Where it happened: « api », « job:cycle », « job:runner »… */
  where: string;
  organizationId?: string;
  extra?: Record<string, string | number | boolean | null>;
}

/** Logs the error and, when monitoring is on, sends it with its context. Returns the event id. */
export function reportError(error: unknown, context: ErrorContext): string | undefined {
  console.error(`[${context.where}]`, error);
  if (!enabled) return undefined;
  return Sentry.withScope((scope) => {
    scope.setTag('where', context.where);
    if (context.organizationId) scope.setTag('organization', context.organizationId);
    if (context.extra) scope.setExtras(context.extra);
    return Sentry.captureException(error);
  });
}

/** Sends what is still queued before the process ends (a deploy, a crash). */
export async function flushMonitoring(timeoutMs = 2000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs);
}
