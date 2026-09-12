// What counts as news Navair should carry.
//
// We are a freight desk, not a newsroom. An article earns a place only if it plausibly
// changes how cargo moves on a corridor we serve. Everything here is deterministic and
// testable: no model decides what is relevant, because a model that decides relevance also
// decides what we never see. The AI layer runs later, on what survives these gates.

// The coverage checklist. Anything that can change how Indian cargo moves, costs to
// insure, or clears a border belongs here. Adding a topic means adding its terms below and
// its corridor mapping - nothing else in the pipeline needs to know.
export type Topic =
  | 'chokepoint' | 'tariff' | 'sanctions' | 'conflict' | 'port_disruption'
  | 'carrier_capacity' | 'export_control' | 'customs_policy' | 'energy'
  | 'trade_agreement' | 'labour' | 'weather' | 'infrastructure' | 'regulation'
  | 'currency' | 'commodity' | 'security' | 'biosecurity' | 'cyber' | 'india_policy';

export type Region = 'india' | 'gulf' | 'red_sea' | 'europe' | 'sea_asia' | 'east_asia' | 'americas' | 'africa' | 'global';

export type Chokepoint = 'hormuz' | 'suez' | 'bab_el_mandeb' | 'malacca' | 'panama' | 'good_hope' | 'bosporus';

export type RawItem = {
  sourceKey: string;
  externalId: string;
  url: string | null;
  title: string;
  summary: string | null;
  publishedAt: string;
  trust: number;
  measurement?: Record<string, unknown> | null;
  // An official register knows what kind of action it published; it should not have to
  // spell the word "tariff" in a headline to be recognised as one. News gets sniffed for
  // topics, primary sources declare them.
  topicHints?: Topic[];
};

export type ScoredItem = RawItem & {
  topics: Topic[];
  // Topics the text itself supports, as opposed to ones a source declared. A declared
  // topic needs corroboration before we publish it; a detected one already has some.
  detectedTopics: Topic[];
  regions: Region[];
  chokepoints: Chokepoint[];
  corridors: string[];
  relevance: number;
};

// Phrases are matched against lowercased title + summary. Each topic needs at least one
// hit from its own list; a headline that merely mentions a country is not trade news.
const TOPIC_TERMS: Record<Topic, string[]> = {
  chokepoint: ['strait of hormuz', 'hormuz', 'suez canal', 'bab el-mandeb', 'bab al-mandab', 'red sea', 'malacca', 'panama canal', 'cape of good hope', 'bosporus', 'chokepoint', 'shipping lane', 'transit ban', 'canal closure'],
  tariff: ['tariff', 'customs duty', 'import duty', 'anti-dumping', 'antidumping', 'countervailing', 'less than fair value', 'dumping margin', 'trade barrier', 'section 301', 'safeguard duty', 'duty hike', 'trade deal', 'free trade agreement'],
  sanctions: ['sanction', 'embargo', 'asset freeze', 'entity list', 'restricted party', 'secondary sanctions', 'ofac'],
  conflict: ['war', 'missile', 'airstrike', 'blockade', 'naval', 'houthi', 'attack on ship', 'seized tanker', 'military escalation', 'ceasefire'],
  port_disruption: ['port strike', 'port closure', 'dock workers', 'terminal congestion', 'berth', 'port congestion', 'cyclone', 'typhoon', 'labour strike', 'labor strike', 'customs strike'],
  carrier_capacity: ['blank sailing', 'capacity cut', 'freight rate', 'container shortage', 'schedule reliability', 'vessel diversion', 'rerouting', 'air cargo capacity', 'space crunch'],
  export_control: ['export ban', 'export control', 'export restriction', 'quota', 'licence requirement', 'license requirement', 'rare earth'],
  customs_policy: ['customs rule', 'dgft', 'icegate', 'import policy', 'inspection regime', 'clearance delay', 'e-way bill', 'trade facilitation'],
  energy: ['oil price', 'crude', 'bunker fuel', 'lng', 'fuel surcharge', 'opec', 'diesel price', 'energy crisis'],
  trade_agreement: ['free trade agreement', 'fta', 'trade pact', 'trade deal', 'cepa', 'ceca', 'rcep', 'mercosur', 'customs union', 'preferential access', 'rules of origin', 'most favoured nation'],
  labour: ['strike', 'walkout', 'industrial action', 'union dispute', 'lockout', 'go-slow', 'staff shortage', 'driver shortage', 'pilot strike', 'truckers protest'],
  weather: ['cyclone', 'typhoon', 'hurricane', 'monsoon', 'flood', 'fog', 'drought', 'low water', 'storm', 'heatwave', 'earthquake'],
  infrastructure: ['dedicated freight corridor', 'new terminal', 'berth expansion', 'runway', 'rail link', 'inland container depot', 'icd', 'dry port', 'warehouse capacity', 'bridge collapse', 'canal draft'],
  regulation: ['imo', 'emissions rule', 'cbam', 'carbon border', 'sulphur cap', 'safety directive', 'compliance deadline', 'certification requirement', 'packaging rule', 'labelling rule'],
  currency: ['rupee', 'exchange rate', 'currency control', 'capital control', 'devaluation', 'forex reserves', 'remittance rule', 'payment restriction', 'letter of credit'],
  commodity: ['wheat export', 'rice export', 'sugar export', 'steel export', 'semiconductor supply', 'rare earth', 'fertiliser', 'edible oil', 'crop failure', 'harvest'],
  security: ['piracy', 'hijack', 'stowaway', 'smuggling', 'cargo theft', 'armed robbery at sea', 'convoy', 'naval escort', 'war risk'],
  biosecurity: ['quarantine', 'phytosanitary', 'foot and mouth', 'avian influenza', 'pest interception', 'fumigation', 'health certificate', 'outbreak'],
  cyber: ['cyber attack', 'ransomware', 'port systems outage', 'it outage', 'data breach', 'system failure'],
  india_policy: ['dgft notification', 'rodtep', 'drawback', 'gst on freight', 'sez', 'pli scheme', 'export incentive', 'import licence', 'bis certification', 'customs circular', 'budget announcement'],
};

const REGION_TERMS: Record<Region, string[]> = {
  india: ['india', 'indian', 'mumbai', 'delhi', 'chennai', 'kolkata', 'nhava sheva', 'mundra', 'jnpt', 'gujarat', 'tamil nadu'],
  gulf: ['gulf', 'uae', 'emirati', 'dubai', 'jebel ali', 'saudi', 'saudi arabian', 'jeddah', 'qatar', 'qatari', 'oman', 'omani', 'iran', 'iranian', 'iraq', 'iraqi', 'kuwait', 'bahrain', 'persian gulf'],
  red_sea: ['red sea', 'suez', 'bab el-mandeb', 'bab al-mandab', 'yemen', 'houthi', 'egypt', 'djibouti'],
  europe: ['europe', 'eu', 'european union', 'rotterdam', 'hamburg', 'antwerp', 'germany', 'netherlands', 'france', 'britain', 'uk', 'london'],
  sea_asia: ['singapore', 'malaysia', 'thailand', 'bangkok', 'vietnam', 'indonesia', 'malacca', 'colombo', 'sri lanka'],
  east_asia: ['china', 'chinese', 'shanghai', 'shenzhen', 'hong kong', 'japan', 'korea', 'taiwan', 'ningbo'],
  americas: ['united states', 'u.s.', 'usa', 'america', 'canada', 'mexico', 'brazil', 'new york', 'los angeles', 'panama'],
  africa: ['africa', 'nigeria', 'kenya', 'south africa', 'cape town', 'mombasa'],
  global: ['global trade', 'world trade', 'wto', 'supply chain', 'globalisation', 'globalization'],
};

const CHOKEPOINT_TERMS: Record<Chokepoint, string[]> = {
  hormuz: ['hormuz'],
  suez: ['suez'],
  bab_el_mandeb: ['bab el-mandeb', 'bab al-mandab', 'red sea'],
  malacca: ['malacca'],
  panama: ['panama canal'],
  good_hope: ['cape of good hope', 'good hope'],
  bosporus: ['bosporus', 'bosphorus', 'dardanelles'],
};

// Which of Navair's corridors a chokepoint or region actually sits on. This is the join
// between world news and our own 823 lanes: an event only reaches a customer if it lands
// on a corridor their cargo uses.
const CHOKEPOINT_CORRIDORS: Record<Chokepoint, string[]> = {
  hormuz: ['gulf-sea', 'gulf-air'],
  suez: ['europe-sea'],
  bab_el_mandeb: ['europe-sea'],
  malacca: ['sea_asia-sea', 'east_asia-sea'],
  panama: ['americas-sea'],
  good_hope: ['europe-sea'],
  bosporus: ['europe-sea'],
};

const REGION_CORRIDORS: Partial<Record<Region, string[]>> = {
  gulf: ['gulf-sea', 'gulf-air', 'gulf-courier'],
  europe: ['europe-sea', 'europe-air', 'europe-courier'],
  sea_asia: ['sea_asia-sea', 'sea_asia-air', 'sea_asia-courier'],
  east_asia: ['east_asia-sea', 'east_asia-air'],
  americas: ['americas-sea', 'americas-air', 'americas-courier'],
  india: ['india-road', 'india-air', 'india-courier'],
};

// A trade-shaping event nearly always touches India directly or runs through a lane India
// uses. Pure domestic news from an unrelated region is not our business.
const INDIA_LINKED_REGIONS: Region[] = ['india', 'gulf', 'red_sea', 'sea_asia', 'east_asia', 'europe', 'americas', 'global'];

// A trade action always names the stuff being traded. A regulatory notice that never
// mentions goods, duty, cargo or a border is some other agency's business, however it was
// filed - this is what keeps a uranium decommissioning notice out of a freight feed.
const TRADE_NOUNS = ['duty', 'duties', 'tariff', 'import', 'imports', 'export', 'exports', 'trade',
  'customs', 'sanction', 'sanctions', 'quota', 'shipment', 'shipments', 'cargo', 'vessel', 'vessels',
  'port', 'ports', 'freight', 'container', 'containers', 'shipping', 'supply chain', 'goods', 'commodity'];

// Weight is "how much could this change a shipment", not "how dramatic is the headline".
const TOPIC_WEIGHT: Record<Topic, number> = {
  chokepoint: 30, conflict: 22, sanctions: 20, tariff: 20, export_control: 18,
  port_disruption: 16, security: 16, carrier_capacity: 14, labour: 14, weather: 14,
  customs_policy: 12, india_policy: 12, biosecurity: 12, commodity: 11, cyber: 11,
  trade_agreement: 11, regulation: 10, energy: 10, currency: 9, infrastructure: 8,
};

export const MINIMUM_RELEVANCE = 22;
// Above this an event earns the full per-corridor analysis; below it, it still appears in
// the feed as a one-line note. Nothing that passes the gates is discarded.
export const MAJOR_RELEVANCE = 55;

const boundaryCache = new Map<string, RegExp>();

// Whole-word matching. Substring matching read "war" inside "warmwater" and filed a shrimp
// duty ruling as an armed conflict, so every term is anchored at word boundaries. Terms
// containing punctuation or spaces still match as phrases.
function matches(haystack: string, term: string): boolean {
  let pattern = boundaryCache.get(term);
  if (!pattern) {
    const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Allow the regular plural: "sanction" has to match "Sanctions Regulations", while
    // still refusing to find "war" inside "warmwater".
    pattern = new RegExp(`(?<![a-z0-9])${escaped}(?:e?s)?(?![a-z0-9])`, 'i');
    boundaryCache.set(term, pattern);
  }
  return pattern.test(haystack);
}

function hits(haystack: string, terms: string[]): boolean {
  return terms.some((term) => matches(haystack, term));
}

export function classify(item: RawItem): ScoredItem {
  const haystack = `${item.title} ${item.summary ?? ''}`.toLocaleLowerCase();
  const detected = (Object.keys(TOPIC_TERMS) as Topic[]).filter((topic) => hits(haystack, TOPIC_TERMS[topic]));
  const topics = [...new Set([...(item.topicHints ?? []), ...detected])];
  const regions = (Object.keys(REGION_TERMS) as Region[]).filter((region) => hits(haystack, REGION_TERMS[region]));
  const chokepoints = (Object.keys(CHOKEPOINT_TERMS) as Chokepoint[]).filter((point) => hits(haystack, CHOKEPOINT_TERMS[point]));

  // A corridor is a destination Navair ships to, so only non-Indian regions contribute one.
  // Mentioning India is what makes an item ours; it is not itself a destination. An item
  // that names only India is domestic freight news and gets the domestic corridors.
  const overseas = regions.filter((region) => region !== 'india' && region !== 'global' && region !== 'red_sea');
  const destinations = overseas.length > 0 ? overseas : (regions.includes('india') ? (['india'] as Region[]) : []);
  const corridors = [...new Set([
    ...chokepoints.flatMap((point) => CHOKEPOINT_CORRIDORS[point]),
    ...destinations.flatMap((region) => REGION_CORRIDORS[region] ?? []),
  ])].sort();

  // A measurement row (a chokepoint's own transit series) is evidence, not commentary, and
  // is scored on its own merit rather than on wording.
  const topicScore = item.measurement
    ? TOPIC_WEIGHT.chokepoint
    : topics.reduce((sum, topic) => sum + TOPIC_WEIGHT[topic], 0);
  const trustScore = item.trust * 6;
  const indiaLinked = regions.some((region) => INDIA_LINKED_REGIONS.includes(region));
  const reachScore = indiaLinked ? 12 : 0;
  const corridorScore = Math.min(12, corridors.length * 4);
  const relevance = Math.round((topicScore + trustScore + reachScore + corridorScore) * 10) / 10;

  return { ...item, topics, detectedTopics: detected, regions, chokepoints, corridors, relevance };
}

export function isWorthKeeping(item: ScoredItem): boolean {
  if (item.measurement) return true;
  if (item.topics.length === 0) return false;
  // A topic the text never supported came from a source's own filing category, so it has to
  // look like trade before we publish it. Text that genuinely discusses a disruption has
  // already earned its topic and is not held to the same vocabulary.
  if (item.detectedTopics.length === 0 && !hits(`${item.title} ${item.summary ?? ''}`.toLocaleLowerCase(), TRADE_NOUNS)) return false;
  // Something has to connect it to a lane we serve, or to trade at large.
  if (item.corridors.length === 0 && !item.regions.includes('global')) return false;
  return item.relevance >= MINIMUM_RELEVANCE;
}

export function isMajor(item: ScoredItem): boolean {
  return item.relevance >= MAJOR_RELEVANCE;
}

export function importanceOf(items: ScoredItem[]): number {
  if (items.length === 0) return 1;
  const best = Math.max(...items.map((item) => item.relevance));
  const corroboration = Math.min(3, Math.floor(new Set(items.map((item) => item.sourceKey)).size / 2));
  const measured = items.some((item) => item.measurement) ? 1 : 0;
  return Math.max(1, Math.min(10, Math.round(best / 12) + corroboration + measured));
}
