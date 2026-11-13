import { useState } from 'react';
import { api, useApi } from '@/lib/api';
import { figure, label } from '@/lib/labels';
import { Card } from '@/features/shell/ui';
import * as m from '@/paraglide/messages.js';

type Metrics =
  | {
      source: 'measured';
      provider: string;
      days: number;
      stats: {
        pageviews: number;
        visitors: number;
        visits: number;
        bounceRate: number | null;
        topPages: { path: string; views: number }[];
        topReferrers: { source: string; visits: number }[];
      };
    }
  | { source: 'unavailable'; reason: string; provider?: string };

interface Sites {
  providers: { provider: string; sites: { ref: string; name: string; domain: string | null }[] }[];
}

const PERIODS = [7, 30, 90] as const;

/** A project's visits (D-017): measured at its analytics provider, or a gap that says why. */
export function ProjectVisits({ projectId }: Readonly<{ projectId: string }>) {
  const [days, setDays] = useState<number>(30);
  const data = useApi<Metrics>(`/v1/projects/${projectId}/analytics?days=${days}`);
  if (!data.result?.ok) return null;
  const metrics = data.result.data;

  return (
    <Card
      title={m.visits_title()}
      icon="chart"
      tools={
        <>
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              className={`btn btn-xs ${p === days ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setDays(p)}
            >
              {m.visits_days({ days: String(p) })}
            </button>
          ))}
        </>
      }
    >
      {metrics.source === 'unavailable' ? (
        <>
          <p className="mute small mt-md">
            {label('visitsGap', metrics.reason)}{' '}
            <span className="src unavailable">{label('source', 'unavailable')}</span>
          </p>
          {metrics.reason === 'not_linked' && (
            <LinkSite projectId={projectId} onLinked={data.reload} />
          )}
        </>
      ) : (
        <>
          <dl className="facts mt-md">
            <div className="fact">
              <dt>{m.visits_pageviews()}</dt>
              <dd className="figures">{figure(metrics.stats.pageviews)}</dd>
            </div>
            <div className="fact">
              <dt>{m.visits_visitors()}</dt>
              <dd className="figures">{figure(metrics.stats.visitors)}</dd>
            </div>
            <div className="fact">
              <dt>{m.visits_visits()}</dt>
              <dd className="figures">{figure(metrics.stats.visits)}</dd>
            </div>
            <div className="fact">
              <dt>{m.visits_bounce()}</dt>
              <dd className="figures">
                {metrics.stats.bounceRate === null
                  ? '—'
                  : `${Math.round(metrics.stats.bounceRate * 100)} %`}
              </dd>
            </div>
          </dl>
          <p className="tiny mute">
            {m.visits_measured_at({ provider: metrics.provider })}{' '}
            <span className="src measured">{label('source', 'measured')}</span>
          </p>
          <div className="two-cols mt-md">
            <table className="table">
              <thead>
                <tr>
                  <th>{m.visits_pages()}</th>
                  <th className="num">{m.visits_views()}</th>
                </tr>
              </thead>
              <tbody>
                {metrics.stats.topPages.map((p) => (
                  <tr key={p.path}>
                    <td className="figures small">{p.path}</td>
                    <td className="num figures">{figure(p.views)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="table">
              <thead>
                <tr>
                  <th>{m.visits_sources()}</th>
                  <th className="num">{m.visits_visits()}</th>
                </tr>
              </thead>
              <tbody>
                {metrics.stats.topReferrers.map((r) => (
                  <tr key={r.source}>
                    <td className="small">
                      {r.source === '(direct)' ? m.visits_direct() : r.source}
                    </td>
                    <td className="num figures">{figure(r.visits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function LinkSite({ projectId, onLinked }: Readonly<{ projectId: string; onLinked: () => void }>) {
  const sites = useApi<Sites>('/v1/analytics/sites');
  const [error, setError] = useState<string | null>(null);
  if (!sites.result?.ok) return null;
  const options = sites.result.data.providers.flatMap((p) =>
    p.sites.map((s) => ({ provider: p.provider, ...s })),
  );
  if (options.length === 0)
    return (
      <p className="small mt-sm">
        <a href="/connections">{m.visits_connect()}</a>
      </p>
    );
  const link = async (value: string) => {
    const [provider, site] = value.split('|');
    const result = await api(`/v1/projects/${projectId}/analytics`, {
      method: 'PUT',
      body: { provider, site },
    });
    if (!result.ok) setError(label('error', result.error.code));
    else onLinked();
  };
  return (
    <div className="field mt-sm">
      <label htmlFor="visits-site">{m.visits_link()}</label>
      <select id="visits-site" defaultValue="" onChange={(e) => link(e.target.value)}>
        <option value="" disabled>
          {m.visits_choose_site()}
        </option>
        {options.map((o) => (
          <option key={`${o.provider}|${o.ref}`} value={`${o.provider}|${o.ref}`}>
            {o.name} · {o.domain ?? o.ref} ({o.provider})
          </option>
        ))}
      </select>
      {error && <small className="bad">{error}</small>}
    </div>
  );
}
