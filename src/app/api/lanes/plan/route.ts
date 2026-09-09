import {handle,json} from '@/lib/http';
import {getRoutePlan} from '@/lib/lane-insights';
export async function GET(request:Request){return handle(async()=>{
 const query=new URL(request.url).searchParams;
 return json(await getRoutePlan({origin:query.get('origin'),destination:query.get('destination')}));
});}
