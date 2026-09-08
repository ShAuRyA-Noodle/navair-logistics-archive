import { ChildProcess, spawn } from 'node:child_process';

const npmCli: string = process.env.npm_execpath ?? '';
if (!npmCli) throw new Error('npm_execpath is required to start the local services. Run this script through npm.');

const children: ChildProcess[] = [];
let stopping = false;

function hasExited(child: ChildProcess) {
  return !child.pid || child.exitCode !== null || child.signalCode !== null;
}

function start(name: 'dev' | 'worker') {
  const child = spawn(process.execPath, [npmCli, 'run', name], {
    stdio: 'inherit',
    env: process.env,
    detached: process.platform !== 'win32',
  }) as ChildProcess;
  children.push(child);
  child.once('error', () => { void shutdown(1); });
  child.once('exit', (code, signal) => {
    if (!stopping) {
      if (code !== 0) console.error(`Local ${name} process exited (${signal ?? code}).`);
      void shutdown(code ?? 1);
    }
  });
}

function stop(child: ChildProcess, signal: NodeJS.Signals) {
  const pid = child.pid;
  if (!pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-pid, signal);
  } catch { /* The child finished between the exit check and signal. */ }
}

async function shutdown(exitCode: number) {
  if (stopping) return;
  stopping = true;
  const exited = Promise.all(children.map((child) => new Promise<void>((resolve) => {
    if (hasExited(child)) resolve();
    else {
      child.once('exit', () => resolve());
      child.once('error', () => resolve());
    }
  })));
  for (const child of children) stop(child, 'SIGTERM');
  const force = setTimeout(() => { for (const child of children) stop(child, 'SIGKILL'); }, 5_000);
  force.unref();
  await exited;
  clearTimeout(force);
  process.exitCode = exitCode;
}

process.once('SIGINT', () => { void shutdown(0); });
process.once('SIGTERM', () => { void shutdown(0); });

start('dev');
start('worker');
