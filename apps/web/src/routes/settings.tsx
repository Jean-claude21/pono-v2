import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { LevelChooser, type Level } from '@/features/shell/LevelChooser';
import { Shell } from '@/features/shell/Shell';
import { api, useApi } from '@/lib/api';
import { label, money } from '@/lib/labels';
import { LocaleSwitch } from '@/features/shell/LocaleSwitch';
import { Card, PageHead } from '@/features/shell/ui';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/settings')({
  component: () => (
    <Shell section="settings">
      <Settings />
    </Shell>
  ),
});

interface PlanView {
  plan: string;
  provider: string;
  plans: { id: string; activeServers: number; priceMicros: number }[];
}

function Settings() {
  const data = useApi<PlanView>('/v1/plan');
  const me = useApi<{ person: { level: Level | null } }>('/v1/me');
  const [error, setError] = useState<string | null>(null);
  if (!data.result) return <p className="mute">{m.loading()}</p>;
  if (!data.result.ok) return <p className="notice">{label('error', data.result.error.code)}</p>;
  const { plan, plans, provider } = data.result.data;

  const choose = async (id: string) => {
    const result = await api<{ url: string }>('/v1/plan/checkout', {
      method: 'POST',
      body: { plan: id },
    });
    if (!result.ok) return setError(label('error', result.error.code));
    window.location.assign(result.data.url);
  };

  return (
    <>
      <PageHead title={m.settings_title()} intro={m.settings_intro()} />
      <Card title={m.settings_level()} icon="settings" foot={m.settings_level_foot()}>
        <p className="small soft">{m.settings_level_body()}</p>
        {me.result?.ok && (
          <LevelChooser current={me.result.data.person.level} onChosen={me.reload} />
        )}
      </Card>
      <Card title={m.settings_plan()} icon="gauge" foot={m.settings_plan_foot()}>
        {provider === 'none' && <p className="notice">{m.settings_billing_none()}</p>}
        {error && <p className="notice warning">{error}</p>}
        <div className="plans">
          {plans.map((p) => (
            <div className={`plan ${p.id === plan ? 'current' : ''}`} key={p.id}>
              <h3>{label('plan', p.id)}</h3>
              <div className="price">{money(p.priceMicros)}</div>
              <ul>
                <li>{m.settings_servers({ count: String(p.activeServers) })}</li>
              </ul>
              {p.id === plan ? (
                <span className="mono-label">{m.settings_current()}</span>
              ) : (
                p.priceMicros > 0 && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={provider === 'none'}
                    onClick={() => choose(p.id)}
                  >
                    {m.settings_choose()}
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      </Card>
      <Card title={m.settings_language()} icon="globe">
        <div className="spread">
          <p className="small soft">{m.settings_language_body()}</p>
          <LocaleSwitch />
        </div>
      </Card>
    </>
  );
}
