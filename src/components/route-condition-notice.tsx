'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatDate } from './api';
import type { Radar, Route, ShipmentMode } from './types';
import styles from './route-condition-notice.module.css';

type ConditionResponse = { route: Route | null; radar: Radar | null };

export function RouteConditionNotice({ origin, destination, mode }: { origin: string; destination: string; mode: ShipmentMode }) {
  const [result, setResult] = useState<ConditionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null);
  const query = useMemo(() => `${origin.trim().toLocaleLowerCase()}|${destination.trim().toLocaleLowerCase()}|${mode}`, [destination, mode, origin]);
  const ready = origin.trim().length > 1 && destination.trim().length > 1;

  useEffect(() => {
    setResult(null); setLoading(false); setUnavailable(false);
    if (!ready) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ origin: origin.trim(), destination: destination.trim(), mode });
        const response = await fetch(`/api/route-conditions?${params}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
        if (!response.ok) { if (!controller.signal.aborted) setUnavailable(true); return; }
        const next = await response.json() as ConditionResponse;
        if (!controller.signal.aborted) setResult(next);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setUnavailable(true);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 300);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [destination, mode, origin, ready]);

  if (!ready) return null;
  if (loading) return <p className={styles.status} aria-live="polite">Checking recent route conditions…</p>;
  if (dismissedQuery === query) return null;
  if (unavailable) return <p className={styles.status} aria-live="polite">Route conditions are temporarily unavailable. You can still submit your enquiry.</p>;
  if (!result) return null;
  if (!result.route || !result.radar) return <p className={styles.status} aria-live="polite">No public route history is available for this route yet.</p>;
  const { radar } = result;
  const title = radar.status === 'insufficient_data' ? 'Route history is still limited' : radar.status === 'elevated' ? 'This route needs extra care' : radar.status === 'watch' ? 'Recent route delays observed' : 'Recent route history looks clear';
  const early = radar.earlyCount === 1 ? '1 shipment arrived early' : `${radar.earlyCount} shipments arrived early`;
  const delayed = radar.delayedCount === 1 ? '1 completed delay' : `${radar.delayedCount} completed delays`;
  return <aside className={`${styles.notice} ${styles[radar.status]}`} aria-live="polite"><div className={styles.heading}><div><p className="eyebrow">{radar.isDemo ? 'Synthetic route history' : 'Recent route history'}</p><h3>{title}</h3></div><button type="button" className={styles.dismiss} onClick={() => setDismissedQuery(query)} aria-label={`Dismiss route conditions for ${origin} to ${destination}`}>Dismiss</button></div><p>{radar.message}</p>{radar.status !== 'insufficient_data' && <dl><div><dt>Window</dt><dd>Last 30 days</dd></div><div><dt>Observed</dt><dd>{radar.sampleCount} shipments</dd></div><div><dt>Early arrivals</dt><dd>{early}</dd></div><div><dt>Delays</dt><dd>{delayed}</dd></div></dl>}{radar.typicalDelayDays !== null && <p className={styles.detail}>Typical delay among late deliveries: {radar.typicalDelayDays} days. This is observed history, not a delivery guarantee.</p>}{radar.dataThrough && <p className={styles.detail}>Evidence through {formatDate(radar.dataThrough)}.</p>}{radar.status === 'insufficient_data' && <p className={styles.detail}>There are not enough comparable records to call this route clear.</p>}</aside>;
}
