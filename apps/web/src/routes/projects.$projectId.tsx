import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Shell } from '@/features/shell/Shell';
import { api, useApi, type DeploymentView, type JournalLine, type ProjectView } from '@/lib/api';
import { ago, label, when } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/projects/$projectId')({
  component: function ProjectPage() {
    const { projectId } = Route.useParams();
    return (
      <Shell section="projects">
        <Project id={projectId} />
      </Shell>
    );
  },
});

interface Detail {
  project: ProjectView;
  deployments: DeploymentView[];
  journal: JournalLine[];
}

function Project({ id }: Readonly<{ id: string }>) {
  const detail = useApi<Detail>(`/v1/projects/${id}`);
  const [busy, setBusy] = useState(false);
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

  return (
    <>
      <a className="back" href="/">
        {m.project_back()}
      </a>
      <div className="topline mt-sm">
        <div>
          <div className="row">
            <h1>{project.name}</h1>
            <span className={`state state-${project.state}`}>{label('state', project.state)}</span>
          </div>
          <p className="mute small mt-sm">{label('reason', project.stateReason)}</p>
        </div>
        <div className="topline-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={refresh} disabled={busy}>
            {m.project_refresh()}
          </button>
          {project.productionUrl && (
            <a
              className="btn btn-primary btn-sm"
              href={project.productionUrl}
              target="_blank"
              rel="noreferrer"
            >
              {m.project_open_production()}
            </a>
          )}
        </div>
      </div>

      <dl className="facts">
        <div className="fact">
          <dt>{m.project_repository()}</dt>
          <dd>{project.repository}</dd>
        </div>
        <div className="fact">
          <dt>{m.col_hosting()}</dt>
          <dd>
            {project.hosting.provider ?? '—'} · {label('found', project.hosting.status)}
          </dd>
        </div>
        <div className="fact">
          <dt>{m.project_database()}</dt>
          <dd>
            {project.database.provider ?? '—'} · {label('found', project.database.status)}
          </dd>
        </div>
        <div className="fact">
          <dt>{m.col_production()}</dt>
          <dd>
            {project.productionUrl ?? '—'}{' '}
            <span className={`link-status ${project.linkStatus}`}>
              {label('link', project.linkStatus)}
            </span>
          </dd>
        </div>
        <div className="fact">
          <dt>{m.project_branch()}</dt>
          <dd className="figures">{project.defaultBranch}</dd>
        </div>
        <div className="fact">
          <dt>{m.project_refreshed()}</dt>
          <dd>{ago(project.refreshedAt)}</dd>
        </div>
      </dl>

      <h3 className="section-title mono-label">{m.project_deployments()}</h3>
      {deployments.length === 0 ? (
        <p className="mute small mt-md">{m.project_no_deployment()}</p>
      ) : (
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
                <td
                  className={d.status === 'failed' ? 'bad' : d.status === 'succeeded' ? 'ok' : ''}
                >
                  {label('deploy', d.status)}
                </td>
                <td className="figures tiny">{d.commit?.slice(0, 7) ?? '—'}</td>
                <td className="num small">{when(d.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="section-title mono-label">{m.project_journal()}</h3>
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
    </>
  );
}
