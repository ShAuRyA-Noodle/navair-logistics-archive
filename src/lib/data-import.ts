import { z } from 'zod';
import { withActor } from './db';
import { AppError } from './errors';
import { requirePermission, getJourney } from './operations';
import { forecastPrices, type PriceObservation } from './analytics';

const sourceId = z.string().trim().min(8).max(200).regex(/^import:/, 'Imported records must use an import: source id.');
const dateTime = z.iso.datetime({ offset: true });
const text = z.string().trim().min(1).max(80);
const positiveMoney = z.number().finite().positive().max(1e10);
const issue = z.enum(['capacity', 'customs', 'weather', 'handling', 'damage', 'early_arrival']);

const importSchema = z.object({
  routeId: z.uuid(),
  prices: z.array(z.object({
    sourceId,
    observedAt: dateTime,
    sellingPrice: positiveMoney,
    buyingCost: positiveMoney.optional(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    unit: text,
  }).strict()),
  deliveries: z.array(z.object({
    sourceId,
    promisedAt: dateTime,
    actualAt: dateTime.nullable(),
    observedAt: dateTime,
    issue: issue.nullable(),
  }).strict()),
}).strict().superRefine((data, ctx) => {
  if (data.prices.length + data.deliveries.length > 1000) {
    ctx.addIssue({ code: 'custom', message: 'A batch may contain at most 1000 records.' });
  }
  const allSources = [...data.prices, ...data.deliveries].map(record => record.sourceId);
  if (new Set(allSources).size !== allSources.length) {
    ctx.addIssue({ code: 'custom', message: 'Each source id may appear only once per batch.' });
  }
  const now = Date.now();
  for (const record of data.prices) {
    if (new Date(record.observedAt).getTime() > now) ctx.addIssue({ code: 'custom', path: ['prices'], message: 'Observed dates cannot be in the future.' });
  }
  for (const record of data.deliveries) {
    if (new Date(record.observedAt).getTime() > now || (record.actualAt && (new Date(record.actualAt).getTime() > now || new Date(record.actualAt).getTime() > new Date(record.observedAt).getTime()))) {
      ctx.addIssue({ code: 'custom', path: ['deliveries'], message: 'Observed and actual dates cannot be in the future.' });
    }
  }
});

export type DataImportResult = { pricesImported: number; deliveriesImported: number; isDemo: boolean };

export async function importData(actorId: string, input: unknown): Promise<DataImportResult> {
  const data = importSchema.parse(input);
  const isDemo = process.env.LOCAL_DEMO_MODE === 'true';
  return withActor(actorId, async db => {
    await requirePermission(db, 'team.manage');
    if (!(await db.query('SELECT 1 FROM routes WHERE id=$1', [data.routeId])).rowCount) {
      throw new AppError(404, 'NOT_FOUND', 'Route not found.');
    }
    const priceSources = data.prices.map(record => record.sourceId);
    const deliverySources = data.deliveries.map(record => record.sourceId);
    const [existingPrices, existingDeliveries] = await Promise.all([
      priceSources.length ? db.query('SELECT source_id,route_id,is_demo FROM price_observations WHERE source_id=ANY($1::text[])', [priceSources]) : { rows: [] },
      deliverySources.length ? db.query('SELECT source_id,route_id,is_demo FROM delivery_evidence WHERE source_id=ANY($1::text[])', [deliverySources]) : { rows: [] },
    ]);
    if ([...existingPrices.rows, ...existingDeliveries.rows].some(record => record.route_id !== data.routeId || record.is_demo !== isDemo)) {
      throw new AppError(409, 'SOURCE_CONFLICT', 'An imported source id already belongs to a different route or deployment mode.');
    }
    for (const record of data.prices) {
      const observation = (await db.query(`INSERT INTO price_observations(source_id,route_id,observed_at,selling_price,currency,unit,is_demo)
        VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(source_id) DO UPDATE SET observed_at=EXCLUDED.observed_at,selling_price=EXCLUDED.selling_price,currency=EXCLUDED.currency,unit=EXCLUDED.unit
        WHERE price_observations.route_id=EXCLUDED.route_id AND price_observations.is_demo=EXCLUDED.is_demo
        RETURNING id`, [record.sourceId, data.routeId, record.observedAt, record.sellingPrice, record.currency, record.unit, isDemo])).rows[0];
      if (!observation) throw new AppError(409, 'SOURCE_CONFLICT', 'An imported source id was claimed by another route or deployment mode.');
      if (record.buyingCost !== undefined) {
        await db.query('INSERT INTO price_costs(observation_id,buying_cost) VALUES($1,$2) ON CONFLICT(observation_id) DO UPDATE SET buying_cost=EXCLUDED.buying_cost', [observation.id, record.buyingCost]);
      }
    }
    for (const record of data.deliveries) {
      const result = await db.query(`INSERT INTO delivery_evidence(source_id,route_id,promised_at,actual_at,observed_at,issue,is_demo)
        VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(source_id) DO UPDATE SET promised_at=EXCLUDED.promised_at,actual_at=EXCLUDED.actual_at,observed_at=EXCLUDED.observed_at,issue=EXCLUDED.issue
        WHERE delivery_evidence.route_id=EXCLUDED.route_id AND delivery_evidence.is_demo=EXCLUDED.is_demo
        RETURNING id`, [record.sourceId, data.routeId, record.promisedAt, record.actualAt, record.observedAt, record.issue, isDemo]);
      if (!result.rowCount) throw new AppError(409, 'SOURCE_CONFLICT', 'An imported source id was claimed by another route or deployment mode.');
    }
    await db.query("INSERT INTO audit_log(actor_id,action,entity_id,details) VALUES(public.actor_id(),'data.imported',$1,$2)", [data.routeId, JSON.stringify({ prices: data.prices.length, deliveries: data.deliveries.length, isDemo })]);
    return { pricesImported: data.prices.length, deliveriesImported: data.deliveries.length, isDemo };
  });
}

export async function getInternalCostForecast(actorId: string, enquiryId: string, search: URLSearchParams) {
  const options = z.object({ weeks: z.coerce.number().int().min(1).max(8), confidence: z.coerce.number().refine(value => value === 80 || value === 95) })
    .parse({ weeks: search.get('weeks') ?? 8, confidence: search.get('confidence') ?? 80 });
  await withActor(actorId, db => requirePermission(db, 'finance.view'));
  const journey = await getJourney(actorId, enquiryId);
  return withActor(actorId, async db => {
    const result = await db.query(`SELECT p.id,p.route_id AS "routeId",r.mode,p.unit,p.currency,p.observed_at AS "observedAt",c.buying_cost AS "buyingCost",p.is_demo AS "isDemo"
      FROM price_costs c JOIN price_observations p ON p.id=c.observation_id JOIN routes r ON r.id=p.route_id
      WHERE p.route_id=$1 ORDER BY p.observed_at LIMIT 5000`, [journey.shipment.routeId]);
    const observations: PriceObservation[] = result.rows.map(row => ({ ...row, observedAt: row.observedAt.toISOString(), sellingPrice: Number(row.buyingCost) }));
    const forecast = forecastPrices(observations, {
      routeId: journey.shipment.routeId,
      mode: journey.enquiry.mode,
      unit: journey.shipment.unit,
      currency: journey.shipment.currency,
      weeks: options.weeks,
      confidence: options.confidence as 80 | 95,
    });
    return { ...forecast, label: `Internal buying cost — ${forecast.label.replaceAll('selling-price', 'buying-cost')}` };
  });
}
