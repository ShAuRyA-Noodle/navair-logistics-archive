'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatDate } from './api';
import type { Radar, Route, ShipmentMode } from './types';
import styles from './route-condition-notice.module.css';

type ConditionResponse = { route: Route | null; radar: Radar | null; match: 'matched' | 'unknown_location' | 'no_history' | 'service_unavailable' | 'not_supported' | 'mode_required'; suggestions: { origin: string[]; destination: string[] } };

export function RouteConditionNotice({ origin, destination, mode, onChooseOrigin, onChooseDestination }: { origin: string; destination: string; mode: ShipmentMode; onChooseOrigin?: (city: string) => void; onChooseDestination?: (city: string) => void }) {
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
    }, 550);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [destination, mode, origin, ready]);

  if (!ready) return null;
  if (loading) return <p className={styles.status} aria-live="polite">Checking recent route conditions…</p>;
  if (dismissedQuery === query) return null;
  if (unavailable) return <p className={styles.status} aria-live="polite">Route conditions are temporarily unavailable. You can still submit your enquiry.</p>;
  if (!result) return null;
  if (result.match === 'unknown_location') {
    // Typing "hong" is not a mistake, it is half of "Hong Kong". While a suggestion still
    // begins with what has been typed, the person is mid-word: offer the completion quietly
    // rather than telling them the city cannot be found.
    const typedOrigin = origin.trim().toLocaleLowerCase();
    const typedDestination = destination.trim().toLocaleLowerCase();
    const completing = result.suggestions.origin.some((city) => city.toLocaleLowerCase().startsWith(typedOrigin))
      || result.suggestions.destination.some((city) => city.toLocaleLowerCase().startsWith(typedDestination));
    return <div className={styles.status} aria-live="polite">
      <p>{completing ? 'Did you mean:' : 'We could not find that city in Navair\'s network. Check the spelling or pick one below; you can still send your enquiry.'}</p>
      <CitySuggestions cities={result.suggestions.origin} onChoose={onChooseOrigin} />
      <CitySuggestions cities={result.suggestions.destination} onChoose={onChooseDestination} />
    </div>;
  }
  if (result.match === 'mode_required') return <p className={styles.status} aria-live="polite">Choose a preferred service to check route history. You can still submit your enquiry.</p>;
  if (result.match === 'not_supported') return <p className={styles.status} aria-live="polite">This route is not currently handled. You can still send your enquiry; Navair will review availability and possible alternatives. Service is not confirmed.</p>;
  if (result.match === 'service_unavailable' || !result.route || !result.radar) return <p className={styles.status} aria-live="polite">We need to confirm availability for this route. Send your enquiry and Navair will review options or alternatives.</p>;
  const { radar } = result;
  const title = radar.status === 'insufficient_data' ? 'Route history is still limited' : radar.status === 'elevated' ? 'This route needs extra care' : radar.status === 'watch' ? 'Recent route delays observed' : 'Recent route history looks clear';
  const early = radar.earlyCount === 1 ? '1 shipment arrived early' : `${radar.earlyCount} shipments arrived early`;
  const delayed = radar.delayedCount === 1 ? '1 completed delay' : `${radar.delayedCount} completed delays`;
  return <aside className={`${styles.notice} ${styles[radar.status]}`} aria-live="polite"><div className={styles.heading}><div><p className="eyebrow">{radar.isDemo ? 'Synthetic route history' : 'Recent route history'}</p><h3>{title}</h3></div><button type="button" className={styles.dismiss} onClick={() => setDismissedQuery(query)} aria-label={`Dismiss route conditions for ${origin} to ${destination}`}>Dismiss</button></div><p>{radar.message}</p>{radar.status !== 'insufficient_data' && <dl><div><dt>Window</dt><dd>Last 30 days</dd></div><div><dt>Observed</dt><dd>{radar.sampleCount} shipments</dd></div><div><dt>Early arrivals</dt><dd>{early}</dd></div><div><dt>Delays</dt><dd>{delayed}</dd></div></dl>}{radar.typicalDelayDays !== null && <p className={styles.detail}>Typical delay among late deliveries: {radar.typicalDelayDays} days. This is observed history, not a delivery guarantee.</p>}{radar.dataThrough && <p className={styles.detail}>Evidence through {formatDate(radar.dataThrough)}.</p>}{radar.status === 'insufficient_data' && <p className={styles.detail}>There are not enough comparable records to call this route clear.</p>}</aside>;
}

function CitySuggestions({ cities, onChoose }: { cities: string[]; onChoose?: (city: string) => void }) {
 if (!cities.length || !onChoose) return null;
 return <p className={styles.suggestions}>Did you mean {cities.map((city) => <button type="button" key={city} onClick={() => onChoose(city)}>{city}</button>)}?</p>;
}
