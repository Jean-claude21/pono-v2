import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Shell } from '@/features/shell/Shell';
import { Card, PageHead, StateDot } from '@/features/shell/ui';
import { ConnectAgent } from '@/features/start/Start';
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

/** An agent that called within the hour is shown as live. */
const LIVE_MS = 60 * 60 * 1000;

/** What an agent can do through Pono's MCP server, by family of tools. */
const CAN: readonly { title: () => string; body: () => string; tools: string }[] = [
  {
    title: m.agents_can_projects,
    body: m.agents_can_projects_body,
    tools: 'list_projects · find_project · resume_project · adopt_project · launch_project',
  },
  {
    title: m.agents_can_dev,
    body: m.agents_can_dev_body,
    tools: 'start_dev · dev_status · pull_changes · push_changes · check_secrets',
  },
  {
    title: m.agents_can_code,
    body: m.agents_can_code_body,
    tools:
      'list_files · search_code · read_file · edit_file · write_file · run_command · show_changes',
  },
  {
    title: m.agents_can_release,
    body: m.agents_can_release_body,
    tools: 'propose_release · list_releases · request_rollback',
  },
  {
    title: m.agents_can_skills,
    body: m.agents_can_skills_body,
    tools: 'get_skill · set_skills · create_skill · save_as_template · list_templates',
  },
  {
    title: m.agents_can_servers,
    body: m.agents_can_servers_body,
    tools: 'list_servers · wake_server · sleep_server · read_usage · read_site_metrics',
  },
  {
    title: m.agents_can_variables,
    body: m.agents_can_variables_body,
    tools: 'list_variables · request_variable · get_profile · set_level',
  },
];

/**
 * The coding agents linked to the person's workshop (D-022): how it works, who is linked, how to
 * give an access, and what an agent may and may never do.
 */
function Agents() {
  const data = useApi<{ agents: AgentView[] }>('/v1/agents');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<'read' | 'act'>('read');

  const give = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setError(null);
    const result = await api<{ token: string }>('/v1/agents', {
      method: 'POST',
      body: { name: String(f.get('name') ?? ''), scope },
    });
    if (!result.ok) return setError(label('error', result.error.code));
    setToken(result.data.token);
    data.reload();
  };
  const cut = async (id: string, name: string) => {
    if (!window.confirm(m.agents_cut_confirm({ name }))) return;
    await api(`/v1/agents/${id}`, { method: 'DELETE' });
    data.reload();
  };
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const agents = data.result?.ok ? data.result.data.agents : [];
  const now = Date.now();

  return (
    <>
      <PageHead title={m.agents_title()} intro={m.agents_what()} />

      {token && (
        <div className="verdict healthy">
          <div style={{ minWidth: 0, flex: 1 }}>
            <span className="mono-label">{m.agents_token_once()}</span>
            <code className="address">{token}</code>
            <p className="small mt-sm">{m.agents_config()}</p>
            <code className="address">{`claude mcp add --transport http pono ${origin}/mcp --header "Authorization: Bearer ${token}"`}</code>
            <p className="small mt-sm">{m.agents_config_codex()}</p>
            <code className="address">{`[mcp_servers.pono]\nurl = "${origin}/mcp"\nbearer_token_env_var = "PONO_TOKEN"`}</code>
          </div>
        </div>
      )}

      <Card title={m.agents_connect_title()} icon="plug">
        <ConnectAgent />
      </Card>

      <div className="grid-cards two">
        <Card
          title={m.agents_linked({ count: String(agents.length) })}
          icon="bot"
          foot={m.agents_intro()}
        >
          {data.result?.ok && agents.length === 0 && (
            <p className="mute small">{m.agents_none()}</p>
          )}
          <ul className="lines">
            {agents.map((a) => {
              const live = a.lastUsedAt ? now - new Date(a.lastUsedAt).getTime() < LIVE_MS : false;
              return (
                <li key={a.id}>
                  <div className="line-top">
                    <span className="name">{a.name}</span>
                    <span className="tag">
                      {a.scope === 'act' ? m.agents_scope_act() : m.agents_scope_read()}
                    </span>
                    <button
                      type="button"
                      className="btn btn-danger btn-xs"
                      onClick={() => cut(a.id, a.name)}
                    >
                      {m.agents_cut()}
                    </button>
                  </div>
                  <div className="line-top" style={{ marginTop: 4 }}>
                    <StateDot
                      state={live ? 'healthy' : 'idle'}
                      live={live}
                      text={
                        a.lastUsedAt
                          ? m.agents_last_used({ when: ago(a.lastUsedAt) })
                          : m.agents_never_used()
                      }
                    />
                    <span className="sub" style={{ marginLeft: 'auto' }}>
                      {m.agents_created({ when: ago(a.createdAt) })}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title={m.connect_manual()} icon="key">
          <form className="form" style={{ marginTop: 0 }} onSubmit={give}>
            <div className="field">
              <label htmlFor="agent-name">{m.agents_name()}</label>
              <input
                id="agent-name"
                name="name"
                required
                maxLength={60}
                defaultValue="Claude Code"
              />
            </div>
            <div className="tiles" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 0 }}>
              <button
                type="button"
                className="tile"
                aria-pressed={scope === 'read'}
                onClick={() => setScope('read')}
              >
                <h4>{m.agents_scope_read()}</h4>
                <p>{m.agents_scope_read_body()}</p>
              </button>
              <button
                type="button"
                className="tile"
                aria-pressed={scope === 'act'}
                onClick={() => setScope('act')}
              >
                <h4>{m.agents_scope_act()}</h4>
                <p>{m.agents_scope_act_body()}</p>
              </button>
            </div>
            {error && <p className="small bad">{error}</p>}
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              style={{ justifySelf: 'start' }}
            >
              {m.agents_give()}
            </button>
          </form>
        </Card>
      </div>

      <section className="block">
        <div className="block-head">
          <h2>{m.agents_can_title()}</h2>
          <p>{m.agents_can_body()}</p>
        </div>
        <div className="grid-cards">
          {CAN.map((c) => (
            <Card key={c.tools} title={c.title()} icon="code">
              <p className="small soft">{c.body()}</p>
              <p className="tiny mute figures mt-sm">{c.tools}</p>
            </Card>
          ))}
        </div>
      </section>

      <div className="verdict warning mt-lg">
        <div>
          <span className="mono-label">{m.agents_never_label()}</span>
          <h3>{m.agents_never()}</h3>
        </div>
      </div>
    </>
  );
}
