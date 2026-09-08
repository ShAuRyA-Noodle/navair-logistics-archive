import { readFile } from 'node:fs/promises';
import { config } from 'dotenv';
import { importData } from '../src/lib/data-import';

config({ path: '.env.local', quiet: true });
const path = process.argv[2];
const actorId = process.env.ACTOR_ID ?? (process.env.LOCAL_DEMO_MODE === 'true' ? '10000000-0000-4000-8000-000000000001' : undefined);
if (!path) throw new Error('Usage: tsx scripts/import-data.ts <payload.json>');
if (!actorId) throw new Error('ACTOR_ID is required outside LOCAL_DEMO_MODE.');
const payload = JSON.parse(await readFile(path, 'utf8')) as unknown;
console.log(JSON.stringify(await importData(actorId, payload)));
