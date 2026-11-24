import type { Actor } from '../../platform/context.js';
import { withOrganization, type Pool } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import type { Sealer } from '../../platform/secrets.js';
import { readOffers, setting } from '../offers/index.js';

/**
 * A plan bought as a licence key (D-041), beside the payment page: the person enters the key in
 * the console; Pono reads it at the store, activates it once for this workshop, and the plan runs
 * until the licence ends (or the offer's days, for a licence without an end). A key counts once.
 */
export interface Licence {
  id: string;
  status: 'pending_activation' | 'active' | 'expired' | 'revoked';
  productId: string | null;
  usable: boolean;
  expiresAt: Date | null;
}

/** Where licences are sold. The store's key is the operator's setting, given at each call. */
export interface LicenceProvider {
  readonly id: string;
  /** null when the store does not know this key. */
  read(apiKey: string, key: string): Promise<Licence | null>;
  activate(apiKey: string, key: string, device: string): Promise<Licence>;
  products(apiKey: string): Promise<{ id: string; name: string; licence: boolean }[]>;
  store(apiKey: string): Promise<{ name: string; url: string | null }>;
}

export interface LicenceDeps {
  pool: Pool;
  sealer: Sealer;
  settingsEnv?: Partial<Record<string, string>>;
  licences?: LicenceProvider;
  now: () => Date;
}

const DAY = 86_400_000;

export async function redeemLicence(
  deps: LicenceDeps,
  actor: Actor,
  key: string,
): Promise<{ plan: string; days: number; until: string | null; already: boolean }> {
  if (actor.channel !== 'console')
    throw new AppError('plan.person_only', 403, 'Only a person changes the plan.');
  const apiKey = await setting(deps, 'chariow.api_key');
  if (!deps.licences || !apiKey)
    throw new AppError('licence.not_configured', 409, 'Licences are not sold yet.');
  let licence = await deps.licences.read(apiKey, key);
  if (!licence) throw new AppError('licence.unknown', 404, 'This licence key is unknown.');
  const offer = (await readOffers(deps.pool)).find(
    (o) => o.plan !== 'free' && o.licenceProduct && o.licenceProduct === licence!.productId,
  );
  if (!offer) throw new AppError('licence.other_product', 422, 'This key is not for a Pono plan.');

  const payment = `${deps.licences.id}:${licence.id}`;
  const owner = (
    await deps.pool.query<{ owner: string | null }>('SELECT licence_owner($1) AS owner', [payment])
  ).rows[0]?.owner;
  if (owner && owner !== actor.organizationId)
    throw new AppError('licence.used', 409, 'This licence is already used by another workshop.');
  if (owner) return { plan: offer.plan, days: 0, until: null, already: true };

  if (licence.status === 'pending_activation')
    licence = await deps.licences.activate(apiKey, key, `pono-${actor.organizationId}`);
  if (!licence.usable)
    throw new AppError('licence.inactive', 409, 'This licence is expired or revoked.', {
      status: licence.status,
    });
  const days = licence.expiresAt
    ? Math.max(1, Math.ceil((licence.expiresAt.getTime() - deps.now().getTime()) / DAY))
    : offer.licenceDays;
  await deps.pool.query('SELECT pay_organization_plan($1, $2, $3, $4, $5)', [
    actor.organizationId,
    offer.plan,
    null,
    payment,
    days,
  ]);
  const until = await withOrganization(deps.pool, actor.organizationId, async (client) => {
    const { rows } = await client.query<{ until: Date | null }>(
      'SELECT plan_paid_until AS until FROM organizations',
    );
    return rows[0]?.until?.toISOString() ?? null;
  });
  return { plan: offer.plan, days, until, already: false };
}
