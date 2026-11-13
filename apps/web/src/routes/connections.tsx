import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Shell } from '@/features/shell/Shell';
import { api, useApi, type ConnectionView } from '@/lib/api';
import { label } from '@/lib/labels';
import { Card } from '@/features/shell/ui';
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

function Connections() {
  const data = useApi<{ connections: ConnectionView[]; available: Available[] }>('/v1/connections');
  if (!data.result) return <p className="mute">{m.loading()}</p>;
  if (!data.result.ok) return <p className="notice">{label('error', data.result.error.code)}</p>;
  const { connections, available } = data.result.data;
  const kinds = ['code_host', 'hosting', 'database', 'ai', 'analytics'];
  return (
    <>
      <div className="topline">
        <div>
          <h1>{m.connections_title()}</h1>
          <p className="mute mt-sm">{m.connections_intro()}</p>
        </div>
      </div>
      {kinds.map((kind) => (
        <section key={kind}>
          <Card title={label('kind', kind)} icon="plug">
            <div className="list">
              {available
                .filter((a) => a.kind === kind)
                .map((a) => (
                  <Provider
                    key={a.provider}
                    available={a}
                    connection={connections.find((c) => c.provider === a.provider)}
                    onChange={data.reload}
                  />
                ))}
            </div>
          </Card>
        </section>
      ))}
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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = Object.fromEntries(available.fields.map((f) => [f, String(form.get(f) ?? '')]));
    setBusy(true);
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
    if (!connection) return;
    await api(`/v1/connections/${connection.id}`, { method: 'DELETE' });
    onChange();
  };

  return (
    <div className="item">
      <div>
        <h4>
          {available.provider}
          {connection && (
            <span className="state state-healthy" style={{ fontWeight: 400, marginLeft: 8 }}>
              {m.connections_connected()}
            </span>
          )}
        </h4>
        {connection && <p>{connection.account}</p>}
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
            {error && <p className="small bad">{error}</p>}
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={busy}
              style={{ justifySelf: 'start' }}
            >
              {m.connections_connect()}
            </button>
          </form>
        )}
      </div>
      <div className="row">
        {connection ? (
          <button type="button" className="btn btn-ghost btn-xs" onClick={cut}>
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
    </div>
  );
}
