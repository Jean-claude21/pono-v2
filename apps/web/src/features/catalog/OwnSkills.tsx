import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { label } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';

export interface SkillCard {
  name: string;
  family: string;
  description: string;
  scope: string;
}

/**
 * The organization's own skills (D-016): written here or by an agent, private until the operator
 * approves sharing them.
 */
export function OwnSkills({
  skills,
  onChange,
}: Readonly<{ skills: SkillCard[]; onChange: () => void }>) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const own = skills.filter((s) => ['private', 'proposed', 'refused'].includes(s.scope));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const result = await api('/v1/catalog/skills', {
      method: 'POST',
      body: {
        name: String(f.get('name')),
        family: String(f.get('family')),
        description: String(f.get('description')),
        body: String(f.get('body')),
      },
    });
    if (!result.ok) return setError(label('error', result.error.code));
    setOpen(false);
    setError(null);
    onChange();
  };
  const share = async (name: string) => {
    const result = await api(`/v1/catalog/skills/${name}/share`, { method: 'POST' });
    if (!result.ok) setError(label('error', result.error.code));
    onChange();
  };

  return (
    <>
      <div className="spread">
        <p className="mute small" style={{ flex: 1, minWidth: 220 }}>
          {m.catalog_own_skills_body()}
        </p>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(!open)}>
          {m.catalog_new_skill()}
        </button>
      </div>
      {open && (
        <form className="form mt-md" onSubmit={submit}>
          <div className="field">
            <label htmlFor="skill-name">{m.launch_name()}</label>
            <input id="skill-name" name="name" required pattern="[a-z0-9][a-z0-9-]{1,48}" />
          </div>
          <div className="field">
            <label htmlFor="skill-family">{m.catalog_family()}</label>
            <select id="skill-family" name="family" defaultValue="opinion">
              <option value="opinion">{label('family', 'opinion')}</option>
              <option value="design">{label('family', 'design')}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="skill-description">{m.catalog_skill_description()}</label>
            <input id="skill-description" name="description" required minLength={10} />
          </div>
          <div className="field">
            <label htmlFor="skill-body">{m.catalog_skill_body()}</label>
            <textarea id="skill-body" name="body" required minLength={20} rows={8} />
          </div>
          <div className="row">
            <button type="submit" className="btn btn-primary btn-sm">
              {m.catalog_save()}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
              {m.form_cancel()}
            </button>
          </div>
        </form>
      )}
      {error && <p className="notice mt-md">{error}</p>}
      {own.length === 0 && !open && <p className="empty">{m.catalog_own_none()}</p>}
      {own.length > 0 && (
        <table className="table mt-md">
          <tbody>
            {own.map((s) => (
              <tr key={s.name}>
                <td className="project figures">{s.name}</td>
                <td className="small">
                  <span className="tag">{label('scope', s.scope)}</span>
                </td>
                <td className="num">
                  {s.scope !== 'proposed' && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => share(s.name)}
                    >
                      {m.catalog_share()}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
