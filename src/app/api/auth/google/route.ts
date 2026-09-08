import { googleClient } from '@/lib/google';
import { appOrigin,demoEnabled } from '@/lib/auth';
import { handle } from '@/lib/http';
import { AppError } from '@/lib/errors';
export async function GET(){return handle(async()=>{
 if(demoEnabled())throw new AppError(503,'DEMO_ONLY','Google sign-in will be enabled after the real company configuration is connected.');
 const client=await googleClient();
 const {data,error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:`${appOrigin()}/api/auth/callback`}});
 if(error||!data.url)throw new AppError(503,'GOOGLE_UNAVAILABLE','Google sign-in could not be started.');
 return Response.redirect(data.url,303);
});}
