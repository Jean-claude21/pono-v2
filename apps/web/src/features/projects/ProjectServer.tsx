import { useState } from 'react';
import { LimitChooser, type LimitDetail } from '@/features/servers/LimitChooser';
import { api, useApi } from '@/lib/api';
import { label, money } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';

interface ServerView {
  id: string;
  projectId: string;
  status: string;
  size: string;
  url: string | null;
  agent: string;
  monthlyMicros: number;
}

/** The project's dev server: give one, wake it, put it to sleep (phase 4). */
export function ProjectServer({ projectId }: Readonly<{ projectId: string }>) {
  const data = useApi<{ servers: ServerView[] }>('/v1/servers');
  const [limit, setLimit] = useState<{
    detail: LimitDetail;
    retry: (sleepId: string) => Promise<void>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const server = data.result?.ok
    ? data.result.data.servers.find((s) => s.projectId === projectId)
    : undefined;

  const run = async (path: string, body: Record<string, unknown>): Promise<void> => {
    setError(null);
    const result = await api(path, { method: 'POST', body });
    if (!result.ok && result.error.code === 'servers.limit_reached' && result.error.detail) {
      setLimit({
        detail: result.error.detail as unknown as LimitDetail,
        retry: (sleepServerId) => run(path, { ...body, sleepServerId }),
      });
      return;
    }
    if (!result.ok) {
      setError(label('error', result.error.code));
      return;
    }
    setLimit(null);
    data.reload();
  };

  return (
    <section>
      <h3 className="section-title mono-label">{m.project_server()}</h3>
      {limit && (
        <LimitChooser
          detail={limit.detail}
          onCancel={() => setLimit(null)}
          onChoose={(id) => void limit.retry(id)}
        />
      )}
      {error && <p className="notice warning">{error}</p>}
      {!server ? (
        <div className="item">
          <div>
            <p className="small soft">{m.project_no_server()}</p>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => run(`/v1/projects/${projectId}/server`, { agent: 'claude-code' })}
            >
              {m.servers_give()}
            </button>
          </div>
        </div>
      ) : (
        <div className="item">
          <div>
            <h4>
              <span className={`state state-${server.status === 'running' ? 'healthy' : 'idle'}`}>
                {label('serverStatus', server.status)}
              </span>
            </h4>
            <p>
              {label('agent', server.agent)} · {server.size} · {money(server.monthlyMicros)} ·{' '}
              {server.url ?? '—'}
            </p>
          </div>
          <div className="row">
            {server.status === 'running' ? (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => run(`/v1/servers/${server.id}/sleep`, {})}
              >
                {m.servers_sleep()}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => run(`/v1/servers/${server.id}/wake`, {})}
              >
                {m.servers_wake()}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
