import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { withActor } from './db';
import { AppError } from './errors';
import { PERMISSIONS } from './permissions';

const safeText = (min:number,max:number) => z.string().trim().min(min).max(max).refine(v=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v),'Unsupported control characters');
export const enquirySchema = z.object({ name:safeText(2,100), email:z.email().max(254).transform(v=>v.toLowerCase()), phone:z.string().trim().max(30).default(''), origin:safeText(2,120), destination:safeText(2,120), mode:z.enum(['air','sea','road','courier','other','unsure']), description:safeText(10,2000) }).strict();
const acceptSchema = z.object({sellingPrice:z.number().finite().min(0).max(1e10),buyingCost:z.number().finite().min(0).max(1e10),currency:z.string().regex(/^[A-Z]{3}$/),unit:safeText(1,40),quantity:z.number().finite().positive().max(1e7),promisedAt:z.iso.datetime({offset:true}),version:z.number().int().positive()}).strict();
const eventSchema = z.object({status:z.enum(['booked','collected','in_transit','customs','delivered','cancelled']),estimatedAt:z.iso.datetime({offset:true}).optional(),actualAt:z.iso.datetime({offset:true}).optional(),note:safeText(3,500),version:z.number().int().positive()}).strict();
export async function requirePermission(db:PoolClient, permission:string) {
  const result=await db.query('SELECT public.has_permission($1) AS allowed',[permission]);
  if(!result.rows[0].allowed) throw new AppError(403,'FORBIDDEN','You do not have access to this action.');
}
export async function submitEnquiry(input:unknown,key:string) {
  const data=enquirySchema.parse(input); z.uuid().parse(key);
  const hash=createHash('sha256').update(JSON.stringify(data)).digest('hex');
  try {
    return await withActor(null,async db=>{
      const result=await db.query('SELECT * FROM public.submit_enquiry($1,$2,$3,$4,$5)',[data,key,hash,process.env.LOCAL_DEMO_MODE==='true',process.env.BUSINESS_EMAIL ?? 'operations@navair.example']);
      return result.rows[0] as {id:string;reference:string};
    });
  } catch(error) {
    if(error instanceof Error && error.message==='IDEMPOTENCY_CONFLICT') throw new AppError(409,'CONFLICT','This submission key was already used for different details.');
    throw error;
  }
}
const caseSelection=`e.id,e.reference,e.name,e.origin,e.destination,e.mode,e.status,e.is_demo AS "isDemo",e.created_at AS "createdAt",e.accepted_at AS "acceptedAt",e.assigned_to AS "assignedTo",e.version`;
export async function listCases(actorId:string) {
  return (await listCasePage(actorId,{page:1,pageSize:100})).enquiries;
}
export async function listCasePage(actorId:string,input:unknown={}) {
  const {page,pageSize}=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(50)}).strict().parse(input);
  return withActor(actorId,async db=>{
    const rows=(await db.query(`SELECT ${caseSelection} FROM enquiries e ORDER BY e.created_at DESC,e.id DESC LIMIT $1 OFFSET $2`,[pageSize+1,(page-1)*pageSize])).rows;
    return {enquiries:rows.slice(0,pageSize),pagination:{page,pageSize,hasMore:rows.length>pageSize}};
  });
}
export async function caseDetail(actorId:string,id:string) {
  z.uuid().parse(id);
  return withActor(actorId,async db=>{
    const row=(await db.query(`SELECT ${caseSelection},e.email,e.phone,e.description FROM enquiries e WHERE e.id=$1`,[id])).rows[0];
    if(!row) throw new AppError(404,'NOT_FOUND','Enquiry not found.');
    return row;
  });
}
export async function getJourney(actorId:string,id:string) {
  z.uuid().parse(id);
  return withActor(actorId,async db=>{
    const enquiry=(await db.query(`SELECT ${caseSelection} FROM enquiries e WHERE e.id=$1`,[id])).rows[0];
    if(!enquiry) throw new AppError(404,'NOT_FOUND','Enquiry not found.');
    if(enquiry.status!=='accepted') throw new AppError(403,'AWAITING_ACCEPTANCE','Your journey becomes available when Navair accepts your enquiry.');
    const row=(await db.query(`SELECT id,route_id AS "routeId",status,promised_at AS "promisedAt",estimated_at AS "estimatedAt",actual_at AS "actualAt",selling_price AS "sellingPrice",currency,unit,quantity,version FROM shipments WHERE enquiry_id=$1`,[id])).rows[0];
    if(!row) throw new AppError(404,'NOT_FOUND','Shipment not found.');
    const events=(await db.query('SELECT id,status,description,occurred_at AS "occurredAt" FROM shipment_events WHERE shipment_id=$1 ORDER BY occurred_at,id',[row.id])).rows;
    return {enquiry,shipment:{...row,sellingPrice:Number(row.sellingPrice),quantity:Number(row.quantity)},events};
  });
}
export async function acceptCase(actorId:string,id:string,input:unknown) {
  z.uuid().parse(id); const data=acceptSchema.parse(input);
  return withActor(actorId,async db=>{
    await requirePermission(db,'cases.accept'); await requirePermission(db,'finance.view');
    const enquiry=(await db.query('SELECT * FROM enquiries WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!enquiry) throw new AppError(404,'NOT_FOUND','Enquiry not found.');
    if(enquiry.status!=='pending'||enquiry.version!==data.version) throw new AppError(409,'CONFLICT','This enquiry has changed. Refresh before accepting.');
    if(enquiry.mode==='unsure') throw new AppError(422,'MODE_REQUIRED','Confirm the transport mode before acceptance.');
    let route=(await db.query('SELECT id FROM routes WHERE origin=$1 AND destination=$2 AND mode=$3',[enquiry.origin,enquiry.destination,enquiry.mode])).rows[0];
    if(!route) route=(await db.query('INSERT INTO routes(origin,destination,mode,unit) VALUES($1,$2,$3,$4) RETURNING id',[enquiry.origin,enquiry.destination,enquiry.mode,data.unit])).rows[0];
    const shipment=(await db.query(`INSERT INTO shipments(enquiry_id,route_id,promised_at,selling_price,currency,unit,quantity) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[id,route.id,data.promisedAt,data.sellingPrice,data.currency,data.unit,data.quantity])).rows[0];
    await db.query('INSERT INTO shipment_finance(shipment_id,buying_cost) VALUES($1,$2)',[shipment.id,data.buyingCost]);
    await db.query("UPDATE enquiries SET status='accepted',accepted_at=now(),version=version+1 WHERE id=$1",[id]);
    await db.query("INSERT INTO shipment_events(shipment_id,status,description,occurred_at) VALUES($1,'accepted','Navair accepted your enquiry. Shipment preparation has started.',now())",[shipment.id]);
    await db.query("INSERT INTO audit_log(actor_id,action,entity_id) VALUES(public.actor_id(),'enquiry.accepted',$1)",[id]);
    return {id:shipment.id};
  });
}
const transitions:Record<string,string[]>={accepted:['booked','cancelled'],booked:['collected','cancelled'],collected:['in_transit','cancelled'],in_transit:['customs','delivered'],customs:['in_transit','delivered'],delivered:[],cancelled:[]};
export async function updateShipment(actorId:string,id:string,input:unknown) {
  z.uuid().parse(id);const data=eventSchema.parse(input);
  return withActor(actorId,async db=>{
    await requirePermission(db,'shipments.update');
    const shipment=(await db.query('SELECT * FROM shipments WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!shipment) throw new AppError(404,'NOT_FOUND','Shipment not found.');
    if(shipment.version!==data.version) throw new AppError(409,'CONFLICT','This shipment changed. Refresh before updating.');
    if(!transitions[shipment.status]?.includes(data.status)) throw new AppError(409,'INVALID_TRANSITION',`Cannot move from ${shipment.status} to ${data.status}.`);
    if(data.status==='delivered'&&!data.actualAt) throw new AppError(422,'ACTUAL_DATE_REQUIRED','Actual delivery date is required.');
    if(data.actualAt && new Date(data.actualAt)>new Date()) throw new AppError(422,'FUTURE_ACTUAL_DATE','An actual delivery cannot be in the future.');
    await db.query('UPDATE shipments SET status=$2,estimated_at=coalesce($3,estimated_at),actual_at=$4,version=version+1 WHERE id=$1',[id,data.status,data.estimatedAt ?? null,data.status==='delivered'?data.actualAt:null]);
    await db.query('INSERT INTO shipment_events(shipment_id,status,description,occurred_at) VALUES($1,$2,$3,$4)',[id,data.status,data.note,data.status==='delivered'?data.actualAt:new Date().toISOString()]);
    await db.query("INSERT INTO audit_log(actor_id,action,entity_id,details) VALUES(public.actor_id(),'shipment.updated',$1,$2)",[id,JSON.stringify({status:data.status})]);
    return {ok:true};
  });
}
export async function listTeam(actorId:string) {
  return withActor(actorId,async db=>{
    await requirePermission(db,'team.manage');
    return (await db.query(`SELECT id,name,email,role,permissions,active,is_demo AS "isDemo" FROM app_users WHERE role IN ('owner','staff') ORDER BY role,name`)).rows;
  });
}
export async function updateMember(actorId:string,id:string,input:unknown) {
  z.uuid().parse(id);const data=z.object({permissions:z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),active:z.boolean()}).strict().parse(input);
  return withActor(actorId,async db=>{
    await requirePermission(db,'team.manage');
    const user=(await db.query('SELECT id,role FROM app_users WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!user)throw new AppError(404,'NOT_FOUND','Team member not found.');
    if(user.role!=='staff')throw new AppError(409,'PROTECTED_ACCOUNT','Owner and customer accounts cannot be changed through staff permissions.');
    await db.query('UPDATE app_users SET permissions=$2,active=$3 WHERE id=$1',[id,[...new Set(data.permissions)],data.active]);
    await db.query("INSERT INTO audit_log(actor_id,action,entity_id,details) VALUES(public.actor_id(),'team.permissions_updated',$1,$2)",[id,JSON.stringify(data)]);
    return {ok:true};
  });
}
export async function assignCase(actorId:string,id:string,input:unknown) {
  const data=z.object({assignedTo:z.uuid().nullable(),mode:z.enum(['air','sea','road','courier','other','unsure']).optional()}).strict().parse(input);z.uuid().parse(id);
  return withActor(actorId,async db=>{
    await requirePermission(db,'cases.accept');
    if(data.assignedTo && !(await db.query("SELECT 1 FROM app_users WHERE id=$1 AND active AND role IN ('owner','staff')",[data.assignedTo])).rowCount)throw new AppError(422,'INVALID_ASSIGNEE','Select an active teammate.');
    const result=await db.query("UPDATE enquiries SET assigned_to=$2,mode=coalesce($3,mode),version=version+1 WHERE id=$1 AND status='pending' RETURNING id",[id,data.assignedTo,data.mode]);
    if(!result.rowCount)throw new AppError(409,'CONFLICT','Only pending enquiries can be reassigned or change mode here.');
    return {ok:true};
  });
}
export async function listCommitments(actorId:string) {
  return withActor(actorId,async db=>(await db.query('SELECT c.id,c.enquiry_id AS "enquiryId",c.assigned_to AS "assignedTo",c.title,c.due_at AS "dueAt",c.completed_at AS "completedAt",e.reference FROM commitments c JOIN enquiries e ON e.id=c.enquiry_id ORDER BY c.due_at LIMIT 100')).rows);
}
export async function createCommitment(actorId:string,input:unknown) {
  const data=z.object({enquiryId:z.uuid(),assignedTo:z.uuid(),title:safeText(3,150),dueAt:z.iso.datetime({offset:true})}).strict().parse(input);
  return withActor(actorId,async db=>{
    await requirePermission(db,'commitments.manage');
    const result=await db.query('INSERT INTO commitments(enquiry_id,assigned_to,title,due_at) VALUES($1,$2,$3,$4) RETURNING id',[data.enquiryId,data.assignedTo,data.title,data.dueAt]);
    return result.rows[0];
  });
}
export async function completeCommitment(actorId:string,id:string) {
  z.uuid().parse(id); return withActor(actorId,async db=>{
    await requirePermission(db,'commitments.manage');
    if(!(await db.query('UPDATE commitments SET completed_at=coalesce(completed_at,now()) WHERE id=$1 RETURNING id',[id])).rowCount)throw new AppError(404,'NOT_FOUND','Commitment not found.');
    return {ok:true};
  });
}
