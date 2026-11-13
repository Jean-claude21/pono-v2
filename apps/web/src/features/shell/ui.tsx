import type { CSSProperties, ReactNode } from 'react';

/** Line icons, 24×24 strokes (D-022). Decorative: the text next to them says what they mean. */
const PATHS = {
  github:
    'M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  server:
    'M5 4h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM5 13h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2zM7 7.5h.01M7 16.5h.01',
  code: 'm8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14',
  rocket:
    'M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 12l3 3M14.5 4.5C17 2 21 3 21 3s1 4-1.5 6.5L13 16l-5-5z',
  plug: 'M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M19 19v2H6',
  bot: 'M7 8h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3zM12 4v4M9 13h.01M15 13h.01M9 17h6',
  gauge: 'M4 19V5M4 19h16M8 15l4-5 3 3 5-6',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  sidebar: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 4v16',
  chevron: 'm9 6 6 6-6 6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  menu: 'M4 6h16M4 12h16M4 18h16',
  plus: 'M12 5v14M5 12h14',
  alert: 'M12 3 2 20h20zM12 10v4M12 17h.01',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  key: 'M8 19a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM11 12l9-9M17 6l3 3M15 8l2 2',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  chart: 'M4 19V5M4 19h16M8 15l4-5 3 3 5-6',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: Readonly<{ name: IconName }>) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The head of every page: its title, what it is for, its gestures. */
export function PageHead({
  title,
  intro,
  actions,
  children,
}: Readonly<{ title: ReactNode; intro?: ReactNode; actions?: ReactNode; children?: ReactNode }>) {
  return (
    <div className="topline">
      <div>
        <h1>{title}</h1>
        {intro && <p className="intro">{intro}</p>}
        {children}
      </div>
      {actions && <div className="topline-actions">{actions}</div>}
    </div>
  );
}

/** A card: an icon, a title, its tools, its body and the line that says where figures come from. */
export function Card({
  title,
  icon,
  tools,
  foot,
  wide,
  className,
  children,
}: Readonly<{
  title: ReactNode;
  icon: IconName;
  tools?: ReactNode;
  foot?: ReactNode;
  wide?: boolean;
  className?: string;
  children: ReactNode;
}>) {
  return (
    <section className={`card${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`}>
      <header className="card-head">
        <span className="card-icon">
          <Icon name={icon} />
        </span>
        <h2>{title}</h2>
        {tools && <div className="card-tools">{tools}</div>}
      </header>
      <div className="card-body">{children}</div>
      {foot && <footer className="card-foot">{foot}</footer>}
    </section>
  );
}

export interface Figure {
  value: ReactNode;
  label: ReactNode;
  unit?: string;
  tone?: 'failing' | 'warning';
}

/** Three (or four) figures side by side, at the top of a card. */
export function Stats({ items }: Readonly<{ items: Figure[] }>) {
  return (
    <div className="stats" style={{ '--n': items.length } as CSSProperties}>
      {items.map((f, i) => (
        <div className={`stat${f.tone ? ` ${f.tone}` : ''}`} key={i}>
          <b>
            {f.value}
            {f.unit && <small>{f.unit}</small>}
          </b>
          <span>{f.label}</span>
        </div>
      ))}
    </div>
  );
}

/** A thin bar; `mark` draws the 80 % warning line. */
export function Thin({
  percent,
  tone,
  mark,
}: Readonly<{ percent: number; tone?: 'ok' | 'warn' | 'crit'; mark?: boolean }>) {
  const value = Math.max(0, Math.min(100, percent));
  return (
    <div className={`thin${tone ? ` ${tone}` : ''}`}>
      <i style={{ '--value': `${value}%` } as CSSProperties} />
      {mark && <span className="mark" />}
    </div>
  );
}

/** Usage tone: warn from 80 %, critical from 95 %. */
export function toneOf(percent: number | null): 'warn' | 'crit' | undefined {
  if (percent === null) return undefined;
  if (percent >= 95) return 'crit';
  if (percent >= 80) return 'warn';
  return undefined;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: Readonly<{
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  label: string;
}>) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** The state of a project or a server: a dot carries the colour, the label stays in ink. */
export function StateDot({
  state,
  text,
  live,
}: Readonly<{ state: string; text: ReactNode; live?: boolean }>) {
  return <span className={`state state-${state}${live ? ' live' : ''}`}>{text}</span>;
}
