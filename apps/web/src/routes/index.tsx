import { createFileRoute } from '@tanstack/react-router';
import { Shell } from '@/features/shell/Shell';
import { Card, Icon, PageHead, StateDot, Stats, Thin, toneOf } from '@/features/shell/ui';
import { useApi, type Me, type ProjectView } from '@/lib/api';
import { ago, label, money } from '@/lib/labels';
import { alertText, type UsageView } from '@/lib/usage';
import * as m from '@/paraglide/messages.js';
import type { ServerView } from './servers';

export const Route = createFileRoute('/')({
  component: () => (
    <Shell section="overview">
      <Overview />
    </Shell>
  ),
});

interface ServersView {
  plan: string;
  limit: number;
  active: number;
  servers: ServerView[];
}

const ATTENTION = new Set(['failing', 'warning']);

function serverState(status: string): string {
  if (status === 'running') return 'healthy';
  if (status === 'failed') return 'failing';
  if (status === 'waking' || status === 'provisioning') return 'warning';
  return 'idle';
}

/**
 * The overview (D-022): the verdict first, then cards with three figures. A guided person sees
 * the essentials and what to do next; the others see consumption and alerts too.
 */
function Overview() {
  const me = useApi<Me>('/v1/me');
  const projects = useApi<{ projects: ProjectView[] }>('/v1/projects');
  const servers = useApi<ServersView>('/v1/servers');
  const usage = useApi<UsageView>('/v1/usage');
  const guided = me.result?.ok ? me.result.data.person.level === 'guided' : false;

  const list = projects.result?.ok ? projects.result.data.projects : [];
  const failing = list.filter((p) => p.state === 'failing');
  const warning = list.filter((p) => p.state === 'warning');
  const first = failing[0] ?? warning[0];

  return (
    <>
      <PageHead
        title={m.overview_title()}
        intro={m.overview_intro()}
        actions={
          <>
            <a className="btn btn-ghost btn-sm" href="/import">
              {m.projects_import()}
            </a>
            <a className="btn btn-primary btn-sm" href="/catalog">
              <Icon name="plus" />
              {m.rail_new_project()}
            </a>
          </>
        }
      />

      {projects.result?.ok &&
        (first ? (
          <div className={`verdict${failing.length ? '' : ' warning'}`}>
            <div>
              <span className="mono-label">
                {m.overview_attention({ count: String(failing.length + warning.length) })}
              </span>
              <h3>
                {first.name} · {label('reason', first.stateReason)}
              </h3>
            </div>
            <a className="btn btn-ghost btn-sm" href={`/projects/${first.id}`}>
              {m.overview_look()}
            </a>
          </div>
        ) : (
          list.length > 0 && (
            <div className="verdict healthy">
              <div>
                <span className="mono-label">{m.overview_calm_label()}</span>
                <h3>{m.overview_calm({ count: String(list.length) })}</h3>
              </div>
            </div>
          )
        ))}

      <div className="grid-cards">
        <ProjectsCard list={list} loaded={projects.result !== null} />
        <ServersCard data={servers.result?.ok ? servers.result.data : null} />
        {guided ? (
          <NextCard
            list={list}
            serversActive={servers.result?.ok ? servers.result.data.active : 0}
          />
        ) : (
          <UsageCard data={usage.result?.ok ? usage.result.data : null} />
        )}
        {!guided && usage.result?.ok && usage.result.data.alerts.length > 0 && (
          <Card title={m.overview_alerts()} icon="alert" wide foot={m.overview_alerts_foot()}>
            <ul className="lines">
              {usage.result.data.alerts.map((a) => (
                <li key={a.id}>
                  <div className="line-top">
                    <span className="name" style={{ fontWeight: 400 }}>
                      {alertText(a)}
                    </span>
                    <StateDot
                      state={a.level === 'bad' ? 'failing' : 'warning'}
                      text={a.level === 'bad' ? m.overview_alert_bad() : m.overview_alert_warn()}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

function ProjectsCard({ list, loaded }: Readonly<{ list: ProjectView[]; loaded: boolean }>) {
  const recent = [...list]
    .sort((a, b) => (b.lastCommitAt ?? '').localeCompare(a.lastCommitAt ?? ''))
    .slice(0, 5);
  return (
    <Card
      title={m.rail_projects()}
      icon="folder"
      tools={
        <a className="btn btn-ghost btn-xs" href="/projects">
          {m.overview_see_all()}
        </a>
      }
      foot={m.overview_projects_foot()}
    >
      <Stats
        items={[
          { value: list.length, label: m.overview_projects_total() },
          {
            value: list.filter((p) => p.state === 'healthy').length,
            label: m.projects_count_healthy(),
          },
          {
            value: list.filter((p) => ATTENTION.has(p.state)).length,
            label: m.overview_projects_attention(),
            ...(list.some((p) => p.state === 'failing') ? { tone: 'failing' as const } : {}),
          },
        ]}
      />
      {!loaded && <p className="mute small">{m.loading()}</p>}
      {loaded && list.length === 0 && (
        <p className="mute small">
          {m.projects_empty_title()}{' '}
          <a className="link" href="/import">
            {m.projects_import()}
          </a>
        </p>
      )}
      <ul className="lines">
        {recent.map((p) => (
          <li key={p.id}>
            <a href={`/projects/${p.id}`}>
              <div className="line-top">
                <span className="name">{p.name}</span>
                <StateDot state={p.state} text={label('state', p.state)} />
              </div>
              <div className="line-top" style={{ marginTop: 2 }}>
                <span className="mono" style={{ flex: 1 }}>
                  {p.repository}
                </span>
                <span className="sub">{ago(p.lastCommitAt)}</span>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ServersCard({ data }: Readonly<{ data: ServersView | null }>) {
  const servers = data?.servers ?? [];
  const max = Math.max(1, ...servers.map((s) => s.monthlyMicros));
  return (
    <Card
      title={m.rail_servers()}
      icon="server"
      tools={
        <a className="btn btn-ghost btn-xs" href="/servers">
          {m.overview_see_all()}
        </a>
      }
      foot={data ? m.overview_servers_foot({ limit: String(data.limit) }) : undefined}
    >
      <Stats
        items={[
          {
            value: data ? `${data.active}/${data.limit}` : '—',
            label: m.overview_servers_slots(),
            ...(data && data.active >= data.limit ? { tone: 'warning' as const } : {}),
          },
          {
            value: servers.filter((s) => s.status === 'running').length,
            label: m.overview_servers_running(),
          },
          {
            value: money(servers.reduce((a, s) => a + s.monthlyMicros, 0)),
            label: m.overview_servers_month(),
          },
        ]}
      />
      {data && servers.length === 0 && <p className="mute small">{m.overview_servers_none()}</p>}
      <ul className="lines">
        {servers.slice(0, 4).map((s) => (
          <li key={s.id}>
            <a href={`/projects/${s.projectId}`}>
              <div className="line-top">
                <span className="name">{s.projectName}</span>
                <span className="sub figures">{money(s.monthlyMicros)}</span>
                <StateDot
                  state={serverState(s.status)}
                  text={label('serverStatus', s.status)}
                  live={s.status === 'running'}
                />
              </div>
              <Thin percent={(s.monthlyMicros / max) * 100} />
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function UsageCard({ data }: Readonly<{ data: UsageView | null }>) {
  const metered = (data?.readings ?? [])
    .filter((r) => r.used !== null && r.quota)
    .map((r) => ({ r, percent: Math.round(((r.used ?? 0) / (r.quota ?? 1)) * 100) }))
    .sort((a, b) => b.percent - a.percent);
  return (
    <Card
      title={m.rail_usage()}
      icon="gauge"
      tools={
        <a className="btn btn-ghost btn-xs" href="/usage">
          {m.overview_see_all()}
        </a>
      }
      foot={m.overview_usage_foot()}
    >
      <Stats
        items={[
          { value: data ? money(data.total.totalMicros) : '—', label: m.overview_usage_month() },
          {
            value: metered.filter((x) => x.percent >= 80).length,
            label: m.overview_usage_near(),
            ...(metered.some((x) => x.percent >= 95) ? { tone: 'failing' as const } : {}),
          },
          { value: data?.alerts.length ?? 0, label: m.overview_alerts() },
        ]}
      />
      {data && metered.length === 0 && <p className="mute small">{m.overview_usage_none()}</p>}
      <ul className="lines">
        {metered.slice(0, 4).map(({ r, percent }) => (
          <li key={`${r.provider}-${r.meter}-${r.subject}`}>
            <div className="line-top">
              <span className="name">{r.provider}</span>
              <span className="sub">{label('meter', r.meter)}</span>
              <span className="figures">{percent} %</span>
            </div>
            <Thin percent={percent} tone={toneOf(percent)} mark />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** For a guided person: the next gesture, in plain words. */
function NextCard({
  list,
  serversActive,
}: Readonly<{ list: ProjectView[]; serversActive: number }>) {
  const steps: { text: string; href: string }[] = [];
  if (list.length === 0) steps.push({ text: m.next_import(), href: '/import' });
  for (const p of list.filter((x) => x.state === 'failing').slice(0, 2))
    steps.push({ text: m.next_fix({ name: p.name }), href: `/projects/${p.id}` });
  if (list.length > 0 && serversActive === 0)
    steps.push({ text: m.next_server(), href: '/projects' });
  steps.push({ text: m.next_template(), href: '/catalog' });
  return (
    <Card title={m.next_title()} icon="list" foot={m.next_foot()}>
      <ul className="lines">
        {steps.map((s) => (
          <li key={s.text}>
            <a href={s.href} className="line-top" style={{ display: 'flex' }}>
              <span className="name" style={{ fontWeight: 500 }}>
                {s.text}
              </span>
              <Icon name="chevron" />
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
