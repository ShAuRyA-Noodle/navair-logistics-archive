'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage, formatDate, RequestError } from './api';
import { ForecastChart } from './forecast-chart';
import { Loading, Notice } from './notice';
import type { Forecast, Route, RoutePriceSeries } from './types';

type RouteResponse = { routes: Route[]; aliases?: Record<string, string> };

const normalize = (value: string) => value.trim().toLocaleLowerCase();

function routeLabel(route: Route) { return `${route.origin} → ${route.destination} · ${route.mode}`; }

function forecastError(reason: unknown) {
  if (reason instanceof RequestError && /UNAUTH/i.test(reason.code)) {
    return 'Sign in to access route forecasts. Insights are available after your shipment access has been accepted.';
  }
  return errorMessage(reason);
}

export function ForecastAnalyzer() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [seriesKey, setSeriesKey] = useState('');
  const [weeks, setWeeks] = useState(8);
  const [confidence, setConfidence] = useState<80 | 95>(80);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => { void (async () => { try { const result = await api<RouteResponse>('/api/routes'); setRoutes(result.routes); setAliases(result.aliases ?? {}); } catch (reason) { setError(forecastError(reason)); } finally { setLoading(false); } })(); }, []);
  const candidates = useMemo(() => {
    const resolvedOrigin = aliases[normalize(origin)] ?? origin;
    const resolvedDestination = aliases[normalize(destination)] ?? destination;
    return routes.filter((route) => (!resolvedOrigin || normalize(route.origin).includes(normalize(resolvedOrigin))) && (!resolvedDestination || normalize(route.destination).includes(normalize(resolvedDestination))));
  }, [aliases, destination, origin, routes]);
  const selected = routes.find((route) => route.id === selectedId) ?? candidates[0] ?? null;
  const series = useMemo<RoutePriceSeries[]>(() => selected?.priceSeries?.length ? selected.priceSeries : selected ? [{ unit: selected.unit, currency: 'INR' }] : [], [selected]);
  const selectedSeries = series.find((item) => `${item.unit}:${item.currency}` === seriesKey) ?? series[0] ?? null;
  useEffect(() => { setSeriesKey(series[0] ? `${series[0].unit}:${series[0].currency}` : ''); }, [selected?.id, series]);
  const aliasHint = useMemo(() => {
    const input = [origin, destination].map(normalize).find((value) => aliases[value]);
    return input ? `${input} is matched as ${aliases[input]}.` : null;
  }, [aliases, destination, origin]);

  function invalidateAnalysis() {
    request.current += 1;
    setForecast(null);
    setError(null);
    setAnalyzing(false);
  }

  async function analyze(nextWeeks=weeks,nextConfidence=confidence) {
    if (!selected || !selectedSeries) { setError('Choose a source and destination with an available route before analyzing.'); return; }
    const current = request.current + 1;
    request.current = current;
    setAnalyzing(true); setError(null); setForecast(null);
    try {
      const parameters = new URLSearchParams({ weeks: String(nextWeeks), confidence: String(nextConfidence), unit: selectedSeries.unit, currency: selectedSeries.currency });
      const result = await api<Forecast>(`/api/routes/${encodeURIComponent(selected.id)}/forecast?${parameters}`);
      if (request.current === current) setForecast(result);
    } catch (reason) {
      if (request.current === current) setError(forecastError(reason));
    } finally { if (request.current === current) setAnalyzing(false); }
  }

  if (loading) return <div className="page-shell"><Loading label="Loading available routes" /></div>;
  return <div className="page-shell forecast-shell">
    <div className="page-title"><div><p className="eyebrow">Trend forecast analyzer</p><h1>Price trends for your route</h1></div><p>Compare observed selling prices with the next one to eight weeks of projected route pricing.</p></div>
    {error && <Notice>{error}</Notice>}
    <section className="card forecast-query" aria-labelledby="route-query-title"><div><p className="eyebrow">Select a route</p><h2 id="route-query-title">Source and destination</h2></div>
      <div className="forecast-search-grid"><label>Source<input value={origin} onChange={(event) => { invalidateAnalysis(); setOrigin(event.target.value); setSelectedId(''); }} placeholder="e.g. Delhi" list="forecast-origins" /></label><label>Destination<input value={destination} onChange={(event) => { invalidateAnalysis(); setDestination(event.target.value); setSelectedId(''); }} placeholder="e.g. Bombay" list="forecast-destinations" /></label><datalist id="forecast-origins">{routes.map((route) => <option key={route.id} value={route.origin} />)}</datalist><datalist id="forecast-destinations">{routes.map((route) => <option key={route.id} value={route.destination} />)}</datalist></div>
      {aliasHint && <p className="forecast-alias" role="status">Route alias: {aliasHint}</p>}
      <div className="forecast-control-grid"><label>Matching route<select value={selected?.id ?? ''} onChange={(event) => { invalidateAnalysis(); setSelectedId(event.target.value); }} disabled={candidates.length === 0}><option value="">{candidates.length ? 'Choose a route' : 'No matching routes'}</option>{candidates.map((route) => <option value={route.id} key={route.id}>{routeLabel(route)}</option>)}</select></label><label>Price unit<select value={selectedSeries ? `${selectedSeries.unit}:${selectedSeries.currency}` : ''} onChange={(event) => { invalidateAnalysis(); setSeriesKey(event.target.value); }} disabled={!selectedSeries}>{series.map((item) => <option value={`${item.unit}:${item.currency}`} key={`${item.unit}:${item.currency}`}>{item.currency} / {item.unit}</option>)}</select></label><label>Timeline<select value={weeks} onChange={(event) => { const next=Number(event.target.value); const refresh=Boolean(forecast)||analyzing; invalidateAnalysis(); setWeeks(next); if(refresh) void analyze(next,confidence); }}>{Array.from({ length: 8 }, (_, index) => index + 1).map((week) => <option value={week} key={week}>{week} week{week === 1 ? '' : 's'}</option>)}</select></label><label>Forecast confidence<select value={confidence} onChange={(event) => { const next=Number(event.target.value) as 80|95; const refresh=Boolean(forecast)||analyzing; invalidateAnalysis(); setConfidence(next); if(refresh) void analyze(weeks,next); }}><option value={80}>80%</option><option value={95}>95%</option></select></label><button type="button" onClick={() => void analyze()} disabled={!selected || !selectedSeries || analyzing}>{analyzing ? 'Analyzing route…' : 'Analyze route'}</button></div>
      {selected && <p className="forecast-selection">Selected route: <strong>{routeLabel(selected)}</strong>{selectedSeries ? <> · Comparing <strong>{selectedSeries.currency} / {selectedSeries.unit}</strong></> : ' · Comparable series require authorized route access.'}</p>}
    </section>
    {analyzing && <Loading label="Analyzing route history and projection" />}
    {forecast && <ForecastResults data={forecast} />}
  </div>;
}

export function ForecastResults({ data }: { data: Forecast }) {
  if (data.status !== 'available' && data.history.length === 0) return <section className="card"><div className="empty"><p>{data.reason ?? 'A forecast is not available for this route.'}</p><p className="muted">No comparable selling-price history is available for this route yet.</p></div></section>;
  return <section className="card forecast-results"><div className="section-heading"><div><p className="eyebrow">Route outlook</p><h2>History and future projection</h2><p>{data.isDemo ? 'Synthetic demo data · experimental estimates' : 'Historical customer prices · experimental estimates'}</p></div><p className="forecast-data-through">Data through {formatDate(data.dataThrough)}</p></div>{data.status === 'available' ? <p className="muted">Observed history is shown as a solid line. The dashed projection and shaded range show the next {data.weeks} weeks at {data.confidence}% confidence.</p> : <p className="muted">{data.reason ?? 'There is not enough comparable data for a future projection.'} The observed price history remains available below.</p>}<ForecastChart data={data} /><p className="muted">The confidence level changes the uncertainty range, not the central price estimate. Projections are estimates, not a confirmed quote.</p><HistoricalPriceTable data={data} />{data.status === 'available' && <div className="table-wrap"><table><caption>Projected route prices</caption><thead><tr><th scope="col">Week</th><th scope="col">Date</th><th scope="col">Projected price</th><th scope="col">{data.confidence}% range</th></tr></thead><tbody>{data.points.map((point) => <tr key={`${point.week}-${point.date}`}><th scope="row">{point.week}</th><td>{formatDate(point.date)}</td><td>{data.currency} {point.estimate.toLocaleString()} / {data.unit}</td><td>{data.currency} {point.lower.toLocaleString()}–{point.upper.toLocaleString()} / {data.unit}</td></tr>)}</tbody></table></div>}</section>;
}

export function HistoricalPriceTable({ data }: { data: Forecast }) {
  if (data.history.length === 0) return null;
  return <details className="forecast-history-details"><summary>View {data.history.length} weeks of recorded prices</summary><div className="table-wrap"><table><caption>Observed selling-price history</caption><thead><tr><th scope="col">Date</th><th scope="col">Observed selling price</th></tr></thead><tbody>{data.history.map((item) => <tr key={item.date}><th scope="row">{formatDate(item.date)}</th><td>{data.currency} {item.price.toLocaleString()} / {data.unit}</td></tr>)}</tbody></table></div></details>;
}
