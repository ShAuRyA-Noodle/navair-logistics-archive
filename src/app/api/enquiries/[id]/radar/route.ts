import { requireActor } from '@/lib/auth';
import { handle,json } from '@/lib/http';
import { getRadar } from '@/lib/insights';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>json(await getRadar((await requireActor(request)).id,(await context.params).id)));}
