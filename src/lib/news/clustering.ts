// Eight articles about the Strait of Hormuz are one event, not eight. Clustering here is
// plain arithmetic - shared significant words, overlapping chokepoints, a time window - and
// runs before any model is called. That ordering is the cost control: the expensive layer
// only ever sees deduplicated events, never the raw firehose.

import { importanceOf, type ScoredItem } from './relevance';

export type Cluster = {
  slug: string;
  title: string;
  summary: string;
  items: ScoredItem[];
  topics: string[];
  regions: string[];
  chokepoints: string[];
  corridors: string[];
  importance: number;
  firstSeen: string;
  lastSeen: string;
};

const WINDOW_DAYS = 5;
const SIMILARITY_FLOOR = 0.34;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'from', 'this', 'will', 'have', 'has', 'was', 'are',
  'its', 'not', 'but', 'they', 'their', 'what', 'why', 'how', 'after', 'over', 'into', 'amid',
  'says', 'said', 'new', 'more', 'than', 'been', 'can', 'could', 'would', 'about', 'as', 'at',
  'by', 'in', 'of', 'on', 'to', 'is', 'it', 'a', 'an', 'be', 'or', 'so', 'up', 'out',
  // Official filings share so much boilerplate that two unrelated duty rulings look like
  // the same story to a word-overlap score. Stripping the shared scaffolding leaves the
  // product and the country, which is what actually distinguishes them.
  'antidumping', 'anti', 'dumping', 'countervailing', 'duty', 'duties', 'administrative',
  'review', 'reviews', 'preliminary', 'final', 'results', 'result', 'rescission', 'notice',
  'scheduling', 'comments', 'comment', 'investigation', 'investigations', 'determination',
  'determinations', 'amended', 'partial', 'phase', 'certain', 'order', 'orders', 'federal',
  'register', 'request', 'receipt', 'solicitation', 'relating', 'public', 'implementation',
]);

export function significantWords(text: string): Set<string> {
  return new Set(
    text.toLocaleLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
  );
}

export function similarity(left: ScoredItem, right: ScoredItem): number {
  const leftWords = significantWords(`${left.title} ${left.summary ?? ''}`);
  const rightWords = significantWords(`${right.title} ${right.summary ?? ''}`);
  if (leftWords.size === 0 || rightWords.size === 0) return 0;
  let shared = 0;
  for (const word of leftWords) if (rightWords.has(word)) shared += 1;
  const jaccard = shared / (leftWords.size + rightWords.size - shared);
  // A shared chokepoint is strong evidence two stories are about the same disruption.
  const sharedChokepoint = left.chokepoints.some((point) => right.chokepoints.includes(point));
  return Math.min(1, jaccard + (sharedChokepoint ? 0.25 : 0));
}

function withinWindow(left: ScoredItem, right: ScoredItem): boolean {
  const gap = Math.abs(new Date(left.publishedAt).getTime() - new Date(right.publishedAt).getTime());
  return gap <= WINDOW_DAYS * 86_400_000;
}

function slugify(text: string): string {
  return text.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

// The clearest headline in a cluster is the one from the most trusted source; ties go to
// the most relevant. A measurement always wins, because it is evidence rather than report.
function leadItem(items: ScoredItem[]): ScoredItem {
  return [...items].sort((left, right) => {
    if (Boolean(left.measurement) !== Boolean(right.measurement)) return left.measurement ? -1 : 1;
    if (left.trust !== right.trust) return right.trust - left.trust;
    return right.relevance - left.relevance;
  })[0];
}

export function clusterItems(items: ScoredItem[]): Cluster[] {
  const ordered = [...items].sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime());
  const groups: ScoredItem[][] = [];
  for (const item of ordered) {
    const home = groups.find((group) => group.some((member) => withinWindow(member, item) && similarity(member, item) >= SIMILARITY_FLOOR));
    if (home) home.push(item);
    else groups.push([item]);
  }
  return groups.map((group) => {
    const lead = leadItem(group);
    const dates = group.map((item) => new Date(item.publishedAt).getTime());
    const summary = lead.summary?.trim()
      ?? `${group.length} report${group.length === 1 ? '' : 's'} from ${new Set(group.map((item) => item.sourceKey)).size} source${new Set(group.map((item) => item.sourceKey)).size === 1 ? '' : 's'} covering this development.`;
    return {
      slug: `${slugify(lead.title)}-${new Date(Math.max(...dates)).toISOString().slice(0, 10)}`,
      title: lead.title,
      summary,
      items: group,
      topics: [...new Set(group.flatMap((item) => item.topics))].sort(),
      regions: [...new Set(group.flatMap((item) => item.regions))].sort(),
      chokepoints: [...new Set(group.flatMap((item) => item.chokepoints))].sort(),
      corridors: [...new Set(group.flatMap((item) => item.corridors))].sort(),
      importance: importanceOf(group),
      firstSeen: new Date(Math.min(...dates)).toISOString(),
      lastSeen: new Date(Math.max(...dates)).toISOString(),
    };
  }).sort((left, right) => right.importance - left.importance || right.lastSeen.localeCompare(left.lastSeen));
}
