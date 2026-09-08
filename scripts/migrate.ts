import { config } from 'dotenv';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';
config({ path: '.env.local', quiet: true });
const pool = new Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('SELECT pg_advisory_lock(79132026)');
  await client.query('CREATE TABLE IF NOT EXISTS public.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const { app } = JSON.parse(readFileSync('.local/db-credentials.json', 'utf8'));
  const found = await client.query("SELECT 1 FROM pg_roles WHERE rolname='navair_app'");
  if (!found.rowCount) {
    const sql = await client.query("SELECT format('CREATE ROLE navair_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', $1::text) AS sql", [app]);
    await client.query(sql.rows[0].sql);
  }
  for (const file of readdirSync('db/migrations').filter(x => x.endsWith('.sql')).sort()) {
    if ((await client.query('SELECT 1 FROM public.schema_migrations WHERE name=$1', [file])).rowCount) continue;
    await client.query('BEGIN');
    try {
      await client.query(readFileSync(`db/migrations/${file}`, 'utf8'));
      await client.query('INSERT INTO public.schema_migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
} finally { await client.query('SELECT pg_advisory_unlock(79132026)'); client.release(); await pool.end(); }
