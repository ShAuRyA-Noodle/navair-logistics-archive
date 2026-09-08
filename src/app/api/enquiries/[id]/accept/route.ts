import { requireActor,assertSameOrigin } from '@/lib/auth';
import { handle,json,readJson } from '@/lib/http';
import { acceptCase } from '@/lib/operations';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>{assertSameOrigin(request);return json(await acceptCase((await requireActor(request)).id,(await context.params).id,await readJson(request)),201);});}
