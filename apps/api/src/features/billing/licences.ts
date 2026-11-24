import type { Actor } from '../../platform/context.js';
import { withOrganization, type Pool } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { ProviderError } from '../../platform/http.js';
import type { Sealer } from '../../platform/secrets.js';
import { readOffers, setting, type Offer } from '../offers/index.js';

/**
 * Plans sold as licence products (D-041, D-043). The operator ties each plan to a product of their
 * store. Choosing the plan opens the store's payment page for that product; when the sale succeeds,
 * the store says so (a signed Pulse), Pono reads the sale again, activates its licence for the
 * workshop, and the plan runs until the licence ends. A key entered by hand does the same.
 */
export interface Licence {
  id: string;
  /** The key itself, to activate it; null when the store did not say it. */
  key?: string | null;
  status: 'pending_activation' | 'active' | 'expired' | 'revoked';
  productId: string | null;
  usable: boolean;
  expiresAt: Date | null;
  customerEmail?: string | null;
  createdAt?: Date | null;
}

export interface StoreSale {
  id: string;
  status: string;
  productId: string | null;
  customerEmail: string | null;
}

export interface Buyer {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  country: string;
}

/** Where licences are sold. The store's key is the operator's setting, given at each call. */
export interface LicenceProvider {
  readonly id: string;
  /** null when the store does not know this key. */
  read(apiKey: string, key: string): Promise<Licence | null>;
  activate(apiKey: string, key: string, device: string): Promise<Licence>;
  products(apiKey: string): Promise<{ id: string; name: string; licence: boolean }[]>;
  store(apiKey: string): Promise<{ name: string; url: string | null }>;
  /** The store's payment page for a product, the workshop and plan carried with the sale. */
  checkout(
    apiKey: string,
    input: {
      productId: string;
      buyer: Buyer;
      metadata: Record<string, string>;
      redirectUrl: string;
    },
  ): Promise<{ url: string | null; completed: boolean }>;
  /** A sale as the store knows it, or null. */
  sale(apiKey: string, id: string): Promise<StoreSale | null>;
  /** The licences of a customer, newest first. */
  licencesOf(apiKey: string, email: string): Promise<Licence[]>;
  /** Whether a store event is signed with this Pulse secret. */
  verify(rawBody: string, signature: string | undefined, secret: string): boolean;
}

export interface LicenceDeps {
  pool: Pool;
  sealer: Sealer;
  settingsEnv?: Partial<Record<string, string>>;
  licences?: LicenceProvider;
  publicUrl?: string;
  now: () => Date;
  /** Waits between reads of a licence that is not issued yet (tests: none). */
  wait?: (ms: number) => Promise<void>;
}

const DAY = 86_400_000;

async function storeKey(deps: LicenceDeps): Promise<{ provider: LicenceProvider; apiKey: string }> {
  const apiKey = await setting(deps, 'chariow.api_key');
  if (!deps.licences || !apiKey)
    throw new AppError('licence.not_configured', 409, 'Licences are not sold yet.');
  return { provider: deps.licences, apiKey };
}

/**
 * A licence counted for a workshop, once: claimed for it, activated at the store, and the plan's
 * days paid. Answers the plan, the days added (0 when it was already counted here).
 */
async function grant(
  deps: LicenceDeps,
  organizationId: string,
  licence: Licence,
  offer: Offer,
  sale: string | null,
): Promise<{ plan: string; days: number; already: boolean }> {
  const { provider, apiKey } = await storeKey(deps);
  const id = `${provider.id}:${licence.id}`;
  const claim = async () =>
    (
      await deps.pool.query<{ owner: string; fresh: boolean }>(
        'SELECT owner, fresh FROM claim_licence($1, $2, $3)',
        [id, organizationId, sale],
      )
    ).rows[0]!;
  const used = () =>
    new AppError('licence.used', 409, 'This licence is already used by another workshop.');
  // Already counted somewhere: here, nothing more; elsewhere, refused — before touching the store.
  const owner = (
    await deps.pool.query<{ owner: string | null }>('SELECT licence_owner($1) AS owner', [id])
  ).rows[0]?.owner;
  if (owner && owner !== organizationId) throw used();
  if (owner) return { plan: offer.plan, days: 0, already: true };

  let current = licence;
  if (current.status === 'pending_activation' && current.key)
    current = await provider.activate(apiKey, current.key, `pono-${organizationId}`);
  if (!current.usable)
    throw new AppError('licence.inactive', 409, 'This licence is expired or revoked.', {
      status: current.status,
    });
  const claimed = await claim();
  if (claimed.owner !== organizationId) throw used();
  if (!claimed.fresh) return { plan: offer.plan, days: 0, already: true };
  const days = current.expiresAt
    ? Math.max(1, Math.ceil((current.expiresAt.getTime() - deps.now().getTime()) / DAY))
    : offer.licenceDays;
  await deps.pool.query('SELECT pay_organization_plan($1, $2, $3, $4, $5)', [
    organizationId,
    offer.plan,
    null,
    `${provider.id}:${licence.id}`,
    days,
  ]);
  return { plan: offer.plan, days, already: false };
}

/** The offer a licence product sells, or null. */
async function offerOfProduct(deps: LicenceDeps, productId: string | null) {
  return (
    (await readOffers(deps.pool)).find(
      (o) => o.plan !== 'free' && o.licenceProduct && o.licenceProduct === productId,
    ) ?? null
  );
}

/** A key entered by hand in the console. */
export async function redeemLicence(
  deps: LicenceDeps,
  actor: Actor,
  key: string,
): Promise<{ plan: string; days: number; until: string | null; already: boolean }> {
  if (actor.channel !== 'console')
    throw new AppError('plan.person_only', 403, 'Only a person changes the plan.');
  const { provider, apiKey } = await storeKey(deps);
  const licence = await provider.read(apiKey, key);
  if (!licence) throw new AppError('licence.unknown', 404, 'This licence key is unknown.');
  const offer = await offerOfProduct(deps, licence.productId);
  if (!offer) throw new AppError('licence.other_product', 422, 'This key is not for a Pono plan.');
  const granted = await grant(deps, actor.organizationId, { ...licence, key }, offer, null);
  return { ...granted, until: await paidUntil(deps, actor.organizationId) };
}

async function paidUntil(deps: LicenceDeps, organizationId: string): Promise<string | null> {
  return withOrganization(deps.pool, organizationId, async (client) => {
    const { rows } = await client.query<{ until: Date | null }>(
      'SELECT plan_paid_until AS until FROM organizations',
    );
    return rows[0]?.until?.toISOString() ?? null;
  });
}

/** The store's payment page for a plan sold by licence (D-043); null when it is not. */
export async function licenceCheckout(
  deps: LicenceDeps,
  input: { organizationId: string; offer: Offer; buyer: Buyer; returnUrl: string },
): Promise<string | null> {
  const apiKey = await setting(deps, 'chariow.api_key');
  if (!deps.licences || !apiKey || !input.offer.licenceProduct) return null;
  const answer = await deps.licences
    .checkout(apiKey, {
      productId: input.offer.licenceProduct,
      buyer: input.buyer,
      metadata: { pono_organization: input.organizationId, pono_plan: input.offer.plan },
      redirectUrl: input.returnUrl,
    })
    .catch((error: unknown) => {
      // The store said why (an unknown product, a phone it refuses): said as the store said it.
      if (error instanceof ProviderError && (error.status ?? 0) >= 400 && (error.status ?? 0) < 500)
        throw new AppError('licence.store_refused', 422, error.message, { reason: error.message });
      throw error;
    });
  return answer.url ?? input.returnUrl;
}

/**
 * A store event (D-043): signed with the Pulse secret, handled once per delivery. A successful sale
 * of a plan's product is read again at the store; its licence is activated for the workshop the
 * payment page carried. Answers what was done, for the log; never throws on a foreign event.
 */
export async function storeEvent(
  deps: LicenceDeps,
  input: { rawBody: string; signature: string | undefined; delivery: string | undefined },
): Promise<'granted' | 'ignored' | 'duplicate' | 'pending'> {
  const secret = await setting(deps, 'chariow.pulse_secret');
  const { provider, apiKey } = await storeKey(deps);
  if (!secret || !provider.verify(input.rawBody, input.signature, secret))
    throw new AppError('billing.bad_signature', 401, 'This event is not signed by the store.');
  if (input.delivery) {
    const fresh = (
      await deps.pool.query<{ fresh: boolean }>('SELECT record_store_delivery($1) AS fresh', [
        `${provider.id}:${input.delivery}`,
      ])
    ).rows[0]?.fresh;
    if (!fresh) return 'duplicate';
  }
  const event = JSON.parse(input.rawBody) as {
    event?: string;
    sale?: { id?: string; custom_metadata?: Record<string, string> | null };
  };
  if (event.event !== 'successful.sale' || !event.sale?.id) return 'ignored';
  const organizationId = event.sale.custom_metadata?.pono_organization;
  if (!organizationId) return 'ignored';

  // The body is signed, but the sale is read again: only the store's own answer counts.
  const sale = await provider.sale(apiKey, event.sale.id);
  if (!sale || !['completed', 'settled'].includes(sale.status)) return 'ignored';
  const offer = await offerOfProduct(deps, sale.productId);
  if (!offer || !sale.customerEmail) return 'ignored';
  const counted = (
    await deps.pool.query<{ licence: string | null }>('SELECT sale_licence($1) AS licence', [
      sale.id,
    ])
  ).rows[0]?.licence;
  if (counted) return 'duplicate';

  // The store issues the licence with the sale; a few seconds may pass before it is listed.
  const wait = deps.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidates = (await provider.licencesOf(apiKey, sale.customerEmail)).filter(
      (l) => l.productId === sale.productId && l.status !== 'revoked' && l.status !== 'expired',
    );
    for (const licence of candidates) {
      try {
        const granted = await grant(deps, organizationId, licence, offer, sale.id);
        if (!granted.already) return 'granted';
      } catch (error) {
        // Another workshop's licence of the same customer: try the next one.
        if (!(error instanceof AppError && error.code === 'licence.used')) throw error;
      }
    }
    if (attempt < 3) await wait(3000);
  }
  // Paid, and no licence listed yet: the plan still starts, for the offer's days.
  await deps.pool.query('SELECT pay_organization_plan($1, $2, $3, $4, $5)', [
    organizationId,
    offer.plan,
    null,
    `${provider.id}:sale:${sale.id}`,
    offer.licenceDays,
  ]);
  return 'pending';
}
