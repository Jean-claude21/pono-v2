import type { Connectable } from '../../features/connections/index.js';
import type { Deployment, HostedSite, Hosting, Repository } from '../../features/projects/index.js';
import { fetchJson, ProviderError, type Fetch } from '../../platform/http.js';

/**
 * Vercel as hosting (D-042). Vercel reaches the repository through its own GitHub app: a project
 * linked to it builds the production branch on every push, and every other branch (`dev`) as a
 * preview with the commit it built — what a proposal's preview guard reads.
 *
 * A Vercel account is a team: the credential keeps the token and the team it acts in
 * (`vc1:<team>:<token>`), read once at connection.
 */
const ID = 'vercel';
const API = 'https://api.vercel.com';

interface ProjectAnswer {
  id: string;
  name: string;
  updatedAt?: number | null;
  link?: { type?: string; org?: string; repo?: string; productionBranch?: string } | null;
  targets?: { production?: { alias?: string[] | null; url?: string | null } | null } | null;
  alias?: { domain: string }[] | null;
}

interface DeploymentAnswer {
  uid: string;
  state?: string;
  readyState?: string;
  target?: string | null;
  url?: string | null;
  created?: number;
  createdAt?: number;
  meta?: { githubCommitSha?: string } | null;
}

export function encodeVercel(token: string, team: string | null): string {
  return `vc1:${team ?? ''}:${token}`;
}

export function decodeVercel(credential: string): { token: string; team: string | null } {
  const m = credential.match(/^vc1:([^:]*):(.+)$/);
  return m ? { token: m[2]!, team: m[1] || null } : { token: credential, team: null };
}

export function vercelStatus(state: string | undefined): Deployment['status'] {
  if (state === 'READY') return 'succeeded';
  if (state === 'ERROR') return 'failed';
  if (state === 'CANCELED' || state === 'DELETED') return 'cancelled';
  return 'building';
}

function site(p: ProjectAnswer): HostedSite {
  const domain =
    p.targets?.production?.alias?.[0] ?? p.alias?.[0]?.domain ?? `${p.name}.vercel.app`;
  return {
    ref: p.id,
    productionUrl: `https://${domain}`,
    productionBranch: p.link?.productionBranch ?? null,
    updatedAt: p.updatedAt ? new Date(p.updatedAt) : null,
  };
}

export function vercelHosting(fetchImpl: Fetch): Hosting & Connectable {
  const call = <T>(credential: string, path: string, method = 'GET', body?: unknown) => {
    const { token, team } = decodeVercel(credential);
    const url = new URL(`${API}${path}`);
    if (team) url.searchParams.set('teamId', team);
    return fetchJson<T>(fetchImpl, {
      provider: ID,
      url: url.toString(),
      method,
      headers: { authorization: `Bearer ${token}`, 'user-agent': 'pono' },
      ...(body === undefined ? {} : { body }),
    });
  };
  const project = async (credential: string, ref: string) => {
    try {
      return await call<ProjectAnswer>(credential, `/v9/projects/${encodeURIComponent(ref)}`);
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404) return null;
      throw error;
    }
  };
  const deploy = (credential: string, p: ProjectAnswer, branch: string, production: boolean) => {
    const [org, repo] = [p.link?.org, p.link?.repo];
    if (!org || !repo) return Promise.resolve();
    return call(credential, '/v13/deployments', 'POST', {
      name: p.name,
      project: p.id,
      ...(production ? { target: 'production' } : {}),
      gitSource: { type: 'github', org, repo, ref: branch },
    }).then(() => undefined);
  };

  return {
    id: ID,
    kind: 'hosting',
    fields: ['token'],
    keyUrl: 'https://vercel.com/account/settings/tokens',
    serverDomains: ['api.vercel.com', '*.vercel.app'],
    keyScopes: 'An access token for the team the projects live in (no expiry, or the longest)',
    async verify(fields) {
      const token = fields.token!;
      const { user } = await fetchJson<{
        user: {
          name?: string | null;
          username?: string;
          email?: string;
          defaultTeamId?: string | null;
        };
      }>(fetchImpl, {
        provider: ID,
        url: `${API}/v2/user`,
        headers: { authorization: `Bearer ${token}`, 'user-agent': 'pono' },
      });
      return {
        account: user.name || user.username || 'Vercel',
        credential: encodeVercel(token, user.defaultTeamId ?? null),
      };
    },
    async findSite(credential, repository: Repository) {
      const { projects } = await call<{ projects: ProjectAnswer[] }>(
        credential,
        `/v10/projects?repoUrl=${encodeURIComponent(`https://github.com/${repository.fullName}`)}&limit=20`,
      );
      const wanted = repository.fullName.toLowerCase();
      const linked = projects
        .filter((p) => `${p.link?.org}/${p.link?.repo}`.toLowerCase() === wanted)
        .map(site)
        .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
      return linked[0] ?? null;
    },
    async site(credential, ref) {
      const p = await project(credential, ref);
      return p ? site(p) : null;
    },
    async deployments(credential, ref) {
      const { deployments } = await call<{ deployments: DeploymentAnswer[] }>(
        credential,
        `/v7/deployments?projectId=${encodeURIComponent(ref)}&limit=10`,
      );
      return deployments.map((d) => ({
        externalId: d.uid,
        environment: d.target === 'production' ? 'production' : 'preview',
        status: vercelStatus(d.readyState ?? d.state),
        url: d.url ? `https://${d.url}` : null,
        commitSha: d.meta?.githubCommitSha ?? null,
        createdAt: new Date(d.createdAt ?? d.created ?? 0),
      }));
    },
    async rollback(credential, ref) {
      const { deployments } = await call<{ deployments: DeploymentAnswer[] }>(
        credential,
        `/v7/deployments?projectId=${encodeURIComponent(ref)}&target=production&state=READY&limit=2`,
      );
      const previous = deployments[1];
      if (!previous) throw new ProviderError(ID, 409, 'No previous production deployment.');
      await call(
        credential,
        `/v1/projects/${encodeURIComponent(ref)}/rollback/${previous.uid}`,
        'POST',
      );
    },
    async createLinkedSite(credential, input) {
      const created = await call<ProjectAnswer>(credential, '/v11/projects', 'POST', {
        name: input.name,
        gitRepository: { type: 'github', repo: input.repository },
      });
      // A first production build now; then every push builds by itself, dev as a preview.
      await deploy(credential, created, input.branch, true).catch(() => undefined);
      if (input.branch !== 'dev')
        await deploy(credential, created, 'dev', false).catch(() => undefined);
      return { site: site(created) };
    },
    async startBuild(credential, ref) {
      const p = await project(credential, ref);
      if (p) await deploy(credential, p, p.link?.productionBranch ?? 'main', true);
    },
    async buildBranch(credential, ref, branch) {
      const p = await project(credential, ref);
      if (p) await deploy(credential, p, branch, false);
    },
  };
}
