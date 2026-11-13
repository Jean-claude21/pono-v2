import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Shell } from '@/features/shell/Shell';
import { Card, PageHead, StateDot, Stats, Thin, toneOf } from '@/features/shell/ui';
import { api, useApi } from '@/lib/api';
import { ago, figure, label, money } from '@/lib/labels';
import { alertText, type Reading, type UsageView } from '@/lib/usage';
import { nameOf } from '@/lib/providers';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/usage')({
  component: () => (
    <Shell section="usage">
      <Usage />
    </Shell>
  ),
});

function percentOf(r: Reading): number | null {
  return r.used !== null && r.quota ? Math.min(100, Math.round((r.used / r.quota) * 100)) : null;
}

/**
 * What everything costs and uses (D-022): the month's total and where each figure comes from,
 * then one card per provider with its meters against their quotas, then the declared subscriptions.
 */
function Usage() {
  const usage = useApi<UsageView>('/v1/usage');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  if (!usage.result) return <p className="mute">{m.loading()}</p>;
  if (!usage.result.ok) return <p className="notice">{label('error', usage.result.error.code)}</p>;
  const { total, readings, subscriptions, alerts } = usage.result.data;

  const refresh = async () => {
    setBusy(true);
    await api('/v1/usage/refresh', { method: 'POST' });
    setBusy(false);
    usage.reload();
  };
  const end = async (id: string) => {
    await api(`/v1/subscriptions/${id}`, { method: 'DELETE' });
    usage.reload();
  };

  const providers = [...new Set(readings.map((r) => r.provider))];
  const bad = alerts.filter((a) => a.level === 'bad');
  const lastRead =
    readings
      .map((r) => r.readAt)
      .sort()
      .at(-1) ?? null;
  const monthly = subscriptions.reduce(
    (sum, s) => sum + (s.cycle === 'year' ? s.priceMicros / 12 : s.priceMicros),
    0,
  );

  return (
    <>
      <PageHead
        title={m.usage_title()}
        intro={m.usage_intro()}
        actions={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
              {m.usage_add()}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={refresh}
              disabled={busy}
            >
              {m.usage_refresh()}
            </button>
          </>
        }
      />

      {alerts.length > 0 ? (
        <div className={`verdict${bad.length ? '' : ' warning'}`}>
          <div>
            <span className="mono-label">{m.usage_alerts()}</span>
            {alerts.map((a) => (
              <h3 key={a.id}>{alertText(a)}</h3>
            ))}
          </div>
        </div>
      ) : (
        readings.length > 0 && (
          <div className="verdict healthy">
            <div>
              <span className="mono-label">{m.usage_calm_label()}</span>
              <h3>{m.usage_calm()}</h3>
            </div>
          </div>
        )
      )}

      <Card
        title={m.usage_month()}
        icon="gauge"
        foot={
          <>
            {m.usage_sources_explained()}
            {lastRead ? ` · ${m.usage_read_at({ when: ago(lastRead) })}` : ''}
          </>
        }
      >
        <Stats
          items={[
            { value: money(total.totalMicros), label: m.usage_total() },
            { value: money(total.bySource.measured ?? 0), label: label('source', 'measured') },
            { value: money(total.bySource.estimated ?? 0), label: label('source', 'estimated') },
            { value: money(total.bySource.declared ?? 0), label: label('source', 'declared') },
          ]}
        />
        {total.unavailable > 0 && (
          <p className="tiny mute">
            {m.usage_unavailable_count({ count: String(total.unavailable) })}
          </p>
        )}
      </Card>

      {adding && (
        <AddSubscription
          onDone={() => {
            setAdding(false);
            usage.reload();
          }}
        />
      )}

      <section className="block">
        <div className="block-head">
          <h2>{m.usage_meters()}</h2>
          <p>{m.usage_meters_body()}</p>
        </div>
        {readings.length === 0 ? (
          <p className="notice">{m.usage_no_reading()}</p>
        ) : (
          <div className="grid-cards">
            {providers.map((provider) => {
              const own = readings.filter((r) => r.provider === provider);
              const worst = Math.max(0, ...own.map((r) => percentOf(r) ?? 0));
              return (
                <Card
                  key={provider}
                  title={nameOf(provider)}
                  icon="plug"
                  tools={
                    worst >= 80 ? (
                      <StateDot
                        state={worst >= 95 ? 'failing' : 'warning'}
                        text={worst >= 95 ? m.overview_alert_bad() : m.overview_alert_warn()}
                      />
                    ) : undefined
                  }
                  foot={m.usage_read_at({ when: ago(own[0]?.readAt ?? null) })}
                >
                  <ul className="lines">
                    {own.map((r) => {
                      const percent = percentOf(r);
                      return (
                        <li key={`${r.meter}-${r.subject}`}>
                          <div className="line-top">
                            <span className="name">{label('meter', r.meter)}</span>
                            <span className={`src ${r.source}`}>{label('source', r.source)}</span>
                          </div>
                          {r.subject && (
                            <div className="line-top">
                              <span className="mono">{r.subject}</span>
                            </div>
                          )}
                          {r.used === null ? (
                            <p className="tiny mute">
                              {r.reason ? label('unavailableReason', r.reason) : '—'}
                            </p>
                          ) : (
                            <>
                              <div className="line-top" style={{ marginTop: 4 }}>
                                <span className="figures sub" style={{ flex: 1 }}>
                                  {figure(r.used)}
                                  {r.quota !== null ? ` / ${figure(r.quota)}` : ''} {r.unit}
                                </span>
                                {percent !== null && <span className="figures">{percent} %</span>}
                              </div>
                              {percent !== null && (
                                <Thin percent={percent} tone={toneOf(percent)} mark />
                              )}
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="block">
        <div className="block-head">
          <h2>{m.usage_subscriptions()}</h2>
          <p>{m.usage_subscriptions_body()}</p>
        </div>
        <Card
          title={m.usage_subscriptions_total({ amount: money(monthly) })}
          icon="list"
          tools={
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setAdding(true)}>
              {m.usage_add()}
            </button>
          }
        >
          {subscriptions.length === 0 ? (
            <p className="mute small">{m.usage_no_subscription()}</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{m.col_service()}</th>
                    <th className="num">{m.form_price()}</th>
                    <th>{m.form_renews()}</th>
                    <th className="num" />
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.map((s) => (
                    <tr key={s.id}>
                      <td className="project">
                        {s.service}
                        {s.plan && <small>{s.plan}</small>}
                      </td>
                      <td className="num figures">
                        {money(s.priceMicros)}{' '}
                        <span className="tiny mute">
                          {s.cycle === 'year' ? m.usage_per_year() : m.usage_per_month()}
                        </span>
                      </td>
                      <td className="small">{s.renewsOn ?? '—'}</td>
                      <td className="num">
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => end(s.id)}
                        >
                          {m.usage_end()}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </>
  );
}

function AddSubscription({ onDone }: Readonly<{ onDone: () => void }>) {
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const result = await api('/v1/subscriptions', {
      method: 'POST',
      body: {
        service: String(f.get('service') ?? ''),
        plan: String(f.get('plan') ?? '') || null,
        priceUsd: Number(f.get('price')),
        cycle: String(f.get('cycle')),
        renewsOn: String(f.get('renews') ?? '') || null,
      },
    });
    if (!result.ok) return setError(label('error', result.error.code));
    onDone();
  };
  return (
    <Card title={m.usage_add()} icon="plus">
      <form className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="service">{m.form_service()}</label>
          <input id="service" name="service" required maxLength={80} />
        </div>
        <div className="field">
          <label htmlFor="plan">{m.form_plan()}</label>
          <input id="plan" name="plan" maxLength={80} />
        </div>
        <div className="field">
          <label htmlFor="price">{m.form_price()}</label>
          <input id="price" name="price" type="number" min="0" step="0.01" required />
        </div>
        <div className="field">
          <label htmlFor="cycle">{m.form_cycle()}</label>
          <select id="cycle" name="cycle">
            <option value="month">{m.form_cycle_month()}</option>
            <option value="year">{m.form_cycle_year()}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="renews">{m.form_renews()}</label>
          <input id="renews" name="renews" type="date" />
        </div>
        {error && <p className="small bad">{error}</p>}
        <div className="row">
          <button type="submit" className="btn btn-primary btn-sm">
            {m.form_save()}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
            {m.form_cancel()}
          </button>
        </div>
      </form>
    </Card>
  );
}
