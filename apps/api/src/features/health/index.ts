import { Hono } from 'hono';

export interface HealthDeps {
  /** Whether the database answers. */
  databaseUp: () => Promise<boolean>;
}

/** `GET /health`: the API and its database (FR-007). */
export function healthRoutes(deps: HealthDeps): Hono {
  return new Hono().get('/', async (c) => {
    const up = await deps.databaseUp();
    return c.json({ status: up ? 'ok' : 'degraded', database: up ? 'ok' : 'down' }, up ? 200 : 503);
  });
}
