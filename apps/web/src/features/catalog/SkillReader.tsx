import { useState } from 'react';
import { useApi } from '@/lib/api';
import { label } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';

interface Skill {
  name: string;
  description: string;
  body: string;
  files?: Record<string, string>;
}

/**
 * What an agent reads when it takes a skill (D-028): its instructions (SKILL.md), then each of its
 * files — references, scripts, examples, licence — shown as they are, never run.
 */
export function SkillReader({ name, onClose }: { name: string; onClose: () => void }) {
  const skill = useApi<{ skill: Skill }>(`/v1/catalog/skills/${encodeURIComponent(name)}`);
  const [file, setFile] = useState<string | null>(null);
  if (!skill.result) return <p className="mute small">{m.loading()}</p>;
  if (!skill.result.ok) return <p className="notice">{label('error', skill.result.error.code)}</p>;
  const s = skill.result.data.skill;
  const files = Object.keys(s.files ?? {}).sort();
  return (
    <div className="mt-sm">
      <div className="row small">
        <button
          type="button"
          className={`btn btn-xs ${file === null ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setFile(null)}
        >
          {m.catalog_skill_main()}
        </button>
        {files.map((f) => (
          <button
            key={f}
            type="button"
            className={`btn btn-xs ${file === f ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFile(f)}
          >
            {f}
          </button>
        ))}
        <button type="button" className="btn btn-ghost btn-xs" onClick={onClose}>
          {m.catalog_skill_close()}
        </button>
      </div>
      <pre className="code mt-sm" style={{ maxHeight: 420, overflow: 'auto' }}>
        {file === null ? s.body : (s.files?.[file] ?? '')}
      </pre>
    </div>
  );
}
