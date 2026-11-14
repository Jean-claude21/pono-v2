import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  activeCredentials,
  decodeExpiring,
  encodeExpiring,
  setRefresher,
} from '../src/features/connections/index.js';
import { withOrganization } from '../src/platform/db.js';
import { call, signIn, testApp, type TestApp } from './support/app.js';

let t: TestApp;
beforeAll(() => {
  t = testApp();
});
afterEach(() => setRefresher('code', null));
afterAll(async () => t.pool.end());

const NOW = Date.UTC(2026, 10, 14, 12);

async function expiringConnection(expiresAt: number) {
  const cookie = await signIn(t, `r${randomUUID().slice(0, 8)}`);
  await call(t, cookie, '/v1/connections', {
    method: 'POST',
    body: { provider: 'code', fields: { token: 'good' } },
  });
  const me = await (await call(t, cookie, '/v1/me')).json();
  const org = me.organization.id as string;
  await withOrganization(t.pool, org, (c) =>
    c.query("UPDATE connections SET sealed_credential = $1 WHERE provider = 'code'", [
      t.deps.sealer.seal(encodeExpiring({ access: 'old', refresh: 'r1', expiresAt })),
    ]),
  );
  return org;
}

const open = (org: string) =>
  withOrganization(t.pool, org, (c) => activeCredentials(c, t.deps.sealer, 'code_host', () => NOW));

describe('credentials that expire (D-032)', () => {
  it('encodes and reads back an expiring pair; a bare token is not one', () => {
    const e = { access: 'a', refresh: 'r', expiresAt: 5 };
    expect(decodeExpiring(encodeExpiring(e))).toEqual(e);
    expect(decodeExpiring('ghp_plain')).toBeNull();
    expect(decodeExpiring('rt1:not-json')).toBeNull();
  });

  it('keeps a token far from its end, renews one close to it, and the refresh token turns', async () => {
    const calls: string[] = [];
    setRefresher('code', async (refresh) => {
      calls.push(refresh);
      return { access: 'new', refresh: 'r2', expiresAt: NOW + 8 * 3600_000 };
    });
    const fresh = await expiringConnection(NOW + 3600_000);
    expect((await open(fresh))[0]!.credential).toBe('old');
    expect(calls).toEqual([]);

    const ending = await expiringConnection(NOW + 60_000);
    expect((await open(ending))[0]!.credential).toBe('new');
    expect((await open(ending))[0]!.credential).toBe('new');
    expect(calls).toEqual(['r1']);
  });

  it('marks the connection expired when the renewal is refused after the end: the person signs in again', async () => {
    setRefresher('code', async () => {
      throw new Error('bad_refresh_token');
    });
    const org = await expiringConnection(NOW - 1000);
    expect(await open(org)).toEqual([]);
    const status = await withOrganization(t.pool, org, (c) =>
      c.query<{ status: string }>("SELECT status FROM connections WHERE provider = 'code'"),
    );
    expect(status.rows[0]!.status).toBe('expired');
  });
});
