import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Shell } from '@/features/shell/Shell';
import { PageHead, StateDot } from '@/features/shell/ui';
import { api, useApi, type ConnectionView } from '@/lib/api';
import { ago, label } from '@/lib/labels';
import { nameOf } from '@/lib/providers';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/connections')({
  component: () => (
    <Shell section="connections">
      <Connections />
    </Shell>
  ),
});

interface Available {
  provider: string;
  kind: string;
  fields: string[];
}

type Need = 'required' | 'recommended' | 'optional';

/** In the order a person needs them: code first, then where it runs, then the rest. */
const KINDS: readonly { kind: string; need: Need; why: () => string }[] = [
  { kind: 'code_host', need: 'required', why: m.kind_why_code_host },
  { kind: 'hosting', need: 'recommended', why: m.kind_why_hosting },
  { kind: 'database', need: 'recommended', why: m.kind_why_database },
  { kind: 'analytics', need: 'optional', why: m.kind_why_analytics },
  { kind: 'ai', need: 'optional', why: m.kind_why_ai },
];

const ROLES: Record<string, () => string> = {
  github: m.provider_github,
  netlify: m.provider_netlify,
  cloudflare: m.provider_cloudflare,
  coolify: m.provider_coolify,
  neon: m.provider_neon,
  openai: m.provider_openai,
  umami: m.provider_umami,
  'umami-self': m.provider_umami_self,
  posthog: m.provider_posthog,
};

/**
 * The person's own accounts that Pono works with (D-022): grouped by what they are for, in the
 * order they are needed, each saying what Pono does with it.
 */
function Connections() {
  const data = useApi<{ connections: ConnectionView[]; available: Available[] }>('/v1/connections');
  if (!data.result) return <p className="mute">{m.loading()}</p>;
  if (!data.result.ok) return <p className="notice">{label('error', data.result.error.code)}</p>;
  const { connections, available } = data.result.data;
  const has = (kind: string) => connections.some((c) => c.kind === kind);

  return (
    <>
      <PageHead title={m.connections_title()} intro={m.connections_intro()} />

      {has('code_host') ? (
        <div className="verdict healthy">
          <div>
            <span className="mono-label">{m.connections_ok_label()}</span>
            <h3>{m.connections_ok({ count: String(connections.length) })}</h3>
            {!has('hosting') && <p>{m.connections_hint_hosting()}</p>}
          </div>
        </div>
      ) : (
        <div className="verdict">
          <div>
            <span className="mono-label">{m.connections_start_label()}</span>
            <h3>{m.connections_start()}</h3>
          </div>
        </div>
      )}

      {KINDS.map(({ kind, need, why }) => {
        const providers = available.filter((a) => a.kind === kind);
        if (providers.length === 0) return null;
        const done = has(kind);
        return (
          <section className="block" key={kind}>
            <div className="block-head">
              <h2>{label('kind', kind)}</h2>
              <span className={`need ${done ? 'done' : need === 'required' ? 'required' : ''}`}>
                {done ? m.need_done() : label('need', need)}
              </span>
              <p>{why()}</p>
            </div>
            <div className="grid-cards">
              {providers.map((a) => (
                <Provider
                  key={a.provider}
                  available={a}
                  connection={connections.find((c) => c.provider === a.provider)}
                  onChange={data.reload}
                />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

function Provider({
  available,
  connection,
  onChange,
}: Readonly<{
  available: Available;
  connection: ConnectionView | undefined;
  onChange: () => void;
}>) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = nameOf(available.provider);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = Object.fromEntries(available.fields.map((f) => [f, String(form.get(f) ?? '')]));
    setBusy(true);
    setError(null);
    const result = await api('/v1/connections', {
      method: 'POST',
      body: { provider: available.provider, fields },
    });
    setBusy(false);
    if (!result.ok) return setError(label('error', result.error.code));
    setOpen(false);
    onChange();
  };

  const cut = async () => {
    if (!connection || !window.confirm(m.connections_cut_confirm({ name }))) return;
    await api(`/v1/connections/${connection.id}`, { method: 'DELETE' });
    onChange();
  };

  return (
    <section className="card">
      <header className="card-head" style={{ marginBottom: 10 }}>
        <span className="provider-logo">{name.slice(0, 2).toUpperCase()}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ whiteSpace: 'normal' }}>{name}</h2>
          <p className="tiny mute">
            {ROLES[available.provider]?.() ?? label('kind', available.kind)}
          </p>
        </div>
      </header>
      <div className="card-body">
        {connection ? (
          <StateDot
            state={connection.status === 'active' ? 'healthy' : 'warning'}
            text={
              connection.status === 'active'
                ? m.connections_connected()
                : label('connectionStatus', connection.status)
            }
          />
        ) : (
          <StateDot state="idle" text={m.connections_not_connected()} />
        )}
        {open && (
          <form className="form" onSubmit={submit}>
            {available.fields.map((field) => (
              <div className="field" key={field}>
                <label htmlFor={`${available.provider}-${field}`}>{label('field', field)}</label>
                <input
                  id={`${available.provider}-${field}`}
                  name={field}
                  type={['token', 'apiKey', 'password'].includes(field) ? 'password' : 'text'}
                  autoComplete="off"
                  required
                />
              </div>
            ))}
            <small className="mute">{m.connections_key_help({ name })}</small>
            {error && <p className="small bad">{error}</p>}
            <div className="row">
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                {busy ? m.connections_checking() : m.connections_connect()}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
                {m.form_cancel()}
              </button>
            </div>
          </form>
        )}
      </div>
      <div className="tile-foot">
        <span className="tiny mute" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          {connection
            ? `${connection.account} · ${m.connections_since({ when: ago(connection.createdAt) })}`
            : ''}
        </span>
        {connection ? (
          <button type="button" className="btn btn-danger btn-xs" onClick={cut}>
            {m.connections_cut()}
          </button>
        ) : (
          !open && (
            <button type="button" className="btn btn-primary btn-xs" onClick={() => setOpen(true)}>
              {m.connections_connect()}
            </button>
          )
        )}
      </div>
    </section>
  );
}
