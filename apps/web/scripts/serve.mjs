// The console in production (D-024): the built files from dist/client, everything else to the
// server entry (pages, and the relay to the API). srvx's own static option is not relied upon.
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from 'srvx';

const ROOT = fileURLToPath(new URL('../dist/client/', import.meta.url));
const { default: app } = await import(new URL('../dist/server/server.js', import.meta.url).href);

const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

async function file(pathname) {
  if (pathname === '/' || pathname.includes('\0')) return null;
  const path = normalize(join(ROOT, decodeURIComponent(pathname)));
  if (!path.startsWith(ROOT)) return null;
  try {
    if (!(await stat(path)).isFile()) return null;
  } catch {
    return null;
  }
  return new globalThis.Response(await readFile(path), {
    headers: {
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      // Built assets carry their hash in their name: they never change.
      'cache-control': pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600',
    },
  });
}

serve({
  port: Number(process.env.PORT ?? 3000),
  hostname: '0.0.0.0',
  async fetch(request) {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const found = await file(new URL(request.url).pathname);
      if (found) return found;
    }
    return app.fetch(request);
  },
});
