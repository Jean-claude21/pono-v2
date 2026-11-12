/**
 * The release guards (D-006): secrets, migrations, preview. Pure: they read a change, they never
 * keep a secret's value. A guard answers passed or failed, with findings that name file and line.
 */

import { declaredFiles, readManifest } from '../manifest/domain.js';

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  /** The unified diff, or null when the code host could not show it (too large, binary). */
  patch: string | null;
  binary: boolean;
}

export interface Finding {
  code: string;
  file?: string;
  line?: number;
  /** The kind of secret, or the destructive operation; never a value. */
  what?: string;
}

export type GuardName = 'secrets' | 'migrations' | 'preview';

export interface GuardResult {
  guard: GuardName;
  passed: boolean;
  findings: Finding[];
}

/** The lines a change adds, with their line numbers in the new file. */
export function addedLines(patch: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let line = 0;
  for (const raw of patch.split('\n')) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith('+++')) continue;
    if (raw.startsWith('+')) out.push({ line: line++, text: raw.slice(1) });
    else if (!raw.startsWith('-')) line++;
  }
  return out;
}

// The shapes of keys; the value itself is never kept (from the first Pono's guard).
const SECRET_PATTERNS: [string, RegExp][] = [
  ['code_host_token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/],
  ['code_host_token', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['chat_bot_token', /\b\d{6,}:[A-Za-z0-9_-]{30,}/],
  ['cloud_access_key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['payment_key', /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/],
  ['chat_workspace_token', /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/],
  ['ai_api_key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}\b/],
  ['hosting_token', /\bnfp_[A-Za-z0-9]{20,}\b/],
  ['server_key', /\bsk_live_[A-Za-z0-9]{20,}\b/],
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  [
    'database_url_password',
    /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:/@]+:[^\s@/]{3,}@/,
  ],
];
const ASSIGNED =
  /[\w.-]*(?:password|passwd|secret|token|api[_-]?key|private[_-]?key)["']?\s*[:=]\s*["']([^"'\s]{8,})["']/i;
const PLACEHOLDER =
  /^(?:x+|\*+|\.+|changeme|change-me|placeholder|example.*|your[-_].*|<.*>|\$\{.*\}|process\.env.*|env\(.*\)|todo|none|null|undefined|test.*|dummy.*|fake.*)$/i;
const BINARY =
  /\.(png|jpe?g|gif|webp|ico|bmp|avif|pdf|zip|gz|tgz|woff2?|ttf|otf|eot|mp[34]|webm|mov|wasm|jar)$/i;

function isEnvFile(path: string): boolean {
  const name = path.split('/').pop() ?? '';
  return (
    (name === '.env' || name.startsWith('.env.')) && !/\.(example|sample|template|dist)$/.test(name)
  );
}

/** No key enters production (always blocking, in every mode). */
export function secretsGuard(files: ChangedFile[]): GuardResult {
  const findings: Finding[] = [];
  for (const file of files) {
    if (file.status === 'removed') continue;
    if (isEnvFile(file.path)) {
      findings.push({ code: 'secrets.env_file', file: file.path });
      continue;
    }
    if (file.binary || BINARY.test(file.path)) continue;
    if (file.patch === null) {
      findings.push({ code: 'secrets.unreadable', file: file.path });
      continue;
    }
    for (const { line, text } of addedLines(file.patch)) {
      const kind = SECRET_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0];
      if (kind) {
        findings.push({ code: 'secrets.found', file: file.path, line, what: kind });
        continue;
      }
      const assigned = text.match(ASSIGNED);
      if (assigned && !PLACEHOLDER.test(assigned[1]!))
        findings.push({ code: 'secrets.found', file: file.path, line, what: 'assigned_secret' });
    }
  }
  return { guard: 'secrets', passed: findings.length === 0, findings };
}

const DESTRUCTIVE: [string, RegExp][] = [
  ['drop_table', /\bDROP\s+TABLE\b/i],
  ['drop_column', /\bDROP\s+COLUMN\b/i],
  ['alter_drop', /\bALTER\s+TABLE\b[^;]*\bDROP\b(?!\s+(?:DEFAULT|NOT\s+NULL|CONSTRAINT))/i],
  ['truncate', /\bTRUNCATE\b/i],
  ['drop_schema', /\bDROP\s+(?:SCHEMA|DATABASE)\b/i],
  ['alter_type', /\bALTER\s+(?:TABLE\b[^;]*\bALTER\s+)?COLUMN\b[^;]*\bTYPE\b/i],
  ['delete_all', /\bDELETE\s+FROM\s+[\w."]+\s*(?:;|$)/i],
];
const MIGRATION =
  /(^|\/)(migrations?|drizzle|prisma\/migrations|supabase\/migrations)\/.*\.sql$|\.sql$/i;

/**
 * Migrations stay additive (safe-migrations skill). A destruction declared in `pono.yaml`
 * (`declared_destructions`, by file) passes, and only alone in its change.
 */
export function migrationsGuard(files: ChangedFile[], declared: string[]): GuardResult {
  const findings: Finding[] = [];
  const migrations = files.filter((f) => f.status !== 'removed' && MIGRATION.test(f.path));
  for (const file of migrations) {
    if (file.patch === null) {
      findings.push({ code: 'migrations.unreadable', file: file.path });
      continue;
    }
    const added = addedLines(file.patch);
    const sql = added.map((l) => l.text).join('\n');
    for (const [what, pattern] of DESTRUCTIVE) {
      if (!pattern.test(sql)) continue;
      const line = added.find((l) => pattern.test(l.text))?.line;
      if (declared.includes(file.path)) {
        if (files.length > 2)
          findings.push({ code: 'migrations.declared_not_alone', file: file.path, what });
      } else
        findings.push({
          code: 'migrations.destructive',
          file: file.path,
          ...(line ? { line } : {}),
          what,
        });
    }
  }
  return { guard: 'migrations', passed: findings.length === 0, findings };
}

/** The preview of this exact commit answers (without a preview, the guard blocks). */
export function previewGuard(
  preview: { status: 'succeeded' | 'failed' | 'building' | 'cancelled' } | null,
): GuardResult {
  if (!preview) return { guard: 'preview', passed: false, findings: [{ code: 'preview.missing' }] };
  if (preview.status !== 'succeeded')
    return { guard: 'preview', passed: false, findings: [{ code: `preview.${preview.status}` }] };
  return { guard: 'preview', passed: true, findings: [] };
}

/**
 * The destructions declared in `pono.yaml` (`release.declared_destructions`). A file that does not
 * read as a manifest declares nothing: the guard then refuses every destruction.
 */
export function declaredDestructions(manifest: string | null): string[] {
  if (!manifest) return [];
  const reading = readManifest(manifest);
  return reading.ok ? declaredFiles(reading.manifest) : [];
}

export type ReleaseMode = 'ask' | 'auto' | 'bypass';
export type Verdict = 'passed' | 'warned' | 'refused';

/**
 * The verdict, by mode (D-006): a secret refuses in every mode; in `bypass` the other guards only
 * warn; otherwise any failed guard refuses.
 */
export function verdict(results: GuardResult[], mode: ReleaseMode): Verdict {
  const failed = results.filter((r) => !r.passed);
  if (failed.length === 0) return 'passed';
  if (failed.some((r) => r.guard === 'secrets')) return 'refused';
  return mode === 'bypass' ? 'warned' : 'refused';
}

/** What happens to a change that is not refused: wait for a person, or ship. */
export function nextStep(v: Verdict, mode: ReleaseMode): 'refused' | 'waiting' | 'ship' {
  if (v === 'refused') return 'refused';
  if (mode === 'ask') return 'waiting';
  if (mode === 'auto') return v === 'passed' ? 'ship' : 'waiting';
  return 'ship';
}
