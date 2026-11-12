import type { ReactNode } from 'react';
import { api, useApi, type Me } from '@/lib/api';
import { label } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';
import { LevelChooser } from './LevelChooser';
import { LocaleSwitch } from './LocaleSwitch';
import { SignIn } from './SignIn';

export type Section =
  'projects' | 'usage' | 'servers' | 'catalog' | 'connections' | 'agents' | 'settings' | 'admin';

interface Item {
  label: string;
  href: string;
  section: Section;
}

function Nav({ items, current }: Readonly<{ items: Item[]; current: Section }>) {
  return (
    <nav>
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          aria-current={item.section === current ? 'page' : undefined}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

/** The workshop's frame: the rail and the main column, once the person is signed in. */
export function Shell({ section, children }: Readonly<{ section: Section; children: ReactNode }>) {
  const me = useApi<Me>('/v1/me');
  if (!me.result) return <p className="page mute">{m.loading()}</p>;
  if (!me.result.ok) {
    if (me.result.error.status === 401) return <SignIn />;
    return <p className="page">{label('error', me.result.error.code)}</p>;
  }
  const { person, isAdmin } = me.result.data;
  if (person.level === null)
    return (
      <div className="auth">
        <div className="auth-box" style={{ maxWidth: 880 }}>
          <h1>{m.level_title()}</h1>
          <p className="soft mt-sm">{m.level_body()}</p>
          <LevelChooser current={null} onChosen={me.reload} />
        </div>
      </div>
    );
  const signOut = async () => {
    await api('/auth/sign-out', { method: 'POST' });
    window.location.assign('/');
  };
  return (
    <div className="console">
      <aside className="rail">
        <a className="monogram" href="/">
          <b>P</b>Pono
        </a>
        <a className="btn btn-primary btn-sm" href="/catalog" style={{ justifyContent: 'center' }}>
          {m.rail_new_project()}
        </a>
        <div>
          <p className="mono-label" style={{ padding: '0 10px 8px' }}>
            {m.rail_workshop()}
          </p>
          <Nav
            current={section}
            items={[
              { label: m.rail_projects(), href: '/', section: 'projects' },
              { label: m.rail_usage(), href: '/usage', section: 'usage' },
              { label: m.rail_servers(), href: '/servers', section: 'servers' },
              { label: m.rail_catalog(), href: '/catalog', section: 'catalog' },
            ]}
          />
        </div>
        <div>
          <p className="mono-label" style={{ padding: '0 10px 8px' }}>
            {m.rail_organization()}
          </p>
          <Nav
            current={section}
            items={[
              { label: m.rail_services(), href: '/connections', section: 'connections' },
              { label: m.rail_agents(), href: '/agents', section: 'agents' },
              { label: m.rail_settings(), href: '/settings', section: 'settings' },
              ...(isAdmin
                ? [{ label: m.rail_admin(), href: '/admin', section: 'admin' as const }]
                : []),
            ]}
          />
        </div>
        <div className="foot">
          <span className="tiny mute" style={{ padding: '0 10px' }}>
            {m.rail_signed_as({ login: person.login })}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            style={{ margin: '0 10px' }}
            onClick={signOut}
          >
            {m.rail_sign_out()}
          </button>
          <LocaleSwitch />
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
