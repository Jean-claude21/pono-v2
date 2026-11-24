import { Hono } from 'hono';
import type { AppEnv } from '../../platform/context.js';
import type { Pool } from '../../platform/db.js';
import type { Sealer } from '../../platform/secrets.js';
import type { Plan } from '../servers/domain.js';

/**
 * The plans as the operator sells them (D-041): a price, servers awake at once, and whether the plan
 * is sold now, coming soon or on request. Read by the landing, the console and every limit.
 */
export type Availability = 'available' | 'coming_soon' | 'on_request';

export interface Offer {
  plan: Plan;
  availability: Availability;
  priceMicros: number;
  activeServers: number;
  /** The licence product that sells this plan (Chariow), when there is one. */
  licenceProduct: string | null;
  /** The days a licence without its own end buys. */
  licenceDays: number;
}

interface OfferRow {
  plan: Plan;
  availability: Availability;
  price_micros: string;
  active_servers: number;
  licence_product: string | null;
  licence_days: number;
}

type Queryable = Pick<Pool, 'query'>;

export const PLAN_ORDER: Plan[] = ['free', 'solo', 'pro'];

export async function readOffers(db: Queryable): Promise<Offer[]> {
  const { rows } = await db.query<OfferRow>(
    'SELECT plan, availability, price_micros, active_servers, licence_product, licence_days FROM plan_offers',
  );
  return rows
    .map((r) => ({
      plan: r.plan,
      availability: r.availability,
      priceMicros: Number(r.price_micros),
      activeServers: r.active_servers,
      licenceProduct: r.licence_product,
      licenceDays: r.licence_days,
    }))
    .sort((a, b) => PLAN_ORDER.indexOf(a.plan) - PLAN_ORDER.indexOf(b.plan));
}

export async function offerOf(db: Queryable, plan: Plan): Promise<Offer> {
  const offer = (await readOffers(db)).find((o) => o.plan === plan);
  if (!offer) throw new Error(`No offer for plan ${plan}.`);
  return offer;
}

/** The public face of an offer: never the licence product's id. */
export function publicOffer(o: Offer, contactUrl: string | null) {
  return {
    plan: o.plan,
    availability: o.availability,
    priceMicros: o.availability === 'available' || o.plan === 'free' ? o.priceMicros : null,
    activeServers: o.activeServers,
    contactUrl: o.availability === 'on_request' ? contactUrl : null,
  };
}

/** The operator's settings (D-041): what the console sets, the environment's value otherwise. */
export const SETTINGS = {
  'chariow.api_key': { sealed: true, env: 'CHARIOW_API_KEY' },
  'chariow.pulse_secret': { sealed: true, env: 'CHARIOW_PULSE_SECRET' },
  'chariow.store_url': { sealed: false, env: 'CHARIOW_STORE_URL' },
  'sales.contact_url': { sealed: false, env: 'PONO_SALES_CONTACT_URL' },
} as const;
export type SettingKey = keyof typeof SETTINGS;

export interface SettingsDeps {
  pool: Pool;
  sealer: Sealer;
  /** Values from the environment, the fallback of each setting. */
  settingsEnv?: Partial<Record<string, string>>;
}

export async function setting(deps: SettingsDeps, key: SettingKey): Promise<string | null> {
  const { rows } = await deps.pool.query<{ value: string; sealed: boolean }>(
    'SELECT value, sealed FROM platform_setting($1)',
    [key],
  );
  const row = rows[0];
  if (row) return row.sealed ? deps.sealer.open(row.value) : row.value;
  return deps.settingsEnv?.[SETTINGS[key].env] ?? null;
}

/** `/v1/offers`, read signed out: the landing shows the plans as they are sold. */
export function offerRoutes(deps: SettingsDeps): Hono<AppEnv> {
  return new Hono<AppEnv>().get('/', async (c) => {
    const contact = await setting(deps, 'sales.contact_url');
    return c.json({ offers: (await readOffers(deps.pool)).map((o) => publicOffer(o, contact)) });
  });
}
