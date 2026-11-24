import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { LevelChooser, type Level } from '@/features/shell/LevelChooser';
import { Shell } from '@/features/shell/Shell';
import { api, useApi } from '@/lib/api';
import { label, money, when } from '@/lib/labels';
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

/** The country of the browser's language (fr-CI → CI), a first guess for the phone's country. */
function region(): string {
  if (typeof navigator === 'undefined') return '';
  const found = navigator.languages
    .map((l) => l.split('-')[1])
    .find((r) => r && /^[A-Za-z]{2}$/.test(r));
  return found?.toUpperCase() ?? '';
}

interface PlanView {
  plan: string;
  provider: string;
  /** Plans also sold as licence keys (D-041), and where to buy one. */
  licences: boolean;
  storeUrl: string | null;
  contactUrl: string | null;
  plans: {
    id: string;
    availability: 'available' | 'coming_soon' | 'on_request';
    activeServers: number;
    priceMicros: number;
    byLicence: boolean;
  }[];
}

function Settings() {
  const data = useApi<PlanView>('/v1/plan');
  const me = useApi<{ person: { level: Level | null } }>('/v1/me');
  const [error, setError] = useState<string | null>(null);
  const [redeemed, setRedeemed] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  if (!data.result) return <p className="mute">{m.loading()}</p>;
  if (!data.result.ok) return <p className="notice">{label('error', data.result.error.code)}</p>;
  const { plan, plans, provider, licences, storeUrl, contactUrl } = data.result.data;

  const redeem = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const key = String(new FormData(e.currentTarget).get('key') ?? '').trim();
    setError(null);
    setRedeemed(null);
    const r = await api<{ plan: string; until: string | null; already: boolean }>(
      '/v1/plan/licence',
      { method: 'POST', body: { key } },
    );
    if (!r.ok) return setError(label('error', r.error.code));
    setRedeemed(
      r.data.already
        ? m.settings_licence_already({ plan: label('plan', r.data.plan) })
        : m.settings_licence_done({ plan: label('plan', r.data.plan), until: when(r.data.until) }),
    );
    data.reload();
  };

  const choose = async (id: string, contact?: { phone: string; country: string }) => {
    const result = await api<{ url: string }>('/v1/plan/checkout', {
      method: 'POST',
      body: { plan: id, ...contact },
    });
    if (!result.ok) return setError(label('error', result.error.code));
    window.location.assign(result.data.url);
  };

  // A plan sold at the store: its payment page needs a phone (mobile money), asked once here.
  const buy = async (id: string, e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await choose(id, {
      phone: String(f.get('phone') ?? '').trim(),
      country: String(f.get('country') ?? '').trim(),
    });
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
              <div className="price">
                {p.availability === 'available' || p.id === 'free'
                  ? money(p.priceMicros)
                  : label('availability', p.availability)}
              </div>
              <ul>
                <li>{m.settings_servers({ count: String(p.activeServers) })}</li>
              </ul>
              {p.id === plan ? (
                <span className="mono-label">{m.settings_current()}</span>
              ) : p.availability === 'on_request' ? (
                contactUrl && (
                  <a className="btn btn-ghost btn-sm" href={contactUrl}>
                    {m.settings_contact()}
                  </a>
                )
              ) : (
                p.availability === 'available' &&
                p.priceMicros > 0 &&
                (p.byLicence ? (
                  buying === p.id ? (
                    <form className="form" onSubmit={(e) => buy(p.id, e)}>
                      <div className="field">
                        <label htmlFor={`phone-${p.id}`}>{m.settings_buy_phone()}</label>
                        <div className="row">
                          <input
                            name="country"
                            aria-label={m.settings_buy_country()}
                            required
                            maxLength={2}
                            pattern="[A-Za-z]{2}"
                            defaultValue={region()}
                            style={{ width: 56 }}
                          />
                          <input
                            id={`phone-${p.id}`}
                            name="phone"
                            type="tel"
                            required
                            autoComplete="tel"
                            pattern="\+?[0-9 ]{6,20}"
                          />
                        </div>
                      </div>
                      <button type="submit" className="btn btn-primary btn-sm">
                        {m.settings_buy_go()}
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => setBuying(p.id)}
                    >
                      {m.settings_choose()}
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={provider === 'none'}
                    onClick={() => choose(p.id)}
                  >
                    {m.settings_choose()}
                  </button>
                ))
              )}
            </div>
          ))}
        </div>
      </Card>
      {licences && (
        <Card title={m.settings_licence()} icon="key" foot={m.settings_licence_foot()}>
          {redeemed && <p className="notice">{redeemed}</p>}
          <form className="form" onSubmit={redeem}>
            <div className="field">
              <label htmlFor="licence-key">{m.settings_licence_key()}</label>
              <div className="row">
                <input
                  id="licence-key"
                  name="key"
                  required
                  minLength={4}
                  autoComplete="off"
                  placeholder={m.settings_licence_placeholder()}
                />
                <button type="submit" className="btn btn-primary btn-sm">
                  {m.settings_licence_activate()}
                </button>
              </div>
            </div>
          </form>
          {storeUrl && (
            <a
              className="btn btn-ghost btn-sm mt-sm"
              href={storeUrl}
              target="_blank"
              rel="noopener"
            >
              {m.settings_licence_buy()}
            </a>
          )}
        </Card>
      )}
      <Card title={m.settings_language()} icon="globe">
        <div className="spread">
          <p className="small soft">{m.settings_language_body()}</p>
          <LocaleSwitch />
        </div>
      </Card>
    </>
  );
}
