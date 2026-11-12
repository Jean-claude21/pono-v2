import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Sealer, hashToken, newToken } from '../src/platform/secrets.js';

const key = randomBytes(32).toString('base64');

describe('Sealer', () => {
  it('opens what it sealed, and the sealed form holds no clear byte', () => {
    const sealer = new Sealer(key);
    const sealed = sealer.seal('nfp_super_secret_token');
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain('super_secret');
    expect(sealer.open(sealed)).toBe('nfp_super_secret_token');
  });

  it('seals the same secret differently each time', () => {
    const sealer = new Sealer(key);
    expect(sealer.seal('same')).not.toBe(sealer.seal('same'));
  });

  it('refuses another key and a tampered value', () => {
    const sealed = new Sealer(key).seal('secret');
    expect(new Sealer(randomBytes(32).toString('base64')).open(sealed)).toBeNull();
    const parts = sealed.split('.');
    parts[3] = Buffer.from('forged').toString('base64url');
    expect(new Sealer(key).open(parts.join('.'))).toBeNull();
    expect(new Sealer(key).open('not-sealed')).toBeNull();
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => new Sealer(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('tokens', () => {
  it('keeps only a hash of a token', () => {
    const { token, hash } = newToken();
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toContain(token);
    expect(hash).toHaveLength(64);
  });
});
