import { useState, type FormEvent } from 'react';
import { api, useApi } from '@/lib/api';
import { ago, label } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';

interface Entry {
  id: string;
  organization: string | null;
  kind: 'template' | 'skill';
  name: string;
  body: { body?: string };
  sharing: string;
  updatedAt: string;
}

/** The operator's catalog (D-016): import official templates, review what organizations propose. */
export function AdminCatalog() {
  const entries = useApi<{ entries: Entry[] }>('/v1/admin/catalog');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const run = async (path: string, method: string, body?: unknown) => {
    setError(null);
    const result = await api(path, { method, ...(body === undefined ? {} : { body }) });
    if (!result.ok) setError(label('error', result.error.code));
    entries.reload();
  };
  const importIt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const repository = String(new FormData(event.currentTarget).get('repository'));
    void run('/v1/admin/catalog/import', 'POST', { repository });
  };
  const review = (id: string, decision: string) =>
    run(`/v1/admin/catalog/${id}/review`, 'POST', { decision });

  return (
    <>
      <h3 className="section-title mono-label">{m.admin_catalog()}</h3>
      <form className="row mt-md" onSubmit={importIt}>
        <input
          name="repository"
          placeholder={m.admin_catalog_placeholder()}
          required
          pattern="[\w.-]+/[\w.-]+"
        />
        <button type="submit" className="btn btn-primary btn-sm">
          {m.admin_catalog_import()}
        </button>
      </form>
      <p className="mute small mt-sm">{m.admin_catalog_import_body()}</p>
      {error && <p className="notice mt-md">{error}</p>}
      <table className="table">
        <tbody>
          {entries.result?.ok &&
            entries.result.data.entries.map((e) => (
              <tr key={e.id}>
                <td className="project">
                  <span className="figures">{e.name}</span>
                  <small>
                    {label('kind_entry', e.kind)} · {e.organization ?? m.admin_catalog_official()}
                  </small>
                  {open === e.id && e.body.body && (
                    <pre className="small mt-sm" style={{ whiteSpace: 'pre-wrap' }}>
                      {e.body.body}
                    </pre>
                  )}
                </td>
                <td className="small">
                  {label('scope', e.sharing)} <span className="tiny mute">{ago(e.updatedAt)}</span>
                </td>
                <td className="num">
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
                      className="btn btn-ghost btn-xs"
                      onClick={() => run(`/v1/admin/catalog/${e.id}`, 'DELETE')}
                    >
                      {m.admin_catalog_remove()}
                    </button>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </>
  );
}
