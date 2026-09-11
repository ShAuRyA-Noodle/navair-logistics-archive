import { config } from 'dotenv';
import { Pool } from 'pg';
config({ path: '.env.local', quiet: true });
import { classify, isWorthKeeping, type ScoredItem } from '../src/lib/news/relevance';
import { anomalousReadings, fetchFederalRegister, fetchGdelt, readChokepoints, readingToItem } from '../src/lib/news/sources';
import { clusterItems } from '../src/lib/news/clustering';

// Ingest sweep. Fetch, gate, cluster, store. Deliberately no model call: this job decides
// what is real news, and a later step decides what it means. Safe to run repeatedly - items
// are keyed by source and external id, events by slug.

const db = new Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const verbose = process.argv.includes('--verbose');

async function main() {
  const started = Date.now();
  const collected: ScoredItem[] = [];
  const notes: string[] = [];

  for (const [label, load] of [
    ['GDELT', async () => fetchGdelt({ sinceDays: 5 })],
    ['Federal Register', async () => fetchFederalRegister({ sinceDays: 21 })],
  ] as const) {
    try {
      const raw = await load();
      const scored = raw.map(classify);
      const kept = scored.filter(isWorthKeeping);
      collected.push(...kept);
      notes.push(`${label}: fetched ${raw.length}, kept ${kept.length}`);
    } catch (error) {
      notes.push(`${label}: unavailable (${error instanceof Error ? error.message : 'unknown error'})`);
    }
  }

  try {
    const readings = await readChokepoints();
    const anomalies = anomalousReadings(readings);
    const scored = anomalies.map((reading) => classify(readingToItem(reading)));
    collected.push(...scored);
    notes.push(`IMF PortWatch: read ${readings.length} chokepoints, ${anomalies.length} moved beyond their baseline`);
    if (verbose) {
      for (const reading of readings) {
        console.log(`   ${reading.chokepoint.padEnd(24)} recent ${String(reading.recentMean).padStart(6)} vs median ${String(reading.baselineMedian).padStart(6)} → ${(reading.changeRatio * 100).toFixed(0)}%`);
      }
    }
  } catch (error) {
    notes.push(`IMF PortWatch: unavailable (${error instanceof Error ? error.message : 'unknown error'})`);
  }

  for (const note of notes) console.log(`  ${note}`);
  if (collected.length === 0) {
    console.log('Nothing passed the relevance gates this sweep.');
    return;
  }

  const clusters = clusterItems(collected);
  const client = await db.connect();
  let newEvents = 0;
  let newItems = 0;
  try {
    await client.query('BEGIN');
    for (const cluster of clusters) {
      const event = (await client.query(
        `INSERT INTO news_events(slug,title,summary,topics,regions,chokepoints,corridors,importance,item_count,first_seen,last_seen)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT(slug) DO UPDATE SET
           last_seen=greatest(news_events.last_seen,excluded.last_seen),
           item_count=excluded.item_count,
           importance=excluded.importance,
           corridors=excluded.corridors,
           summary=excluded.summary
         RETURNING id,(xmax=0) AS inserted`,
        [cluster.slug, cluster.title, cluster.summary, cluster.topics, cluster.regions,
          cluster.chokepoints, cluster.corridors, cluster.importance, cluster.items.length,
          cluster.firstSeen, cluster.lastSeen],
      )).rows[0];
      if (event.inserted) newEvents += 1;
      for (const item of cluster.items) {
        const stored = await client.query(
          `INSERT INTO news_items(source_key,external_id,url,title,summary,published_at,topics,regions,chokepoints,relevance,trust,event_id,measurement)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT(source_key,external_id) DO UPDATE SET event_id=excluded.event_id
           RETURNING (xmax=0) AS inserted`,
          [item.sourceKey, item.externalId, item.url, item.title, item.summary, item.publishedAt,
            item.topics, item.regions, item.chokepoints, item.relevance, item.trust, event.id,
            item.measurement ? JSON.stringify(item.measurement) : null],
        );
        if (stored.rows[0]?.inserted) newItems += 1;
      }
    }
    // An event nobody has written about for a fortnight is history, not intelligence.
    const archived = await client.query(
      "UPDATE news_events SET status='archived' WHERE status='active' AND last_seen < now() - interval '14 days'",
    );
    await client.query('COMMIT');
    console.log(`\n${clusters.length} event${clusters.length === 1 ? '' : 's'} in this sweep (${newEvents} new), ${collected.length} qualifying item${collected.length === 1 ? '' : 's'} (${newItems} new), ${archived.rowCount ?? 0} archived.`);
    console.log(`Completed in ${((Date.now() - started) / 1000).toFixed(1)}s.\n`);
    for (const cluster of clusters.slice(0, 8)) {
      console.log(`  [${String(cluster.importance).padStart(2)}] ${cluster.title.slice(0, 84)}`);
      console.log(`       ${cluster.items.length} item(s) · ${cluster.topics.join(', ') || 'no topic'} · corridors: ${cluster.corridors.join(', ') || 'none'}`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

try {
  await main();
} finally {
  await db.end();
}
