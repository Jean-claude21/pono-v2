/**
 * Which project a conversation means (D-008): « on continue lectio », or « continue ce projet » in a
 * folder whose git remote names the repository. Pono never guesses between two: it asks.
 */

export interface Candidate {
  id: string;
  name: string;
  repository: string;
  lastActivity: Date | null;
}

export type Recognition =
  | { kind: 'found'; project: Candidate; by: 'repository' | 'name' | 'partial' }
  | { kind: 'ambiguous'; candidates: Candidate[] }
  | { kind: 'none'; recent: Candidate[] };

/** `git@github.com:Owner/Repo.git`, `https://github.com/Owner/Repo` → `owner/repo`. */
export function repositoryOf(remoteOrName: string): string | null {
  const s = remoteOrName
    .trim()
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
  const url = s.match(/[:/]([^/:]+)\/([^/:]+)$/);
  if (url && (s.includes('github') || s.includes('gitlab') || s.includes('://') || s.includes('@')))
    return `${url[1]}/${url[2]}`.toLowerCase();
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return s.toLowerCase();
  return null;
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');

export function recognize(
  projects: Candidate[],
  hint: { query?: string | undefined; repository?: string | undefined },
): Recognition {
  const byRecent = [...projects].sort(
    (a, b) => (b.lastActivity?.getTime() ?? 0) - (a.lastActivity?.getTime() ?? 0),
  );
  if (hint.repository) {
    const repo = repositoryOf(hint.repository);
    const found = repo ? projects.find((p) => p.repository.toLowerCase() === repo) : undefined;
    if (found) return { kind: 'found', project: found, by: 'repository' };
  }
  const query = hint.query ? normalize(hint.query) : '';
  if (query) {
    const exact = projects.filter(
      (p) => normalize(p.name) === query || normalize(p.repository) === query,
    );
    if (exact.length === 1) return { kind: 'found', project: exact[0]!, by: 'name' };
    if (exact.length > 1) return { kind: 'ambiguous', candidates: exact };
    const partial = projects.filter(
      (p) => normalize(p.name).includes(query) || query.includes(normalize(p.name)),
    );
    if (partial.length === 1) return { kind: 'found', project: partial[0]!, by: 'partial' };
    if (partial.length > 1) return { kind: 'ambiguous', candidates: partial };
  }
  return { kind: 'none', recent: byRecent.slice(0, 5) };
}
