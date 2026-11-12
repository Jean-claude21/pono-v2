import { useState } from 'react';
import * as m from '@/paraglide/messages.js';

export interface LimitDetail {
  limit: number;
  active: { id: string; projectName: string }[];
}

/** When the plan is full: the person picks the server to put to sleep (D-004). Nothing stops without them. */
export function LimitChooser({
  detail,
  onChoose,
  onCancel,
}: Readonly<{ detail: LimitDetail; onChoose: (serverId: string) => void; onCancel: () => void }>) {
  const [chosen, setChosen] = useState(detail.active.at(-1)?.id ?? '');
  return (
    <div className="verdict" role="alertdialog" style={{ flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 320px' }}>
        <span className="mono-label">{m.error_servers_limit_reached()}</span>
        <h3>{m.limit_title({ limit: String(detail.limit) })}</h3>
        <p>{m.limit_body()}</p>
        <fieldset className="choices">
          {detail.active.map((s) => (
            <label className="choice" key={s.id}>
              <input
                type="radio"
                name="sleep"
                value={s.id}
                checked={chosen === s.id}
                onChange={() => setChosen(s.id)}
              />
              <strong>{s.projectName}</strong>
            </label>
          ))}
        </fieldset>
      </div>
      <div className="row">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {m.form_cancel()}
        </button>
        <a className="btn btn-ghost btn-sm" href="/settings">
          {m.limit_upgrade()}
        </a>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!chosen}
          onClick={() => onChoose(chosen)}
        >
          {m.limit_do()}
        </button>
      </div>
    </div>
  );
}
