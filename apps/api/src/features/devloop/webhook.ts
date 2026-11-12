import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { systemActor, type AppEnv } from '../../platform/context.js';
import { errorBody } from '../../platform/errors.js';
import { pullChanges, type DevLoopDeps } from './index.js';

/** A code host's signature over the raw body: `sha256=<hex>` (D-020). */
export function signatureMatches(
  secret: string,
  body: string,
  signature: string | undefined,
): boolean {
  if (!signature?.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * `/hooks/code`: a push to `dev`, made elsewhere (the person's own agent on their machine), is
 * pulled onto every running dev server of that repository; the dev server reloads by itself.
 */
export function codeHook(deps: DevLoopDeps & { webhookSecret?: string }): Hono<AppEnv> {
  return new Hono<AppEnv>().post('/code', async (c) => {
    if (!deps.webhookSecret)
      return c.json(errorBody('hooks.off', 'No webhook secret is set.'), 503);
    const raw = await c.req.text();
    if (!signatureMatches(deps.webhookSecret, raw, c.req.header('x-hub-signature-256')))
      return c.json(errorBody('hooks.signature', 'The signature does not match.'), 401);
    if (c.req.header('x-github-event') === 'ping') return c.json({ pulled: 0 });
    let event: { ref?: string; repository?: { full_name?: string } };
    try {
      event = JSON.parse(raw) as typeof event;
    } catch {
      return c.json(errorBody('request.invalid', 'Not JSON.'), 400);
    }
    if (event.ref !== 'refs/heads/dev' || !event.repository?.full_name)
      return c.json({ pulled: 0 });
    const { rows } = await deps.pool.query<{ organization_id: string; project_id: string }>(
      'SELECT * FROM projects_by_repository($1)',
      [event.repository.full_name],
    );
    let pulled = 0;
    for (const r of rows)
      await pullChanges(deps, systemActor(r.organization_id), r.project_id).then(
        () => pulled++,
        () => undefined,
      );
    return c.json({ pulled });
  });
}
