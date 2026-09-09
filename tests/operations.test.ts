import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { submitEnquiry, getJourney, acceptCase, updateShipment, updateMember, listCasePage, enquirySchema } from '../src/lib/operations';
import { withActor, pool } from '../src/lib/db';
config({ path: '.env.local', quiet: true });
const admin = new Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const owner = randomUUID(), alice = randomUUID(), bob = randomUUID(), staff = randomUUID();
const tag = randomUUID().slice(0,8);
const data = { name: 'Alice Test', email: `alice-${tag}@example.test`, origin: 'Delhi', destination: 'Dubai', mode: 'air', description: 'Five cartons of textiles', phone: '' };
let enquiryId: string;
beforeAll(async () => {
  for (const [id,name,role,email] of [[owner,'Owner','owner',`owner-${tag}@example.test`],[alice,'Alice','customer',data.email],[bob,'Bob','customer',`bob-${tag}@example.test`],[staff,'Staff','staff',`staff-${tag}@example.test`]]) {
    await admin.query('INSERT INTO app_users(id,name,role,email,is_demo,permissions) VALUES($1,$2,$3,$4,true,$5)',[id,name,role,email,role==='staff'?['cases.assigned','shipments.update']:[]]);
  }
});
afterAll(async () => { await admin.end(); await pool.end(); });
describe('saved enquiry to accepted customer journey', () => {
  it('persists structured first-time exporter details and includes them in both queued emails', async () => {
    const shipment = {
      cargoType: 'textiles', packageType: 'boxes', quantity: 5,
      handling: 'normal', weight: { value: 120, unit: 'kg' },
      dimensions: { length: 60, width: 40, height: 35, unit: 'cm' },
      readiness: { date: '2026-10-01' }, goodsDescription: 'Cotton shirts',
    };
    const enquiry = await submitEnquiry({ ...data, email: `structured-${tag}@example.test`, shipment }, randomUUID());
    const saved = await admin.query('SELECT shipment_details FROM enquiries WHERE id=$1', [enquiry.id]);
    expect(saved.rows[0].shipment_details).toEqual(shipment);
    const mail = await admin.query('SELECT body FROM email_outbox WHERE enquiry_id=$1 ORDER BY kind', [enquiry.id]);
    expect(mail.rows.map((row) => row.body).join('\n')).toContain('Cargo type: textiles');
    expect(mail.rows.map((row) => row.body).join('\n')).toContain('Total weight: 120 kg');
  });

  it('rejects an impossible shipment readiness date', async () => {
    const result = enquirySchema.safeParse({
      ...data, email: `invalid-date-${tag}@example.test`,
      shipment: { cargoType: 'textiles', packageType: 'boxes', readiness: { date: '2026-02-30' } },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['shipment', 'readiness', 'date'], message: 'Enter a valid calendar date.' }),
    ]));
  });

  it('accepts container selection only for sea freight', () => {
    const result = enquirySchema.safeParse({ ...data, shipment: { cargoType: 'textiles', packageType: 'container', seaContainer: '20ft' } });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['shipment', 'seaContainer'] }),
    ]));
  });

  it('persists one enquiry and two mail jobs across retries', async () => {
    const key=randomUUID();
    const first=await submitEnquiry(data,key); enquiryId=first.id;
    expect(await submitEnquiry(data,key)).toEqual(first);
    const jobs=await admin.query('SELECT * FROM email_outbox WHERE enquiry_id=$1',[enquiryId]);
    expect(jobs.rowCount).toBe(2);
  });
  it('accepts an unlisted route for availability review and flags both queued emails', async () => {
    const origin = `Unlisted origin ${tag}`;
    const destination = `Unlisted destination ${tag}`;
    const enquiry = await submitEnquiry({ ...data, email: `availability-${tag}@example.test`, origin, destination, mode: 'other' }, randomUUID());
    const saved = await admin.query('SELECT origin,destination,mode,route_availability_review FROM enquiries WHERE id=$1', [enquiry.id]);
    expect(saved.rows[0]).toMatchObject({ origin, destination, mode: 'other', route_availability_review: true });
    const jobs = await admin.query('SELECT kind,subject,body FROM email_outbox WHERE enquiry_id=$1 ORDER BY kind', [enquiry.id]);
    expect(jobs.rowCount).toBe(2);
    const staff = jobs.rows.find((job) => job.kind === 'staff');
    const acknowledgment = jobs.rows.find((job) => job.kind === 'acknowledgment');
    expect(staff).toMatchObject({ subject: expect.stringContaining('Route availability review required') });
    expect(staff.body).toContain('Route availability review required');
    expect(acknowledgment.body).toContain('review availability and possible alternatives');
    expect(acknowledgment.body).toContain('does not confirm a booking, quote, or availability');
  });
  it('keeps an explicitly supported route on the ordinary enquiry path', async () => {
    const origin = `Supported origin ${tag}`;
    const destination = `Supported destination ${tag}`;
    await admin.query("INSERT INTO routes(origin,destination,mode,unit,service_coverage) VALUES($1,$2,'road','shipment','supported')", [origin, destination]);
    const enquiry = await submitEnquiry({ ...data, email: `supported-${tag}@example.test`, origin, destination, mode: 'road' }, randomUUID());
    const saved = await admin.query('SELECT route_availability_review FROM enquiries WHERE id=$1', [enquiry.id]);
    expect(saved.rows[0].route_availability_review).toBe(false);
    const jobs = await admin.query('SELECT kind,subject,body FROM email_outbox WHERE enquiry_id=$1 ORDER BY kind', [enquiry.id]);
    const staff = jobs.rows.find((job) => job.kind === 'staff');
    const acknowledgment = jobs.rows.find((job) => job.kind === 'acknowledgment');
    expect(staff.subject).toContain('New export enquiry');
    expect(staff.subject).not.toContain('Route availability review required');
    expect(acknowledgment.body).toContain('review your requirements');
    expect(acknowledgment.body).toContain('does not confirm a booking or price');
  });
  it('rejects idempotency key reuse with changed data', async () => {
    const key=randomUUID(); await submitEnquiry(data,key);
    await expect(submitEnquiry({...data,description:'Changed shipment'},key)).rejects.toMatchObject({status:409});
  });
  it('provides stable separate pages without losing older enquiries',async()=>{
    const first=await listCasePage(alice,{page:1,pageSize:1});
    const second=await listCasePage(alice,{page:2,pageSize:1});
    expect(first.enquiries).toHaveLength(1);expect(second.enquiries).toHaveLength(1);
    expect(first.enquiries[0].id).not.toBe(second.enquiries[0].id);
    expect(first.pagination.hasMore).toBe(true);
  });
  it('withholds journey before administrator acceptance', async () => {
    await expect(getJourney(alice,enquiryId)).rejects.toMatchObject({status:403});
  });
  it('prevents a customer accepting their own enquiry',async()=> {
    await expect(acceptCase(alice,enquiryId,{sellingPrice:150,buyingCost:100,currency:'INR',unit:'shipment',quantity:1,promisedAt:new Date(Date.now()+86400000).toISOString(),version:1})).rejects.toMatchObject({status:403});
  });
  it('accepts once and returns only customer selling price',async()=> {
    await acceptCase(owner,enquiryId,{sellingPrice:150,buyingCost:100,currency:'INR',unit:'shipment',quantity:1,promisedAt:new Date(Date.now()+86400000).toISOString(),version:1});
    const journey=await getJourney(alice,enquiryId);
    expect(journey.shipment.sellingPrice).toBe(150);
    expect(JSON.stringify(journey)).not.toMatch(/buying|margin|profit/i);
    await expect(acceptCase(owner,enquiryId,{sellingPrice:150,buyingCost:100,currency:'INR',unit:'shipment',quantity:1,promisedAt:new Date(Date.now()+86400000).toISOString(),version:1})).rejects.toMatchObject({status:409});
  });
  it('denies other customers in service and database',async()=> {
    await expect(getJourney(bob,enquiryId)).rejects.toMatchObject({status:404});
    const result=await withActor(bob,db=>db.query('SELECT * FROM shipments WHERE enquiry_id=$1',[enquiryId]));
    expect(result.rowCount).toBe(0);
    expect((await withActor(alice,db=>db.query('SELECT * FROM shipment_finance'))).rowCount).toBe(0);
  });
  it('denies finance-enabled staff access to an unassigned case and its event records',async()=>{
    await admin.query("UPDATE app_users SET permissions=ARRAY['cases.assigned','finance.view'] WHERE id=$1",[staff]);
    const costs=await withActor(staff,db=>db.query('SELECT f.buying_cost FROM shipment_finance f JOIN shipments s ON s.id=f.shipment_id WHERE s.enquiry_id=$1',[enquiryId]));
    expect(costs.rowCount).toBe(0);
    const events=await withActor(staff,db=>db.query('SELECT * FROM shipment_events'));
    expect(events.rowCount).toBe(0);
    expect((await withActor(null,db=>db.query('SELECT * FROM shipment_events'))).rowCount).toBe(0);
    await admin.query("UPDATE app_users SET permissions=ARRAY['cases.assigned','shipments.update'] WHERE id=$1",[staff]);
  });
  it('does not expose a private route catalogue to guests',async()=>{
    const journey=await getJourney(alice,enquiryId);
    expect((await withActor(null,db=>db.query('SELECT id FROM routes WHERE id=$1',[journey.shipment.routeId]))).rowCount).toBe(0);
    expect((await withActor(alice,db=>db.query('SELECT id FROM routes WHERE id=$1',[journey.shipment.routeId]))).rowCount).toBe(1);
  });
  it('keeps original promised delivery when an estimate changes',async()=> {
    const before=await getJourney(alice,enquiryId);
    await updateShipment(owner,before.shipment.id,{status:'booked',estimatedAt:new Date(Date.now()+3*86400000).toISOString(),note:'Carrier booking recorded',version:before.shipment.version});
    const after=await getJourney(alice,enquiryId);
    expect(after.shipment.promisedAt).toEqual(before.shipment.promisedAt);
    expect(after.shipment.estimatedAt).not.toEqual(after.shipment.promisedAt);
  });
  it('prevents a customer from changing team access',async()=> {
    await expect(updateMember(alice,staff,{permissions:['finance.view'],active:true})).rejects.toMatchObject({status:403});
  });
  it('revokes staff permission in the next database transaction',async()=> {
    await admin.query('UPDATE enquiries SET assigned_to=$1 WHERE id=$2',[staff,enquiryId]);
    expect((await withActor(staff,db=>db.query('SELECT id FROM enquiries WHERE id=$1',[enquiryId]))).rowCount).toBe(1);
    await updateMember(owner,staff,{permissions:[],active:false});
    expect((await withActor(staff,db=>db.query('SELECT id FROM enquiries WHERE id=$1',[enquiryId]))).rowCount).toBe(0);
  });
});
