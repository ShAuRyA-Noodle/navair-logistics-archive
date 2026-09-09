'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from './api';
import { LaneCockpit } from './lane-cockpit';
import { Loading, Notice } from './notice';
import type { Itinerary, ItineraryLeg, LaneAnalysis, RoutePlan } from './types';
import './lane-cockpit.css';

const MODE_WORDS: Record<string, string> = { air: 'Air', sea: 'Sea', road: 'Road', courier: 'Courier' };
const AHEAD_CHOICES: Array<[number, string]> = [
  [1, 'Next week'],
  [2, 'In two weeks'],
  [4, 'In a month'],
  [6, 'In six weeks'],
  [8, 'In two months'],
];

function legLabel(leg: ItineraryLeg) {
  const timing = leg.transitDays === null ? 'travel time not stated' : `about ${leg.transitDays} day${leg.transitDays === 1 ? '' : 's'}`;
  return `${MODE_WORDS[leg.mode] ?? leg.mode} · ${timing}${leg.serviceCoverage === 'supported' ? '' : ' · needs a desk check'}`;
}

export function ForecastAnalyzer() {
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<LaneAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [weeks, setWeeks] = useState(4);
  const [confidence, setConfidence] = useState<80 | 95>(80);
  const [cities, setCities] = useState<{ origins: string[]; destinations: string[] }>({ origins: [], destinations: [] });
  const [error, setError] = useState<string | null>(null);
  const planRequest = useRef(0);
  const analysisRequest = useRef(0);

  useEffect(() => {
    void api<RoutePlan>('/api/lanes/plan?origin=Mumbai&destination=Dubai')
      .then((result) => setCities(result.cities))
      .catch(() => undefined);
  }, []);

  const runPlan = useCallback(async (from: string, to: string) => {
    const current = planRequest.current + 1;
    planRequest.current = current;
    setPlanning(true);
    setError(null);
    try {
      const result = await api<RoutePlan>(`/api/lanes/plan?origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}`);
      if (planRequest.current !== current) return;
      setPlan(result);
      setCities(result.cities);
      setSelectedLaneId(result.direct[0]?.routeId ?? result.connecting[0]?.legs[0]?.routeId ?? null);
    } catch (reason) {
      if (planRequest.current === current) { setError(errorMessage(reason)); setPlan(null); }
    } finally {
      if (planRequest.current === current) setPlanning(false);
    }
  }, []);

  useEffect(() => {
    if (origin.trim().length < 2 || destination.trim().length < 2) { setPlan(null); setAnalysis(null); setSelectedLaneId(null); return; }
    const timer = setTimeout(() => { void runPlan(origin.trim(), destination.trim()); }, 350);
    return () => clearTimeout(timer);
  }, [destination, origin, runPlan]);

  useEffect(() => {
    if (!selectedLaneId) { setAnalysis(null); return; }
    const current = analysisRequest.current + 1;
    analysisRequest.current = current;
    setAnalyzing(true);
    void api<LaneAnalysis>(`/api/lanes/${selectedLaneId}/analysis?weeks=${weeks}&confidence=${confidence}`)
      .then((result) => { if (analysisRequest.current === current) { setAnalysis(result); setError(null); } })
      .catch((reason) => { if (analysisRequest.current === current) { setError(errorMessage(reason)); setAnalysis(null); } })
      .finally(() => { if (analysisRequest.current === current) setAnalyzing(false); });
  }, [confidence, selectedLaneId, weeks]);

  const laneChoices = useMemo(() => {
    if (!plan) return [];
    const fromItineraries = plan.connecting.flatMap((itinerary) => itinerary.legs);
    const seen = new Set<string>();
    return [...plan.direct, ...fromItineraries].filter((leg) => (seen.has(leg.routeId) ? false : seen.add(leg.routeId)));
  }, [plan]);

  const swap = () => { setOrigin(destination); setDestination(origin); };

  return <div className="page-shell forecast-shell">
    <div className="page-title">
      <div><p className="eyebrow">Trend forecast analyzer</p><h1>What will this route cost, and will it arrive on time?</h1></div>
      <p>Type where your cargo starts and where it needs to go. Navair shows the price trend, the delivery record other customers are seeing right now, and a way around when there is no direct service.</p>
    </div>

    {error && <Notice>{error}</Notice>}

    <section className="card lane-search" aria-labelledby="lane-search-title">
      <div><p className="eyebrow">Step 1</p><h2 id="lane-search-title">Pick your route</h2></div>
      <div className="lane-search-grid">
        <label>From
          <input value={origin} onChange={(event) => setOrigin(event.target.value)} list="lane-origins" placeholder="Jaipur" autoComplete="off" />
        </label>
        <button type="button" className="lane-swap" onClick={swap} disabled={!origin && !destination} aria-label="Swap origin and destination">⇄</button>
        <label>To
          <input value={destination} onChange={(event) => setDestination(event.target.value)} list="lane-destinations" placeholder="Bangkok" autoComplete="off" />
        </label>
        <datalist id="lane-origins">{cities.origins.map((city) => <option key={city} value={city} />)}</datalist>
        <datalist id="lane-destinations">{cities.destinations.map((city) => <option key={city} value={city} />)}</datalist>
      </div>
      {planning && <Loading label="Looking for services on this route" />}

      {plan?.outcome === 'same_city' && <Notice tone="info">Origin and destination are the same city. Change one of them to see a route.</Notice>}
      {plan && (plan.outcome === 'unknown_origin' || plan.outcome === 'unknown_destination' || plan.outcome === 'unknown_both') && <div className="lane-unknown">
        <p><strong>Navair does not have {plan.outcome === 'unknown_destination' ? 'that destination' : plan.outcome === 'unknown_origin' ? 'that origin' : 'either of those cities'} in its network yet.</strong> Pick one of these instead, or send an enquiry and the desk will look into it.</p>
        <div className="lane-city-suggestions">
          {(plan.outcome === 'unknown_destination' ? plan.cities.destinations : plan.cities.origins).slice(0, 14).map((city) => (
            <button type="button" key={city} onClick={() => (plan.outcome === 'unknown_destination' ? setDestination(city) : setOrigin(city))}>{city}</button>
          ))}
        </div>
      </div>}
      {plan?.outcome === 'no_service' && <Notice tone="info">
        Navair has no direct service and no connecting service between {plan.origin} and {plan.destination} at the moment. Send an enquiry and the desk will price it manually.
      </Notice>}

      {plan && plan.direct.length > 0 && <div className="lane-options">
        <p className="eyebrow">Direct services</p>
        <p className="lane-options-lead">Pick how you want it sent. The days shown are how long the cargo spends travelling, once it is collected.</p>
        <div className="lane-option-row">
          {plan.direct.map((leg) => <button type="button" key={leg.routeId}
            className={leg.routeId === selectedLaneId ? 'lane-option lane-option-active' : 'lane-option'}
            aria-pressed={leg.routeId === selectedLaneId}
            onClick={() => setSelectedLaneId(leg.routeId)}>
            <strong>{MODE_WORDS[leg.mode] ?? leg.mode}</strong>
            <span>{leg.transitDays === null ? 'travel time not stated' : `about ${leg.transitDays} day${leg.transitDays === 1 ? '' : 's'} travelling`}</span>
            {leg.serviceCoverage !== 'supported' && <span className="lane-option-flag">on request</span>}
          </button>)}
        </div>
      </div>}

      {plan && plan.connecting.length > 0 && <div className="lane-itineraries">
        <p className="eyebrow">{plan.direct.length > 0 ? 'Other ways to get there' : 'No direct service — here is a way around'}</p>
        {plan.connecting.map((itinerary: Itinerary) => <article key={itinerary.summary} className="lane-itinerary">
          <ol className="lane-itinerary-legs">
            {itinerary.legs.map((leg, index) => <li key={leg.routeId}>
              <span className="lane-itinerary-step">{index + 1}</span>
              <button type="button" className={leg.routeId === selectedLaneId ? 'lane-leg lane-leg-active' : 'lane-leg'} onClick={() => setSelectedLaneId(leg.routeId)}>
                {leg.origin} → {leg.destination}
                <small>{legLabel(leg)}</small>
              </button>
            </li>)}
          </ol>
          <p className="lane-itinerary-note">
            {itinerary.totalDays === null
              ? `${itinerary.legs.length} legs. Total transit time is not stated for every leg, so the desk confirms it.`
              : `About ${itinerary.totalDays} days door to door, including ${itinerary.handoverDays} day${itinerary.handoverDays === 1 ? '' : 's'} to transfer between services.`}
            {itinerary.needsDeskCheck && ' One leg is on request, so Navair confirms space before quoting.'}
            {' Each leg is priced in its own unit, so click a leg to study it.'}
          </p>
        </article>)}
      </div>}
    </section>

    {laneChoices.length > 0 && <section className="card lane-controls" aria-labelledby="lane-controls-title">
      <div><p className="eyebrow">Step 2</p><h2 id="lane-controls-title">When are you shipping?</h2>
        <p className="lane-controls-lead">We will show you what the price is likely to be around then.</p></div>
      <div className="lane-controls-row">
        <label>I am shipping
          <select value={weeks} onChange={(event) => setWeeks(Number(event.target.value))}>
            {AHEAD_CHOICES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>How safe should the price range be?
          <select value={confidence} onChange={(event) => setConfidence(Number(event.target.value) as 80 | 95)}>
            <option value={80}>Normal — right about 8 times out of 10</option>
            <option value={95}>Extra safe — right about 19 times out of 20</option>
          </select>
        </label>
        <p className="lane-controls-note">Picking &ldquo;extra safe&rdquo; only makes the price range wider so fewer surprises fall outside it. The expected price stays the same either way.</p>
      </div>
    </section>}

    {analyzing && !analysis && <Loading label="Reading this lane's history" />}
    {analysis && <section className="card lane-result">{<LaneCockpit analysis={analysis} />}</section>}
  </div>;
}
