import { createHash } from 'node:crypto';
import { after } from 'next/server';
import { z } from 'zod';
import { requireActor,assertSameOrigin } from '@/lib/auth';
import { handle,json,readJson } from '@/lib/http';
import { submitEnquiry,listCasePage,enquirySchema } from '@/lib/operations';
import { pool } from '@/lib/db';
import { processOutbox } from '@/lib/mail';
import { AppError } from '@/lib/errors';
export async function GET(request:Request){return handle(async()=>{
 const query=new URL(request.url).searchParams;
 return json(await listCasePage((await requireActor(request)).id,{page:query.get('page')??1,pageSize:query.get('pageSize')??50}));
});}
export async function POST(request:Request){return handle(async()=>{
 assertSameOrigin(request);
 const raw=z.object({enquiry:enquirySchema,website:z.string().max(200).default('')}).strict().parse(await readJson(request));
 if(raw.website)throw new AppError(422,'INVALID_SUBMISSION','The enquiry could not be submitted.');
 const key=z.uuid().parse(request.headers.get('idempotency-key'));
 const globalLimit=await pool.query("SELECT public.rate_limit('enquiry:global',60,60) AS allowed");
 if(!globalLimit.rows[0].allowed)throw new AppError(429,'RATE_LIMIT','Enquiries are busy right now. Please try again shortly.');
 const bucket=createHash('sha256').update(raw.enquiry.email).digest('hex');
 const limited=await pool.query('SELECT public.rate_limit($1,20,3600) AS allowed',[`enquiry:${bucket}`]);
 if(!limited.rows[0].allowed)throw new AppError(429,'RATE_LIMIT','Too many attempts. Please try again later.');
 const result=await submitEnquiry(raw.enquiry,key);
 // Both enquiry emails are queued by submit_enquiry. On a serverless host there is no
 // long-lived worker to pick them up, so the queue is drained straight after the response
 // goes out. after() runs once the response is sent, so a slow mail provider never delays
 // the customer, and a failure here cannot lose the enquiry - it is already committed and
 // the scheduled drain will retry it.
 after(async()=>{
  const actorId=process.env.WORKER_ACTOR_ID;
  if(!actorId)return;
  try{await processOutbox(actorId);await processOutbox(actorId);}
  catch{/* The scheduled drain retries; a send failure must not surface to the customer. */}
 });
 return json(result,201);
});}
