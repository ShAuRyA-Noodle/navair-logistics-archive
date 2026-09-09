// Lane analytics for the public trend analyzer. Two independent questions, deliberately
// answered by two different methods:
//
//   Price - what will this lane cost? Fitted on the full weekly history, because a
//   seasonal shape only exists across a year or more. Two candidate models compete and
//   a rolling-origin backtest picks the winner, so "seasonal" is a measured claim.
//
//   Reliability - is this lane running late right now? Judged on the last seven days
//   against the lane's own longer-run baseline, because an exporter shipping this week
//   cares what happened this week, not what an eighteen-month average says.

export type WeeklyPrice = { weekStart: string; price: number; samples: number };
export type DeliveryDay = { promisedOn: string; deliveries: number; late: number; early: number; unresolved: number; delayDays: number | null; issues: string[] };

export type LaneForecast = {
  status: 'available' | 'insufficient_data';
  reason: string | null;
  model: 'seasonal' | 'trend' | null;
  currency: string;
  unit: string;
  confidence: 80 | 95;
  weeks: number;
  history: Array<{ date: string; price: number }>;
  points: Array<{ week: number; date: string; estimate: number; lower: number; upper: number }>;
  referencePrice: number | null;
  changePercent: number | null;
  seasonalNote: string | null;
  metrics: { chosenMae: number | null; trendMae: number | null; seasonalMae: number | null; coverage: number | null; backtestCount: number; historyWeeks: number };
  dataThrough: string | null;
};

export type LaneReliability = {
  status: 'clear' | 'watch' | 'elevated' | 'insufficient_data';
  headline: string;
  detail: string;
  recent: { days: number; deliveries: number; late: number; onTime: number; typicalDelayDays: number | null };
  baseline: { days: number; deliveries: number; late: number; lateRate: number | null };
  worseThanUsual: boolean;
  issues: string[];
  recentDays: Array<{ date: string; deliveries: number; late: number; delayDays: number | null }>;
  dataThrough: string | null;
};

const MS_PER_DAY = 86_400_000;
const WEEKS_PER_YEAR = 52.18;
const MIN_HISTORY_WEEKS = 16;
const MIN_BACKTEST_ORIGIN = 26;
const MIN_BACKTEST_ERRORS = 6;
const MAX_HISTORY_AGE_DAYS = 14;
const RECENT_WINDOW_DAYS = 7;
const BASELINE_WINDOW_DAYS = 90;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function quantile(values: number[], probability: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * probability) - 1));
  return sorted[position];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Ordinary least squares by Gaussian elimination. The design matrices here are at most
// six columns wide, so a direct solve is clearer than any iterative alternative.
function solve(design: number[][], target: number[]): number[] | null {
  const width = design[0]?.length ?? 0;
  if (width === 0 || design.length < width) return null;
  const normal = Array.from({ length: width }, (_, row) => Array.from({ length: width + 1 }, (__, column) => (
    column === width
      ? design.reduce((sum, features, index) => sum + features[row] * target[index], 0)
      : design.reduce((sum, features) => sum + features[row] * features[column], 0)
  )));
  for (let pivot = 0; pivot < width; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < width; row += 1) {
      if (Math.abs(normal[row][pivot]) > Math.abs(normal[best][pivot])) best = row;
    }
    if (Math.abs(normal[best][pivot]) < 1e-9) return null;
    [normal[pivot], normal[best]] = [normal[best], normal[pivot]];
    for (let row = 0; row < width; row += 1) {
      if (row === pivot) continue;
      const factor = normal[row][pivot] / normal[pivot][pivot];
      for (let column = pivot; column <= width; column += 1) normal[row][column] -= factor * normal[pivot][column];
    }
  }
  return normal.map((row, index) => row[width] / row[index]);
}

type Model = { kind: 'seasonal' | 'trend'; coefficients: number[] };

function features(kind: 'seasonal' | 'trend', week: number): number[] {
  const angle = (2 * Math.PI * week) / WEEKS_PER_YEAR;
  return kind === 'trend'
    ? [1, week]
    : [1, week, Math.sin(angle), Math.cos(angle), Math.sin(2 * angle), Math.cos(2 * angle)];
}

function fit(kind: 'seasonal' | 'trend', points: Array<{ week: number; price: number }>): Model | null {
  const coefficients = solve(points.map((point) => features(kind, point.week)), points.map((point) => point.price));
  return coefficients ? { kind, coefficients } : null;
}

function predict(model: Model, week: number): number {
  return features(model.kind, week).reduce((sum, feature, index) => sum + feature * model.coefficients[index], 0);
}

// Rolling-origin backtest: refit at each past week and score the forecast it would have
// made, so the model comparison never sees the values it is judged on.
function backtest(kind: 'seasonal' | 'trend', points: Array<{ week: number; price: number }>, horizon: number) {
  const errors: number[] = [];
  for (let origin = MIN_BACKTEST_ORIGIN; origin < points.length - 1; origin += 1) {
    const model = fit(kind, points.slice(0, origin + 1));
    if (!model) continue;
    for (let step = 1; step <= horizon; step += 1) {
      const actual = points[origin + step];
      if (!actual) break;
      errors.push(actual.price - predict(model, actual.week));
    }
  }
  return errors;
}

export function forecastLane(history: WeeklyPrice[], options: { unit: string; currency: string; weeks: number; confidence: 80 | 95; now?: Date }): LaneForecast {
  if (!Number.isInteger(options.weeks) || options.weeks < 1 || options.weeks > 8) throw new RangeError('weeks must be a whole number from 1 to 8');
  if (options.confidence !== 80 && options.confidence !== 95) throw new RangeError('confidence must be 80 or 95');
  const now = options.now ? new Date(options.now.getTime()) : new Date();
  const ordered = history
    .map((entry) => ({ entry, date: new Date(entry.weekStart) }))
    .filter(({ entry, date }) => !Number.isNaN(date.getTime()) && Number.isFinite(entry.price) && entry.price >= 0 && date.getTime() <= now.getTime())
    .sort((left, right) => left.date.getTime() - right.date.getTime());
  const first = ordered[0]?.date ?? null;
  const points = ordered.map(({ entry, date }) => ({
    week: first ? Math.round((date.getTime() - first.getTime()) / (7 * MS_PER_DAY)) : 0,
    price: entry.price,
    date,
  }));
  const last = points.at(-1) ?? null;
  const base = {
    currency: options.currency,
    unit: options.unit,
    confidence: options.confidence,
    weeks: options.weeks,
    history: points.map((point) => ({ date: point.date.toISOString().slice(0, 10), price: round(point.price) })),
    referencePrice: last ? round(last.price) : null,
    dataThrough: last ? last.date.toISOString() : null,
  };
  const unavailable = (reason: string): LaneForecast => ({
    ...base,
    status: 'insufficient_data',
    reason,
    model: null,
    points: [],
    changePercent: null,
    seasonalNote: null,
    metrics: { chosenMae: null, trendMae: null, seasonalMae: null, coverage: null, backtestCount: 0, historyWeeks: points.length },
  });

  if (points.length < MIN_HISTORY_WEEKS) return unavailable(`This lane has ${points.length} weeks of price history. A forecast needs at least ${MIN_HISTORY_WEEKS}.`);
  if (!last || now.getTime() - last.date.getTime() > MAX_HISTORY_AGE_DAYS * MS_PER_DAY) {
    return unavailable(`The newest price on this lane is older than ${MAX_HISTORY_AGE_DAYS} days, so a forecast would be stale.`);
  }

  const trendErrors = backtest('trend', points, options.weeks);
  const seasonalErrors = points.length >= 60 ? backtest('seasonal', points, options.weeks) : [];
  const mae = (errors: number[]) => (errors.length < MIN_BACKTEST_ERRORS ? null : round(errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length, 3));
  const trendMae = mae(trendErrors);
  const seasonalMae = mae(seasonalErrors);
  const useSeasonal = seasonalMae !== null && trendMae !== null && seasonalMae < trendMae;
  const chosenKind: 'seasonal' | 'trend' = useSeasonal ? 'seasonal' : 'trend';
  const chosenErrors = useSeasonal ? seasonalErrors : trendErrors;
  const chosenMae = useSeasonal ? seasonalMae : trendMae;
  if (chosenMae === null) return unavailable('This lane does not yet have enough history to test a forecast against its own past.');

  const model = fit(chosenKind, points);
  if (!model) return unavailable('A forecast could not be fitted to this lane\'s price history.');
  const interval = quantile(chosenErrors.map(Math.abs), options.confidence / 100);
  const covered = chosenErrors.filter((error) => Math.abs(error) <= interval + Number.EPSILON).length;
  const forecastPoints = Array.from({ length: options.weeks }, (_, index) => {
    const week = last.week + index + 1;
    const estimate = Math.max(0, predict(model, week));
    return {
      week: index + 1,
      date: new Date(last.date.getTime() + (index + 1) * 7 * MS_PER_DAY).toISOString().slice(0, 10),
      estimate: round(estimate),
      lower: round(Math.max(0, estimate - interval)),
      upper: round(estimate + interval),
    };
  });
  const changePercent = last.price === 0 ? null : round(((forecastPoints.at(-1)!.estimate - last.price) / last.price) * 100, 1);
  const seasonalSwing = useSeasonal ? round(((Math.max(...seasonalCurve(model)) - Math.min(...seasonalCurve(model))) / last.price) * 100, 1) : null;

  return {
    ...base,
    status: 'available',
    reason: null,
    model: chosenKind,
    points: forecastPoints,
    changePercent,
    seasonalNote: useSeasonal && seasonalSwing !== null
      ? `This lane has a repeating yearly pattern worth about ${seasonalSwing}% between its cheapest and dearest weeks, and the forecast follows it.`
      : 'No repeating yearly pattern beat a plain trend on this lane, so the forecast follows the trend only.',
    metrics: { chosenMae, trendMae, seasonalMae, coverage: chosenErrors.length ? round(covered / chosenErrors.length, 3) : null, backtestCount: chosenErrors.length, historyWeeks: points.length },
  };
}

function seasonalCurve(model: Model): number[] {
  return Array.from({ length: 52 }, (_, week) => {
    const angle = (2 * Math.PI * week) / WEEKS_PER_YEAR;
    const [, , sin1 = 0, cos1 = 0, sin2 = 0, cos2 = 0] = model.coefficients;
    return sin1 * Math.sin(angle) + cos1 * Math.cos(angle) + sin2 * Math.sin(2 * angle) + cos2 * Math.cos(2 * angle);
  });
}

export function summarizeReliability(days: DeliveryDay[], options: { now?: Date } = {}): LaneReliability {
  const now = options.now ? new Date(options.now.getTime()) : new Date();
  const parsed = days
    .map((day) => ({ day, date: new Date(day.promisedOn) }))
    .filter(({ date }) => !Number.isNaN(date.getTime()) && date.getTime() <= now.getTime() + MS_PER_DAY)
    .sort((left, right) => left.date.getTime() - right.date.getTime());
  const within = (windowDays: number) => parsed.filter(({ date }) => now.getTime() - date.getTime() <= windowDays * MS_PER_DAY);
  const total = (entries: typeof parsed, pick: (day: DeliveryDay) => number) => entries.reduce((sum, { day }) => sum + pick(day), 0);

  const recentEntries = within(RECENT_WINDOW_DAYS);
  const baselineEntries = within(BASELINE_WINDOW_DAYS);
  const recentDeliveries = total(recentEntries, (day) => day.deliveries);
  const recentLate = total(recentEntries, (day) => day.late);
  const baselineDeliveries = total(baselineEntries, (day) => day.deliveries);
  const baselineLate = total(baselineEntries, (day) => day.late);
  const recentUnresolved = total(recentEntries, (day) => day.unresolved);
  const typicalDelay = median(recentEntries.filter(({ day }) => day.late > 0 && day.delayDays !== null).map(({ day }) => day.delayDays!));
  const baselineRate = baselineDeliveries > 0 ? round(baselineLate / baselineDeliveries, 3) : null;
  const recentRate = recentDeliveries > 0 ? recentLate / recentDeliveries : null;
  const worseThanUsual = recentRate !== null && baselineRate !== null && recentDeliveries >= 3 && recentRate > Math.max(baselineRate * 1.5, baselineRate + 0.1);
  const issues = [...new Set(recentEntries.flatMap(({ day }) => day.issues))].sort();
  const dataThrough = parsed.at(-1)?.date.toISOString() ?? null;
  const recentDays = recentEntries.map(({ day, date }) => ({ date: date.toISOString().slice(0, 10), deliveries: day.deliveries, late: day.late, delayDays: day.delayDays }));

  if (recentDeliveries === 0 && baselineDeliveries === 0) {
    return {
      status: 'insufficient_data',
      headline: 'No delivery record yet',
      detail: 'Navair has not logged deliveries on this lane recently, so there is nothing to judge its timekeeping on.',
      recent: { days: RECENT_WINDOW_DAYS, deliveries: 0, late: 0, onTime: 0, typicalDelayDays: null },
      baseline: { days: BASELINE_WINDOW_DAYS, deliveries: 0, late: 0, lateRate: null },
      worseThanUsual: false,
      issues,
      recentDays,
      dataThrough,
    };
  }

  const status = recentUnresolved > 0 || (recentRate !== null && recentRate >= 0.4)
    ? 'elevated'
    : recentLate > 0
      ? 'watch'
      : 'clear';
  const delayPhrase = typicalDelay === null ? '' : `, usually by ${Math.abs(round(typicalDelay, 1))} day${Math.abs(typicalDelay) === 1 ? '' : 's'}`;
  const headline = status === 'elevated'
    ? 'Running late right now'
    : status === 'watch'
      ? 'Mostly on time, some slippage'
      : 'On time this week';
  const usualPhrase = baselineRate === null
    ? ''
    : ` Over the last ${BASELINE_WINDOW_DAYS} days this lane has been late on ${Math.round(baselineRate * 100)}% of deliveries.`;
  const detail = recentDeliveries === 0
    ? `Nothing was due on this lane in the last ${RECENT_WINDOW_DAYS} days.${usualPhrase}`
    : `${recentLate} of the last ${recentDeliveries} deliveries were late${delayPhrase}.${usualPhrase}${worseThanUsual ? ' That is worse than this lane\'s usual run.' : ''}`;

  return {
    status,
    headline,
    detail,
    recent: { days: RECENT_WINDOW_DAYS, deliveries: recentDeliveries, late: recentLate, onTime: recentDeliveries - recentLate, typicalDelayDays: typicalDelay === null ? null : round(typicalDelay, 1) },
    baseline: { days: BASELINE_WINDOW_DAYS, deliveries: baselineDeliveries, late: baselineLate, lateRate: baselineRate },
    worseThanUsual,
    issues,
    recentDays,
    dataThrough,
  };
}
