import { useCallback, useEffect, useState } from 'react';

export interface ApiError {
  code: string;
  status: number;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/** One call to the API through the console's own origin, with the session cookie. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    return { ok: false, error: { code: 'network', status: 0 } };
  }
  if (response.status === 204) return { ok: true, data: undefined as T };
  const body = (await response.json().catch(() => null)) as { error?: { code: string } } | null;
  if (!response.ok)
    return { ok: false, error: { code: body?.error?.code ?? 'internal', status: response.status } };
  return { ok: true, data: body as T };
}

export interface Loaded<T> {
  result: ApiResult<T> | null;
  reload: () => void;
}

/** Reads a path once in the browser, and again on `reload`. */
export function useApi<T>(path: string): Loaded<T> {
  const [result, setResult] = useState<ApiResult<T> | null>(null);
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    let live = true;
    void api<T>(path).then((r) => {
      if (live) setResult(r);
    });
    return () => {
      live = false;
    };
  }, [path, turn]);
  return { result, reload: useCallback(() => setTurn((n) => n + 1), []) };
}

// What the API answers (apps/api/src/features/*).
export interface Me {
  person: { id: string; login: string; name: string | null };
  organization: { id: string; name: string; role: string } | null;
}

export interface DeploymentView {
  environment: string;
  status: string;
  url: string | null;
  commit: string | null;
  createdAt: string;
}

export interface ProjectView {
  id: string;
  name: string;
  repository: string;
  defaultBranch: string;
  hosting: { provider: string | null; status: string };
  database: { provider: string | null; status: string };
  productionUrl: string | null;
  linkStatus: string;
  lastCommitAt: string | null;
  state: string;
  stateReason: string;
  refreshedAt: string | null;
  latestProduction?: DeploymentView | null;
}

export interface JournalLine {
  id: string;
  action: string;
  channel: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface ConnectionView {
  id: string;
  provider: string;
  kind: string;
  account: string;
  status: string;
  createdAt: string;
}
