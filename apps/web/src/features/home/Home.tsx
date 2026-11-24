import { LocaleSwitch } from '@/features/shell/LocaleSwitch';
import { Icon, type IconName } from '@/features/shell/ui';
import { useApi } from '@/lib/api';
import { label } from '@/lib/labels';
import { nameOf } from '@/lib/providers';
import { getLocale } from '@/paraglide/runtime.js';
import * as m from '@/paraglide/messages.js';

const SIGN_IN = '/auth/sign-in/github';

/** What the workshop works with, as the brands write themselves. */
const WORKS_WITH = [
  'github',
  'claude-code',
  'codex',
  'cursor',
  'netlify',
  'vercel',
  'cloudflare',
  'coolify',
  'neon',
  'umami-self',
  'openai',
] as const;

const FEATURES: readonly { icon: IconName; title: () => string; body: () => string }[] = [
  { icon: 'grid', title: m.home_f1_title, body: m.home_f1_body },
  { icon: 'gauge', title: m.home_f2_title, body: m.home_f2_body },
  { icon: 'server', title: m.home_f3_title, body: m.home_f3_body },
  { icon: 'shield', title: m.home_f4_title, body: m.home_f4_body },
  { icon: 'bot', title: m.home_f5_title, body: m.home_f5_body },
  { icon: 'book', title: m.home_f6_title, body: m.home_f6_body },
];

const STEPS = [
  { title: m.home_step_1_title, body: m.home_step_1_body },
  { title: m.home_step_2_title, body: m.home_step_2_body },
  { title: m.home_step_3_title, body: m.home_step_3_body },
];

/** The plans' names and audiences; their price, servers and sale come from the operator (D-041). */
const PLANS = [
  { id: 'free', name: m.home_plan_free, for: m.home_plan_free_for },
  { id: 'solo', name: m.home_plan_solo, for: m.home_plan_solo_for },
  { id: 'pro', name: m.home_plan_pro, for: m.home_plan_pro_for },
] as const;

interface PublicOffer {
  plan: string;
  availability: 'available' | 'coming_soon' | 'on_request';
  priceMicros: number | null;
  activeServers: number;
  contactUrl: string | null;
}

const FAQ = [
  { q: m.home_q1, a: m.home_a1 },
  { q: m.home_q2, a: m.home_a2 },
  { q: m.home_q3, a: m.home_a3 },
  { q: m.home_q4, a: m.home_a4 },
];

function price(amount: number, cents = false): string {
  return new Intl.NumberFormat(getLocale(), {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(amount);
}

/** The workshop as it looks, drawn with the console's own pieces: the proof in the first screen. */
function Preview() {
  const rows = [
    { name: m.home_demo_1, state: 'healthy', text: m.home_demo_live, cost: 4.2 },
    { name: m.home_demo_2, state: 'failing', text: m.home_demo_down, cost: 11.8 },
    { name: m.home_demo_3, state: 'active', text: m.home_demo_dev, cost: 2.1 },
    { name: m.home_demo_4, state: 'idle', text: m.home_demo_asleep, cost: 0 },
  ];
  return (
    <div className="proof home-preview" aria-hidden="true">
      <div className="proof-head">
        <span className="mono-label">{m.home_preview_title()}</span>
        <span className="tiny mute">{m.home_preview_updated()}</span>
      </div>
      <div className="home-preview-stats">
        <div>
          <b className="figures">{price(18.1, true)}</b>
          <span className="tiny mute">{m.home_preview_month()}</span>
        </div>
        <div>
          <b className="figures">2/3</b>
          <span className="tiny mute">{m.home_preview_servers()}</span>
        </div>
      </div>
      {rows.map((r) => (
        <div className="proof-row" key={r.state}>
          <span className="mono">{r.name()}</span>
          <span className={`state state-${r.state}`}>{r.text()}</span>
          <span className="figures">{price(r.cost, true)}</span>
        </div>
      ))}
      <div className="verdict">
        <span className="mono-label">{m.home_preview_verdict_label()}</span>
        <h3>{m.home_preview_verdict()}</h3>
        <p>{m.home_preview_verdict_body()}</p>
      </div>
    </div>
  );
}

/** Pono's public page: what it is, for whom, how, and what it costs; then sign in with GitHub. */
export function Home() {
  const offers = useApi<{ offers: PublicOffer[] }>('/v1/offers');
  return (
    <div className="home">
      <header className="home-header">
        <div className="wrap">
          <a className="monogram" href="/">
            <b>P</b>Pono
          </a>
          <nav className="home-nav">
            <a href="#how">{m.home_nav_how()}</a>
            <a href="#agents">{m.home_nav_agents()}</a>
            <a href="#pricing">{m.home_nav_pricing()}</a>
            <a href="#faq">{m.home_nav_faq()}</a>
          </nav>
          <div className="home-header-end">
            <LocaleSwitch />
            <a className="btn btn-ghost btn-sm" href={SIGN_IN}>
              {m.home_signin()}
            </a>
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="wrap">
          <div>
            <span className="home-eyebrow">{m.home_eyebrow()}</span>
            <h1>
              {m.home_title_1()} <span>{m.home_title_2()}</span>
            </h1>
            <p className="lede">{m.home_lede()}</p>
            <div className="actions">
              <a className="btn btn-primary" href={SIGN_IN}>
                <Icon name="github" />
                {m.home_cta()}
              </a>
              <a className="btn btn-ghost" href="#how">
                {m.home_cta_how()}
              </a>
            </div>
            <p className="fine">{m.home_fine()}</p>
          </div>
          <Preview />
        </div>
      </section>

      <section className="home-logos">
        <div className="wrap">
          <span className="mono-label">{m.home_works_with()}</span>
          <ul>
            {WORKS_WITH.map((id) => (
              <li key={id}>{nameOf(id)}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <span className="mono-label">{m.home_problem_label()}</span>
          <h2 className="mt-sm">{m.home_problem_title()}</h2>
          <p className="intro">{m.home_problem_body()}</p>
          <div className="home-features">
            {FEATURES.map((f) => (
              <article key={f.icon}>
                <span className="home-feature-icon">
                  <Icon name={f.icon} />
                </span>
                <h3>{f.title()}</h3>
                <p>{f.body()}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section alt" id="how">
        <div className="wrap">
          <span className="mono-label">{m.home_how_label()}</span>
          <h2 className="mt-sm">{m.home_how_title()}</h2>
          <ol className="home-steps">
            {STEPS.map((s, i) => (
              <li key={i}>
                <span className="figures">{String(i + 1).padStart(2, '0')}</span>
                <h3>{s.title()}</h3>
                <p>{s.body()}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section" id="agents">
        <div className="wrap split">
          <div>
            <span className="mono-label">{m.home_agents_label()}</span>
            <h2 className="mt-sm">{m.home_agents_title()}</h2>
            <p className="intro">{m.home_agents_body()}</p>
            <div className="verdict warning mt-lg">
              <span className="mono-label">{m.home_agents_never_label()}</span>
              <h3>{m.home_agents_never()}</h3>
            </div>
          </div>
          <div className="home-terminal" aria-label={m.home_agents_comment()}>
            <div className="home-terminal-bar">
              <i />
              <i />
              <i />
            </div>
            <pre>
              <code>
                <span className="mute"># {m.home_agents_comment()}</span>
                {'\n'}
                {'https://pono.kete.digital/mcp'}
                {'\n\n'}
                <span className="mute">{'> '}</span>
                {'resume_project boutique-lome'}
                {'\n'}
                <span className="mute">{'> '}</span>
                {'edit_file src/pages/contact.tsx'}
                {'\n'}
                <span className="ok">{'✓ '}</span>
                {'https://boutique-lome.preview.pono.kete.digital'}
                {'\n'}
                <span className="mute">{'> '}</span>
                {'push_changes · propose_release'}
                {'\n'}
                <span className="ok">{'✓ '}</span>
                {'PR #42 → main'}
              </code>
            </pre>
          </div>
        </div>
      </section>

      <section className="section alt" id="pricing">
        <div className="wrap">
          <span className="mono-label">{m.home_pricing_label()}</span>
          <h2 className="mt-sm">{m.home_pricing_title()}</h2>
          <p className="intro">{m.home_pricing_body()}</p>
          <div className="home-plans">
            {PLANS.map((p) => {
              const offer = offers.result?.ok
                ? offers.result.data.offers.find((o) => o.plan === p.id)
                : undefined;
              const sold = !offer || offer.availability === 'available';
              const featured = p.id === 'solo' && sold;
              return (
                <article key={p.id} className={featured ? 'featured' : undefined}>
                  <header>
                    <h3>{p.name()}</h3>
                    {featured && <span className="tag">{m.home_plan_popular()}</span>}
                  </header>
                  <p className="home-price">
                    {!offer ? (
                      <b className="figures">—</b>
                    ) : sold ? (
                      <>
                        <b className="figures">{price((offer.priceMicros ?? 0) / 1_000_000)}</b>
                        <span className="mute">{m.home_plan_month()}</span>
                      </>
                    ) : (
                      <b>{label('availability', offer.availability)}</b>
                    )}
                  </p>
                  {offer && (
                    <p className="home-plan-servers">
                      <Icon name="server" />
                      {offer.activeServers === 1
                        ? m.home_plan_server_one()
                        : m.home_plan_servers({ count: String(offer.activeServers) })}
                    </p>
                  )}
                  <p className="soft small">{p.for()}</p>
                  {offer?.availability === 'coming_soon' ? (
                    <span className="btn btn-ghost btn-sm" aria-disabled="true">
                      {label('availability', 'coming_soon')}
                    </span>
                  ) : offer?.availability === 'on_request' ? (
                    <a className="btn btn-ghost btn-sm" href={offer.contactUrl ?? SIGN_IN}>
                      {m.settings_contact()}
                    </a>
                  ) : (
                    <a
                      className={`btn ${featured ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                      href={SIGN_IN}
                    >
                      {p.id === 'free' ? m.home_cta() : m.home_plan_choose()}
                    </a>
                  )}
                </article>
              );
            })}
          </div>
          <p className="mute small mt-lg">{m.home_plan_pay()}</p>
        </div>
      </section>

      <section className="section" id="faq">
        <div className="wrap split">
          <h2>{m.home_faq_title()}</h2>
          <dl className="faq">
            {FAQ.map((f, i) => (
              <div key={i}>
                <dt>{f.q()}</dt>
                <dd>{f.a()}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="cta-band">
        <div className="wrap">
          <div>
            <h2>{m.home_final_title()}</h2>
            <p>{m.home_final_body()}</p>
          </div>
          <a className="btn btn-primary" href={SIGN_IN}>
            <Icon name="github" />
            {m.home_cta()}
          </a>
        </div>
      </section>

      <footer className="site-footer">
        <div className="wrap">
          <a className="monogram" href="/">
            <b>P</b>Pono
          </a>
          <span className="mute small">{m.home_footer()}</span>
          <a className="small" href={SIGN_IN}>
            {m.home_footer_console()}
          </a>
        </div>
      </footer>
    </div>
  );
}
