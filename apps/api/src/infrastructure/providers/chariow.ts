import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Licence, LicenceProvider } from '../../features/billing/licences.js';
import { ProviderError, type Fetch } from '../../platform/http.js';

/**
 * Chariow (D-041, D-043): a plan sold as a licence product. Pono opens the store's payment page for
 * the plan's product, hears the sale by a signed Pulse, reads it again, and activates its licence
 * for the workshop. The store's API key comes from the operator's settings, given at each call.
 */
const ID = 'chariow';
const API = 'https://api.chariow.com/v1';

interface LicenceAnswer {
  id: string;
  status: 'pending_activation' | 'active' | 'expired' | 'revoked';
  product: { id: string; name: string } | null;
  customer?: { email?: string | null } | null;
  license?: { key?: string | null } | null;
  is_active: boolean;
  is_expired: boolean;
  expires_at: string | null;
  created_at?: string | null;
}

/** `sha256=<hex>` of the raw body with the Pulse's own secret, compared in constant time. */
export function verifyChariowSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function chariowLicences(fetchImpl: Fetch): LicenceProvider {
  const call = async <T>(apiKey: string, path: string, method = 'GET', body?: unknown) => {
    const r = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    const answer = (await r.json().catch(() => ({}))) as { data?: T; message?: string };
    if (!r.ok) throw new ProviderError(ID, r.status, answer.message ?? `Answered ${r.status}`);
    return answer.data as T;
  };
  const licence = (a: LicenceAnswer): Licence => ({
    id: a.id,
    key: a.license?.key ?? null,
    status: a.status,
    productId: a.product?.id ?? null,
    usable: a.is_active && !a.is_expired && a.status === 'active',
    expiresAt: a.expires_at ? new Date(a.expires_at) : null,
    customerEmail: a.customer?.email ?? null,
    createdAt: a.created_at ? new Date(a.created_at) : null,
  });
  const notFound = (error: unknown) => error instanceof ProviderError && error.status === 404;

  return {
    id: ID,
    async read(apiKey, key) {
      try {
        return licence(
          await call<LicenceAnswer>(apiKey, `/licenses/${encodeURIComponent(key.trim())}`),
        );
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },
    async activate(apiKey, key, device) {
      return licence(
        await call<LicenceAnswer>(
          apiKey,
          `/licenses/${encodeURIComponent(key.trim())}/activate`,
          'POST',
          { device_identifier: device },
        ),
      );
    },
    async products(apiKey) {
      const list = await call<{ id: string; name: string; type: string }[]>(
        apiKey,
        '/products?per_page=100',
      );
      return list.map((p) => ({ id: p.id, name: p.name, licence: p.type === 'license' }));
    },
    async store(apiKey) {
      const s = await call<{ name: string; url?: string | null }>(apiKey, '/store');
      return { name: s.name, url: s.url ?? null };
    },
    async checkout(apiKey, input) {
      const answer = await call<{
        step: 'payment' | 'completed' | 'already_purchased';
        payment?: { checkout_url?: string | null } | null;
      }>(apiKey, '/checkout', 'POST', {
        product_id: input.productId,
        email: input.buyer.email,
        first_name: input.buyer.firstName.slice(0, 50),
        last_name: input.buyer.lastName.slice(0, 50),
        phone: { number: input.buyer.phone, country_code: input.buyer.country },
        custom_metadata: input.metadata,
        redirect_url: input.redirectUrl,
      });
      return {
        url: answer.payment?.checkout_url ?? null,
        completed: answer.step === 'completed',
      };
    },
    async sale(apiKey, id) {
      try {
        const s = await call<{
          id: string;
          status: string;
          product?: { id?: string } | null;
          customer?: { email?: string | null } | null;
        }>(apiKey, `/sales/${encodeURIComponent(id)}`);
        return {
          id: s.id,
          status: s.status,
          productId: s.product?.id ?? null,
          customerEmail: s.customer?.email ?? null,
        };
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },
    async licencesOf(apiKey, email) {
      const list = await call<LicenceAnswer[]>(
        apiKey,
        `/licenses?search=${encodeURIComponent(email)}&per_page=50`,
      );
      return list
        .map(licence)
        .filter((l) => !l.customerEmail || l.customerEmail.toLowerCase() === email.toLowerCase())
        .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    },
    verify: verifyChariowSignature,
  };
}
