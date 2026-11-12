import type { Connectable } from '../../features/connections/index.js';
import type { Deployment, HostedSite, Hosting } from '../../features/projects/index.js';
import { fetchJson, ProviderError, type Fetch } from '../../platform/http.js';
import { repositoryOfUrl } from './netlify.js';

const ID = 'coolify';

interface Credential {
  url: string;
  token: string;
}

interface AppAnswer {
  uuid: string;
  name: string;
  git_repository?: string | null;
  git_branch?: string | null;
  fqdn?: string | null;
  updated_at?: string | null;
}

interface DeploymentAnswer {
  deployment_uuid: string;
  status: string;
  commit?: string | null;
  pull_request_id?: number | null;
  created_at: string;
}

const parse = (credential: string): Credential => JSON.parse(credential) as Credential;

/** `owner/repo`, `https://github.com/owner/repo(.git)` or `git@github.com:owner/repo.git`. */
function repositoryOf(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^[\w.-]+\/[\w.-]+$/.test(value)) return value.replace(/\.git$/, '').toLowerCase();
  return repositoryOfUrl(value);
}

export function coolifyStatus(status: string): Deployment['status'] {
  if (status === 'finished') return 'succeeded';
  if (status === 'failed') return 'failed';
  if (status.startsWith('cancelled')) return 'cancelled';
  return 'building';
}

function site(a: AppAnswer): HostedSite {
  const first = a.fqdn?.split(',')[0]?.trim();
  return {
    ref: a.uuid,
    productionUrl: first || null,
    productionBranch: a.git_branch ?? null,
    updatedAt: a.updated_at ? new Date(a.updated_at) : null,
  };
}

/**
 * Coolify (self-hosted, any technology in a container): the hosting for backends that Netlify and
 * Cloudflare do not run (D-018). Its address and an API token of the instance.
 */
export function coolifyHosting(fetchImpl: Fetch): Hosting & Connectable {
  const call = <T>(c: Credential, path: string, method = 'GET', body?: unknown) =>
    fetchJson<T>(fetchImpl, {
      provider: ID,
      url: `${c.url}/api/v1${path}`,
      method,
      headers: { authorization: `Bearer ${c.token}` },
      ...(body === undefined ? {} : { body }),
    });
  const apps = (c: Credential) => call<AppAnswer[]>(c, '/applications');
  const deployments = async (c: Credential, uuid: string) => {
    const answer = await call<{ deployments?: DeploymentAnswer[] } | DeploymentAnswer[]>(
      c,
      `/deployments/applications/${uuid}?skip=0&take=20`,
    );
    return Array.isArray(answer) ? answer : (answer.deployments ?? []);
  };

  return {
    id: ID,
    kind: 'hosting',
    fields: ['url', 'token'],
    async verify(fields) {
      const url = (fields.url ?? '').replace(/\/+$/, '');
      if (!/^https:\/\/\S+$/.test(url))
        throw new ProviderError(ID, 400, 'The address must start with https://');
      const credential = { url, token: fields.token! };
      const found = await apps(credential);
      return {
        account: `${new URL(url).host} · ${found.length} apps`,
        credential: JSON.stringify(credential),
      };
    },
    async findSite(credential, repository) {
      const wanted = repository.fullName.toLowerCase();
      const matches = (await apps(parse(credential))).filter(
        (a) => repositoryOf(a.git_repository) === wanted,
      );
      if (!matches.length) return null;
      // The application that builds the default branch, else the first one.
      const best = matches.find((a) => a.git_branch === repository.defaultBranch) ?? matches[0]!;
      return site(best);
    },
    async site(credential, ref) {
      try {
        return site(await call<AppAnswer>(parse(credential), `/applications/${ref}`));
      } catch (error) {
        if (error instanceof ProviderError && error.status === 404) return null;
        throw error;
      }
    },
    async deployments(credential, ref) {
      return (await deployments(parse(credential), ref)).map((d) => ({
        externalId: d.deployment_uuid,
        environment: d.pull_request_id ? 'preview' : 'production',
        status: coolifyStatus(d.status),
        url: null,
        commitSha: d.commit && d.commit !== 'HEAD' ? d.commit : null,
        createdAt: new Date(d.created_at),
      }));
    },
    /**
     * Coolify has no rollback call: the application is pinned to the commit of the previous
     * successful deployment, then deployed. It stays pinned until a person sets it back to HEAD.
     */
    async rollback(credential, ref) {
      const c = parse(credential);
      const done = (await deployments(c, ref))
        .filter(
          (d) => !d.pull_request_id && d.status === 'finished' && d.commit && d.commit !== 'HEAD',
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      const previous = done[1];
      if (!previous?.commit)
        throw new ProviderError(ID, 409, 'No earlier successful deployment to go back to.');
      await call(c, `/applications/${ref}`, 'PATCH', { git_commit_sha: previous.commit });
      await call(c, `/deploy?uuid=${encodeURIComponent(ref)}&force=false`);
    },
  };
}
