/** Brand names stay as the brands write them. */
const NAMES: Record<string, string> = {
  github: 'GitHub',
  netlify: 'Netlify',
  vercel: 'Vercel',
  chariow: 'Chariow',
  cloudflare: 'Cloudflare',
  coolify: 'Coolify',
  neon: 'Neon',
  openai: 'OpenAI',
  umami: 'Umami Cloud',
  'umami-self': 'Umami',
  posthog: 'PostHog',
  agent37: 'Agent37',
  stripe: 'Stripe',
  resend: 'Resend',
  moneroo: 'Moneroo',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
};

export const nameOf = (provider: string): string => NAMES[provider] ?? provider;
