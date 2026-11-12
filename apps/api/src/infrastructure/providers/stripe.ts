import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { BillingProvider } from '../../features/billing/index.js';
import type { Plan } from '../../features/servers/index.js';
import { ProviderError, type Fetch } from '../../platform/http.js';

const ID = 'stripe';

/** Stripe's signature header: `t=<time>,v1=<hmac>`; refused when older than five minutes. */
export function verifyStripeSignature(
  raw: string,
  header: string | undefined,
  secret: string,
  now = Date.now(),
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const time = Number(parts.t);
  if (!parts.t || !parts.v1 || !Number.isFinite(time) || Math.abs(now / 1000 - time) > 300)
    return false;
  const expected = createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Stripe Checkout for the Solo and Pro plans; the plan follows the subscription's events. */
export function stripeBilling(options: {
  secretKey: string;
  webhookSecret: string;
  prices: { solo: string; pro: string };
  fetch: Fetch;
}): BillingProvider {
  const planOfPrice = (price: string | undefined): Plan | null =>
    price === options.prices.solo ? 'solo' : price === options.prices.pro ? 'pro' : null;
  return {
    id: ID,
    async checkout({ organizationId, plan, email, returnUrl }) {
      const form = new URLSearchParams({
        mode: 'subscription',
        'line_items[0][price]': options.prices[plan],
        'line_items[0][quantity]': '1',
        success_url: `${returnUrl}?plan=paid`,
        cancel_url: `${returnUrl}?plan=cancelled`,
        client_reference_id: organizationId,
        'subscription_data[metadata][organization]': organizationId,
        ...(email ? { customer_email: email } : {}),
      });
      const response = await options.fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
          'idempotency-key': randomUUID(),
        },
        body: form,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new ProviderError(ID, response.status, `Answered ${response.status}`);
      return ((await response.json()) as { url: string }).url;
    },
    async event(raw, signature) {
      if (!verifyStripeSignature(raw, signature, options.webhookSecret))
        throw new Error('bad signature');
      const event = JSON.parse(raw) as {
        type: string;
        data: {
          object: {
            customer?: string;
            status?: string;
            metadata?: { organization?: string };
            items?: { data: { price: { id: string } }[] };
          };
        };
      };
      const sub = event.data.object;
      const organizationId = sub.metadata?.organization;
      if (!organizationId || !event.type.startsWith('customer.subscription.')) return null;
      const active =
        event.type !== 'customer.subscription.deleted' &&
        (sub.status === 'active' || sub.status === 'trialing');
      const plan = active ? (planOfPrice(sub.items?.data[0]?.price.id) ?? 'free') : 'free';
      return { organizationId, plan, customer: sub.customer ?? null };
    },
  };
}

/**
 * Development billing: checkout sends the person straight back, and a signed local event changes the
 * plan. Never wired in production.
 */
export function devBilling(options: {
  secret: string;
  publicUrl: string;
  fetch: Fetch;
  apiUrl: string;
}): BillingProvider {
  return {
    id: 'dev',
    async checkout({ organizationId, plan, returnUrl }) {
      const body = JSON.stringify({ organizationId, plan });
      const signature = createHmac('sha256', options.secret).update(body).digest('hex');
      await options.fetch(`${options.apiUrl}/billing/webhook`, {
        method: 'POST',
        headers: { 'x-pono-signature': signature, 'content-type': 'application/json' },
        body,
      });
      return `${returnUrl}?plan=paid`;
    },
    async event(raw, signature) {
      const expected = createHmac('sha256', options.secret).update(raw).digest('hex');
      if (!signature || signature !== expected) throw new Error('bad signature');
      const event = JSON.parse(raw) as { organizationId: string; plan: Plan };
      return { organizationId: event.organizationId, plan: event.plan, customer: null };
    },
  };
}

/** No billing configured: every plan change says so. */
export function unavailableBilling(): BillingProvider {
  return {
    id: 'none',
    async checkout() {
      throw new ProviderError('none', 503, 'No billing provider is configured.');
    },
    async event() {
      throw new Error('no billing');
    },
  };
}
