import { createFileRoute } from '@tanstack/react-router';
import { AdminCatalog, type Entry } from '@/features/admin/AdminCatalog';
import { Shell } from '@/features/shell/Shell';
import { Card, PageHead, StateDot, Stats, Thin } from '@/features/shell/ui';
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

/** Top-ups offered from the wallet card, in USD. */
const TOP_UPS = [10, 25, 50] as const;

/** Under this balance the Agent37 wallet is said to be nearly empty. */
const LOW_WALLET_MICROS = 5_000_000;

function serverState(status: string): string {
  if (status === 'running') return 'healthy';
  if (status === 'failed') return 'failing';
  if (status === 'waking' || status === 'provisioning') return 'warning';
  return 'idle';
}

interface Finding {
  tone: 'failing' | 'warning';
  text: string;
}

/** What the operator should look at first: the wallet, the server slots, the catalog reviews. */
function findings(o: Overview, proposed: number): Finding[] {
  const out: Finding[] = [];
  const account = o.serverAccount;
  if (account && account.balanceMicros < o.monthlyServerCostMicros)
    out.push({
      tone: 'failing',
      text: m.admin_wallet_short({
        balance: money(account.balanceMicros),
        cost: money(o.monthlyServerCostMicros),
      }),
    });
  else if (account && account.balanceMicros < LOW_WALLET_MICROS)
    out.push({
      tone: 'warning',
      text: m.admin_wallet_low({ balance: money(account.balanceMicros) }),
    });
  if (account && o.activeServers >= account.activeLimit)
    out.push({
      tone: 'warning',
      text: m.admin_limit_full({
        active: String(o.activeServers),
        limit: String(account.activeLimit),
      }),
    });
  if (proposed > 0)
    out.push({ tone: 'warning', text: m.admin_reviews({ count: String(proposed) }) });
  return out;
}

/** The operator's view (phase 7, D-022): counts and states across organizations, never code, data or keys. */
function Admin() {
  const overview = useApi<Overview>('/v1/admin/overview');
  const orgs = useApi<{ organizations: Org[] }>('/v1/admin/organizations');
  const servers = useApi<{ servers: Server[] }>('/v1/admin/servers');
  const catalog = useApi<{ entries: Entry[] }>('/v1/admin/catalog');
  if (!overview.result) return <p className="mute">{m.loading()}</p>;
  if (!overview.result.ok)
    return <p className="notice">{label('error', overview.result.error.code)}</p>;
  const o = overview.result.data;
  const account = o.serverAccount;
  const proposed = catalog.result?.ok
    ? catalog.result.data.entries.filter((e) => e.sharing === 'proposed').length
    : 0;
  const found = findings(o, proposed);
  const months =
    account && o.monthlyServerCostMicros > 0
      ? (account.balanceMicros / o.monthlyServerCostMicros).toFixed(1)
      : '—';

  const topUp = async (amountUsd: number) => {
    const r = await api<{ url: string }>('/v1/admin/wallet/top-up', {
      method: 'POST',
      body: { amountUsd },
    });
    if (r.ok) window.open(r.data.url, '_blank', 'noopener');
  };

  const sleep = async (id: string) => {
    await api(`/v1/admin/servers/${id}/sleep`, { method: 'POST' });
    servers.reload();
    overview.reload();
  };

  return (
    <>
      <PageHead title={m.admin_title()} intro={m.admin_intro()} />

      {found.length === 0 ? (
        <div className="verdict healthy">
          <div>
            <span className="mono-label">{m.admin_ok_label()}</span>
            <h3>{m.admin_ok()}</h3>
          </div>
        </div>
      ) : (
        <div className={`verdict${found.some((f) => f.tone === 'failing') ? '' : ' warning'}`}>
          <div>
            <span className="mono-label">{m.admin_attention({ count: String(found.length) })}</span>
            {found.map((f) => (
              <h3 key={f.text}>{f.text}</h3>
            ))}
          </div>
        </div>
      )}

      <div className="grid-cards">
        <Card title={m.admin_revenue_card()} icon="chart" foot={m.admin_revenue_foot()}>
          <Stats
            items={[
              { value: money(o.monthlyRevenueMicros), label: m.admin_revenue() },
              { value: o.paying, label: m.admin_paying() },
              { value: o.organizations, label: m.admin_organizations() },
            ]}
          />
        </Card>
        <Card title={m.rail_servers()} icon="server" foot={m.admin_servers_foot()}>
          <Stats
            items={[
              {
                value: account ? `${o.activeServers}/${account.activeLimit}` : o.activeServers,
                label: m.admin_awake(),
                ...(account && o.activeServers >= account.activeLimit
                  ? { tone: 'warning' as const }
                  : {}),
              },
              { value: o.sleepingServers, label: label('serverStatus', 'sleeping') },
              { value: money(o.monthlyServerCostMicros), label: m.admin_server_cost() },
            ]}
          />
          {account && (
            <Thin
              percent={(o.activeServers / Math.max(1, account.activeLimit)) * 100}
              tone={o.activeServers >= account.activeLimit ? 'warn' : undefined}
            />
          )}
        </Card>
        <Card
          title={m.admin_wallet()}
          icon="gauge"
          foot={m.admin_wallet_foot()}
          tools={
            account ? (
              <div className="row" style={{ gap: 4 }} title={m.admin_top_up_hint()}>
                {TOP_UPS.map((usd) => (
                  <button
                    key={usd}
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => topUp(usd)}
                  >
                    {m.admin_top_up()} {money(usd * 1_000_000)}
                  </button>
                ))}
              </div>
            ) : undefined
          }
        >
          <Stats
            items={[
              {
                value: account ? money(account.balanceMicros) : '—',
                label: m.admin_wallet_balance(),
                ...(account && account.balanceMicros < LOW_WALLET_MICROS
                  ? { tone: 'warning' as const }
                  : {}),
              },
              { value: months, label: m.admin_wallet_months() },
              { value: o.projects, label: m.admin_projects() },
            ]}
          />
        </Card>
      </div>

      <Card title={m.admin_organizations()} icon="shield" foot={m.admin_privacy()}>
        <div className="table-wrap">
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
                    <td>
                      <span className="tag">{label('plan', org.plan)}</span>
                    </td>
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
        </div>
      </Card>

      <Card title={m.col_servers()} icon="server">
        {servers.result?.ok && servers.result.data.servers.length === 0 ? (
          <p className="mute small">{m.admin_servers_none()}</p>
        ) : (
          <div className="table-wrap">
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
                        <StateDot
                          state={serverState(s.status)}
                          text={label('serverStatus', s.status)}
                          live={s.status === 'running'}
                        />{' '}
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
          </div>
        )}
      </Card>

      <AdminCatalog
        entries={catalog.result?.ok ? catalog.result.data.entries : null}
        reload={catalog.reload}
      />
    </>
  );
}
