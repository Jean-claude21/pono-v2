#!/usr/bin/env node
/**
 * Pono for the coding agent's surroundings (D-021): what the agent and the person should know of
 * this folder's project, without asking. No dependency, no key written anywhere.
 *
 *   node pono.mjs context     → for Claude Code's SessionStart hook: the project, its server,
 *                               its dev server and preview address, its release rule.
 *   node pono.mjs statusline  → one line for Claude Code's status line (cached one minute).
 *
 * Reads PONO_URL (the console's address) and PONO_TOKEN (an agent token, `pono_…`). Says nothing
 * and exits 0 when they are missing or when this folder is not a Pono project: it never blocks.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_ = (process.env.PONO_URL ?? '').replace(/\/+$/, '');
const TOKEN = process.env.PONO_TOKEN ?? '';
const mode = process.argv[2] ?? 'context';

async function tool(name, args) {
  const res = await fetch(`${URL_}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const text = await res.text();
  const json = JSON.parse(
    text.startsWith('{') ? text : (text.match(/^data: (.*)$/m)?.[1] ?? 'null'),
  );
  const result = json?.result;
  if (!result || result.isError) return null;
  return JSON.parse(result.content?.[0]?.text ?? 'null');
}

function remote() {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

async function look() {
  const repository = remote();
  if (!URL_ || !TOKEN || !repository) return null;
  const found = await tool('find_project', { repository });
  if (!found || found.kind !== 'found') return null;
  const project = found.project;
  const resumed = await tool('resume_project', { projectId: project.id });
  const dev = await tool('dev_status', { projectId: project.id, lines: 5 });
  return { project, resumed, dev };
}

function context(seen) {
  const p = seen.resumed?.project ?? {};
  const lines = [
    `This folder is the Pono project « ${seen.project.name} » (${seen.project.repository}).`,
    `State: ${p.state ?? 'unknown'}. Production: ${p.production_url ?? 'none'}. Release mode: ${p.release_mode ?? 'ask'} — you never merge to production yourself.`,
  ];
  if (p.server_status)
    lines.push(
      `Its Pono server is ${p.server_status}${p.server_status === 'sleeping' ? ' (wake_server to work on it)' : ''}.`,
    );
  else lines.push('It has no Pono server yet.');
  if (seen.dev?.previewUrl)
    lines.push(
      `Dev server: ${seen.dev.phase}; preview ${seen.dev.previewUrl} (reloads as files change); branch ${seen.dev.branch ?? '?'}, ${seen.dev.changedFiles} changed files.`,
    );
  const skills = (seen.resumed?.skills ?? []).map((s) => s.name);
  if (skills.length) lines.push(`Skills to follow (get_skill): ${skills.join(', ')}.`);
  for (const next of seen.resumed?.next ?? []) lines.push(next);
  lines.push(
    'Tell the person the preview address when it helps. Before any commit, call check_secrets.',
  );
  return lines.join('\n');
}

function statusline(seen) {
  const p = seen.resumed?.project ?? {};
  const parts = [`pono · ${seen.project.name}`];
  parts.push(p.server_status ? `server ${p.server_status}` : 'no server');
  if (seen.dev?.phase && seen.dev.phase !== 'absent') parts.push(`dev ${seen.dev.phase}`);
  if (seen.dev?.previewUrl) parts.push(seen.dev.previewUrl.replace(/^https:\/\//, ''));
  if (seen.dev?.changedFiles) parts.push(`${seen.dev.changedFiles} changed`);
  parts.push(`release ${p.release_mode ?? 'ask'}`);
  return parts.join(' · ');
}

async function cached(key, compute) {
  const dir = join(tmpdir(), 'pono-statusline');
  const file = join(dir, `${createHash('sha256').update(key).digest('hex').slice(0, 16)}.txt`);
  try {
    const [at, ...rest] = readFileSync(file, 'utf8').split('\n');
    if (Date.now() - Number(at) < 60_000) return rest.join('\n');
  } catch {
    /* nothing cached yet */
  }
  const value = await compute();
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${Date.now()}\n${value}`);
  } catch {
    /* a status line never fails for its cache */
  }
  return value;
}

try {
  if (mode === 'statusline') {
    const line = await cached(`${URL_}|${process.cwd()}`, async () => {
      const seen = await look();
      return seen ? statusline(seen) : '';
    });
    if (line) process.stdout.write(line);
  } else {
    const seen = await look();
    if (seen) process.stdout.write(`${context(seen)}\n`);
  }
} catch {
  // Pono out of reach: the session goes on without it.
}
