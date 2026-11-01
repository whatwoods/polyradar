// Local stand-in for production background work: the jobs Worker under
// wrangler dev, the extraction service the container would run, and the cron
// tick (wrangler dev doesn't fire crons on its own).
import { spawn } from 'node:child_process';

const PORT = 8787;
const run = (cmd, args, cwd) => {
  const p = spawn(cmd, args, { cwd, stdio: 'inherit' });
  p.on('exit', (code) => { console.log(`${cmd} exited (${code})`); process.exit(code ?? 1); });
  return p;
};

const children = [
  run('node', ['src/server.ts'], new URL('../../../packages/apidiff/', import.meta.url).pathname),
  run('npx', ['wrangler', 'dev', '--test-scheduled', '--port', String(PORT)], new URL('..', import.meta.url).pathname),
];
process.on('SIGINT', () => { for (const c of children) c.kill('SIGINT'); });

const tick = () => fetch(`http://localhost:${PORT}/__scheduled?cron=*+*+*+*+*`).catch(() => {});
setTimeout(() => { void tick(); setInterval(tick, 60_000); }, 8_000);
