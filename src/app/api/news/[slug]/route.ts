import {currentActor} from '@/lib/auth';
import {handle,json} from '@/lib/http';
import {getEvent} from '@/lib/news/feed';
export async function GET(request:Request,{params}:{params:Promise<{slug:string}>}){return handle(async()=>{
 const {slug}=await params;
 const actor=await currentActor(request);
 return json(await getEvent(slug,actor?.id??null));
});}
