'use client';

import { useMemo, useState } from 'react';
import type { Forecast } from './types';
import './forecast.css';

type ChartPoint = { date: string; price: number; kind: 'history' | 'forecast'; lower?: number; upper?: number; week?: number };

function shortDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function amount(value: number, data: Forecast) {
  return `${data.currency} ${value.toLocaleString()} / ${data.unit}`;
}

export function ForecastChart({ data }: { data: Forecast }) {
  const points = useMemo<ChartPoint[]>(() => [
    ...data.history.map((item) => ({ ...item, kind: 'history' as const })),
    ...data.points.map((item) => ({ date: item.date, price: item.estimate, lower: item.lower, upper: item.upper, week: item.week, kind: 'forecast' as const })),
  ], [data.history, data.points]);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  if (points.length === 0) return null;
  const values = points.flatMap((point) => point.kind === 'forecast' ? [point.lower ?? point.price, point.upper ?? point.price] : [point.price]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = high - low || 1;
  const width = 760;
  const height = 350;
  const left = 74;
  const right = 30;
  const top = 30;
  const bottom = 62;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const timestamps = points.map((point) => new Date(point.date).getTime()).filter(Number.isFinite);
  const firstTime = Math.min(...timestamps);
  const lastTime = Math.max(...timestamps);
  const chartLastTime = lastTime === firstTime ? firstTime + 7 * 24 * 60 * 60 * 1000 : lastTime;
  const timeSpan = chartLastTime - firstTime;
  const xy = (date: string, price: number) => ({
    x: left + ((new Date(date).getTime() - firstTime) / timeSpan) * plotWidth,
    y: top + (high - price) * (plotHeight / range),
  });
  const path = (items: Array<{ date: string; price: number }>) => items.map(({ date, price }, itemIndex) => {
    const point = xy(date, price);
    return `${itemIndex === 0 ? 'M' : 'L'} ${point.x} ${point.y}`;
  }).join(' ');
  const historyPaths = data.history.reduce<Array<Array<{ date: string; price: number }>>>((segments, item) => {
    const previous = segments.at(-1)?.at(-1);
    const gap = previous ? new Date(item.date).getTime() - new Date(previous.date).getTime() : 0;
    if (!previous || gap > 9 * 24 * 60 * 60 * 1000) segments.push([{ date: item.date, price: item.price }]);
    else segments.at(-1)?.push({ date: item.date, price: item.price });
    return segments;
  }, []).map(path);
  const forecastPath = path(data.points.map((item) => ({ date: item.date, price: item.estimate })));
  const bandPoints = data.points.map((item) => xy(item.date, item.upper))
    .concat([...data.points].reverse().map((item) => xy(item.date, item.lower)));
  const band = bandPoints.length > 2 ? `${bandPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')} Z` : '';
  const grid = Array.from({ length: 5 }, (_, index) => low + (range * index) / 4);
  const timeTicks = Array.from({ length: 5 }, (_, index) => firstTime + (timeSpan * index) / 4);
  const yearCaption = new Date(firstTime).getFullYear() === new Date(chartLastTime).getFullYear()
    ? String(new Date(firstTime).getFullYear())
    : `${new Date(firstTime).getFullYear()}–${new Date(chartLastTime).getFullYear()}`;
  const active = focusedIndex === null ? null : points[focusedIndex];
  const singleProjection = data.points.length === 1 ? data.points[0] : null;

  return <figure className="forecast-chart">
    <div className="forecast-focus" aria-live="polite">
      {active ? <><strong>{active.kind === 'history' ? 'Historical price' : `Week ${active.week} projection`}</strong> · {shortDate(active.date)} · {amount(active.price, data)}{active.kind === 'forecast' && ` · ${data.confidence}% range ${amount(active.lower ?? active.price, data)}–${amount(active.upper ?? active.price, data)}`}</> : 'Focus a point on the graph to inspect its value.'}
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={data.points.length ? `Selling-price history and ${data.weeks}-week projected trend in ${data.currency} per ${data.unit}` : `Historical selling prices in ${data.currency} per ${data.unit}`}>
      <title>{data.points.length ? 'Historical selling prices and future price projection' : 'Historical selling prices'}</title>
      <desc>{data.points.length ? 'A solid navy line shows observed selling prices. A dashed green line shows projected prices and the shaded area is the confidence range.' : 'A solid navy line shows observed selling prices. Gaps between points are not connected.'}</desc>
      {grid.map((value) => { const point = xy(points[0].date, value); return <g key={value}><line className="forecast-grid" x1={left} x2={width - right} y1={point.y} y2={point.y} /><text className="forecast-axis-text" x={left - 10} y={point.y + 4} textAnchor="end">{Math.round(value).toLocaleString()}</text></g>; })}
      <line className="forecast-axis" x1={left} x2={width - right} y1={top + plotHeight} y2={top + plotHeight} />
      {data.points[0] && <><line className="forecast-divider" x1={xy(data.points[0].date, low).x} x2={xy(data.points[0].date, low).x} y1={top} y2={top + plotHeight} /><text className="forecast-divider-label" x={xy(data.points[0].date, low).x + 8} y={top + 16}>Future projection</text></>}
      {band && <path className="forecast-band" d={band} />}
      {singleProjection && <g className="forecast-whisker"><line x1={xy(singleProjection.date, singleProjection.lower).x} x2={xy(singleProjection.date, singleProjection.lower).x} y1={xy(singleProjection.date, singleProjection.lower).y} y2={xy(singleProjection.date, singleProjection.upper).y} /><line x1={xy(singleProjection.date, singleProjection.lower).x - 7} x2={xy(singleProjection.date, singleProjection.lower).x + 7} y1={xy(singleProjection.date, singleProjection.lower).y} y2={xy(singleProjection.date, singleProjection.lower).y} /><line x1={xy(singleProjection.date, singleProjection.upper).x - 7} x2={xy(singleProjection.date, singleProjection.upper).x + 7} y1={xy(singleProjection.date, singleProjection.upper).y} y2={xy(singleProjection.date, singleProjection.upper).y} /></g>}
      {historyPaths.map((historyPath, index) => historyPath && <path className="forecast-history-line" d={historyPath} key={index} />)}
      {forecastPath && <path className="forecast-project-line" d={forecastPath} />}
      {points.map((point, index) => { const position = xy(point.date, point.price); return <circle className={`forecast-point forecast-point-${point.kind}`} cx={position.x} cy={position.y} key={`${point.kind}-${point.date}-${index}`} r="5" tabIndex={0} role="button" aria-label={`${point.kind === 'history' ? 'Historical price' : `Projected week ${point.week}`}, ${shortDate(point.date)}, ${amount(point.price, data)}`} onFocus={() => setFocusedIndex(index)} onBlur={() => setFocusedIndex(null)} onClick={() => setFocusedIndex(index)} />; })}
      {timeTicks.map((timestamp, index) => { const date = new Date(timestamp).toISOString(); const point = xy(date, low); return <text className="forecast-axis-text" key={timestamp} x={point.x} y={height - 32} textAnchor={index === 0 ? 'start' : index === timeTicks.length - 1 ? 'end' : 'middle'}>{shortDate(date)}</text>; })}
      <text className="forecast-axis-title" transform={`translate(20 ${top + plotHeight / 2}) rotate(-90)`} textAnchor="middle">Price ({data.currency} / {data.unit})</text>
      <text className="forecast-axis-title" x={left + plotWidth / 2} y={height - 8} textAnchor="middle">Date · {yearCaption}</text>
    </svg>
    <figcaption><span className="forecast-legend forecast-history" />Observed selling price {data.points.length > 0 && <><span className="forecast-legend forecast-project" />Projected price <span className="forecast-legend forecast-range" />{data.confidence}% confidence range</>}</figcaption>
  </figure>;
}
