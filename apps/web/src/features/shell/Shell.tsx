import { useEffect, useState, type ReactNode } from 'react';
import { api, useApi, type Me } from '@/lib/api';
import { label } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';
import { LocaleSwitch } from './LocaleSwitch';
import { Palette, type Destination } from './Palette';
import { Home } from '@/features/home/Home';
import { SignIn } from './SignIn';
import { Icon, type IconName } from './ui';

export type Section =
  | 'overview'
  | 'projects'
  | 'usage'
  | 'servers'
  | 'catalog'
  | 'connections'
  | 'agents'
  | 'settings'
  | 'admin';

interface Item {
  label: string;
  href: string;
  section: Section;
  icon: IconName;
  figure?: string | undefined;
}

interface Slots {
  active: number;
  limit: number;
}

const THEME_KEY = 'pono-theme';

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Without storage the choice lasts for this page only.
  }
}

/** Light or dark (D-022): the computer's choice, unless the person picked one. */
function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const chosen = document.documentElement.dataset.theme;
    setDark(chosen ? chosen === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
  }, []);
  const toggle = () => {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store(THEME_KEY, next);
    setDark(!dark);
  };
  return { dark, toggle };
}

function Nav({ items, current }: Readonly<{ items: Item[]; current: Section }>) {
  return (
    <nav>
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          title={item.label}
          aria-current={item.section === current ? 'page' : undefined}
        >
          <Icon name={item.icon} />
          <span className="rail-text">{item.label}</span>
          {item.figure && <span className="figures rail-text">{item.figure}</span>}
        </a>
      ))}
    </nav>
  );
}

function PlanRing({ slots }: Readonly<{ slots: Slots }>) {
  const ratio = slots.limit > 0 ? Math.min(1, slots.active / slots.limit) : 0;
  const circumference = 2 * Math.PI * 15;
  return (
    <a className="plan-card" href="/servers" title={m.rail_plan_title()}>
      <svg className="ring" viewBox="0 0 36 36" aria-hidden="true">
        <circle className="track" cx="18" cy="18" r="15" />
        <circle
          className={`fill${slots.active >= slots.limit ? ' full' : ''}`}
          cx="18"
          cy="18"
          r="15"
          strokeDasharray={`${ratio * circumference} ${circumference}`}
        />
        <text x="18" y="21" textAnchor="middle">
          {slots.active}/{slots.limit}
        </text>
      </svg>
      <div className="rail-text">
        <strong>{m.rail_plan_title()}</strong>
        <span>
          {m.rail_plan_body({ active: String(slots.active), limit: String(slots.limit) })}
        </span>
      </div>
    </a>
  );
}

/**
 * The workshop's frame (D-022): the grouped rail, the top bar with the path and the search, and
 * the page inside its paper panel — once the person is signed in and has said how they work.
 */
export function Shell({
  section,
  crumb,
  children,
}: Readonly<{ section: Section; crumb?: string | undefined; children: ReactNode }>) {
  const me = useApi<Me>('/v1/me');
  const servers = useApi<Slots>('/v1/servers');
  const theme = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);

  useEffect(() => setCollapsed(readStored('pono-rail') === 'collapsed'), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!me.result) return <p className="page mute">{m.loading()}</p>;
  if (!me.result.ok) {
    // Signed out: the public page on the home address, the sign-in everywhere else.
    if (me.result.error.status === 401) return section === 'overview' ? <Home /> : <SignIn />;
    return <p className="page">{label('error', me.result.error.code)}</p>;
  }
  const { person, organization, isAdmin } = me.result.data;
  // No question before the console: the level stays unset until the person sets it in the
  // settings, or until their agent asks it once in the conversation (LEVEL_GUIDANCE.unknown).

  const slots = servers.result?.ok ? servers.result.data : null;
  const workshop: Item[] = [
    { label: m.rail_overview(), href: '/', section: 'overview', icon: 'grid' },
    { label: m.rail_projects(), href: '/projects', section: 'projects', icon: 'folder' },
    {
      label: m.rail_servers(),
      href: '/servers',
      section: 'servers',
      icon: 'server',
      figure: slots ? `${slots.active}/${slots.limit}` : undefined,
    },
    { label: m.rail_usage(), href: '/usage', section: 'usage', icon: 'gauge' },
    { label: m.rail_catalog(), href: '/catalog', section: 'catalog', icon: 'book' },
  ];
  const organizationItems: Item[] = [
    { label: m.rail_services(), href: '/connections', section: 'connections', icon: 'plug' },
    { label: m.rail_agents(), href: '/agents', section: 'agents', icon: 'bot' },
    { label: m.rail_settings(), href: '/settings', section: 'settings', icon: 'settings' },
    ...(isAdmin
      ? [
          {
            label: m.rail_admin(),
            href: '/admin',
            section: 'admin' as const,
            icon: 'shield' as const,
          },
        ]
      : []),
  ];
  const all = [...workshop, ...organizationItems];
  const here = all.find((i) => i.section === section);
  const destinations: Destination[] = all.map((i) => ({
    label: i.label,
    href: i.href,
    icon: i.icon,
    kind: 'page',
  }));
  const initials = (person.name ?? person.login)
    .split(/[\s-]+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const signOut = async () => {
    await api('/auth/sign-out', { method: 'POST' });
    window.location.assign('/');
  };
  const collapse = () => {
    store('pono-rail', collapsed ? 'open' : 'collapsed');
    setCollapsed(!collapsed);
  };

  return (
    <div className={`console${collapsed ? ' collapsed' : ''}${menu ? ' menu-open' : ''}`}>
      <aside className="rail">
        <a className="monogram" href="/">
          <b>P</b>
          <span className="rail-text">Pono</span>
        </a>
        <p className="mono-label rail-group rail-text">{m.rail_workshop()}</p>
        <Nav items={workshop} current={section} />
        <p className="mono-label rail-group rail-text">{m.rail_organization()}</p>
        <Nav items={organizationItems} current={section} />
        <div className="foot">
          {slots && <PlanRing slots={slots} />}
          <button type="button" className="rail-item" onClick={theme.toggle}>
            <Icon name={theme.dark ? 'sun' : 'moon'} />
            <span className="rail-text">
              {theme.dark ? m.rail_theme_light() : m.rail_theme_dark()}
            </span>
          </button>
          <div className="rail-text">
            <LocaleSwitch />
          </div>
          <div className="who">
            <span className="avatar">{initials}</span>
            <div className="rail-text" style={{ minWidth: 0 }}>
              <strong>{person.name ?? person.login}</strong>
              {person.level && <span>{label('level', person.level)}</span>}
            </div>
          </div>
          <button type="button" className="rail-item" onClick={signOut}>
            <Icon name="logout" />
            <span className="rail-text">{m.rail_sign_out()}</span>
          </button>
          <button type="button" className="rail-item collapse-btn" onClick={collapse}>
            <Icon name="sidebar" />
            <span className="rail-text">{m.rail_collapse()}</span>
          </button>
        </div>
      </aside>
      <main className="main" onClick={() => menu && setMenu(false)}>
        <header className="topbar">
          <div className="row" style={{ flexWrap: 'nowrap', minWidth: 0 }}>
            <button
              type="button"
              className="icon-btn menu-btn"
              aria-label={m.top_menu()}
              onClick={(e) => {
                e.stopPropagation();
                setMenu(!menu);
              }}
            >
              <Icon name="menu" />
            </button>
            <nav className="crumbs" aria-label={m.top_path()}>
              {organization && (
                <>
                  <span className="org-name">{organization.name}</span>
                  <span className="org-sep">
                    <Icon name="chevron" />
                  </span>
                </>
              )}
              {crumb && here ? (
                <>
                  <a href={here.href}>{here.label}</a>
                  <Icon name="chevron" />
                  <strong>{crumb}</strong>
                </>
              ) : (
                <strong>{here?.label}</strong>
              )}
            </nav>
          </div>
          <div className="top-actions">
            <button type="button" className="search-btn" onClick={() => setPalette(true)}>
              <Icon name="search" />
              <span>{m.top_search()}</span>
              <kbd>{m.top_search_keys()}</kbd>
            </button>
            {organization && (
              <span className="org-chip" title={organization.name}>
                <b>{organization.name.slice(0, 1).toUpperCase()}</b>
                <span>{organization.name}</span>
              </span>
            )}
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
      {palette && <Palette pages={destinations} onClose={() => setPalette(false)} />}
    </div>
  );
}
