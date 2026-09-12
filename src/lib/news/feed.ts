import { z } from 'zod';
import { withActor } from '../db';
import { AppError } from '../errors';

// Reading side of the trade feed. Two shapes on purpose: a teaser anybody may read, and
// the full analysis for a signed-in account. The split is enforced here and by the row
// policy on event_impacts, not by the browser hiding a field it already downloaded.

export type KeyNumber = { label: string; value: string; source: string };
export type FeedCard = {
  slug: string;
  title: string;
  summary: string;
  importance: number;
  topics: string[];
  corridors: string[];
  chokepoints: string[];
  lastSeen: string;
  severity: 'none' | 'watch' | 'elevated' | 'severe' | null;
  corridorCount: number;
  teaser: string | null;
  sourceCount: number;
  indiaNote: string | null;
  status: 'active' | 'archived';
};

export type FeedPage = { events: FeedCard[]; total: number; offset: number; limit: number };

export type ImpactDetail = {
  corridor: string;
  severity: 'none' | 'watch' | 'elevated' | 'severe';
  headline: string;
  teaser: string;
  bullets: string[];
  keyNumbers: KeyNumber[];
  outlook: string[];
  actions: string[];
  confidence: 'low' | 'medium' | 'high';
  model: string;
  generatedAt: string;
};

export type EventDetail = {
  card: FeedCard;
  locked: boolean;
  impacts: ImpactDetail[];
  sources: Array<{ title: string; url: string | null; sourceKey: string; publishedAt: string; trust: number }>;
};

const SEVERITY_RANK = { severe: 0, elevated: 1, watch: 2, none: 3 } as const;

// Chronological and paginated. The old version ordered by importance and cut the list at a
// fixed limit, so a busy day pushed yesterday's news off the page entirely - it looked like
// the sweep had deleted things. Nothing is dropped now; older items simply sit lower.
export async function listFeed(limit = 40, offset = 0): Promise<FeedPage> {
  const count = z.coerce.number().int().min(1).max(100).parse(limit);
  const skip = z.coerce.number().int().min(0).max(10_000).parse(offset);
  return withActor(null, async (db) => {
    const rows = (await db.query(
      `SELECT slug, title, summary, importance, topics, corridors, chokepoints,
              last_seen AS "lastSeen", status, india_note AS "indiaNote",
              worst_severity AS severity, corridor_count AS "corridorCount",
              teaser, source_count AS "sourceCount", total_count AS "totalCount"
       FROM public.public_news_feed($1, $2)`,
      [count, skip],
    )).rows;
    return {
      events: rows.map((row) => ({
        slug: row.slug, title: row.title, summary: row.summary,
        importance: Number(row.importance), topics: row.topics, corridors: row.corridors,
        chokepoints: row.chokepoints, severity: row.severity,
        corridorCount: Number(row.corridorCount ?? 0),
        sourceCount: Number(row.sourceCount ?? 0),
        teaser: row.teaser, indiaNote: row.indiaNote, status: row.status,
        lastSeen: row.lastSeen instanceof Date ? row.lastSeen.toISOString() : String(row.lastSeen),
      })) as FeedCard[],
      total: Number(rows[0]?.totalCount ?? 0),
      offset: skip,
      limit: count,
    };
  });
}

export async function getEvent(slug: string, actorId: string | null): Promise<EventDetail> {
  const key = z.string().trim().min(3).max(120).regex(/^[a-z0-9-]+$/).parse(slug);
  return withActor(actorId, async (db) => {
    const event = (await db.query(
      `SELECT slug,title,summary,importance,topics,corridors,chokepoints,status,
              last_seen AS "lastSeen",item_count AS "sourceCount",india_note AS "indiaNote"
       FROM news_events WHERE slug=$1`,
      [key],
    )).rows[0];
    if (!event) throw new AppError(404, 'NOT_FOUND', 'That briefing is no longer available.');

    // Sources are public - they are published articles. The written analysis is not.
    const sources = (await db.query(
      `SELECT title,url,source_key AS "sourceKey",published_at AS "publishedAt",trust
       FROM news_items WHERE event_id=(SELECT id FROM news_events WHERE slug=$1)
       ORDER BY trust DESC, published_at DESC LIMIT 12`,
      [key],
    )).rows.map((row) => ({ ...row, trust: Number(row.trust), publishedAt: row.publishedAt instanceof Date ? row.publishedAt.toISOString() : String(row.publishedAt) }));

    // Two ways to read the analysis. Public: through the definer function, which ignores
    // the actor. Gated: straight off the table, where the row policy returns nothing for a
    // visitor and everything for a signed-in account. NEWS_PUBLIC_ANALYSIS picks, so the
    // paywall comes back with an env change rather than a migration.
    const isPublic = process.env.NEWS_PUBLIC_ANALYSIS !== 'false';
    const impactRows = isPublic
      ? (await db.query(
        `SELECT corridor,severity,headline,teaser,body,actions,confidence,detail,model,generated_at AS "generatedAt"
         FROM public.public_event_impacts($1)`,
        [key],
      )).rows
      : (await db.query(
        `SELECT corridor,severity,headline,teaser,body,actions,confidence,detail,model,generated_at AS "generatedAt"
         FROM event_impacts WHERE event_id=(SELECT id FROM news_events WHERE slug=$1)`,
        [key],
      )).rows;

    const impacts: ImpactDetail[] = impactRows.map((row) => {
      const detail = (row.detail ?? {}) as { bullets?: string[]; keyNumbers?: KeyNumber[]; outlook?: string[] };
      return {
        corridor: row.corridor,
        severity: row.severity,
        headline: row.headline,
        teaser: row.teaser,
        // Older rows predate the structured column; their prose body still reads as lines.
        bullets: detail.bullets?.length ? detail.bullets : String(row.body ?? '').split('\n').filter((line) => line.trim().startsWith('-')).map((line) => line.replace(/^-\s*/, '')),
        keyNumbers: detail.keyNumbers ?? [],
        outlook: detail.outlook ?? [],
        actions: Array.isArray(row.actions) ? row.actions : [],
        confidence: row.confidence,
        model: row.model,
        generatedAt: row.generatedAt instanceof Date ? row.generatedAt.toISOString() : String(row.generatedAt),
      };
    }).sort((left, right) => SEVERITY_RANK[left.severity as keyof typeof SEVERITY_RANK] - SEVERITY_RANK[right.severity as keyof typeof SEVERITY_RANK]);

    const teaser = (await db.query('SELECT worst_severity, teaser, corridor_count FROM public.public_news_feed(100, 0) WHERE slug=$1', [key])).rows[0];

    return {
      card: {
        slug: event.slug,
        title: event.title,
        summary: event.summary,
        importance: Number(event.importance),
        topics: event.topics,
        corridors: event.corridors,
        chokepoints: event.chokepoints,
        lastSeen: event.lastSeen instanceof Date ? event.lastSeen.toISOString() : String(event.lastSeen),
        severity: teaser?.worst_severity ?? null,
        corridorCount: Number(teaser?.corridor_count ?? 0),
        teaser: teaser?.teaser ?? null,
        sourceCount: Number(event.sourceCount ?? 0),
        indiaNote: event.indiaNote ?? null,
        status: event.status ?? 'active',
      },
      // Nothing is withheld while the analysis is public, so nothing reads as locked.
      locked: !isPublic && impacts.length === 0 && Number(teaser?.corridor_count ?? 0) > 0,
      impacts,
      sources,
    };
  });
}
