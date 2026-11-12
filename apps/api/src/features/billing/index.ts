import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../platform/context.js';
import { withOrganization, type Pool } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { PLANS, planOf, type Plan } from '../servers/index.js';

/** Where a plan is paid. The id is an opaque adapter id. */
export interface BillingProvider {
  readonly id: string;
  /** Where to send the person to pay for `plan`; null when the plan is free. */
  checkout(input: {
    organizationId: string;
    plan: Exclude<Plan, 'free'>;
    email: string | null;
    returnUrl: string;
  }): Promise<string>;
  /** A provider event, verified; null when it is not about a plan. Throws when the signature is wrong. */
  event(
    rawBody: string,
    signature: string | undefined,
  ): Promise<{ organizationId: string; plan: Plan; customer: string | null } | null>;
}

export interface BillingDeps {
  pool: Pool;
  billing: BillingProvider;
  publicUrl: string;
}

/** `/v1/plan`: the plan, its limits, and the way to change it (phase 7). */
export function planRoutes(deps: BillingDeps): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .get('/', async (c) => {
      const plan = await withOrganization(deps.pool, c.var.actor.organizationId, planOf);
      return c.json({
        plan,
        provider: deps.billing.id,
        plans: Object.entries(PLANS).map(([id, p]) => ({
          id,
          activeServers: p.activeServers,
          priceMicros: p.priceMicros,
        })),
      });
    })
    .post('/checkout', async (c) => {
      const actor = c.var.actor;
      if (actor.channel !== 'console')
        throw new AppError('plan.person_only', 403, 'Only a person changes the plan.');
      const body = z
        .object({ plan: z.enum(['solo', 'pro']) })
        .safeParse(await c.req.json().catch(() => null));
      if (!body.success) throw new AppError('request.invalid', 400, 'Expected a paid plan.');
      const url = await deps.billing.checkout({
        organizationId: actor.organizationId,
        plan: body.data.plan,
        email: null,
        returnUrl: `${deps.publicUrl}/settings`,
      });
      return c.json({ url });
    });
}

/** `/billing/webhook`: the provider says a plan was paid or ended; nothing else changes a plan. */
export function billingWebhook(deps: BillingDeps): Hono<AppEnv> {
  return new Hono<AppEnv>().post('/webhook', async (c) => {
    const raw = await c.req.text();
    let event;
    try {
      event = await deps.billing.event(
        raw,
        c.req.header('stripe-signature') ?? c.req.header('x-pono-signature'),
      );
    } catch {
      throw new AppError(
        'billing.bad_signature',
        400,
        'This event is not signed by the billing provider.',
      );
    }
    if (event)
      await deps.pool.query('SELECT set_organization_plan($1, $2, $3)', [
        event.organizationId,
        event.plan,
        event.customer,
      ]);
    return c.json({ received: true });
  });
}
