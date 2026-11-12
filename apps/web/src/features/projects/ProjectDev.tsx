import { useState } from 'react';
import { api, useApi } from '@/lib/api';
import { label } from '@/lib/labels';
import * as m from '@/paraglide/messages.js';

interface DevView {
  phase: string;
  alive: boolean;
  http: number;
  branch: string | null;
  commit: string | null;
  changedFiles: number;
  logs: string;
  previewUrl: string | null;
  port: number | null;
}

/**
 * The dev loop (D-020): the project's dev server on its Pono server, its preview address that
 * reloads as files change, what changed, and the logs. Push goes to `dev` after the secrets check.
 */
export function ProjectDev({ projectId }: Readonly<{ projectId: string }>) {
  const data = useApi<DevView>(`/v1/projects/${projectId}/dev?lines=30`);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!data.result) return null;
  if (!data.result.ok) {
    const code = data.result.error.code;
    if (code === 'dev.no_server' || code === 'dev.server_asleep')
      return (
        <section>
          <h3 className="section-title mono-label">{m.dev_title()}</h3>
          <p className="mute small mt-md">{label('error', code)}</p>
        </section>
      );
    return null;
  }
  const dev = data.result.data;

  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    setNote(null);
    const result = await api<{
      pushed?: boolean;
      findings?: { file: string; line?: number }[];
      commit?: string;
    }>(`/v1/projects/${projectId}/dev/${path}`, {
      method: 'POST',
      ...(body === undefined ? {} : { body }),
    });
    setBusy(false);
    if (!result.ok) setNote(label('error', result.error.code));
    else if (result.data?.findings?.length)
      setNote(
        m.dev_push_refused({
          file: `${result.data.findings[0]!.file}:${result.data.findings[0]!.line ?? ''}`,
        }),
      );
    else if (result.data?.commit) setNote(m.dev_done({ commit: result.data.commit }));
    data.reload();
  };

  return (
    <section>
      <div className="spread">
        <h3 className="section-title mono-label">{m.dev_title()}</h3>
        <div className="row">
          {dev.phase === 'running' || dev.phase === 'installing' || dev.phase === 'starting' ? (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                disabled={busy}
                onClick={() => act('start')}
              >
                {m.dev_restart()}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                disabled={busy}
                onClick={() => act('stop')}
              >
                {m.dev_stop()}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-xs"
              disabled={busy}
              onClick={() => act('start')}
            >
              {m.dev_start()}
            </button>
          )}
        </div>
      </div>
      <dl className="facts mt-md">
        <div className="fact">
          <dt>{m.col_status()}</dt>
          <dd
            className={
              dev.phase === 'running'
                ? 'ok'
                : dev.phase === 'crashed' || dev.phase === 'install_failed'
                  ? 'bad'
                  : ''
            }
          >
            {label('devPhase', dev.phase)}
          </dd>
        </div>
        <div className="fact">
          <dt>{m.dev_preview()}</dt>
          <dd>
            {dev.previewUrl ? (
              <a href={dev.previewUrl} target="_blank" rel="noreferrer">
                {dev.previewUrl.replace(/^https:\/\//, '')}
              </a>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div className="fact">
          <dt>{m.dev_branch()}</dt>
          <dd className="figures">
            {dev.branch ?? '—'} {dev.commit ?? ''}
          </dd>
        </div>
        <div className="fact">
          <dt>{m.dev_changed()}</dt>
          <dd className="figures">{dev.changedFiles}</dd>
        </div>
      </dl>
      {dev.phase !== 'absent' && (
        <div className="row mt-sm">
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            disabled={busy}
            onClick={() => act('pull')}
          >
            {m.dev_pull()}
          </button>
          {dev.changedFiles > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              disabled={busy}
              onClick={() => act('push', { message: m.dev_push_message() })}
            >
              {m.dev_push()}
            </button>
          )}
        </div>
      )}
      {note && <p className="notice mt-md small">{note}</p>}
      {dev.logs && (
        <pre
          className="small mt-md logs"
          style={{ whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }}
        >
          {dev.logs}
        </pre>
      )}
    </section>
  );
}
