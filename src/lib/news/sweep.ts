import type { Pool } from 'pg';
import { classify, isWorthKeeping, type ScoredItem } from './relevance';
import { anomalousReadings, fetchFederalRegister, fetchGdelt, fetchGuardian, fetchIndiaTrade, fetchNewsApi, fetchNewYorkTimes, readChokepoints, readingToItem } from './sources';
import { clusterItems } from './clustering';
import { analyseEventCorridors, AnalysisUnavailable, summariseForIndia } from './analysis';

// One sweep: fetch, gate, cluster, store, then analyse a bounded batch.
//
// Written as a library because it runs in two very different places. Locally it is a script
// with minutes to spare. On Vercel it is a cron-triggered function with a hard wall-clock
// limit, so the analysis batch is small and each run picks up where the last left off -
// already-analysed (event, corridor) pairs are skipped, so progress accumulates.

export type SweepOptions = {
  pool: Pool;
  maxAnalyses?: number;
  minImportance?: number;
  /** Stop starting new analyses once this many milliseconds have elapsed. */
  budgetMs?: number;
  onProgress?: (line: string) => void;
};

export type SweepResult = {
  notes: string[];
  events: number;
  newEvents: number;
  items: number;
  newItems: number;
  archived: number;
  analysed: number;
  cached: number;
  notesWritten: number;
  refused: string[];
  elapsedMs: number;
};

const FAILURE_LIMIT = 5;

export async function runSweep(options: SweepOptions): Promise<SweepResult> {
  const started = Date.now();
  const log = options.onProgress ?? (() => undefined);
  const maxAnalyses = options.maxAnalyses ?? 8;
  const minImportance = options.minImportance ?? 5;
  const budgetMs = options.budgetMs ?? Number.POSITIVE_INFINITY;
  const collected: ScoredItem[] = [];
  const notes: string[] = [];

  for (const [label, load] of [
    ['GDELT', async () => fetchGdelt({ sinceDays: 5 })],
    ['Guardian', async () => fetchGuardian({ sinceDays: 5 })],
    ['New York Times', async () => fetchNewYorkTimes({ sinceDays: 7 })],
    ['NewsAPI', async () => fetchNewsApi({ sinceDays: 5 })],
    ['India trade desk', async () => fetchIndiaTrade({ sinceDays: 7 })],
    ['Federal Register', async () => fetchFederalRegister({ sinceDays: 21 })],
  ] as const) {
    try {
      const raw = await load();
      const kept = raw.map(classify).filter(isWorthKeeping);
      collected.push(...kept);
      notes.push(`${label}: fetched ${raw.length}, kept ${kept.length}`);
    } catch (error) {
      notes.push(`${label}: unavailable (${error instanceof Error ? error.message : 'unknown error'})`);
    }
  }

  try {
    const readings = await readChokepoints();
    const anomalies = anomalousReadings(readings);
    collected.push(...anomalies.map((reading) => classify(readingToItem(reading))));
    notes.push(`IMF PortWatch: read ${readings.length} chokepoints, ${anomalies.length} moved beyond their baseline`);
  } catch (error) {
    notes.push(`IMF PortWatch: unavailable (${error instanceof Error ? error.message : 'unknown error'})`);
  }

  for (const note of notes) log(`  ${note}`);

  const blank: SweepResult = { notes, events: 0, newEvents: 0, items: collected.length, newItems: 0, archived: 0, analysed: 0, cached: 0, notesWritten: 0, refused: [], elapsedMs: Date.now() - started };
  if (collected.length === 0) return blank;

  const clusters = clusterItems(collected);
  const client = await options.pool.connect();
  let newEvents = 0;
  let newItems = 0;
  let archived = 0;
  try {
    await client.query('BEGIN');
    for (const cluster of clusters) {
      const event = (await client.query(
        `INSERT INTO news_events(slug,title,summary,topics,regions,chokepoints,corridors,importance,item_count,first_seen,last_seen)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT(slug) DO UPDATE SET
           last_seen=greatest(news_events.last_seen,excluded.last_seen),
           item_count=excluded.item_count, importance=excluded.importance,
           corridors=excluded.corridors, summary=excluded.summary
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
    // Older events are labelled, never hidden. The feed reads chronologically and shows
    // them under their own date, because a trade desk wants the record, not just today.
    const aged = await client.query("UPDATE news_events SET status='archived' WHERE status='active' AND last_seen < now() - interval '30 days'");
    archived = aged.rowCount ?? 0;
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    throw error;
  }

  let analysed = 0;
  let cached = 0;
  let notesWritten = 0;
  let consecutiveFailures = 0;
  const refused: string[] = [];
  try {
    // Quiet events matter too: a minor customs circular gets one line on what it means for
    // India rather than sitting in the feed as a bare headline. This runs for everything
    // that does not have a note yet, newest first.
    const pending = (await client.query(
      `SELECT e.id, e.slug, e.title, e.summary, e.topics
       FROM news_events e WHERE e.india_note IS NULL
       ORDER BY e.last_seen DESC LIMIT $1`,
      [Number(process.env.NEWS_MAX_NOTES ?? 25)],
    )).rows;
    for (const event of pending) {
      if (Date.now() - started > budgetMs) break;
      const cluster = clusters.find((candidate) => candidate.slug === event.slug);
      try {
        const note = await summariseForIndia({
          title: event.title,
          summary: event.summary ?? '',
          topics: event.topics ?? [],
          articles: (cluster?.items ?? []).map((item) => ({ title: item.title, summary: item.summary, sourceKey: item.sourceKey })),
        });
        await client.query(
          'UPDATE news_events SET india_note=$2, india_note_model=$3, india_note_at=now() WHERE id=$1',
          [event.id, note.note, note.model],
        );
        notesWritten += 1;
        // Pace the calls: the free allowance is per minute, and a burst wastes it on 429s.
        await new Promise((resolve) => setTimeout(resolve, Number(process.env.NEWS_NOTE_DELAY_MS ?? 1200)));
      } catch (error) {
        if (!(error instanceof AnalysisUnavailable)) throw error;
        refused.push(`note for ${String(event.slug).slice(0, 40)}: ${error.message}`);
        if (error.message.includes('not configured')) break;
      }
    }
    for (const cluster of clusters) {
      if (analysed >= maxAnalyses || Date.now() - started > budgetMs) break;
      if (cluster.importance < minImportance || cluster.corridors.length === 0) continue;
      const stored = (await client.query('SELECT id FROM news_events WHERE slug=$1', [cluster.slug])).rows[0];
      if (!stored) continue;

      // Only the corridors that do not already have a briefing, and all of them in one call.
      const done = (await client.query('SELECT corridor FROM event_impacts WHERE event_id=$1', [stored.id])).rows.map((row) => row.corridor as string);
      const todo = cluster.corridors.filter((corridor) => !done.includes(corridor));
      cached += done.length;
      if (todo.length === 0) continue;

      try {
        const written = await analyseEventCorridors({
          corridors: todo,
          event: { title: cluster.title, summary: cluster.summary, topics: cluster.topics, chokepoints: cluster.chokepoints, importance: cluster.importance },
          articles: cluster.items.map((item) => ({ title: item.title, sourceKey: item.sourceKey, url: item.url, publishedAt: item.publishedAt, summary: item.summary })),
          measurements: cluster.items.map((item) => item.measurement).filter((value): value is Record<string, unknown> => Boolean(value)),
        });
        for (const analysis of written) {
          await client.query(
            `INSERT INTO event_impacts(event_id,corridor,severity,headline,teaser,body,actions,confidence,citations,model,detail)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT(event_id,corridor) DO NOTHING`,
            [stored.id, analysis.corridor, analysis.severity, analysis.headline, analysis.teaser, analysis.body,
              JSON.stringify(analysis.actions), analysis.confidence, JSON.stringify(analysis.citations), analysis.model,
              JSON.stringify({ bullets: analysis.bullets, keyNumbers: analysis.keyNumbers, outlook: analysis.outlook })],
          );
        }
        analysed += written.length;
        consecutiveFailures = 0;
        log(`  analysed ${written.length}/${todo.length} corridors · ${cluster.title.slice(0, 48)}`);
        // The free allowance is per minute; pacing beats collecting 429s.
        await new Promise((resolve) => setTimeout(resolve, Number(process.env.NEWS_ANALYSIS_DELAY_MS ?? 8000)));
      } catch (error) {
        if (!(error instanceof AnalysisUnavailable)) throw error;
        refused.push(`${cluster.slug.slice(0, 40)}: ${error.message}`);
        consecutiveFailures += 1;
        if (error.message.includes('not configured') || consecutiveFailures >= FAILURE_LIMIT) break;
      }
    }
  } finally {
    client.release();
  }

  return {
    notes, events: clusters.length, newEvents, items: collected.length, newItems,
    archived, analysed, cached, notesWritten, refused, elapsedMs: Date.now() - started,
  };
}
