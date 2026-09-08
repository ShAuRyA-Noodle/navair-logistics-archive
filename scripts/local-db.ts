import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const root = resolve('.local');
mkdirSync(root, { recursive: true, mode: 0o700 });
const data = join(root, 'postgres');
const bin = process.env.PG_BIN ?? '/opt/homebrew/opt/postgresql@16/bin';
const port = '55439';
const credentialsFile = join(root, 'db-credentials.json');
const credentials = existsSync(credentialsFile)
  ? JSON.parse(readFileSync(credentialsFile, 'utf8')) as { owner: string; app: string }
  : { owner: randomBytes(30).toString('hex'), app: randomBytes(30).toString('hex') };
writeFileSync(credentialsFile, JSON.stringify(credentials), { mode: 0o600 });
if (!existsSync(join(data, 'PG_VERSION'))) {
  const pwfile = join(root, 'pg-password');
  writeFileSync(pwfile, credentials.owner, { mode: 0o600 });
  execFileSync(join(bin, 'initdb'), ['-D', data, '-U', 'navair_owner', '--auth=scram-sha-256', `--pwfile=${pwfile}`, '--encoding=UTF8', '--locale=C'], { stdio: 'pipe' });
}
try { execFileSync(join(bin, 'pg_ctl'), ['-D', data, 'status'], { stdio: 'pipe' }); }
catch { execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-p ${port} -h 127.0.0.1`, 'start'], { stdio: 'pipe' }); }
const env = { ...process.env, PGPASSWORD: credentials.owner };
const pgArgs = ['-h', '127.0.0.1', '-p', port, '-U', 'navair_owner'];
try { execFileSync(join(bin, 'createdb'), [...pgArgs, 'navair_local'], { env, stdio: 'pipe' }); }
catch {
  execFileSync(join(bin, 'psql'), [...pgArgs, '-d', 'navair_local', '-c', 'SELECT 1'], { env, stdio: 'pipe' });
}
if (!existsSync('.env.local')) {
  writeFileSync('.env.local', [
    `ADMIN_DATABASE_URL=postgresql://navair_owner:${credentials.owner}@127.0.0.1:${port}/navair_local`,
    `DATABASE_URL=postgresql://navair_app:${credentials.app}@127.0.0.1:${port}/navair_local`,
    'APP_URL=http://127.0.0.1:3000', 'LOCAL_DEMO_MODE=true', 'MAIL_MODE=preview',
    'BUSINESS_EMAIL=operations@navair.example', 'MAIL_FROM=Navair Logistics <enquiries@navair.example>', ''
  ].join('\n'), { mode: 0o600 });
}
console.log('Isolated Navair PostgreSQL is running on 127.0.0.1:55439. Local configuration saved.');
