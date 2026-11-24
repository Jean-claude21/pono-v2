/**
 * The agent sees what it builds, for real (D-038), on a throwaway server of the Pono template:
 * a plain Node server run under --watch follows an edit without a restart; a capture of the
 * preview comes back as a JPEG with its answer and its console errors. Prints sizes, never a key.
 *
 *   node --env-file=../../../.secrets/.admin.env --import tsx scripts/eyes-live.ts
 */
import { writeFileSync } from 'node:fs';
import { reloads, watching } from '../src/features/devloop/domain.js';
import { readShot, shotCommand } from '../src/features/devloop/shot.js';
import { agent37Host } from '../src/infrastructure/providers/agent37.js';

const host = agent37Host({ apiKey: process.env.AGENT37_API_KEY!, fetch, ponoTemplate: 'pono-web' });
const t0 = Date.now();
const log = (s: string, d: unknown = '') =>
  console.log(
    `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${s}`,
    typeof d === 'string' ? d : JSON.stringify(d),
  );
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  log(`ok  ${what}`);
};

// INSTANCE: a probe server already asked for (a first boot of the template can outlast the call).
const s = process.env.INSTANCE
  ? { externalId: process.env.INSTANCE }
  : await host.create({
      name: 'pono-eyes-probe',
      agent: 'none',
      env: {},
      metadata: { probe: 'eyes' },
      budgetMicros: 300_000,
      idleSeconds: 600,
    });
try {
  for (let i = 0; i < 100 && (await host.get(s.externalId))?.status !== 'running'; i++)
    await new Promise((r) => setTimeout(r, 3000));
  const page = (word: string) =>
    `<!doctype html><meta charset="utf-8"><title>Eyes</title><body style="font:48px sans-serif;background:#f6ede7"><h1>${word}</h1><script>console.error("visible error")</script>`;
  const server = `import{createServer}from"node:http";import{readFileSync}from"node:fs";const body=readFileSync("index.html");createServer((q,r)=>{r.writeHead(200,{"content-type":"text/html"});r.end(body)}).listen(4000,"0.0.0.0")`;
  await host.run(
    s.externalId,
    `mkdir -p /home/node/site && cd /home/node/site && printf %s ${JSON.stringify(server).replace(/\$/g, '\\$')} > server.mjs && printf %s '${page('Avant')}' > index.html`,
  );
  const command = watching('node server.mjs');
  check(
    command === 'node --watch server.mjs' && reloads(command),
    'a plain Node server runs under --watch',
  );
  await host.start(s.externalId, `cd /home/node/site && exec ${command}`);
  await new Promise((r) => setTimeout(r, 2500));
  const first = await host.run(s.externalId, 'curl -s http://127.0.0.1:4000/');
  check(first.stdout.includes('Avant'), 'the page answers');
  await host.run(
    s.externalId,
    `cd /home/node/site && printf %s '${page('Après')}' > index.html && touch server.mjs`,
  );
  await new Promise((r) => setTimeout(r, 2500));
  const second = await host.run(s.externalId, 'curl -s http://127.0.0.1:4000/');
  check(second.stdout.includes('Après'), 'an edit is served without restarting');

  const out = await host.run(
    s.externalId,
    shotCommand({ port: 4000, path: '/', device: 'mobile' }),
    {
      timeoutMs: 90_000,
    },
  );
  const shot = readShot(out.stdout);
  if (!shot.ok)
    log('capture said', {
      exit: out.exitCode,
      out: out.stdout.slice(0, 600),
      err: out.stderr.slice(-600),
    });
  check(shot.ok, 'the server captured its preview');
  if (shot.ok) {
    const bytes = Buffer.from(shot.image, 'base64');
    check(
      bytes[0] === 0xff && bytes[1] === 0xd8,
      `a JPEG of ${Math.round(bytes.length / 1024)} KB`,
    );
    log('answer', { status: shot.status, errors: shot.errors });
    check(
      shot.errors.some((e) => e.includes('visible error')),
      'the console error is reported',
    );
    if (process.env.SHOT_FILE) writeFileSync(process.env.SHOT_FILE, bytes);
  }
} finally {
  await host.destroy(s.externalId);
  log('server released');
}
