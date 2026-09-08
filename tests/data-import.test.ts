import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { importData } from '../src/lib/data-import';
import { pool, withActor } from '../src/lib/db';

config({ path: '.env.local', quiet: true });

const admin = new Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const owner = randomUUID();
const customer = randomUUID();
const tag = randomUUID().slice(0, 8);
const route = randomUUID();
const otherRoute = randomUUID();
const past = new Date(Date.now() - 86_400_000).toISOString();

const input = (sourceId = `import:${tag}:price`, routeId = route): unknown => ({
  routeId,
  prices: [{ sourceId, observedAt: past, sellingPrice: 150, buyingCost: 100, currency: 'INR', unit: 'kg' }],
  deliveries: [{ sourceId: `import:${tag}:delivery:${sourceId}`, promisedAt: past, actualAt: past, observedAt: past, issue: 'capacity' }],
});

beforeAll(async () => {
  await admin.query('INSERT INTO app_users(id,name,role,email,is_demo) VALUES($1,$2,$3,$4,true),($5,$6,$7,$8,true)', [
    owner, 'Import owner', 'owner', `owner-${tag}@example.test`,
    customer, 'Import customer', 'customer', `customer-${tag}@example.test`,
  ]);
  await admin.query('INSERT INTO routes(id,origin,destination,mode,unit) VALUES($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)', [
    route, `Import origin ${tag}`, `Import destination ${tag}`, 'air', 'kg', otherRoute, `Foreign origin ${tag}`, `Foreign destination ${tag}`, 'air', 'kg',
  ]);
});

afterAll(async () => { await admin.end(); await pool.end(); });

describe('operational data import', () => {
  it('imports owner data once and replays it without duplicate rows', async () => {
    expect(await importData(owner, input())).toEqual({ pricesImported: 1, deliveriesImported: 1, isDemo: true });
    expect(await importData(owner, input())).toEqual({ pricesImported: 1, deliveriesImported: 1, isDemo: true });
    expect((await admin.query('SELECT * FROM price_observations WHERE route_id=$1', [route])).rowCount).toBe(1);
    expect((await admin.query('SELECT * FROM delivery_evidence WHERE route_id=$1', [route])).rowCount).toBe(1);
    expect((await admin.query('SELECT * FROM price_costs')).rowCount).toBe(1);
  });

  it('rejects a source id already assigned to another route', async () => {
    const sourceId = `import:${tag}:foreign`;
    await admin.query('INSERT INTO price_observations(source_id,route_id,observed_at,selling_price,currency,unit,is_demo) VALUES($1,$2,$3,$4,$5,$6,true)', [sourceId, otherRoute, past, 90, 'INR', 'kg']);
    await expect(importData(owner, input(sourceId))).rejects.toMatchObject({ status: 409, code: 'SOURCE_CONFLICT' });
  });

  it('allows only one concurrent route to claim a new source id', async () => {
    const sourceId = `import:${tag}:race`;
    const results = await Promise.allSettled([
      importData(owner, input(sourceId, route)),
      importData(owner, input(sourceId, otherRoute)),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await admin.query('SELECT count(*)::int AS count FROM price_observations WHERE source_id=$1', [sourceId])).rows[0].count).toBe(1);
  });

  it('rejects an invalid batch without writing any rows', async () => {
    const before = await admin.query('SELECT count(*)::int AS count FROM price_observations');
    await expect(importData(owner, {
      routeId: route,
      prices: [{ sourceId: `import:${tag}:invalid`, observedAt: past, sellingPrice: 0, currency: 'INR', unit: 'kg' }],
      deliveries: [],
    })).rejects.toBeTruthy();
    const after = await admin.query('SELECT count(*)::int AS count FROM price_observations');
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it('rejects delivery evidence whose actual arrival was not yet observable', async () => {
    await expect(importData(owner, {
      routeId: route,
      prices: [],
      deliveries: [{ sourceId: `import:${tag}:future-knowledge`, promisedAt: past, actualAt: new Date(Date.now() - 1_000).toISOString(), observedAt: new Date(Date.now() - 2_000).toISOString(), issue: null }],
    })).rejects.toBeTruthy();
  });

  it('does not relabel an imported source when deployment mode changes', async () => {
    const sourceId = `import:${tag}:mode`;
    await importData(owner, input(sourceId));
    const original = process.env.LOCAL_DEMO_MODE;
    process.env.LOCAL_DEMO_MODE = 'false';
    try {
      await expect(importData(owner, input(sourceId))).rejects.toMatchObject({ status: 409 });
    } finally {
      process.env.LOCAL_DEMO_MODE = original;
    }
  });

  it('denies a customer and never reveals private buying costs through RLS', async () => {
    await expect(importData(customer, input(`import:${tag}:customer`))).rejects.toMatchObject({ status: 403 });
    expect((await withActor(customer, db => db.query('SELECT * FROM price_costs'))).rowCount).toBe(0);
  });
});
