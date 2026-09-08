import {handle,json} from '@/lib/http';
import {getPublicRouteConditions} from '@/lib/route-insights';
export async function GET(request:Request){return handle(async()=>{
 const query=new URL(request.url).searchParams;
 return json(await getPublicRouteConditions({origin:query.get('origin'),destination:query.get('destination'),mode:query.get('mode')}));
});}
