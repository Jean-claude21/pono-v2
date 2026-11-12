/**
 * The console is the browser's only origin: `/auth/*` and `/v1/*` go to the API as they are, so the
 * session cookie is the console's own (SameSite=Lax, HttpOnly).
 */
const API_URL = process.env.PONO_API_URL ?? 'http://localhost:8787';

export function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/auth/') || pathname.startsWith('/v1/');
}

export async function relay(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.delete('host');
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const answer = await fetch(`${API_URL}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    redirect: 'manual',
    ...(hasBody ? { body: await request.arrayBuffer() } : {}),
  });
  const out = new Headers(answer.headers);
  out.delete('content-encoding');
  out.delete('content-length');
  return new Response(answer.body, { status: answer.status, headers: out });
}
