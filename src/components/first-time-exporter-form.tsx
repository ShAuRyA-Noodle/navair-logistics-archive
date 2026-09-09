'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage, RequestError } from './api';
import { createExporterShipment, type ExporterShipmentInput } from './first-time-exporter-data';
import { Notice } from './notice';
import { RouteConditionNotice } from './route-condition-notice';
import { PlannedTimeline } from './shipment-timeline';
import type { ItineraryLeg, RoutePlan } from './types';
import styles from './first-time-exporter-form.module.css';

// One question per screen. A first-time exporter should never meet a wall of freight
// jargon, so each step asks for one thing in plain words, answers are mostly taps, and
// nothing is compulsory unless the desk genuinely cannot work without it. The payload
// posted at the end is identical to the long form's, so the server contract is unchanged.

type Mode = 'unsure' | 'air' | 'sea' | 'road' | 'courier';
type Size = 'few_boxes' | 'pallets' | 'container' | 'not_sure';
type When = 'now' | 'two_weeks' | 'month' | 'later' | 'flexible' | 'date';

export type Answers = {
  origin: string;
  destination: string;
  mode: Mode;
  cargoType: string;
  goodsDescription: string;
  size: Size;
  quantity: string;
  handling: string;
  handlingNote: string;
  weightValue: string;
  length: string;
  width: string;
  height: string;
  dimensionUnit: 'cm' | 'in';
  shapeNote: string;
  when: When;
  date: string;
  notes: string;
  name: string;
  email: string;
  phone: string;
};

export const blankAnswers: Answers = {
  origin: '', destination: '', mode: 'unsure', cargoType: 'not_sure', goodsDescription: '', size: 'not_sure',
  quantity: '', handling: 'not_sure', handlingNote: '', weightValue: '', length: '', width: '', height: '', dimensionUnit: 'cm',
  shapeNote: '', when: 'flexible', date: '', notes: '', name: '', email: '', phone: '',
};

const MODES: Array<[Mode, string, string]> = [
  ['unsure', 'Help me choose', 'Navair picks the best option for your cargo'],
  ['air', 'By air', 'Fastest, costs more'],
  ['sea', 'By sea', 'Cheapest for big loads, takes weeks'],
  ['road', 'By road', 'For journeys inside India'],
  ['courier', 'By courier', 'Best for small parcels and samples'],
];

const GOODS: Array<[string, string]> = [
  ['general_merchandise', 'General goods'], ['textiles', 'Clothes or fabric'], ['food_beverage', 'Food or drink'],
  ['electronics', 'Electronics'], ['machinery', 'Machinery or parts'], ['automotive', 'Vehicle parts'],
  ['pharmaceuticals', 'Medicines'], ['perishables', 'Fresh or frozen'], ['chemicals', 'Chemicals'],
  ['samples', 'Samples'], ['personal_effects', 'Personal belongings'], ['other', 'Something else'],
];

const SIZES: Array<[Size, string, string]> = [
  ['few_boxes', 'A few boxes', 'Anything you could load into a car'],
  ['pallets', 'Pallets', 'Stacked and wrapped, moved by forklift'],
  ['container', 'A full container', 'A shipping container of your own'],
  ['not_sure', 'I am not sure', 'Tell Navair roughly and the desk works it out'],
];

const HANDLING: Array<[string, string]> = [
  ['normal', 'Nothing special'],
  ['temperature_controlled', 'Must stay cold'],
  ['dangerous', 'Dangerous goods'],
  ['other', 'Something else'],
  ['not_sure', 'I am not sure'],
];

const WHENS: Array<[When, string]> = [
  ['now', 'It is ready now'],
  ['two_weeks', 'In a couple of weeks'],
  ['month', 'In about a month'],
  ['later', 'Later than a month'],
  ['flexible', 'No fixed date yet'],
  ['date', 'I know the exact date'],
];

const PACKAGE_BY_SIZE: Record<Size, string> = { few_boxes: 'boxes', pallets: 'pallets', container: 'container', not_sure: 'not_sure' };
const DAYS_BY_WHEN: Partial<Record<When, number>> = { now: 2, two_weeks: 14, month: 30 };

export function readinessDate(when: When, chosen: string) {
  if (when === 'date') return chosen;
  const days = DAYS_BY_WHEN[when];
  if (days === undefined) return '';
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

// The desk needs a sentence describing the cargo. If somebody answered only with taps,
// build that sentence from their own answers rather than making them write an essay.
export function describeGoods(answers: Answers) {
  const written = answers.goodsDescription.trim();
  if (written.length >= 10) return written;
  const goods = GOODS.find(([value]) => value === answers.cargoType)?.[1] ?? 'Goods';
  const size = SIZES.find(([value]) => value === answers.size)?.[1] ?? 'size not stated';
  const handling = HANDLING.find(([value]) => value === answers.handling)?.[1] ?? '';
  const parts = [`${goods}, ${size.toLowerCase()}`];
  if (answers.quantity.trim()) parts.push(`about ${answers.quantity.trim()} of them`);
  if (answers.weightValue.trim()) parts.push(`around ${answers.weightValue.trim()} kg in total`);
  if ([answers.length, answers.width, answers.height].every((value) => Number(value) > 0)) {
    parts.push(`each about ${answers.length.trim()} by ${answers.width.trim()} by ${answers.height.trim()} ${answers.dimensionUnit}`);
  }
  if (answers.handling === 'other' && answers.handlingNote.trim()) parts.push(`needs ${answers.handlingNote.trim()}`);
  else if (answers.handling !== 'not_sure' && answers.handling !== 'normal') parts.push(handling.toLowerCase());
  if (answers.shapeNote.trim()) parts.push(answers.shapeNote.trim());
  if (written) parts.push(written);
  return `${parts.join('. ')}.`;
}

// The server's handling enum has no "other" member, so that answer is sent as
// "not_sure" and the customer's own words travel in the notes the desk reads. Inventing
// an enum value the API would reject, or dropping what they typed, are both worse.
export function composeNotes(answers: Answers) {
  const parts = [
    answers.handling === 'other' && answers.handlingNote.trim() ? `Special care needed: ${answers.handlingNote.trim()}` : '',
    answers.shapeNote.trim() ? `Shape and packing: ${answers.shapeNote.trim()}` : '',
    answers.when === 'later' ? 'Cargo will be ready later than a month from now.' : '',
    answers.notes.trim(),
  ].filter(Boolean);
  return parts.join(' · ');
}

export function toShipmentInput(answers: Answers): ExporterShipmentInput {
  const measured = [answers.length, answers.width, answers.height].every((value) => Number(value) > 0);
  return {
    mode: answers.mode,
    cargoType: answers.cargoType,
    goodsDescription: describeGoods(answers),
    packageType: PACKAGE_BY_SIZE[answers.size],
    quantity: answers.quantity,
    handling: answers.handling === 'other' ? 'not_sure' : answers.handling,
    weightKnown: Number(answers.weightValue) > 0,
    weightValue: answers.weightValue,
    weightUnit: 'kg',
    dimensionsKnown: measured,
    length: answers.length,
    width: answers.width,
    height: answers.height,
    dimensionUnit: answers.dimensionUnit,
    seaContainer: 'not_sure',
    readiness: answers.when === 'flexible' || answers.when === 'later' ? 'flexible' : 'date',
    date: readinessDate(answers.when, answers.date),
    notes: composeNotes(answers),
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function FirstTimeExporterForm() {
  const [answers, setAnswers] = useState<Answers>(blankAnswers);
  const [step, setStep] = useState(0);
  const [cities, setCities] = useState<{ origins: string[]; destinations: string[] }>({ origins: [], destinations: [] });
  const [submitting, setSubmitting] = useState(false);
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [reference, setReference] = useState<string | null>(null);
  const intent = useRef({ fingerprint: '', key: '' });
  const heading = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    void api<RoutePlan>('/api/lanes/plan?origin=Mumbai&destination=Dubai')
      .then((plan) => setCities(plan.cities))
      .catch(() => undefined);
  }, []);

  const [lane, setLane] = useState<ItineraryLeg | null>(null);
  useEffect(() => {
    if (answers.origin.trim().length < 2 || answers.destination.trim().length < 2) { setLane(null); return; }
    const timer = setTimeout(() => {
      void api<RoutePlan>(`/api/lanes/plan?origin=${encodeURIComponent(answers.origin.trim())}&destination=${encodeURIComponent(answers.destination.trim())}`)
        .then((plan) => {
          const options = plan.direct.length > 0 ? plan.direct : (plan.connecting[0]?.legs ?? []);
          setLane(options.find((leg) => leg.mode === answers.mode) ?? options[0] ?? null);
        })
        .catch(() => setLane(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [answers.destination, answers.mode, answers.origin]);

  const set = <K extends keyof Answers>(key: K, value: Answers[K]) => {
    setAnswers((current) => ({ ...current, [key]: value }));
    setError(null);
    setFieldErrors({});
  };

  const steps = useMemo(() => [
    {
      id: 'origin',
      question: 'Where is your shipment starting?',
      hint: 'The city it will be collected from.',
      ready: answers.origin.trim().length >= 2,
      body: <label className={styles.bigField}>
        <span className={styles.srOnly}>Origin city</span>
        <input autoFocus list="exporter-origins" value={answers.origin} onChange={(event) => set('origin', event.target.value)} placeholder="Jaipur" autoComplete="address-level2" />
      </label>,
    },
    {
      id: 'destination',
      question: 'Where does it need to go?',
      hint: 'A city or port is enough.',
      ready: answers.destination.trim().length >= 2,
      body: <>
        <label className={styles.bigField}>
          <span className={styles.srOnly}>Destination city</span>
          <input autoFocus list="exporter-destinations" value={answers.destination} onChange={(event) => set('destination', event.target.value)} placeholder="Dubai" autoComplete="address-level2" />
        </label>
        <RouteConditionNotice origin={answers.origin} destination={answers.destination} mode={answers.mode}
          onChooseOrigin={(city) => set('origin', city)} onChooseDestination={(city) => set('destination', city)} />
      </>,
    },
    {
      id: 'mode',
      question: 'How would you like it sent?',
      hint: 'Not sure? Pick the first one and Navair advises you.',
      ready: true,
      body: <div className={styles.choices}>
        {MODES.map(([value, label, note]) => <button type="button" key={value}
          className={answers.mode === value ? `${styles.choice} ${styles.choiceActive}` : styles.choice}
          aria-pressed={answers.mode === value}
          onClick={() => { set('mode', value); advance(); }}>
          <strong>{label}</strong><small>{note}</small>
        </button>)}
      </div>,
    },
    {
      id: 'goods',
      question: 'What are you sending?',
      hint: 'Pick the closest match.',
      ready: answers.cargoType !== 'other' || answers.goodsDescription.trim().length >= 3,
      body: <>
        <div className={`${styles.choices} ${styles.choicesTight}`}>
          {GOODS.map(([value, label]) => <button type="button" key={value}
            className={answers.cargoType === value ? `${styles.chip} ${styles.chipActive}` : styles.chip}
            aria-pressed={answers.cargoType === value}
            onClick={() => { set('cargoType', value); if (value !== 'other') advance(); }}>{label}</button>)}
        </div>
        {answers.cargoType === 'other' && <label className={styles.reveal}>
          Tell Navair what it is, in your own words
          <input autoFocus value={answers.goodsDescription} onChange={(event) => set('goodsDescription', event.target.value)}
            placeholder="Handmade brass lamps, boxed in pairs" />
        </label>}
      </>,
    },
    {
      id: 'size',
      question: 'Roughly how big is it?',
      hint: 'An estimate is fine. Nobody expects exact numbers yet.',
      ready: true,
      body: <>
        <div className={styles.choices}>
          {SIZES.map(([value, label, note]) => <button type="button" key={value}
            className={answers.size === value ? `${styles.choice} ${styles.choiceActive}` : styles.choice}
            aria-pressed={answers.size === value}
            onClick={() => set('size', value)}>
            <strong>{label}</strong><small>{note}</small>
          </button>)}
        </div>
        <div className={styles.inlineFields}>
          <label>How many {answers.size === 'container' ? 'containers' : answers.size === 'pallets' ? 'pallets' : 'boxes or units'}?
            <input inputMode="numeric" value={answers.quantity} onChange={(event) => set('quantity', event.target.value)} placeholder="Skip if unsure" />
          </label>
          <label>Total weight in kg
            <input inputMode="decimal" value={answers.weightValue} onChange={(event) => set('weightValue', event.target.value)} placeholder="Skip if unsure" />
          </label>
        </div>
        <details className={styles.optional}>
          <summary>I know the exact size <small>optional</small></summary>
          <p className={styles.optionalHint}>Measure one box, pallet or crate — not the whole load. Leave it blank if you are guessing.</p>
          <div className={styles.dimensionRow}>
            <label>Length<input inputMode="decimal" value={answers.length} onChange={(event) => set('length', event.target.value)} placeholder="L" /></label>
            <label>Width<input inputMode="decimal" value={answers.width} onChange={(event) => set('width', event.target.value)} placeholder="W" /></label>
            <label>Height<input inputMode="decimal" value={answers.height} onChange={(event) => set('height', event.target.value)} placeholder="H" /></label>
            <label>Measured in
              <select value={answers.dimensionUnit} onChange={(event) => set('dimensionUnit', event.target.value as 'cm' | 'in')}>
                <option value="cm">centimetres</option>
                <option value="in">inches</option>
              </select>
            </label>
          </div>
          <label className={styles.reveal}>Anything about the shape or packing?
            <input value={answers.shapeNote} onChange={(event) => set('shapeNote', event.target.value)}
              placeholder="Long steel tubes, crated in threes" />
          </label>
        </details>
      </>,
    },
    {
      id: 'handling',
      question: 'Does it need special care?',
      hint: 'This decides which carriers can take it. "I am not sure" is a fine answer.',
      ready: answers.handling !== 'other' || answers.handlingNote.trim().length >= 3,
      body: <>
        <div className={`${styles.choices} ${styles.choicesTight}`}>
          {HANDLING.map(([value, label]) => <button type="button" key={value}
            className={answers.handling === value ? `${styles.chip} ${styles.chipActive}` : styles.chip}
            aria-pressed={answers.handling === value}
            onClick={() => { set('handling', value); if (value !== 'other') advance(); }}>{label}</button>)}
        </div>
        {answers.handling === 'other' && <label className={styles.reveal}>
          What kind of care does it need?
          <input autoFocus value={answers.handlingNote} onChange={(event) => set('handlingNote', event.target.value)}
            placeholder="Fragile glass, must stay upright" />
        </label>}
      </>,
    },
    {
      id: 'when',
      question: 'When will it be ready?',
      hint: 'Navair uses this to check space and prices for that week.',
      ready: answers.when !== 'date' || Boolean(answers.date),
      body: <>
        <div className={`${styles.choices} ${styles.choicesTight}`}>
          {WHENS.map(([value, label]) => <button type="button" key={value}
            className={answers.when === value ? `${styles.chip} ${styles.chipActive}` : styles.chip}
            aria-pressed={answers.when === value}
            onClick={() => { set('when', value); if (value !== 'date') advance(); }}>{label}</button>)}
        </div>
        {answers.when === 'date' && <label className={styles.bigField}>
          <span className={styles.srOnly}>Ready date</span>
          <input type="date" value={answers.date} onChange={(event) => set('date', event.target.value)} />
        </label>}
      </>,
    },
    {
      id: 'timeline',
      question: 'Here is how your shipment would run',
      hint: lane ? 'Built from this route\'s own recent history. Nothing is booked yet.' : 'Navair will confirm the schedule for this route by hand.',
      ready: true,
      body: lane
        ? <PlannedTimeline
            lane={{ mode: lane.mode, transitDays: lane.transitDays, crossBorder: lane.crossBorder }}
            readyDate={readinessDate(answers.when, answers.date) || null}
            title={`${lane.origin} → ${lane.destination} by ${lane.mode}`} />
        : <p className="lane-chart-empty">Navair has no recorded timing for this route yet, so the desk will confirm the schedule with you directly. Your enquiry is still the right next step.</p>,
    },
    {
      id: 'contact',
      question: 'Where should Navair reply?',
      hint: 'You will get a confirmation email straight away.',
      ready: answers.name.trim().length >= 2 && EMAIL.test(answers.email.trim()),
      body: <div className={styles.contactFields}>
        <label>Your name
          <input autoFocus value={answers.name} onChange={(event) => set('name', event.target.value)} autoComplete="name" placeholder="Shaurya Punj" />
          {fieldErrors.name?.[0] && <span className={styles.fieldError}>{fieldErrors.name[0]}</span>}
        </label>
        <label>Email
          <input type="email" value={answers.email} onChange={(event) => set('email', event.target.value)} autoComplete="email" placeholder="you@company.com" />
          {fieldErrors.email?.[0] && <span className={styles.fieldError}>{fieldErrors.email[0]}</span>}
        </label>
        <label>Phone <small>optional</small>
          <input type="tel" value={answers.phone} onChange={(event) => set('phone', event.target.value)} autoComplete="tel" placeholder="+91" />
        </label>
        <label>Anything else Navair should know? <small>optional</small>
          <textarea rows={3} value={answers.notes} onChange={(event) => set('notes', event.target.value)} placeholder="A collection address, mixed box sizes, a question…" />
        </label>
      </div>,
    },
  ], [answers, fieldErrors]);

  const current = steps[Math.min(step, steps.length - 1)];
  const last = step === steps.length - 1;

  function advance() {
    setStep((value) => Math.min(steps.length - 1, value + 1));
  }

  useEffect(() => { heading.current?.focus(); }, [step]);

  async function submit() {
    setError(null);
    setFieldErrors({});
    const shipment = createExporterShipment(toShipmentInput(answers));
    const enquiry = {
      name: answers.name.trim(),
      email: answers.email.trim(),
      ...(answers.phone.trim() ? { phone: answers.phone.trim() } : {}),
      origin: answers.origin.trim(),
      destination: answers.destination.trim(),
      mode: answers.mode,
      description: describeGoods(answers),
      shipment,
    };
    const fingerprint = JSON.stringify(enquiry);
    if (intent.current.fingerprint !== fingerprint) intent.current = { fingerprint, key: crypto.randomUUID() };
    setSubmitting(true);
    try {
      const result = await api<{ reference: string }>('/api/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': intent.current.key },
        body: JSON.stringify({ enquiry, website }),
      });
      setReference(result.reference);
      setAnswers(blankAnswers);
      setStep(0);
      intent.current = { fingerprint: '', key: '' };
    } catch (reason) {
      if (reason instanceof RequestError && reason.fields) setFieldErrors(reason.fields);
      setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  if (reference) {
    return <section className={styles.success} aria-labelledby="exporter-confirmation">
      <p className="eyebrow">Sent</p>
      <h2 id="exporter-confirmation">Navair has your enquiry.</h2>
      <p>Your reference is <strong>{reference}</strong>. A confirmation is on its way to your email, and the team replies from there.</p>
      <button type="button" onClick={() => setReference(null)}>Send another enquiry</button>
    </section>;
  }

  return <section className={styles.wizard} aria-live="polite">
    <div className={styles.progress}>
      <div className={styles.progressTrack}><div className={styles.progressFill} style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
      <p className={styles.progressLabel}>Question {step + 1} of {steps.length} · about {Math.max(1, steps.length - step) * 10} seconds left</p>
    </div>

    {error && <Notice>{error}</Notice>}

    <div className={styles.stepBody} key={current.id}>
      <h2 tabIndex={-1} ref={heading} className={styles.question}>{current.question}</h2>
      <p className={styles.hint}>{current.hint}</p>
      <form onSubmit={(event) => { event.preventDefault(); if (last) void submit(); else if (current.ready) advance(); }}>
        {current.body}
        <input className="honeypot" aria-hidden="true" tabIndex={-1} name="website" value={website} onChange={(event) => setWebsite(event.target.value)} autoComplete="off" />
        <div className={styles.actions}>
          {step > 0 && <button type="button" className={styles.back} onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</button>}
          {last
            ? <button type="submit" disabled={!current.ready || submitting}>{submitting ? 'Sending…' : 'Send my enquiry'}</button>
            : <button type="submit" disabled={!current.ready}>Continue</button>}
        </div>
      </form>
    </div>

    <datalist id="exporter-origins">{cities.origins.map((city) => <option key={city} value={city} />)}</datalist>
    <datalist id="exporter-destinations">{cities.destinations.map((city) => <option key={city} value={city} />)}</datalist>

    <details className={styles.review}>
      <summary>See what you have answered so far</summary>
      <dl>
        <div><dt>Route</dt><dd>{answers.origin || 'not set'} → {answers.destination || 'not set'}</dd></div>
        <div><dt>Sent by</dt><dd>{MODES.find(([value]) => value === answers.mode)?.[1]}</dd></div>
        <div><dt>Goods</dt><dd>{answers.cargoType === 'other' && answers.goodsDescription.trim() ? answers.goodsDescription.trim() : GOODS.find(([value]) => value === answers.cargoType)?.[1]}, {SIZES.find(([value]) => value === answers.size)?.[1]?.toLowerCase()}</dd></div>
        <div><dt>Special care</dt><dd>{answers.handling === 'other' && answers.handlingNote.trim() ? answers.handlingNote.trim() : HANDLING.find(([value]) => value === answers.handling)?.[1]}</dd></div>
        <div><dt>Ready</dt><dd>{WHENS.find(([value]) => value === answers.when)?.[1]}{answers.when === 'date' && answers.date ? ` · ${answers.date}` : ''}</dd></div>
      </dl>
    </details>
  </section>;
}
