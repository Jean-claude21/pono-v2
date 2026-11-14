/**
 * Third-party skills, pinned at a reviewed commit (D-016, D-035): each folder is fetched as it is
 * at that commit into catalog/skills/<name>/, its SKILL.md given Pono's family and the source in
 * its metadata. A new version is a new commit here, read before it is merged.
 *
 *   GITHUB_TOKEN=$(gh auth token) pnpm --filter @pono/api exec tsx scripts/vendor-skills.ts
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as toYaml } from 'yaml';

interface Pinned {
  name: string;
  repo: string;
  path: string;
  sha: string;
  family: 'safety' | 'opinion' | 'design';
  license: string;
}

export const PINNED: Pinned[] = [
  {
    name: 'frontend-design',
    repo: 'anthropics/skills',
    path: 'skills/frontend-design',
    sha: '2c5958ecac7cee2b583967a2c4981d0f4a75c579',
    family: 'design',
    license: 'Apache-2.0',
  },
  {
    name: 'webapp-testing',
    repo: 'anthropics/skills',
    path: 'skills/webapp-testing',
    sha: '2c5958ecac7cee2b583967a2c4981d0f4a75c579',
    family: 'opinion',
    license: 'Apache-2.0',
  },
  {
    name: 'supabase-postgres-best-practices',
    repo: 'supabase/agent-skills',
    path: 'skills/supabase-postgres-best-practices',
    sha: 'c9be0e931b7930f7d02126d04774d904c381e7d7',
    family: 'opinion',
    license: 'MIT',
  },
];

const token = process.env.GITHUB_TOKEN;
const headers: Record<string, string> = {
  accept: 'application/vnd.github+json',
  'user-agent': 'pono',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
};
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'catalog', 'skills');

/** Files a skill folder may carry in Pono's catalog; the rest stays upstream. */
const KEPT = /^(SKILL\.md|LICENSE(\.txt|\.md)?|(references|scripts|assets|examples)\/.+)$/;

for (const p of PINNED) {
  const tree = (await (
    await fetch(`https://api.github.com/repos/${p.repo}/git/trees/${p.sha}?recursive=1`, {
      headers,
    })
  ).json()) as { tree: { path: string; type: string }[] };
  const files = tree.tree
    .filter((e) => e.type === 'blob' && e.path.startsWith(`${p.path}/`))
    .map((e) => e.path.slice(p.path.length + 1))
    .filter((f) => KEPT.test(f) && !f.split('/').some((part) => part.startsWith('_')));
  const dir = join(root, p.name);
  rmSync(dir, { recursive: true, force: true });
  for (const file of files) {
    const res = await fetch(
      `https://raw.githubusercontent.com/${p.repo}/${p.sha}/${p.path}/${file}`,
      { headers: { 'user-agent': 'pono' } },
    );
    if (!res.ok) throw new Error(`${p.repo}/${p.path}/${file}: ${res.status}`);
    let text = await res.text();
    if (file === 'SKILL.md') {
      const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.trimStart())!;
      const meta = parseYaml(m[1]!) as Record<string, unknown>;
      meta.name = p.name;
      meta.license = p.license;
      meta.metadata = {
        ...((meta.metadata as object) ?? {}),
        family: p.family,
        author: p.repo.split('/')[0],
        source: `https://github.com/${p.repo}/tree/${p.sha}/${p.path}`,
      };
      text = `---\n${toYaml(meta, { lineWidth: 0 }).trimEnd()}\n---\n\n${m[2]!.trim()}\n`;
    }
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  console.log(`${p.name}: ${files.length} files at ${p.repo}@${p.sha.slice(0, 7)}`);
}
