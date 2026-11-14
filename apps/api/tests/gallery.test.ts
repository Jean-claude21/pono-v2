import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATEGORIES, loadCatalog, resolveTemplate } from '../src/features/catalog/index.js';
import { call, signIn, testApp, type TestApp } from './support/app.js';

let t: TestApp;
beforeAll(() => {
  t = testApp();
});
afterAll(async () => t.pool.end());

describe('the template gallery (D-033)', () => {
  it('every template has a known category; every variant a parent of the same category', () => {
    const { templates } = loadCatalog();
    for (const x of templates) {
      expect(CATEGORIES).toContain(x.category);
      if (x.parent) {
        const parent = templates.find((p) => p.id === x.parent);
        expect(parent, x.id).toBeDefined();
        expect(parent!.category).toBe(x.category);
        expect(parent!.parent, `${x.id}: one level of variants`).toBeUndefined();
      }
    }
    expect(new Set(templates.map((x) => x.category))).toEqual(new Set(CATEGORIES));
  });

  it('a variant inherits stack, skills and needs, and adds its own', () => {
    const { templates } = loadCatalog();
    const event = resolveTemplate(templates, 'site-event')!;
    const site = resolveTemplate(templates, 'site')!;
    expect(event.stack).toEqual(site.stack);
    expect(event.skills).toEqual(site.skills);
    expect(event.needs).toEqual([...site.needs!, 'database']);
    expect(resolveTemplate(templates, 'nothing')).toBeUndefined();
    const orphan = resolveTemplate(
      [{ ...templates[0]!, id: 'x', parent: 'gone', stack: ['A'], skills: ['b'] }],
      'x',
    )!;
    expect(orphan.stack).toEqual(['A']);
  });

  it('lists variants after their parent, by category, with what each brought; a variant launches', async () => {
    const cookie = await signIn(t, `g${randomUUID().slice(0, 8)}`);
    await call(t, cookie, '/v1/connections', {
      method: 'POST',
      body: { provider: 'code', fields: { token: 'good' } },
    });
    const launched = await call(t, cookie, '/v1/launch', {
      method: 'POST',
      body: { template: 'booking-salon', name: `salon-${randomUUID().slice(0, 6)}` },
    });
    expect(launched.status).toBe(201);
    const gallery = await (await call(t, cookie, '/v1/catalog/templates')).json();
    expect(gallery.categories).toEqual([...CATEGORIES]);
    const ids = gallery.templates.map((x: { id: string }) => x.id);
    expect(ids.indexOf('booking')).toBeLessThan(ids.indexOf('booking-salon'));
    expect(ids.indexOf('site')).toBeLessThan(ids.indexOf('shop'));
    const salon = gallery.templates.find((x: { id: string }) => x.id === 'booking-salon');
    expect(salon.skills).toContain('payments');
    expect(salon.value.launched).toBeGreaterThanOrEqual(1);
  });
});
