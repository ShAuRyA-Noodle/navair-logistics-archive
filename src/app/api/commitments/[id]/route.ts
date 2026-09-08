import { requireActor,assertSameOrigin } from '@/lib/auth';
import { handle,json } from '@/lib/http';
import { completeCommitment } from '@/lib/operations';
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>{assertSameOrigin(request);return json(await completeCommitment((await requireActor(request)).id,(await context.params).id));});}
