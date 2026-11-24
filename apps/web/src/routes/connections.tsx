import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { Shell } from '@/features/shell/Shell';
import { Icon, PageHead, StateDot } from '@/features/shell/ui';
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
  optionalFields: string[];
  keyUrl: string | null;
  keyScopes: string | null;
  /** Where to sign in at the provider instead of giving a key (D-029). */
  signIn: string | null;
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
  vercel: m.provider_vercel,
  cloudflare: m.provider_cloudflare,
  coolify: m.provider_coolify,
  neon: m.provider_neon,
  openai: m.provider_openai,
  umami: m.provider_umami,
  'umami-self': m.provider_umami_self,
  posthog: m.provider_posthog,
};

/** What the page was opened for: `?connect=` a provider or a kind, or the end of a sign-in. */
function useQuery() {
  const [q, setQ] = useState<Record<string, string>>({});
  useEffect(() => {
    setQ(Object.fromEntries(new URLSearchParams(window.location.search)));
  }, []);
  return q;
}

/**
 * The person's own accounts that Pono works with (D-022, D-029): first the path of a project from
 * code to online, then each service by what it is for, signed in with a click where the provider
 * allows it, otherwise with a key created on the provider's own page, opened from here.
 */
function Connections() {
  const data = useApi<{ connections: ConnectionView[]; available: Available[] }>('/v1/connections');
  const query = useQuery();
  if (!data.result) return <p className="mute">{m.loading()}</p>;
  if (!data.result.ok) return <p className="notice">{label('error', data.result.error.code)}</p>;
  const { connections, available } = data.result.data;
  const has = (kind: string) => connections.some((c) => c.kind === kind);

  const outcome = query.connected
    ? { tone: 'healthy', text: m.connections_connected_now({ name: nameOf(query.connected) }) }
    : query.failed
      ? { tone: 'warning', text: m.connections_failed_now({ name: nameOf(query.failed) }) }
      : query.cancelled
        ? { tone: 'warning', text: m.connections_cancelled_now({ name: nameOf(query.cancelled) }) }
        : null;

  const stages: { title: string; done: boolean; state: string; tone: string }[] = [
    {
      title: m.connections_stage_code(),
      done: has('code_host'),
      state: has('code_host') ? m.connections_state_done() : m.connections_state_todo(),
      tone: has('code_host') ? 'healthy' : 'failing',
    },
    {
      title: m.connections_stage_dev(),
      done: true,
      state: m.connections_state_included(),
      tone: 'healthy',
    },
    {
      title: m.connections_stage_publish(),
      done: has('hosting'),
      state: has('hosting') ? m.connections_state_done() : m.connections_state_todo(),
      tone: has('hosting') ? 'healthy' : 'warning',
    },
    {
      title: m.connections_stage_data(),
      done: has('database'),
      state: has('database') ? m.connections_state_done() : m.connections_state_if_needed(),
      tone: has('database') ? 'healthy' : 'idle',
    },
    {
      title: m.connections_stage_extras(),
      done: has('analytics') || has('ai'),
      state:
        has('analytics') || has('ai') ? m.connections_state_done() : m.connections_state_optional(),
      tone: has('analytics') || has('ai') ? 'healthy' : 'idle',
    },
  ];

  return (
    <>
      <PageHead title={m.connections_title()} intro={m.connections_intro()} />

      {outcome && (
        <div className={`verdict ${outcome.tone}`}>
          <div>
            <h3>{outcome.text}</h3>
          </div>
        </div>
      )}

      <section className="card path-card">
        <header className="card-head">
          <h2>{m.connections_path_title()}</h2>
        </header>
        <ol className="path">
          {stages.map((s) => (
            <li key={s.title} className={s.done ? 'done' : undefined}>
              <span className="path-mark">{s.done ? <Icon name="check" /> : null}</span>
              <strong>{s.title}</strong>
              <StateDot state={s.tone} text={s.state} />
            </li>
          ))}
        </ol>
        <p className="small soft">
          {!has('code_host')
            ? m.connections_start()
            : has('hosting')
              ? m.connections_ready_all()
              : m.connections_ready_code()}
        </p>
      </section>

      {KINDS.map(({ kind, need, why }) => {
        const providers = available.filter((a) => a.kind === kind);
        if (providers.length === 0) return null;
        const done = has(kind);
        return (
          <section className="block" key={kind} id={`kind-${kind}`}>
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
                  asked={query.connect === a.provider}
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
  asked,
  onChange,
}: Readonly<{
  available: Available;
  connection: ConnectionView | undefined;
  asked: boolean;
  onChange: () => void;
}>) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = nameOf(available.provider);
  const id = `provider-${available.provider}`;

  // Opened from an agent's link: this provider's form, in view.
  useEffect(() => {
    if (!asked || connection) return;
    if (!available.signIn) setOpen(true);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [asked, connection, available.signIn, id]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = Object.fromEntries(
      available.fields
        .map((f) => [f, String(form.get(f) ?? '').trim()] as const)
        .filter(([, v]) => v !== ''),
    );
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
    <section className={`card${asked && !connection ? ' asked' : ''}`} id={id}>
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
            {available.keyUrl && (
              <div className="key-step">
                <span className="small">{m.connections_step_open({ name })}</span>
                <a
                  className="btn btn-ghost btn-sm"
                  href={available.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="external" />
                  {m.connections_open_key({ name })}
                </a>
                {available.keyScopes && <small className="mute">{available.keyScopes}</small>}
              </div>
            )}
            <span className="small">{m.connections_step_paste()}</span>
            {available.fields.map((field) => (
              <div className="field" key={field}>
                <label htmlFor={`${available.provider}-${field}`}>
                  {label('field', field)}
                  {available.optionalFields.includes(field) && (
                    <span className="mute"> · {m.connections_optional()}</span>
                  )}
                </label>
                <input
                  id={`${available.provider}-${field}`}
                  name={field}
                  type={['token', 'apiKey', 'password'].includes(field) ? 'password' : 'text'}
                  autoComplete="off"
                  required={!available.optionalFields.includes(field)}
                />
              </div>
            ))}
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
          <div className="row" style={{ gap: 6 }}>
            {available.kind === 'code_host' && available.signIn && (
              <a className="btn btn-ghost btn-xs" href={available.signIn}>
                {m.connections_reconnect()}
              </a>
            )}
            <button type="button" className="btn btn-danger btn-xs" onClick={cut}>
              {m.connections_cut()}
            </button>
          </div>
        ) : (
          !open && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {available.signIn ? (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => setOpen(true)}
                  >
                    {m.connections_with_key()}
                  </button>
                  <a className="btn btn-primary btn-xs" href={available.signIn}>
                    {m.connections_sign_in({ name })}
                  </a>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-xs"
                  onClick={() => setOpen(true)}
                >
                  {m.connections_connect()}
                </button>
              )}
            </div>
          )
        )}
      </div>
    </section>
  );
}
