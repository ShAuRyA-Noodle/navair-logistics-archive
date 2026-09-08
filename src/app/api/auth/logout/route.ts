import { assertSameOrigin,signOut,sessionCookie } from '@/lib/auth';
import { handle,json } from '@/lib/http';
export async function POST(request:Request){return handle(async()=>{assertSameOrigin(request);await signOut(request);return json({ok:true},200,{'Set-Cookie':sessionCookie('',0)});});}
