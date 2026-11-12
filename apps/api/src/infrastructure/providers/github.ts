import type { Connectable } from '../../features/connections/index.js';
import type { CodeHost, Repository } from '../../features/projects/index.js';
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
