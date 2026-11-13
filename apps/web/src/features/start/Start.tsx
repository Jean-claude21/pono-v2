import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '@/features/shell/ui';
import { api, useApi } from '@/lib/api';
import { nameOf } from '@/lib/providers';
import * as m from '@/paraglide/messages.js';

interface AgentView {
  id: string;
  name: string;
  lastUsedAt: string | null;
}

const SKIP_KEY = 'pono-start';

function origin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

/** A value to paste, with its copy button. */
export function CopyField({ value, label }: Readonly<{ value: string; label?: string }>) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // The value stays selectable by hand.
    }
  };
  return (
    <div className="copy-field">
      <code aria-label={label}>{value}</code>
      <button type="button" className="btn btn-ghost btn-xs" onClick={copy}>
        {copied ? m.connect_copied() : m.connect_copy()}
      </button>
    </div>
  );
}

type Client = 'claude' | 'chatgpt' | 'claude-code' | 'codex';
const CLIENTS: readonly { id: Client; name: string }[] = [
  { id: 'claude', name: 'Claude' },
  { id: 'chatgpt', name: 'ChatGPT' },
  { id: 'claude-code', name: nameOf('claude-code') },
  { id: 'codex', name: nameOf('codex') },
];

/**
 * How to add Pono to an assistant (D-027): the MCP address to paste, OAuth does the rest. Codex
 * alone takes an access key. The same block on the welcome and on the Agents page.
 */
export function ConnectAgent() {
  const [client, setClient] = useState<Client>('claude');
  const [key, setKey] = useState<string | null>(null);
  const url = `${origin()}/mcp`;
  const steps: Record<Client, ReactNode> = {
    claude: (
      <ol className="how">
        <li>{m.connect_claude_1()}</li>
        <li>
          {m.connect_claude_2()}
          <CopyField value={url} label={m.connect_address()} />
        </li>
        <li>{m.connect_claude_3()}</li>
      </ol>
    ),
    chatgpt: (
      <ol className="how">
        <li>{m.connect_chatgpt_1()}</li>
        <li>
          {m.connect_chatgpt_2()}
          <CopyField value={url} label={m.connect_address()} />
        </li>
        <li>{m.connect_chatgpt_3()}</li>
      </ol>
    ),
    'claude-code': (
      <ol className="how">
        <li>
          {m.connect_code_1()}
          <CopyField value={`claude mcp add --transport http pono ${url}`} />
        </li>
        <li>{m.connect_code_2()}</li>
      </ol>
    ),
    codex: (
      <ol className="how">
        <li>
          {m.connect_codex_1()}
          {key ? (
            <CopyField value={key} />
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm mt-sm"
              onClick={async () => {
                const r = await api<{ token: string }>('/v1/agents', {
                  method: 'POST',
                  body: { name: 'Codex', scope: 'act' },
                });
                if (r.ok) setKey(r.data.token);
              }}
            >
              {m.connect_codex_create()}
            </button>
          )}
        </li>
        <li>
          {m.connect_codex_2()}
          <CopyField
            value={`[mcp_servers.pono]\nurl = "${url}"\nbearer_token_env_var = "PONO_TOKEN"`}
          />
        </li>
      </ol>
    ),
  };
  return (
    <div className="connect-agent">
      <div className="segmented">
        {CLIENTS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={client === c.id}
            onClick={() => setClient(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>
      {steps[client]}
      <p className="small soft">{m.connect_try()}</p>
    </div>
  );
}

/** The live answer: an agent that called Pono at least once. */
function useLinkedAgent(): AgentView | null {
  const agents = useApi<{ agents: AgentView[] }>('/v1/agents');
  const { reload } = agents;
  const linked = agents.result?.ok
    ? (agents.result.data.agents.find((a) => a.lastUsedAt) ?? null)
    : null;
  useEffect(() => {
    if (linked) return;
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, [linked, reload]);
  return linked;
}

function Step({
  n,
  done,
  title,
  body,
  children,
}: Readonly<{ n: number; done: boolean; title: string; body: string; children?: ReactNode }>) {
  return (
    <li className={`start-step${done ? ' done' : ''}`}>
      <span className="start-mark">{done ? <Icon name="check" /> : n}</span>
      <div className="start-step-body">
        <h3>{title}</h3>
        {!done && <p className="small soft">{body}</p>}
        {children}
      </div>
    </li>
  );
}

/**
 * The welcome (D-027): GitHub is already there from the sign-in; the agent is connected and seen
 * calling Pono; a first project. Never a gate: it can be put aside, and it goes once done.
 */
export function Start({
  hasCodeHost,
  projects,
}: Readonly<{ hasCodeHost: boolean; projects: number }>) {
  const [skipped, setSkipped] = useState(true);
  useEffect(() => {
    try {
      setSkipped(window.localStorage.getItem(SKIP_KEY) === 'skipped');
    } catch {
      setSkipped(false);
    }
  }, []);
  const agent = useLinkedAgent();
  const done = [hasCodeHost, agent !== null, projects > 0];
  const count = done.filter(Boolean).length;
  if (skipped || count === 3) return null;
  const skip = () => {
    try {
      window.localStorage.setItem(SKIP_KEY, 'skipped');
    } catch {
      // Private mode: put aside for this visit only.
    }
    setSkipped(true);
  };

  return (
    <section className="card start">
      <header className="start-head">
        <div>
          <span className="mono-label">
            {m.start_label()} · {m.start_progress({ done: String(count) })}
          </span>
          <h2>{m.start_title()}</h2>
          <p className="soft">{m.start_body()}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-xs" onClick={skip}>
          {m.start_skip()}
        </button>
      </header>
      <ol className="start-steps">
        <Step
          n={1}
          done={hasCodeHost}
          title={hasCodeHost ? m.start_step_github() : m.start_step_github_todo()}
          body={m.start_step_github_body()}
        >
          {!hasCodeHost && (
            <a className="btn btn-primary btn-sm mt-sm" href="/connections">
              {m.start_step_github_todo()}
            </a>
          )}
        </Step>
        <Step
          n={2}
          done={agent !== null}
          title={agent ? m.start_step_agent_done({ name: agent.name }) : m.start_step_agent()}
          body={m.start_step_agent_body()}
        >
          {!agent && (
            <>
              <ConnectAgent />
              <p className="state state-active live small">{m.connect_waiting()}</p>
            </>
          )}
        </Step>
        <Step
          n={3}
          done={projects > 0}
          title={
            projects > 0
              ? m.start_step_project_done({ count: String(projects) })
              : m.start_step_project()
          }
          body={m.start_step_project_body()}
        >
          {projects === 0 && (
            <>
              <div className="row mt-sm" style={{ flexWrap: 'wrap', gap: 8 }}>
                <a className="btn btn-ghost btn-sm" href="/import">
                  {m.start_import()}
                </a>
                <a className="btn btn-ghost btn-sm" href="/catalog">
                  {m.start_template()}
                </a>
              </div>
              <p className="small soft mt-sm">{m.start_ask()}</p>
              <CopyField value={m.start_ask_text()} />
            </>
          )}
        </Step>
      </ol>
    </section>
  );
}
