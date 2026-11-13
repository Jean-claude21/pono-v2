import { useState, type FormEvent } from 'react';
import { api, useApi } from '@/lib/api';
import { ago, label } from '@/lib/labels';
import { Card } from '@/features/shell/ui';
import * as m from '@/paraglide/messages.js';

interface Variable {
  name: string;
  set: boolean;
  requestedReason: string | null;
  setAt: string | null;
}

/**
 * The project's development variables (D-007): a person types each value here, once; it is
 * sealed and goes to the project's server only. Agents see names, and may ask for one.
 */
export function ProjectVariables({ projectId }: Readonly<{ projectId: string }>) {
  const data = useApi<{ variables: Variable[] }>(`/v1/projects/${projectId}/variables`);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!data.result?.ok) return null;
  const { variables } = data.result.data;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const name = String(f.get('name') ?? editing).trim();
    const result = await api(`/v1/projects/${projectId}/variables/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: { value: String(f.get('value')) },
    });
    if (!result.ok) return setError(label('error', result.error.code));
    setEditing(null);
    setError(null);
    event.currentTarget.reset();
    data.reload();
  };
  const remove = async (name: string) => {
    await api(`/v1/projects/${projectId}/variables/${name}`, { method: 'DELETE' });
    data.reload();
  };

  return (
    <Card title={m.variables_title()} icon="key">
      <p className="mute small mt-sm">{m.variables_rule()}</p>
      {variables.length > 0 && (
        <table className="table">
          <tbody>
            {variables.map((v) => (
              <tr key={v.name}>
                <td className="project figures">
                  {v.name}
                  {v.requestedReason && !v.set && (
                    <small>{m.variables_asked({ reason: v.requestedReason })}</small>
                  )}
                </td>
                <td className="small">
                  {v.set ? (
                    <span className="ok">
                      {m.variables_set()} · {ago(v.setAt)}
                    </span>
                  ) : (
                    <span className="warn">{m.variables_missing()}</span>
                  )}
                </td>
                <td className="num">
                  {editing === v.name ? (
                    <form className="row" onSubmit={save}>
                      <input
                        name="value"
                        type="password"
                        autoComplete="off"
                        required
                        aria-label={v.name}
                      />
                      <button type="submit" className="btn btn-primary btn-xs">
                        {m.catalog_save()}
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => setEditing(v.name)}
                      >
                        {v.set ? m.variables_replace() : m.variables_fill()}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => remove(v.name)}
                      >
                        {m.admin_catalog_remove()}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="row mt-md" onSubmit={save}>
        <input
          name="name"
          required
          pattern="[A-Z][A-Z0-9_]{0,63}"
          placeholder={m.variables_name_placeholder()}
          aria-label={m.variables_name_placeholder()}
        />
        <input
          name="value"
          type="password"
          autoComplete="off"
          required
          aria-label={m.variables_value()}
          placeholder={m.variables_value()}
        />
        <button type="submit" className="btn btn-ghost btn-sm">
          {m.variables_add()}
        </button>
      </form>
      {error && <p className="notice mt-md">{error}</p>}
    </Card>
  );
}
