import { describe, expect, it } from 'vitest';

import {
  forecastPrices,
  summarizeRadar,
  type PriceObservation,
  type ShipmentEvidence,
} from '../src/lib/analytics';

const now = new Date('2026-07-01T12:00:00.000Z');

function weeklyPrices(count: number): PriceObservation[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `price-${index}`,
    routeId: 'blr-dxb',
    mode: 'air',
    unit: 'kg',
    currency: 'USD',
    observedAt: new Date(Date.UTC(2026, 0, 5 + index * 7, 12)).toISOString(),
    sellingPrice: 100 + index * 2,
    isDemo: index === 0,
  }));
}

describe('forecastPrices', () => {
  it('rejects invalid request options', () => {
    expect(() => forecastPrices([], {
      routeId: '', mode: 'air', unit: 'kg', currency: 'USD', weeks: 1, confidence: 80,
    })).toThrow(RangeError);
    expect(() => forecastPrices([], {
      routeId: 'blr-dxb', mode: 'air', unit: 'kg', currency: 'USD', weeks: 0, confidence: 80,
    })).toThrow(RangeError);
    expect(() => forecastPrices([], {
      routeId: 'blr-dxb', mode: 'air', unit: 'kg', currency: 'USD', weeks: 9, confidence: 80,
    })).toThrow(RangeError);
    expect(() => forecastPrices([], {
      routeId: 'blr-dxb', mode: 'air', unit: 'kg', currency: 'USD', weeks: 2, confidence: 90 as 80,
    })).toThrow(RangeError);
  });

  it('does not create a forecast from fewer than sixteen comparable historical weeks', () => {
    const result = forecastPrices([
      ...weeklyPrices(15),
      { ...weeklyPrices(1)[0], id: 'different-mode', mode: 'ocean' },
      { ...weeklyPrices(1)[0], id: 'future', observedAt: '2026-08-03T12:00:00.000Z' },
    ], {
      routeId: 'blr-dxb', mode: 'air', unit: 'kg', currency: 'USD', weeks: 4, confidence: 80,
      now: new Date('2026-04-15T12:00:00.000Z'),
    });

    expect(result.status).toBe('insufficient_data');
    expect(result.points).toEqual([]);
    expect(result.history).toHaveLength(15);
    expect(result.dataThrough).toBe('2026-04-13T12:00:00.000Z');
    expect(result.reason).toMatch(/16/i);
  });

  it('uses deduplicated comparable selling prices and reports calibrated holdout evidence', () => {
    const observations = [
      ...weeklyPrices(24),
      {
        ...weeklyPrices(1)[0],
        id: 'price-3',
        observedAt: '2026-01-26T09:00:00.000Z',
        sellingPrice: 999,
        isDemo: false,
      },
    ];

    const result80 = forecastPrices(observations, {
      routeId: 'blr-dxb', mode: 'air', unit: 'kg', currency: 'USD', weeks: 2, confidence: 80,
      now: new Date('2026-06-17T12:00:00.000Z'),
    });
    const result95 = forecastPrices(observations, {
      routeId: 'blr-dxb', mode: 'air', unit: 'kg', currency: 'USD', weeks: 2, confidence: 95,
      now: new Date('2026-06-17T12:00:00.000Z'),
    });

    expect(result80.status).toBe('available');
    expect(result80.isDemo).toBe(true);
    expect(result80.label).toMatch(/experimental demo/i);
    expect(result80.history).toHaveLength(24);
    expect(result80.history[3]).toEqual({ date: '2026-01-26', price: 106 });
    expect(result80.referencePrice).toBe(146);
    expect(result80.points).toHaveLength(2);
    expect(result80.points[0]).toMatchObject({ week: 1, date: '2026-06-22', estimate: 148 });
    expect(result80.points[0].lower).toBe(result80.points[0].estimate);
    expect(result80.points[0].upper).toBe(result80.points[0].estimate);
    expect(result80.metrics.backtestCount).toBeGreaterThan(0);
    expect(result80.metrics.mae).not.toBeNull();
    expect(result80.metrics.coverage).not.toBeNull();
    expect(result80.dataThrough).toBe('2026-06-15T12:00:00.000Z');
    expect(new Date(result80.points[0].date).getTime()).toBeGreaterThan(new Date('2026-06-17T12:00:00.000Z').getTime());
    expect(result80.points.map((point) => point.estimate)).toEqual(
      result95.points.map((point) => point.estimate),
    );
    expect(result95.points[0].upper - result95.points[0].estimate).toBeGreaterThanOrEqual(
      result80.points[0].upper - result80.points[0].estimate,
    );
  });

  it('refuses stale history instead of emitting points dated before the request time', () => {
    const result = forecastPrices(weeklyPrices(24), {
      routeId: 'blr-dxb', mode: 'air', unit: 'kg', currency: 'USD', weeks: 2, confidence: 80, now,
    });

    expect(result.status).toBe('insufficient_data');
    expect(result.points).toEqual([]);
    expect(result.reason).toMatch(/14 days/i);
    expect(result.dataThrough).toBe('2026-06-15T12:00:00.000Z');
  });

  it('requires independently validated residuals per requested horizon for real records', () => {
    const realObservations = weeklyPrices(16).map((observation) => ({ ...observation, isDemo: false }));
    const result = forecastPrices(realObservations, {
      routeId: 'blr-dxb', mode: 'air', unit: 'kg', currency: 'USD', weeks: 8, confidence: 80,
      now: new Date('2026-04-22T12:00:00.000Z'),
    });

    expect(result.status).toBe('insufficient_data');
    expect(result.reason).toMatch(/independent/i);
  });

  it('refuses a local synthetic projection when its requested horizon lacks independent residual support', () => {
    const result = forecastPrices(weeklyPrices(16), {
      routeId: 'blr-dxb', mode: 'air', unit: 'kg', currency: 'USD', weeks: 2, confidence: 80,
      now: new Date('2026-04-22T12:00:00.000Z'),
    });

    expect(result.status).toBe('insufficient_data');
    expect(result.points).toEqual([]);
    expect(result.reason).toMatch(/independent/i);
    expect(result.metrics).toEqual({ mae: null, coverage: null, backtestCount: 0 });
  });

  it('reports coverage from later holdouts rather than the residuals used for interval calibration', () => {
    const observations = weeklyPrices(24).map((observation, index) => ({
      ...observation,
      isDemo: false,
      sellingPrice: index < 16 ? 100 + index * 2 : 180 + (index - 16) * 25,
    }));
    const result = forecastPrices(observations, {
      routeId: 'blr-dxb', mode: 'air', unit: 'kg', currency: 'USD', weeks: 1, confidence: 80,
      now: new Date('2026-06-17T12:00:00.000Z'),
    });

    expect(result.status).toBe('available');
    expect(result.label).toMatch(/experimental.*not market-ready/i);
    expect(result.metrics.coverage).not.toBe(0.8);
    expect(result.metrics.backtestCount).toBeGreaterThan(0);
  });
});

describe('summarizeRadar', () => {
  const baseEvidence: ShipmentEvidence[] = [
    {
      id: 'late-two-days', routeId: 'blr-dxb', mode: 'air', promisedAt: '2026-06-20T12:00:00.000Z',
      actualAt: '2026-06-22T12:00:00.000Z', observedAt: '2026-06-22T14:00:00.000Z', issue: 'customs hold', isDemo: true,
    },
    {
      id: 'late-one-day', routeId: 'blr-dxb', mode: 'air', promisedAt: '2026-06-21T12:00:00.000Z',
      actualAt: '2026-06-22T12:00:00.000Z', observedAt: '2026-06-22T14:00:00.000Z', issue: 'weather', isDemo: false,
    },
    {
      id: 'early', routeId: 'blr-dxb', mode: 'air', promisedAt: '2026-06-25T12:00:00.000Z',
      actualAt: '2026-06-24T12:00:00.000Z', observedAt: '2026-06-24T14:00:00.000Z', issue: null, isDemo: false,
    },
    {
      id: 'on-time', routeId: 'blr-dxb', mode: 'air', promisedAt: '2026-06-26T12:00:00.000Z',
      actualAt: '2026-06-26T12:00:00.000Z', observedAt: '2026-06-26T14:00:00.000Z', issue: null, isDemo: false,
    },
    {
      id: 'overdue', routeId: 'blr-dxb', mode: 'air', promisedAt: '2026-06-27T12:00:00.000Z',
      actualAt: null, observedAt: '2026-06-30T14:00:00.000Z', issue: 'awaiting update', isDemo: false,
    },
    {
      id: 'stale', routeId: 'blr-dxb', mode: 'air', promisedAt: '2025-01-01T12:00:00.000Z',
      actualAt: '2025-01-02T12:00:00.000Z', observedAt: '2025-01-02T14:00:00.000Z', issue: 'old issue', isDemo: false,
    },
  ];

  it('distinguishes late, early, and ongoing-overdue shipments without personal data', () => {
    const result = summarizeRadar(baseEvidence, { routeId: 'blr-dxb', mode: 'air', now });

    expect(result).toMatchObject({
      status: 'elevated', isDemo: true, sampleCount: 5, delayedCount: 2, earlyCount: 1, unresolvedCount: 1,
      typicalDelayDays: 0.5, dataThrough: '2026-06-30',
    });
    expect(result.issues).toEqual(['awaiting update', 'customs hold', 'weather']);
    expect(result.message).toMatch(/demo/i);
  });

  it('treats no qualifying evidence as insufficient instead of clear', () => {
    const result = summarizeRadar([], { routeId: 'blr-dxb', mode: 'air', now });

    expect(result.status).toBe('insufficient_data');
    expect(result.sampleCount).toBe(0);
    expect(result.message).toMatch(/5/i);
  });

  it('honours a configured sample minimum and ignores duplicate IDs', () => {
    const result = summarizeRadar([
      ...baseEvidence.filter((item) => item.id !== 'stale'),
      { ...baseEvidence[0], observedAt: '2026-06-20T08:00:00.000Z', issue: 'superseded' },
    ], { routeId: 'blr-dxb', mode: 'air', now, minSamples: 6 });

    expect(result.status).toBe('insufficient_data');
    expect(result.sampleCount).toBe(5);
    expect(result.issues).not.toContain('superseded');
  });

  it('returns only allowlisted privacy-safe issue categories', () => {
    const result = summarizeRadar([
      ...baseEvidence.filter((item) => item.id !== 'stale'),
      {
        id: 'unsafe-issue', routeId: 'blr-dxb', mode: 'air', promisedAt: '2026-06-25T12:00:00.000Z',
        actualAt: '2026-06-25T12:00:00.000Z', observedAt: '2026-06-25T14:00:00.000Z',
        issue: 'Asha reported a private delay', isDemo: false,
      },
    ], { routeId: 'blr-dxb', mode: 'air', now });

    expect(result.issues).not.toContain('Asha reported a private delay');
    expect(result.issues).toEqual(['awaiting update', 'customs hold', 'weather']);
  });
});
