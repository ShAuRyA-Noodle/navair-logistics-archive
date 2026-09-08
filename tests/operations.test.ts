import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { submitEnquiry, getJourney, acceptCase, updateShipment, updateMember, listCasePage } from '../src/lib/operations';
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
  it('persists one enquiry and two mail jobs across retries', async () => {
    const key=randomUUID();
    const first=await submitEnquiry(data,key); enquiryId=first.id;
    expect(await submitEnquiry(data,key)).toEqual(first);
    const jobs=await admin.query('SELECT * FROM email_outbox WHERE enquiry_id=$1',[enquiryId]);
    expect(jobs.rowCount).toBe(2);
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
