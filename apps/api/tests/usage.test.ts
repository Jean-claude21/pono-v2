import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alertsFor, monthTotal, type Reading } from '../src/features/usage/index.js';
import { call, signIn, testApp, type TestApp } from './support/app.js';

const base = (over: Partial<Reading>): Reading => ({
  provider: 'host',
  meter: 'hosting.bandwidth',
  subject: '',
  used: 10,
  quota: 100,
  unit: 'GB',
  costMicros: 0,
  source: 'measured',
  reason: null,
  periodStart: null,
  periodEnd: null,
  ...over,
});

describe('usage rules (D-005)', () => {
  it('adds declared subscriptions brought to a month, and costs, by source', () => {
    const total = monthTotal(
      [
        { priceMicros: 100_000_000, cycle: 'month', renewsOn: null },
        { priceMicros: 120_000_000, cycle: 'year', renewsOn: null },
      ],
      [
        base({ costMicros: 7_120_000, source: 'estimated' }),
        base({ costMicros: 4_000_000 }),
        base({ source: 'unavailable', used: null, costMicros: null }),
      ],
    );
    expect(total.bySource).toEqual({
      declared: 110_000_000,
      estimated: 7_120_000,
      measured: 4_000_000,
    });
    expect(total.totalMicros).toBe(121_120_000);
    expect(total.unavailable).toBe(1);
  });

  it('opens a quota alert from 80 %, critical from 95 %, and a renewal within 7 days', () => {
    const now = new Date('2026-11-12T00:00:00Z');
    const alerts = alertsFor(
      [
        base({ used: 79 }),
        base({ meter: 'a', used: 80 }),
        base({ meter: 'b', used: 97 }),
        base({ meter: 'c', used: null, source: 'unavailable' }),
      ],
      [
        {
          id: 's1',
          service: 'Claude',
          priceMicros: 1,
          cycle: 'month',
          renewsOn: new Date('2026-11-18T00:00:00Z'),
        },
        {
          id: 's2',
          service: 'Domain',
          priceMicros: 1,
          cycle: 'year',
          renewsOn: new Date('2026-12-30T00:00:00Z'),
        },
      ],
      now,
    );
    expect(alerts.map((a) => [a.key, a.level])).toEqual([
      ['quota:host:a:', 'warn'],
      ['quota:host:b:', 'bad'],
      ['renewal:s1', 'warn'],
    ]);
  });
});

describe('usage through the API', () => {
  let t: TestApp;
  let cookie: string;
  beforeAll(async () => {
    t = testApp();
    cookie = await signIn(t, `u${randomUUID().slice(0, 8)}`);
    await call(t, cookie, '/v1/connections', {
      method: 'POST',
      body: { provider: 'host', fields: { token: 'good' } },
    });
  });
  afterAll(async () => t.pool.end());

  it('reads the provider, keeps the readings and opens an alert at 90 %', async () => {
    t.world.usage = [base({ used: 90 })];
    const res = await call(t, cookie, '/v1/usage/refresh', { method: 'POST' });
    expect(res.status).toBe(200);
    const usage = await (await call(t, cookie, '/v1/usage')).json();
    expect(usage.readings).toHaveLength(1);
    expect(usage.readings[0]).toMatchObject({ used: 90, quota: 100, source: 'measured' });
    expect(usage.alerts.map((a: { key: string; level: string }) => [a.key, a.level])).toEqual([
      ['quota:host:hosting.bandwidth:', 'warn'],
    ]);
  });

  it('resolves the alert when the meter goes back down, and does not open it twice', async () => {
    t.world.usage = [base({ used: 92 })];
    await call(t, cookie, '/v1/usage/refresh', { method: 'POST' });
    expect((await (await call(t, cookie, '/v1/usage')).json()).alerts).toHaveLength(1);
    t.world.usage = [base({ used: 20 })];
    await call(t, cookie, '/v1/usage/refresh', { method: 'POST' });
    expect((await (await call(t, cookie, '/v1/usage')).json()).alerts).toEqual([]);
  });

  it('writes an unreadable figure as unavailable, never as zero (SC-002)', async () => {
    t.world.usage = null;
    await call(t, cookie, '/v1/usage/refresh', { method: 'POST' });
    const usage = await (await call(t, cookie, '/v1/usage')).json();
    const account = usage.readings.find((r: Reading) => r.meter === 'account');
    expect(account).toMatchObject({ source: 'unavailable', reason: 'permission', used: null });
    expect(usage.total.unavailable).toBe(1);
  });

  it('counts a declared subscription in the month, and ends it', async () => {
    const renewsOn = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const res = await call(t, cookie, '/v1/subscriptions', {
      method: 'POST',
      body: { service: 'Claude Max', priceUsd: 100, cycle: 'month', renewsOn },
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    let usage = await (await call(t, cookie, '/v1/usage')).json();
    expect(usage.total.bySource.declared).toBe(100_000_000);
    expect(usage.alerts.some((a: { kind: string }) => a.kind === 'renewal')).toBe(true);
    expect((await call(t, cookie, `/v1/subscriptions/${id}`, { method: 'DELETE' })).status).toBe(
      204,
    );
    usage = await (await call(t, cookie, '/v1/usage')).json();
    expect(usage.total.bySource.declared).toBe(0);
    expect(usage.alerts.some((a: { kind: string }) => a.kind === 'renewal')).toBe(false);
  });

  it('refuses a subscription without a price', async () => {
    const res = await call(t, cookie, '/v1/subscriptions', {
      method: 'POST',
      body: { service: 'X', cycle: 'month' },
    });
    expect(res.status).toBe(400);
  });
});
