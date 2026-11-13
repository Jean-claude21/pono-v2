import { useState } from 'react';
import { api, useApi } from '@/lib/api';
import { ago, label, when } from '@/lib/labels';
import { Card } from '@/features/shell/ui';
import * as m from '@/paraglide/messages.js';

interface GuardResult {
  guard: string;
  passed: boolean;
  findings: { code: string; file?: string; line?: number; what?: string }[];
}

interface Release {
  id: string;
  number: number;
  title: string;
  headSha: string;
  url: string | null;
  verdict: string;
  guards: GuardResult[];
  status: string;
  createdAt: string;
}

interface ReleasesView {
  mode: 'ask' | 'auto' | 'bypass';
  modeUntil: string | null;
  protection: string;
  releases: Release[];
}

const MODES = [
  ['ask', m.mode_ask, m.mode_ask_body],
  ['auto', m.mode_auto, m.mode_auto_body],
  ['bypass', m.mode_bypass, m.mode_bypass_body],
] as const;

/** The project's release: its mode, its proposals and their verdicts, and the person's gestures (phase 5). */
export function Releases({ projectId }: Readonly<{ projectId: string }>) {
  const data = useApi<ReleasesView>(`/v1/projects/${projectId}/releases`);
  const [hours, setHours] = useState(24);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data.result?.ok) return null;
  const { mode, modeUntil, protection, releases } = data.result.data;

  const act = async (path: string, method = 'POST', body?: unknown) => {
    setBusy(true);
    setError(null);
    const result = await api(path, { method, ...(body === undefined ? {} : { body }) });
    setBusy(false);
    if (!result.ok) setError(label('error', result.error.code));
    data.reload();
  };

  return (
    <Card title={m.releases_title()} icon="rocket">
      <div className="spread mt-md">
        <span className={`protection ${protection} small`}>
          ● {label('protection', protection)}
        </span>
        <div className="row">
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            disabled={busy}
            onClick={() => act(`/v1/projects/${projectId}/releases/evaluate`)}
          >
            {m.releases_evaluate()}
          </button>
          {protection !== 'protected' && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              disabled={busy}
              onClick={() => act(`/v1/projects/${projectId}/protect`)}
            >
              {m.releases_protect()}
            </button>
          )}
          <button
            type="button"
            className="btn btn-danger btn-xs"
            disabled={busy}
            onClick={() => {
              if (window.confirm(m.releases_rollback_confirm()))
                void act(`/v1/projects/${projectId}/rollback`);
            }}
          >
            {m.releases_rollback()}
          </button>
        </div>
      </div>
      {error && <p className="notice warning">{error}</p>}

      <fieldset className="choices">
        {MODES.map(([id, name, body]) => (
          <label className="choice" key={id}>
            <input
              type="radio"
              name={`mode-${projectId}`}
              checked={mode === id}
              onChange={() =>
                act(`/v1/projects/${projectId}/release-mode`, 'PUT', {
                  mode: id,
                  ...(id === 'bypass' ? { hours } : {}),
                })
              }
            />
            <strong>
              {name()}
              {id === 'bypass' && mode === 'bypass' && modeUntil
                ? ` · ${m.mode_until({ date: when(modeUntil) })}`
                : ''}
            </strong>
            <span>{body()}</span>
          </label>
        ))}
      </fieldset>
      {mode !== 'bypass' && (
        <div className="field" style={{ maxWidth: 220, marginTop: 10 }}>
          <label htmlFor={`hours-${projectId}`}>{m.mode_bypass_hours()}</label>
          <input
            id={`hours-${projectId}`}
            type="number"
            min={1}
            max={720}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          />
        </div>
      )}

      {releases.length === 0 ? (
        <p className="mute small mt-md">{m.releases_none()}</p>
      ) : (
        releases.map((r) => (
          <div
            className={`release ${r.verdict === 'refused' ? 'release-failing' : r.status === 'merged' ? 'release-healthy' : ''}`}
            key={r.id}
          >
            <div className="release-head">
              <div>
                <span className="mono-label">
                  #{r.number} · {label('verdict', r.verdict)} · {label('releaseStatus', r.status)}
                </span>
                <h3>{r.title}</h3>
                <p className="mute">
                  {r.headSha.slice(0, 7)} · {ago(r.createdAt)}
                </p>
              </div>
              {r.status === 'waiting' && (
                <div className="release-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => act(`/v1/releases/${r.id}/decline`)}
                  >
                    {m.releases_decline()}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy}
                    onClick={() => act(`/v1/releases/${r.id}/approve`)}
                  >
                    {m.releases_approve()}
                  </button>
                </div>
              )}
            </div>
            <ul className="guards">
              {r.guards.map((g) => (
                <li className="guard" key={g.guard}>
                  <span className="guard-name">{label('guard', g.guard)}</span>
                  <span className={`guard-status ${g.passed ? 'passed' : 'failed'}`}>
                    {g.passed ? m.guard_passed() : m.guard_failed()}
                  </span>
                  <span className="guard-detail">
                    <ul>
                      {g.findings.map((f, i) => (
                        <li key={i}>
                          {f.code}
                          {f.file ? ` · ${f.file}${f.line ? `:${f.line}` : ''}` : ''}
                          {f.what ? ` · ${f.what}` : ''}
                        </li>
                      ))}
                    </ul>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </Card>
  );
}
