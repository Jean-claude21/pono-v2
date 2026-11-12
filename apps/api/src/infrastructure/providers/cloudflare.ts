import type { Connectable } from '../../features/connections/index.js';
import type { Deployment, HostedSite, Hosting } from '../../features/projects/index.js';
import { fetchJson, ProviderError, type Fetch } from '../../platform/http.js';

const ID = 'cloudflare';
const API = 'https://api.cloudflare.com/client/v4';

interface Envelope<T> {
  success: boolean;
  result: T;
}

interface PagesProject {
  name: string;
  subdomain: string | null;
  domains?: string[];
  production_branch: string | null;
  created_on: string | null;
  source?: { type?: string; config?: { owner?: string; repo_name?: string } } | null;
  latest_deployment?: { created_on?: string } | null;
}

interface PagesDeployment {
  id: string;
  url: string | null;
  environment: string;
  created_on: string;
  latest_stage?: { name?: string; status?: string } | null;
  deployment_trigger?: { metadata?: { commit_hash?: string | null } | null } | null;
}

/** The credential keeps the token and the account it reads. */
interface Credential {
  token: string;
  accountId: string;
}

const parse = (credential: string): Credential => JSON.parse(credential) as Credential;
const headers = (token: string) => ({ authorization: `Bearer ${token}` });

function site(p: PagesProject): HostedSite {
  const custom = (p.domains ?? []).find((d) => !d.endsWith('.pages.dev'));
  const host = custom ?? p.subdomain;
  return {
    ref: p.name,
    productionUrl: host ? `https://${host}` : null,
    productionBranch: p.production_branch,
    updatedAt: p.latest_deployment?.created_on
      ? new Date(p.latest_deployment.created_on)
      : p.created_on
        ? new Date(p.created_on)
        : null,
  };
}

export function deploymentStatus(stage: PagesDeployment['latest_stage']): Deployment['status'] {
  if (stage?.status === 'failure') return 'failed';
  if (stage?.status === 'canceled') return 'cancelled';
  if (stage?.name === 'deploy' && stage.status === 'success') return 'succeeded';
  return 'building';
}

/** Cloudflare Pages projects as hosting. */
export function cloudflareHosting(fetchImpl: Fetch): Hosting & Connectable {
  const get = <T>(token: string, path: string) =>
    fetchJson<Envelope<T>>(fetchImpl, {
      provider: ID,
      url: `${API}${path}`,
      headers: headers(token),
    }).then((e) => e.result);

  return {
    id: ID,
    kind: 'hosting',
    fields: ['token', 'accountId'],
    async verify(fields) {
      const credential: Credential = { token: fields.token!, accountId: fields.accountId! };
      // A user token verifies at /user, an account token at its account.
      await get(credential.token, '/user/tokens/verify').catch(() =>
        get(credential.token, `/accounts/${credential.accountId}/tokens/verify`),
      );
      const account = await get<{ name: string }>(
        credential.token,
        `/accounts/${credential.accountId}`,
      );
      return { account: account.name, credential: JSON.stringify(credential) };
    },
    async findSite(credential, repository) {
      const { token, accountId } = parse(credential);
      const projects = await get<PagesProject[]>(token, `/accounts/${accountId}/pages/projects`);
      const wanted = repository.fullName.toLowerCase();
      const match = projects.find((p) => {
        const c = p.source?.config;
        return c?.owner && c.repo_name && `${c.owner}/${c.repo_name}`.toLowerCase() === wanted;
      });
      return match ? site(match) : null;
    },
    async site(credential, ref) {
      const { token, accountId } = parse(credential);
      try {
        return site(await get<PagesProject>(token, `/accounts/${accountId}/pages/projects/${ref}`));
      } catch (error) {
        if (error instanceof ProviderError && error.status === 404) return null;
        throw error;
      }
    },
    async deployments(credential, ref) {
      const { token, accountId } = parse(credential);
      const deployments = await get<PagesDeployment[]>(
        token,
        `/accounts/${accountId}/pages/projects/${ref}/deployments`,
      );
      return deployments.slice(0, 10).map((d) => ({
        externalId: d.id,
        environment: d.environment === 'production' ? 'production' : 'preview',
        status: deploymentStatus(d.latest_stage),
        url: d.url,
        commitSha: d.deployment_trigger?.metadata?.commit_hash ?? null,
        createdAt: new Date(d.created_on),
      }));
    },
    async rollback(credential, ref) {
      const { token, accountId } = parse(credential);
      const deployments = await get<PagesDeployment[]>(
        token,
        `/accounts/${accountId}/pages/projects/${ref}/deployments`,
      );
      const previous = deployments.filter(
        (d) => d.environment === 'production' && deploymentStatus(d.latest_stage) === 'succeeded',
      )[1];
      if (!previous) throw new ProviderError(ID, 409, 'No previous production deployment.');
      await fetchJson(fetchImpl, {
        provider: ID,
        url: `${API}/accounts/${accountId}/pages/projects/${ref}/deployments/${previous.id}/rollback`,
        method: 'POST',
        headers: headers(token),
      });
    },
  };
}
