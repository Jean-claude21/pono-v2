import { z } from 'zod';

const schema = z.object({
  PONO_DATABASE_URL: z.url(),
  PONO_DATABASE_OWNER_URL: z.url().optional(),
  PONO_API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
});

export type Config = z.infer<typeof schema>;

/** A configuration that cannot start the API: names the variables, never their values. */
export class ConfigError extends Error {
  constructor(readonly variables: string[]) {
    super(`Invalid or missing configuration: ${variables.join(', ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const variables = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new ConfigError(variables);
  }
  return parsed.data;
}
