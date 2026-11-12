import { useState } from 'react';
import { api, useApi } from '@/lib/api';
import { label } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';

interface SkillChoice {
  name: string;
  family: 'safety' | 'opinion' | 'design';
  active: boolean;
  because: string;
}

interface ManifestView {
  status: 'present' | 'proposed' | 'invalid' | 'missing' | 'unknown';
  problems: { path: string; message: string }[] | null;
  proposalUrl: string | null;
  origin: 'template' | 'adopted';
  template: string | null;
  skills: SkillChoice[];
}

const FAMILIES = ['safety', 'opinion', 'design'] as const;

/**
 * The project's `pono.yaml` and its skills (D-014). Every change is proposed in the repository:
 * the person merges it, and the file stays the truth.
 */
export function ProjectManifest({ projectId }: Readonly<{ projectId: string }>) {
  const data = useApi<ManifestView>(`/v1/projects/${projectId}/manifest`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposed, setProposed] = useState<string | null>(null);
  if (!data.result?.ok) return null;
  const view = data.result.data;

  const act = async (path: string, method: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    const result = await api<{ url?: string }>(path, {
      method,
      ...(body === undefined ? {} : { body }),
    });
    setBusy(false);
    if (!result.ok) setError(label('error', result.error.code));
    else if (result.data?.url) setProposed(result.data.url);
    data.reload();
  };
  const toggle = (skill: SkillChoice) =>
    act(`/v1/projects/${projectId}/skills`, 'PUT', {
      use: skill.active ? [] : [skill.name],
      off: skill.active ? [skill.name] : [],
    });

  return (
    <section>
      <h3 className="section-title mono-label">{m.manifest_title()}</h3>
      <div className="spread mt-md">
        <span className={`manifest-status ${view.status} small`}>
          ● {label('manifest', view.status)} ·{' '}
          {view.origin === 'template'
            ? m.manifest_origin_template({ template: view.template ?? '—' })
            : m.manifest_origin_adopted()}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() => act(`/v1/projects/${projectId}/manifest/sync`, 'POST')}
        >
          {m.manifest_read_again()}
        </button>
      </div>
      {view.status === 'proposed' && view.proposalUrl && (
        <p className="notice mt-md small">
          {m.manifest_proposed_body()}{' '}
          <a href={view.proposalUrl} target="_blank" rel="noreferrer">
            {m.manifest_open_proposal()}
          </a>
        </p>
      )}
      {view.status === 'invalid' && view.problems && (
        <ul className="notice mt-md small">
          {view.problems.map((p) => (
            <li key={`${p.path}-${p.message}`}>
              <span className="figures">{p.path || 'pono.yaml'}</span> — {p.message}
            </li>
          ))}
        </ul>
      )}

      <p className="mute small mt-md">{m.skills_rule()}</p>
      {FAMILIES.map((family) => {
        const skills = view.skills.filter((s) => s.family === family);
        if (!skills.length) return null;
        return (
          <div key={family} className="mt-md">
            <div className="mono-label">{label('family', family)}</div>
            <ul className="skill-list">
              {skills.map((s) => (
                <li key={s.name} className="spread">
                  <span>
                    <span className="figures">{s.name}</span>{' '}
                    <span className="mute tiny">· {label('because', s.because)}</span>
                  </span>
                  <button
                    type="button"
                    className={`btn btn-sm ${s.active ? 'btn-ghost' : 'btn-primary'}`}
                    disabled={busy}
                    onClick={() => toggle(s)}
                  >
                    {s.active ? m.skills_turn_off() : m.skills_turn_on()}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {proposed && (
        <p className="mute small mt-md">
          {m.skills_proposed()}{' '}
          <a href={proposed} target="_blank" rel="noreferrer">
            {m.manifest_open_proposal()}
          </a>
        </p>
      )}
      {error && <p className="notice mt-md">{error}</p>}
    </section>
  );
}
