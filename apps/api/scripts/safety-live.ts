/**
 * A project server's safety nets for real (D-031), on a throwaway Agent37 server:
 *   private preview (no key → refused, signed link → served) → limited network (registry reached,
 *   another site refused, the refusal recognized) → backup, a file changed, restore → file back →
 *   server released. Prints what it sees, never a key.
 *
 *   node --env-file=../../../.secrets/.admin.env --import tsx scripts/safety-live.ts
 */
import { blockedByNetwork } from '../src/features/servers/safety.js';
import { agent37Account, agent37Host } from '../src/infrastructure/providers/agent37.js';

const key = process.env.AGENT37_API_KEY;
if (!key) throw new Error('AGENT37_API_KEY is required.');
const host = agent37Host({ apiKey: key, fetch });
const t0 = Date.now();
const log = (step: string, detail: unknown = '') =>
  console.log(
    `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${step}`,
    typeof detail === 'string' ? detail : JSON.stringify(detail),
  );
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  log(`ok  ${what}`);
};

const { balanceMicros } = await agent37Account({ apiKey: key, fetch })();
log('wallet', `${(balanceMicros / 1e6).toFixed(2)} USD`);

const server = await host.create({
  name: 'pono-safety-probe',
  agent: 'none',
  env: {},
  metadata: { probe: 'safety' },
  budgetMicros: 500_000,
  idleSeconds: 900,
});
const id = server.externalId;
log('server', { id, status: server.status });
try {
  for (let i = 0; i < 60 && (await host.get(id))?.status !== 'running'; i++) await sleep(3000);
  check((await host.get(id))?.status === 'running', 'the server runs');

  // 1. Private preview.
  await host.start(
    id,
    `node -e "require('http').createServer((q,s)=>s.end('pono-ok')).listen(4000,'0.0.0.0')"`,
  );
  await sleep(3000);
  const bare = await fetch(`https://${id}-4000.agent37.app/`, { redirect: 'manual' });
  check(bare.status === 401 || bare.status === 403, `no link, no preview (${bare.status})`);
  const link = await host.previewLink!(id, 4000, 120);
  const opened = await fetch(link.url);
  const body = await opened.text();
  check(opened.status === 200 && body.includes('pono-ok'), 'the signed link serves the preview');
  log('link expires', link.expiresAt.toISOString());

  // 2. Limited network.
  const probe = (url: string) =>
    host.run(
      id,
      `node -e "fetch('${url}').then(r=>console.log('status',r.status)).catch(e=>console.log('error',e.cause&&e.cause.code||e.message))"`,
      { timeoutMs: 60_000 },
    );
  await host.setNetwork!(id, { allow: ['registry.npmjs.org', ...(host.networkNeeds ?? [])] });
  await sleep(3000);
  const allowed = await probe('https://registry.npmjs.org/');
  check(
    allowed.stdout.includes('status 200'),
    `an allowed domain answers (${allowed.stdout.trim()})`,
  );
  const refused = await probe('https://example.com/');
  log('a domain not listed', refused.stdout.trim());
  check(!refused.stdout.includes('status 200'), 'a domain not listed is refused');
  check(blockedByNetwork(refused.stdout), 'Pono recognizes the refusal');
  await host.setNetwork!(id, 'open');
  await sleep(3000);
  const reopened = await probe('https://example.com/');
  check(reopened.stdout.includes('status 200'), 'reopened, the site answers');

  // 3. Backup and restore.
  await host.run(id, 'echo before > /home/node/pono-marker.txt');
  const backup = await host.backups!.create(id);
  log('backup', { id: backup.id, kind: backup.kind, mb: Math.round(backup.sizeBytes / 1e6) });
  const listed = await host.backups!.list(id);
  check(
    listed.some((b) => b.id === backup.id),
    'the backup is listed',
  );
  await host.run(id, 'echo after > /home/node/pono-marker.txt');
  const r0 = Date.now();
  await host.backups!.restore(id, backup.id);
  log('restored in', `${((Date.now() - r0) / 1000).toFixed(0)} s`);
  for (let i = 0; i < 60 && (await host.get(id))?.status !== 'running'; i++) await sleep(3000);
  const marker = await host.run(id, 'cat /home/node/pono-marker.txt');
  check(marker.stdout.trim() === 'before', 'the file is back as it was');
} finally {
  await host.destroy(id);
  log('server released');
}
