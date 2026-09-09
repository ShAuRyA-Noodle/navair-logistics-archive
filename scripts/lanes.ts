// Synthetic lane catalog for the local demo. Lanes are generated from a city table
// and mode-plausibility rules rather than hand-listed, so every city pair we offer
// carries the modes a freight desk would actually quote for it: no sea freight on an
// inland corridor, no road freight across an ocean, no air lane out of a city without
// an airport. Nothing here claims a lane is bookable; service_coverage carries that.

export type Mode = 'air' | 'sea' | 'road' | 'courier';
export type Coverage = 'supported' | 'on_request' | 'not_supported' | 'unknown';
export type City = { name: string; lat: number; lon: number; tier: 'metro' | 'tier2'; port: boolean; airport: boolean; domestic: boolean };
export type Lane = { origin: string; destination: string; mode: Mode; unit: string; coverage: Coverage; distanceKm: number; transitDays: number; base: number; crossBorder: boolean };
export type PricePoint = { week: number; observedAt: Date; sellingPrice: number; buyingCost: number };
export type DeliveryPoint = { index: number; promisedAt: Date; actualAt: Date | null; observedAt: Date; issue: string | null };

const MS_PER_DAY = 86_400_000;
const UNIT: Record<Mode, string> = { air: 'kg', sea: 'container', road: 'shipment', courier: 'kg' };
const ISSUES = ['carrier capacity', 'customs hold', 'weather', 'documentation'] as const;

export const cities: City[] = [
  { name: 'Mumbai', lat: 19.076, lon: 72.877, tier: 'metro', port: true, airport: true, domestic: true },
  { name: 'Delhi', lat: 28.614, lon: 77.209, tier: 'metro', port: false, airport: true, domestic: true },
  { name: 'Bengaluru', lat: 12.972, lon: 77.594, tier: 'metro', port: false, airport: true, domestic: true },
  { name: 'Chennai', lat: 13.083, lon: 80.270, tier: 'metro', port: true, airport: true, domestic: true },
  { name: 'Kolkata', lat: 22.573, lon: 88.364, tier: 'metro', port: true, airport: true, domestic: true },
  { name: 'Hyderabad', lat: 17.385, lon: 78.487, tier: 'metro', port: false, airport: true, domestic: true },
  { name: 'Ahmedabad', lat: 23.023, lon: 72.572, tier: 'metro', port: false, airport: true, domestic: true },
  { name: 'Pune', lat: 18.520, lon: 73.857, tier: 'metro', port: false, airport: true, domestic: true },
  { name: 'Kochi', lat: 9.932, lon: 76.267, tier: 'tier2', port: true, airport: true, domestic: true },
  { name: 'Visakhapatnam', lat: 17.687, lon: 83.219, tier: 'tier2', port: true, airport: true, domestic: true },
  { name: 'Goa', lat: 15.299, lon: 74.124, tier: 'tier2', port: true, airport: true, domestic: true },
  { name: 'Mangaluru', lat: 12.914, lon: 74.856, tier: 'tier2', port: true, airport: true, domestic: true },
  { name: 'Tuticorin', lat: 8.764, lon: 78.135, tier: 'tier2', port: true, airport: false, domestic: true },
  { name: 'Mundra', lat: 22.839, lon: 69.721, tier: 'tier2', port: true, airport: false, domestic: true },
  { name: 'Nhava Sheva', lat: 18.949, lon: 72.951, tier: 'tier2', port: true, airport: false, domestic: true },
  { name: 'Jaipur', lat: 26.912, lon: 75.787, tier: 'tier2', port: false, airport: true, domestic: true },
  { name: 'Lucknow', lat: 26.847, lon: 80.947, tier: 'tier2', port: false, airport: true, domestic: true },
  { name: 'Chandigarh', lat: 30.733, lon: 76.780, tier: 'tier2', port: false, airport: true, domestic: true },
  { name: 'Indore', lat: 22.720, lon: 75.858, tier: 'tier2', port: false, airport: true, domestic: true },
  { name: 'Nagpur', lat: 21.146, lon: 79.089, tier: 'tier2', port: false, airport: true, domestic: true },
  { name: 'Surat', lat: 21.170, lon: 72.831, tier: 'tier2', port: false, airport: true, domestic: true },
  { name: 'Coimbatore', lat: 11.017, lon: 76.956, tier: 'tier2', port: false, airport: true, domestic: true },
  { name: 'Bhubaneswar', lat: 20.296, lon: 85.825, tier: 'tier2', port: false, airport: true, domestic: true },
  { name: 'Guwahati', lat: 26.144, lon: 91.736, tier: 'tier2', port: false, airport: true, domestic: true },
  { name: 'Ludhiana', lat: 30.901, lon: 75.857, tier: 'tier2', port: false, airport: false, domestic: true },
  { name: 'Vadodara', lat: 22.307, lon: 73.181, tier: 'tier2', port: false, airport: true, domestic: true },
  { name: 'Dubai', lat: 25.205, lon: 55.271, tier: 'metro', port: false, airport: true, domestic: false },
  { name: 'Jebel Ali', lat: 25.011, lon: 55.061, tier: 'metro', port: true, airport: false, domestic: false },
  { name: 'Singapore', lat: 1.352, lon: 103.820, tier: 'metro', port: true, airport: true, domestic: false },
  { name: 'Rotterdam', lat: 51.925, lon: 4.478, tier: 'metro', port: true, airport: false, domestic: false },
  { name: 'London', lat: 51.507, lon: -0.128, tier: 'metro', port: false, airport: true, domestic: false },
  { name: 'Bangkok', lat: 13.756, lon: 100.502, tier: 'metro', port: true, airport: true, domestic: false },
  { name: 'Shanghai', lat: 31.230, lon: 121.474, tier: 'metro', port: true, airport: true, domestic: false },
  { name: 'Colombo', lat: 6.927, lon: 79.861, tier: 'metro', port: true, airport: true, domestic: false },
  { name: 'Hamburg', lat: 53.551, lon: 9.994, tier: 'metro', port: true, airport: true, domestic: false },
  { name: 'Jeddah', lat: 21.486, lon: 39.192, tier: 'metro', port: true, airport: true, domestic: false },
  { name: 'Hong Kong', lat: 22.319, lon: 114.169, tier: 'metro', port: true, airport: true, domestic: false },
  { name: 'New York', lat: 40.713, lon: -74.006, tier: 'metro', port: true, airport: true, domestic: false },
];

const byName = new Map(cities.map((city) => [city.name, city]));

export function city(name: string): City {
  const found = byName.get(name);
  if (!found) throw new Error(`Unknown demo city: ${name}`);
  return found;
}

export function distanceKm(from: City, to: City): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const halfLat = radians(to.lat - from.lat) / 2;
  const halfLon = radians(to.lon - from.lon) / 2;
  const chord = Math.sin(halfLat) ** 2 + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(halfLon) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(chord)));
}

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function random(seed: string): () => number {
  let state = hash(seed) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let drawn = Math.imul(state ^ (state >>> 15), 1 | state);
    drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn;
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296;
  };
}

// A mode is offered only where a freight desk would quote it for that geography.
export function modesFor(origin: City, destination: City, kilometres: number): Mode[] {
  const modes: Mode[] = [];
  const crossBorder = origin.domestic !== destination.domestic;
  const domesticPair = origin.domestic && destination.domestic;
  if (domesticPair && kilometres <= 2000) modes.push('road');
  if (origin.airport && destination.airport && kilometres >= (domesticPair ? 700 : 400)) modes.push('air');
  if (origin.port && destination.port && kilometres >= 700) modes.push('sea');
  // Short domestic hauls are trucked, not couriered — road already answers that lane.
  const courierRedundant = modes.includes('road') && kilometres < 800;
  if (kilometres >= 250 && !courierRedundant && (!crossBorder || origin.airport || destination.airport)) modes.push('courier');
  return modes;
}

function baseRate(mode: Mode, kilometres: number, crossBorder: boolean): number {
  const border = crossBorder ? 1.18 : 1;
  if (mode === 'air') return Math.round((58 + kilometres * 0.0165) * border * 100) / 100;
  if (mode === 'sea') return Math.round((42_000 + kilometres * 11.5) * border);
  if (mode === 'road') return Math.round((5_200 + kilometres * 12.4) * border);
  return Math.round((260 + kilometres * 0.085) * border * 100) / 100;
}

function transitDays(mode: Mode, kilometres: number): number {
  if (mode === 'air') return Math.max(2, Math.round(1.5 + kilometres / 4200));
  if (mode === 'sea') return Math.max(8, Math.round(6 + kilometres / 430));
  if (mode === 'road') return Math.max(1, Math.round(0.7 + kilometres / 480));
  return Math.max(3, Math.round(2.4 + kilometres / 1900));
}

// Coverage is a declaration, not an inference: most lanes are supported, some need a
// desk check, a few are not served. Deterministic so a reseed does not reshuffle it.
function coverageFor(origin: string, destination: string, mode: Mode): Coverage {
  const draw = hash(`coverage:${origin}:${destination}:${mode}`) % 100;
  if (draw < 70) return 'supported';
  if (draw < 90) return 'on_request';
  return 'not_supported';
}

// Which destinations an origin serves, shaped like a real export desk rather than a
// cartesian product: every metro is on the trunk network, nearby tier-2 cities are
// corridor traffic, air and courier leave through the gateways that city actually
// feeds, and an Indian port can ship to any foreign port by sea.
const NEARBY_TIER2 = 3;
const TIER2_AIR_GATEWAYS = 3;
const METRO_AIR_GATEWAYS = ['Dubai', 'Singapore', 'London', 'Hong Kong', 'New York'];

type Candidate = { destination: City; kilometres: number; allow: Mode[] | null };

function destinationsFor(origin: City): Candidate[] {
  const ranked = cities
    .filter((destination) => destination.name !== origin.name)
    .map((destination) => ({ destination, kilometres: distanceKm(origin, destination) }))
    .sort((left, right) => left.kilometres - right.kilometres);
  const domestic = ranked.filter((entry) => entry.destination.domestic);
  const trunk = domestic.filter((entry) => entry.destination.tier === 'metro');
  const corridor = domestic.filter((entry) => entry.destination.tier === 'tier2').slice(0, NEARBY_TIER2);
  const airGateways = origin.tier === 'metro'
    ? ranked.filter((entry) => METRO_AIR_GATEWAYS.includes(entry.destination.name))
    : ranked.filter((entry) => !entry.destination.domestic && entry.destination.airport).slice(0, TIER2_AIR_GATEWAYS);
  const seaGateways = origin.port ? ranked.filter((entry) => !entry.destination.domestic && entry.destination.port) : [];
  const candidates = new Map<string, Candidate>();
  for (const entry of [...trunk, ...corridor]) candidates.set(entry.destination.name, { ...entry, allow: null });
  for (const entry of airGateways) {
    const existing = candidates.get(entry.destination.name);
    candidates.set(entry.destination.name, { ...entry, allow: existing?.allow === null ? null : [...(existing?.allow ?? []), 'air', 'courier'] });
  }
  for (const entry of seaGateways) {
    const existing = candidates.get(entry.destination.name);
    candidates.set(entry.destination.name, { ...entry, allow: existing?.allow === null ? null : [...(existing?.allow ?? []), 'sea'] });
  }
  return [...candidates.values()];
}

export function generateLanes(): Lane[] {
  const lanes: Lane[] = [];
  for (const origin of cities) {
    if (!origin.domestic) continue;
    for (const { destination, kilometres, allow } of destinationsFor(origin)) {
      const domesticPair = destination.domestic;
      const plausible = modesFor(origin, destination, kilometres);
      for (const mode of allow === null ? plausible : plausible.filter((candidate) => allow.includes(candidate))) {
        lanes.push({
          origin: origin.name,
          destination: destination.name,
          mode,
          unit: UNIT[mode],
          coverage: coverageFor(origin.name, destination.name, mode),
          distanceKm: kilometres,
          transitDays: transitDays(mode, kilometres),
          base: baseRate(mode, kilometres, !domesticPair),
          crossBorder: !domesticPair,
        });
      }
    }
  }
  return lanes;
}

// Indian freight has a real annual shape: rates climb into the pre-Diwali export push,
// again before Chinese New Year as Asian capacity tightens, and soften through monsoon.
// Ocean freight swings hardest, road the least.
export function seasonalFactor(mode: Mode, date: Date): number {
  const month = date.getUTCMonth() + 1 + date.getUTCDate() / 31;
  const amplitude = mode === 'sea' ? 0.11 : mode === 'air' ? 0.085 : mode === 'courier' ? 0.05 : 0.035;
  const diwali = Math.exp(-((month - 10.6) ** 2) / 0.9);
  const lunarNewYear = Math.exp(-((month - 1.8) ** 2) / 0.8);
  const monsoon = -0.45 * Math.exp(-((month - 7.2) ** 2) / 1.5);
  return amplitude * (diwali + 0.65 * lunarNewYear + monsoon);
}

export function priceSeries(lane: Lane, weeks: number, now: Date): PricePoint[] {
  const draw = random(`price:${lane.origin}:${lane.destination}:${lane.mode}`);
  const drift = 0.0009 + draw() * 0.0026;
  const margin = 0.6 + draw() * 0.12;
  const noiseScale = 0.012 + draw() * 0.012;
  const points: PricePoint[] = [];
  for (let week = 0; week < weeks; week += 1) {
    const observedAt = new Date(now.getTime() - (weeks - 1 - week) * 7 * MS_PER_DAY);
    const trend = 1 + drift * week;
    const noise = (draw() - 0.5) * 2 * noiseScale;
    const sellingPrice = lane.base * trend * (1 + seasonalFactor(lane.mode, observedAt) + noise);
    const rounded = lane.mode === 'sea' || lane.mode === 'road' ? Math.round(sellingPrice) : Math.round(sellingPrice * 100) / 100;
    points.push({ week, observedAt, sellingPrice: rounded, buyingCost: Math.round(rounded * margin * 100) / 100 });
  }
  return points;
}

// Reliability is judged on what happened lately, so the record is dense in the last two
// weeks and thinner before that. Some lanes are given a genuinely bad current week.
export function deliverySeries(lane: Lane, now: Date): DeliveryPoint[] {
  const key = `delivery:${lane.origin}:${lane.destination}:${lane.mode}`;
  const draw = random(key);
  const baselineLateRate = 0.08 + (hash(key) % 9) / 100;
  const strugglingNow = hash(`${key}:recent`) % 5 === 0;
  const offsets = [
    ...Array.from({ length: 14 }, (_, index) => -13 + index),
    ...Array.from({ length: 8 }, (_, index) => -20 - index * 2),
    ...Array.from({ length: 8 }, (_, index) => -38 - index * 6),
  ];
  return offsets.map((offset, index) => {
    const promisedAt = new Date(now.getTime() + offset * MS_PER_DAY);
    const recent = offset >= -7;
    const lateRate = recent && strugglingNow ? 0.45 : baselineLateRate;
    const roll = draw();
    const delayDays = roll < lateRate ? 1 + Math.floor(draw() * (lane.mode === 'sea' ? 4 : 3)) : roll > 0.93 ? -1 : 0;
    const settled = promisedAt.getTime() + delayDays * MS_PER_DAY <= now.getTime();
    const actualAt = settled ? new Date(promisedAt.getTime() + delayDays * MS_PER_DAY) : null;
    return {
      index,
      promisedAt,
      actualAt,
      observedAt: actualAt ?? new Date(Math.min(now.getTime(), promisedAt.getTime())),
      issue: delayDays > 0 ? ISSUES[hash(`${key}:${index}`) % ISSUES.length] : null,
    };
  });
}
