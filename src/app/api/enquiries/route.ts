import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requireActor,assertSameOrigin } from '@/lib/auth';
import { handle,json,readJson } from '@/lib/http';
import { submitEnquiry,listCasePage,enquirySchema } from '@/lib/operations';
import { pool } from '@/lib/db';
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
 return json(await submitEnquiry(raw.enquiry,key),201);
});}
