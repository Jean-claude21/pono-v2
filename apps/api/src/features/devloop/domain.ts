/**
 * The dev loop (D-020), pure: how a project runs on its server, and the shell commands Pono sends
 * there. No provider name, no network: the service runs these through the server host's port.
 */

export interface DevPlan {
  install: string | null;
  command: string;
  port: number;
}

/** Single-quotes a value for sh. */
export const q = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/** The folder the repository lives in on the server. */
export const workdir = (repository: string): string =>
  `$HOME/work/${repository
    .split('/')
    .pop()!
    .replace(/[^\w.-]/g, '-')}`;

const PONO = '.pono';

/**
 * How the project runs in development: `dev:` in pono.yaml first; otherwise read from package.json
 * (its `dev` script, its package manager by lockfile, its port). Null when nothing says it.
 */
/**
 * A plain Node server reads its files once (D-038): run under `node --watch`, it restarts by
 * itself when one changes, like a framework's dev server does.
 */
export function watching(command: string): string {
  return /^node\s/.test(command) && !/--watch\b/.test(command)
    ? command.replace(/^node\s+/, 'node --watch ')
    : command;
}

/** Whether the preview follows file changes by itself, or needs start_dev again (D-038). */
export function reloads(command: string | null): boolean {
  return Boolean(
    command &&
    /\b(vite|next|nuxt|astro|remix|svelte-kit|webpack-dev-server|nodemon|tsx watch|run dev)\b|--watch\b/.test(
      command,
    ),
  );
}

export function devPlan(input: {
  manifestDev?: { install?: string | undefined; command: string; port: number } | undefined;
  packageJson: string | null;
  files: string[];
}): DevPlan | null {
  if (input.manifestDev)
    return {
      install: input.manifestDev.install ?? null,
      command: watching(input.manifestDev.command),
      port: input.manifestDev.port,
    };
  if (!input.packageJson) return null;
  let pkg: { scripts?: Record<string, string>; packageManager?: string };
  try {
    pkg = JSON.parse(input.packageJson) as typeof pkg;
  } catch {
    return null;
  }
  const script = pkg.scripts?.dev;
  if (!script) return null;
  const pinned = pkg.packageManager?.match(/^(pnpm|yarn|npm)@([\w.-]+)/);
  const manager = input.files.includes('pnpm-lock.yaml')
    ? 'pnpm'
    : input.files.includes('yarn.lock')
      ? 'yarn'
      : (pinned?.[1] ?? 'npm');
  const version = pinned?.[1] === manager ? pinned[2] : manager === 'pnpm' ? '10' : '1';
  const run = manager === 'npm' ? 'npm' : `npx --yes ${manager}@${version}`;
  const install =
    manager === 'npm'
      ? 'npm install --no-audit --no-fund'
      : manager === 'pnpm'
        ? `${run} install --config.confirmModulesPurge=false`
        : `${run} install`;
  const port = Number(
    script.match(/--port[= ](\d{2,5})/)?.[1] ?? (/\bvite\b/.test(script) ? 5173 : 3000),
  );
  // Reachable from outside the server: the address the dev server listens on.
  const host = /\bvite\b/.test(script)
    ? ' --host 0.0.0.0'
    : /\bnext\b/.test(script)
      ? ' -H 0.0.0.0'
      : '';
  const extra = manager === 'npm' && host ? ` --${host}` : host;
  return { install, command: `${run} run dev${extra}`, port };
}

/** Clones or fetches the repository and stands on `dev`; prints what Pono needs to plan. */
export function prepareCommand(input: {
  repository: string;
  url: string;
  header: string;
  defaultBranch: string;
  author: { name: string; email: string };
}): string {
  const dir = workdir(input.repository);
  const git = `git -c http.extraHeader=${q(input.header)}`;
  return [
    'set -e',
    'mkdir -p "$HOME/work"',
    `if [ ! -d "${dir}/.git" ]; then ${git} clone --quiet ${q(input.url)} "${dir}"; fi`,
    `cd "${dir}"`,
    `${git} fetch --quiet origin`,
    'if git show-ref --verify --quiet refs/heads/dev; then git checkout --quiet dev;',
    'elif git show-ref --verify --quiet refs/remotes/origin/dev; then git checkout --quiet -b dev origin/dev;',
    `else git checkout --quiet -b dev origin/${input.defaultBranch}; fi`,
    `git config user.name ${q(input.author.name)}`,
    `git config user.email ${q(input.author.email)}`,
    `mkdir -p ${PONO}`,
    `grep -qx '${PONO}/' .git/info/exclude 2>/dev/null || echo '${PONO}/' >> .git/info/exclude`,
    "echo '<<<files>>>'; ls -a",
    "echo '<<<package>>>'; head -c 60000 package.json 2>/dev/null || true",
    "echo '<<<manifest>>>'; head -c 60000 pono.yaml 2>/dev/null || true",
  ].join('\n');
}

/** Reads what `prepareCommand` printed. */
export function readPrepared(stdout: string): {
  files: string[];
  packageJson: string | null;
  manifest: string | null;
} {
  const part = (name: string) => {
    const start = stdout.indexOf(`<<<${name}>>>`);
    if (start < 0) return '';
    const rest = stdout.slice(start + name.length + 7);
    const next = rest.indexOf('<<<');
    return (next < 0 ? rest : rest.slice(0, next)).replace(/^\n/, '');
  };
  const pkg = part('package').trim();
  const manifest = part('manifest').trim();
  return {
    files: part('files')
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean),
    packageJson: pkg || null,
    manifest: manifest || null,
  };
}

/**
 * Starts the dev server in the background: install, then the command in its own process group,
 * with its phase and logs under `.pono/`. Hosts that check their name accept the published one.
 */
export function startCommand(input: {
  repository: string;
  plan: DevPlan;
  hostSuffix: string | null;
}): string {
  const dir = workdir(input.repository);
  const env = [
    `PORT=${input.plan.port}`,
    'HOST=0.0.0.0',
    ...(input.hostSuffix ? [`__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=${q(input.hostSuffix)}`] : []),
  ].join(' ');
  const install = input.plan.install
    ? `{ (${input.plan.install}) > ${PONO}/install.log 2>&1 || { echo install_failed > ${PONO}/phase; exit 1; }; } && `
    : '';
  const run = [
    `cd "${dir}"`,
    `echo installing > ${PONO}/phase`,
    `${install}echo starting > ${PONO}/phase`,
    `export ${env}`,
  ].join(' && ');
  // A dev server that exits by itself has crashed; one stopped by Pono writes `stopped` first.
  return `${run} && { setsid sh -c ${q(`echo $$ > ${PONO}/dev.pid; exec ${input.plan.command}`)} > ${PONO}/dev.log 2>&1; [ "$(cat ${PONO}/phase)" = stopped ] || echo crashed > ${PONO}/phase; }`;
}

/** Stops the dev server: its whole process group. */
export function stopCommand(repository: string): string {
  const dir = workdir(repository);
  return `cd "${dir}" 2>/dev/null || exit 0; echo stopped > ${PONO}/phase; if [ -f ${PONO}/dev.pid ]; then kill -- -$(cat ${PONO}/dev.pid) 2>/dev/null || kill $(cat ${PONO}/dev.pid) 2>/dev/null; rm -f ${PONO}/dev.pid; fi; echo stopped > ${PONO}/phase; true`;
}

export type DevPhase =
  'absent' | 'installing' | 'install_failed' | 'starting' | 'running' | 'crashed' | 'stopped';

/** The phase, whether the process lives, what the port answers, and the logs' last lines. */
export function statusCommand(repository: string, port: number, lines = 20): string {
  const dir = workdir(repository);
  return [
    `cd "${dir}" 2>/dev/null || { echo '<<<phase>>>'; echo absent; exit 0; }`,
    `echo '<<<phase>>>'; cat ${PONO}/phase 2>/dev/null || echo absent`,
    `echo '<<<alive>>>'; P=$(cat ${PONO}/dev.pid 2>/dev/null); if [ -n "$P" ] && kill -0 "$P" 2>/dev/null; then echo yes; else echo no; fi`,
    `echo '<<<http>>>'; node -e "fetch('http://127.0.0.1:${port}/',{signal:AbortSignal.timeout(4000)}).then(r=>console.log(r.status)).catch(()=>console.log(0))"`,
    `echo '<<<branch>>>'; git rev-parse --abbrev-ref HEAD; git rev-parse --short HEAD; git status --porcelain | wc -l`,
    `echo '<<<logs>>>'; tail -n ${lines} ${PONO}/install.log 2>/dev/null; tail -n ${lines} ${PONO}/dev.log 2>/dev/null; true`,
  ].join('\n');
}

export interface DevState {
  phase: DevPhase;
  alive: boolean;
  http: number;
  branch: string | null;
  commit: string | null;
  changedFiles: number;
  logs: string;
}

export function readStatus(stdout: string): DevState {
  const part = (name: string) => {
    const start = stdout.indexOf(`<<<${name}>>>`);
    if (start < 0) return '';
    const rest = stdout.slice(start + name.length + 7);
    const next = rest.indexOf('<<<');
    return (next < 0 ? rest : rest.slice(0, next)).replace(/^\n/, '');
  };
  const raw = part('phase').trim();
  const alive = part('alive').trim() === 'yes';
  const known: DevPhase[] = [
    'absent',
    'installing',
    'install_failed',
    'starting',
    'running',
    'crashed',
    'stopped',
  ];
  let phase: DevPhase = known.includes(raw as DevPhase) ? (raw as DevPhase) : 'absent';
  const http = Number(part('http').trim()) || 0;
  if (phase === 'starting' && alive && http > 0) phase = 'running';
  const [branch, commit, changed] = part('branch').trim().split('\n');
  return {
    phase,
    alive,
    http,
    branch: branch || null,
    commit: commit || null,
    changedFiles: Number(changed) || 0,
    logs: part('logs').trimEnd(),
  };
}

/** Pulls what was pushed to `dev` elsewhere (the person's own agent, on their machine). */
export function pullCommand(repository: string, header: string): string {
  return `cd "${workdir(repository)}" && git -c http.extraHeader=${q(header)} pull --ff-only --quiet origin dev 2>&1 && git rev-parse --short HEAD`;
}

/** Stages every change and prints the staged files, each with its content, as JSON lines. */
export function stagedCommand(repository: string): string {
  return [
    `cd "${workdir(repository)}"`,
    'git add -A',
    `node -e ${q(
      "const {execSync}=require('child_process');const fs=require('fs');" +
        "const names=execSync('git diff --cached --name-only --diff-filter=ACMR',{encoding:'utf8'}).split('\\n').filter(Boolean);" +
        "for(const path of names){let content='';try{const b=fs.readFileSync(path);content=b.includes(0)?'':b.subarray(0,300000).toString('utf8')}catch{}console.log(JSON.stringify({path,content}))}",
    )}`,
  ].join(' && ');
}

/** Commits the staged changes and pushes them to `dev`, never elsewhere. */
export function pushCommand(repository: string, header: string, message: string): string {
  return [
    `cd "${workdir(repository)}"`,
    'test "$(git rev-parse --abbrev-ref HEAD)" = dev',
    `git commit --quiet -m ${q(message)}`,
    `git -c http.extraHeader=${q(header)} push --quiet origin dev 2>&1`,
    'git rev-parse --short HEAD',
  ].join(' && ');
}

/** Hides every development value that could appear in a log line (D-007). */
export function redact(text: string, values: string[]): string {
  let out = text;
  for (const v of values) if (v.length >= 6) out = out.split(v).join('••••');
  return out;
}
