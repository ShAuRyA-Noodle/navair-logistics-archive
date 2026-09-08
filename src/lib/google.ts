import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { AppError } from './errors';
export async function googleClient(){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)throw new AppError(503,'GOOGLE_NOT_CONFIGURED','Google sign-in needs the company’s Supabase and Google configuration. Use the labelled local demo profiles for now.');
 const store=await cookies();
 return createServerClient(url,key,{auth:{flowType:'pkce'},cookies:{getAll:()=>store.getAll(),setAll:values=>values.forEach(({name,value,options})=>store.set(name,value,{...options,httpOnly:true,sameSite:'lax',secure:process.env.APP_URL?.startsWith('https://')??false}))}});
}
