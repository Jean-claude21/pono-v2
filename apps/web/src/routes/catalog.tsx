import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { LimitChooser, type LimitDetail } from '@/features/servers/LimitChooser';
import { Shell } from '@/features/shell/Shell';
import { api, useApi } from '@/lib/api';
import { label } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/catalog')({
  component: () => (
    <Shell section="catalog">
      <Catalog />
    </Shell>
  ),
});

interface Template {
  id: string;
  category: string;
  name: { fr: string; en: string };
  description: { fr: string; en: string };
  stack: string[];
  skills: string[];
}

interface Launched {
  projectId: string;
  durationMs: number;
}

const AGENTS = ['claude-code', 'codex', 'opencode', 'none'] as const;

function Catalog() {
  const templates = useApi<{ templates: Template[] }>('/v1/catalog/templates');
  const skills = useApi<{ skills: { name: string; description: string }[] }>('/v1/catalog/skills');
  const [chosen, setChosen] = useState<Template | null>(null);
  const locale = getLocale() === 'en' ? 'en' : 'fr';
  return (
    <>
      <div className="topline">
        <div>
          <h1>{m.catalog_title()}</h1>
          <p className="mute mt-sm">{m.catalog_intro()}</p>
        </div>
      </div>
      {chosen && <Launch template={chosen} locale={locale} onCancel={() => setChosen(null)} />}
      <h3 className="section-title mono-label">{m.catalog_templates()}</h3>
      <div className="tiles">
        {templates.result?.ok &&
          templates.result.data.templates.map((t) => (
            <button
              type="button"
              className="tile"
              key={t.id}
              aria-pressed={chosen?.id === t.id}
              onClick={() => setChosen(t)}
            >
              <span className="mono-label">{t.category}</span>
              <h4>{t.name[locale]}</h4>
              <p>{t.description[locale]}</p>
              <div className="row">
                {t.stack.map((s) => (
                  <span className="tag" key={s}>
                    {s}
                  </span>
                ))}
              </div>
            </button>
          ))}
      </div>
      <h3 className="section-title mono-label">{m.catalog_skills()}</h3>
      <table className="table">
        <tbody>
          {skills.result?.ok &&
            skills.result.data.skills.map((s) => (
              <tr key={s.name}>
                <td className="project figures">{s.name}</td>
                <td className="small soft">{s.description}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </>
  );
}

function Launch({
  template,
  locale,
  onCancel,
}: Readonly<{ template: Template; locale: 'fr' | 'en'; onCancel: () => void }>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<{ detail: LimitDetail; form: Record<string, unknown> } | null>(
    null,
  );
  const [done, setDone] = useState<Launched | null>(null);

  const launch = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const result = await api<Launched>('/v1/launch', { method: 'POST', body });
    setBusy(false);
    if (result.ok) {
      setLimit(null);
      return setDone(result.data);
    }
    if (result.error.code === 'servers.limit_reached' && result.error.detail)
      return setLimit({ detail: result.error.detail as unknown as LimitDetail, form: body });
    setError(label('error', result.error.code));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    void launch({
      template: template.id,
      name: String(f.get('name') ?? ''),
      agent: String(f.get('agent')),
      private: f.get('private') === 'on',
    });
  };

  if (done) {
    return (
      <div className="verdict healthy">
        <div>
          <span className="mono-label">{template.name[locale]}</span>
          <h3>{m.launch_done({ seconds: (done.durationMs / 1000).toFixed(1) })}</h3>
        </div>
        <a className="btn btn-primary btn-sm" href={`/projects/${done.projectId}`}>
          {m.servers_open()}
        </a>
      </div>
    );
  }
  return (
    <div className="panel">
      {limit && (
        <LimitChooser
          detail={limit.detail}
          onCancel={() => setLimit(null)}
          onChoose={(id) => launch({ ...limit.form, sleepServerId: id })}
        />
      )}
      <form className="form" onSubmit={submit}>
        <h3 style={{ fontSize: 20, fontWeight: 600 }}>{template.name[locale]}</h3>
        <p className="small soft">{template.skills.join(' · ')}</p>
        <div className="field">
          <label htmlFor="name">{m.launch_name()}</label>
          <input id="name" name="name" required pattern="[a-z0-9][a-z0-9-]{1,38}" />
          <small>{m.launch_name_help()}</small>
        </div>
        <div className="field">
          <label htmlFor="agent">{m.launch_agent()}</label>
          <select id="agent" name="agent" defaultValue="claude-code">
            {AGENTS.map((a) => (
              <option key={a} value={a}>
                {label('agent', a)}
              </option>
            ))}
          </select>
        </div>
        <label className="row small">
          <input type="checkbox" name="private" defaultChecked /> {m.launch_private()}
        </label>
        {error && <p className="small bad">{error}</p>}
        <div className="row">
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {busy ? m.launch_working() : m.launch_go()}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            {m.form_cancel()}
          </button>
        </div>
      </form>
    </div>
  );
}
