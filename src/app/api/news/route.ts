import {handle,json} from '@/lib/http';
import {listFeed} from '@/lib/news/feed';
export async function GET(request:Request){return handle(async()=>{
 const limit=new URL(request.url).searchParams.get('limit');
 return json({events:await listFeed(limit?Number(limit):24)});
});}
