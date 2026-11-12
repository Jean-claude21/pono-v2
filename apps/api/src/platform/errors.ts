import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** An error the API returns as is: a stable code, translated by the console. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: ContentfulStatusCode,
    message: string,
    /** What the person needs to decide, never a secret (e.g. the servers that hold the limit). */
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface ErrorBody {
  error: { code: string; message: string; detail?: Record<string, unknown> };
}

export function errorBody(
  code: string,
  message: string,
  detail?: Record<string, unknown>,
): ErrorBody {
  return { error: { code, message, ...(detail ? { detail } : {}) } };
}
