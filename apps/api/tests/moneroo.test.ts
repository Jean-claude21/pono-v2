import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import {
  monerooBilling,
  PAID_DAYS,
  verifyMonerooSignature,
} from '../src/infrastructure/providers/moneroo.js';
import { createPool, type Pool } from '../src/platform/db.js';
import type { Fetch } from '../src/platform/http.js';
import { call, signIn, testApp, type TestApp } from './support/app.js';

let t: TestApp;
let owner: Pool;
beforeAll(() => {
  t = testApp();
  owner = createPool(inject('ownerUrl'));
});
afterAll(async () => {
  await t.pool.end();
  await owner.end();
});

const SECRET = 'moneroo-webhook-test';
const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');

/** A Moneroo that answers initialize and verify from a table of payments. */
function fakeMoneroo(payments: Record<string, unknown>) {
  const sent: { url: string; body: unknown }[] = [];
  const fetch: Fetch = async (url, init) => {
    const u = String(url);
    sent.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (u.endsWith('/payments/initialize'))
      return Response.json(
        { data: { id: 'pay_1', checkout_url: 'https://checkout.moneroo.io/pay_1' } },
        { status: 201 },
      );
    const id = /payments\/([^/]+)\/verify$/.exec(u)?.[1];
    if (id && payments[id]) return Response.json({ data: payments[id] });
    return new Response('{}', { status: 404 });
  };
  return { fetch, sent };
}

describe('Moneroo (D-023)', () => {
  it('starts a payment with the plan price, the person and the organization', async () => {
    const m = fakeMoneroo({});
    const billing = monerooBilling({ secretKey: 'sk', webhookSecret: SECRET, fetch: m.fetch });
    const url = await billing.checkout({
      organizationId: 'org-1',
      plan: 'pro',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      returnUrl: 'https://pono.test/settings',
    });
    expect(url).toBe('https://checkout.moneroo.io/pay_1');
    expect(m.sent[0]!.body).toMatchObject({
      amount: 39,
      currency: 'USD',
      return_url: 'https://pono.test/settings?plan=paid',
      customer: { email: 'ada@example.com', first_name: 'Ada', last_name: 'Lovelace' },
      metadata: { organization: 'org-1', plan: 'pro' },
    });
    await expect(
      billing.checkout({
        organizationId: 'org-1',
        plan: 'solo',
        email: null,
        name: null,
        returnUrl: 'https://pono.test/settings',
      }),
    ).rejects.toThrow(/email/);
  });

  it('trusts the payment read again at Moneroo, never the webhook body alone', async () => {
    const paid = {
      id: 'pay_ok',
      status: 'success',
      amount: 12,
      currency: { code: 'USD' },
      metadata: { organization: 'org-2', plan: 'solo' },
      customer: { email: 'ada@example.com' },
    };
    const m = fakeMoneroo({
      pay_ok: paid,
      pay_low: { ...paid, id: 'pay_low', amount: 1 },
      pay_failed: { ...paid, id: 'pay_failed', status: 'failed' },
    });
    const billing = monerooBilling({ secretKey: 'sk', webhookSecret: SECRET, fetch: m.fetch });
    const event = (id: string, name = 'payment.success') =>
      JSON.stringify({ event: name, data: { id, status: 'success' } });

    expect(await billing.event(event('pay_ok'), sign(event('pay_ok')))).toEqual({
      organizationId: 'org-2',
      plan: 'solo',
      customer: 'ada@example.com',
      payment: { id: 'pay_ok', days: PAID_DAYS },
    });
    expect(await billing.event(event('pay_low'), sign(event('pay_low')))).toBeNull();
    expect(await billing.event(event('pay_failed'), sign(event('pay_failed')))).toBeNull();
    const failed = event('pay_ok', 'payment.failed');
    expect(await billing.event(failed, sign(failed))).toBeNull();
    await expect(billing.event(event('pay_ok'), 'forged')).rejects.toThrow();
    expect(verifyMonerooSignature('{}', sign('{}').toUpperCase(), SECRET)).toBe(true);
  });

  it('counts a payment once, extends the period, and ends it on the free plan', async () => {
    const cookie = await signIn(t, `m${randomUUID().slice(0, 8)}`);
    const org = (await (await call(t, cookie, '/v1/me')).json()).organization.id as string;
    const pay = (id: string) =>
      t.pool.query('SELECT pay_organization_plan($1, $2, $3, $4, $5)', [
        org,
        'solo',
        null,
        id,
        PAID_DAYS,
      ]);
    const until = async () =>
      (
        await owner.query<{ plan: string; days: number }>(
          'SELECT plan, round(extract(epoch FROM plan_paid_until - now()) / 86400)::int AS days FROM organizations WHERE id = $1',
          [org],
        )
      ).rows[0]!;

    const id = `pay_${randomUUID()}`;
    await pay(id);
    await pay(id); // the provider retries: still one period
    expect(await until()).toEqual({ plan: 'solo', days: PAID_DAYS });
    await pay(`pay_${randomUUID()}`);
    expect((await until()).days).toBe(PAID_DAYS * 2);
    expect((await (await call(t, cookie, '/v1/plan')).json()).plan).toBe('solo');

    await owner.query(
      "UPDATE organizations SET plan_paid_until = now() - interval '1 minute' WHERE id = $1",
      [org],
    );
    await t.pool.query('SELECT expire_paid_plans()');
    expect((await (await call(t, cookie, '/v1/plan')).json()).plan).toBe('free');
  });
});
