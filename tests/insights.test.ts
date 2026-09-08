import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Pool } from 'pg';

import { pool } from '../src/lib/db';
import { getRadar } from '../src/lib/insights';

config({ path: '.env.local', quiet: true });

const admin = new Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const customerId = randomUUID();
const enquiryId = randomUUID();
const shipmentId = randomUUID();
const routeId = randomUUID();
const tag = randomUUID().slice(0, 8);
const now = Date.now();
const timestamp = (daysFromNow: number) => new Date(now + daysFromNow * 86_400_000).toISOString();

beforeAll(async () => {
  await admin.query('INSERT INTO app_users(id,name,role,email,is_demo) VALUES($1,$2,$3,$4,true)', [
    customerId, 'Radar customer', 'customer', `radar-${tag}@example.test`,
  ]);
  await admin.query('INSERT INTO routes(id,origin,destination,mode,unit) VALUES($1,$2,$3,$4,$5)', [
    routeId, `Radar origin ${tag}`, `Radar destination ${tag}`, 'air', 'kg',
  ]);
  await admin.query(`INSERT INTO enquiries(id,reference,customer_id,name,email,origin,destination,mode,description,status,is_demo)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'accepted',true)`, [
    enquiryId, `RADAR-${tag}`, customerId, 'Radar customer', `radar-${tag}@example.test`,
    `Radar origin ${tag}`, `Radar destination ${tag}`, 'air', 'Radar regression shipment',
  ]);
  await admin.query(`INSERT INTO shipments(id,enquiry_id,route_id,promised_at,selling_price,currency,unit,quantity)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [
    shipmentId, enquiryId, routeId, timestamp(2), 100, 'USD', 'kg', 1,
  ]);
  await admin.query(`INSERT INTO delivery_evidence(source_id,route_id,promised_at,actual_at,observed_at,issue,is_demo)
    VALUES($1,$2,$3,$4,$5,$6,true)`, [
    `import:${tag}:old-observation-recent-promise`, routeId, timestamp(-1), null, timestamp(-31), 'weather',
  ]);
  for (let index = 0; index < 4; index += 1) {
    await admin.query(`INSERT INTO delivery_evidence(source_id,route_id,promised_at,actual_at,observed_at,issue,is_demo)
      VALUES($1,$2,$3,$4,$5,$6,true)`, [
      `import:${tag}:recent-${index}`, routeId, timestamp(-2 - index), timestamp(-2 - index), timestamp(-1), null,
    ]);
  }
});

afterAll(async () => { await admin.end(); await pool.end(); });

describe('route radar retrieval', () => {
  it('keeps overdue evidence whose observation is old but whose promise is recent', async () => {
    const radar = await getRadar(customerId, enquiryId);

    expect(radar.sampleCount).toBe(6);
    expect(radar.unresolvedCount).toBe(1);
    expect(radar.status).toBe('elevated');
    expect(radar.issues).toContain('weather');
  });
});
