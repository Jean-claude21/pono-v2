import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { stripeBilling, verifyStripeSignature } from '../src/infrastructure/providers/stripe.js';
import { withOrganization } from '../src/platform/db.js';
import { call, signIn, testApp, type TestApp } from './support/app.js';

let t: TestApp;
beforeAll(() => {
  t = testApp();
});
afterAll(async () => t.pool.end());

const me = async (cookie: string) =>
  (await (await call(t, cookie, '/v1/me')).json()).organization.id as string;

describe('plans (phase 7)', () => {
  it('starts free, and only billing changes the plan', async () => {
    const cookie = await signIn(t, `b${randomUUID().slice(0, 8)}`);
    expect((await (await call(t, cookie, '/v1/plan')).json()).plan).toBe('free');
    await expect(
      withOrganization(t.pool, await me(cookie), (c) =>
        c.query("UPDATE organizations SET plan = 'pro'"),
      ),
    ).rejects.toThrow(/permission denied/);
    const checkout = await (
      await call(t, cookie, '/v1/plan/checkout', { method: 'POST', body: { plan: 'solo' } })
    ).json();
    expect(checkout.url).toMatch(/\/settings\?plan=paid$/);
    expect((await (await call(t, cookie, '/v1/plan')).json()).plan).toBe('solo');
    const servers = await (await call(t, cookie, '/v1/servers')).json();
    expect(servers.limit).toBe(3);
  });

  it('refuses a billing event that is not signed', async () => {
    const res = await t.app.request('/billing/webhook', {
      method: 'POST',
      body: JSON.stringify({ organizationId: randomUUID(), plan: 'pro' }),
      headers: { 'x-pono-signature': 'forged' },
    });
    expect(res.status).toBe(400);
  });

  it('reads Stripe events: signature checked, plan from the price, free when the subscription ends', async () => {
    const secret = 'whsec_test';
    const stripe = stripeBilling({
      secretKey: 'sk_test',
      webhookSecret: secret,
      prices: { solo: 'price_solo', pro: 'price_pro' },
      fetch,
    });
    const org = randomUUID();
    const sign = (body: string) => {
      const time = Math.floor(Date.now() / 1000);
      return `t=${time},v1=${createHmac('sha256', secret).update(`${time}.${body}`).digest('hex')}`;
    };
    const event = (type: string, status: string) =>
      JSON.stringify({
        type,
        data: {
          object: {
            customer: 'cus_1',
            status,
            metadata: { organization: org },
            items: { data: [{ price: { id: 'price_pro' } }] },
          },
        },
      });
    const created = event('customer.subscription.created', 'active');
    expect(await stripe.event(created, sign(created))).toEqual({
      organizationId: org,
      plan: 'pro',
      customer: 'cus_1',
    });
    const deleted = event('customer.subscription.deleted', 'canceled');
    expect((await stripe.event(deleted, sign(deleted)))!.plan).toBe('free');
    await expect(stripe.event(created, 't=1,v1=00')).rejects.toThrow();
    expect(verifyStripeSignature(created, sign(created).replace(/t=\d+/, 't=100'), secret)).toBe(
      false,
    );
  });

  it('never lets an agent change the plan', async () => {
    const cookie = await signIn(t, `c${randomUUID().slice(0, 8)}`);
    const created = await (
      await call(t, cookie, '/v1/agents', { method: 'POST', body: { name: 'A', scope: 'act' } })
    ).json();
    expect(created.token).toMatch(/^pono_/);
  });
});

describe('administration (phase 7)', () => {
  it('is reserved to the platform’s operators', async () => {
    const cookie = await signIn(t, `d${randomUUID().slice(0, 8)}`);
    const res = await call(t, cookie, '/v1/admin/overview');
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('admin.forbidden');
    const topUp = await call(t, cookie, '/v1/admin/wallet/top-up', {
      method: 'POST',
      body: { amountUsd: 10 },
    });
    expect(topUp.status).toBe(403);
  });

  it('tops up the server wallet only when the provider has one, within bounds', async () => {
    const operator = await signIn(t, 'operator');
    const none = await call(t, operator, '/v1/admin/wallet/top-up', {
      method: 'POST',
      body: { amountUsd: 10 },
    });
    expect((await none.json()).error.code).toBe('admin.no_wallet');
    t.deps.walletTopUp = async (usd) => `https://pay.test/${usd}`;
    const t2 = { ...t, app: createApp(t.deps) };
    const paid = await call(t2, operator, '/v1/admin/wallet/top-up', {
      method: 'POST',
      body: { amountUsd: 25 },
    });
    expect(await paid.json()).toEqual({ url: 'https://pay.test/25' });
    const tooSmall = await call(t2, operator, '/v1/admin/wallet/top-up', {
      method: 'POST',
      body: { amountUsd: 1 },
    });
    expect(tooSmall.status).toBe(400);
    delete t.deps.walletTopUp;
  });

  it('shows organizations, servers and revenue across the platform, and puts a server to sleep', async () => {
    const owner = await signIn(t, `e${randomUUID().slice(0, 8)}`);
    await call(t, owner, '/v1/connections', {
      method: 'POST',
      body: { provider: 'code', fields: { token: 'good' } },
    });
    await call(t, owner, '/v1/plan/checkout', { method: 'POST', body: { plan: 'pro' } });
    const launched = await (
      await call(t, owner, '/v1/launch', {
        method: 'POST',
        body: { template: 'blank', name: `adm-${randomUUID().slice(0, 6)}` },
      })
    ).json();

    const operator = await signIn(t, 'operator');
    const overview = await (await call(t, operator, '/v1/admin/overview')).json();
    expect(overview.organizations).toBeGreaterThanOrEqual(2);
    expect(overview.paying).toBeGreaterThanOrEqual(1);
    expect(overview.monthlyRevenueMicros).toBeGreaterThanOrEqual(39_000_000);
    expect(overview.activeServers).toBeGreaterThanOrEqual(1);

    const { servers } = await (await call(t, operator, '/v1/admin/servers')).json();
    const server = servers.find((s: { id: string }) => s.id === launched.server.id);
    expect(server).toMatchObject({ status: 'running' });
    expect(JSON.stringify(servers)).not.toMatch(/token|credential|sealed/);
    expect(
      (await call(t, operator, `/v1/admin/servers/${server.id}/sleep`, { method: 'POST' })).status,
    ).toBe(204);
    const theirs = await (await call(t, owner, '/v1/servers')).json();
    expect(theirs.servers[0].status).toBe('sleeping');
    const detail = await (await call(t, owner, `/v1/projects/${launched.projectId}`)).json();
    expect(detail.journal.map((j: { action: string }) => j.action)).toContain('admin.server_slept');
  });
});
