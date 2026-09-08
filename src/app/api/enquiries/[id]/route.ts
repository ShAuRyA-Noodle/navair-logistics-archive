import { requireActor,assertSameOrigin } from '@/lib/auth';
import { handle,json,readJson } from '@/lib/http';
import { caseDetail,assignCase } from '@/lib/operations';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){return handle(async()=>json(await caseDetail((await requireActor(request)).id,(await context.params).id)));}
export async function PATCH(request:Request,context:Context){return handle(async()=>{assertSameOrigin(request);return json(await assignCase((await requireActor(request)).id,(await context.params).id,await readJson(request)));});}
