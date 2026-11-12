import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Shell } from '@/features/shell/Shell';
import { api, useApi } from '@/lib/api';
import { ago, label } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/agents')({
  component: () => (
    <Shell section="agents">
      <Agents />
    </Shell>
  ),
});

interface AgentView {
  id: string;
  name: string;
  scope: string;
  createdAt: string;
  lastUsedAt: string | null;
}

function Agents() {
  const data = useApi<{ agents: AgentView[] }>('/v1/agents');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const give = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const result = await api<{ token: string }>('/v1/agents', {
      method: 'POST',
      body: { name: String(f.get('name') ?? ''), scope: String(f.get('scope')) },
    });
    if (!result.ok) return setError(label('error', result.error.code));
    setToken(result.data.token);
    data.reload();
  };
  const cut = async (id: string) => {
    await api(`/v1/agents/${id}`, { method: 'DELETE' });
    data.reload();
  };
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <>
      <div className="topline">
        <div>
          <h1>{m.agents_title()}</h1>
          <p className="mute mt-sm">{m.agents_intro()}</p>
        </div>
      </div>
      {token && (
        <div className="verdict healthy">
          <div style={{ minWidth: 0 }}>
            <span className="mono-label">{m.agents_token_once()}</span>
            <code className="address">{token}</code>
            <p className="small mt-sm">{m.agents_config()}</p>
            <code className="address">{`claude mcp add --transport http pono ${origin}/mcp --header "Authorization: Bearer ${token}"`}</code>
          </div>
        </div>
      )}
      <div className="list mt-lg">
        {data.result?.ok && data.result.data.agents.length === 0 && (
          <p className="mute small">{m.agents_none()}</p>
        )}
        {data.result?.ok &&
          data.result.data.agents.map((a) => (
            <div className="item" key={a.id}>
              <div>
                <h4>{a.name}</h4>
                <p>
                  {a.scope === 'act' ? m.agents_scope_act() : m.agents_scope_read()}
                  {a.lastUsedAt ? ` · ${m.agents_last_used({ when: ago(a.lastUsedAt) })}` : ''}
                </p>
              </div>
              <div className="row">
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => cut(a.id)}>
                  {m.agents_cut()}
                </button>
              </div>
            </div>
          ))}
      </div>
      <h3 className="section-title mono-label">{m.agents_give()}</h3>
      <form className="form" onSubmit={give}>
        <div className="field">
          <label htmlFor="agent-name">{m.agents_name()}</label>
          <input id="agent-name" name="name" required maxLength={60} defaultValue="Claude Code" />
        </div>
        <fieldset className="choices">
          <label className="choice">
            <input type="radio" name="scope" value="read" defaultChecked />
            <strong>{m.agents_scope_read()}</strong>
          </label>
          <label className="choice">
            <input type="radio" name="scope" value="act" />
            <strong>{m.agents_scope_act()}</strong>
          </label>
        </fieldset>
        {error && <p className="small bad">{error}</p>}
        <button type="submit" className="btn btn-primary btn-sm" style={{ justifySelf: 'start' }}>
          {m.agents_give()}
        </button>
      </form>
    </>
  );
}
