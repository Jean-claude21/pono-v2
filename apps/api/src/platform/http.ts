/** A provider answered with an error, or did not answer. The provider id is an opaque adapter id. */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  /** The provider refused the credential. */
  get unauthorized(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export type Fetch = typeof fetch;

export interface JsonRequest {
  provider: string;
  url: string;
  headers?: Record<string, string>;
  method?: string;
  body?: unknown;
  timeoutMs?: number;
}

/** One JSON call to a provider, with a deadline; the response body of an error is never kept. */
export async function fetchJson<T>(fetchImpl: Fetch, request: JsonRequest): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(request.url, {
      method: request.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...request.headers,
      },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      signal: AbortSignal.timeout(request.timeoutMs ?? 15_000),
    });
  } catch (error) {
    throw new ProviderError(request.provider, null, `No answer: ${(error as Error).name}`);
  }
  if (!response.ok) {
    throw new ProviderError(request.provider, response.status, `Answered ${response.status}`);
  }
  return (await response.json()) as T;
}
