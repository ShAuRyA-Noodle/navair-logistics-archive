import { requireActor } from '@/lib/auth';
import { handle,json } from '@/lib/http';
import { listMail } from '@/lib/mail';
export async function GET(request:Request){return handle(async()=>json({messages:await listMail((await requireActor(request)).id)}));}
