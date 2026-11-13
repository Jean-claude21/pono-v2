import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { LimitChooser, type LimitDetail } from '@/features/servers/LimitChooser';
import { Shell } from '@/features/shell/Shell';
import { api, useApi } from '@/lib/api';
import { ago, label, money } from '@/lib/labels';
import { Card, Stats } from '@/features/shell/ui';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/servers')({
  component: () => (
    <Shell section="servers">
      <Servers />
    </Shell>
  ),
});

export interface ServerView {
  id: string;
  projectId: string;
  projectName: string;
  agent: string;
  status: string;
  size: string;
  url: string | null;
  monthlyMicros: number;
  statusAt: string;
}

interface ServersView {
  plan: string;
  limit: number;
  active: number;
  servers: ServerView[];
}

function Servers() {
  const data = useApi<ServersView>('/v1/servers');
  const [limit, setLimit] = useState<{ detail: LimitDetail; serverId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!data.result) return <p className="mute">{m.loading()}</p>;
  if (!data.result.ok) return <p className="notice">{label('error', data.result.error.code)}</p>;
  const { plan, active, servers, limit: slots } = data.result.data;

  const gesture = async (path: string, body?: unknown, method = 'POST') => {
    setError(null);
    const result = await api<unknown>(path, { method, ...(body === undefined ? {} : { body }) });
    if (!result.ok) {
      setError(label('error', result.error.code));
      return false;
    }
    data.reload();
    return true;
  };
  const wake = async (id: string, sleepServerId?: string) => {
    const result = await api<unknown>(`/v1/servers/${id}/wake`, {
      method: 'POST',
      body: sleepServerId ? { sleepServerId } : {},
    });
    if (!result.ok && result.error.code === 'servers.limit_reached' && result.error.detail) {
      return setLimit({ detail: result.error.detail as unknown as LimitDetail, serverId: id });
    }
    if (!result.ok) return setError(label('error', result.error.code));
    setLimit(null);
    data.reload();
  };

  return (
    <>
      <div className="topline">
        <div>
          <h1>{m.servers_title()}</h1>
          <p className="mute mt-sm">{m.servers_intro()}</p>
        </div>
      </div>
      <Card title={m.rail_plan_title()} icon="server">
        <Stats
          items={[
            {
              value: `${active}/${slots}`,
              label: m.overview_servers_slots(),
              ...(active >= slots ? { tone: 'warning' as const } : {}),
            },
            {
              value: servers.filter((x) => x.status === 'running').length,
              label: m.overview_servers_running(),
            },
            {
              value: money(servers.reduce((sum, x) => sum + x.monthlyMicros, 0)),
              label: m.overview_servers_month(),
            },
          ]}
        />
        <span className="mono-label">
          {m.servers_active({
            active: String(active),
            limit: String(slots),
            plan: label('plan', plan),
          })}
        </span>
        <div className="slots-bar">
          {Array.from({ length: slots }, (_, i) => (
            <i key={i} className={i < active ? (active >= slots ? 'full' : 'on') : ''} />
          ))}
        </div>
      </Card>
      {limit && (
        <LimitChooser
          detail={limit.detail}
          onCancel={() => setLimit(null)}
          onChoose={(sleepId) => wake(limit.serverId, sleepId)}
        />
      )}
      {error && <p className="notice warning">{error}</p>}
      {servers.length === 0 ? (
        <p className="notice mt-lg">{m.servers_none()}</p>
      ) : (
        <Card title={m.servers_title()} icon="server" className="mt-md">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{m.col_project()}</th>
                  <th>{m.col_state()}</th>
                  <th>{m.col_agent()}</th>
                  <th>{m.col_size()}</th>
                  <th className="num">{m.col_cost()}</th>
                  <th className="num" />
                </tr>
              </thead>
              <tbody>
                {servers.map((s) => (
                  <tr key={s.id}>
                    <td className="project">
                      <a href={`/projects/${s.projectId}`} style={{ textDecoration: 'none' }}>
                        {s.projectName}
                      </a>
                      <small>{s.url ?? '—'}</small>
                    </td>
                    <td>
                      <span
                        className={`state state-${s.status === 'running' ? 'healthy' : s.status === 'failed' ? 'failing' : s.status === 'waking' || s.status === 'provisioning' ? 'warning' : 'idle'}`}
                      >
                        {label('serverStatus', s.status)}
                      </span>
                      <div className="tiny mute">{ago(s.statusAt)}</div>
                    </td>
                    <td className="small">{label('agent', s.agent)}</td>
                    <td className="figures tiny">{s.size}</td>
                    <td className="num figures">{money(s.monthlyMicros)}</td>
                    <td className="num">
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        {s.status === 'running' ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            onClick={() => gesture(`/v1/servers/${s.id}/sleep`)}
                          >
                            {m.servers_sleep()}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            onClick={() => wake(s.id)}
                          >
                            {m.servers_wake()}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-danger btn-xs"
                          onClick={() => {
                            if (window.confirm(m.servers_release_confirm()))
                              void gesture(`/v1/servers/${s.id}`, undefined, 'DELETE');
                          }}
                        >
                          {m.servers_release()}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
