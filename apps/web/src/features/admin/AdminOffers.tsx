import { useState, type FormEvent } from 'react';
import { Card } from '@/features/shell/ui';
import { api, useApi } from '@/lib/api';
import { label } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';

interface Offer {
  plan: string;
  availability: 'available' | 'coming_soon' | 'on_request';
  priceMicros: number;
  activeServers: number;
  licenceProduct: string | null;
  licenceDays: number;
}

interface Setting {
  key: string;
  secret: boolean;
  set: boolean;
  from: 'console' | 'environment' | null;
  value: string | null;
}

interface Products {
  store: { name: string; url: string | null };
  products: { id: string; name: string; licence: boolean }[];
}

const SETTING_LABELS: Record<string, () => string> = {
  'chariow.api_key': m.admin_setting_chariow_key,
  'chariow.store_url': m.admin_setting_chariow_store,
  'sales.contact_url': m.admin_setting_contact,
};

/** The offers as sold (D-041): price, servers, sold now / coming soon / on request, by licence. */
export function AdminOffers() {
  const offers = useApi<{ offers: Offer[] }>('/v1/admin/offers');
  const settings = useApi<{ settings: Setting[] }>('/v1/admin/settings');
  const keySet = settings.result?.ok
    ? Boolean(settings.result.data.settings.find((s) => s.key === 'chariow.api_key')?.set)
    : false;
  const products = useApi<Products>(keySet ? '/v1/admin/licence-products' : null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warning'; text: string } | null>(null);

  const saveOffer = async (plan: string, e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await api(`/v1/admin/offers/${plan}`, {
      method: 'PUT',
      body: {
        availability: String(f.get('availability') ?? 'available'),
        priceMicros: Math.round(Number(f.get('price') ?? 0) * 1_000_000),
        activeServers: Number(f.get('servers') ?? 1),
        licenceProduct: String(f.get('product') ?? '') || null,
        licenceDays: Number(f.get('days') ?? 30),
      },
    });
    setNotice(
      r.ok
        ? { tone: 'ok', text: m.admin_offer_saved({ plan: label('plan', plan) }) }
        : { tone: 'warning', text: label('error', r.error.code) },
    );
    offers.reload();
  };

  const saveSetting = async (key: string, e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = String(new FormData(e.currentTarget).get('value') ?? '').trim();
    const r = await api(`/v1/admin/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: { value },
    });
    setNotice(
      r.ok
        ? { tone: 'ok', text: m.admin_setting_saved() }
        : { tone: 'warning', text: label('error', r.error.code) },
    );
    if (r.ok) e.currentTarget.reset();
    settings.reload();
    products.reload();
  };

  const licenceProducts = products.result?.ok
    ? products.result.data.products.filter((p) => p.licence)
    : [];

  return (
    <>
      <Card title={m.admin_offers()} icon="gauge" foot={m.admin_offers_foot()}>
        {notice && (
          <p className={`notice ${notice.tone === 'warning' ? 'warning' : ''}`}>{notice.text}</p>
        )}
        {offers.result?.ok && (
          <div className="plans">
            {offers.result.data.offers.map((o) => (
              <form
                key={`${o.plan}-${o.priceMicros}-${o.availability}-${o.licenceProduct}`}
                className="plan form"
                onSubmit={(e) => saveOffer(o.plan, e)}
              >
                <h3>{label('plan', o.plan)}</h3>
                {o.plan !== 'free' && (
                  <div className="field">
                    <label htmlFor={`a-${o.plan}`}>{m.admin_offer_availability()}</label>
                    <select id={`a-${o.plan}`} name="availability" defaultValue={o.availability}>
                      <option value="available">{label('availability', 'available')}</option>
                      <option value="coming_soon">{label('availability', 'coming_soon')}</option>
                      <option value="on_request">{label('availability', 'on_request')}</option>
                    </select>
                  </div>
                )}
                {o.plan !== 'free' && (
                  <div className="field">
                    <label htmlFor={`p-${o.plan}`}>{m.admin_offer_price()}</label>
                    <input
                      id={`p-${o.plan}`}
                      name="price"
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={o.priceMicros / 1_000_000}
                    />
                  </div>
                )}
                <div className="field">
                  <label htmlFor={`s-${o.plan}`}>{m.admin_offer_servers()}</label>
                  <input
                    id={`s-${o.plan}`}
                    name="servers"
                    type="number"
                    min={1}
                    max={100}
                    defaultValue={o.activeServers}
                  />
                </div>
                {o.plan !== 'free' && (
                  <div className="field">
                    <label htmlFor={`l-${o.plan}`}>{m.admin_offer_licence()}</label>
                    {licenceProducts.length > 0 ? (
                      <select
                        id={`l-${o.plan}`}
                        name="product"
                        defaultValue={o.licenceProduct ?? ''}
                      >
                        <option value="">{m.admin_offer_no_licence()}</option>
                        {licenceProducts.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`l-${o.plan}`}
                        name="product"
                        placeholder={m.admin_offer_product_placeholder()}
                        defaultValue={o.licenceProduct ?? ''}
                      />
                    )}
                  </div>
                )}
                {o.plan !== 'free' && (
                  <div className="field">
                    <label htmlFor={`d-${o.plan}`}>{m.admin_offer_days()}</label>
                    <input
                      id={`d-${o.plan}`}
                      name="days"
                      type="number"
                      min={1}
                      max={3660}
                      defaultValue={o.licenceDays}
                    />
                  </div>
                )}
                <button type="submit" className="btn btn-primary btn-sm">
                  {m.admin_save()}
                </button>
              </form>
            ))}
          </div>
        )}
      </Card>

      <Card title={m.admin_payments()} icon="key" foot={m.admin_payments_foot()}>
        {products.result?.ok && (
          <p className="small soft">
            {m.admin_store_connected({
              store: products.result.data.store.name,
              count: String(licenceProducts.length),
            })}
          </p>
        )}
        {keySet && products.result?.ok && licenceProducts.length === 0 && (
          <p className="notice warning">{m.admin_store_no_licence()}</p>
        )}
        {settings.result?.ok &&
          settings.result.data.settings.map((s) => (
            <form key={s.key} className="form mt-md" onSubmit={(e) => saveSetting(s.key, e)}>
              <div className="field">
                <label htmlFor={`set-${s.key}`}>
                  {SETTING_LABELS[s.key]?.() ?? s.key}
                  {s.set && (
                    <span className="mute small">
                      {' '}
                      · {s.value} {s.from === 'environment' ? m.admin_setting_from_env() : ''}
                    </span>
                  )}
                </label>
                <div className="row">
                  <input
                    id={`set-${s.key}`}
                    name="value"
                    type={s.secret ? 'password' : 'text'}
                    autoComplete="off"
                    placeholder={
                      s.secret
                        ? m.admin_setting_secret_placeholder()
                        : m.admin_setting_url_placeholder()
                    }
                    defaultValue={s.secret ? '' : s.from === 'console' ? (s.value ?? '') : ''}
                  />
                  <button type="submit" className="btn btn-ghost btn-sm">
                    {m.admin_save()}
                  </button>
                </div>
              </div>
            </form>
          ))}
      </Card>
    </>
  );
}
