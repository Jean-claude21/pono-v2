import { useEffect, useRef, useState } from 'react';
import { LocaleSwitch } from '@/features/shell/LocaleSwitch';
import { Icon } from '@/features/shell/ui';
import { useApi } from '@/lib/api';
import { label } from '@/lib/labels';
import { getLocale } from '@/paraglide/runtime.js';
import * as m from '@/paraglide/messages.js';
import serversShot from './captures/console-serveurs.webp';
import overviewShot from './captures/console-vue-ensemble.webp';
import { Logo, type LogoName } from './logos';

const SIGN_IN = '/auth/sign-in/github';
const MCP_ADDRESS = 'https://pono.kete.digital/mcp';

/** A request followed from the chat to production: the tools Pono's MCP really calls (D-039). */
const RELAY = [
  { text: m.home_relay_1, tool: 'launch_project', state: 'active' },
  { text: m.home_relay_2, tool: 'start_dev', state: 'active' },
  { text: m.home_relay_3, tool: 'edit_file', state: 'active' },
  { text: m.home_relay_4, tool: 'propose_release', state: 'warning' },
  { text: m.home_relay_5, tool: 'console', state: 'healthy', you: true },
  { text: m.home_relay_6, tool: 'production', state: 'healthy' },
] as const;

/** Only what is wired today: agents by MCP, GitHub, the hosts and the database Pono reads. */
const WORKS_WITH: readonly { group: () => string; tools: readonly [LogoName, string][] }[] = [
  {
    group: m.home_works_ai,
    tools: [
      ['claude', 'Claude'],
      ['openai', 'ChatGPT'],
      ['claudecode', 'Claude Code'],
      ['codex', 'Codex'],
    ],
  },
  { group: m.home_works_code, tools: [['github', 'GitHub']] },
  {
    group: m.home_works_sites,
    tools: [
      ['netlify', 'Netlify'],
      ['vercel', 'Vercel'],
      ['cloudflare', 'Cloudflare'],
      ['neon', 'Neon'],
    ],
  },
];

const PAINS = [
  { title: m.home_pain_1_title, body: m.home_pain_1_body },
  { title: m.home_pain_2_title, body: m.home_pain_2_body },
  { title: m.home_pain_3_title, body: m.home_pain_3_body },
  { title: m.home_pain_4_title, body: m.home_pain_4_body },
];

const CHANGES = [
  { before: m.home_change_1_before, after: m.home_change_1_after },
  { before: m.home_change_2_before, after: m.home_change_2_after },
  { before: m.home_change_3_before, after: m.home_change_3_after },
  { before: m.home_change_4_before, after: m.home_change_4_after },
];

const STEPS = [
  { title: m.home_step_1_title, body: m.home_step_1_body },
  { title: m.home_step_2_title, body: m.home_step_2_body, address: true },
  { title: m.home_step_3_title, body: m.home_step_3_body },
];

const DIFFERENCES = [
  { title: m.home_diff_1_title, body: m.home_diff_1_body },
  { title: m.home_diff_2_title, body: m.home_diff_2_body },
  { title: m.home_diff_3_title, body: m.home_diff_3_body },
  { title: m.home_diff_4_title, body: m.home_diff_4_body },
];

const TRUST = [m.home_trust_1, m.home_trust_2, m.home_trust_3, m.home_trust_4];

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
  { q: m.home_q5, a: m.home_a5 },
  { q: m.home_q6, a: m.home_a6 },
];

function price(amount: number): string {
  return new Intl.NumberFormat(getLocale(), {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

/** The relay lights its steps one after another the first time it is seen; visible without script. */
function Relay() {
  const list = useRef<HTMLOListElement>(null);
  const [lit, setLit] = useState<number | null>(null);
  useEffect(() => {
    const el = list.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!('IntersectionObserver' in window)) return;
    setLit(0);
    const timers: number[] = [];
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        RELAY.forEach((_, i) => timers.push(window.setTimeout(() => setLit(i + 1), 250 + i * 420)));
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);
  return (
    <figure className="relay" aria-label={m.home_relay_label()}>
      <div className="relay-chat">
        <span className="relay-who">{m.home_relay_who()}</span>
        <p className="relay-ask">{m.home_relay_ask()}</p>
      </div>
      <ol ref={list} className={lit === null ? 'relay-steps' : 'relay-steps pending'}>
        {RELAY.map((s, i) => (
          <li
            key={s.tool}
            className={[
              `state state-${s.state}`,
              'you' in s ? 'relay-you' : '',
              lit !== null && i < lit ? 'on' : '',
            ].join(' ')}
          >
            <span>{'you' in s ? <b>{s.text()}</b> : s.text()}</span>
            <span className="figures mute">{s.tool}</span>
          </li>
        ))}
      </ol>
      <figcaption className="verdict healthy">
        <span className="mono-label">{m.home_rule_label()}</span>
        <h3>{m.home_rule_title()}</h3>
        <p>{m.home_rule_body()}</p>
      </figcaption>
    </figure>
  );
}

function Shot({
  src,
  width,
  height,
  alt,
}: {
  src: string;
  width: number;
  height: number;
  alt: string;
}) {
  return (
    <figure className="shot">
      <img src={src} width={width} height={height} loading="lazy" alt={alt} />
      <figcaption>{m.home_capture_caption()}</figcaption>
    </figure>
  );
}

/** Pono's public page: for whom, what changes, how, what it costs; then sign in with GitHub. */
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
            <a href="#change">{m.home_nav_change()}</a>
            <a href="#pricing">{m.home_nav_pricing()}</a>
            <a href="#faq">{m.home_nav_faq()}</a>
          </nav>
          <div className="home-header-end">
            <LocaleSwitch />
            <a className="btn btn-ghost btn-sm" href={SIGN_IN}>
              {m.home_signin()}
            </a>
            <a className="btn btn-primary btn-sm home-hide-sm" href={SIGN_IN}>
              {m.home_start()}
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="home-hero">
          <div className="wrap home-hero-grid">
            <div>
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
            <Relay />
          </div>
          <p className="wrap home-signature">{m.home_signature()}</p>
        </section>

        <section className="home-logos">
          <div className="wrap">
            <h2>{m.home_works_title()}</h2>
            <ul className="home-logo-groups">
              {WORKS_WITH.map((g) => (
                <li key={g.group()}>
                  <span className="home-group">{g.group()}</span>
                  <ul>
                    {g.tools.map(([logo, name]) => (
                      <li key={logo}>
                        <Logo name={logo} />
                        {name}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              <li>
                <span className="home-group">{m.home_works_pay()}</span>
                <ul>
                  <li className="home-text-only">{m.home_works_pay_value()}</li>
                </ul>
              </li>
            </ul>
          </div>
        </section>

        <section className="home-section">
          <div className="wrap home-split">
            <h2>{m.home_problem_title()}</h2>
            <ul className="home-lines home-pains">
              {PAINS.map((p, i) => (
                <li key={i}>
                  <b>{p.title()}</b>
                  {p.body()}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="home-section home-stakes">
          <div className="wrap">
            <h2>{m.home_stakes_title()}</h2>
            <p>{m.home_stakes_body()}</p>
          </div>
        </section>

        <section className="home-section alt" id="change">
          <div className="wrap">
            <h2>{m.home_change_title()}</h2>
            <div className="home-compare">
              <div className="home-compare-head">
                <span className="mono-label">{m.home_change_before()}</span>
                <span className="mono-label">{m.home_change_after()}</span>
              </div>
              {CHANGES.map((c, i) => (
                <div className="home-compare-row" key={i}>
                  <span>{c.before()}</span>
                  <span>{c.after()}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="home-section" id="how">
          <div className="wrap">
            <h2>{m.home_how_title()}</h2>
            <ol className="home-steps">
              {STEPS.map((s, i) => (
                <li key={i}>
                  <span className="figures mute">{i + 1}</span>
                  <h3>{s.title()}</h3>
                  <p>{s.body()}</p>
                  {'address' in s && <code className="address">{MCP_ADDRESS}</code>}
                </li>
              ))}
            </ol>
            <a className="btn btn-primary" href={SIGN_IN}>
              <Icon name="github" />
              {m.home_cta()}
            </a>
          </div>
        </section>

        <section className="home-section alt">
          <div className="wrap">
            <h2>{m.home_pillars_title()}</h2>
            <div className="home-pillar wide">
              <div>
                <h3>{m.home_p1_title()}</h3>
                <p>{m.home_p1_body()}</p>
              </div>
              <Shot src={serversShot} width={1212} height={373} alt={m.home_p1_alt()} />
            </div>
            <div className="home-pillar flip">
              <div>
                <h3>{m.home_p2_title()}</h3>
                <p>{m.home_p2_body()}</p>
              </div>
              <figure className="shot">
                <div className="proof" aria-hidden="true">
                  <div className="verdict">
                    <span className="mono-label">{m.home_p2_verdict_label()}</span>
                    <h3>{m.home_p2_verdict()}</h3>
                    <p>{m.home_p2_verdict_body()}</p>
                  </div>
                </div>
                <figcaption>{m.home_p2_example()}</figcaption>
              </figure>
            </div>
            <div className="home-pillar wide">
              <div>
                <h3>{m.home_p3_title()}</h3>
                <p>{m.home_p3_body()}</p>
              </div>
              <Shot src={overviewShot} width={814} height={328} alt={m.home_p3_alt()} />
            </div>
            <p className="home-more">{m.home_pillars_more()}</p>
          </div>
        </section>

        <section className="home-band">
          <div className="wrap">
            <h2>{m.home_diff_title()}</h2>
            <dl className="home-diff">
              {DIFFERENCES.map((d, i) => (
                <div key={i}>
                  <dt>{d.title()}</dt>
                  <dd>{d.body()}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="home-section">
          <div className="wrap home-split">
            <h2>{m.home_trust_title()}</h2>
            <ul className="home-lines home-facts">
              {TRUST.map((t, i) => (
                <li key={i}>{t()}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="home-section alt" id="pricing">
          <div className="wrap">
            <h2>{m.home_pricing_title()}</h2>
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
                    <h3>
                      {p.name()}
                      {featured && <span className="tag">{m.home_plan_popular()}</span>}
                    </h3>
                    <p className="home-price">
                      {!offer ? (
                        <b className="figures">—</b>
                      ) : sold ? (
                        <>
                          <b>{price((offer.priceMicros ?? 0) / 1_000_000)}</b>
                          {p.id !== 'free' && <span className="mute">{m.home_plan_month()}</span>}
                        </>
                      ) : (
                        <b>{label('availability', offer.availability)}</b>
                      )}
                    </p>
                    {offer && (
                      <p className="home-plan-servers">
                        {offer.activeServers === 1
                          ? m.home_plan_server_one()
                          : m.home_plan_servers({ count: String(offer.activeServers) })}
                      </p>
                    )}
                    <p className="home-plan-for">{p.for()}</p>
                    {offer?.availability === 'coming_soon' ? (
                      <span className="btn btn-ghost" aria-disabled="true">
                        {label('availability', 'coming_soon')}
                      </span>
                    ) : offer?.availability === 'on_request' ? (
                      <a className="btn btn-ghost" href={offer.contactUrl ?? SIGN_IN}>
                        {m.settings_contact()}
                      </a>
                    ) : (
                      <a className={`btn ${featured ? 'btn-primary' : 'btn-ghost'}`} href={SIGN_IN}>
                        {p.id === 'free' ? m.home_start() : m.home_plan_choose()}
                      </a>
                    )}
                  </article>
                );
              })}
            </div>
            <p className="fine">{m.home_plan_pay()}</p>
          </div>
        </section>

        <section className="home-section" id="faq">
          <div className="wrap home-split">
            <h2>{m.home_faq_title()}</h2>
            <div className="home-faq">
              {FAQ.map((f, i) => (
                <details key={i}>
                  <summary>{f.q()}</summary>
                  <p>{f.a()}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="home-band home-final">
          <div className="wrap">
            <h2>{m.home_final_title()}</h2>
            <p>{m.home_final_body()}</p>
            <a className="btn home-btn-invert" href={SIGN_IN}>
              <Icon name="github" />
              {m.home_cta()}
            </a>
            <p className="home-signature">{m.home_signature()}</p>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="wrap">
          <a className="monogram" href="/">
            <b>P</b>Pono
          </a>
          <span className="mute small">{m.home_footer()}</span>
          <nav>
            <a className="small" href="#pricing">
              {m.home_nav_pricing()}
            </a>
            <a className="small" href="#faq">
              {m.home_nav_faq()}
            </a>
            <a className="small" href={SIGN_IN}>
              {m.home_footer_console()}
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
