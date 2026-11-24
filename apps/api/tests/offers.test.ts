import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, signIn, testApp, type TestApp } from './support/app.js';

let t: TestApp;
let operator: string;
beforeAll(async () => {
  t = testApp();
  operator = await signIn(t, 'operator');
});
afterAll(async () => {
  // Offers and settings are the platform's: put back what other test files expect.
  await call(t, operator, '/v1/admin/offers/pro', {
    method: 'PUT',
    body: { availability: 'available', priceMicros: 39_000_000, activeServers: 10 },
  });
  await call(t, operator, '/v1/admin/offers/solo', {
    method: 'PUT',
    body: { availability: 'available', priceMicros: 12_000_000, activeServers: 3 },
  });
  for (const key of ['chariow.api_key', 'chariow.pulse_secret', 'sales.contact_url'])
    await call(t, operator, `/v1/admin/settings/${key}`, { method: 'PUT', body: { value: '' } });
  await t.pool.end();
});

describe('offers set by the operator (D-041)', () => {
  it('changes a price, says « on request » without a price, and refuses to sell it', async () => {
    const person = await signIn(t, `o${randomUUID().slice(0, 8)}`);
    expect(
      (await call(t, person, '/v1/admin/offers/pro', { method: 'PUT', body: {} })).status,
    ).toBe(403);

    await call(t, operator, '/v1/admin/settings/sales.contact_url', {
      method: 'PUT',
      body: { value: 'mailto:sales@pono.test' },
    });
    const set = await call(t, operator, '/v1/admin/offers/pro', {
      method: 'PUT',
      body: { availability: 'on_request', priceMicros: 49_000_000, activeServers: 12 },
    });
    expect(set.status).toBe(200);

    // Signed out: the landing reads the offers, never a price on request.
    const pub = (await (await t.app.request('/v1/offers')).json()) as {
      offers: { plan: string }[];
    };
    expect(pub.offers.find((o: { plan: string }) => o.plan === 'pro')).toEqual({
      plan: 'pro',
      availability: 'on_request',
      priceMicros: null,
      activeServers: 12,
      contactUrl: 'mailto:sales@pono.test',
    });

    const plan = await (await call(t, person, '/v1/plan')).json();
    expect(plan.plans.find((p: { id: string }) => p.id === 'pro')).toMatchObject({
      availability: 'on_request',
      activeServers: 12,
    });
    const checkout = await call(t, person, '/v1/plan/checkout', {
      method: 'POST',
      body: { plan: 'pro' },
    });
    expect(checkout.status).toBe(409);
    expect((await checkout.json()).error.code).toBe('plan.not_for_sale');
  });

  it('keeps the free plan free, and its servers count from the offer', async () => {
    await call(t, operator, '/v1/admin/offers/free', {
      method: 'PUT',
      body: { availability: 'coming_soon', priceMicros: 5_000_000, activeServers: 1 },
    });
    const free = ((await (await t.app.request('/v1/offers')).json()) as { offers: unknown[] })
      .offers[0];
    expect(free).toMatchObject({ plan: 'free', availability: 'available', priceMicros: 0 });
  });
});

describe('the operator settings (D-041)', () => {
  it('checks a store key before keeping it, seals it, and never sends it back', async () => {
    const refused = await call(t, operator, '/v1/admin/settings/chariow.api_key', {
      method: 'PUT',
      body: { value: 'wrong-key' },
    });
    expect(refused.status).toBe(422);
    const kept = await call(t, operator, '/v1/admin/settings/chariow.api_key', {
      method: 'PUT',
      body: { value: 'store-key' },
    });
    expect(kept.status).toBe(204);
    const { settings } = await (await call(t, operator, '/v1/admin/settings')).json();
    const key = settings.find((s: { key: string }) => s.key === 'chariow.api_key');
    expect(key).toMatchObject({ set: true, secret: true, from: 'console', value: '…-key' });
    expect(JSON.stringify(settings)).not.toContain('store-key');
    const sealed = await t.pool.query<{ value: string }>(
      "SELECT value FROM platform_setting('chariow.api_key')",
    );
    expect(sealed.rows[0]!.value).not.toContain('store-key');

    const products = await (await call(t, operator, '/v1/admin/licence-products')).json();
    expect(products.products[0]).toMatchObject({ id: 'prd_solo', licence: true });
  });
});

describe('a plan bought as a licence key (D-041)', () => {
  it('activates the key once for the workshop, counts its days, and refuses it elsewhere', async () => {
    await call(t, operator, '/v1/admin/settings/chariow.api_key', {
      method: 'PUT',
      body: { value: 'store-key' },
    });
    await call(t, operator, '/v1/admin/offers/solo', {
      method: 'PUT',
      body: {
        availability: 'available',
        priceMicros: 12_000_000,
        activeServers: 3,
        licenceProduct: 'prd_solo',
        licenceDays: 30,
      },
    });
    const key = `KEY-${randomUUID().slice(0, 8)}`;
    t.world.licences.set(key, {
      id: `lic_${randomUUID().slice(0, 8)}`,
      status: 'pending_activation',
      productId: 'prd_solo',
      usable: false,
      expiresAt: null,
    });
    const ada = await signIn(t, `a${randomUUID().slice(0, 8)}`);
    expect((await (await call(t, ada, '/v1/plan')).json()).plans[1].byLicence).toBe(true);

    const unknown = await call(t, ada, '/v1/plan/licence', {
      method: 'POST',
      body: { key: 'NOPE-0000' },
    });
    expect((await unknown.json()).error.code).toBe('licence.unknown');

    const redeemed = await call(t, ada, '/v1/plan/licence', { method: 'POST', body: { key } });
    expect(redeemed.status).toBe(200);
    expect(await redeemed.json()).toMatchObject({ plan: 'solo', days: 30, already: false });
    expect(t.world.activations.filter((a) => a.startsWith(key))).toHaveLength(1);
    expect((await (await call(t, ada, '/v1/plan')).json()).plan).toBe('solo');

    // Entered again in the same workshop: nothing more; in another: refused.
    const again = await (
      await call(t, ada, '/v1/plan/licence', { method: 'POST', body: { key } })
    ).json();
    expect(again).toMatchObject({ already: true, days: 0 });
    const bob = await signIn(t, `b${randomUUID().slice(0, 8)}`);
    const stolen = await call(t, bob, '/v1/plan/licence', { method: 'POST', body: { key } });
    expect(stolen.status).toBe(409);
    expect((await stolen.json()).error.code).toBe('licence.used');
    expect((await (await call(t, bob, '/v1/plan')).json()).plan).toBe('free');
  });

  it('refuses a revoked licence and a key for another product', async () => {
    const revoked = `REV-${randomUUID().slice(0, 8)}`;
    t.world.licences.set(revoked, {
      id: `lic_${randomUUID().slice(0, 8)}`,
      status: 'revoked',
      productId: 'prd_solo',
      usable: false,
      expiresAt: null,
    });
    const other = `OTH-${randomUUID().slice(0, 8)}`;
    t.world.licences.set(other, {
      id: `lic_${randomUUID().slice(0, 8)}`,
      status: 'active',
      productId: 'prd_ebook',
      usable: true,
      expiresAt: null,
    });
    const cat = await signIn(t, `c${randomUUID().slice(0, 8)}`);
    const code = async (key: string) =>
      (await (await call(t, cat, '/v1/plan/licence', { method: 'POST', body: { key } })).json())
        .error?.code;
    expect(await code(revoked)).toBe('licence.inactive');
    expect(await code(other)).toBe('licence.other_product');
  });
});

describe('a plan bought at the store, turned on by its Pulse (D-043)', () => {
  const SECRET = 'whsec_test';
  const pulse = async (body: unknown, delivery: string, secret = SECRET) => {
    const raw = JSON.stringify(body);
    const { createHmac } = await import('node:crypto');
    const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    return t.app.request('/billing/chariow', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-chariow-signature': signature,
        'x-pulse-delivery-id': delivery,
      },
      body: raw,
    });
  };

  it('sends the person to the store, then activates the licence the sale issued', async () => {
    for (const [key, value] of [
      ['chariow.api_key', 'store-key'],
      ['chariow.pulse_secret', SECRET],
    ])
      await call(t, operator, `/v1/admin/settings/${key}`, { method: 'PUT', body: { value } });
    await call(t, operator, '/v1/admin/offers/solo', {
      method: 'PUT',
      body: {
        availability: 'available',
        priceMicros: 12_000_000,
        activeServers: 3,
        licenceProduct: 'prd_solo',
        licenceDays: 30,
      },
    });
    const login = `d${randomUUID().slice(0, 8)}`;
    const dana = await signIn(t, login);
    const org = (await (await call(t, dana, '/v1/me')).json()).organization.id as string;

    const noPhone = await call(t, dana, '/v1/plan/checkout', {
      method: 'POST',
      body: { plan: 'solo' },
    });
    expect((await noPhone.json()).error.code).toBe('plan.phone_needed');
    const checkout = await call(t, dana, '/v1/plan/checkout', {
      method: 'POST',
      body: { plan: 'solo', phone: '+225 07 00 00 00 00', country: 'ci' },
    });
    expect((await checkout.json()).url).toBe('https://store.test/pay/prd_solo');
    expect(t.world.checkouts.at(-1)).toMatchObject({
      productId: 'prd_solo',
      buyer: { email: `${login}@dev.pono.test`, phone: '2250700000000', country: 'CI' },
      metadata: { pono_organization: org, pono_plan: 'solo' },
    });

    // The store: the sale completed, its licence issued to the buyer.
    const sale = `sal_${randomUUID().slice(0, 8)}`;
    const key = `BUY-${randomUUID().slice(0, 8)}`;
    t.world.sales.set(sale, {
      id: sale,
      status: 'completed',
      productId: 'prd_solo',
      customerEmail: `${login}@dev.pono.test`,
    });
    t.world.licences.set(key, {
      id: `lic_${randomUUID().slice(0, 8)}`,
      status: 'pending_activation',
      productId: 'prd_solo',
      usable: false,
      expiresAt: null,
      customerEmail: `${login}@dev.pono.test`,
    });
    const event = {
      event: 'successful.sale',
      sale: { id: sale, custom_metadata: { pono_organization: org, pono_plan: 'solo' } },
    };
    expect((await pulse(event, 'dlv-forged', 'whsec_wrong')).status).toBe(401);
    const first = await pulse(event, `dlv-${sale}`);
    expect(await first.json()).toMatchObject({ result: 'granted' });
    expect(t.world.activations).toContain(`${key}@pono-${org}`);
    expect((await (await call(t, dana, '/v1/plan')).json()).plan).toBe('solo');

    // A retry of the delivery, another Pulse for the same sale, the key typed by hand: no more days.
    expect(await (await pulse(event, `dlv-${sale}`)).json()).toMatchObject({ result: 'duplicate' });
    expect(await (await pulse(event, `dlv2-${sale}`)).json()).toMatchObject({
      result: 'duplicate',
    });
    const typed = await (
      await call(t, dana, '/v1/plan/licence', { method: 'POST', body: { key } })
    ).json();
    expect(typed).toMatchObject({ already: true, days: 0 });
  });

  it('trusts the store, not the body: an unpaid sale turns nothing on', async () => {
    const eve = await signIn(t, `e${randomUUID().slice(0, 8)}`);
    const org = (await (await call(t, eve, '/v1/me')).json()).organization.id as string;
    const sale = `sal_${randomUUID().slice(0, 8)}`;
    t.world.sales.set(sale, {
      id: sale,
      status: 'awaiting_payment',
      productId: 'prd_solo',
      customerEmail: 'eve@example.test',
    });
    const answer = await pulse(
      { event: 'successful.sale', sale: { id: sale, custom_metadata: { pono_organization: org } } },
      `dlv-${sale}`,
    );
    expect(await answer.json()).toMatchObject({ result: 'ignored' });
    expect((await (await call(t, eve, '/v1/plan')).json()).plan).toBe('free');
  });

  it('starts the plan for its days when the paid sale has no licence listed yet', async () => {
    const fay = await signIn(t, `f${randomUUID().slice(0, 8)}`);
    const org = (await (await call(t, fay, '/v1/me')).json()).organization.id as string;
    const sale = `sal_${randomUUID().slice(0, 8)}`;
    t.world.sales.set(sale, {
      id: sale,
      status: 'settled',
      productId: 'prd_solo',
      customerEmail: 'nobody-yet@example.test',
    });
    const answer = await pulse(
      { event: 'successful.sale', sale: { id: sale, custom_metadata: { pono_organization: org } } },
      `dlv-${sale}`,
    );
    expect(await answer.json()).toMatchObject({ result: 'pending' });
    expect((await (await call(t, fay, '/v1/plan')).json()).plan).toBe('solo');
  });
});
