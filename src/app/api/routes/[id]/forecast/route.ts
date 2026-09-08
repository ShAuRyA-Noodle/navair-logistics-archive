import {handle,json} from '@/lib/http';
import {requireActor} from '@/lib/auth';
import {getRouteForecast} from '@/lib/route-insights';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>{
 const actor=await requireActor(request);
 return json(await getRouteForecast(actor.id,(await context.params).id,new URL(request.url).searchParams));
});}
