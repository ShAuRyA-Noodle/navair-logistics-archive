import { z } from 'zod';
import { pool } from '@/lib/db';
import { assertLocalDemo,assertSameOrigin,mapActor,mintSession,sessionCookie } from '@/lib/auth';
import { handle,json,readJson } from '@/lib/http';
import { AppError } from '@/lib/errors';
export async function GET(request:Request){return handle(async()=>{assertLocalDemo(request);const users=await pool.query('SELECT * FROM public.demo_users()');return json({users:users.rows.map(mapActor)});});}
export async function POST(request:Request){return handle(async()=>{
 assertLocalDemo(request);assertSameOrigin(request);
 const {userId}=z.object({userId:z.uuid()}).strict().parse(await readJson(request));
 const users=await pool.query('SELECT * FROM public.demo_users()');
 const user=users.rows.find(u=>u.id===userId);if(!user)throw new AppError(404,'NOT_FOUND','Demo profile not found.');
 return json({user:mapActor(user)},200,{'Set-Cookie':sessionCookie(await mintSession(userId))});
});}
