import { requireActor,assertSameOrigin } from '@/lib/auth';
import { handle,json } from '@/lib/http';
import { processOutbox } from '@/lib/mail';
export async function POST(request:Request){return handle(async()=>{assertSameOrigin(request);return json(await processOutbox((await requireActor(request)).id));});}
