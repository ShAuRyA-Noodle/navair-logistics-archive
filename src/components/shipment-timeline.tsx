'use client';

import { formatDate } from './api';
import { journeyPlan, planSummary, type LaneContext, type PlanAnchor, type TrackedStage } from '@/lib/lifecycle';
import './shipment-timeline.css';

// The same timeline serves two moments. Before booking it is a forecast of what will
// happen, drawn from the lane's own transit time. After booking the identical shape is
// drawn with real events overlaid, so a customer never has to learn a second layout.

function varianceWords(days: number | null) {
  if (days === null || Math.abs(days) < 0.5) return null;
  const rounded = Math.abs(Math.round(days));
  return days > 0
    ? `${rounded} day${rounded === 1 ? '' : 's'} later than planned`
    : `${rounded} day${rounded === 1 ? '' : 's'} earlier than planned`;
}

export function ShipmentTimeline({ stages, caption }: { stages: TrackedStage[]; caption?: string }) {
  if (stages.length === 0) return null;
  return <div className="ship-timeline">
    <ol>
      {stages.map((stage) => {
        const variance = varianceWords(stage.varianceDays);
        return <li key={stage.key} className={`ship-stage ship-stage-${stage.state}`}>
          <span className="ship-mark" aria-hidden="true">{stage.state === 'done' ? '✓' : stage.state === 'current' ? '●' : ''}</span>
          <div className="ship-body">
            <p className="ship-head">
              <strong>{stage.label}</strong>
              <span className="ship-date">{formatDate(stage.happenedAt ?? stage.date)}</span>
            </p>
            <p className="ship-plain">{stage.plain}</p>
            {stage.note && <p className="ship-note">{stage.note}</p>}
            {variance && <p className={stage.varianceDays! > 0 ? 'ship-late' : 'ship-early'}>{variance}</p>}
            {stage.state === 'current' && <p className="ship-now">Your cargo is here right now.</p>}
          </div>
        </li>;
      })}
    </ol>
    {caption && <p className="ship-caption">{caption}</p>}
  </div>;
}

// Pre-booking view: no shipment exists, so every stage is still ahead and the dates are
// estimates counted from the day the cargo is ready.
export function PlannedTimeline({ lane, readyDate, title }: { lane: LaneContext; readyDate?: string | null; title?: string }) {
  const anchor: PlanAnchor = { kind: 'from', start: readyDate && !Number.isNaN(new Date(readyDate).getTime()) ? readyDate : new Date() };
  let plan;
  try {
    plan = journeyPlan(lane, anchor);
  } catch {
    return null;
  }
  const summary = planSummary(plan);
  const stages: TrackedStage[] = plan.map((stage) => ({ ...stage, state: 'ahead', happenedAt: null, varianceDays: null, note: null }));
  return <section className="ship-planned">
    <div className="ship-planned-head">
      <div>
        <p className="eyebrow">{title ?? 'What happens next'}</p>
        <h3>About {summary.days} day{summary.days === 1 ? '' : 's'} from collection to delivery</h3>
      </div>
      <p className="ship-planned-eta">Arriving around <strong>{formatDate(summary.arrival)}</strong></p>
    </div>
    <ShipmentTimeline stages={stages}
      caption="These dates are an estimate from this route's own recent history, not a promise. Navair confirms real dates when your booking is priced." />
  </section>;
}
