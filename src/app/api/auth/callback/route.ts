import { googleClient } from '@/lib/google';
import { appOrigin,demoEnabled,mintSession,sessionCookie } from '@/lib/auth';
import { pool } from '@/lib/db';
import { handle } from '@/lib/http';
import { AppError } from '@/lib/errors';
export async function GET(request:Request){return handle(async()=>{
 if(demoEnabled())throw new AppError(403,'DEMO_ONLY','Real identities are disabled in the demo database.');
 const code=new URL(request.url).searchParams.get('code');if(!code)throw new AppError(400,'MISSING_CODE','Google sign-in was cancelled or incomplete.');
 const client=await googleClient();const exchange=await client.auth.exchangeCodeForSession(code);
 if(exchange.error)throw new AppError(401,'LOGIN_FAILED','Google sign-in could not be verified.');
 const {data,error}=await client.auth.getUser();
 if(error||!data.user?.email||!data.user.email_confirmed_at)throw new AppError(401,'UNVERIFIED_EMAIL','A verified Google email is required.');
 const userId=(await pool.query('SELECT public.provision_customer($1,$2,$3) AS id',[data.user.id,data.user.email,String(data.user.user_metadata.full_name??data.user.email).slice(0,100)])).rows[0].id;
 const token=await mintSession(userId);await client.auth.signOut({scope:'local'});
 return new Response(null,{status:303,headers:{Location:`${appOrigin()}/portal`,'Set-Cookie':sessionCookie(token),'Cache-Control':'no-store'}});
});}
