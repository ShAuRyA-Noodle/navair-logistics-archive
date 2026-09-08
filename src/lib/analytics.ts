export type PriceObservation = {
  id: string;
  routeId: string;
  mode: string;
  unit: string;
  currency: string;
  observedAt: string;
  sellingPrice: number;
  isDemo: boolean;
};

export type ShipmentEvidence = {
  id: string;
  routeId: string;
  mode: string;
  promisedAt: string;
  actualAt: string | null;
  observedAt: string;
  issue: string | null;
  isDemo: boolean;
};

type ForecastOptions = {
  routeId: string;
  mode: string;
  unit: string;
  currency: string;
  weeks: number;
  confidence: 80 | 95;
  now?: Date;
};

type RadarOptions = {
  routeId: string;
  mode: string;
  now?: Date;
  lookbackDays?: number;
  minSamples?: number;
};

export type PriceForecast = {
  status: 'available' | 'insufficient_data';
  isDemo: boolean;
  label: string;
  reason: string | null;
  currency: string;
  unit: string;
  confidence: 80 | 95;
  weeks: number;
  history: Array<{ date: string; price: number }>;
  points: Array<{ week: number; date: string; estimate: number; lower: number; upper: number }>;
  referencePrice: number | null;
  changePercent: number | null;
  metrics: { mae: number | null; coverage: number | null; backtestCount: number };
  dataThrough: string | null;
};

export type RadarSummary = {
  status: 'clear' | 'watch' | 'elevated' | 'insufficient_data';
  isDemo: boolean;
  message: string;
  sampleCount: number;
  delayedCount: number;
  earlyCount: number;
  unresolvedCount: number;
  typicalDelayDays: number | null;
  dataThrough: string | null;
  issues: string[];
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_FORECAST_WEEKS = 16;
const MIN_TRAINING_BUCKETS = 8;
const MAX_FORECAST_AGE_DAYS = 14;
const MIN_CALIBRATION_RESIDUALS = 4;
const MIN_VALIDATION_RESIDUALS = 4;
const SAFE_ISSUE_CATEGORIES = new Set([
  'awaiting update',
  'carrier capacity',
  'customs hold',
  'documentation',
  'weather',
]);

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function requireText(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RangeError(`${name} is required`);
  }
}

function resolveNow(now?: Date): Date {
  const resolved = now ? new Date(now.getTime()) : new Date();
  if (Number.isNaN(resolved.getTime())) throw new RangeError('now must be a valid date');
  return resolved;
}

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDay(date: Date): string {
  return utcDay(date).toISOString().slice(0, 10);
}

function mondayOf(date: Date): Date {
  const day = utcDay(date);
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - offset * MS_PER_DAY);
}

function nextMondayAfter(date: Date): Date {
  return new Date(mondayOf(date).getTime() + 7 * MS_PER_DAY);
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function quantile(sortedValues: number[], probability: number): number {
  if (sortedValues.length === 0) return 0;
  const position = Math.max(0, Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * probability) - 1));
  return sortedValues[position];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function linearModel(points: Array<{ x: number; y: number }>): { intercept: number; slope: number } {
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const denominator = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  if (denominator === 0) return { intercept: meanY, slope: 0 };
  const numerator = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
  return { intercept: meanY - (numerator / denominator) * meanX, slope: numerator / denominator };
}

function prediction(model: { intercept: number; slope: number }, x: number): number {
  return model.intercept + model.slope * x;
}

type WeeklyPrice = { date: string; price: number; x: number; isDemo: boolean };
type Residual = { horizon: number; value: number };

function rollingResiduals(history: WeeklyPrice[], horizon: number): Residual[] {
  const residuals: Residual[] = [];
  for (let origin = MIN_TRAINING_BUCKETS - 1; origin < history.length - 1; origin += 1) {
    const target = history.find((bucket, index) => index > origin && bucket.x === history[origin].x + horizon);
    if (!target) continue;
    const model = linearModel(history.slice(0, origin + 1).map((bucket) => ({ x: bucket.x, y: bucket.price })));
    residuals.push({ horizon, value: target.price - prediction(model, target.x) });
  }
  return residuals;
}

function splitResiduals(residuals: Residual[]): { calibration: Residual[]; validation: Residual[] } | null {
  const splitAt = Math.floor(residuals.length / 2);
  const calibration = residuals.slice(0, splitAt);
  const validation = residuals.slice(splitAt);
  if (calibration.length < MIN_CALIBRATION_RESIDUALS || validation.length < MIN_VALIDATION_RESIDUALS) return null;
  return { calibration, validation };
}

export function forecastPrices(observations: PriceObservation[], options: ForecastOptions): PriceForecast {
  requireText(options.routeId, 'routeId');
  requireText(options.mode, 'mode');
  requireText(options.unit, 'unit');
  requireText(options.currency, 'currency');
  if (!Number.isInteger(options.weeks) || options.weeks < 1 || options.weeks > 8) {
    throw new RangeError('weeks must be a whole number from 1 to 8');
  }
  if (options.confidence !== 80 && options.confidence !== 95) {
    throw new RangeError('confidence must be 80 or 95');
  }

  const now = resolveNow(options.now);
  const comparable = observations
    .map((observation) => ({ observation, observedAt: parseDate(observation.observedAt) }))
    .filter((entry): entry is { observation: PriceObservation; observedAt: Date } => (
      entry.observedAt !== null
      && entry.observedAt.getTime() <= now.getTime()
      && entry.observation.routeId === options.routeId
      && entry.observation.mode === options.mode
      && entry.observation.unit === options.unit
      && entry.observation.currency === options.currency
      && Number.isFinite(entry.observation.sellingPrice)
      && entry.observation.sellingPrice >= 0
      && entry.observation.id.trim().length > 0
    ));

  const byId = new Map<string, { observation: PriceObservation; observedAt: Date }>();
  for (const entry of comparable) {
    const existing = byId.get(entry.observation.id);
    if (!existing || entry.observedAt.getTime() > existing.observedAt.getTime()) byId.set(entry.observation.id, entry);
  }

  const buckets = new Map<string, { date: Date; prices: number[]; isDemo: boolean }>();
  for (const { observation, observedAt } of byId.values()) {
    const date = mondayOf(observedAt);
    const key = isoDay(date);
    const existing = buckets.get(key) ?? { date, prices: [], isDemo: false };
    existing.prices.push(observation.sellingPrice);
    existing.isDemo ||= observation.isDemo;
    buckets.set(key, existing);
  }

  const firstWeek = [...buckets.values()].sort((left, right) => left.date.getTime() - right.date.getTime())[0]?.date ?? null;
  const historyWithMetadata = [...buckets.values()]
    .sort((left, right) => left.date.getTime() - right.date.getTime())
    .map((bucket) => ({
      date: isoDay(bucket.date),
      price: round(bucket.prices.reduce((sum, price) => sum + price, 0) / bucket.prices.length, 4),
      x: firstWeek ? (bucket.date.getTime() - firstWeek.getTime()) / (7 * MS_PER_DAY) : 0,
      isDemo: bucket.isDemo,
    }));
  const history = historyWithMetadata.map(({ date, price }) => ({ date, price }));
  const isDemo = historyWithMetadata.some((bucket) => bucket.isDemo);
  const freshestObservedAt = [...byId.values()]
    .map((entry) => entry.observedAt)
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
  const dataThrough = freshestObservedAt?.toISOString() ?? null;
  const referencePrice = history.at(-1)?.price ?? null;

  const base: Omit<PriceForecast, 'status' | 'label' | 'reason' | 'points' | 'metrics'> = {
    isDemo,
    currency: options.currency,
    unit: options.unit,
    confidence: options.confidence,
    weeks: options.weeks,
    history,
    referencePrice,
    changePercent: null,
    dataThrough,
  };

  if (historyWithMetadata.length < MIN_FORECAST_WEEKS) {
    return {
      ...base,
      status: 'insufficient_data',
      label: 'Selling-price forecast unavailable',
      reason: `At least ${MIN_FORECAST_WEEKS} comparable weekly selling-price observations are required.`,
      points: [],
      metrics: { mae: null, coverage: null, backtestCount: 0 },
    };
  }

  const last = historyWithMetadata.at(-1)!;
  if (!freshestObservedAt || now.getTime() - freshestObservedAt.getTime() > MAX_FORECAST_AGE_DAYS * MS_PER_DAY) {
    return {
      ...base,
      status: 'insufficient_data',
      label: 'Experimental selling-price forecast unavailable',
      reason: `The freshest comparable selling-price observation is older than ${MAX_FORECAST_AGE_DAYS} days.`,
      points: [],
      metrics: { mae: null, coverage: null, backtestCount: 0 },
    };
  }

  const firstForecastDate = nextMondayAfter(now);
  const firstForecastHorizon = (firstForecastDate.getTime() - new Date(`${last.date}T00:00:00.000Z`).getTime()) / (7 * MS_PER_DAY);
  const horizons = Array.from({ length: options.weeks }, (_, index) => firstForecastHorizon + index);
  const residualSplits = new Map<number, { calibration: Residual[]; validation: Residual[] }>();
  for (const horizon of horizons) {
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > 8) continue;
    const split = splitResiduals(rollingResiduals(historyWithMetadata, horizon));
    if (split) residualSplits.set(horizon, split);
  }
  const hasIndependentValidation = residualSplits.size === horizons.length;
  if (!hasIndependentValidation) {
    return {
      ...base,
      status: 'insufficient_data',
      label: 'Experimental selling-price forecast unavailable',
      reason: 'Comparable history does not contain enough independent rolling holdouts for every requested forecast horizon.',
      points: [],
      metrics: { mae: null, coverage: null, backtestCount: 0 },
    };
  }

  const intervalByHorizon = new Map<number, number>();
  for (const [horizon, split] of residualSplits) {
    intervalByHorizon.set(horizon, quantile(
      split.calibration.map((residual) => Math.abs(residual.value)).sort((left, right) => left - right),
      options.confidence / 100,
    ));
  }
  const validationResiduals = hasIndependentValidation
    ? horizons.flatMap((horizon) => residualSplits.get(horizon)!.validation)
    : [];
  const mae = validationResiduals.length === 0 ? null : round(
    validationResiduals.reduce((sum, residual) => sum + Math.abs(residual.value), 0) / validationResiduals.length,
    4,
  );
  const coverage = validationResiduals.length === 0 ? null : round(
    validationResiduals.filter((residual) => Math.abs(residual.value) <= (intervalByHorizon.get(residual.horizon) ?? 0) + Number.EPSILON).length / validationResiduals.length,
    4,
  );
  const model = linearModel(historyWithMetadata.map((bucket) => ({ x: bucket.x, y: bucket.price })));
  const points = Array.from({ length: options.weeks }, (_, index) => {
    const week = index + 1;
    const horizon = horizons[index];
    const estimate = round(Math.max(0, prediction(model, last.x + horizon)));
    const intervalHalfWidth = intervalByHorizon.get(horizon) ?? 0;
    return {
      week,
      date: isoDay(new Date(firstForecastDate.getTime() + index * 7 * MS_PER_DAY)),
      estimate,
      lower: round(Math.max(0, estimate - intervalHalfWidth)),
      upper: round(estimate + intervalHalfWidth),
    };
  });
  const changePercent = referencePrice && referencePrice !== 0
    ? round(((points[0].estimate - referencePrice) / referencePrice) * 100, 2)
    : null;

  return {
    ...base,
    status: 'available',
    label: isDemo
      ? 'Experimental demo selling-price forecast — not market-ready'
      : 'Experimental selling-price forecast — not market-ready',
    reason: null,
    points,
    changePercent,
    metrics: { mae, coverage, backtestCount: validationResiduals.length },
  };
}

export function summarizeRadar(evidence: ShipmentEvidence[], options: RadarOptions): RadarSummary {
  requireText(options.routeId, 'routeId');
  requireText(options.mode, 'mode');
  const now = resolveNow(options.now);
  const lookbackDays = options.lookbackDays ?? 30;
  const minSamples = options.minSamples ?? 5;
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 365) {
    throw new RangeError('lookbackDays must be a whole number from 1 to 365');
  }
  if (!Number.isInteger(minSamples) || minSamples < 1 || minSamples > 1000) {
    throw new RangeError('minSamples must be a whole number from 1 to 1000');
  }
  const cutoff = new Date(now.getTime() - lookbackDays * MS_PER_DAY);
  const qualifying = evidence
    .map((item) => ({ item, observedAt: parseDate(item.observedAt), promisedAt: parseDate(item.promisedAt), actualAt: item.actualAt ? parseDate(item.actualAt) : null }))
    .filter((entry): entry is { item: ShipmentEvidence; observedAt: Date; promisedAt: Date; actualAt: Date | null } => (
      entry.observedAt !== null
      && entry.promisedAt !== null
      && entry.observedAt.getTime() <= now.getTime()
      && entry.item.routeId === options.routeId
      && entry.item.mode === options.mode
      && entry.item.id.trim().length > 0
      && (entry.observedAt.getTime() >= cutoff.getTime() || entry.promisedAt.getTime() >= cutoff.getTime())
    ));
  const byId = new Map<string, typeof qualifying[number]>();
  for (const entry of qualifying) {
    const existing = byId.get(entry.item.id);
    if (!existing || entry.observedAt.getTime() > existing.observedAt.getTime()) byId.set(entry.item.id, entry);
  }
  const used = [...byId.values()];
  const completedDelayDays = used
    .filter((entry) => entry.actualAt !== null)
    .map((entry) => (entry.actualAt!.getTime() - entry.promisedAt.getTime()) / MS_PER_DAY);
  const delayedCount = completedDelayDays.filter((days) => days > 0).length;
  const earlyCount = completedDelayDays.filter((days) => days < 0).length;
  const unresolvedCount = used.filter((entry) => entry.actualAt === null && entry.promisedAt.getTime() < now.getTime()).length;
  const isDemo = used.some((entry) => entry.item.isDemo);
  const typicalDelay = median(completedDelayDays);
  const issues = [...new Set(
    used
      .map((entry) => entry.item.issue?.trim().toLocaleLowerCase())
      .filter((issue): issue is string => typeof issue === 'string')
      .filter((issue) => SAFE_ISSUE_CATEGORIES.has(issue)),
  )].sort();
  const dataThrough = used.length === 0 ? null : isoDay(new Date(Math.max(...used.map((entry) => entry.observedAt.getTime()))));

  if (used.length < minSamples) {
    return {
      status: 'insufficient_data',
      isDemo,
      message: `Radar needs at least ${minSamples} recent shipment records; ${used.length} are available.`,
      sampleCount: used.length,
      delayedCount,
      earlyCount,
      unresolvedCount,
      typicalDelayDays: typicalDelay === null ? null : round(typicalDelay, 2),
      dataThrough,
      issues,
    };
  }

  const status = unresolvedCount > 0 || delayedCount / used.length >= 0.5
    ? 'elevated'
    : delayedCount > 0
      ? 'watch'
      : 'clear';
  const prefix = isDemo ? 'Experimental demo radar.' : 'Shipment radar.';
  const message = status === 'elevated'
    ? `${prefix} ${unresolvedCount} overdue shipment${unresolvedCount === 1 ? '' : 's'} and ${delayedCount} completed delay${delayedCount === 1 ? '' : 's'} need attention.`
    : status === 'watch'
      ? `${prefix} ${delayedCount} completed delay${delayedCount === 1 ? '' : 's'} observed in the lookback window.`
      : `${prefix} No completed delays or ongoing overdue shipments were observed in the lookback window.`;

  return {
    status,
    isDemo,
    message,
    sampleCount: used.length,
    delayedCount,
    earlyCount,
    unresolvedCount,
    typicalDelayDays: typicalDelay === null ? null : round(typicalDelay, 2),
    dataThrough,
    issues,
  };
}
