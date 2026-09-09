// The shipment lifecycle, in one place. Both the server (validating a status change) and
// the browser (drawing the tracker) read this file, because a state machine kept in two
// places drifts, and the old duplicate between operations.ts and the admin page is exactly
// how a widened enum breaks a working flow.
//
// Every stage carries the plain sentence a first-time exporter should read. No freight
// vocabulary is left for the reader to decode.

export type StageKey =
  | 'accepted' | 'booked' | 'collected' | 'at_origin_warehouse' | 'packing'
  | 'in_transit' | 'hub_transfer' | 'customs' | 'out_for_delivery' | 'delivered';
export type ShipmentStatus = StageKey | 'cancelled';

export type LaneContext = {
  mode: string;
  transitDays: number | null;
  crossBorder: boolean | null;
  legs?: number;
};

type StageDefinition = {
  key: StageKey;
  label: string;
  plain: string;
  // Nominal days this stage adds to the journey. `transit` takes the lane's own figure.
  days: number | 'transit';
  applies: (lane: LaneContext) => boolean;
};

const always = () => true;
// Customs only exists on a border crossing. Where nobody has declared whether a lane
// crosses one, we leave the stage out rather than promise a clearance step that may not
// happen — an unstated flag is not the same as a domestic lane.
const crossBorderOnly = (lane: LaneContext) => lane.crossBorder === true;
// Long hauls are consolidated through a transfer hub; short ones run straight through.
const longHaulOnly = (lane: LaneContext) => (lane.legs ?? 1) > 1 || (lane.transitDays ?? 0) >= 5;

export const STAGES: StageDefinition[] = [
  { key: 'accepted', label: 'Order placed', plain: 'Navair has your order and the paperwork has started.', days: 0, applies: always },
  { key: 'booked', label: 'Space booked', plain: 'Room for your cargo is reserved with the carrier.', days: 1, applies: always },
  { key: 'collected', label: 'Picked up', plain: 'Your cargo has been collected from you.', days: 1, applies: always },
  { key: 'at_origin_warehouse', label: 'At the warehouse', plain: 'It has arrived at the Navair warehouse and been checked in.', days: 1, applies: always },
  { key: 'packing', label: 'Packed for the journey', plain: 'It has been packed, labelled and made ready to travel.', days: 1, applies: always },
  { key: 'in_transit', label: 'On the way', plain: 'Your cargo has left and is travelling.', days: 'transit', applies: always },
  { key: 'hub_transfer', label: 'Changing over', plain: 'It is being moved from one vehicle or warehouse to the next.', days: 0, applies: longHaulOnly },
  { key: 'customs', label: 'Customs clearance', plain: 'Officials are checking the paperwork before release.', days: 2, applies: crossBorderOnly },
  { key: 'out_for_delivery', label: 'Out for delivery', plain: 'It is on the final vehicle, heading to the address.', days: 1, applies: always },
  { key: 'delivered', label: 'Delivered', plain: 'Your cargo has arrived. The journey is complete.', days: 0, applies: always },
];

export const STAGE_ORDER = STAGES.map((stage) => stage.key);

// Every stage a human can move a shipment to. 'accepted' is absent because acceptance is
// what creates the shipment. Written out as a literal so zod can build an enum from it,
// with a compile-time check below that it stays in step with STAGES.
export const UPDATABLE_STATUSES = [
  'booked', 'collected', 'at_origin_warehouse', 'packing', 'in_transit',
  'hub_transfer', 'customs', 'out_for_delivery', 'delivered', 'cancelled',
] as const;
type UpdatableCoversEveryStage = Exclude<StageKey, 'accepted' | typeof UPDATABLE_STATUSES[number]> extends never ? true : never;
const updatableIsComplete: UpdatableCoversEveryStage = true;
void updatableIsComplete;
const INDEX = new Map<StageKey, number>(STAGE_ORDER.map((key, index) => [key, index]));
const CUSTOMS_DAYS: Record<string, number> = { sea: 3, air: 1, courier: 1, road: 1 };

export function isStatus(value: string): value is ShipmentStatus {
  return value === 'cancelled' || INDEX.has(value as StageKey);
}

export function stageLabel(status: string): string {
  return STAGES.find((stage) => stage.key === status)?.label ?? (status === 'cancelled' ? 'Cancelled' : status.replaceAll('_', ' '));
}

export function stagePlain(status: string): string {
  return STAGES.find((stage) => stage.key === status)?.plain
    ?? (status === 'cancelled' ? 'This shipment was cancelled and is no longer moving.' : '');
}

function stageDays(stage: StageDefinition, lane: LaneContext): number {
  if (stage.days === 'transit') return Math.max(1, lane.transitDays ?? 3);
  if (stage.key === 'customs') return CUSTOMS_DAYS[lane.mode] ?? 2;
  return stage.days;
}

export function applicableStages(lane: LaneContext): StageDefinition[] {
  return STAGES.filter((stage) => stage.applies(lane));
}

// Staff may jump forward to any later stage that applies to this lane: a stage that does
// not happen on a given route must never block the shipment behind it. Backwards moves are
// refused, except that customs can return to transit when goods are released.
export function nextStages(current: string, lane: LaneContext): ShipmentStatus[] {
  if (current === 'delivered' || current === 'cancelled') return [];
  const position = INDEX.get(current as StageKey);
  if (position === undefined) return [];
  const forward = applicableStages(lane)
    .filter((stage) => (INDEX.get(stage.key) ?? -1) > position)
    .map((stage) => stage.key);
  const back: ShipmentStatus[] = current === 'customs' ? ['in_transit'] : [];
  return [...forward, ...back, 'cancelled'];
}

export type PlannedStage = {
  key: StageKey;
  label: string;
  plain: string;
  date: string;
  dayOffset: number;
};

// Two ways to anchor the same plan. Before a booking exists we count forward from the date
// the cargo is ready. Once a shipment is real we stretch the same shape across the window
// the customer was actually promised, so the plan can never contradict the agreed date.
export type PlanAnchor =
  | { kind: 'from'; start: Date | string }
  | { kind: 'between'; start: Date | string; end: Date | string };

const MS_PER_DAY = 86_400_000;

function asDate(value: Date | string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError('An anchor date must be a valid date');
  return date;
}

export function journeyPlan(lane: LaneContext, anchor: PlanAnchor): PlannedStage[] {
  const stages = applicableStages(lane);
  let cumulative = 0;
  const offsets = stages.map((stage) => {
    cumulative += stageDays(stage, lane);
    return { stage, offset: cumulative };
  });
  const total = cumulative || 1;
  const start = asDate(anchor.start);
  const windowDays = anchor.kind === 'between'
    ? Math.max(1, (asDate(anchor.end).getTime() - start.getTime()) / MS_PER_DAY)
    : total;
  return offsets.map(({ stage, offset }) => {
    const scaled = (offset / total) * windowDays;
    return {
      key: stage.key,
      label: stage.label,
      plain: stage.plain,
      dayOffset: Math.round(scaled * 10) / 10,
      date: new Date(start.getTime() + scaled * MS_PER_DAY).toISOString(),
    };
  });
}

export type TrackedStage = PlannedStage & {
  state: 'done' | 'current' | 'ahead' | 'skipped';
  happenedAt: string | null;
  varianceDays: number | null;
  note: string | null;
};

// Overlay what actually happened on what was planned. A stage counts as done when an event
// carries its name, and the stage after the furthest done one is where the cargo is now.
// A stage the shipment has already moved past without ever being logged is 'skipped', not
// 'ahead': claiming a delivered shipment still has packing to come would be a lie.
export function trackJourney(
  plan: PlannedStage[],
  events: Array<{ status: string; occurredAt: string; description?: string | null }>,
  options: { cancelled?: boolean } = {},
): TrackedStage[] {
  const latest = new Map<string, { occurredAt: string; description?: string | null }>();
  for (const event of events) {
    const known = latest.get(event.status);
    if (!known || new Date(event.occurredAt).getTime() > new Date(known.occurredAt).getTime()) {
      latest.set(event.status, { occurredAt: event.occurredAt, description: event.description });
    }
  }
  const reached = plan.reduce((furthest, stage, index) => (latest.has(stage.key) ? index : furthest), -1);
  return plan.map((stage, index) => {
    const event = latest.get(stage.key);
    const happenedAt = event?.occurredAt ?? null;
    const variance = happenedAt
      ? Math.round(((new Date(happenedAt).getTime() - new Date(stage.date).getTime()) / MS_PER_DAY) * 10) / 10
      : null;
    const state: TrackedStage['state'] = event
      ? 'done'
      : index < reached
        ? 'skipped'
        : !options.cancelled && index === reached + 1
          ? 'current'
          : 'ahead';
    return { ...stage, state, happenedAt, varianceDays: variance, note: event?.description ?? null };
  });
}

export function planSummary(plan: PlannedStage[]): { days: number; arrival: string | null } {
  const arrival = plan.at(-1);
  return {
    days: arrival ? Math.round(arrival.dayOffset) : 0,
    arrival: arrival?.date ?? null,
  };
}
