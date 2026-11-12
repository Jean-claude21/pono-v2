import { useState } from 'react';
import { api } from '@/lib/api';
import * as m from '@/paraglide/messages.js';

export type Level = 'guided' | 'choosing' | 'expert';

const LEVELS = [
  ['guided', m.level_guided, m.level_guided_body],
  ['choosing', m.level_choosing, m.level_choosing_body],
  ['expert', m.level_expert, m.level_expert_body],
] as const;

/**
 * How much the person wants to decide (D-015). Asked once after the first sign-in, changed in the
 * settings; the agents read the same answer.
 */
export function LevelChooser({
  current,
  onChosen,
}: Readonly<{ current: Level | null; onChosen: () => void }>) {
  const [busy, setBusy] = useState(false);
  const choose = async (level: Level) => {
    setBusy(true);
    await api('/v1/me/level', { method: 'PUT', body: { level } });
    setBusy(false);
    onChosen();
  };
  return (
    <div className="plans mt-md">
      {LEVELS.map(([id, title, body]) => (
        <div className={`plan ${id === current ? 'current' : ''}`} key={id}>
          <h3>{title()}</h3>
          <p className="soft small mt-sm">{body()}</p>
          {id === current ? (
            <span className="mono-label">{m.settings_current()}</span>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm mt-md"
              disabled={busy}
              onClick={() => choose(id)}
            >
              {m.level_choose()}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
