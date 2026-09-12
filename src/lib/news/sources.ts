// Source adapters. Each one fetches from a public endpoint and normalises to RawItem.
// Only three are wired: all need no API key, and all three are primary or near-primary
// sources rather than aggregators. Keyed sources (Guardian, NYT, NewsAPI) drop in behind
// the same interface when their keys arrive.
//
// Trust is declared per source, not inferred. An official register is a 5; a wire report
// carried by an unknown domain is a 2.

import type { RawItem, Topic } from './relevance';

export type FetchOptions = { now?: Date; sinceDays?: number; fetcher?: typeof fetch; limit?: number };

const USER_AGENT = 'NavairLogistics/1.0 (trade intelligence; +https://navair.example)';
const TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A bare "fetch failed" tells an operator nothing, so the underlying cause is carried into
// the message. Public endpoints throttle - GDELT allows one request every five seconds -
// so a 429 or a transient network fault is retried with a widening pause rather than
// dropping a whole source from the sweep.
async function getJson(url: string, fetcher: typeof fetch, attempt = 0): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }, signal: controller.signal });
    if (response.status === 429 || response.status >= 500) {
      if (attempt >= 2) throw new Error(`${new URL(url).host} responded ${response.status} after ${attempt + 1} attempts`);
      clearTimeout(timer);
      await sleep(6000 * (attempt + 1));
      return getJson(url, fetcher, attempt + 1);
    }
    if (!response.ok) throw new Error(`${new URL(url).host} responded ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error(`${new URL(url).host} timed out after ${TIMEOUT_MS / 1000}s`);
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    if (cause && attempt < 2) {
      await sleep(4000 * (attempt + 1));
      return getJson(url, fetcher, attempt + 1);
    }
    if (cause) throw new Error(`${new URL(url).host} unreachable (${cause.code ?? cause.message ?? 'network error'})`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Domains we will quote. GDELT indexes the whole web including low-quality republishers,
// so an allowlist is the difference between a trade-intelligence feed and a content farm.
const GDELT_ALLOWED: Record<string, number> = {
  'reuters.com': 5, 'apnews.com': 5, 'bloomberg.com': 5, 'ft.com': 5, 'wsj.com': 5,
  'economist.com': 5, 'nytimes.com': 4, 'theguardian.com': 4, 'bbc.com': 4, 'bbc.co.uk': 4,
  'cnbc.com': 4, 'aljazeera.com': 4, 'scmp.com': 4, 'nikkei.com': 4,
  'economictimes.indiatimes.com': 4, 'business-standard.com': 4, 'livemint.com': 4,
  'thehindu.com': 4, 'hindubusinessline.com': 4, 'moneycontrol.com': 3,
  'lloydslist.com': 5, 'joc.com': 5, 'theloadstar.com': 4, 'gcaptain.com': 4,
  'splash247.com': 4, 'freightwaves.com': 4, 'seatrade-maritime.com': 4,
  'maritime-executive.com': 4, 'tradewindsnews.com': 4, 'container-news.com': 3,
};

// The query has to ask for everything the classifier can recognise, or whole topics never
// arrive to be classified. Kept as phrases because GDELT matches loose words far too widely.
const GDELT_QUERY = [
  '("Strait of Hormuz" OR "Suez Canal" OR "Red Sea shipping" OR "Bab el-Mandeb"',
  'OR "Panama Canal" OR "Strait of Malacca" OR "port strike" OR "shipping tariff"',
  'OR "export ban" OR "trade sanctions" OR "container freight" OR "blank sailing"',
  'OR "supply chain disruption" OR "port congestion" OR "dock workers strike"',
  'OR "customs clearance delay" OR "free trade agreement" OR "rules of origin"',
  'OR "cargo theft" OR "piracy attack" OR "war risk insurance" OR "vessel diversion"',
  'OR "export restriction" OR "import duty" OR "shipping delays" OR "freight capacity")',
].join(' ');

function gdeltDate(value: string): string {
  // GDELT stamps look like 20260910T130000Z.
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) return new Date().toISOString();
  const [, year, month, day, hour, minute, second] = match;
  return new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second)).toISOString();
}

export async function fetchGdelt(options: FetchOptions = {}): Promise<RawItem[]> {
  const fetcher = options.fetcher ?? fetch;
  const days = Math.min(30, Math.max(1, options.sinceDays ?? 3));
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`${GDELT_QUERY} sourcelang:english`)}`
    + `&mode=ArtList&maxrecords=${Math.min(250, options.limit ?? 120)}&timespan=${days}d&sort=DateDesc&format=json`;
  const payload = await getJson(url, fetcher) as { articles?: Array<Record<string, string>> };
  const articles = payload.articles ?? [];
  return articles.flatMap((article) => {
    const domain = (article.domain ?? '').toLocaleLowerCase();
    const trust = GDELT_ALLOWED[domain];
    if (!trust) return [];
    if (!article.title?.trim() || !article.url) return [];
    return [{
      sourceKey: `gdelt:${domain}`,
      externalId: article.url,
      url: article.url,
      // GDELT pads punctuation with spaces; tidy it so headlines read like headlines.
      title: article.title.replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim(),
      summary: null,
      publishedAt: gdeltDate(article.seendate ?? ''),
      trust,
      measurement: null,
    } satisfies RawItem];
  });
}

// The US Federal Register is the primary document for American tariff and sanctions
// action - the rule itself, not somebody's report of the rule.
// One query per term: the register's `term` condition treats a joined "a OR b" string as a
// phrase, which quietly returned almost nothing. Each term also declares the topic it
// represents, so a determination never has to say "tariff" to be filed as one.
const REGISTER_TERMS: Array<[string, Topic]> = [
  ['tariff', 'tariff'],
  ['antidumping', 'tariff'],
  ['countervailing duty', 'tariff'],
  ['export control', 'export_control'],
  ['sanctions', 'sanctions'],
];

export async function fetchFederalRegister(options: FetchOptions = {}): Promise<RawItem[]> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - (options.sinceDays ?? 14) * 86_400_000).toISOString().slice(0, 10);
  const perTerm = Math.max(5, Math.floor((options.limit ?? 60) / REGISTER_TERMS.length));
  const found = new Map<string, RawItem>();
  for (const [term, topic] of REGISTER_TERMS) {
    const url = 'https://www.federalregister.gov/api/v1/documents.json'
      + `?per_page=${perTerm}&order=newest`
      + `&conditions[publication_date][gte]=${since}`
      + `&conditions[term]=${encodeURIComponent(term)}`
      + '&fields[]=document_number&fields[]=title&fields[]=abstract&fields[]=publication_date&fields[]=html_url&fields[]=type';
    let payload: { results?: Array<Record<string, string | null>> };
    try {
      payload = await getJson(url, fetcher) as typeof payload;
    } catch {
      continue; // One term failing must not lose the other four.
    }
    for (const entry of payload.results ?? []) {
      if (!entry.title || !entry.document_number || found.has(entry.document_number)) continue;
      found.set(entry.document_number, {
        sourceKey: 'federal_register',
        externalId: entry.document_number,
        url: entry.html_url ?? null,
        title: entry.title,
        summary: entry.abstract ?? null,
        publishedAt: new Date(`${entry.publication_date}T00:00:00.000Z`).toISOString(),
        trust: 5,
        measurement: null,
        topicHints: [topic],
      });
    }
  }
  return [...found.values()];
}

// IMF PortWatch: satellite AIS transit counts per chokepoint, published with the IMF and
// Oxford. Absolute counts are a sample rather than a census, so we never report them as
// "ships that passed today" - only as movement against this chokepoint's own baseline.
const PORTWATCH_SERVICE = 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query';
const WATCHED_CHOKEPOINTS = ['Strait of Hormuz', 'Suez Canal', 'Bab el-Mandeb Strait', 'Strait of Malacca', 'Panama Canal', 'Cape of Good Hope'];
const BASELINE_DAYS = 90;
const RECENT_DAYS = 7;
// How far below its own baseline a chokepoint must fall before it is worth telling anyone.
const ANOMALY_THRESHOLD = 0.25;

export type ChokepointReading = {
  chokepoint: string;
  recentMean: number;
  baselineMedian: number;
  changeRatio: number;
  latestDate: string;
  days: number;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export async function readChokepoints(options: FetchOptions = {}): Promise<ChokepointReading[]> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - BASELINE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const readings: ChokepointReading[] = [];
  for (const chokepoint of WATCHED_CHOKEPOINTS) {
    const where = `portname='${chokepoint.replace(/'/g, "''")}' AND date>timestamp '${since} 00:00:00'`;
    const url = `${PORTWATCH_SERVICE}?where=${encodeURIComponent(where)}&outFields=date,n_total&f=json&resultRecordCount=200&orderByFields=${encodeURIComponent('date ASC')}`;
    let payload: { features?: Array<{ attributes: { date: string; n_total: number } }> };
    try {
      payload = await getJson(url, fetcher) as typeof payload;
    } catch {
      continue; // One chokepoint failing must not sink the whole sweep.
    }
    const rows = (payload.features ?? [])
      .map((feature) => ({ date: String(feature.attributes.date).slice(0, 10), total: Number(feature.attributes.n_total) }))
      .filter((row) => Number.isFinite(row.total))
      .sort((left, right) => left.date.localeCompare(right.date));
    if (rows.length < 30) continue;
    const recent = rows.slice(-RECENT_DAYS);
    const baseline = rows.slice(0, Math.max(1, rows.length - RECENT_DAYS));
    const baselineMedian = median(baseline.map((row) => row.total));
    if (baselineMedian <= 0) continue;
    const recentMean = recent.reduce((sum, row) => sum + row.total, 0) / recent.length;
    readings.push({
      chokepoint,
      recentMean: Math.round(recentMean * 10) / 10,
      baselineMedian,
      changeRatio: Math.round(((recentMean - baselineMedian) / baselineMedian) * 1000) / 1000,
      latestDate: rows.at(-1)!.date,
      days: rows.length,
    });
  }
  return readings;
}

export function anomalousReadings(readings: ChokepointReading[]): ChokepointReading[] {
  return readings.filter((reading) => Math.abs(reading.changeRatio) >= ANOMALY_THRESHOLD);
}

export function readingToItem(reading: ChokepointReading): RawItem {
  const direction = reading.changeRatio < 0 ? 'below' : 'above';
  const percent = Math.abs(Math.round(reading.changeRatio * 100));
  return {
    sourceKey: 'imf_portwatch',
    externalId: `${reading.chokepoint}:${reading.latestDate}`,
    url: 'https://portwatch.imf.org/',
    title: `${reading.chokepoint}: recorded transits ${percent}% ${direction} their ninety-day norm`,
    summary: `IMF PortWatch satellite tracking puts the last ${RECENT_DAYS} days at an average of ${reading.recentMean} recorded transits per day against a ninety-day median of ${reading.baselineMedian}. Counts are a consistent sample rather than a full census, so the movement matters and the absolute number does not.`,
    publishedAt: new Date(`${reading.latestDate}T00:00:00.000Z`).toISOString(),
    trust: 5,
    measurement: {
      chokepoint: reading.chokepoint,
      recentMean: reading.recentMean,
      baselineMedian: reading.baselineMedian,
      changeRatio: reading.changeRatio,
      days: reading.days,
    },
  };
}

// ---------------------------------------------------------------------------
// Keyed newsrooms. Each is an editorially accountable publisher, which is why
// they sit at trust 4 and GDELT's long tail does not. A missing key is not an
// error: the source simply sits out the sweep.
// ---------------------------------------------------------------------------

// Same principle for the keyed newsrooms: search the whole checklist, not a corner of it.
const NEWS_QUERY_TERMS = [
  'Strait of Hormuz', 'Suez Canal', 'Red Sea shipping', 'port strike', 'port congestion',
  'export ban', 'trade sanctions', 'tariff', 'container shipping', 'supply chain disruption',
  'free trade agreement', 'customs delay', 'cargo theft', 'war risk insurance',
  'export restriction', 'shipping disruption', 'freight capacity', 'dock workers',
];

// India-facing sweep. The general query is written for world news and rarely surfaces an
// Indian notification, so these run as their own pass against the same sources.
const INDIA_QUERY_TERMS = [
  'DGFT notification', 'India export policy', 'India import duty', 'Indian ports congestion',
  'India customs circular', 'RoDTEP', 'India trade agreement', 'Nhava Sheva', 'Mundra port',
];

export async function fetchIndiaTrade(options: FetchOptions = {}): Promise<RawItem[]> {
  const key = process.env.NEWSAPI_KEY;
  if (!key) return [];
  const fetcher = options.fetcher ?? fetch;
  const from = new Date((options.now ?? new Date()).getTime() - (options.sinceDays ?? 7) * 86_400_000).toISOString().slice(0, 10);
  const query = `(${INDIA_QUERY_TERMS.map((term) => `"${term}"`).join(' OR ')})`;
  const url = 'https://newsapi.org/v2/everything'
    + `?q=${encodeURIComponent(query)}&from=${from}&language=en&sortBy=publishedAt`
    + `&pageSize=${Math.min(100, options.limit ?? 40)}&apiKey=${encodeURIComponent(key)}`;
  const payload = await getJson(url, fetcher) as { articles?: Array<Record<string, unknown>> };
  return (payload.articles ?? []).flatMap((article) => {
    const host = (() => { try { return new URL(String(article.url)).host.replace(/^www\./, '').toLocaleLowerCase(); } catch { return ''; } })();
    const trust = GDELT_ALLOWED[host];
    if (!trust || !article.title) return [];
    return [{
      sourceKey: `india:${host}`,
      externalId: String(article.url),
      url: String(article.url),
      title: String(article.title),
      summary: article.description ? String(article.description) : null,
      publishedAt: String(article.publishedAt ?? new Date().toISOString()),
      trust,
      measurement: null,
      topicHints: ['india_policy'] as Topic[],
    } satisfies RawItem];
  });
}

export async function fetchGuardian(options: FetchOptions = {}): Promise<RawItem[]> {
  const key = process.env.GUARDIAN_API_KEY;
  if (!key) return [];
  const fetcher = options.fetcher ?? fetch;
  const from = new Date((options.now ?? new Date()).getTime() - (options.sinceDays ?? 5) * 86_400_000).toISOString().slice(0, 10);
  const query = NEWS_QUERY_TERMS.map((term) => `"${term}"`).join(' OR ');
  const url = 'https://content.guardianapis.com/search'
    + `?q=${encodeURIComponent(query)}&from-date=${from}&order-by=newest`
    + `&page-size=${Math.min(50, options.limit ?? 40)}&show-fields=trailText&section=business|world|environment`
    + `&api-key=${encodeURIComponent(key)}`;
  const payload = await getJson(url, fetcher) as { response?: { results?: Array<Record<string, unknown>> } };
  return (payload.response?.results ?? []).flatMap((entry) => {
    const fields = entry.fields as { trailText?: string } | undefined;
    if (!entry.webTitle || !entry.id) return [];
    return [{
      sourceKey: 'guardian',
      externalId: String(entry.id),
      url: String(entry.webUrl ?? ''),
      title: String(entry.webTitle),
      summary: fields?.trailText ? fields.trailText.replace(/<[^>]+>/g, '').trim() : null,
      publishedAt: String(entry.webPublicationDate ?? new Date().toISOString()),
      trust: 4,
      measurement: null,
    } satisfies RawItem];
  });
}

export async function fetchNewYorkTimes(options: FetchOptions = {}): Promise<RawItem[]> {
  const key = process.env.NYT_API_KEY;
  if (!key) return [];
  const fetcher = options.fetcher ?? fetch;
  const begin = new Date((options.now ?? new Date()).getTime() - (options.sinceDays ?? 7) * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
  const query = NEWS_QUERY_TERMS.slice(0, 6).join(' OR ');
  const url = 'https://api.nytimes.com/svc/search/v2/articlesearch.json'
    + `?q=${encodeURIComponent(query)}&begin_date=${begin}&sort=newest`
    + `&api-key=${encodeURIComponent(key)}`;
  const payload = await getJson(url, fetcher) as { response?: { docs?: Array<Record<string, unknown>> } };
  return (payload.response?.docs ?? []).flatMap((doc) => {
    const headline = (doc.headline as { main?: string } | undefined)?.main;
    if (!headline || !doc.web_url) return [];
    return [{
      sourceKey: 'nytimes',
      externalId: String(doc._id ?? doc.web_url),
      url: String(doc.web_url),
      title: headline,
      summary: doc.abstract ? String(doc.abstract) : null,
      publishedAt: String(doc.pub_date ?? new Date().toISOString()),
      trust: 4,
      measurement: null,
    } satisfies RawItem];
  });
}

// NewsAPI aggregates many publishers, so it is restricted to the same reputable
// domains GDELT is, rather than trusted wholesale.
export async function fetchNewsApi(options: FetchOptions = {}): Promise<RawItem[]> {
  const key = process.env.NEWSAPI_KEY;
  if (!key) return [];
  const fetcher = options.fetcher ?? fetch;
  const from = new Date((options.now ?? new Date()).getTime() - (options.sinceDays ?? 5) * 86_400_000).toISOString().slice(0, 10);
  const query = `(${NEWS_QUERY_TERMS.map((term) => `"${term}"`).join(' OR ')})`;
  const url = 'https://newsapi.org/v2/everything'
    + `?q=${encodeURIComponent(query)}&from=${from}&language=en&sortBy=publishedAt`
    + `&pageSize=${Math.min(100, options.limit ?? 50)}&apiKey=${encodeURIComponent(key)}`;
  const payload = await getJson(url, fetcher) as { articles?: Array<Record<string, unknown>> };
  return (payload.articles ?? []).flatMap((article) => {
    const host = (() => { try { return new URL(String(article.url)).host.replace(/^www\./, '').toLocaleLowerCase(); } catch { return ''; } })();
    const trust = GDELT_ALLOWED[host];
    if (!trust || !article.title) return [];
    return [{
      sourceKey: `newsapi:${host}`,
      externalId: String(article.url),
      url: String(article.url),
      title: String(article.title),
      summary: article.description ? String(article.description) : null,
      publishedAt: String(article.publishedAt ?? new Date().toISOString()),
      trust,
      measurement: null,
    } satisfies RawItem];
  });
}

// ---------------------------------------------------------------------------
// Trade press and official gazettes over RSS. No keys, no quotas, and these are
// the outlets that report a berth closure or a war-risk notice days before the
// general press does. Trust is declared per feed: an official gazette is a 5,
// an established trade title a 4, a smaller aggregator a 3.
// ---------------------------------------------------------------------------

type Feed = { key: string; url: string; trust: number; hints?: Topic[] };

const FEEDS: Feed[] = [
  // Official
  { key: 'gov.uk', url: 'https://www.gov.uk/search/all.atom?keywords=trade+sanctions', trust: 5, hints: ['sanctions'] },
  // Maritime and freight trade press
  { key: 'gcaptain', url: 'https://gcaptain.com/feed/', trust: 4 },
  { key: 'theloadstar', url: 'https://theloadstar.com/feed/', trust: 4 },
  { key: 'splash247', url: 'https://splash247.com/feed/', trust: 4 },
  { key: 'maritime-executive', url: 'https://maritime-executive.com/articles.rss', trust: 4 },
  { key: 'seatrade-maritime', url: 'https://www.seatrade-maritime.com/rss.xml', trust: 4 },
  { key: 'freightwaves', url: 'https://www.freightwaves.com/news/feed', trust: 4 },
  { key: 'container-news', url: 'https://container-news.com/feed/', trust: 3 },
  { key: 'hellenicshipping', url: 'https://www.hellenicshippingnews.com/feed/', trust: 3 },
  // Air cargo, which the general news query almost never surfaces
  { key: 'aircargonews', url: 'https://www.aircargonews.net/feed/', trust: 4 },
  { key: 'stattimes-air', url: 'https://www.stattimes.com/rss/air-cargo', trust: 3 },
];

function decodeEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

function tagText(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  return match ? decodeEntities(match[1]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null;
}

function entryLink(block: string): string | null {
  // RSS puts the URL in <link>text</link>; Atom puts it in an href attribute.
  const href = /<link[^>]*href="([^"]+)"/i.exec(block);
  if (href) return href[1];
  const plain = tagText(block, 'link');
  return plain && /^https?:/i.test(plain) ? plain : null;
}

async function readFeed(feed: Feed, options: FetchOptions): Promise<RawItem[]> {
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let xml: string;
  try {
    const response = await fetcher(feed.url, {
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8', 'User-Agent': USER_AGENT },
      signal: controller.signal, redirect: 'follow',
    });
    if (!response.ok) throw new Error(`${feed.key} responded ${response.status}`);
    xml = await response.text();
  } finally {
    clearTimeout(timer);
  }

  const cutoff = Date.now() - (options.sinceDays ?? 7) * 86_400_000;
  const blocks = xml.split(/<(?:item|entry)[\s>]/i).slice(1).slice(0, options.limit ?? 40);
  return blocks.flatMap((block) => {
    const title = tagText(block, 'title');
    const url = entryLink(block);
    if (!title || !url) return [];
    const stamp = tagText(block, 'pubDate') ?? tagText(block, 'published') ?? tagText(block, 'updated') ?? tagText(block, 'dc:date');
    const published = stamp ? new Date(stamp) : new Date();
    if (Number.isNaN(published.getTime()) || published.getTime() < cutoff) return [];
    const summary = tagText(block, 'description') ?? tagText(block, 'summary') ?? tagText(block, 'content');
    return [{
      sourceKey: feed.key,
      externalId: url,
      url,
      title,
      summary: summary ? summary.slice(0, 600) : null,
      publishedAt: published.toISOString(),
      trust: feed.trust,
      measurement: null,
      ...(feed.hints ? { topicHints: feed.hints } : {}),
    } satisfies RawItem];
  });
}

export async function fetchTradePress(options: FetchOptions = {}): Promise<RawItem[]> {
  // One slow or broken feed must never cost us the other ten.
  const results = await Promise.allSettled(FEEDS.map((feed) => readFeed(feed, options)));
  return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
}

export function tradePressFeedCount(): number {
  return FEEDS.length;
}
