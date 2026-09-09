'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, errorMessage, formatDate, formatDateTime, patch } from '@/components/api';
import { Loading, Notice } from '@/components/notice';
import { nextStages, stageLabel } from '@/lib/lifecycle';
import type { Actor, Commitment, Enquiry, Finance, Forecast, Journey, MailMessage, Pagination, Route, Session, ShipmentMode } from '@/components/types';

const permissions = ['cases.all', 'cases.assigned', 'cases.accept', 'shipments.update', 'finance.view', 'commitments.manage', 'mail.manage'] as const;
const permissionLabels: Record<typeof permissions[number], string> = { 'cases.all': 'View all cases', 'cases.assigned': 'View assigned cases', 'cases.accept': 'Accept cases', 'shipments.update': 'Update shipments', 'finance.view': 'View buying costs', 'commitments.manage': 'Manage commitments', 'mail.manage': 'Manage email' };
const can = (actor: Actor, permission: string) => actor.active && (actor.role === 'owner' || (actor.role === 'staff' && actor.permissions.includes(permission)));

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [selected, setSelected] = useState<Enquiry | null>(null);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [members, setMembers] = useState<Actor[]>([]);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [mail, setMail] = useState<MailMessage[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 50, hasMore: false });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const selectRequest = useRef(0);
  const user = session?.user;
  const loadCore = useCallback(async (page: number) => { const [result, routeResult] = await Promise.all([api<{ enquiries: Enquiry[]; pagination: Pagination }>(`/api/enquiries?page=${page}&pageSize=50`), api<{ routes: Route[] }>('/api/routes')]); setEnquiries(result.enquiries); setPagination(result.pagination); setRoutes(routeResult.routes); }, []);
  const loadExtras = useCallback(async (actor: Actor) => {
    const work: Array<Promise<void>> = [];
    if (actor.role === 'owner') work.push(api<{ members: Actor[] }>('/api/team').then((result) => setMembers(result.members)));
    if (can(actor, 'commitments.manage')) work.push(api<{ commitments: Commitment[] }>('/api/commitments').then((result) => setCommitments(result.commitments)));
    if (can(actor, 'mail.manage')) work.push(api<{ messages: MailMessage[] }>('/api/mail').then((result) => setMail(result.messages)));
    await Promise.all(work);
  }, []);
  useEffect(() => { void (async () => { try { const value = await api<Session>('/api/auth/session'); setSession(value); if (value.user && value.user.role !== 'customer') { await loadCore(1); await loadExtras(value.user); } } catch (reason) { setError(errorMessage(reason)); } finally { setLoading(false); } })(); }, [loadCore, loadExtras]);
  async function select(item: Enquiry) { const request = selectRequest.current + 1; selectRequest.current = request; setSelected(item); setJourney(null); setDetailLoading(true); setError(null); try { const detail = await api<Enquiry>(`/api/enquiries/${item.id}`); const nextJourney = detail.status === 'accepted' ? await api<Journey>(`/api/enquiries/${item.id}/journey`) : null; if (request === selectRequest.current) { setSelected(detail); setJourney(nextJourney); } } catch (reason) { if (request === selectRequest.current) setError(errorMessage(reason)); } finally { if (request === selectRequest.current) setDetailLoading(false); } }
  async function refresh(selectedId?: string) { try { await loadCore(pagination.page); if (user) await loadExtras(user); if (selectedId) { const detail = await api<Enquiry>(`/api/enquiries/${selectedId}`); setSelected(detail); if (detail.status === 'accepted') setJourney(await api<Journey>(`/api/enquiries/${selectedId}/journey`)); } } catch (reason) { setError(errorMessage(reason)); } }
  async function changePage(page: number) { selectRequest.current += 1; setSelected(null); setJourney(null); setError(null); setPageLoading(true); try { await loadCore(page); } catch (reason) { setError(errorMessage(reason)); } finally { setPageLoading(false); } }
  if (loading) return <div className="page-shell"><Loading label="Opening workspace" /></div>;
  if (!user) return <div className="page-shell narrow"><Notice>You need to sign in to access the workspace.</Notice><Link href="/login" className="button-link">Sign in</Link></div>;
  if (user.role === 'customer') return <div className="page-shell narrow"><Notice tone="info">This account has customer access.</Notice><Link href="/portal" className="button-link">Open my shipments</Link></div>;
  return <div className="page-shell workspace"><div className="page-title"><div><p className="eyebrow">Operations workspace</p><h1>Cases</h1></div><p>{user.name} · {user.role}</p></div>{error && <Notice>{error}</Notice>}
    <div className="split admin-split"><section className="card case-table"><h2>Enquiries</h2>{pageLoading ? <Loading label="Loading enquiries" /> : enquiries.length === 0 ? <div className="empty">No enquiries are assigned to this workspace.</div> : <div className="table-wrap"><table><thead><tr><th>Reference</th><th>Route</th><th>Status</th><th>Received</th></tr></thead><tbody>{enquiries.map((item) => <tr key={item.id} className={selected?.id === item.id ? 'active-row' : ''}><td><button className="table-button" onClick={() => void select(item)}>{item.reference}</button></td><td>{item.origin} → {item.destination}</td><td><span className={`status ${item.status}`}>{item.status}</span></td><td>{formatDate(item.createdAt)}</td></tr>)}</tbody></table></div>}<Pager pagination={pagination} loading={pageLoading} onPageChange={changePage} /></section>
      <section>{detailLoading && <Loading label="Loading case" />}{selected && !detailLoading && <CaseDetail key={selected.id} item={selected} journey={journey} user={user} members={members} routes={routes} onChanged={() => void refresh(selected.id)} />}{!selected && !detailLoading && <div className="empty">Select an enquiry to review it.</div>}</section></div>
    {can(user, 'commitments.manage') && <CommitmentPanel commitments={commitments} enquiries={enquiries} user={user} onChanged={() => void refresh()} />}
    {user.role === 'owner' && <TeamPanel members={members} onChanged={() => void refresh()} />}
    {can(user, 'mail.manage') && <MailPanel mail={mail} onChanged={() => void refresh()} />}
  </div>;
}

function CaseDetail({ item, journey, user, members, routes, onChanged }: { item: Enquiry; journey: Journey | null; user: Actor; members: Actor[]; routes: Route[]; onChanged: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ShipmentMode>(item.mode === 'unsure' ? 'air' : item.mode);
  const [assignedTo, setAssignedTo] = useState(item.assignedTo ?? '');
  const canAccept = can(user, 'cases.accept') && can(user, 'finance.view');
  const canAssign = can(user, 'cases.accept');
  const assignees = members.length > 0 ? members : [user];
  async function saveAssignment() { setBusy(true); setMessage(null); try { await api(`/api/enquiries/${item.id}`, patch({ assignedTo: assignedTo || null, ...(item.mode === 'unsure' ? { mode } : {}) })); setMessage(item.mode === 'unsure' ? 'Assignment and transport mode confirmed.' : 'Assignment saved.'); onChanged(); } catch (reason) { setMessage(errorMessage(reason)); } finally { setBusy(false); } }
  return <div className="detail-stack"><article className="card"><div className="detail-top"><div><p className={`status ${item.status}`}>{item.status}</p><h2>{item.origin} → {item.destination}</h2><p>{item.reference} · {item.mode}</p></div><dl><div><dt>Received</dt><dd>{formatDateTime(item.createdAt)}</dd></div><div><dt>Assigned</dt><dd>{item.assignedTo ? 'Assigned' : 'Unassigned'}</dd></div></dl></div><p>{item.description}</p><p className="muted">{item.name} · {item.email} {item.phone ? `· ${item.phone}` : ''}</p>{message && <Notice tone={message.includes('confirmed') ? 'success' : 'error'}>{message}</Notice>}
    {item.status === 'pending' && canAssign && <div className="inline-action"><label>Assigned to<select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}><option value="">Unassigned</option>{assignees.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>{item.mode === 'unsure' && <label>Confirm service<select value={mode} onChange={(event) => setMode(event.target.value as ShipmentMode)}>{(['air','sea','road','courier','other'] as ShipmentMode[]).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}<button onClick={() => void saveAssignment()} disabled={busy}>Save assignment</button></div>}
    {item.status === 'pending' && canAccept && <AcceptForm key={item.id} item={item} routes={routes} onChanged={onChanged} />}
  </article>{journey && <ShipmentPanel key={journey.shipment.id} journey={journey} canUpdate={can(user, 'shipments.update')} onChanged={onChanged} />}{item.status === 'accepted' && can(user, 'finance.view') && <FinancePanel key={item.id} enquiryId={item.id} />}</div>;
}

function Pager({ pagination, loading, onPageChange }: { pagination: Pagination; loading: boolean; onPageChange: (page: number) => void }) {
  return <nav className="pager" aria-label="Enquiry pages"><button disabled={loading || pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)}>Previous</button><span>Page {pagination.page}</span><button disabled={loading || !pagination.hasMore} onClick={() => onPageChange(pagination.page + 1)}>Next</button></nav>;
}

function FinancePanel({ enquiryId }: { enquiryId: string }) {
  const [finance, setFinance] = useState<Finance | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; void (async () => { try { const [saved, projection] = await Promise.all([api<Finance | null>(`/api/enquiries/${enquiryId}/finance`), api<Forecast>(`/api/enquiries/${enquiryId}/cost-forecast?weeks=8&confidence=80`)]); if (active) { setFinance(saved); setForecast(projection); } } catch (reason) { if (active) setError(errorMessage(reason)); } })(); return () => { active = false; }; }, [enquiryId]);
  return <section className="card private-panel"><p className="eyebrow">Private finance</p><h2>Internal cost view</h2>{error && <Notice>{error}</Notice>}{!finance && !error && <Loading label="Loading internal finance" />}{finance && <><dl className="finance-summary"><div><dt>Buying rate</dt><dd>{finance.currency} {finance.buyingCost.toLocaleString()} / {finance.unit}</dd></div><div><dt>Selling rate</dt><dd>{finance.currency} {finance.sellingPrice.toLocaleString()} / {finance.unit}</dd></div><div><dt>Margin per unit</dt><dd>{finance.currency} {finance.margin.toLocaleString()} / {finance.unit}</dd></div><div><dt>Total margin ({finance.quantity.toLocaleString()} {finance.unit})</dt><dd>{finance.currency} {(finance.margin * finance.quantity).toLocaleString()}</dd></div></dl>{forecast?.status === 'available' ? <div className="cost-forecast"><h3>Internal cost forecast</h3><p className="muted">{forecast.label}</p><ul>{forecast.points.slice(0, 3).map((point) => <li key={point.week}>Week {point.week}: {forecast.currency} {point.estimate.toLocaleString()} / {forecast.unit} ({point.lower.toLocaleString()}–{point.upper.toLocaleString()})</li>)}</ul></div> : forecast && <p className="muted">{forecast.reason ?? 'No internal cost forecast is available.'}</p>}</>}</section>;
}

function AcceptForm({ item, routes, onChanged }: { item: Enquiry; routes: Route[]; onChanged: () => void }) {
  const matchingRoutes = routes.filter((route) => route.origin === item.origin && route.destination === item.destination && route.mode === item.mode);
  const units = [...new Set(matchingRoutes.map((route) => route.unit))];
  const [unit, setUnit] = useState(units[0] ?? 'shipment');
  const [sellingPrice, setSellingPrice] = useState('');
  const [buyingCost, setBuyingCost] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const total = Number(sellingPrice) * Number(quantity);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError(null); try { await api(`/api/enquiries/${item.id}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sellingPrice: Number(sellingPrice), buyingCost: Number(buyingCost), currency: 'INR', unit, quantity: Number(quantity), promisedAt: new Date(String(data.get('promisedAt'))).toISOString(), version: item.version }) }); onChanged(); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } }
  return <form className="mini-form" onSubmit={submit}><h3>Accept and create shipment</h3>{error && <Notice>{error}</Notice>}<div className="form-grid"><label>Selling price (INR per {unit})<input name="sellingPrice" value={sellingPrice} onChange={(event) => setSellingPrice(event.target.value)} type="number" min="0" step="0.01" required /></label><label>Buying cost (INR per {unit})<input name="buyingCost" value={buyingCost} onChange={(event) => setBuyingCost(event.target.value)} type="number" min="0" step="0.01" required /></label><label>Unit<select name="unit" value={unit} onChange={(event) => setUnit(event.target.value)}>{(units.length > 0 ? units : ['shipment']).map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label>Quantity ({unit})<input name="quantity" value={quantity} onChange={(event) => setQuantity(event.target.value)} type="number" min="0.01" step="0.01" required /></label><label className="full">Promised date<input name="promisedAt" type="datetime-local" required /></label></div>{Number.isFinite(total) && sellingPrice !== '' && quantity !== '' && <p className="muted">Total selling amount: INR {total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>}<button disabled={busy}>{busy ? 'Accepting…' : 'Accept case'}</button></form>;
}

function ShipmentPanel({ journey, canUpdate, onChanged }: { journey: Journey; canUpdate: boolean; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const next = nextStages(journey.shipment.status, { mode: journey.enquiry.mode, transitDays: journey.shipment.transitDays ?? null, crossBorder: journey.shipment.crossBorder ?? null });
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const status = String(data.get('status')); setBusy(true); setError(null); try { await api(`/api/shipments/${journey.shipment.id}`, patch({ status, estimatedAt: data.get('estimatedAt') ? new Date(String(data.get('estimatedAt'))).toISOString() : undefined, actualAt: data.get('actualAt') ? new Date(String(data.get('actualAt'))).toISOString() : undefined, note: String(data.get('note') ?? ''), version: journey.shipment.version })); onChanged(); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } }
  const rate = journey.shipment.sellingPrice ?? 0;
  const quantity = journey.shipment.quantity ?? 0;
  return <section className="card"><p className="eyebrow">Shipment</p><h2>{stageLabel(journey.shipment.status)}</h2><p>Promised date: <strong>{formatDateTime(journey.shipment.promisedAt)}</strong></p><p>Agreed rate: <strong>{journey.shipment.currency} {rate.toLocaleString()} / {journey.shipment.unit} × {quantity.toLocaleString()} = {journey.shipment.currency} {(rate * quantity).toLocaleString()}</strong></p><ol className="timeline">{journey.events.map((event) => <li key={event.id}><span /><div><strong>{stageLabel(event.status)}</strong><p>{event.description}</p><time>{formatDateTime(event.occurredAt)}</time></div></li>)}</ol>{canUpdate && next.length > 0 && <form className="mini-form" onSubmit={submit}><h3>Update shipment</h3>{error && <Notice>{error}</Notice>}<div className="form-grid"><label>Status<select name="status">{next.map((status) => <option key={status} value={status}>{stageLabel(status)}</option>)}</select></label><label>New estimate<input name="estimatedAt" type="datetime-local" /></label><label>Actual delivery<input name="actualAt" type="datetime-local" /></label><label className="full">Customer-facing update<textarea name="note" rows={2} required /></label></div><button disabled={busy}>{busy ? 'Saving…' : 'Save shipment update'}</button></form>}</section>;
}



function CommitmentPanel({ commitments, enquiries, user, onChanged }: { commitments: Commitment[]; enquiries: Enquiry[]; user: Actor; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); try { await api('/api/commitments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enquiryId: data.get('enquiryId'), assignedTo: user.id, title: data.get('title'), dueAt: new Date(String(data.get('dueAt'))).toISOString() }) }); form.reset(); onChanged(); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } }
  async function complete(id: string) { try { await api(`/api/commitments/${id}`, patch({ completedAt: new Date().toISOString() })); onChanged(); } catch (reason) { setError(errorMessage(reason)); } }
  return <section className="card panel"><p className="eyebrow">Follow-up</p><h2>Commitments</h2>{error && <Notice>{error}</Notice>}<form className="inline-form" onSubmit={submit}><select name="enquiryId" required defaultValue=""><option value="" disabled>Choose case</option>{enquiries.map((item) => <option key={item.id} value={item.id}>{item.reference} · {item.origin} → {item.destination}</option>)}</select><input name="title" placeholder="Follow-up task" required /><input name="dueAt" type="datetime-local" required /><button disabled={busy}>Add</button></form><ul className="check-list">{commitments.length === 0 ? <li className="muted">No open commitments.</li> : commitments.map((item) => <li key={item.id}><span><strong>{item.title}</strong><small>{item.reference} · due {formatDateTime(item.dueAt)}</small></span>{item.completedAt ? <span className="status delivered">Complete</span> : <button onClick={() => void complete(item.id)}>Complete</button>}</li>)}</ul></section>;
}

function TeamPanel({ members, onChanged }: { members: Actor[]; onChanged: () => void }) {
  const [draft, setDraft] = useState<Record<string, Actor>>({}); const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState<string | null>(null);
  const current = (member: Actor) => draft[member.id] ?? member;
  function change(member: Actor, next: Partial<Actor>) { setDraft((all) => ({ ...all, [member.id]: { ...current(member), ...next } })); }
  async function save(member: Actor) { const value = current(member); setSaving(member.id); try { await api(`/api/team/${member.id}`, patch({ permissions: value.permissions, active: value.active })); setDraft((all) => { const next = { ...all }; delete next[member.id]; return next; }); onChanged(); } catch (reason) { setError(errorMessage(reason)); } finally { setSaving(null); } }
  return <section className="card panel"><p className="eyebrow">Owner controls</p><h2>Team access</h2>{error && <Notice>{error}</Notice>}<div className="team-list">{members.map((member) => { const value = current(member); const immutable = member.role === 'owner'; return <article key={member.id} className="team-row"><div><strong>{member.name}</strong><p>{member.email} · {member.role}</p></div><div className="permission-list">{permissions.map((permission) => <label key={permission}><input type="checkbox" disabled={immutable || member.role === 'customer'} checked={value.permissions.includes(permission)} onChange={(event) => change(member, { permissions: event.target.checked ? [...value.permissions, permission] : value.permissions.filter((item) => item !== permission) })} />{permissionLabels[permission]}</label>)}</div><label className="active-toggle"><input type="checkbox" disabled={immutable} checked={value.active} onChange={(event) => change(member, { active: event.target.checked })} />Active</label>{!immutable && <button onClick={() => void save(member)} disabled={saving === member.id}>{saving === member.id ? 'Saving…' : 'Save'}</button>}</article>; })}</div></section>;
}

function MailPanel({ mail, onChanged }: { mail: MailMessage[]; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function process() { setBusy(true); try { await api('/api/mail/process', { method: 'POST' }); onChanged(); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } }
  return <section className="card panel"><div className="section-heading"><div><p className="eyebrow">Preview inbox</p><h2>Queued mail</h2></div><button onClick={() => void process()} disabled={busy}>{busy ? 'Processing…' : 'Process queued mail'}</button></div>{error && <Notice>{error}</Notice>}<div className="mail-list">{mail.length === 0 ? <p className="muted">No preview messages.</p> : mail.map((item) => <article key={item.id}><div><strong>{item.subject}</strong><p>To {item.recipient} · {formatDateTime(item.createdAt)}</p></div><span className={`status ${item.status}`}>{item.status}</span><pre>{item.body}</pre>{item.lastError && <p className="notice notice-error">{item.lastError}</p>}</article>)}</div></section>;
}
