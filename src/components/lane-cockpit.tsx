'use client';

import { formatDate } from './api';
import { LaneChart } from './lane-chart';
import { PlannedTimeline } from './shipment-timeline';
import type { LaneAnalysis, LaneForecast, LaneReliability } from './types';
import './lane-cockpit.css';

// Layout: three plain-language answers down the left (what will it cost, will it arrive
// on time, how much should I trust this), the evidence on the right. Every number the
// panels state is one the API actually returned; nothing is estimated in the browser.

const MODE_WORDS: Record<string, string> = { air: 'Air freight', sea: 'Sea freight', road: 'Road freight', courier: 'Courier' };
const COVERAGE_WORDS: Record<string, string> = {
  supported: 'Navair runs this lane',
  on_request: 'Available on request — the desk confirms space before quoting',
  not_supported: 'Navair does not run this lane',
  unknown: 'Coverage not yet declared for this lane',
};

function money(value: number, currency: string, unit: string) {
  return `${currency} ${value.toLocaleString(undefined, { maximumFractionDigits: value >= 1000 ? 0 : 2 })} / ${unit}`;
}

function CostPanel({ forecast }: { forecast: LaneForecast | null }) {
  if (!forecast || forecast.status !== 'available' || !forecast.referencePrice) {
    return <section className="lane-panel lane-panel-quiet">
      <h3>Cost: not enough history</h3>
      <p>{forecast?.reason ?? 'This lane has no price history recorded yet.'}</p>
      <p className="lane-panel-note">Navair still quotes it manually — the analyzer simply will not guess a number it cannot stand behind.</p>
    </section>;
  }
  const change = forecast.changePercent ?? 0;
  const direction = change > 1.5 ? 'Costs are rising' : change < -1.5 ? 'Costs are easing' : 'Costs are steady';
  const final = forecast.points.at(-1)!;
  const swing = Math.round(((final.upper - final.lower) / 2) * 100) / 100;
  return <section className={`lane-panel lane-panel-${change > 1.5 ? 'warn' : change < -1.5 ? 'good' : 'neutral'}`}>
    <h3>{direction}</h3>
    <p>
      Today it is <strong>{money(forecast.referencePrice, forecast.currency, forecast.unit)}</strong>. In {forecast.weeks} week{forecast.weeks === 1 ? '' : 's'} expect
      about <strong>{money(final.estimate, forecast.currency, forecast.unit)}</strong>
      {change === 0 ? '' : <> — {change > 0 ? 'up' : 'down'} {Math.abs(change)}%</>}, give or take {money(swing, forecast.currency, forecast.unit)}.
    </p>
    <p className="lane-panel-note">{forecast.seasonalNote}</p>
    <p className="lane-panel-note">&ldquo;Give or take&rdquo; means the price could land a bit above or below — that is the shaded band on the chart.</p>
  </section>;
}

function DelayPanel({ reliability }: { reliability: LaneReliability }) {
  const tone = reliability.status === 'elevated' ? 'bad' : reliability.status === 'watch' ? 'warn' : reliability.status === 'clear' ? 'good' : 'quiet';
  return <section className={`lane-panel lane-panel-${tone}`}>
    <h3>{reliability.headline}</h3>
    <p>{reliability.detail}</p>
    {reliability.issues.length > 0 && <p className="lane-panel-note">Reported causes this week: {reliability.issues.join(', ')}.</p>}
    {reliability.worseThanUsual && <p className="lane-panel-note lane-panel-alert">
      Because recent deliveries are slipping, plan for the later end of the transit time if your cargo is time-critical.
    </p>}
  </section>;
}

function TrustPanel({ forecast, reliability }: { forecast: LaneForecast | null; reliability: LaneReliability }) {
  const weeks = forecast?.metrics.historyWeeks ?? 0;
  const mae = forecast?.metrics.chosenMae ?? null;
  const coverage = forecast?.metrics.coverage ?? null;
  const level = weeks >= 60 && mae !== null ? 'strong' : weeks >= 26 ? 'fair' : 'thin';
  const years = weeks >= 52 ? `${Math.round((weeks / 52) * 10) / 10} years` : `${Math.round(weeks / 4.3)} months`;
  return <section className="lane-panel lane-panel-neutral">
    <h3>How solid is this? {level}</h3>
    <p>
      We are going on <strong>{years}</strong> of real prices on this route
      {reliability.baseline.deliveries > 0 && <> and <strong>{reliability.baseline.deliveries} deliveries</strong> from the last three months</>}.
    </p>
    {mae !== null && forecast && <p>
      We checked ourselves: we hid recent weeks, guessed them, then compared. We were usually within
      {' '}<strong>{money(mae, forecast.currency, forecast.unit)}</strong> of the real price.
    </p>}
    {coverage !== null && <p className="lane-panel-note">
      In those checks the real price landed inside our range about {Math.round(coverage * 100)} times out of 100.
      {forecast?.model === 'seasonal' && ' We also tried a simpler straight-line guess, and this one was closer.'}
    </p>}
    <p className="lane-panel-note">Practice data for this demo. A guide to plan with, never a final quote.</p>
  </section>;
}

function DeliveryStrip({ reliability }: { reliability: LaneReliability }) {
  if (reliability.recentDays.length === 0) {
    return <section className="lane-strip">
      <h3>Deliveries in the last {reliability.recent.days} days</h3>
      <p className="lane-panel-note">Nothing was due on this lane in that window.</p>
    </section>;
  }
  return <section className="lane-strip">
    <h3>Deliveries in the last {reliability.recent.days} days</h3>
    <ol className="lane-strip-days">
      {reliability.recentDays.map((day) => {
        const late = day.late > 0;
        return <li key={day.date} className={late ? 'lane-day lane-day-late' : 'lane-day lane-day-ontime'}>
          <span className="lane-day-mark" aria-hidden="true">{late ? '!' : '✓'}</span>
          <span className="lane-day-date">{formatDate(day.date)}</span>
          <span className="lane-day-note">
            {late
              ? `${day.late} of ${day.deliveries} late${day.delayDays === null ? '' : ` by ${Math.abs(day.delayDays)} day${Math.abs(day.delayDays) === 1 ? '' : 's'}`}`
              : `${day.deliveries} on time`}
          </span>
        </li>;
      })}
    </ol>
    <p className="lane-panel-note">Pooled across every Navair customer on this lane. No shipment, customer or reference is shown.</p>
  </section>;
}

export function LaneCockpit({ analysis }: { analysis: LaneAnalysis }) {
  const { lane, forecast, reliability } = analysis;
  return <div className="lane-cockpit">
    <header className="lane-cockpit-head">
      <div>
        <p className="eyebrow">{MODE_WORDS[lane.mode] ?? lane.mode}</p>
        <h2>{lane.origin} → {lane.destination}</h2>
        <p className="lane-cockpit-meta">
          {lane.transitDays === null ? 'Transit time not stated' : `About ${lane.transitDays} day${lane.transitDays === 1 ? '' : 's'} in transit`}
          {lane.distanceKm !== null && <> · {lane.distanceKm.toLocaleString()} km</>}
          {' · '}{COVERAGE_WORDS[lane.serviceCoverage] ?? lane.serviceCoverage}
        </p>
      </div>
      <p className="lane-cockpit-through">Priced through {formatDate(forecast?.dataThrough ?? null)}</p>
    </header>

    <div className="lane-cockpit-body">
      <div className="lane-cockpit-answers">
        <CostPanel forecast={forecast} />
        <DelayPanel reliability={reliability} />
        <TrustPanel forecast={forecast} reliability={reliability} />
      </div>
      <div className="lane-cockpit-evidence">
        {forecast ? <LaneChart forecast={forecast} /> : <p className="lane-chart-empty">No price history on this lane yet.</p>}
        <DeliveryStrip reliability={reliability} />
        <PlannedTimeline
          lane={{ mode: lane.mode, transitDays: lane.transitDays, crossBorder: lane.crossBorder }}
          title="If you booked this today" />
        {forecast && forecast.points.length > 0 && <details className="lane-table">
          <summary>See the forecast as numbers</summary>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Weekly forecast with confidence range</caption>
              <thead><tr><th scope="col">Week</th><th scope="col">Date</th><th scope="col">Expected</th><th scope="col">{forecast.confidence}% range</th></tr></thead>
              <tbody>{forecast.points.map((point) => <tr key={point.week}>
                <th scope="row">{point.week}</th>
                <td>{formatDate(point.date)}</td>
                <td>{money(point.estimate, forecast.currency, forecast.unit)}</td>
                <td>{money(point.lower, forecast.currency, forecast.unit)} – {money(point.upper, forecast.currency, forecast.unit)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>}
      </div>
    </div>
  </div>;
}
