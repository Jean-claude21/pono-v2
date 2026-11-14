/**
 * The hand that writes (D-027), pure: how an agent reads, searches, edits and runs in a project's
 * repository on its server. Shaped after the tools agents already know (Claude Code, the MCP
 * filesystem server, Desktop Commander): line-numbered reads by range, exact edits applied all or
 * nothing with a diff, content search apart from name search, every output bounded.
 */
import { readFileSync } from 'node:fs';
import { q, workdir } from './domain.js';

/** Most a single answer carries back, so a conversation stays readable. */
export const LIMITS = {
  readLines: 2000,
  lineChars: 2000,
  files: 1000,
  matches: 100,
  mapChars: 12_000,
  undo: 10,
  diffChars: 30_000,
  writeChars: 400_000,
  outputChars: 20_000,
  seconds: 600,
} as const;

/**
 * A path inside the repository, as the agent gives it: relative, without `..`, never into `.git`,
 * `node_modules` or Pono's own folder. Answers the clean path, or null.
 */
export function safePath(path: string): string | null {
  const clean = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '');
  if (!clean || clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || clean.includes('\0'))
    return null;
  const parts = clean.split('/').filter((p) => p && p !== '.');
  if (!parts.length || parts.includes('..')) return null;
  if (['.git', '.pono', 'node_modules'].includes(parts[0]!)) return null;
  return parts.join('/');
}

/**
 * The one script the server runs for every file operation (`toolbox.cjs`): its input arrives
 * base64-encoded in an environment variable, never through the shell's quoting, and it answers one
 * JSON line.
 */
export const TOOLBOX = readFileSync(new URL('./toolbox.cjs', import.meta.url), 'utf8');

export type CodeOp =
  | { op: 'list'; path: string | null; pattern: string | null }
  | { op: 'read'; path: string; offset: number; limit: number }
  | { op: 'search'; pattern: string; path: string | null; glob: string | null; ignoreCase: boolean }
  | {
      op: 'edit';
      path: string;
      edits: { old: string; new: string; all: boolean }[];
      dryRun: boolean;
    }
  | { op: 'write'; path: string; content: string }
  | { op: 'patch'; patch: string }
  | { op: 'map'; path: string | null }
  | { op: 'undo'; path: string }
  | { op: 'skills'; skills: { name: string; text: string; files: Record<string, string> }[] }
  | { op: 'move'; path: string; to: string }
  | { op: 'delete'; path: string }
  | { op: 'changes' };

/** Operations that change files: after them, the dev server's own reaction is read back. */
export const WRITING_OPS = new Set(['edit', 'write', 'patch', 'move', 'delete', 'undo']);

/**
 * The command that runs one file operation in the repository on the server. After a change, it
 * waits a moment and appends the dev server's last log lines: its compile errors are the agent's
 * best feedback (SWE-agent's lesson: show the consequence of an edit right away).
 */
export function codeCommand(repository: string, input: CodeOp): string {
  const data = Buffer.from(JSON.stringify({ ...input, limits: LIMITS })).toString('base64');
  const after = WRITING_OPS.has(input.op)
    ? ` ; if [ -f .pono/dev.pid ]; then sleep 1.5; echo '<<<devlog>>>'; tail -n 25 .pono/dev.log 2>/dev/null; fi`
    : '';
  return `cd "${workdir(repository)}" 2>/dev/null || { echo '{"error":"not_ready"}'; exit 0; }; PONO_IN=${q(data)} node -e ${q(TOOLBOX)}${after}`;
}

/** Lines of a dev server log that say something went wrong. */
const PROBLEM = /error|failed|cannot|unexpected|not found|exception|✘|\[plugin/i;
// eslint-disable-next-line no-control-regex
const COLOR = /\u001b\[[0-9;]*m/g;

/** The dev server's reaction to a change: its problem lines only, or nothing. */
export function devProblems(stdout: string): string[] {
  const at = stdout.indexOf('<<<devlog>>>');
  if (at < 0) return [];
  return stdout
    .slice(at + 12)
    .split('\n')
    .map((l) => l.replace(COLOR, '').trimEnd())
    .filter((l) => l && PROBLEM.test(l))
    .slice(-10);
}

/** Reads the JSON line the script answered; a missing answer is the server's own failure. */
export function readCode(stdout: string): Record<string, unknown> {
  const line = stdout
    .split('<<<devlog>>>')[0]!
    .trim()
    .split('\n')
    .reverse()
    .find((l) => l.startsWith('{'));
  if (!line) return { error: 'no_answer' };
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { error: 'no_answer' };
  }
}

/**
 * A shell command in the repository, bounded in time (124 when it ran out), its output's end kept.
 * In the background, it answers a job id at once; its output is read later.
 */
export function runCommand(
  repository: string,
  command: string,
  seconds: number,
  background: boolean,
): string {
  const head = `cd "${workdir(repository)}" 2>/dev/null || { echo '<<<not_ready>>>'; exit 0; }; mkdir -p .pono/jobs`;
  if (background)
    return `${head}; J=$(date +%s%N); setsid nohup sh -c ${q(`timeout ${seconds} sh -c ${q(command)}; echo "<<<exit>>>$?"`)} > .pono/jobs/$J.log 2>&1 < /dev/null & echo "<<<job>>>$J"`;
  return `${head}; timeout ${seconds} sh -c ${q(command)} > .pono/run.log 2>&1; echo "<<<exit>>>$?"; tail -c ${LIMITS.outputChars} .pono/run.log`;
}

/** A background job's output so far, and its exit code once it ended. */
export function jobCommand(repository: string, job: string): string {
  return `cd "${workdir(repository)}" 2>/dev/null || { echo '<<<not_ready>>>'; exit 0; }; test -f .pono/jobs/${job}.log || { echo '<<<no_job>>>'; exit 0; }; tail -c ${LIMITS.outputChars} .pono/jobs/${job}.log`;
}

export interface RunResult {
  ready: boolean;
  job?: string;
  done: boolean;
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

/** Reads what `runCommand` or `jobCommand` printed. */
export function readRun(stdout: string): RunResult {
  if (stdout.includes('<<<not_ready>>>') || stdout.includes('<<<no_job>>>'))
    return { ready: false, done: true, exitCode: null, timedOut: false, output: '' };
  const job = /<<<job>>>(\d+)/.exec(stdout)?.[1];
  if (job) return { ready: true, job, done: false, exitCode: null, timedOut: false, output: '' };
  const m = /<<<exit>>>(\d+)\n?/.exec(stdout);
  const exitCode = m ? Number(m[1]) : null;
  const output = m ? `${stdout.slice(0, m.index)}${stdout.slice(m.index + m[0].length)}` : stdout;
  return {
    ready: true,
    done: m !== null,
    exitCode,
    timedOut: exitCode === 124,
    output: output.trimEnd(),
  };
}
