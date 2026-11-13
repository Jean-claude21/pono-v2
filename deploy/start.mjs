// Starts Pono in its image (D-024): migrations as the owner role, then the API and the console.
// When either process ends, the other is stopped and the container exits, so the host restarts it.
import { spawn } from 'node:child_process';

function run(name, command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => {
    console.log(`${name} ended (${signal ?? code})`);
    for (const other of children) if (other !== child) other.kill('SIGTERM');
    process.exitCode = code ?? 1;
  });
  return child;
}

const children = [];

if (process.env.PONO_DATABASE_OWNER_URL) {
  const code = await new Promise((resolve) => {
    const migrate = spawn('pnpm', ['--filter', '@pono/api', 'db:migrate'], {
      stdio: 'inherit',
      env: process.env,
    });
    migrate.on('exit', resolve);
  });
  if (code !== 0) {
    console.error('Migrations failed: Pono does not start.');
    process.exit(1);
  }
}

children.push(run('api', 'pnpm', ['exec', 'tsx', 'src/main.ts'], 'apps/api'));
children.push(run('console', 'pnpm', ['start'], 'apps/web'));

for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
