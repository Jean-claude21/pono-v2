// Builds the Pono server template on Agent37 (D-034) through its raw build API, without the CLI
// (whose tar reads a Windows drive as a remote host). Run from this folder:
//   tar -czf ../server-image.tar.gz --exclude=build.mjs . && node --env-file=<secrets> build.mjs
// Prints the build log, never the key.
import { readFile, stat } from 'node:fs/promises';

const API = 'https://api.agent37.com/v1';
const name = process.argv[2] ?? 'pono-web';
const context = new URL('../server-image.tar.gz', import.meta.url);
const auth = { authorization: `Bearer ${process.env.AGENT37_API_KEY}` };
const call = async (path, init = {}) => {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...auth, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
};

const size = (await stat(context)).size;
const build = await call('/template-builds', {
  method: 'POST',
  body: JSON.stringify({
    name,
    size_bytes: size,
    description: 'Pono: pnpm, Spec Kit, Postgres client, Chromium',
  }),
});
console.log('build', build.id, `${(size / 1024).toFixed(1)} KB`);
const up = await fetch(build.upload_url, { method: 'PUT', body: await readFile(context) });
if (!up.ok) throw new Error(`upload ${up.status}`);
await call(`/template-builds/${build.id}/start`, { method: 'POST', body: '{}' });

let offset = 0;
for (let i = 0; i < 400; i++) {
  await new Promise((r) => setTimeout(r, 6000));
  const b = await call(`/template-builds/${build.id}/logs?offset=${offset}`);
  const chunk = b.log ?? b.logs ?? b.chunk ?? '';
  if (chunk) process.stdout.write(chunk);
  offset = b.offset ?? b.next_offset ?? offset + chunk.length;
  if (['succeeded', 'published', 'failed', 'cancelled', 'completed'].includes(b.status)) {
    console.log('\nstatus', b.status, b.template ? JSON.stringify(b.template).slice(0, 200) : '');
    process.exit(b.status === 'failed' || b.status === 'cancelled' ? 1 : 0);
  }
}
console.log('still building; poll again');
