import {handle,json} from '@/lib/http';
import {getLaneAnalysis} from '@/lib/lane-insights';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return handle(async()=>{
 const {id}=await params;
 return json(await getLaneAnalysis(id,new URL(request.url).searchParams));
});}
