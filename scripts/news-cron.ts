import { spawn } from 'node:child_process';
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

// Repeating sweep. Runs one ingest immediately, then every NEWS_SWEEP_HOURS (default 6).
// Deliberately a long-lived loop rather than a system crontab entry: it keeps the schedule
// beside the app, survives a laptop sleeping, and logs where every other service logs.

const hours = Math.min(24, Math.max(1, Number(process.env.NEWS_SWEEP_HOURS ?? 6)));
const interval = hours * 60 * 60 * 1000;
let stopping = false;
let child: ReturnType<typeof spawn> | null = null;

function stop() {
  stopping = true;
  child?.kill('SIGTERM');
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

function sweep(): Promise<void> {
  return new Promise((resolve) => {
    child = spawn(process.execPath, [new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url).pathname, 'scripts/news-ingest.ts'], { stdio: 'inherit' });
    child.once('exit', (code) => {
      if (code !== 0 && !stopping) console.error(`News sweep exited with code ${code}; the next sweep will still run.`);
      child = null;
      resolve();
    });
    child.once('error', (error) => { console.error(`News sweep could not start: ${error.message}`); child = null; resolve(); });
  });
}

console.log(`News sweeps every ${hours} hour${hours === 1 ? '' : 's'}. First sweep starting now.`);
while (!stopping) {
  const startedAt = new Date();
  await sweep();
  if (stopping) break;
  const next = new Date(startedAt.getTime() + interval);
  console.log(`Next news sweep at ${next.toISOString()}.`);
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, interval);
    process.once('SIGTERM', () => { clearTimeout(timer); resolve(undefined); });
    process.once('SIGINT', () => { clearTimeout(timer); resolve(undefined); });
  });
}
