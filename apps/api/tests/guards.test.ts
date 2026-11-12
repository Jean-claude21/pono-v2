import { describe, expect, it } from 'vitest';
import {
  addedLines,
  declaredDestructions,
  migrationsGuard,
  nextStep,
  previewGuard,
  secretsGuard,
  verdict,
  type ChangedFile,
} from '../src/features/releases/guards.js';

const file = (
  path: string,
  added: string[],
  status: ChangedFile['status'] = 'modified',
): ChangedFile => ({
  path,
  status,
  binary: false,
  patch: `@@ -1,0 +10,${added.length} @@\n${added.map((l) => `+${l}`).join('\n')}`,
});

describe('addedLines', () => {
  it('numbers the added lines in the new file', () => {
    expect(addedLines('@@ -1,2 +1,3 @@\n same\n-gone\n+new\n same')).toEqual([
      { line: 2, text: 'new' },
    ]);
  });
});

describe('secrets guard', () => {
  it('finds a key by its shape, names file, line and kind, never the value', () => {
    const value = 'sk_live_' + 'a'.repeat(24);
    const result = secretsGuard([file('src/pay.ts', ['const ok = 1;', `const key = '${value}';`])]);
    expect(result.passed).toBe(false);
    expect(result.findings).toEqual([
      { code: 'secrets.found', file: 'src/pay.ts', line: 11, what: 'payment_key' },
    ]);
    expect(JSON.stringify(result)).not.toContain(value);
  });
  it('refuses a committed .env, lets .env.example pass, and refuses what it cannot read', () => {
    expect(secretsGuard([file('.env', ['A=b'])]).findings[0]!.code).toBe('secrets.env_file');
    expect(secretsGuard([file('.env.example', ['API_KEY='])]).passed).toBe(true);
    expect(
      secretsGuard([{ path: 'big.ts', status: 'added', patch: null, binary: false }]).findings[0]!
        .code,
    ).toBe('secrets.unreadable');
  });
  it('lets placeholders and environment reads pass', () => {
    expect(
      secretsGuard([
        file('a.ts', [
          "password: 'changeme'",
          'apiKey = process.env.KEY',
          "token: 'your-token-here'",
        ]),
      ]).passed,
    ).toBe(true);
    expect(secretsGuard([file('a.ts', ["password = 'Zq8!rT4p9wLm'"])]).passed).toBe(false);
  });
});

describe('migrations guard', () => {
  it('refuses a destructive migration and passes an additive one', () => {
    expect(
      migrationsGuard(
        [file('db/migrations/0002.sql', ['ALTER TABLE books ADD COLUMN notes text;'])],
        [],
      ).passed,
    ).toBe(true);
    const refused = migrationsGuard(
      [file('db/migrations/0003.sql', ['ALTER TABLE "books" DROP COLUMN "notes";'])],
      [],
    );
    expect(refused.findings[0]).toMatchObject({
      code: 'migrations.destructive',
      file: 'db/migrations/0003.sql',
      what: 'drop_column',
    });
    for (const sql of [
      'DROP TABLE orders;',
      'TRUNCATE orders;',
      'DELETE FROM orders;',
      'ALTER TABLE t ALTER COLUMN c TYPE int;',
    ]) {
      expect(migrationsGuard([file('migrations/x.sql', [sql])], []).passed, sql).toBe(false);
    }
    expect(
      migrationsGuard([file('migrations/x.sql', ['DELETE FROM orders WHERE id = 1;'])], []).passed,
    ).toBe(true);
    expect(
      migrationsGuard(
        [file('migrations/x.sql', ['ALTER TABLE t ALTER COLUMN c DROP NOT NULL;'])],
        [],
      ).passed,
    ).toBe(true);
  });
  it('lets a declared destruction pass, only alone in its change', () => {
    const drop = file('migrations/0004.sql', ['DROP TABLE legacy;']);
    expect(
      migrationsGuard(
        [drop, file('pono.yaml', ['declared_destructions:'])],
        ['migrations/0004.sql'],
      ).passed,
    ).toBe(true);
    const crowded = migrationsGuard(
      [drop, file('pono.yaml', ['x']), file('src/a.ts', ['x'])],
      ['migrations/0004.sql'],
    );
    expect(crowded.findings[0]!.code).toBe('migrations.declared_not_alone');
  });
  it('reads the declared destructions of pono.yaml', () => {
    expect(
      declaredDestructions(
        'version: 1\nname: x\nrelease:\n  declared_destructions:\n    - migrations/0004.sql\n    - file: "db/0005.sql"\n',
      ),
    ).toEqual(['migrations/0004.sql', 'db/0005.sql']);
    expect(
      declaredDestructions('version: 1\nname: x\nrelease:\n  declared_destructions: []\n'),
    ).toEqual([]);
    // The release mode never reads from the repository: such a file declares nothing.
    expect(
      declaredDestructions(
        'version: 1\nname: x\nrelease:\n  mode: bypass\n  declared_destructions: [a.sql]\n',
      ),
    ).toEqual([]);
    expect(declaredDestructions(null)).toEqual([]);
  });
});

describe('preview guard', () => {
  it('blocks without a preview of this commit, or when it failed', () => {
    expect(previewGuard(null).findings[0]!.code).toBe('preview.missing');
    expect(previewGuard({ status: 'failed' }).passed).toBe(false);
    expect(previewGuard({ status: 'succeeded' }).passed).toBe(true);
  });
});

describe('verdict and next step, by mode (D-006)', () => {
  const ok = { guard: 'migrations' as const, passed: true, findings: [] };
  const badMigration = { guard: 'migrations' as const, passed: false, findings: [{ code: 'x' }] };
  const badSecret = { guard: 'secrets' as const, passed: false, findings: [{ code: 'x' }] };
  it('refuses a secret in every mode', () => {
    for (const mode of ['ask', 'auto', 'bypass'] as const)
      expect(verdict([badSecret], mode)).toBe('refused');
  });
  it('only warns about other guards in bypass', () => {
    expect(verdict([badMigration], 'ask')).toBe('refused');
    expect(verdict([badMigration], 'auto')).toBe('refused');
    expect(verdict([badMigration], 'bypass')).toBe('warned');
  });
  it('waits for a person in ask, ships when green in auto, ships in bypass', () => {
    expect(nextStep(verdict([ok], 'ask'), 'ask')).toBe('waiting');
    expect(nextStep(verdict([ok], 'auto'), 'auto')).toBe('ship');
    expect(nextStep(verdict([badMigration], 'bypass'), 'bypass')).toBe('ship');
    expect(nextStep('refused', 'bypass')).toBe('refused');
  });
});
