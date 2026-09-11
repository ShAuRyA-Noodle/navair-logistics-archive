import { config } from 'dotenv';
import { Pool } from 'pg';
config({ path: '.env.local', quiet: true });
import { runSweep } from '../src/lib/news/sweep';

// Local entry point. The sweep itself lives in src/lib/news/sweep.ts so the Vercel cron
// route runs exactly the same code path.

const db = new Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
try {
  const result = await runSweep({
    pool: db,
    maxAnalyses: Number(process.env.NEWS_MAX_ANALYSES ?? 45),
    minImportance: Number(process.env.NEWS_MIN_IMPORTANCE ?? 5),
    onProgress: (line) => console.log(line),
  });
  console.log(`\n${result.events} events (${result.newEvents} new), ${result.items} qualifying items (${result.newItems} new), ${result.archived} archived.`);
  console.log(`analysis: ${result.analysed} written, ${result.cached} already cached${result.refused.length ? `, ${result.refused.length} refused` : ''}`);
  for (const line of result.refused.slice(0, 3)) console.log(`  ${line}`);
  console.log(`Completed in ${(result.elapsedMs / 1000).toFixed(1)}s.`);
} finally {
  await db.end();
}
