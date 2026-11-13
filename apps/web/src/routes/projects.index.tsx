import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Shell } from '@/features/shell/Shell';
import { Card, Icon, PageHead, Segmented, StateDot } from '@/features/shell/ui';
import { useApi, type ProjectView } from '@/lib/api';
import { ago, label } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/projects/')({
  component: () => (
    <Shell section="projects">
      <Projects />
    </Shell>
  ),
});

type Filter = 'all' | 'healthy' | 'active' | 'attention' | 'idle';

function keep(p: ProjectView, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'attention') return p.state === 'failing' || p.state === 'warning';
  return p.state === filter;
}

/** Every project built by the person's agents, whatever its host or stack (D-022). */
function Projects() {
  const projects = useApi<{ projects: ProjectView[] }>('/v1/projects');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const list = projects.result?.ok ? projects.result.data.projects : [];
  const q = query.trim().toLowerCase();
  const shown = list.filter(
    (p) =>
      keep(p, filter) &&
      (p.name.toLowerCase().includes(q) || p.repository.toLowerCase().includes(q)),
  );
  const failing = list.filter((p) => p.state === 'failing');

  return (
    <>
      <PageHead
        title={m.projects_title()}
        intro={m.projects_intro()}
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

      {failing.map((p) => (
        <div className="verdict" key={p.id}>
          <div>
            <span className="mono-label">
              {label('state', p.state)} · {p.name}
            </span>
            <h3>{label('reason', p.stateReason)}</h3>
          </div>
          <a className="btn btn-ghost btn-sm" href={`/projects/${p.id}`}>
            {m.overview_look()}
          </a>
        </div>
      ))}

      {!projects.result && <p className="mute">{m.loading()}</p>}
      {projects.result && !projects.result.ok && (
        <p className="notice">{label('error', projects.result.error.code)}</p>
      )}
      {projects.result?.ok && list.length === 0 && (
        <div className="notice">
          <strong>{m.projects_empty_title()}</strong> {m.projects_empty_body()}{' '}
          <a className="link" href="/connections">
            {m.projects_connect_first()}
          </a>
        </div>
      )}

      {list.length > 0 && (
        <>
          <div className="toolbar">
            <label className="search-field">
              <Icon name="search" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={m.projects_search()}
                aria-label={m.projects_search()}
              />
            </label>
            <Segmented<Filter>
              label={m.projects_filter()}
              value={filter}
              onChange={setFilter}
              options={[
                ['all', m.projects_filter_all()],
                ['healthy', m.projects_count_healthy()],
                ['active', m.projects_count_active()],
                ['attention', m.overview_projects_attention()],
                ['idle', m.projects_count_idle()],
              ]}
            />
          </div>
          <Card
            title={m.projects_list({ count: String(shown.length) })}
            icon="folder"
            foot={m.overview_projects_foot()}
          >
            <div className="table-wrap">
              <table className="table">
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
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={5} className="empty">
                        {m.palette_empty()}
                      </td>
                    </tr>
                  )}
                  {shown.map((p) => (
                    <tr key={p.id}>
                      <td className="project">
                        <a href={`/projects/${p.id}`}>{p.name}</a>
                        <small>{p.repository}</small>
                      </td>
                      <td>
                        <StateDot state={p.state} text={label('state', p.state)} />
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
            </div>
          </Card>
        </>
      )}
    </>
  );
}
