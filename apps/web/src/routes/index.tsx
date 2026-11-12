import { createFileRoute } from '@tanstack/react-router';
import { Shell } from '@/features/shell/Shell';
import { useApi, type ProjectView } from '@/lib/api';
import { ago, label } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/')({
  component: () => (
    <Shell section="projects">
      <Projects />
    </Shell>
  ),
});

const COUNTS = [
  ['healthy', m.projects_count_healthy],
  ['active', m.projects_count_active],
  ['warning', m.projects_count_warning],
  ['failing', m.projects_count_failing],
  ['idle', m.projects_count_idle],
] as const;

function Projects() {
  const projects = useApi<{ projects: ProjectView[] }>('/v1/projects');
  const list = projects.result?.ok ? projects.result.data.projects : [];
  const failing = list.filter((p) => p.state === 'failing');
  return (
    <>
      <div className="topline">
        <div>
          <h1>{m.projects_title()}</h1>
          {list.length > 0 && (
            <div className="counts mute">
              {COUNTS.map(([state, text]) => (
                <span key={state}>
                  <b>{list.filter((p) => p.state === state).length}</b>
                  {text()}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="topline-actions">
          <a className="btn btn-primary btn-sm" href="/import">
            {m.projects_import()}
          </a>
        </div>
      </div>

      {failing.map((p) => (
        <div className="verdict" key={p.id}>
          <div>
            <span className="mono-label">
              {label('state', p.state)} · {p.name}
            </span>
            <h3>{label('reason', p.stateReason)}</h3>
          </div>
          <a className="btn btn-ghost btn-sm" href={`/projects/${p.id}`}>
            {p.name}
          </a>
        </div>
      ))}

      {!projects.result && <p className="mute mt-lg">{m.loading()}</p>}
      {projects.result && !projects.result.ok && (
        <p className="notice">{label('error', projects.result.error.code)}</p>
      )}
      {projects.result?.ok && list.length === 0 && (
        <div className="notice mt-lg">
          <strong>{m.projects_empty_title()}</strong> {m.projects_empty_body()}{' '}
          <a className="link" href="/connections">
            {m.projects_connect_first()}
          </a>
        </div>
      )}

      {list.length > 0 && (
        <table className="table mt-lg">
          <thead>
            <tr>
              <th>{m.col_project()}</th>
              <th>{m.col_state()}</th>
              <th>{m.col_production()}</th>
              <th>{m.col_last_deploy()}</th>
              <th className="num">{m.col_activity()}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td className="project">
                  <a href={`/projects/${p.id}`} style={{ textDecoration: 'none' }}>
                    {p.name}
                  </a>
                  <small>{p.repository}</small>
                </td>
                <td>
                  <span className={`state state-${p.state}`}>{label('state', p.state)}</span>
                </td>
                <td>
                  {p.productionUrl ? (
                    <span className="env">
                      <a
                        className={
                          p.linkStatus === 'down' ? 'down' : p.linkStatus === 'up' ? 'on' : ''
                        }
                        href={p.productionUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {new URL(p.productionUrl).host}
                      </a>
                    </span>
                  ) : (
                    <span className="mute small">{label('link', 'missing')}</span>
                  )}
                </td>
                <td className="small">
                  {p.latestProduction ? (
                    `${label('deploy', p.latestProduction.status)} · ${ago(p.latestProduction.createdAt)}`
                  ) : (
                    <span className="mute">{m.never()}</span>
                  )}
                </td>
                <td className="num small">{ago(p.lastCommitAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
