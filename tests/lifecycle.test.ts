import {describe,it,expect} from 'vitest';
import {applicableStages,journeyPlan,nextStages,planSummary,stageLabel,stagePlain,trackJourney,UPDATABLE_STATUSES,type LaneContext} from '../src/lib/lifecycle';

const seaExport: LaneContext = { mode: 'sea', transitDays: 21, crossBorder: true };
const roadDomestic: LaneContext = { mode: 'road', transitDays: 2, crossBorder: false };
const undeclared: LaneContext = { mode: 'air', transitDays: 3, crossBorder: null };

describe('applicable stages', () => {
  it('includes customs only where the lane crosses a border', () => {
    expect(applicableStages(seaExport).map((stage) => stage.key)).toContain('customs');
    expect(applicableStages(roadDomestic).map((stage) => stage.key)).not.toContain('customs');
  });

  it('leaves customs out when nobody has declared whether the lane crosses a border', () => {
    expect(applicableStages(undeclared).map((stage) => stage.key)).not.toContain('customs');
  });

  it('adds a transfer hop to long hauls and multi-leg journeys, not to short direct ones', () => {
    expect(applicableStages(seaExport).map((stage) => stage.key)).toContain('hub_transfer');
    expect(applicableStages(roadDomestic).map((stage) => stage.key)).not.toContain('hub_transfer');
    expect(applicableStages({ ...roadDomestic, legs: 2 }).map((stage) => stage.key)).toContain('hub_transfer');
  });

  it('always keeps the warehouse and packing stages the customer asked to see', () => {
    for (const lane of [seaExport, roadDomestic, undeclared]) {
      const keys = applicableStages(lane).map((stage) => stage.key);
      expect(keys).toContain('at_origin_warehouse');
      expect(keys).toContain('packing');
      expect(keys).toContain('out_for_delivery');
    }
  });
});

describe('transitions', () => {
  it('lets staff skip forward past a stage that does not apply', () => {
    const options = nextStages('in_transit', roadDomestic);
    expect(options).toContain('out_for_delivery');
    expect(options).toContain('delivered');
    expect(options).not.toContain('customs');
  });

  it('never offers a backwards move, except customs releasing back into transit', () => {
    expect(nextStages('packing', seaExport)).not.toContain('collected');
    expect(nextStages('customs', seaExport)).toContain('in_transit');
  });

  it('treats delivered and cancelled as final', () => {
    expect(nextStages('delivered', seaExport)).toEqual([]);
    expect(nextStages('cancelled', seaExport)).toEqual([]);
  });

  it('allows cancellation from any live stage', () => {
    for (const stage of ['accepted', 'booked', 'collected', 'packing', 'in_transit']) {
      expect(nextStages(stage, seaExport)).toContain('cancelled');
    }
  });

  it('refuses a status nobody recognises', () => {
    expect(nextStages('teleported', seaExport)).toEqual([]);
  });

  it('keeps the updatable list free of the acceptance stage', () => {
    expect(UPDATABLE_STATUSES).not.toContain('accepted');
    expect(UPDATABLE_STATUSES).toContain('at_origin_warehouse');
  });
});

describe('journey plan', () => {
  it('counts forward from a ready date before any booking exists', () => {
    const plan = journeyPlan(roadDomestic, { kind: 'from', start: '2026-09-10T00:00:00.000Z' });
    expect(plan[0].key).toBe('accepted');
    expect(plan[0].dayOffset).toBe(0);
    expect(plan.at(-1)!.key).toBe('delivered');
    expect(planSummary(plan).days).toBeGreaterThan(0);
    for (let index = 1; index < plan.length; index += 1) {
      expect(new Date(plan[index].date).getTime()).toBeGreaterThanOrEqual(new Date(plan[index - 1].date).getTime());
    }
  });

  it('gives a sea export a longer plan than a domestic road run', () => {
    const sea = planSummary(journeyPlan(seaExport, { kind: 'from', start: '2026-09-10T00:00:00.000Z' }));
    const road = planSummary(journeyPlan(roadDomestic, { kind: 'from', start: '2026-09-10T00:00:00.000Z' }));
    expect(sea.days).toBeGreaterThan(road.days);
  });

  it('lands exactly on the promised date when anchored to a real shipment', () => {
    const promised = '2026-10-01T00:00:00.000Z';
    const plan = journeyPlan(seaExport, { kind: 'between', start: '2026-09-10T00:00:00.000Z', end: promised });
    expect(plan.at(-1)!.date).toBe(new Date(promised).toISOString());
  });

  it('still produces an ordered plan when the promised window is absurdly short', () => {
    const plan = journeyPlan(seaExport, { kind: 'between', start: '2026-09-10T00:00:00.000Z', end: '2026-09-10T06:00:00.000Z' });
    expect(plan.length).toBeGreaterThan(3);
    for (let index = 1; index < plan.length; index += 1) {
      expect(new Date(plan[index].date).getTime()).toBeGreaterThanOrEqual(new Date(plan[index - 1].date).getTime());
    }
  });

  it('falls back to a nominal transit time rather than a zero-day journey', () => {
    const plan = journeyPlan({ mode: 'air', transitDays: null, crossBorder: false }, { kind: 'from', start: '2026-09-10T00:00:00.000Z' });
    expect(planSummary(plan).days).toBeGreaterThanOrEqual(5);
  });

  it('rejects an unusable anchor date instead of inventing one', () => {
    expect(() => journeyPlan(roadDomestic, { kind: 'from', start: 'not-a-date' })).toThrow(RangeError);
  });
});

describe('tracking actual progress against the plan', () => {
  const plan = journeyPlan(seaExport, { kind: 'from', start: '2026-09-01T00:00:00.000Z' });

  it('marks reached stages done and the next one current', () => {
    const stages = trackJourney(plan, [
      { status: 'accepted', occurredAt: '2026-09-01T00:00:00.000Z', description: 'Order placed.' },
      { status: 'booked', occurredAt: '2026-09-02T00:00:00.000Z', description: 'Space booked.' },
    ]);
    expect(stages[0].state).toBe('done');
    expect(stages[1].state).toBe('done');
    expect(stages[2].state).toBe('current');
    expect(stages[3].state).toBe('ahead');
    expect(stages[1].note).toBe('Space booked.');
  });

  it('reports how many days late or early a stage actually ran', () => {
    const target = plan[2];
    const late = new Date(new Date(target.date).getTime() + 2 * 86400000).toISOString();
    const stages = trackJourney(plan, [{ status: target.key, occurredAt: late }]);
    expect(stages[2].varianceDays).toBeCloseTo(2, 1);

    const early = new Date(new Date(target.date).getTime() - 86400000).toISOString();
    expect(trackJourney(plan, [{ status: target.key, occurredAt: early }])[2].varianceDays).toBeCloseTo(-1, 1);
  });

  it('keeps the latest event when a stage was reported more than once', () => {
    const stages = trackJourney(plan, [
      { status: 'booked', occurredAt: '2026-09-02T00:00:00.000Z', description: 'first' },
      { status: 'booked', occurredAt: '2026-09-03T00:00:00.000Z', description: 'corrected' },
    ]);
    expect(stages[1].note).toBe('corrected');
    expect(stages[1].happenedAt).toBe('2026-09-03T00:00:00.000Z');
  });

  it('shows nothing as current once a shipment is cancelled', () => {
    const stages = trackJourney(plan, [{ status: 'accepted', occurredAt: '2026-09-01T00:00:00.000Z' }], { cancelled: true });
    expect(stages.some((stage) => stage.state === 'current')).toBe(false);
  });

  it('ignores an event for a stage this lane never has', () => {
    const domestic = journeyPlan(roadDomestic, { kind: 'from', start: '2026-09-01T00:00:00.000Z' });
    const stages = trackJourney(domestic, [{ status: 'customs', occurredAt: '2026-09-02T00:00:00.000Z' }]);
    expect(stages.every((stage) => stage.key !== 'customs')).toBe(true);
    expect(stages[0].state).toBe('current');
  });

  it('has a plain sentence for every stage and for cancellation', () => {
    for (const stage of plan) {
      expect(stagePlain(stage.key).length).toBeGreaterThan(10);
      expect(stageLabel(stage.key)).not.toContain('_');
    }
    expect(stagePlain('cancelled')).toContain('cancelled');
    expect(stageLabel('cancelled')).toBe('Cancelled');
  });
});
