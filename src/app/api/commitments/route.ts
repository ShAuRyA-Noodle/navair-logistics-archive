import { requireActor,assertSameOrigin } from '@/lib/auth';
import { handle,json,readJson } from '@/lib/http';
import { listCommitments,createCommitment } from '@/lib/operations';
export async function GET(request:Request){return handle(async()=>json({commitments:await listCommitments((await requireActor(request)).id)}));}
export async function POST(request:Request){return handle(async()=>{assertSameOrigin(request);return json(await createCommitment((await requireActor(request)).id,await readJson(request)),201);});}
