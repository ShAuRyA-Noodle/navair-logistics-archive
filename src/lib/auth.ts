import { createHash, randomBytes } from 'node:crypto';
import { pool } from './db';
import { AppError } from './errors';
import type { Actor } from './permissions';
export const SESSION_COOKIE='navair_session';
export function hashToken(token:string) { return createHash('sha256').update(token).digest('hex'); }
export function demoEnabled() { return process.env.LOCAL_DEMO_MODE==='true' && process.env.NODE_ENV!=='production'; }
export function appOrigin() { return new URL(process.env.APP_URL ?? 'http://127.0.0.1:3000').origin; }
export function assertSameOrigin(request:Request) {
  if(request.headers.get('origin')!==appOrigin()) throw new AppError(403,'INVALID_ORIGIN','This request must come from the Navair website.');
}
export function assertLocalDemo(request:Request) {
  const url=new URL(request.url);
  if(!demoEnabled()||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new AppError(404,'NOT_FOUND','Not found.');
}
export function mapActor(row:Record<string,unknown>):Actor {
  return {id:String(row.id),name:String(row.name),email:String(row.email),role:row.role as Actor['role'],permissions:row.permissions as string[],active:Boolean(row.active),isDemo:Boolean(row.is_demo)};
}
export async function currentActor(request:Request):Promise<Actor|null> {
  const token=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length+1);
  if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
  const result=await pool.query('SELECT * FROM public.resolve_session($1)',[hashToken(token)]);
  const row=result.rows[0];
  if(!row || (row.is_demo && !demoEnabled()))return null;
  return mapActor(row);
}
export async function requireActor(request:Request) {
  const actor=await currentActor(request);
  if(!actor)throw new AppError(401,'UNAUTHENTICATED','Sign in to continue.');
  return actor;
}
export async function mintSession(userId:string) {
  const token=randomBytes(32).toString('hex');
  await pool.query('SELECT public.create_session($1,$2)',[userId,hashToken(token)]);
  return token;
}
export function sessionCookie(token:string,maxAge=28800) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${appOrigin().startsWith('https://')?'; Secure':''}`;
}
export async function signOut(request:Request) {
  const token=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length+1);
  if(token)await pool.query('SELECT public.revoke_session($1)',[hashToken(token)]);
}
