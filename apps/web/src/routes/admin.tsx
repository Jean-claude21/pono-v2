import { createFileRoute } from '@tanstack/react-router';
import { AdminCatalog } from '@/features/admin/AdminCatalog';
import { Shell } from '@/features/shell/Shell';
import { api, useApi } from '@/lib/api';
import { ago, label, money } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/admin')({
  component: () => (
    <Shell section="admin">
      <Admin />
    </Shell>
  ),
});

interface Overview {
  organizations: number;
  paying: number;
  projects: number;
  activeServers: number;
  sleepingServers: number;
  monthlyRevenueMicros: number;
  monthlyServerCostMicros: number;
  serverAccount: { balanceMicros: number; activeLimit: number } | null;
}

interface Org {
  id: string;
  name: string;
  plan: string;
  projects: number;
  activeServers: number;
  sleepingServers: number;
  serverMicros: number;
  revenueMicros: number;
}

interface Server {
  id: string;
  organization: string;
  project: string;
  status: string;
  size: string;
  monthlyMicros: number;
  statusAt: string;
}

/** The operator's view (phase 7): counts and states across organizations, never code, data or keys. */
function Admin() {
  const overview = useApi<Overview>('/v1/admin/overview');
  const orgs = useApi<{ organizations: Org[] }>('/v1/admin/organizations');
  const servers = useApi<{ servers: Server[] }>('/v1/admin/servers');
  if (!overview.result) return <p className="mute">{m.loading()}</p>;
  if (!overview.result.ok)
    return <p className="notice">{label('error', overview.result.error.code)}</p>;
  const o = overview.result.data;

  const sleep = async (id: string) => {
    await api(`/v1/admin/servers/${id}/sleep`, { method: 'POST' });
    servers.reload();
    overview.reload();
  };

  return (
    <>
      <div className="topline">
        <h1>{m.admin_title()}</h1>
      </div>
      <div className="kpis">
        <div className="kpi">
          <span className="mono-label">{m.admin_revenue()}</span>
          <div className="value">{money(o.monthlyRevenueMicros)}</div>
          <p>
            {o.paying} {m.admin_paying()}
          </p>
        </div>
        <div className="kpi">
          <span className="mono-label">{m.admin_server_cost()}</span>
          <div className="value">{money(o.monthlyServerCostMicros)}</div>
          <p>{label('source', 'estimated')}</p>
        </div>
        <div className="kpi">
          <span className="mono-label">{m.admin_awake()}</span>
          <div className="value">
            {o.activeServers}
            {o.serverAccount ? <small>/ {o.serverAccount.activeLimit}</small> : null}
          </div>
          <p>
            {o.sleepingServers} · {label('serverStatus', 'sleeping')}
          </p>
        </div>
        <div className="kpi">
          <span className="mono-label">{m.admin_wallet()}</span>
          <div className="value">
            {o.serverAccount ? money(o.serverAccount.balanceMicros) : '—'}
          </div>
          <p>
            {o.organizations} {m.admin_organizations().toLowerCase()} · {o.projects}{' '}
            {m.admin_projects().toLowerCase()}
          </p>
        </div>
      </div>

      <h3 className="section-title mono-label">{m.admin_organizations()}</h3>
      <table className="table">
        <thead>
          <tr>
            <th>{m.col_organization()}</th>
            <th>{m.col_plan()}</th>
            <th className="num">{m.admin_projects()}</th>
            <th className="num">{m.col_servers()}</th>
            <th className="num">{m.col_cost()}</th>
            <th className="num">{m.admin_revenue()}</th>
          </tr>
        </thead>
        <tbody>
          {orgs.result?.ok &&
            orgs.result.data.organizations.map((org) => (
              <tr key={org.id}>
                <td className="project">{org.name}</td>
                <td>{label('plan', org.plan)}</td>
                <td className="num figures">{org.projects}</td>
                <td className="num figures">
                  {org.activeServers} / {org.activeServers + org.sleepingServers}
                </td>
                <td className="num figures">{money(org.serverMicros)}</td>
                <td className="num figures">{money(org.revenueMicros)}</td>
              </tr>
            ))}
        </tbody>
      </table>

      <h3 className="section-title mono-label">{m.col_servers()}</h3>
      <table className="table">
        <thead>
          <tr>
            <th>{m.col_project()}</th>
            <th>{m.col_state()}</th>
            <th>{m.col_size()}</th>
            <th className="num">{m.col_cost()}</th>
            <th className="num" />
          </tr>
        </thead>
        <tbody>
          {servers.result?.ok &&
            servers.result.data.servers.map((s) => (
              <tr key={s.id}>
                <td className="project">
                  {s.project}
                  <small>{s.organization}</small>
                </td>
                <td>
                  {label('serverStatus', s.status)}{' '}
                  <span className="tiny mute">{ago(s.statusAt)}</span>
                </td>
                <td className="figures tiny">{s.size}</td>
                <td className="num figures">{money(s.monthlyMicros)}</td>
                <td className="num">
                  {s.status === 'running' && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => sleep(s.id)}
                    >
                      {m.servers_sleep()}
                    </button>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      <AdminCatalog />
    </>
  );
}
