// Pono's workbench on a project server (D-027, D-028). Runs as `node -e` inside the repository: its
// input arrives base64-encoded in PONO_IN, never through the shell's quoting; it answers one JSON
// line. Shaped after what agents already know and what open-source coding agents measured:
// line-numbered windows (OpenHands, OpenCode), exact edits refused when ambiguous with a
// whitespace-tolerant fallback (OpenHands, MCP filesystem), Codex's apply_patch for GPT models,
// a syntax guard that reverts a breaking edit (SWE-agent), an undo history (OpenHands), atomic
// writes, bounded outputs, and a ranked map of the repository (Aider).
'use strict';
const fs = require('fs');
const p = require('path');
const cp = require('child_process');

const I = JSON.parse(Buffer.from(process.env.PONO_IN, 'base64').toString());
const L = I.limits;
const ROOT = process.cwd();
const out = (v) => {
  process.stdout.write(JSON.stringify(v) + '\n');
  process.exit(0);
};
const git = (args) => cp.spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64e6 });
const inside = (f) => p.resolve(f).startsWith(ROOT + p.sep);
const cut = (s, n) => (s.length > n ? s.slice(0, n) + '\n…' : s);

for (const f of [I.path, I.to].filter(Boolean)) if (!inside(f)) out({ error: 'outside', path: f });

const files = () =>
  git(['ls-files', '--cached', '--others', '--exclude-standard'])
    .stdout.split('\n')
    .filter(Boolean);

function glob(g) {
  let r = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        r += '.*';
        i++;
        if (g[i + 1] === '/') i++;
      } else r += '[^/]*';
    } else if (c === '?') r += '[^/]';
    else r += c.replace(/[.+^$(){}|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + r + '$');
}

// ── Atomic writes and the undo history ─────────────────────────────

const UNDO = p.join('.pono', 'undo');
const keyOf = (path) => Buffer.from(path).toString('base64url');

function remember(path) {
  const dir = p.join(UNDO, keyOf(path));
  fs.mkdirSync(dir, { recursive: true });
  const existed = fs.existsSync(path);
  const entry = { existed, content: existed ? fs.readFileSync(path).toString('base64') : null };
  const n = Date.now() + '-' + process.pid;
  fs.writeFileSync(p.join(dir, n), JSON.stringify(entry));
  const all = fs.readdirSync(dir).sort();
  for (const old of all.slice(0, Math.max(0, all.length - L.undo))) fs.rmSync(p.join(dir, old));
}

function writeAtomic(path, text) {
  fs.mkdirSync(p.dirname(path), { recursive: true });
  const tmp = p.join('.pono', 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const t = p.join(tmp, 'w-' + process.pid + '-' + Date.now());
  fs.writeFileSync(t, text);
  fs.renameSync(t, path);
}

// ── The syntax guard: an edit that breaks what parsed before is reverted ──

function syntaxError(path, text) {
  const ext = p.extname(path).toLowerCase();
  if (ext === '.json' && !path.endsWith('tsconfig.json')) {
    try {
      JSON.parse(text);
      return null;
    } catch (e) {
      return e.message;
    }
  }
  if (ext === '.js' || ext === '.cjs' || ext === '.mjs') {
    // A .js file may be a script or a module: it parses if either reading accepts it (older Node
    // does not guess modules by itself).
    const tries = ext === '.js' ? ['.cjs', '.mjs'] : [ext];
    fs.mkdirSync(p.join('.pono', 'tmp'), { recursive: true });
    let r = null;
    let tmp = '';
    for (const as of tries) {
      tmp = p.join('.pono', 'tmp', 'check' + as);
      fs.writeFileSync(tmp, text);
      r = cp.spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
      if (r.status === 0) return null;
    }
    return (r.stderr || '')
      .split('\n')
      .filter(Boolean)
      .slice(0, 6)
      .join('\n')
      .split(tmp)
      .join(path);
  }
  return null;
}

function diff(before, after) {
  const t = p.join('.pono', 'tmp');
  fs.mkdirSync(t, { recursive: true });
  fs.writeFileSync(p.join(t, 'a'), before);
  fs.writeFileSync(p.join(t, 'b'), after);
  const d = git(['diff', '--no-index', '--no-color', '-U3', p.join(t, 'a'), p.join(t, 'b')])
    .stdout.split('\n')
    .slice(4)
    .join('\n');
  return cut(d, L.diffChars);
}

/** Writes one file through the guard; answers its diff, or the refusal. */
function commit(path, before, after, dry, action, extra = {}) {
  const broke = syntaxError(path, after);
  if (broke && !(before && syntaxError(path, before)))
    out({
      error: 'syntax_broken',
      path,
      detail: broke,
      hint: 'Nothing was written: the change would break this file. Fix the edit and try again.',
      diff: diff(before, after),
    });
  if (!dry) {
    remember(path);
    writeAtomic(path, after);
  }
  out({ path, action: dry ? 'preview' : action, diff: diff(before, after), ...extra });
}

// ── Finding the text to replace: exact first, then line by line without edge spaces ──

function locate(text, old) {
  const exact = text.split(old).length - 1;
  if (exact) return { strategy: 'exact', count: exact };
  const lines = text.split('\n');
  const want = old.split('\n').map((l) => l.trim());
  while (want.length && want[want.length - 1] === '') want.pop();
  while (want.length && want[0] === '') want.shift();
  if (!want.length) return { strategy: 'none', count: 0 };
  const hits = [];
  for (let i = 0; i + want.length <= lines.length; i++) {
    let ok = true;
    for (let k = 0; k < want.length && ok; k++) ok = lines[i + k].trim() === want[k];
    if (ok) hits.push(i);
  }
  return { strategy: 'trimmed', count: hits.length, at: hits[0], span: want.length };
}

function replaceOnce(text, old, neu, found) {
  if (found.strategy === 'exact') return text.replace(old, () => neu);
  const lines = text.split('\n');
  const indent = (lines[found.at].match(/^\s*/) || [''])[0];
  const first = (neu.split('\n').find((l) => l.trim()) || '').match(/^\s*/)[0];
  const shifted = neu
    .split('\n')
    .map((l) => (l.startsWith(first) ? indent + l.slice(first.length) : l));
  lines.splice(found.at, found.span, ...shifted);
  return lines.join('\n');
}

function near(text, old) {
  const first = (old.split('\n').find((l) => l.trim()) || '').trim().slice(0, 40);
  if (!first) return [];
  return text
    .split(/\r?\n/)
    .map((l, k) => [k + 1, l])
    .filter(([, l]) => l.includes(first))
    .slice(0, 3)
    .map(([k, l]) => k + ': ' + l.slice(0, 200));
}

// ── Codex's apply_patch: Add / Delete / Update (with Move) in one atomic change ──

function parsePatch(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (/^<<['"]?EOF['"]?$/.test((lines[i] || '').trim())) i++;
  if ((lines[i] || '').trim() !== '*** Begin Patch')
    throw new Error("The first line of the patch must be '*** Begin Patch'");
  i++;
  const ops = [];
  while (i < lines.length && lines[i].trim() !== '*** End Patch') {
    const line = lines[i];
    let m;
    if ((m = /^\*\*\* Add File: (.+)$/.exec(line))) {
      const body = [];
      i++;
      while (i < lines.length && lines[i].startsWith('+')) body.push(lines[i++].slice(1));
      ops.push({ kind: 'add', path: m[1].trim(), content: body.join('\n') + '\n' });
    } else if ((m = /^\*\*\* Delete File: (.+)$/.exec(line))) {
      ops.push({ kind: 'delete', path: m[1].trim() });
      i++;
    } else if ((m = /^\*\*\* Update File: (.+)$/.exec(line))) {
      const op = { kind: 'update', path: m[1].trim(), to: null, chunks: [] };
      i++;
      if ((m = /^\*\*\* Move to: (.+)$/.exec(lines[i] || ''))) {
        op.to = m[1].trim();
        i++;
      }
      let chunk = null;
      while (i < lines.length && !lines[i].startsWith('*** ')) {
        const l = lines[i];
        if (l.startsWith('@@')) {
          chunk = { anchor: l.slice(2).trim(), old: [], neu: [] };
          op.chunks.push(chunk);
        } else {
          if (!chunk) {
            chunk = { anchor: '', old: [], neu: [] };
            op.chunks.push(chunk);
          }
          const sign = l[0];
          const rest = l.slice(1);
          if (sign === '-') chunk.old.push(rest);
          else if (sign === '+') chunk.neu.push(rest);
          else {
            chunk.old.push(sign === ' ' ? rest : l);
            chunk.neu.push(sign === ' ' ? rest : l);
          }
        }
        i++;
      }
      if (lines[i] && lines[i].trim() === '*** End of File') i++;
      if (!op.chunks.length && !op.to) throw new Error('Empty update for ' + op.path);
      ops.push(op);
    } else if (!line.trim()) i++;
    else throw new Error('Unexpected line in the patch: ' + line.slice(0, 120));
  }
  return ops;
}

function applyChunks(path, text, chunks) {
  let lines = text.split('\n');
  let from = 0;
  for (const c of chunks) {
    if (c.anchor) {
      const a = lines.findIndex((l, k) => k >= from && l.trim() === c.anchor.trim());
      if (a >= 0) from = a;
    }
    const find = (eq) => {
      for (let k = from; k + c.old.length <= lines.length; k++) {
        let ok = true;
        for (let j = 0; j < c.old.length && ok; j++) ok = eq(lines[k + j], c.old[j]);
        if (ok) return k;
      }
      return -1;
    };
    let at = c.old.length ? find((a, b) => a === b) : lines.length;
    if (at < 0) at = find((a, b) => a.trim() === b.trim());
    if (at < 0)
      throw Object.assign(new Error('context_not_found'), {
        path,
        context: c.old.slice(0, 4).join('\n'),
      });
    lines.splice(at, c.old.length, ...c.neu);
    from = at + c.neu.length;
  }
  return lines.join('\n');
}

function patch() {
  let ops;
  try {
    ops = parsePatch(I.patch);
  } catch (e) {
    out({ error: 'patch_invalid', detail: e.message });
  }
  const writes = [];
  for (const op of ops) {
    for (const f of [op.path, op.to].filter(Boolean)) {
      if (!inside(f) || f.split('/')[0] === '.git' || f.split('/')[0] === '.pono')
        out({ error: 'outside', path: f });
    }
    if (op.kind === 'add') {
      if (fs.existsSync(op.path)) out({ error: 'exists', path: op.path });
      writes.push({ path: op.path, before: '', after: op.content, action: 'created' });
    } else if (op.kind === 'delete') {
      if (!fs.existsSync(op.path)) out({ error: 'not_found', path: op.path });
      writes.push({
        path: op.path,
        before: fs.readFileSync(op.path, 'utf8'),
        after: null,
        action: 'deleted',
      });
    } else {
      if (!fs.existsSync(op.path)) out({ error: 'not_found', path: op.path });
      const before = fs.readFileSync(op.path, 'utf8');
      let after;
      try {
        after = op.chunks.length ? applyChunks(op.path, before, op.chunks) : before;
      } catch (e) {
        out({
          error: 'context_not_found',
          path: e.path,
          context: e.context,
          hint: 'Read the file again: the lines around the change must match it.',
        });
      }
      if (op.to) {
        writes.push({ path: op.path, before, after: null, action: 'moved' });
        writes.push({ path: op.to, before: '', after, action: 'moved_here' });
      } else writes.push({ path: op.path, before, after, action: 'updated' });
    }
  }
  for (const w of writes) {
    if (w.after === null) continue;
    const broke = syntaxError(w.path, w.after);
    if (broke && !(w.before && syntaxError(w.path, w.before)))
      out({ error: 'syntax_broken', path: w.path, detail: broke, hint: 'Nothing was written.' });
  }
  for (const w of writes) {
    remember(w.path);
    if (w.after === null) fs.rmSync(w.path, { force: true });
    else writeAtomic(w.path, w.after);
  }
  out({
    applied: writes.map((w) => ({ path: w.path, action: w.action })),
    diff: cut(
      writes.map((w) => '--- ' + w.path + '\n' + diff(w.before, w.after ?? '')).join('\n'),
      L.diffChars,
    ),
  });
}

// ── The map of the repository: files, sizes, and their top-level names ──

const SYMBOL =
  /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let|def|func|fn|pub fn|struct|trait|module)\s+([A-Za-z_$][\w$]*)/;
function map() {
  const all = files().filter((f) => !/(^|\/)(dist|build|\.next|vendor|coverage)\//.test(f));
  const chosen = I.path ? all.filter((f) => f === I.path || f.startsWith(I.path + '/')) : all;
  const code = /\.(m?[jt]sx?|cjs|py|go|rs|rb|php|java|kt|swift|vue|svelte)$/;
  let budget = L.mapChars;
  const lines = [];
  for (const f of chosen) {
    let size = 0;
    let names = [];
    try {
      const st = fs.statSync(f);
      if (st.size > 400000) continue;
      const text = fs.readFileSync(f, 'utf8');
      size = text.split('\n').length;
      if (code.test(f))
        names = text
          .split('\n')
          .map((l) => (SYMBOL.exec(l) || [])[1])
          .filter(Boolean)
          .slice(0, 12);
    } catch {
      continue;
    }
    const line = f + ' (' + size + ')' + (names.length ? ': ' + names.join(', ') : '');
    if (budget - line.length < 0) {
      lines.push('… ' + (chosen.length - lines.length) + ' more files: narrow with a folder.');
      break;
    }
    budget -= line.length + 1;
    lines.push(line);
  }
  out({ files: chosen.length, map: lines.join('\n') });
}

// ── The operations ─────────────────────────────────────────────────

switch (I.op) {
  case 'list': {
    let f = files();
    if (I.path) f = f.filter((x) => x === I.path || x.startsWith(I.path + '/'));
    if (I.pattern) {
      const g = glob(I.pattern);
      f = f.filter((x) => g.test(x) || g.test(p.basename(x)));
    }
    out({ total: f.length, files: f.slice(0, L.files), truncated: f.length > L.files });
  }
  case 'map':
    map();
    break;
  case 'read': {
    let b;
    try {
      b = fs.readFileSync(I.path);
    } catch {
      out({ error: 'not_found', path: I.path });
    }
    if (b.includes(0)) out({ path: I.path, binary: true, size: b.length });
    const all = b.toString('utf8').split('\n');
    const s = I.offset - 1;
    const part = all.slice(s, s + I.limit);
    const content = part
      .map(
        (l, k) =>
          String(s + k + 1).padStart(6) +
          '\t' +
          (l.length > L.lineChars ? l.slice(0, L.lineChars) + '…' : l),
      )
      .join('\n');
    out({
      path: I.path,
      totalLines: all.length,
      from: s + 1,
      to: s + part.length,
      content,
      truncated: s + part.length < all.length,
    });
  }
  case 'search': {
    const a = ['grep', '-n', '-I', '--untracked', '-E'];
    if (I.ignoreCase) a.push('-i');
    a.push('-e', I.pattern);
    if (I.path) a.push('--', I.path);
    let m = git(a).stdout.split('\n').filter(Boolean);
    if (I.glob) {
      const g = glob(I.glob);
      m = m.filter((l) => {
        const f = l.split(':')[0];
        return g.test(f) || g.test(p.basename(f));
      });
    }
    out({
      total: m.length,
      matches: m.slice(0, L.matches).map((l) => (l.length > 300 ? l.slice(0, 300) + '…' : l)),
      truncated: m.length > L.matches,
      ...(m.length > L.matches
        ? { hint: 'Too many matches: narrow with a folder, a glob or a stricter pattern.' }
        : {}),
    });
  }
  case 'edit': {
    let text;
    try {
      text = fs.readFileSync(I.path, 'utf8');
    } catch {
      out({ error: 'not_found', path: I.path });
    }
    const before = text;
    const crlf = text.includes('\r\n');
    if (crlf) text = text.replace(/\r\n/g, '\n');
    const strategies = [];
    for (const e of I.edits) {
      const o = e.old.replace(/\r\n/g, '\n');
      const n = e.new.replace(/\r\n/g, '\n');
      const found = locate(text, o);
      if (found.count === 0)
        out({
          error: 'edit_not_found',
          path: I.path,
          old: e.old.slice(0, 300),
          near: near(text, o),
          hint: 'Read the file again: old_text must match it, line for line.',
        });
      if (found.count > 1 && !e.all)
        out({
          error: 'edit_ambiguous',
          path: I.path,
          old: e.old.slice(0, 300),
          count: found.count,
          hint: 'Give more surrounding lines, or set replace_all.',
        });
      strategies.push(found.strategy);
      if (e.all && found.strategy === 'exact') text = text.split(o).join(n);
      else text = replaceOnce(text, o, n, found);
    }
    if (crlf) text = text.replace(/\n/g, '\r\n');
    commit(
      I.path,
      before,
      text,
      I.dryRun,
      'edited',
      strategies.includes('trimmed') ? { matched: 'ignoring edge spaces' } : {},
    );
    break;
  }
  case 'write': {
    const had = fs.existsSync(I.path);
    commit(
      I.path,
      had ? fs.readFileSync(I.path, 'utf8') : '',
      I.content,
      false,
      had ? 'replaced' : 'created',
    );
    break;
  }
  case 'patch':
    patch();
    break;
  case 'move': {
    if (!fs.existsSync(I.path)) out({ error: 'not_found', path: I.path });
    if (fs.existsSync(I.to)) out({ error: 'exists', path: I.to });
    remember(I.path);
    remember(I.to);
    fs.mkdirSync(p.dirname(I.to), { recursive: true });
    fs.renameSync(I.path, I.to);
    out({ moved: I.path, to: I.to });
  }
  case 'delete': {
    if (!fs.existsSync(I.path) || fs.statSync(I.path).isDirectory())
      out({ error: 'not_found', path: I.path });
    remember(I.path);
    fs.rmSync(I.path);
    out({ deleted: I.path });
  }
  case 'undo': {
    const dir = p.join(UNDO, keyOf(I.path));
    const all = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
    if (!all.length) out({ error: 'nothing_to_undo', path: I.path });
    const last = p.join(dir, all[all.length - 1]);
    const entry = JSON.parse(fs.readFileSync(last, 'utf8'));
    const now = fs.existsSync(I.path) ? fs.readFileSync(I.path, 'utf8') : '';
    if (entry.existed) writeAtomic(I.path, Buffer.from(entry.content, 'base64'));
    else fs.rmSync(I.path, { force: true });
    fs.rmSync(last);
    out({
      path: I.path,
      action: entry.existed ? 'restored' : 'removed',
      remaining: all.length - 1,
      diff: diff(now, entry.existed ? Buffer.from(entry.content, 'base64').toString('utf8') : ''),
    });
  }
  case 'skills': {
    // The project's active skills, where agents look for them natively (Claude Code, Codex, Cline…),
    // kept out of git: they are Pono's to serve, the repository's own skills stay as they are.
    const roots = ['.claude/skills', '.agents/skills'];
    const exclude = p.join('.git', 'info', 'exclude');
    const known = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
    const written = [];
    for (const s of I.skills) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.name)) continue;
      for (const root of roots) {
        const dir = p.join(root, s.name);
        const line = '/' + root + '/' + s.name + '/';
        const own = fs.existsSync(p.join(dir, 'SKILL.md')) && !known.includes(line);
        if (own) continue;
        fs.rmSync(dir, { recursive: true, force: true });
        writeAtomic(p.join(dir, 'SKILL.md'), s.text);
        for (const [rel, content] of Object.entries(s.files || {})) {
          if (!/^(references|scripts|assets)\/[\w./-]+$/.test(rel) || rel.includes('..')) continue;
          writeAtomic(p.join(dir, rel), content);
        }
        if (!known.includes(line)) fs.appendFileSync(exclude, line + '\n');
        written.push(root + '/' + s.name);
      }
    }
    out({ installed: written });
  }
  case 'changes': {
    const st = git(['status', '--porcelain']).stdout.split('\n').filter(Boolean);
    const d = git(['diff', '--no-color']).stdout;
    out({ files: st, diff: cut(d, L.diffChars), truncated: d.length > L.diffChars });
  }
  default:
    out({ error: 'unknown_op' });
}
