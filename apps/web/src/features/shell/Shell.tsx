import type { ReactNode } from 'react';
import { api, useApi, type Me } from '@/lib/api';
import { label } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';
import { LocaleSwitch } from './LocaleSwitch';
import { SignIn } from './SignIn';

type Section = 'projects' | 'connections';

interface Item {
  label: string;
  href?: string;
  current?: boolean;
}

function Nav({ items }: Readonly<{ items: Item[] }>) {
  return (
    <nav>
      {items.map((item) =>
        item.href ? (
          <a key={item.label} href={item.href} aria-current={item.current ? 'page' : undefined}>
            {item.label}
          </a>
        ) : (
          <a key={item.label} aria-disabled="true" className="mute">
            {item.label}
            <span className="figures">{m.rail_soon()}</span>
          </a>
        ),
      )}
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
  const person = me.result.data.person;
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
        <div>
          <p className="mono-label" style={{ padding: '0 10px 8px' }}>
            {m.rail_workshop()}
          </p>
          <Nav
            items={[
              { label: m.rail_projects(), href: '/', current: section === 'projects' },
              { label: m.rail_usage() },
              { label: m.rail_servers() },
              { label: m.rail_catalog() },
            ]}
          />
        </div>
        <div>
          <p className="mono-label" style={{ padding: '0 10px 8px' }}>
            {m.rail_organization()}
          </p>
          <Nav
            items={[
              {
                label: m.rail_services(),
                href: '/connections',
                current: section === 'connections',
              },
              { label: m.rail_agents() },
              { label: m.rail_settings() },
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
