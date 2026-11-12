import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PONO_DATABASE_URL: z.url(),
  PONO_DATABASE_OWNER_URL: z.url().optional(),
  PONO_API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  /** 32 random bytes in base64: seals what Pono keeps (D-007). */
  PONO_SECRETS_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, '32 bytes, in base64'),
  /** The console's address: the only origin a browser sees. */
  PONO_PUBLIC_URL: z.url().default('http://localhost:3000'),
  PONO_GITHUB_CLIENT_ID: z.string().min(1).optional(),
  PONO_GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  /** `1` wires the development sign-in; refused in production (FR-001). */
  PONO_DEV_SIGN_IN: z.enum(['0', '1']).default('0'),
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
  if (parsed.data.NODE_ENV === 'production' && parsed.data.PONO_DEV_SIGN_IN === '1') {
    throw new ConfigError(['PONO_DEV_SIGN_IN']);
  }
  return parsed.data;
}
