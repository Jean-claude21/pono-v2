import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json' with { type: 'json' };
import fr from '../../messages/fr.json' with { type: 'json' };

describe('catalogs', () => {
  it('hold the same keys in French and in English', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
  });

  it('leave no message empty', () => {
    for (const catalog of [fr, en]) {
      for (const [key, value] of Object.entries(catalog)) {
        if (key !== '$schema') expect(value, key).not.toBe('');
      }
    }
  });
});
