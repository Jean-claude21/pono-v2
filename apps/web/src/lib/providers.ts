/** Brand names stay as the brands write them. */
const NAMES: Record<string, string> = {
  github: 'GitHub',
  netlify: 'Netlify',
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
};

export const nameOf = (provider: string): string => NAMES[provider] ?? provider;
