import type { MiddlewareHandler } from 'hono';
import { errorBody } from './errors.js';

/**
 * A fixed-window limit per caller, in memory (one API instance). The caller is the bearer or the
 * session when there is one, else the address the console relays.
 */
export function rateLimit(options: {
  windowMs: number;
  max: number;
  name: string;
}): MiddlewareHandler {
  const hits = new Map<string, { count: number; until: number }>();
  return async (c, next) => {
    const now = Date.now();
    if (hits.size > 50_000) for (const [k, v] of hits) if (v.until <= now) hits.delete(k);
    const who =
      c.req.header('authorization')?.slice(-24) ??
      c.req.header('cookie')?.match(/pono_session=([^;]{12})/)?.[1] ??
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      'local';
    const key = `${options.name}:${who}`;
    const entry = hits.get(key);
    if (!entry || entry.until <= now) hits.set(key, { count: 1, until: now + options.windowMs });
    else if (++entry.count > options.max) {
      c.header('retry-after', String(Math.ceil((entry.until - now) / 1000)));
      return c.json(errorBody('rate.limited', 'Too many requests; try again shortly.'), 429);
    }
    await next();
  };
}
