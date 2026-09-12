import {handle,json} from '@/lib/http';
import {listFeed} from '@/lib/news/feed';
export async function GET(request:Request){return handle(async()=>{
 const query=new URL(request.url).searchParams;
 return json(await listFeed(Number(query.get('limit') ?? 40),Number(query.get('offset') ?? 0)));
});}
