import type { Connectable } from '../../features/connections/index.js';
import type { Reading, UsageSource } from '../../features/usage/index.js';
import { fetchJson, ProviderError, type Fetch } from '../../platform/http.js';

/**
 * What each provider says it consumed. Shapes checked against the author's real accounts on
 * 2026-11-12 (scripts/probe-providers.ts). A figure the key may not read is `unavailable`.
 */

const GB = 1024 ** 3;

function reading(
  r: Partial<Reading> & Pick<Reading, 'provider' | 'meter' | 'unit' | 'source'>,
): Reading {
  return {
    subject: '',
    used: null,
    quota: null,
    costMicros: null,
    reason: null,
    periodStart: null,
    periodEnd: null,
    ...r,
  };
}

function unavailableReading(provider: string, meter: string, reason: string): Reading {
  return reading({ provider, meter, unit: '', source: 'unavailable', reason });
}

/** Netlify: the account's bandwidth for the billing period. */
export function netlifyUsage(fetchImpl: Fetch): UsageSource {
  const provider = 'netlify';
  return {
    id: provider,
    async read(token) {
      const headers = { authorization: `Bearer ${token}`, 'user-agent': 'pono' };
      const accounts = await fetchJson<{ slug: string; type_name?: string }[]>(fetchImpl, {
        provider,
        url: 'https://api.netlify.com/api/v1/accounts',
        headers,
      });
      const out: Reading[] = [];
      for (const account of accounts) {
        const bw = await fetchJson<{
          used: number;
          included: number;
          period_start_date: string;
          period_end_date: string;
        }>(fetchImpl, {
          provider,
          url: `https://api.netlify.com/api/v1/accounts/${account.slug}/bandwidth`,
          headers,
        });
        out.push(
          reading({
            provider,
            meter: 'hosting.bandwidth',
            subject: account.slug,
            used: Math.round((bw.used / GB) * 100) / 100,
            quota: Math.round((bw.included / GB) * 100) / 100,
            unit: 'GB',
            costMicros: 0,
            source: 'measured',
            periodStart: new Date(bw.period_start_date),
            periodEnd: new Date(bw.period_end_date),
          }),
        );
      }
      return out;
    },
  };
}

/**
 * Neon, per project, against the free plan (100 projects, 0.5 GB, 100 CU-hours and 5 GB of transfer
 * each): storage summed over branches, compute time and transfer from the project's details. The
 * project list alone carries none of these figures.
 */
export function neonUsage(
  fetchImpl: Fetch,
  free = { storageGb: 0.5, computeHours: 100, transferGb: 5 },
): UsageSource {
  const provider = 'neon';
  return {
    id: provider,
    async read(token) {
      const headers = { authorization: `Bearer ${token}` };
      const api = 'https://console.neon.tech/api/v2';
      const { projects } = await fetchJson<{ projects: { id: string; name: string }[] }>(
        fetchImpl,
        {
          provider,
          url: `${api}/projects?limit=100`,
          headers,
        },
      );
      const out: Reading[] = [];
      for (const p of projects) {
        const [{ project }, { branches }] = await Promise.all([
          fetchJson<{
            project: {
              compute_time_seconds?: number;
              data_transfer_bytes?: number;
              quota_reset_at?: string | null;
            };
          }>(fetchImpl, { provider, url: `${api}/projects/${p.id}`, headers }),
          fetchJson<{ branches: { logical_size?: number }[] }>(fetchImpl, {
            provider,
            url: `${api}/projects/${p.id}/branches`,
            headers,
          }),
        ]);
        const periodEnd = project.quota_reset_at ? new Date(project.quota_reset_at) : null;
        const storage = branches.reduce((sum, b) => sum + (b.logical_size ?? 0), 0);
        const round = (n: number) => Math.round(n * 1000) / 1000;
        out.push(
          reading({
            provider,
            meter: 'database.storage',
            subject: p.name,
            used: round(storage / GB),
            quota: free.storageGb,
            unit: 'GB',
            costMicros: 0,
            source: 'measured',
            periodEnd,
          }),
          reading({
            provider,
            meter: 'database.compute',
            subject: p.name,
            used: round((project.compute_time_seconds ?? 0) / 3600),
            quota: free.computeHours,
            unit: 'h',
            costMicros: 0,
            source: 'measured',
            periodEnd,
          }),
          reading({
            provider,
            meter: 'database.transfer',
            subject: p.name,
            used: round((project.data_transfer_bytes ?? 0) / GB),
            quota: free.transferGb,
            unit: 'GB',
            costMicros: 0,
            source: 'measured',
            periodEnd,
          }),
        );
      }
      return out;
    },
  };
}

/** Cloudflare: Workers requests today, against the free plan's 100,000 a day. */
export function cloudflareUsage(fetchImpl: Fetch, dailyQuota = 100_000): UsageSource {
  const provider = 'cloudflare';
  return {
    id: provider,
    async read(credential, now) {
      const { token, accountId } = JSON.parse(credential) as { token: string; accountId: string };
      const day = now.toISOString().slice(0, 10);
      const answer = await fetchJson<{
        data: {
          viewer: { accounts: { workersInvocationsAdaptive: { sum: { requests: number } }[] }[] };
        } | null;
        errors: { message: string }[] | null;
      }>(fetchImpl, {
        provider,
        url: 'https://api.cloudflare.com/client/v4/graphql',
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: {
          query:
            'query($a:String!,$d:Date!){viewer{accounts(filter:{accountTag:$a}){workersInvocationsAdaptive(limit:1000,filter:{date_geq:$d}){sum{requests}}}}}',
          variables: { a: accountId, d: day },
        },
      });
      if (!answer.data) return [unavailableReading(provider, 'hosting.requests', 'permission')];
      const groups = answer.data.viewer.accounts[0]?.workersInvocationsAdaptive ?? [];
      const requests = groups.reduce((sum, g) => sum + g.sum.requests, 0);
      return [
        reading({
          provider,
          meter: 'hosting.requests',
          used: requests,
          quota: dailyQuota,
          unit: 'requests/day',
          costMicros: 0,
          source: 'measured',
          periodStart: new Date(`${day}T00:00:00Z`),
          periodEnd: new Date(new Date(`${day}T00:00:00Z`).getTime() + 86_400_000),
        }),
      ];
    },
  };
}

/** GitHub: Actions minutes need the billing permission; without it the figure is unavailable. */
export function githubUsage(fetchImpl: Fetch): UsageSource {
  const provider = 'github';
  return {
    id: provider,
    async read(token) {
      const headers = {
        authorization: `Bearer ${token}`,
        'user-agent': 'pono',
        'x-github-api-version': '2022-11-28',
      };
      const user = await fetchJson<{ login: string }>(fetchImpl, {
        provider,
        url: 'https://api.github.com/user',
        headers,
      });
      try {
        const usage = await fetchJson<{
          usageItems?: { product: string; quantity: number; unitType: string; netAmount: number }[];
        }>(fetchImpl, {
          provider,
          url: `https://api.github.com/users/${user.login}/settings/billing/usage`,
          headers,
        });
        const actions = (usage.usageItems ?? []).filter(
          (i) => i.product.toLowerCase() === 'actions',
        );
        return [
          reading({
            provider,
            meter: 'code.actions_minutes',
            used: actions.reduce((s, i) => s + i.quantity, 0),
            unit: 'min',
            costMicros: Math.round(actions.reduce((s, i) => s + i.netAmount, 0) * 1_000_000),
            source: 'measured',
          }),
        ];
      } catch (error) {
        if (error instanceof ProviderError && (error.status === 404 || error.unauthorized)) {
          return [unavailableReading(provider, 'code.actions_minutes', 'permission')];
        }
        throw error;
      }
    },
  };
}

/** OpenAI: costs of the last 30 days need an admin key with `api.usage.read`. */
export function openaiUsage(fetchImpl: Fetch): UsageSource & Connectable {
  const provider = 'openai';
  return {
    id: provider,
    kind: 'ai',
    fields: ['token'],
    keyUrl: 'https://platform.openai.com/settings/organization/admin-keys',
    serverDomains: ['api.openai.com'],
    keyScopes: 'An admin key with usage read',
    async verify(fields) {
      await fetchJson(fetchImpl, {
        provider,
        url: 'https://api.openai.com/v1/models',
        headers: { authorization: `Bearer ${fields.token!}` },
      });
      return { account: 'OpenAI', credential: fields.token! };
    },
    async read(token, now) {
      const start = Math.floor(now.getTime() / 1000) - 30 * 86_400;
      try {
        const costs = await fetchJson<{ data: { results: { amount: { value: number } }[] }[] }>(
          fetchImpl,
          {
            provider,
            url: `https://api.openai.com/v1/organization/costs?start_time=${start}&limit=31`,
            headers: { authorization: `Bearer ${token}` },
          },
        );
        const total = costs.data.flatMap((b) => b.results).reduce((s, r) => s + r.amount.value, 0);
        return [
          reading({
            provider,
            meter: 'ai.cost_30d',
            used: Math.round(total * 100) / 100,
            unit: 'USD',
            costMicros: Math.round(total * 1_000_000),
            source: 'measured',
          }),
        ];
      } catch (error) {
        if (error instanceof ProviderError && error.unauthorized)
          return [unavailableReading(provider, 'ai.cost_30d', 'permission')];
        throw error;
      }
    },
  };
}
