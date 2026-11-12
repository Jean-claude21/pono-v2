import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Shell } from '@/features/shell/Shell';
import { api, useApi } from '@/lib/api';
import { ago, label } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/import')({
  component: () => (
    <Shell section="projects">
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

  return (
    <>
      <a className="back" href="/">
        {m.project_back()}
      </a>
      <div className="topline mt-sm">
        <div>
          <h1>{m.import_title()}</h1>
          <p className="mute mt-sm">{m.import_intro()}</p>
        </div>
      </div>
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
        <div className="list mt-lg">
          {repos.result.data.repositories.map((r) => {
            const s = state[r.fullName];
            return (
              <div className="item" key={r.fullName}>
                <div>
                  <h4>{r.fullName}</h4>
                  <p>
                    {r.private ? `${m.import_private()} · ` : ''}
                    {ago(r.pushedAt)}
                  </p>
                  {s && s !== 'working' && <p className="small bad">{label('error', s)}</p>}
                </div>
                <div className="row">
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    disabled={s === 'working'}
                    onClick={() => importOne(r.fullName)}
                  >
                    {s === 'working' ? m.import_working() : m.import_action()}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
