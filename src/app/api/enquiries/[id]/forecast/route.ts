import { requireActor } from '@/lib/auth';
import { handle,json } from '@/lib/http';
import { getForecast } from '@/lib/insights';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>json(await getForecast((await requireActor(request)).id,(await context.params).id,new URL(request.url).searchParams)));}
