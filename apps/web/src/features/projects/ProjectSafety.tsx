import { useState } from 'react';
import { api, useApi } from '@/lib/api';
import { label, when } from '@/lib/labels';
import { Card } from '@/features/shell/ui';
import * as m from '@/paraglide/messages.js';

interface NetworkView {
  mode: 'open' | 'limited';
  base: string[];
  services: { provider: string; domains: string[] }[];
  extra: string[];
  enforced: boolean;
}

/**
 * Where the project's server may connect (D-031): open, or limited to the registries, the code host,
 * the connected services and the domains the person adds. Applied within seconds, no restart.
 */
export function ProjectNetwork({ projectId }: Readonly<{ projectId: string }>) {
  const data = useApi<NetworkView>(`/v1/projects/${projectId}/network`);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!data.result?.ok) return null;
  const net = data.result.data;
  const text = draft ?? net.extra.join('\n');

  const save = async (mode: NetworkView['mode']) => {
    setBusy(true);
    setNote(null);
    const extra = text
      .split(/[\s,]+/)
      .map((d) => d.trim())
      .filter(Boolean);
    const result = await api(`/v1/projects/${projectId}/network`, {
      method: 'PUT',
      body: { mode, extra },
    });
    setBusy(false);
    if (!result.ok) {
      setNote(
        result.error.code === 'request.invalid'
          ? m.network_invalid()
          : label('error', result.error.code),
      );
      return;
    }
    setDraft(null);
    setNote(m.network_saved());
    data.reload();
  };

  return (
    <Card
      title={m.network_title()}
      icon="shield"
      tools={
        <span className={`state state-${net.mode === 'limited' ? 'healthy' : 'idle'}`}>
          {net.mode === 'limited' ? m.network_limited() : m.network_open()}
        </span>
      }
    >
      <p className="small soft mt-md">
        {net.mode === 'limited' ? m.network_limited_help() : m.network_open_help()}
      </p>
      {!net.enforced && <p className="notice warning small">{m.network_not_enforced()}</p>}
      {net.mode === 'limited' && (
        <>
          <p className="small mt-md">{m.network_always()}</p>
          <p className="small mute figures">
            {[...net.base, ...net.services.flatMap((s) => s.domains)].join(' · ')}
          </p>
        </>
      )}
      <label className="field mt-md">
        <span className="small">{m.network_extra()}</span>
        <textarea
          rows={3}
          value={text}
          placeholder={m.network_placeholder()}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      <div className="row mt-sm">
        {net.mode === 'open' ? (
          <button
            type="button"
            className="btn btn-primary btn-xs"
            disabled={busy}
            onClick={() => save('limited')}
          >
            {m.network_limit()}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary btn-xs"
              disabled={busy}
              onClick={() => save('limited')}
            >
              {m.network_save()}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              disabled={busy}
              onClick={() => save('open')}
            >
              {m.network_reopen()}
            </button>
          </>
        )}
      </div>
      {note && <p className="notice mt-md small">{note}</p>}
    </Card>
  );
}

interface BackupView {
  id: string;
  kind: 'automatic' | 'manual';
  createdAt: string;
  sizeBytes: number;
}

const size = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;

/**
 * The server's restore points (D-031): the last seven nights and one taken on demand. A restore
 * replaces every file; the person confirms it, the agent never does it.
 */
export function ProjectBackups({ projectId }: Readonly<{ projectId: string }>) {
  const servers = useApi<{ servers: { id: string; projectId: string; status: string }[] }>(
    '/v1/servers',
  );
  const server = servers.result?.ok
    ? servers.result.data.servers.find((s) => s.projectId === projectId)
    : undefined;
  if (!server) return null;
  return <Backups serverId={server.id} />;
}

function Backups({ serverId }: Readonly<{ serverId: string }>) {
  const data = useApi<{ backups: BackupView[]; restoring: boolean }>(
    `/v1/servers/${serverId}/backups`,
  );
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const backup = async () => {
    setBusy(true);
    setNote(m.backups_saving());
    const result = await api(`/v1/servers/${serverId}/backups`, { method: 'POST' });
    setBusy(false);
    setNote(result.ok ? m.backups_saved() : label('error', result.error.code));
    data.reload();
  };

  const restore = async (b: BackupView) => {
    if (!window.confirm(m.backups_restore_confirm({ date: when(b.createdAt) }))) return;
    setBusy(true);
    const result = await api(`/v1/servers/${serverId}/restore`, {
      method: 'POST',
      body: { backup: b.id },
    });
    setBusy(false);
    setNote(result.ok ? m.backups_restoring() : label('error', result.error.code));
    data.reload();
  };

  if (!data.result) return null;
  if (!data.result.ok) return null;
  const { backups, restoring } = data.result.data;

  return (
    <Card
      title={m.backups_title()}
      icon="folder"
      tools={
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          disabled={busy || restoring}
          onClick={backup}
        >
          {m.backups_now()}
        </button>
      }
    >
      <p className="small soft mt-md">{m.backups_help()}</p>
      {restoring && <p className="notice small">{m.backups_restoring()}</p>}
      {backups.length === 0 ? (
        <p className="small mute mt-md">{m.backups_none()}</p>
      ) : (
        <div className="mt-md">
          {backups.map((b) => (
            <div className="item" key={b.id}>
              <div>
                <h4>{when(b.createdAt)}</h4>
                <p className="small mute">
                  {b.kind === 'manual' ? m.backups_manual() : m.backups_nightly()} ·{' '}
                  {size(b.sizeBytes)}
                </p>
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  disabled={busy || restoring}
                  onClick={() => restore(b)}
                >
                  {m.backups_restore()}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {note && <p className="notice mt-md small">{note}</p>}
    </Card>
  );
}
