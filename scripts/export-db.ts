import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';

const REDACTED_COLUMNS = new Set(['token_hash', 'token', 'secret', 'password_hash']);

function csvCell(value: unknown) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString()
    : typeof value === 'object' ? JSON.stringify(value)
    : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(columns: string[], rows: Record<string, unknown>[]) {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvCell(REDACTED_COLUMNS.has(column) ? '[redacted]' : row[column])).join(','));
  return `${lines.join('\n')}\n`;
}

const connectionString = process.env.ADMIN_DATABASE_URL;
if (!connectionString) throw new Error('ADMIN_DATABASE_URL is required to export the database.');

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const directory = join('exports', `db-${stamp}`);
await mkdir(directory, { recursive: true });

const client = new Client({ connectionString });
await client.connect();
try {
  const tables = (await client.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
  )).rows.map((row) => row.table_name);

  const manifest: Array<{ table: string; rows: number; columns: number; file: string }> = [];
  for (const table of tables) {
    const result = await client.query(`SELECT * FROM public.${client.escapeIdentifier(table)}`);
    const columns = result.fields.map((field) => field.name);
    await writeFile(join(directory, `${table}.csv`), csv(columns, result.rows));
    manifest.push({ table, rows: result.rowCount ?? 0, columns: columns.length, file: `${table}.csv` });
  }
  await writeFile(join(directory, '_manifest.csv'), csv(['table', 'rows', 'columns', 'file'], manifest));
  console.table(manifest);
  console.log(`Exported ${manifest.length} tables to ${directory}`);
} finally {
  await client.end();
}
