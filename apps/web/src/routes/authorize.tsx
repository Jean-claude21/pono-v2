import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { SignIn } from '@/features/shell/SignIn';
import { api, useApi, type Me } from '@/lib/api';
import { label } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/authorize')({
  component: Authorize,
});

/**
 * A person lets an MCP client (the Claude.ai connector) act for them (D-019). The answer goes back
 * to the client with a one-time code; the access then appears among the agents, cut in one click.
 */
function Authorize() {
  const me = useApi<Me>('/v1/me');
  const query = Object.fromEntries(new URLSearchParams(window.location.search));
  const client = useApi<{ name: string }>(
    `/oauth/client?client_id=${encodeURIComponent(query.client_id ?? '')}`,
  );
  const [scope, setScope] = useState<'read' | 'act'>(
    (query.scope ?? '').split(' ').includes('act') ? 'act' : 'read',
  );
  const [error, setError] = useState<string | null>(null);
  if (!me.result || !client.result) return <p className="page mute">{m.loading()}</p>;
  if (!me.result.ok) return <SignIn />;
  if (!client.result.ok)
    return <p className="page notice">{label('error', client.result.error.code)}</p>;

  const decide = async (approve: boolean) => {
    const result = await api<{ redirect: string }>('/oauth/decision', {
      method: 'POST',
      body: { approve, scope, query },
    });
    if (!result.ok) return setError(label('error', result.error.code));
    window.location.assign(result.data.redirect);
  };

  return (
    <div className="auth">
      <div className="auth-box">
        <a className="monogram" href="/">
          <b>P</b>Pono
        </a>
        <h1 className="mt-lg">{m.authorize_title({ client: client.result.data.name })}</h1>
        <p className="soft mt-sm">{m.authorize_body()}</p>
        <div className="stack mt-md">
          <label className="row small">
            <input type="radio" checked={scope === 'read'} onChange={() => setScope('read')} />{' '}
            {m.agents_scope_read()}
          </label>
          <label className="row small">
            <input type="radio" checked={scope === 'act'} onChange={() => setScope('act')} />{' '}
            {m.agents_scope_act()}
          </label>
        </div>
        <p className="mute small mt-md">{m.authorize_never()}</p>
        {error && <p className="notice mt-md">{error}</p>}
        <div className="row mt-lg">
          <button type="button" className="btn btn-primary" onClick={() => decide(true)}>
            {m.authorize_allow()}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => decide(false)}>
            {m.authorize_deny()}
          </button>
        </div>
      </div>
    </div>
  );
}
