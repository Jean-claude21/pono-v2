import type { Connectable } from '../../features/connections/index.js';
import type { Deployment, HostedSite, Hosting } from '../../features/projects/index.js';
import { fetchJson, ProviderError, type Fetch } from '../../platform/http.js';

const ID = 'netlify';
const API = 'https://api.netlify.com/api/v1';

interface SiteAnswer {
  id: string;
  name: string;
  url: string | null;
  ssl_url: string | null;
  updated_at: string | null;
  build_settings?: { repo_url?: string | null; repo_branch?: string | null } | null;
}

interface DeployAnswer {
  id: string;
  state: string;
  context: string;
  deploy_ssl_url: string | null;
  commit_ref: string | null;
  created_at: string;
}

const headers = (token: string) => ({ authorization: `Bearer ${token}`, 'user-agent': 'pono' });

/** `https://github.com/Owner/Repo(.git)` → `owner/repo`. */
export function repositoryOfUrl(url: string | null | undefined): string | null {
  const match = url?.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}

function site(s: SiteAnswer): HostedSite {
  return {
    ref: s.id,
    productionUrl: s.ssl_url ?? s.url,
    productionBranch: s.build_settings?.repo_branch ?? null,
    updatedAt: s.updated_at ? new Date(s.updated_at) : null,
  };
}

export function deploymentStatus(state: string): Deployment['status'] {
  if (state === 'ready') return 'succeeded';
  if (state === 'error' || state === 'rejected') return 'failed';
  if (state === 'skipped' || state === 'cancelled') return 'cancelled';
  return 'building';
}

/** Netlify sites as hosting; with Pono's OAuth application, a click instead of a key. */
export function netlifyHosting(
  fetchImpl: Fetch,
  app?: { clientId: string; clientSecret: string },
): Hosting & Connectable {
  const account = async (token: string) => {
    const user = await fetchJson<{
      full_name?: string | null;
      email?: string | null;
      slug?: string | null;
    }>(fetchImpl, {
      provider: ID,
      url: `${API}/user`,
      headers: headers(token),
    });
    return { account: user.full_name || user.email || user.slug || 'Netlify', credential: token };
  };
  return {
    id: ID,
    kind: 'hosting',
    fields: ['token'],
    keyUrl: 'https://app.netlify.com/user/applications#personal-access-tokens',
    serverDomains: ['api.netlify.com', '*.netlify.app'],
    keyScopes: 'A personal access token (no expiry, or the longest you accept)',
    ...(app
      ? {
          oauth: {
            authorizeUrl: (state: string, redirectUri: string) =>
              `https://app.netlify.com/authorize?${new URLSearchParams({
                client_id: app.clientId,
                response_type: 'code',
                redirect_uri: redirectUri,
                state,
              })}`,
            async exchange(code: string, redirectUri: string) {
              const answer = await fetchJson<{ access_token: string }>(fetchImpl, {
                provider: ID,
                url: 'https://api.netlify.com/oauth/token',
                method: 'POST',
                body: {
                  grant_type: 'authorization_code',
                  code,
                  client_id: app.clientId,
                  client_secret: app.clientSecret,
                  redirect_uri: redirectUri,
                },
              });
              return account(answer.access_token);
            },
          },
        }
      : {}),
    async verify(fields) {
      return account(fields.token!);
    },
    async newDeployKey(token) {
      const key = await fetchJson<{ id: string; public_key: string }>(fetchImpl, {
        provider: ID,
        url: `${API}/deploy_keys`,
        method: 'POST',
        headers: headers(token),
      });
      return { id: key.id, publicKey: key.public_key };
    },
    async createSite(token, input) {
      // `repo_path` is the git address: Netlify clones it with the deploy key (D-037).
      const created = await fetchJson<SiteAnswer & { deploy_hook?: string | null }>(fetchImpl, {
        provider: ID,
        url: `${API}/sites`,
        method: 'POST',
        headers: headers(token),
        body: {
          name: input.name,
          repo: {
            provider: 'manual',
            repo_path: input.gitUrl,
            repo_url: input.gitUrl,
            repo_branch: input.branch,
            deploy_key_id: input.deployKeyId,
          },
        },
      });
      return { site: site(created), pushHookUrl: created.deploy_hook ?? null };
    },
    async startBuild(token, ref) {
      await fetchJson(fetchImpl, {
        provider: ID,
        url: `${API}/sites/${ref}/builds`,
        method: 'POST',
        headers: headers(token),
      });
    },
    async findSite(token, repository) {
      const sites = await fetchJson<SiteAnswer[]>(fetchImpl, {
        provider: ID,
        url: `${API}/sites?per_page=100&filter=all`,
        headers: headers(token),
      });
      const wanted = repository.fullName.toLowerCase();
      const matching = sites
        .filter((s) => repositoryOfUrl(s.build_settings?.repo_url) === wanted)
        .map(site)
        .sort((a, b) => {
          const onBranch = (x: HostedSite) =>
            x.productionBranch === repository.defaultBranch ? 1 : 0;
          return (
            onBranch(b) - onBranch(a) ||
            (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0)
          );
        });
      return matching[0] ?? null;
    },
    async site(token, ref) {
      try {
        return site(
          await fetchJson<SiteAnswer>(fetchImpl, {
            provider: ID,
            url: `${API}/sites/${ref}`,
            headers: headers(token),
          }),
        );
      } catch (error) {
        if (error instanceof ProviderError && error.status === 404) return null;
        throw error;
      }
    },
    async deployments(token, ref) {
      const deploys = await fetchJson<DeployAnswer[]>(fetchImpl, {
        provider: ID,
        url: `${API}/sites/${ref}/deploys?per_page=10`,
        headers: headers(token),
      });
      return deploys.map((d) => ({
        externalId: d.id,
        environment: d.context === 'production' ? 'production' : 'preview',
        status: deploymentStatus(d.state),
        url: d.deploy_ssl_url,
        commitSha: d.commit_ref,
        createdAt: new Date(d.created_at),
      }));
    },
    async rollback(token, ref) {
      await fetchJson(fetchImpl, {
        provider: ID,
        url: `${API}/sites/${ref}/rollback`,
        method: 'PUT',
        headers: headers(token),
      });
    },
  };
}
