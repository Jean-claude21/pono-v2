import type { SiteAnalytics } from '../../features/analytics/ports.js';
import type { Connectable } from '../../features/connections/index.js';
import { fetchJson, ProviderError, type Fetch } from '../../platform/http.js';

const ID = 'posthog';
const HOSTS: Record<string, string> = {
  us: 'https://us.posthog.com',
  eu: 'https://eu.posthog.com',
};

interface Credential {
  apiKey: string;
  host: string;
}

const parse = (credential: string): Credential => JSON.parse(credential) as Credential;
const at = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

/**
 * PostHog (D-017), behind the same port as Umami: a personal API key and its region. A site is a
 * PostHog project; Pono reads it, it does not create one.
 */
export function posthogAnalytics(fetchImpl: Fetch): SiteAnalytics & Connectable {
  const call = <T>(c: Credential, path: string, body?: unknown) =>
    fetchJson<T>(fetchImpl, {
      provider: ID,
      url: `${c.host}${path}`,
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${c.apiKey}` },
      ...(body === undefined ? {} : { body }),
    });
  const query = async (c: Credential, project: string, sql: string) =>
    (
      await call<{ results: unknown[][] }>(c, `/api/projects/${project}/query/`, {
        query: { kind: 'HogQLQuery', query: sql },
      })
    ).results;
  const sites = async (credential: string) => {
    const c = parse(credential);
    const answer = await call<{ results: { id: number; name: string }[] }>(c, '/api/projects/');
    return answer.results.map((p) => ({ ref: String(p.id), name: p.name, domain: null }));
  };

  return {
    id: ID,
    kind: 'analytics',
    fields: ['apiKey', 'host'],
    keyUrl: 'https://us.posthog.com/settings/user-api-keys',
    keyScopes: 'A personal API key, scopes: project read and write',
    async verify(fields) {
      const host = HOSTS[fields.host ?? ''] ?? fields.host ?? '';
      if (!/^https:\/\/\S+$/.test(host))
        throw new ProviderError(ID, 400, 'The region is us, eu, or an https address.');
      const credential = JSON.stringify({ apiKey: fields.apiKey, host: host.replace(/\/+$/, '') });
      const found = await sites(credential);
      return { account: `${found.length} projects`, credential };
    },
    listSites: sites,
    async createSite() {
      return null;
    },
    async stats(credential, site, range) {
      if (!/^\d+$/.test(site))
        throw new ProviderError(ID, 400, 'A PostHog project id is a number.');
      const c = parse(credential);
      const where = `event = '$pageview' AND timestamp >= toDateTime('${at(range.from)}') AND timestamp < toDateTime('${at(range.to)}')`;
      const [totals] = await query(
        c,
        site,
        `SELECT count(), count(DISTINCT person_id), count(DISTINCT properties.$session_id) FROM events WHERE ${where}`,
      );
      const pages = await query(
        c,
        site,
        `SELECT properties.$pathname AS p, count() AS n FROM events WHERE ${where} GROUP BY p ORDER BY n DESC LIMIT 5`,
      );
      const referrers = await query(
        c,
        site,
        `SELECT properties.$referring_domain AS r, count(DISTINCT properties.$session_id) AS n FROM events WHERE ${where} GROUP BY r ORDER BY n DESC LIMIT 5`,
      );
      return {
        pageviews: Number(totals?.[0] ?? 0),
        visitors: Number(totals?.[1] ?? 0),
        visits: Number(totals?.[2] ?? 0),
        bounceRate: null,
        topPages: pages.map((r) => ({ path: String(r[0] ?? '/'), views: Number(r[1]) })),
        topReferrers: referrers.map((r) => ({
          source: !r[0] || r[0] === '$direct' ? '(direct)' : String(r[0]),
          visits: Number(r[1]),
        })),
      };
    },
  };
}
