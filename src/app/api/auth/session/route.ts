import { currentActor, demoEnabled } from '@/lib/auth';
import { handle,json } from '@/lib/http';
export const dynamic='force-dynamic';
export async function GET(request:Request){return handle(async()=>json({user:await currentActor(request),demoMode:demoEnabled(),googleConfigured:Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_PUBLISHABLE_KEY),mailMode:process.env.MAIL_MODE==='resend'?'resend':'preview'}));}
