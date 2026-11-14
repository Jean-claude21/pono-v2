import type { SiteAnalytics, SiteStats } from '../../features/analytics/ports.js';
import type { Connectable } from '../../features/connections/index.js';
import { fetchJson, ProviderError, type Fetch } from '../../platform/http.js';

const CLOUD_API = 'https://api.umami.is/v1';
const CLOUD_SCRIPT = 'https://cloud.umami.is/script.js';

interface Website {
  id: string;
  name: string;
  domain: string | null;
}

/** A figure in either shape Umami answers: `{ value }` (v2) or a plain number (v3). */
function figure(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'value' in v)
    return Number((v as { value: unknown }).value) || 0;
  return 0;
}

type Access = { api: string; script: string; headers: Record<string, string> };

/**
 * Umami (D-017), first of the analytics providers: Umami Cloud with an API key, or a self-hosted
 * Umami with its address and an account.
 */
function umami(
  fetchImpl: Fetch,
  id: string,
  fields: readonly string[],
  access: (credential: string) => Promise<Access>,
  encode: (fields: Record<string, string>) => string,
): SiteAnalytics & Connectable {
  const call = async <T>(credential: string, path: string, method = 'GET', body?: unknown) => {
    const a = await access(credential);
    return fetchJson<T>(fetchImpl, {
      provider: id,
      url: `${a.api}${path}`,
      method,
      headers: a.headers,
      ...(body === undefined ? {} : { body }),
    });
  };
  const sites = async (credential: string) => {
    const answer = await call<{ data?: Website[] } | Website[]>(
      credential,
      '/websites?pageSize=100',
    );
    const list = Array.isArray(answer) ? answer : (answer.data ?? []);
    return list.map((w) => ({ ref: w.id, name: w.name, domain: w.domain ?? null }));
  };
  const metrics = async (credential: string, site: string, query: string, types: string[]) => {
    for (const type of types) {
      try {
        return await call<{ x: string; y: number }[]>(
          credential,
          `/websites/${site}/metrics?${query}&type=${type}&limit=5`,
        );
      } catch (error) {
        if (!(error instanceof ProviderError && error.status === 400)) throw error;
      }
    }
    return [];
  };

  return {
    id,
    kind: 'analytics',
    fields,
    async verify(given) {
      const credential = encode(given);
      const found = await sites(credential);
      return { account: `${found.length} sites`, credential };
    },
    listSites: sites,
    async createSite(credential, input) {
      const created = await call<Website>(credential, '/websites', 'POST', {
        name: input.name,
        domain: input.domain,
      });
      const { script } = await access(credential);
      return {
        ref: created.id,
        name: created.name,
        domain: created.domain ?? input.domain,
        script: `<script defer src="${script}" data-website-id="${created.id}"></script>`,
      };
    },
    async stats(credential, site, range): Promise<SiteStats> {
      const query = `startAt=${range.from.getTime()}&endAt=${range.to.getTime()}`;
      const s = await call<Record<string, unknown>>(credential, `/websites/${site}/stats?${query}`);
      const visits = figure(s.visits);
      const pages = await metrics(credential, site, query, ['url', 'path']);
      const referrers = await metrics(credential, site, query, ['referrer']);
      return {
        pageviews: figure(s.pageviews),
        visitors: figure(s.visitors),
        visits,
        bounceRate: visits > 0 ? Math.min(1, figure(s.bounces) / visits) : null,
        topPages: pages.map((p) => ({ path: p.x, views: p.y })),
        topReferrers: referrers.map((r) => ({ source: r.x || '(direct)', visits: r.y })),
      };
    },
  };
}

/** Umami Cloud: an API key from the Umami Cloud settings. */
export function umamiCloud(fetchImpl: Fetch): SiteAnalytics & Connectable {
  return {
    ...umami(
      fetchImpl,
      'umami',
      ['apiKey'],
      async (credential) => ({
        api: CLOUD_API,
        script: CLOUD_SCRIPT,
        headers: { 'x-umami-api-key': credential },
      }),
      (fields) => fields.apiKey!,
    ),
    keyUrl: 'https://cloud.umami.is/settings/api-keys',
    keyScopes: 'An API key',
  };
}

interface SelfHosted {
  url: string;
  username: string;
  password: string;
}

/** A self-hosted Umami: its address and an account; a short-lived token is asked for each use. */
export function umamiSelfHosted(fetchImpl: Fetch): SiteAnalytics & Connectable {
  return umami(
    fetchImpl,
    'umami-self',
    ['url', 'username', 'password'],
    async (credential) => {
      const c = JSON.parse(credential) as SelfHosted;
      const base = c.url.replace(/\/+$/, '');
      const { token } = await fetchJson<{ token: string }>(fetchImpl, {
        provider: 'umami-self',
        url: `${base}/api/auth/login`,
        method: 'POST',
        body: { username: c.username, password: c.password },
      });
      return {
        api: `${base}/api`,
        script: `${base}/script.js`,
        headers: { authorization: `Bearer ${token}` },
      };
    },
    (fields) => {
      if (!/^https:\/\/\S+$/.test(fields.url ?? ''))
        throw new ProviderError('umami-self', 400, 'The address must start with https://');
      return JSON.stringify({
        url: fields.url,
        username: fields.username,
        password: fields.password,
      });
    },
  );
}
