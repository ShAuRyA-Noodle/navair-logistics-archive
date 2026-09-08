'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, errorMessage, formatDate, formatDateTime } from '@/components/api';
import { Loading, Notice } from '@/components/notice';
import type { Enquiry, Forecast, Journey, Pagination, Radar, Session } from '@/components/types';

export default function PortalPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [cases, setCases] = useState<Enquiry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [radar, setRadar] = useState<Radar | null>(null);
  const [weeks, setWeeks] = useState(8);
  const [confidence, setConfidence] = useState<80 | 95>(80);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 50, hasMore: false });
  const journeyRequest = useRef(0);
  const loadCases = useCallback(async (page: number) => { const result = await api<{ enquiries: Enquiry[]; pagination: Pagination }>(`/api/enquiries?page=${page}&pageSize=50`); setCases(result.enquiries); setPagination(result.pagination); }, []);
  useEffect(() => { void (async () => { try { const current = await api<Session>('/api/auth/session'); setSession(current); if (current.user) await loadCases(1); } catch (reason) { setError(errorMessage(reason)); } finally { setLoading(false); } })(); }, [loadCases]);
  const loadJourney = useCallback(async (id: string, nextWeeks = weeks, nextConfidence = confidence) => {
    const request = journeyRequest.current + 1;
    journeyRequest.current = request;
    setSelected(id); setError(null); setJourney(null); setForecast(null); setRadar(null);
    try {
      const [journeyData, forecastData, radarData] = await Promise.all([
        api<Journey>(`/api/enquiries/${id}/journey`), api<Forecast>(`/api/enquiries/${id}/forecast?weeks=${nextWeeks}&confidence=${nextConfidence}`), api<Radar>(`/api/enquiries/${id}/radar`),
      ]);
      if (request === journeyRequest.current) { setJourney(journeyData); setForecast(forecastData); setRadar(radarData); }
    } catch (reason) { if (request === journeyRequest.current) setError(errorMessage(reason)); }
  }, [confidence, weeks]);
  function changeForecast(nextWeeks: number, nextConfidence: 80 | 95) { setWeeks(nextWeeks); setConfidence(nextConfidence); if (selected) void loadJourney(selected, nextWeeks, nextConfidence); }
  async function changePage(page: number) { journeyRequest.current += 1; setSelected(null); setJourney(null); setForecast(null); setRadar(null); setError(null); setPageLoading(true); try { await loadCases(page); } catch (reason) { setError(errorMessage(reason)); } finally { setPageLoading(false); } }
  if (loading) return <div className="page-shell"><Loading label="Opening your shipments" /></div>;
  if (!session?.user) return <div className="page-shell narrow"><Notice>You need to sign in to view shipments.</Notice><Link className="button-link" href="/login">Sign in</Link></div>;
  if (session.user.role !== 'customer') return <div className="page-shell narrow"><Notice tone="info">This account has access to the operations workspace.</Notice><Link className="button-link" href="/admin">Open workspace</Link></div>;
  const pending = cases.filter((item) => item.status === 'pending');
  const accepted = cases.filter((item) => item.status === 'accepted');
  return <div className="page-shell workspace"><div className="page-title"><div><p className="eyebrow">Customer portal</p><h1>My shipments</h1></div><p>Shipment progress appears here after a case has been accepted.</p></div>{error && <Notice>{error}</Notice>}
    {pageLoading ? <Loading label="Loading shipments" /> : <>{pending.length > 0 && <section><h2>Awaiting review</h2><div className="card-grid">{pending.map((item) => <article className="case-card" key={item.id}><p className="status pending">Pending review</p><h3>{item.origin} → {item.destination}</h3><p>Receipt {item.reference}</p><small>Submitted {formatDate(item.createdAt)}</small></article>)}</div></section>}
    <section><div className="section-heading"><div><h2>Accepted shipments</h2><p>Choose a shipment to view its journey and route insights.</p></div></div>{accepted.length === 0 ? <div className="empty">No accepted shipments on this page.</div> : <div className="split"><div className="case-list">{accepted.map((item) => <button className={`case-row ${selected === item.id ? 'selected' : ''}`} key={item.id} onClick={() => void loadJourney(item.id)}><span><strong>{item.origin} → {item.destination}</strong><small>{item.reference} · {item.mode}</small></span><span className="status accepted">Accepted</span></button>)}</div><div>{selected && !journey && !error && <Loading label="Loading shipment" />}{journey && <JourneyView key={journey.enquiry.id} journey={journey} forecast={forecast} radar={radar} weeks={weeks} confidence={confidence} onForecastChange={changeForecast} />}</div></div>}<Pager pagination={pagination} loading={pageLoading} onPageChange={changePage} /></section></>}</div>;
}

function Pager({ pagination, loading, onPageChange }: { pagination: Pagination; loading: boolean; onPageChange: (page: number) => void }) {
  return <nav className="pager" aria-label="Shipment pages"><button disabled={loading || pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)}>Previous</button><span>Page {pagination.page}</span><button disabled={loading || !pagination.hasMore} onClick={() => onPageChange(pagination.page + 1)}>Next</button></nav>;
}

function JourneyView({ journey, forecast, radar, weeks, confidence, onForecastChange }: { journey: Journey; forecast: Forecast | null; radar: Radar | null; weeks: number; confidence: 80 | 95; onForecastChange: (weeks: number, confidence: 80 | 95) => void }) {
  const price = journey.shipment.sellingPrice ?? 0;
  const quantity = journey.shipment.quantity ?? 0;
  return <div className="detail-stack"><section className="card"><div className="detail-top"><div><p className={`status ${journey.shipment.status}`}>{journey.shipment.status.replaceAll('_', ' ')}</p><h2>{journey.enquiry.origin} → {journey.enquiry.destination}</h2><p>{journey.enquiry.reference} · {journey.enquiry.mode}</p></div><dl><div><dt>Promised</dt><dd>{formatDate(journey.shipment.promisedAt)}</dd></div><div><dt>Current estimate</dt><dd>{formatDate(journey.shipment.estimatedAt)}</dd></div><div><dt>Actual delivery</dt><dd>{journey.shipment.actualAt ? formatDate(journey.shipment.actualAt) : 'Pending'}</dd></div></dl></div><p className="rate-summary">Agreed rate <strong>{journey.shipment.currency} {price.toLocaleString()} / {journey.shipment.unit} × {quantity.toLocaleString()} = {journey.shipment.currency} {(price * quantity).toLocaleString()}</strong></p><ol className="timeline">{journey.events.map((event) => <li key={event.id}><span /><div><strong>{event.status.replaceAll('_', ' ')}</strong><p>{event.description}</p><time>{formatDateTime(event.occurredAt)}</time></div></li>)}</ol></section>
      <section className="card"><div className="section-heading"><div><p className="eyebrow">Route forecast</p><h2>Experimental selling-price trend</h2></div><div className="controls"><label>Weeks<select value={weeks} onChange={(event) => onForecastChange(Number(event.target.value), confidence)}>{Array.from({ length: 8 }, (_, index) => index + 1).map((week) => <option value={week} key={week}>{week}</option>)}</select></label><label>Range<select value={confidence} onChange={(event) => onForecastChange(weeks, Number(event.target.value) as 80 | 95)}><option value={80}>80%</option><option value={95}>95%</option></select></label></div></div>{forecast && <ForecastView key={journey.enquiry.id} data={forecast} />}</section>
    <section className="card"><p className="eyebrow">Route evidence</p><h2>Route conditions</h2>{radar ? <div className={`radar radar-${radar.status}`}><p><strong>{radar.status.replace('_', ' ')}</strong> — {radar.message}</p><dl><div><dt>Recent evidence</dt><dd>{radar.sampleCount} shipments</dd></div><div><dt>Typical delay</dt><dd>{radar.typicalDelayDays === null ? 'Not available' : `${radar.typicalDelayDays} days`}</dd></div><div><dt>Updated through</dt><dd>{radar.dataThrough ?? '—'}</dd></div></dl>{radar.issues.length > 0 && <p className="muted">Observed categories: {radar.issues.join(', ')}.</p>}</div> : <Loading label="Loading route evidence" />}</section>
  </div>;
}

function ForecastView({ data }: { data: Forecast }) {
  if (data.status !== 'available') return <div className="empty"><p>{data.reason ?? 'A forecast is not available for this route.'}</p><p className="muted">Historical evidence is shown only when there is enough comparable data. A forecast is never a price guarantee.</p></div>;
  const qualifier = data.isDemo ? 'This is a synthetic experimental estimate' : 'This is an experimental estimate based on comparable historical selling prices';
  return <><p className="muted">{data.label}. {qualifier}, not a binding quote or price guarantee.</p><ForecastChart data={data} /><div className="table-wrap"><table><caption className="sr-only">Forecast estimates and uncertainty ranges</caption><thead><tr><th>Week</th><th>Date</th><th>Estimate</th><th>{data.confidence}% range</th></tr></thead><tbody>{data.points.map((point) => <tr key={point.week}><td>{point.week}</td><td>{point.date}</td><td>{data.currency} {point.estimate.toLocaleString()} / {data.unit}</td><td>{data.currency} {point.lower.toLocaleString()}–{point.upper.toLocaleString()}</td></tr>)}</tbody></table></div><p className="muted">Data through {formatDate(data.dataThrough)}. {data.metrics.backtestCount > 0 ? `${data.metrics.backtestCount} holdout comparisons.` : 'No independent holdout comparison is available.'}</p></>;
}

function ForecastChart({ data }: { data: Forecast }) {
  const points = [...data.history.map((item) => ({ ...item, kind: 'history' as const })), ...data.points.map((item) => ({ date: item.date, price: item.estimate, lower: item.lower, upper: item.upper, kind: 'forecast' as const }))];
  if (points.length === 0) return null;
  const values = points.flatMap((point) => point.kind === 'forecast' ? [point.lower, point.upper] : [point.price]);
  const min = Math.min(...values); const max = Math.max(...values); const span = max - min || 1; const width = 640; const height = 220; const pad = 24;
  const xy = (index: number, price: number) => ({ x: pad + index * ((width - pad * 2) / Math.max(1, points.length - 1)), y: height - pad - ((price - min) / span) * (height - pad * 2) });
  const historyPath = data.history.map((item, index) => { const p = xy(index, item.price); return `${index === 0 ? 'M' : 'L'}${p.x},${p.y}`; }).join(' ');
  const band = data.points.map((item, index) => xy(index + data.history.length, item.upper)).concat([...data.points].reverse().map((item, reverseIndex) => xy(data.history.length + data.points.length - 1 - reverseIndex, item.lower))).map((p, index) => `${index === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z';
  const forecastLine = data.points.map((item, index) => { const p = xy(index + data.history.length, item.estimate); return `${index === 0 ? 'M' : 'L'}${p.x},${p.y}`; }).join(' ');
  return <figure className="chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Selling-price history and ${data.weeks}-week forecast in ${data.currency} per ${data.unit}`}><line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} /><path d={band} className="forecast-band" /><path d={historyPath} className="history-line" /><path d={forecastLine} className="forecast-line" /></svg><figcaption><span className="legend history" />History <span className="legend forecast" />Forecast <span className="legend band" />{data.confidence}% range</figcaption></figure>;
}
