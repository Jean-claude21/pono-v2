import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ProjectDev } from '@/features/projects/ProjectDev';
import { ProjectManifest } from '@/features/projects/ProjectManifest';
import { ProjectServer } from '@/features/projects/ProjectServer';
import { ProjectBackups, ProjectNetwork } from '@/features/projects/ProjectSafety';
import { ProjectVariables } from '@/features/projects/ProjectVariables';
import { ProjectVisits } from '@/features/projects/ProjectVisits';
import { Releases } from '@/features/releases/Releases';
import { Shell } from '@/features/shell/Shell';
import { Card, Icon, PageHead, StateDot } from '@/features/shell/ui';
import { api, useApi, type DeploymentView, type JournalLine, type ProjectView } from '@/lib/api';
import { ago, label, when } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/projects/$projectId')({
  component: function ProjectPage() {
    const { projectId } = Route.useParams();
    const [name, setName] = useState<string | undefined>(undefined);
    return (
      <Shell section="projects" crumb={name}>
        <Project id={projectId} onName={setName} />
      </Shell>
    );
  },
});

interface Detail {
  project: ProjectView;
  deployments: DeploymentView[];
  journal: JournalLine[];
}

type Tab = 'overview' | 'dev' | 'manifest' | 'variables' | 'releases' | 'journal';
const TABS = new Set<string>(['overview', 'dev', 'manifest', 'variables', 'releases', 'journal']);

function deployState(status: string): string {
  if (status === 'failed') return 'failing';
  if (status === 'succeeded') return 'healthy';
  return 'warning';
}

/** A project's page (D-022): its head and verdict, then one tab per side of the project. */
function Project({ id, onName }: Readonly<{ id: string; onName: (name: string) => void }>) {
  const detail = useApi<Detail>(`/v1/projects/${id}`);
  const [busy, setBusy] = useState(false);
  const [onlineNote, setOnlineNote] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (TABS.has(hash)) setTab(hash as Tab);
  }, []);
  const name = detail.result?.ok ? detail.result.data.project.name : null;
  useEffect(() => {
    if (name) onName(name);
  }, [name, onName]);

  if (!detail.result) return <p className="mute">{m.loading()}</p>;
  if (!detail.result.ok)
    return <p className="notice">{label('error', detail.result.error.code)}</p>;
  const { project, deployments, journal } = detail.result.data;

  const refresh = async () => {
    setBusy(true);
    await api(`/v1/projects/${id}/refresh`, { method: 'POST' });
    setBusy(false);
    detail.reload();
  };
  // The site at the connected hosting, linked to the repository (D-037).
  const putOnline = async () => {
    setBusy(true);
    setOnlineNote(null);
    const result = await api<{ productionUrl: string | null }>(`/v1/projects/${id}/online`, {
      method: 'POST',
    });
    setBusy(false);
    if (!result.ok) {
      setOnlineNote(
        result.error.code === 'release.no_hosting'
          ? m.project_online_no_hosting()
          : label('error', result.error.code),
      );
      return;
    }
    setOnlineNote(m.project_online_done({ url: result.data.productionUrl ?? '—' }));
    detail.reload();
  };
  const show = (next: Tab) => {
    setTab(next);
    window.history.replaceState(null, '', `#${next}`);
  };
  const tabs: readonly (readonly [Tab, string])[] = [
    ['overview', m.project_tab_overview()],
    ['dev', m.dev_title()],
    ['manifest', m.manifest_title()],
    ['variables', m.variables_title()],
    ['releases', m.releases_title()],
    ['journal', m.project_journal()],
  ];

  return (
    <>
      <PageHead
        title={
          <span className="row" style={{ gap: 12 }}>
            {project.name}
            <StateDot state={project.state} text={label('state', project.state)} />
          </span>
        }
        intro={
          <>
            <span className="figures">{project.repository}</span> · {project.defaultBranch}
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={refresh}
              disabled={busy}
            >
              {m.project_refresh()}
            </button>
            {!project.productionUrl && project.hosting.status !== 'found' && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={putOnline}
                disabled={busy}
              >
                <Icon name="rocket" />
                {m.project_put_online()}
              </button>
            )}
            {project.productionUrl && (
              <a
                className="btn btn-primary btn-sm"
                href={project.productionUrl}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="external" />
                {m.project_open_production()}
              </a>
            )}
          </>
        }
      />

      {onlineNote && <p className="notice">{onlineNote}</p>}

      {(project.state === 'failing' || project.state === 'warning') && (
        <div className={`verdict${project.state === 'warning' ? ' warning' : ''}`}>
          <div>
            <span className="mono-label">{label('state', project.state)}</span>
            <h3>{label('reason', project.stateReason)}</h3>
          </div>
        </div>
      )}

      <div className="filters" role="tablist">
        {tabs.map(([key, text]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-pressed={tab === key}
            onClick={() => show(key)}
          >
            {text}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="grid-cards two">
            <Card
              title={m.project_facts()}
              icon="folder"
              foot={m.project_refreshed_at({ when: ago(project.refreshedAt) })}
            >
              <dl className="kv">
                <dt>{m.project_repository()}</dt>
                <dd className="figures">{project.repository}</dd>
                <dt>{m.col_hosting()}</dt>
                <dd>
                  {project.hosting.provider ?? '—'} · {label('found', project.hosting.status)}
                </dd>
                <dt>{m.project_database()}</dt>
                <dd>
                  {project.database.provider ?? '—'} · {label('found', project.database.status)}
                </dd>
                <dt>{m.col_production()}</dt>
                <dd>
                  {project.productionUrl ?? '—'}{' '}
                  <span className={`link-status ${project.linkStatus}`}>
                    {label('link', project.linkStatus)}
                  </span>
                </dd>
                <dt>{m.project_branch()}</dt>
                <dd className="figures">{project.defaultBranch}</dd>
              </dl>
            </Card>
            <ProjectServer projectId={id} />
          </div>
          <ProjectVisits projectId={id} />
        </>
      )}
      {tab === 'dev' && (
        <>
          <ProjectDev projectId={id} />
          <div className="grid-cards two">
            <ProjectBackups projectId={id} />
            <ProjectNetwork projectId={id} />
          </div>
        </>
      )}
      {tab === 'manifest' && <ProjectManifest projectId={id} />}
      {tab === 'variables' && <ProjectVariables projectId={id} />}
      {tab === 'releases' && (
        <>
          <Releases projectId={id} />
          <Card title={m.project_deployments()} icon="rocket">
            {deployments.length === 0 ? (
              <p className="mute small">{m.project_no_deployment()}</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{m.col_environment()}</th>
                      <th>{m.col_status()}</th>
                      <th>{m.col_commit()}</th>
                      <th className="num">{m.col_when()}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deployments.map((d) => (
                      <tr key={`${d.environment}-${d.createdAt}`}>
                        <td>{label('env', d.environment)}</td>
                        <td>
                          <StateDot
                            state={deployState(d.status)}
                            text={label('deploy', d.status)}
                          />
                        </td>
                        <td className="figures tiny">{d.commit?.slice(0, 7) ?? '—'}</td>
                        <td className="num small">{when(d.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      {tab === 'journal' && (
        <Card title={m.project_journal()} icon="list">
          {journal.length === 0 && <p className="mute small">{m.palette_empty()}</p>}
          <ul className="activity">
            {journal.map((j) => (
              <li key={j.id}>
                <span className="figures">{ago(j.createdAt)}</span>
                <span>
                  {label('action', j.action)}{' '}
                  <span className="mute">· {label('channel', j.channel)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
