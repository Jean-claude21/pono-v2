import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../platform/context.js';
import { withOrganization, type Pool } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import type { Sealer } from '../../platform/secrets.js';
import { readOffers, setting } from '../offers/index.js';
import { planOf, type Plan } from '../servers/index.js';
import { licenceCheckout, redeemLicence, storeEvent, type LicenceProvider } from './licences.js';

/** Where a plan is paid. The id is an opaque adapter id. */
export interface BillingProvider {
  readonly id: string;
  /** Where to send the person to pay for `plan`; null when the plan is free. */
  checkout(input: {
    organizationId: string;
    plan: Exclude<Plan, 'free'>;
    /** The price the operator set for the plan (D-041). */
    priceMicros: number;
    email: string | null;
    name: string | null;
    returnUrl: string;
  }): Promise<string>;
  /** A provider event, verified; null when it is not about a plan. Throws when the signature is wrong. */
  event(
    rawBody: string,
    signature: string | undefined,
  ): Promise<{
    organizationId: string;
    plan: Plan;
    customer: string | null;
    /** A one-off payment that buys `days` of the plan (D-023); absent for a subscription. */
    payment?: { id: string; days: number };
  } | null>;
}

export interface BillingDeps {
  pool: Pool;
  sealer: Sealer;
  billing: BillingProvider;
  /** Plans sold as licence keys (D-041), beside the payment page. */
  licences?: LicenceProvider;
  settingsEnv?: Partial<Record<string, string>>;
  publicUrl: string;
  now: () => Date;
}

/** `/v1/plan`: the plan, its limits, and the way to change it (phase 7). */
export function planRoutes(deps: BillingDeps): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .get('/', async (c) => {
      const plan = await withOrganization(deps.pool, c.var.actor.organizationId, planOf);
      const licences = Boolean(deps.licences && (await setting(deps, 'chariow.api_key')));
      return c.json({
        plan,
        provider: deps.billing.id,
        licences,
        storeUrl: licences ? await setting(deps, 'chariow.store_url') : null,
        contactUrl: await setting(deps, 'sales.contact_url'),
        plans: (await readOffers(deps.pool)).map((o) => ({
          id: o.plan,
          availability: o.availability,
          activeServers: o.activeServers,
          priceMicros: o.priceMicros,
          byLicence: licences && Boolean(o.licenceProduct),
        })),
      });
    })
    .post('/checkout', async (c) => {
      const actor = c.var.actor;
      if (actor.channel !== 'console')
        throw new AppError('plan.person_only', 403, 'Only a person changes the plan.');
      const body = z
        .object({
          plan: z.enum(['solo', 'pro']),
          // The store's payment page asks a phone (mobile money): given once here (D-043).
          phone: z
            .string()
            .trim()
            .regex(/^\+?[0-9 ]{6,20}$/)
            .optional(),
          country: z
            .string()
            .trim()
            .regex(/^[A-Za-z]{2}$/)
            .optional(),
        })
        .safeParse(await c.req.json().catch(() => null));
      if (!body.success) throw new AppError('request.invalid', 400, 'Expected a paid plan.');
      const offer = (await readOffers(deps.pool)).find((o) => o.plan === body.data.plan)!;
      if (offer.availability !== 'available')
        throw new AppError('plan.not_for_sale', 409, 'This plan is not sold yet.', {
          availability: offer.availability,
        });
      const email = await withOrganization(deps.pool, actor.organizationId, async (client) => {
        const { rows } = await client.query<{ email: string }>(
          'SELECT email FROM organization_recipients($1)',
          [actor.organizationId],
        );
        return rows[0]?.email ?? null;
      });
      // A plan tied to a licence product is paid at the store; the rest happens by its Pulse.
      if (offer.licenceProduct && deps.licences && (await setting(deps, 'chariow.api_key'))) {
        if (!email)
          throw new AppError('plan.email_needed', 409, 'Your account has no email address.');
        if (!body.data.phone || !body.data.country)
          throw new AppError('plan.phone_needed', 400, 'The payment page needs a phone number.');
        const [first, ...rest] = (actor.name ?? email.split('@')[0]!).trim().split(/\s+/);
        const url = await licenceCheckout(deps, {
          organizationId: actor.organizationId,
          offer,
          buyer: {
            email,
            firstName: first || email,
            lastName: rest.join(' ') || first || email,
            phone: body.data.phone.replace(/[^0-9]/g, ''),
            country: body.data.country.toUpperCase(),
          },
          returnUrl: `${deps.publicUrl}/settings?plan=paid`,
        });
        return c.json({ url });
      }
      const url = await deps.billing.checkout({
        organizationId: actor.organizationId,
        plan: body.data.plan,
        priceMicros: offer.priceMicros,
        email,
        name: actor.name,
        returnUrl: `${deps.publicUrl}/settings`,
      });
      return c.json({ url });
    })
    .post('/licence', async (c) => {
      const body = z
        .object({ key: z.string().trim().min(4).max(200) })
        .safeParse(await c.req.json().catch(() => null));
      if (!body.success) throw new AppError('request.invalid', 400, 'Expected a licence key.');
      return c.json(await redeemLicence(deps, c.var.actor, body.data.key));
    });
}

/** `/billing/webhook`: the provider says a plan was paid or ended; nothing else changes a plan. */
export function billingWebhook(deps: BillingDeps): Hono<AppEnv> {
  return (
    new Hono<AppEnv>()
      // The store's Pulses (D-043): a sale of a plan's licence product turns the plan on.
      .post('/chariow', async (c) => {
        const result = await storeEvent(deps, {
          rawBody: await c.req.text(),
          signature: c.req.header('x-chariow-signature'),
          delivery: c.req.header('x-pulse-delivery-id'),
        });
        return c.json({ received: true, result });
      })
      .post('/webhook', async (c) => {
        const raw = await c.req.text();
        let event;
        try {
          event = await deps.billing.event(
            raw,
            c.req.header('stripe-signature') ??
              c.req.header('x-moneroo-signature') ??
              c.req.header('x-pono-signature'),
          );
        } catch {
          throw new AppError(
            'billing.bad_signature',
            400,
            'This event is not signed by the billing provider.',
          );
        }
        if (event?.payment)
          // Once per payment, whatever the provider retries: the plan runs `days` more.
          await deps.pool.query('SELECT pay_organization_plan($1, $2, $3, $4, $5)', [
            event.organizationId,
            event.plan,
            event.customer,
            event.payment.id,
            event.payment.days,
          ]);
        else if (event)
          await deps.pool.query('SELECT set_organization_plan($1, $2, $3)', [
            event.organizationId,
            event.plan,
            event.customer,
          ]);
        return c.json({ received: true });
      })
  );
}
