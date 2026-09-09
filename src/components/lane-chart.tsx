'use client';

import { useMemo, useRef, useState } from 'react';
import type { LaneForecast } from './types';
import './lane-cockpit.css';

// One measure, one hue. Prices already paid are a solid line; the forecast continues the
// same line dashed inside a shaded confidence band, so the reader never has to learn a
// second colour to follow one price. Line style carries the certainty, not colour.

type Point = { date: string; price: number; kind: 'paid' | 'forecast'; lower?: number; upper?: number; week?: number };

const WIDTH = 720;
const HEIGHT = 260;
const PAD = { top: 18, right: 16, bottom: 34, left: 62 };

function shortDate(value: string, withYear = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(withYear ? { year: '2-digit' } : {}) });
}

function money(value: number, currency: string) {
  return `${currency} ${value.toLocaleString(undefined, { maximumFractionDigits: value >= 1000 ? 0 : 2 })}`;
}

export function LaneChart({ forecast }: { forecast: LaneForecast }) {
  const [hover, setHover] = useState<number | null>(null);
  const frame = useRef<SVGSVGElement | null>(null);

  const points = useMemo<Point[]>(() => [
    ...forecast.history.map((entry) => ({ date: entry.date, price: entry.price, kind: 'paid' as const })),
    ...forecast.points.map((entry) => ({ date: entry.date, price: entry.estimate, lower: entry.lower, upper: entry.upper, week: entry.week, kind: 'forecast' as const })),
  ], [forecast.history, forecast.points]);

  if (points.length === 0) {
    return <p className="lane-chart-empty">No price history has been recorded on this lane yet, so there is nothing to plot.</p>;
  }

  const values = points.flatMap((point) => (point.kind === 'forecast' ? [point.lower ?? point.price, point.upper ?? point.price] : [point.price]));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || Math.max(1, high * 0.1);
  const floor = low - span * 0.08;
  const ceiling = high + span * 0.08;
  const times = points.map((point) => new Date(point.date).getTime());
  const firstTime = Math.min(...times);
  const lastTime = Math.max(...times);
  const timeSpan = lastTime - firstTime || 7 * 86_400_000;
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (date: string) => PAD.left + ((new Date(date).getTime() - firstTime) / timeSpan) * plotWidth;
  const y = (price: number) => PAD.top + ((ceiling - price) / (ceiling - floor)) * plotHeight;

  const paid = points.filter((point) => point.kind === 'paid');
  const projected = points.filter((point) => point.kind === 'forecast');
  const line = (items: Point[]) => items.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.date).toFixed(1)} ${y(point.price).toFixed(1)}`).join(' ');
  const bridge = paid.at(-1) && projected[0] ? [paid.at(-1)!, ...projected] : projected;
  const band = projected.length > 0 && paid.at(-1)
    ? [`M ${x(paid.at(-1)!.date).toFixed(1)} ${y(paid.at(-1)!.price).toFixed(1)}`,
      ...projected.map((point) => `L ${x(point.date).toFixed(1)} ${y(point.upper ?? point.price).toFixed(1)}`),
      ...[...projected].reverse().map((point) => `L ${x(point.date).toFixed(1)} ${y(point.lower ?? point.price).toFixed(1)}`),
      'Z'].join(' ')
    : '';

  const gridValues = Array.from({ length: 4 }, (_, index) => floor + ((ceiling - floor) * (index + 0.5)) / 4);
  const tickCount = Math.min(5, points.length);
  const ticks = Array.from({ length: tickCount }, (_, index) => new Date(firstTime + (timeSpan * index) / Math.max(1, tickCount - 1)).toISOString());
  const active = hover === null ? null : points[Math.max(0, Math.min(points.length - 1, hover))];

  function track(event: React.MouseEvent<SVGSVGElement> | React.FocusEvent<SVGSVGElement>) {
    const svg = frame.current;
    if (!svg || !('clientX' in event)) return;
    const box = svg.getBoundingClientRect();
    const position = ((event.clientX - box.left) / box.width) * WIDTH;
    let closest = 0;
    let distance = Number.POSITIVE_INFINITY;
    points.forEach((point, index) => {
      const gap = Math.abs(x(point.date) - position);
      if (gap < distance) { distance = gap; closest = index; }
    });
    setHover(closest);
  }

  return <figure className="lane-chart">
    <div className="lane-chart-readout" aria-live="polite">
      {active
        ? <><strong>{active.kind === 'paid' ? 'Actually paid' : `Our guess, week ${active.week}`}</strong> · {shortDate(active.date, true)} · {money(active.price, forecast.currency)} / {forecast.unit}
          {active.kind === 'forecast' && <> · most likely between {money(active.lower ?? active.price, forecast.currency)} and {money(active.upper ?? active.price, forecast.currency)}</>}</>
        : <span className="lane-chart-hint">Slide your mouse across the chart to see any week&rsquo;s price.</span>}
    </div>
    <svg ref={frame} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" tabIndex={0}
      onMouseMove={track} onMouseLeave={() => setHover(null)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') { event.preventDefault(); setHover((current) => Math.min(points.length - 1, (current ?? points.length - 1) + 1)); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); setHover((current) => Math.max(0, (current ?? points.length - 1) - 1)); }
        if (event.key === 'Escape') setHover(null);
      }}
      aria-label={`Weekly price paid on this lane in ${forecast.currency} per ${forecast.unit}${forecast.points.length ? `, with the next ${forecast.weeks} weeks forecast and a ${forecast.confidence} percent range` : ''}`}>
      <desc>A solid line shows the price actually paid each week. Where a forecast exists it continues as a dashed line inside a shaded band showing where the price will probably land.</desc>
      {gridValues.map((value) => <g key={value}>
        <line className="lane-grid" x1={PAD.left} x2={WIDTH - PAD.right} y1={y(value)} y2={y(value)} />
        <text className="lane-axis-text" x={PAD.left - 8} y={y(value) + 4} textAnchor="end">{money(Math.round(value), forecast.currency)}</text>
      </g>)}
      <line className="lane-axis" x1={PAD.left} x2={WIDTH - PAD.right} y1={PAD.top + plotHeight} y2={PAD.top + plotHeight} />
      {band && <path className="lane-band" d={band} />}
      <path className="lane-line-paid" d={line(paid)} />
      {projected.length > 0 && <path className="lane-line-forecast" d={line(bridge)} />}
      {paid.at(-1) && projected.length > 0 && <>
        <line className="lane-today" x1={x(paid.at(-1)!.date)} x2={x(paid.at(-1)!.date)} y1={PAD.top} y2={PAD.top + plotHeight} />
        <text className="lane-today-label" x={x(paid.at(-1)!.date) - 6} y={PAD.top + 10} textAnchor="end">today</text>
      </>}
      {active && <>
        <line className="lane-crosshair" x1={x(active.date)} x2={x(active.date)} y1={PAD.top} y2={PAD.top + plotHeight} />
        <circle className={`lane-marker lane-marker-${active.kind}`} cx={x(active.date)} cy={y(active.price)} r="5" />
      </>}
      {projected.map((point) => <circle key={point.date} className="lane-marker lane-marker-forecast" cx={x(point.date)} cy={y(point.price)} r="3.5" />)}
      {ticks.map((tick, index) => <text key={tick} className="lane-axis-text" x={x(tick)} y={HEIGHT - 12}
        textAnchor={index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle'}>{shortDate(tick, true)}</text>)}
    </svg>
    <figcaption>
      <span className="lane-key"><span className="lane-key-line" />What people actually paid</span>
      {forecast.points.length > 0 && <>
        <span className="lane-key"><span className="lane-key-line lane-key-dashed" />What we expect next</span>
        <span className="lane-key"><span className="lane-key-band" />Where it will probably land</span>
      </>}
    </figcaption>
  </figure>;
}
