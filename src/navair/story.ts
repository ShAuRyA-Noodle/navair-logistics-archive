/**
 * Story content: chapters (timeline seconds) and all copy.
 * One timeline second ≈ one viewport of scroll.
 */

export interface Chapter {
  id: string;
  label: string;
  /** Start, timeline seconds. */
  t: number;
}

export const CHAPTERS: Chapter[] = [
  { id: 'stack', label: 'The stack', t: 0 },
  { id: 'lift', label: 'First lift', t: 3.2 },
  { id: 'handover', label: 'Handover', t: 7.4 },
  { id: 'road', label: 'On the road', t: 12 },
  { id: 'route', label: 'The route', t: 18.2 },
  { id: 'berth', label: 'The berth', t: 25.6 },
  { id: 'sea', label: 'Open water', t: 32.2 },
];

/** Total timeline length (seconds) – the track is this many viewports tall. */
export const DURATION = 39.5;

export const SERVICES = [
  ['01', 'Ocean freight', 'FCL and LCL on every major trade lane, carrier chosen for the cargo, not the commission.'],
  ['02', 'Air freight', 'Express, priority and deferred, booked on the same file as the rest of the move.'],
  ['03', 'Customs brokerage', 'Licensed and in-house. Entries lodged before the box leaves the berth.'],
  ['04', 'Warehousing & 3PL', 'Storage, pick-pack and cross-dock, integrated with the trucks that feed it.'],
  ['05', 'Project cargo', 'Out-of-gauge and engineered loads: permits, escorts, lift plans.'],
  ['06', 'Domestic transport', 'Metro, regional and interstate, with live position on every leg.'],
] as const;

export const FEATURES = [
  ['Live position', 'Every box reports in. Know where it is before anyone has to ask.'],
  ['One network', 'Owned trucks, contracted lanes and partner berths on a single plan.'],
  ['People, 24/7', 'A named operator who picks up the phone and owns the outcome.'],
] as const;
