import { useEffect, useRef, useState } from 'react';
import { useApi, type ProjectView } from '@/lib/api';
import * as m from '@/paraglide/messages.js';
import { Icon, type IconName } from './ui';

export interface Destination {
  label: string;
  href: string;
  icon: IconName;
  kind: 'page' | 'project';
}

/** Ctrl K: one field that leads to a page or a project (D-022). Esc or a click outside closes it. */
export function Palette({
  pages,
  onClose,
}: Readonly<{ pages: Destination[]; onClose: () => void }>) {
  const projects = useApi<{ projects: ProjectView[] }>('/v1/projects');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const all: Destination[] = [
    ...pages,
    ...(projects.result?.ok ? projects.result.data.projects : []).map((p) => ({
      label: p.name,
      href: `/projects/${p.id}`,
      icon: 'folder' as const,
      kind: 'project' as const,
    })),
  ];
  const q = query.trim().toLowerCase();
  const found = all.filter((d) => d.label.toLowerCase().includes(q));
  const at = Math.min(selected, Math.max(0, found.length - 1));
  const go = (d: Destination | undefined) => {
    if (d) window.location.assign(d.href);
  };

  return (
    <div
      className="backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-box" role="dialog" aria-label={m.palette_label()}>
        <div className="palette-input">
          <Icon name="search" />
          <input
            ref={input}
            value={query}
            placeholder={m.palette_placeholder()}
            aria-label={m.palette_label()}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'Enter') go(found[at]);
              else if (e.key === 'ArrowDown' && found.length) {
                e.preventDefault();
                setSelected((at + 1) % found.length);
              } else if (e.key === 'ArrowUp' && found.length) {
                e.preventDefault();
                setSelected((at - 1 + found.length) % found.length);
              }
            }}
          />
          <kbd>{m.palette_escape()}</kbd>
        </div>
        <ul className="palette-list" role="listbox">
          {found.length === 0 && <li className="empty">{m.palette_empty()}</li>}
          {found.map((d, i) => (
            <li key={d.href}>
              <button
                type="button"
                role="option"
                aria-selected={i === at}
                onMouseEnter={() => setSelected(i)}
                onClick={() => go(d)}
              >
                <Icon name={d.icon} />
                {d.label}
                <span className="kind">
                  {d.kind === 'page' ? m.palette_kind_page() : m.palette_kind_project()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
