import { useState, type FormEvent } from 'react';
import { Card, StateDot } from '@/features/shell/ui';
import { api } from '@/lib/api';
import { ago, label } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';

export interface Entry {
  id: string;
  organization: string | null;
  kind: 'template' | 'skill';
  name: string;
  body: { body?: string };
  sharing: string;
  updatedAt: string;
}

const SHARING_STATE: Record<string, string> = {
  proposed: 'warning',
  shared: 'healthy',
  official: 'active',
  refused: 'failing',
};

/** The operator's catalog (D-016): import official templates, review what organizations propose. */
export function AdminCatalog({
  entries,
  reload,
}: Readonly<{ entries: Entry[] | null; reload: () => void }>) {
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const run = async (path: string, method: string, body?: unknown) => {
    setError(null);
    const result = await api(path, { method, ...(body === undefined ? {} : { body }) });
    if (!result.ok) setError(label('error', result.error.code));
    reload();
  };
  const importIt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const repository = String(new FormData(event.currentTarget).get('repository'));
    void run('/v1/admin/catalog/import', 'POST', { repository });
  };
  const review = (id: string, decision: string) =>
    run(`/v1/admin/catalog/${id}/review`, 'POST', { decision });
  // What waits for a decision comes first.
  const sorted = [...(entries ?? [])].sort(
    (a, b) => Number(b.sharing === 'proposed') - Number(a.sharing === 'proposed'),
  );

  return (
    <Card title={m.admin_catalog()} icon="book" foot={m.admin_catalog_import_body()}>
      <form className="toolbar" onSubmit={importIt}>
        <label className="search-field">
          <input
            name="repository"
            placeholder={m.admin_catalog_placeholder()}
            aria-label={m.admin_catalog_placeholder()}
            required
            pattern="[\w.-]+/[\w.-]+"
          />
        </label>
        <button type="submit" className="btn btn-primary btn-sm">
          {m.admin_catalog_import()}
        </button>
      </form>
      {error && <p className="notice warning">{error}</p>}
      {entries && entries.length === 0 && <p className="mute small">{m.admin_catalog_empty()}</p>}
      {sorted.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{m.admin_catalog_entry()}</th>
                <th>{m.col_state()}</th>
                <th className="num" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.id}>
                  <td className="project">
                    <span className="figures">{e.name}</span>
                    <small>
                      {label('kind_entry', e.kind)} · {e.organization ?? m.admin_catalog_official()}
                    </small>
                    {open === e.id && e.body.body && <pre className="code">{e.body.body}</pre>}
                  </td>
                  <td>
                    <StateDot
                      state={SHARING_STATE[e.sharing] ?? 'idle'}
                      text={label('scope', e.sharing)}
                    />{' '}
                    <span className="tiny mute">{ago(e.updatedAt)}</span>
                  </td>
                  <td className="num">
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      {e.kind === 'skill' && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => setOpen(open === e.id ? null : e.id)}
                        >
                          {m.admin_catalog_read()}
                        </button>
                      )}
                      {e.sharing === 'proposed' && (
                        <>
                          <button
                            type="button"
                            className="btn btn-primary btn-xs"
                            onClick={() => review(e.id, 'shared')}
                          >
                            {m.admin_catalog_approve()}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            onClick={() => review(e.id, 'refused')}
                          >
                            {m.admin_catalog_refuse()}
                          </button>
                        </>
                      )}
                      {e.sharing === 'shared' && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => review(e.id, 'private')}
                        >
                          {m.admin_catalog_unshare()}
                        </button>
                      )}
                      {e.sharing === 'official' && (
                        <button
                          type="button"
                          className="btn btn-danger btn-xs"
                          onClick={() => run(`/v1/admin/catalog/${e.id}`, 'DELETE')}
                        >
                          {m.admin_catalog_remove()}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
