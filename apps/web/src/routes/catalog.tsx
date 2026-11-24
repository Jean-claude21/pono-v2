import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { OwnSkills, type SkillCard } from '@/features/catalog/OwnSkills';
import { SkillReader } from '@/features/catalog/SkillReader';
import { LimitChooser, type LimitDetail } from '@/features/servers/LimitChooser';
import { Shell } from '@/features/shell/Shell';
import { api, useApi } from '@/lib/api';
import { label } from '@/lib/labels';
import { Card, PageHead, Segmented } from '@/features/shell/ui';
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
  scope?: string;
  parent?: string;
  needs?: string[];
  value?: { launched: number; live: number; minutesToPreview: number | null };
}

interface Launched {
  projectId: string;
  durationMs: number;
}

const AGENTS = ['claude-code', 'codex', 'opencode', 'none'] as const;

type Tab = 'templates' | 'skills' | 'mine';

/**
 * Templates to start a project and skills the agents follow (D-022): one tab each, the person's
 * own in a third. Choosing a template opens its launch form at the top.
 */
function Catalog() {
  const templates = useApi<{ categories?: string[]; templates: Template[] }>(
    '/v1/catalog/templates',
  );
  const skills = useApi<{ skills: SkillCard[] }>('/v1/catalog/skills');
  const [reading, setReading] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Template | null>(null);
  const [tab, setTab] = useState<Tab>('templates');
  const [category, setCategory] = useState('all');
  const locale = getLocale() === 'en' ? 'en' : 'fr';
  const allTemplates = templates.result?.ok ? templates.result.data.templates : [];
  const allSkills = skills.result?.ok ? skills.result.data.skills : [];
  const order = templates.result?.ok ? (templates.result.data.categories ?? []) : [];
  const present = new Set(allTemplates.map((t) => t.category));
  const categories = [
    ...order.filter((c) => present.has(c)),
    ...[...present].filter((c) => !order.includes(c)),
  ];
  // A variant shows inside its template's card; one whose template is gone stands alone (D-033).
  const ids = new Set(allTemplates.map((t) => t.id));
  const variantsOf = (id: string) => allTemplates.filter((t) => t.parent === id);
  const cards = allTemplates.filter((t) => !t.parent || !ids.has(t.parent));
  const families = [...new Set(allSkills.map((s) => s.family))];
  const own = allSkills.filter((s) => ['private', 'proposed', 'refused'].includes(s.scope));
  const tabs: readonly (readonly [Tab, string, number])[] = [
    ['templates', m.catalog_templates(), allTemplates.length],
    ['skills', m.catalog_skills(), allSkills.length - own.length],
    ['mine', m.catalog_own_skills(), own.length],
  ];
  const pick = (t: Template) => {
    setChosen(t);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <PageHead title={m.catalog_title()} intro={m.catalog_intro()} />
      {chosen && <Launch template={chosen} locale={locale} onCancel={() => setChosen(null)} />}

      <div className="filters" role="tablist">
        {tabs.map(([key, text, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {text}
            <span className="figures">{count}</span>
          </button>
        ))}
      </div>

      {tab === 'templates' && (
        <>
          <div className="toolbar">
            <Segmented
              label={m.catalog_category()}
              value={category}
              onChange={setCategory}
              options={[
                ['all', m.projects_filter_all()],
                ...categories.map((c) => [c, label('category', c)] as const),
              ]}
            />
            <span className="tiny mute">{m.catalog_templates_body()}</span>
          </div>
          <div className="grid-cards">
            {cards
              .filter((t) => category === 'all' || t.category === category)
              .map((t) => (
                <section className="card" key={t.id}>
                  <span className="mono-label">
                    {label('category', t.category)}
                    {t.scope && t.scope !== 'pono' ? ` · ${label('scope', t.scope)}` : ''}
                  </span>
                  <h2 className="mt-sm" style={{ fontSize: 16, fontWeight: 600 }}>
                    {t.name[locale]}
                  </h2>
                  <p className="small soft mt-sm">{t.description[locale]}</p>
                  <div className="row mt-md" style={{ gap: 6 }}>
                    {t.stack.map((x) => (
                      <span className="tag" key={x}>
                        {x}
                      </span>
                    ))}
                  </div>
                  {(t.needs?.length ?? 0) > 0 && (
                    <p className="tiny mute mt-sm">
                      {m.catalog_needs({
                        list: t.needs!.map((n) => label('templateNeed', n)).join(', '),
                      })}
                    </p>
                  )}
                  {variantsOf(t.id).length > 0 && (
                    <div className="mt-md">
                      <span className="tiny mute">{m.catalog_variants()}</span>
                      <div className="row mt-sm" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {variantsOf(t.id).map((v) => (
                          <button
                            type="button"
                            key={v.id}
                            className="btn btn-ghost btn-xs"
                            title={v.description[locale]}
                            onClick={() => pick(v)}
                          >
                            {v.name[locale]}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="tile-foot mt-md">
                    <span className="tiny mute">
                      {m.catalog_skills_count({ count: String(t.skills.length) })}
                      {t.value && t.value.launched > 0
                        ? ` · ${m.catalog_value({
                            launched: String(t.value.launched),
                            live: String(t.value.live),
                          })}`
                        : ''}
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary btn-xs"
                      onClick={() => pick(t)}
                    >
                      {m.catalog_use()}
                    </button>
                  </div>
                </section>
              ))}
          </div>
        </>
      )}

      {tab === 'skills' && (
        <>
          <p className="small mute" style={{ marginBottom: 14 }}>
            {m.catalog_skills_body()}
          </p>
          <div className="grid-cards two">
            {families.map((family) => (
              <Card key={family} title={label('family', family)} icon="book">
                <ul className="lines">
                  {allSkills
                    .filter((x) => x.family === family && !own.includes(x))
                    .map((x) => (
                      <li key={x.name}>
                        <div className="line-top">
                          <span className="name figures" style={{ fontWeight: 500 }}>
                            {x.name}
                          </span>
                          <span className="tag">{label('scope', x.scope)}</span>
                        </div>
                        <p className="tiny soft">{x.description}</p>
                        {reading === x.name ? (
                          <SkillReader name={x.name} onClose={() => setReading(null)} />
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs mt-sm"
                            onClick={() => setReading(x.name)}
                          >
                            {m.catalog_skill_read({ count: String(x.files?.length ?? 0) })}
                          </button>
                        )}
                      </li>
                    ))}
                </ul>
              </Card>
            ))}
          </div>
        </>
      )}

      {tab === 'mine' && (
        <Card title={m.catalog_own_skills()} icon="book" foot={m.catalog_own_foot()}>
          <OwnSkills skills={allSkills} onChange={skills.reload} />
        </Card>
      )}
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
    <Card
      title={m.launch_title({ name: template.name[locale] })}
      icon="plus"
      foot={m.launch_what()}
    >
      {limit && (
        <LimitChooser
          detail={limit.detail}
          onCancel={() => setLimit(null)}
          onChoose={(id) => launch({ ...limit.form, sleepServerId: id })}
        />
      )}
      <form className="form" onSubmit={submit}>
        <p className="small soft">
          {m.launch_skills()} <span className="figures">{template.skills.join(' · ')}</span>
        </p>
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
    </Card>
  );
}
