import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Shell } from '@/features/shell/Shell';
import { api, useApi } from '@/lib/api';
import { ago, figure, label, money } from '@/lib/labels';
import { alertText, type UsageView } from '@/lib/usage';
import { Card } from '@/features/shell/ui';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/usage')({
  component: () => (
    <Shell section="usage">
      <Usage />
    </Shell>
  ),
});

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

  return (
    <>
      <div className="topline">
        <div>
          <h1>{m.usage_title()}</h1>
          <p className="mute mt-sm">{m.usage_intro()}</p>
        </div>
        <div className="topline-actions">
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
        </div>
      </div>

      {alerts.map((a) => (
        <div className={a.level === 'bad' ? 'verdict' : 'notice warning'} key={a.id}>
          {a.level === 'bad' ? (
            <div>
              <span className="mono-label">{m.usage_alerts()}</span>
              <h3>{alertText(a)}</h3>
            </div>
          ) : (
            alertText(a)
          )}
        </div>
      ))}

      <div className="kpis">
        <div className="kpi">
          <span className="mono-label">{m.usage_month()}</span>
          <div className="value">{money(total.totalMicros)}</div>
          {total.unavailable > 0 && (
            <p>{m.usage_unavailable_count({ count: String(total.unavailable) })}</p>
          )}
        </div>
        {(['measured', 'estimated', 'declared'] as const).map((source) => (
          <div className="kpi" key={source}>
            <span className="mono-label">{label('source', source)}</span>
            <div className="value">{money(total.bySource[source] ?? 0)}</div>
          </div>
        ))}
      </div>

      {adding && (
        <AddSubscription
          onDone={() => {
            setAdding(false);
            usage.reload();
          }}
        />
      )}

      <Card title={m.usage_meters()} icon="gauge">
        {readings.length === 0 ? (
          <p className="mute small mt-md">{m.usage_no_reading()}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{m.col_service()}</th>
                <th>{m.col_meter()}</th>
                <th>{m.col_use()}</th>
                <th>{m.col_source()}</th>
                <th className="num">{m.col_when()}</th>
              </tr>
            </thead>
            <tbody>
              {readings.map((r) => {
                const percent =
                  r.used !== null && r.quota
                    ? Math.min(100, Math.round((r.used / r.quota) * 100))
                    : null;
                return (
                  <tr key={`${r.provider}-${r.meter}-${r.subject}`}>
                    <td className="project">
                      {r.provider}
                      {r.subject && <small>{r.subject}</small>}
                    </td>
                    <td>{label('meter', r.meter)}</td>
                    <td>
                      {r.used === null ? (
                        <span className="mute small">
                          {r.reason ? label('unavailableReason', r.reason) : '—'}
                        </span>
                      ) : (
                        <span
                          className={`meter ${percent !== null && percent >= 95 ? 'crit' : percent !== null && percent >= 80 ? 'warn' : ''}`}
                          style={{
                            ['--value' as string]: `${percent ?? 0}%`,
                            justifyItems: 'start',
                          }}
                        >
                          <span className="figures">
                            {figure(r.used)}
                            {r.quota !== null ? ` / ${figure(r.quota)}` : ''} {r.unit}
                          </span>
                          {percent !== null && <i />}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`src ${r.source}`}>{label('source', r.source)}</span>
                    </td>
                    <td className="num small">{ago(r.readAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card title={m.usage_subscriptions()} icon="list">
        {subscriptions.length === 0 ? (
          <p className="mute small mt-md">{m.usage_no_subscription()}</p>
        ) : (
          <div className="list">
            {subscriptions.map((s) => (
              <div className="item" key={s.id}>
                <div>
                  <h4>
                    {s.service}
                    {s.plan ? ` · ${s.plan}` : ''}
                  </h4>
                  <p>
                    {money(s.priceMicros)}{' '}
                    {s.cycle === 'year' ? m.usage_per_year() : m.usage_per_month()}
                    {s.renewsOn ? ` · ${m.usage_renews({ date: s.renewsOn })}` : ''} ·{' '}
                    <span className="src">{label('source', 'declared')}</span>
                  </p>
                </div>
                <div className="row">
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => end(s.id)}>
                    {m.usage_end()}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
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
    <form className="form panel" onSubmit={submit}>
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
  );
}
