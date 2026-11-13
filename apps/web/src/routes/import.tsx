import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Shell } from '@/features/shell/Shell';
import { api, useApi } from '@/lib/api';
import { ago, label } from '@/lib/labels';
import { Card, Icon, PageHead } from '@/features/shell/ui';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/import')({
  component: () => (
    <Shell section="projects" crumb={m.import_title()}>
      <Import />
    </Shell>
  ),
});

interface Repository {
  fullName: string;
  private: boolean;
  pushedAt: string | null;
}

function Import() {
  const repos = useApi<{ repositories: Repository[] }>('/v1/repositories');
  const [query, setQuery] = useState('');
  const [state, setState] = useState<Record<string, string>>({});

  const importOne = async (fullName: string) => {
    setState((s) => ({ ...s, [fullName]: 'working' }));
    const result = await api<{ id: string }>('/v1/projects', {
      method: 'POST',
      body: { repository: fullName },
    });
    if (result.ok) window.location.assign(`/projects/${result.data.id}`);
    else setState((s) => ({ ...s, [fullName]: result.error.code }));
  };

  const list = repos.result?.ok ? repos.result.data.repositories : [];
  const q = query.trim().toLowerCase();
  const shown = list.filter((r) => r.fullName.toLowerCase().includes(q));

  return (
    <>
      <PageHead title={m.import_title()} intro={m.import_intro()} />
      <Card title={m.import_how_title()} icon="list">
        <ol className="how">
          <li>
            <strong>{m.import_how_1()}</strong>
            {m.import_how_1_body()}
          </li>
          <li>
            <strong>{m.import_how_2()}</strong>
            {m.import_how_2_body()}
          </li>
          <li>
            <strong>{m.import_how_3()}</strong>
            {m.import_how_3_body()}
          </li>
        </ol>
      </Card>
      {!repos.result && <p className="mute mt-lg">{m.loading()}</p>}
      {repos.result && !repos.result.ok && (
        <p className="notice">
          {label('error', repos.result.error.code)}{' '}
          <a className="link" href="/connections">
            {m.connections_title()}
          </a>
        </p>
      )}
      {repos.result?.ok && (
        <Card
          title={m.import_repositories({ count: String(list.length) })}
          icon="folder"
          tools={
            <label className="search-field" style={{ minWidth: 200 }}>
              <Icon name="search" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={m.projects_search()}
                aria-label={m.projects_search()}
              />
            </label>
          }
        >
          {shown.length === 0 && <p className="empty">{m.palette_empty()}</p>}
          <ul className="lines">
            {shown.map((r) => {
              const s = state[r.fullName];
              return (
                <li key={r.fullName}>
                  <div className="line-top" style={{ alignItems: 'center' }}>
                    <span className="name figures" style={{ fontWeight: 500 }}>
                      {r.fullName}
                    </span>
                    {r.private && <span className="tag">{m.import_private()}</span>}
                    <span className="sub">{ago(r.pushedAt)}</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      disabled={s === 'working'}
                      onClick={() => importOne(r.fullName)}
                    >
                      {s === 'working' ? m.import_working() : m.import_action()}
                    </button>
                  </div>
                  {s && s !== 'working' && <p className="small bad">{label('error', s)}</p>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
