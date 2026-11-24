import type { Licence, LicenceProvider } from '../../features/billing/licences.js';
import { ProviderError, type Fetch } from '../../platform/http.js';

/**
 * Chariow (D-041): a plan sold as a licence product. Pono reads the key a person enters, activates it
 * once for their workshop, and counts the plan's days. The store's API key comes from the operator's
 * settings, so it is passed with every call.
 */
const ID = 'chariow';
const API = 'https://api.chariow.com/v1';

interface LicenceAnswer {
  id: string;
  status: 'pending_activation' | 'active' | 'expired' | 'revoked';
  product: { id: string; name: string } | null;
  is_active: boolean;
  is_expired: boolean;
  expires_at: string | null;
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
    status: a.status,
    productId: a.product?.id ?? null,
    usable: a.is_active && !a.is_expired && a.status === 'active',
    expiresAt: a.expires_at ? new Date(a.expires_at) : null,
  });

  return {
    id: ID,
    async read(apiKey, key) {
      try {
        return licence(
          await call<LicenceAnswer>(apiKey, `/licenses/${encodeURIComponent(key.trim())}`),
        );
      } catch (error) {
        if (error instanceof ProviderError && error.status === 404) return null;
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
  };
}
