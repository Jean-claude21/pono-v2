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
        created = input.starter
          ? await fetchJson<RepoAnswer>(fetchImpl, {
              provider: ID,
              url: `${API}/repos/${input.starter}/generate`,
              method: 'POST',
              headers: headers(token),
              body: {
                name: input.name,
                private: input.private,
                description: input.description,
                include_all_branches: false,
              },
            })
          : await fetchJson<RepoAnswer>(fetchImpl, {
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
        // A generated repository fills in a moment: its first write may answer 404 or 409.
        for (let attempt = 0; ; attempt++) {
          try {
            let sha: string | undefined;
            try {
              sha = (
                await fetchJson<{ sha: string }>(fetchImpl, {
                  provider: ID,
                  url: `${API}/repos/${created.full_name}/contents/${path}`,
                  headers: headers(token),
                })
              ).sha;
            } catch (error) {
              if (!(error instanceof ProviderError && error.status === 404)) throw error;
            }
            await fetchJson(fetchImpl, {
              provider: ID,
              url: `${API}/repos/${created.full_name}/contents/${path}`,
              method: 'PUT',
              headers: headers(token),
              body: {
                message: `chore: ${path} by Pono`,
                content: Buffer.from(content, 'utf8').toString('base64'),
                ...(sha ? { sha } : {}),
              },
            });
            break;
          } catch (error) {
            const retry =
              error instanceof ProviderError && (error.status === 404 || error.status === 409);
            if (!retry || attempt >= 5) throw error;
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          }
        }
      }
      return repository(created);
    },
    async listDirectory(token, fullName, path, ref) {
      try {
        const entries = await fetchJson<{ name: string; type: string }[] | { type: string }>(
          fetchImpl,
          {
            provider: ID,
            url: `${API}/repos/${fullName}/contents/${path}?ref=${encodeURIComponent(ref)}`,
            headers: headers(token),
          },
        );
        return Array.isArray(entries)
          ? entries.filter((e) => e.type === 'file').map((e) => e.name)
          : [];
      } catch (error) {
        if (error instanceof ProviderError && error.status === 404) return [];
        throw error;
      }
    },
    gitAccess(token, fullName) {
      return {
        url: `https://github.com/${fullName}.git`,
        header: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
      };
    },
    async markAsTemplate(token, fullName) {
      await fetchJson(fetchImpl, {
        provider: ID,
        url: `${API}/repos/${fullName}`,
        method: 'PATCH',
        headers: headers(token),
        body: { is_template: true },
      });
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
    async proposeFiles(token, fullName, input) {
      const base = await fetchJson<{ object: { sha: string } }>(fetchImpl, {
        provider: ID,
        url: `${API}/repos/${fullName}/git/ref/heads/${encodeURIComponent(input.base)}`,
        headers: headers(token),
      });
      try {
        await fetchJson(fetchImpl, {
          provider: ID,
          url: `${API}/repos/${fullName}/git/refs`,
          method: 'POST',
          headers: headers(token),
          body: { ref: `refs/heads/${input.branch}`, sha: base.object.sha },
        });
      } catch (error) {
        // The branch exists from an earlier proposal: its files are updated in place.
        if (!(error instanceof ProviderError && error.status === 422)) throw error;
      }
      for (const [path, content] of Object.entries(input.files)) {
        let sha: string | undefined;
        try {
          sha = (
            await fetchJson<{ sha: string }>(fetchImpl, {
              provider: ID,
              url: `${API}/repos/${fullName}/contents/${path}?ref=${encodeURIComponent(input.branch)}`,
              headers: headers(token),
            })
          ).sha;
        } catch (error) {
          if (!(error instanceof ProviderError && error.status === 404)) throw error;
        }
        await fetchJson(fetchImpl, {
          provider: ID,
          url: `${API}/repos/${fullName}/contents/${path}`,
          method: 'PUT',
          headers: headers(token),
          body: {
            message: `chore: ${path} by Pono`,
            branch: input.branch,
            content: Buffer.from(content, 'utf8').toString('base64'),
            ...(sha ? { sha } : {}),
          },
        });
      }
      const [owner] = fullName.split('/');
      const open = await fetchJson<{ number: number; html_url: string }[]>(fetchImpl, {
        provider: ID,
        url: `${API}/repos/${fullName}/pulls?state=open&head=${owner}:${encodeURIComponent(input.branch)}`,
        headers: headers(token),
      });
      if (open[0]) return { number: open[0].number, url: open[0].html_url };
      const pull = await fetchJson<{ number: number; html_url: string }>(fetchImpl, {
        provider: ID,
        url: `${API}/repos/${fullName}/pulls`,
        method: 'POST',
        headers: headers(token),
        body: { title: input.title, body: input.body, head: input.branch, base: input.base },
      });
      return { number: pull.number, url: pull.html_url };
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
