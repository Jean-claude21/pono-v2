import type { Connectable } from '../../features/connections/index.js';
import type { CodeHost, Proposal, Repository } from '../../features/projects/index.js';
import type { ChangedFile } from '../../features/releases/guards.js';
import { fetchJson, ProviderError, type Fetch } from '../../platform/http.js';

const ID = 'github';
const API = 'https://api.github.com';

interface RepoAnswer {
  full_name: string;
  name: string;
  default_branch: string;
  html_url: string;
  private: boolean;
  pushed_at: string | null;
}

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'pono',
  };
}

function repository(r: RepoAnswer): Repository {
  return {
    fullName: r.full_name,
    name: r.name,
    defaultBranch: r.default_branch,
    url: r.html_url,
    private: r.private,
    pushedAt: r.pushed_at ? new Date(r.pushed_at) : null,
  };
}

/** GitHub as a code host: the repositories the signed-in person can read. */
export function githubCodeHost(fetchImpl: Fetch): CodeHost & Connectable {
  return {
    id: ID,
    kind: 'code_host',
    fields: ['token'],
    async verify(fields) {
      const token = fields.token!;
      const user = await fetchJson<{ login: string }>(fetchImpl, {
        provider: ID,
        url: `${API}/user`,
        headers: headers(token),
      });
      return { account: user.login, credential: token };
    },
    async listRepositories(token) {
      const repos = await fetchJson<RepoAnswer[]>(fetchImpl, {
        provider: ID,
        url: `${API}/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member`,
        headers: headers(token),
      });
      return repos.map(repository);
    },
    async createRepository(token, input) {
      let created: RepoAnswer;
      try {
        created = await fetchJson<RepoAnswer>(fetchImpl, {
          provider: ID,
          url: `${API}/user/repos`,
          method: 'POST',
          headers: headers(token),
          body: {
            name: input.name,
            private: input.private,
            description: input.description,
            auto_init: true,
          },
        });
      } catch (error) {
        if (error instanceof ProviderError && error.status === 422) {
          throw new ProviderError(ID, 409, 'A repository of that name exists.');
        }
        throw error;
      }
      for (const [path, content] of Object.entries(input.files)) {
        await fetchJson(fetchImpl, {
          provider: ID,
          url: `${API}/repos/${created.full_name}/contents/${path}`,
          method: 'PUT',
          headers: headers(token),
          body: {
            message: `chore: ${path} by Pono`,
            content: Buffer.from(content, 'utf8').toString('base64'),
          },
        });
      }
      return repository(created);
    },
    async listProposals(token, fullName, base) {
      const pulls = await fetchJson<
        { number: number; title: string; html_url: string; head: { sha: string; ref: string } }[]
      >(fetchImpl, {
        provider: ID,
        url: `${API}/repos/${fullName}/pulls?state=open&base=${encodeURIComponent(base)}&per_page=50`,
        headers: headers(token),
      });
      return pulls.map((p): Proposal => ({
        number: p.number,
        title: p.title,
        headSha: p.head.sha,
        branch: p.head.ref,
        url: p.html_url,
      }));
    },
    async proposalFiles(token, fullName, number) {
      const files = await fetchJson<
        { filename: string; status: string; patch?: string; changes: number }[]
      >(fetchImpl, {
        provider: ID,
        url: `${API}/repos/${fullName}/pulls/${number}/files?per_page=100`,
        headers: headers(token),
      });
      return files.map((f): ChangedFile => ({
        path: f.filename,
        status:
          f.status === 'removed'
            ? 'removed'
            : f.status === 'added'
              ? 'added'
              : f.status === 'renamed'
                ? 'renamed'
                : 'modified',
        patch: f.patch ?? (f.changes === 0 ? '' : null),
        binary: f.patch === undefined && f.changes === 0,
      }));
    },
    async fileAt(token, fullName, path, ref) {
      try {
        const file = await fetchJson<{ content?: string; encoding?: string }>(fetchImpl, {
          provider: ID,
          url: `${API}/repos/${fullName}/contents/${path}?ref=${encodeURIComponent(ref)}`,
          headers: headers(token),
        });
        return file.content ? Buffer.from(file.content, 'base64').toString('utf8') : null;
      } catch (error) {
        if (error instanceof ProviderError && error.status === 404) return null;
        throw error;
      }
    },
    async setReleaseStatus(token, fullName, sha, state, description) {
      await fetchJson(fetchImpl, {
        provider: ID,
        url: `${API}/repos/${fullName}/statuses/${sha}`,
        method: 'POST',
        headers: headers(token),
        body: { state, context: 'pono/release', description: description.slice(0, 140) },
      });
    },
    async merge(token, fullName, number, sha) {
      await fetchJson(fetchImpl, {
        provider: ID,
        url: `${API}/repos/${fullName}/pulls/${number}/merge`,
        method: 'PUT',
        headers: headers(token),
        body: { sha, merge_method: 'squash' },
      });
    },
    async protect(token, fullName, branch) {
      try {
        await fetchJson(fetchImpl, {
          provider: ID,
          url: `${API}/repos/${fullName}/branches/${encodeURIComponent(branch)}/protection`,
          method: 'PUT',
          headers: headers(token),
          body: {
            required_status_checks: { strict: false, contexts: ['pono/release'] },
            enforce_admins: true,
            required_pull_request_reviews: null,
            restrictions: null,
          },
        });
        return 'protected';
      } catch (error) {
        // Branch protection on a private repository needs a paid plan (D-004 of the first Pono).
        if (error instanceof ProviderError && error.status === 403) return 'unavailable_on_plan';
        throw error;
      }
    },
    async repository(token, fullName) {
      try {
        return repository(
          await fetchJson<RepoAnswer>(fetchImpl, {
            provider: ID,
            url: `${API}/repos/${fullName}`,
            headers: headers(token),
          }),
        );
      } catch (error) {
        if (error instanceof ProviderError && error.status === 404) return null;
        throw error;
      }
    },
  };
}
