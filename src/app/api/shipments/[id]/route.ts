import { requireActor,assertSameOrigin } from '@/lib/auth';
import { handle,json,readJson } from '@/lib/http';
import { updateShipment } from '@/lib/operations';
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>{assertSameOrigin(request);return json(await updateShipment((await requireActor(request)).id,(await context.params).id,await readJson(request)));});}
