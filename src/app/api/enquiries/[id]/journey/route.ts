import { requireActor } from '@/lib/auth';
import { handle,json } from '@/lib/http';
import { getJourney } from '@/lib/operations';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>json(await getJourney((await requireActor(request)).id,(await context.params).id)));}
