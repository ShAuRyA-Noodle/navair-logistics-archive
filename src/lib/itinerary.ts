// Connecting-route planner. A first-time exporter types two cities that Navair may not
// serve end to end. Rather than a dead end, we look for a way around: Jaipur to Bangkok
// via Mumbai, for instance. The planner only ever combines lanes that exist in the public
// catalog and are not declared unsupported, so an itinerary is a real chain of services
// rather than a suggestion that something might be possible.
//
// Deliberately NOT done here: adding prices across legs. Legs are quoted in different
// units (per kilogram, per container, per shipment), so a summed total would be a
// fabricated number. Each leg carries its own rate and the caller shows them separately.

export type GraphLane = {
  id: string;
  origin: string;
  destination: string;
  mode: string;
  unit: string;
  serviceCoverage: 'supported' | 'on_request' | 'not_supported' | 'unknown';
  distanceKm: number | null;
  transitDays: number | null;
  crossBorder: boolean | null;
};

export type ItineraryLeg = { routeId: string; origin: string; destination: string; mode: string; unit: string; serviceCoverage: GraphLane['serviceCoverage']; transitDays: number | null; distanceKm: number | null; crossBorder: boolean | null };
export type Itinerary = {
  legs: ItineraryLeg[];
  transitDays: number | null;
  handoverDays: number;
  totalDays: number | null;
  needsDeskCheck: boolean;
  summary: string;
};

// A transfer between services is not free: cargo has to be received, re-documented and
// re-loaded. One day per interchange is the desk's working assumption.
const HANDOVER_DAYS = 1;
const MAX_LEGS = 3;
const MAX_RESULTS = 3;
// Unknown transit time must not look like a fast lane during comparison, so it is scored
// pessimistically while still being reported as unknown to the reader.
const UNKNOWN_LEG_PENALTY_DAYS = 30;

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();

function fastest(lanes: GraphLane[]): GraphLane {
  return lanes.reduce((best, lane) => {
    const bestDays = best.transitDays ?? UNKNOWN_LEG_PENALTY_DAYS;
    const laneDays = lane.transitDays ?? UNKNOWN_LEG_PENALTY_DAYS;
    if (laneDays !== bestDays) return laneDays < bestDays ? lane : best;
    if (lane.serviceCoverage === 'supported' && best.serviceCoverage !== 'supported') return lane;
    return best;
  });
}

function toLeg(lane: GraphLane): ItineraryLeg {
  return {
    routeId: lane.id,
    origin: lane.origin,
    destination: lane.destination,
    mode: lane.mode,
    unit: lane.unit,
    serviceCoverage: lane.serviceCoverage,
    transitDays: lane.transitDays,
    distanceKm: lane.distanceKm,
    crossBorder: lane.crossBorder,
  };
}

function describe(legs: ItineraryLeg[], totalDays: number | null): string {
  const path = [legs[0].origin, ...legs.map((leg) => leg.destination)].join(' → ');
  const modes = legs.map((leg) => leg.mode).join(', then ');
  const timing = totalDays === null ? 'transit time not stated' : `about ${totalDays} day${totalDays === 1 ? '' : 's'} in total`;
  return `${path} by ${modes} — ${timing}, with ${legs.length - 1} transfer${legs.length - 1 === 1 ? '' : 's'} on the way.`;
}

function score(itinerary: Itinerary): number {
  const days = itinerary.totalDays ?? UNKNOWN_LEG_PENALTY_DAYS * itinerary.legs.length;
  return days + (itinerary.legs.length - 1) * 2 + (itinerary.needsDeskCheck ? 1 : 0);
}

function build(legs: ItineraryLeg[]): Itinerary {
  const stated = legs.map((leg) => leg.transitDays);
  const transitDays = stated.some((days) => days === null)
    ? null
    : stated.reduce<number>((sum, days) => sum + (days ?? 0), 0);
  const handoverDays = (legs.length - 1) * HANDOVER_DAYS;
  const totalDays = transitDays === null ? null : transitDays + handoverDays;
  return {
    legs,
    transitDays,
    handoverDays,
    totalDays,
    needsDeskCheck: legs.some((leg) => leg.serviceCoverage !== 'supported'),
    summary: describe(legs, totalDays),
  };
}

export type RoutePlan = {
  origin: string | null;
  destination: string | null;
  direct: ItineraryLeg[];
  connecting: Itinerary[];
  outcome: 'direct' | 'connecting' | 'same_city' | 'unknown_origin' | 'unknown_destination' | 'unknown_both' | 'no_service';
  cities: { origins: string[]; destinations: string[] };
};

export function planRoute(lanes: GraphLane[], input: { origin: string; destination: string }): RoutePlan {
  const servable = lanes.filter((lane) => lane.serviceCoverage !== 'not_supported');
  const canonical = new Map<string, string>();
  for (const lane of servable) {
    canonical.set(normalize(lane.origin), lane.origin);
    canonical.set(normalize(lane.destination), lane.destination);
  }
  const origins = [...new Set(servable.map((lane) => lane.origin))].sort((left, right) => left.localeCompare(right));
  const destinations = [...new Set(servable.map((lane) => lane.destination))].sort((left, right) => left.localeCompare(right));
  const cities = { origins, destinations };
  const origin = canonical.get(normalize(input.origin)) ?? null;
  const destination = canonical.get(normalize(input.destination)) ?? null;

  if (!origin || !destination) {
    const outcome = !origin && !destination ? 'unknown_both' : !origin ? 'unknown_origin' : 'unknown_destination';
    return { origin, destination, direct: [], connecting: [], outcome, cities };
  }
  if (origin === destination) return { origin, destination, direct: [], connecting: [], outcome: 'same_city', cities };

  const direct = servable
    .filter((lane) => lane.origin === origin && lane.destination === destination)
    .map(toLeg)
    .sort((left, right) => (left.transitDays ?? UNKNOWN_LEG_PENALTY_DAYS) - (right.transitDays ?? UNKNOWN_LEG_PENALTY_DAYS));

  const outbound = new Map<string, GraphLane[]>();
  for (const lane of servable) {
    const list = outbound.get(lane.origin);
    if (list) list.push(lane);
    else outbound.set(lane.origin, [lane]);
  }

  // Breadth-first over city paths. The catalog is small (tens of cities), so enumerating
  // every path of up to three legs is cheaper and easier to reason about than a heuristic.
  const connecting: Itinerary[] = [];
  const queue: Array<{ city: string; visited: string[]; legs: ItineraryLeg[] }> = [{ city: origin, visited: [origin], legs: [] }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.legs.length >= MAX_LEGS) continue;
    const grouped = new Map<string, GraphLane[]>();
    for (const lane of outbound.get(current.city) ?? []) {
      if (current.visited.includes(lane.destination)) continue;
      const list = grouped.get(lane.destination);
      if (list) list.push(lane);
      else grouped.set(lane.destination, [lane]);
    }
    for (const [nextCity, options] of grouped) {
      const legs = [...current.legs, toLeg(fastest(options))];
      if (nextCity === destination) {
        if (legs.length > 1) connecting.push(build(legs));
        continue;
      }
      queue.push({ city: nextCity, visited: [...current.visited, nextCity], legs });
    }
  }

  const ranked = connecting
    .sort((left, right) => score(left) - score(right))
    .filter((itinerary, index, all) => all.findIndex((other) => other.summary === itinerary.summary) === index)
    .slice(0, MAX_RESULTS);

  return {
    origin,
    destination,
    direct,
    connecting: ranked,
    outcome: direct.length > 0 ? 'direct' : ranked.length > 0 ? 'connecting' : 'no_service',
    cities,
  };
}
