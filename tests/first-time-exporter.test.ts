import { describe, expect, it } from 'vitest';
import { createExporterShipment } from '../src/components/first-time-exporter-data';
import {blankAnswers,composeNotes,describeGoods,readinessDate,toShipmentInput,type Answers} from '../src/components/first-time-exporter-form';
import {enquirySchema} from '../src/lib/operations';

describe('createExporterShipment', () => {
  it('keeps an unknown measurement usable and excludes a sea container for a non-sea shipment', () => {
    expect(createExporterShipment({
      mode: 'air', cargoType: 'samples', goodsDescription: 'Product samples for a buyer review', packageType: 'boxes', quantity: '', handling: 'normal',
      weightKnown: false, weightValue: '', weightUnit: 'kg', dimensionsKnown: false, length: '', width: '', height: '', dimensionUnit: 'cm',
      seaContainer: '40ft', readiness: 'flexible', date: '', notes: '',
    })).toEqual({
      cargoType: 'samples', goodsDescription: 'Product samples for a buyer review', packageType: 'boxes', handling: 'normal',
      weight: { unknown: true }, dimensions: { unknown: true }, readiness: { flexible: true },
    });
  });
});

describe('guided exporter wizard', () => {
  const answers = (overrides: Partial<Answers> = {}): Answers => ({ ...blankAnswers, origin: 'Jaipur', destination: 'Dubai', name: 'Shaurya Punj', email: 'shaurya@example.test', ...overrides });

  it('builds a usable description when the customer only taps and never types', () => {
    const description = describeGoods(answers({ cargoType: 'textiles', size: 'few_boxes' }));
    expect(description).toBe('Clothes or fabric, a few boxes.');
    expect(description.length).toBeGreaterThanOrEqual(10);
  });

  it('never falls under the ten characters the server demands, even on every "not sure"', () => {
    expect(describeGoods(answers()).length).toBeGreaterThanOrEqual(10);
  });

  it('keeps the customer\'s own words when they wrote enough', () => {
    const written = 'Twelve cartons of cotton shirts packed for retail';
    expect(describeGoods(answers({ goodsDescription: written, cargoType: 'textiles' }))).toBe(written);
  });

  it('folds taps and a short note together instead of discarding either', () => {
    const description = describeGoods(answers({ cargoType: 'machinery', size: 'pallets', quantity: '4', weightValue: '900', handling: 'dangerous', goodsDescription: 'urgent' }));
    expect(description).toContain('Machinery or parts, pallets');
    expect(description).toContain('about 4 of them');
    expect(description).toContain('around 900 kg in total');
    expect(description).toContain('dangerous goods');
    expect(description).toContain('urgent');
  });

  it('turns a plain-language readiness answer into a real date', () => {
    expect(readinessDate('flexible', '')).toBe('');
    expect(readinessDate('date', '2026-11-02')).toBe('2026-11-02');
    const soon = readinessDate('two_weeks', '');
    expect(new Date(soon).getTime() - Date.now()).toBeGreaterThan(12 * 86400000);
  });

  it('produces a payload the server schema accepts from taps alone', () => {
    const tapped = answers({ cargoType: 'electronics', size: 'container', when: 'month', mode: 'sea' });
    const shipment = createExporterShipment(toShipmentInput(tapped));
    const parsed = enquirySchema.parse({
      name: tapped.name, email: tapped.email, origin: tapped.origin, destination: tapped.destination,
      mode: tapped.mode, description: describeGoods(tapped), shipment,
    });
    expect(parsed.description.length).toBeGreaterThanOrEqual(10);
    expect(parsed.shipment).toMatchObject({ cargoType: 'electronics', packageType: 'container' });
    expect(parsed.shipment?.weight).toEqual({ unknown: true });
    expect(parsed.shipment?.readiness).toHaveProperty('date');
  });

  it('omits the sea container question from a non-sea shipment, as the schema requires', () => {
    const road = answers({ mode: 'road', size: 'container' });
    const shipment = createExporterShipment(toShipmentInput(road));
    expect(shipment).not.toHaveProperty('seaContainer');
    expect(() => enquirySchema.parse({
      name: road.name, email: road.email, origin: road.origin, destination: road.destination,
      mode: road.mode, description: describeGoods(road), shipment,
    })).not.toThrow();
  });
});

describe('wizard "something else" answers', () => {
  const answers = (overrides: Partial<Answers> = {}): Answers => ({ ...blankAnswers, origin: 'Jaipur', destination: 'Dubai', name: 'Shaurya Punj', email: 'shaurya@example.test', ...overrides });
  const parse = (input: Answers) => enquirySchema.parse({
    name: input.name, email: input.email, origin: input.origin, destination: input.destination,
    mode: input.mode, description: describeGoods(input), shipment: createExporterShipment(toShipmentInput(input)),
  });

  it('sends a typed-in cargo description under the schema\'s "other" cargo type', () => {
    const custom = answers({ cargoType: 'other', goodsDescription: 'Handmade brass lamps, boxed in pairs' });
    const parsed = parse(custom);
    expect(parsed.shipment?.cargoType).toBe('other');
    expect(parsed.description).toBe('Handmade brass lamps, boxed in pairs');
  });

  it('downgrades an "other" care answer to a value the enum accepts and keeps the words in the notes', () => {
    const fragile = answers({ handling: 'other', handlingNote: 'Fragile glass, must stay upright' });
    const parsed = parse(fragile);
    expect(parsed.shipment?.handling).toBe('not_sure');
    expect(parsed.shipment?.notes).toContain('Fragile glass, must stay upright');
    expect(parsed.description).toContain('needs Fragile glass, must stay upright');
  });

  it('accepts exact dimensions when all three are given and ignores a half-filled set', () => {
    const measured = parse(answers({ length: '120', width: '80', height: '95', dimensionUnit: 'cm' }));
    expect(measured.shipment?.dimensions).toEqual({ length: 120, width: 80, height: 95, unit: 'cm' });
    expect(measured.description).toContain('each about 120 by 80 by 95 cm');

    const partial = parse(answers({ length: '120', width: '', height: '95' }));
    expect(partial.shipment?.dimensions).toEqual({ unknown: true });
  });

  it('treats "later than a month" as no fixed date and says so in the notes', () => {
    const later = answers({ when: 'later' });
    expect(readinessDate('later', '')).toBe('');
    const parsed = parse(later);
    expect(parsed.shipment?.readiness).toEqual({ flexible: true });
    expect(parsed.shipment?.notes).toContain('ready later than a month');
  });

  it('keeps every optional note the customer wrote, in one field', () => {
    const notes = composeNotes(answers({ handling: 'other', handlingNote: 'keep upright', shapeNote: 'long tubes', when: 'later', notes: 'call before pickup' }));
    expect(notes).toContain('keep upright');
    expect(notes).toContain('long tubes');
    expect(notes).toContain('later than a month');
    expect(notes).toContain('call before pickup');
  });

  it('leaves the notes field off entirely when the customer added nothing', () => {
    expect(composeNotes(answers())).toBe('');
    expect(parse(answers()).shipment).not.toHaveProperty('notes');
  });
});
