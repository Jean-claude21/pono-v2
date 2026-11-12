import { Hono } from 'hono';
import { healthRoutes, type HealthDeps } from './features/health/index.js';
import { AppError, errorBody } from './platform/errors.js';

export type AppDeps = HealthDeps;

/** The API: every route, and errors in one shape with a stable code (FR-008). */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.route('/health', healthRoutes(deps));

  app.notFound((c) => c.json(errorBody('route.not_found', 'No such route.'), 404));
  app.onError((error, c) => {
    if (error instanceof AppError)
      return c.json(errorBody(error.code, error.message), error.status);
    console.error(error);
    return c.json(errorBody('internal', 'Something went wrong.'), 500);
  });
  return app;
}
