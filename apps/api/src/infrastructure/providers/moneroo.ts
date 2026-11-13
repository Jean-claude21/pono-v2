import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BillingProvider } from '../../features/billing/index.js';
import { PLANS, type Plan } from '../../features/servers/index.js';
import { ProviderError, type Fetch } from '../../platform/http.js';

const ID = 'moneroo';
const API = 'https://api.moneroo.io/v1';
/** One payment buys this many days of the plan; Pono renews nothing by itself (D-023). */
export const PAID_DAYS = 30;

/** Moneroo's `X-Moneroo-Signature`: HMAC-SHA256 of the raw body with the webhook secret, in hex. */
export function verifyMonerooSignature(
  raw: string,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header) return false;
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(header.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

interface Payment {
  id: string;
  status: string;
  amount: number;
  currency: string | { code: string };
  metadata?: Record<string, string> | null;
  customer?: { email?: string } | null;
}

/** Splits a display name into the first and last names Moneroo asks for. */
function names(name: string | null, email: string): { first_name: string; last_name: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const fallback = email.split('@')[0] ?? 'Pono';
  return {
    first_name: parts[0] ?? fallback,
    last_name: parts.length > 1 ? parts.slice(1).join(' ') : (parts[0] ?? fallback),
  };
}

/**
 * Moneroo for the Solo and Pro plans (D-023): one payment buys thirty days. The webhook only says
 * that something happened; the payment is read again at Moneroo before a plan changes.
 */
export function monerooBilling(options: {
  secretKey: string;
  webhookSecret: string;
  currency?: string;
  fetch: Fetch;
}): BillingProvider {
  const currency = options.currency ?? 'USD';
  const headers = {
    authorization: `Bearer ${options.secretKey}`,
    accept: 'application/json',
    'content-type': 'application/json',
  };
  const amountOf = (plan: Exclude<Plan, 'free'>) => Math.round(PLANS[plan].priceMicros / 1_000_000);

  return {
    id: ID,
    async checkout({ organizationId, plan, email, name, returnUrl }) {
      if (!email)
        throw new ProviderError(ID, 400, 'Moneroo needs an email address to take a payment.');
      const response = await options.fetch(`${API}/payments/initialize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          amount: amountOf(plan),
          currency,
          description: `Pono ${plan} — ${PAID_DAYS} days`,
          return_url: `${returnUrl}?plan=paid`,
          customer: { email, ...names(name, email) },
          metadata: { organization: organizationId, plan },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new ProviderError(ID, response.status, `Answered ${response.status}`);
      return ((await response.json()) as { data: { checkout_url: string } }).data.checkout_url;
    },
    async event(raw, signature) {
      if (!verifyMonerooSignature(raw, signature, options.webhookSecret))
        throw new Error('bad signature');
      const event = JSON.parse(raw) as { event?: string; data?: { id?: string } };
      if (event.event !== 'payment.success' || !event.data?.id) return null;
      // The webhook carries no complete payment: read it again, and trust only that.
      const response = await options.fetch(
        `${API}/payments/${encodeURIComponent(event.data.id)}/verify`,
        { headers, signal: AbortSignal.timeout(15_000) },
      );
      if (!response.ok) throw new ProviderError(ID, response.status, `Answered ${response.status}`);
      const payment = ((await response.json()) as { data: Payment }).data;
      const organizationId = payment.metadata?.organization;
      const plan = payment.metadata?.plan;
      const code = typeof payment.currency === 'string' ? payment.currency : payment.currency.code;
      if (
        payment.status !== 'success' ||
        !organizationId ||
        (plan !== 'solo' && plan !== 'pro') ||
        code !== currency ||
        payment.amount < amountOf(plan)
      )
        return null;
      return {
        organizationId,
        plan,
        customer: payment.customer?.email ?? null,
        payment: { id: payment.id, days: PAID_DAYS },
      };
    },
  };
}
