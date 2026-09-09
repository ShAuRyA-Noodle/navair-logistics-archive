'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api';
import { Loading, Notice } from './notice';
import { RouteConditionNotice } from './route-condition-notice';
import type { Route, ShipmentMode } from './types';

type FormState = { name: string; email: string; phone: string; origin: string; destination: string; mode: ShipmentMode; description: string };
const blank: FormState = { name: '', email: '', phone: '', origin: '', destination: '', mode: 'air', description: '' };
const modes: ShipmentMode[] = ['air', 'sea', 'road', 'courier', 'other', 'unsure'];
const newKey = () => crypto.randomUUID();

export function EnquiryForm() {
  const [form, setForm] = useState<FormState>(blank);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [website, setWebsite] = useState('');
  const intent = useRef({ fingerprint: '', key: newKey() });
  useEffect(() => { void api<{ routes: Route[] }>('/api/routes').then((result) => setRoutes(result.routes)).catch(() => undefined); }, []);
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => { setForm((current) => ({ ...current, [key]: value })); setReference(null); };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    if (form.description.trim().length < 10) { setError('Please provide at least 10 characters about the shipment.'); return; }
    const fingerprint = JSON.stringify(form);
    if (intent.current.fingerprint !== fingerprint) intent.current = { fingerprint, key: newKey() };
    setLoading(true);
    try {
      const result = await api<{ reference: string }>('/api/enquiries', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': intent.current.key },
        body: JSON.stringify({ enquiry: form, website }),
      });
      setReference(result.reference); setForm(blank); intent.current = { fingerprint: '', key: newKey() };
    } catch (reason) { setError(errorMessage(reason)); } finally { setLoading(false); }
  }
  if (reference) return <section className="card confirmation" aria-labelledby="confirmation-title"><p className="eyebrow">Received</p><h2 id="confirmation-title">We received your enquiry.</h2><p>Reference <strong>{reference}</strong>. Our team will review availability and shipment details, then follow up. This does not confirm service, a booking, or a quote.</p><button onClick={() => setReference(null)}>Start another enquiry</button></section>;
  return <form className="enquiry-form card" onSubmit={submit} noValidate>
    <div className="section-heading"><div><p className="eyebrow">First shipment enquiry</p><h2>Tell us where it needs to go.</h2></div><p>Start with the route, then add just enough detail for a considered reply. Fields marked * are required.</p></div>
    {error && <Notice>{error}</Notice>}
    <div className="form-grid">
      <label>Origin *<input list="origins" value={form.origin} onChange={(e) => update('origin', e.target.value)} required placeholder="City or airport" autoComplete="shipping address-level2" /></label>
      <label>Destination *<input list="destinations" value={form.destination} onChange={(e) => update('destination', e.target.value)} required placeholder="City or airport" autoComplete="shipping address-level2" /></label>
      <label>Service *<select value={form.mode} onChange={(e) => update('mode', e.target.value as ShipmentMode)}>{modes.map((mode) => <option key={mode} value={mode}>{mode === 'unsure' ? 'Not sure yet' : mode[0].toUpperCase() + mode.slice(1)}</option>)}</select></label>
      <div className="full"><RouteConditionNotice origin={form.origin} destination={form.destination} mode={form.mode} /></div>
      <label htmlFor="enquiry-name">Name *<input id="enquiry-name" name="name" value={form.name} onChange={(e) => update('name', e.target.value)} autoComplete="name" required /></label>
      <label htmlFor="enquiry-email">Email *<input id="enquiry-email" name="email" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} autoComplete="email" required /></label>
      <label htmlFor="enquiry-phone">Phone <input id="enquiry-phone" name="phone" type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} autoComplete="tel" /></label>
      <label className="full">Shipment details *<textarea value={form.description} onChange={(e) => update('description', e.target.value)} required minLength={10} placeholder="Cargo, timing, size and any handling needs" rows={4} /></label>
    </div>
    <input className="honeypot" aria-hidden="true" tabIndex={-1} name="website" value={website} onChange={(event) => setWebsite(event.target.value)} autoComplete="off" />
    <datalist id="origins">{[...new Set(routes.map((route) => route.origin))].map((place) => <option key={place} value={place} />)}</datalist>
    <datalist id="destinations">{[...new Set(routes.map((route) => route.destination))].map((place) => <option key={place} value={place} />)}</datalist>
    <div className="form-footer"><p>Your details are used to assess this shipment request.</p><button type="submit" disabled={loading}>{loading ? 'Submitting…' : 'Submit enquiry'}</button></div>
    {loading && <Loading label="Saving your enquiry" />}
  </form>;
}
