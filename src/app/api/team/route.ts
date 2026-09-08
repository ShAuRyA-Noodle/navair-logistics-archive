import { requireActor } from '@/lib/auth';
import { handle,json } from '@/lib/http';
import { listTeam } from '@/lib/operations';
export async function GET(request:Request){return handle(async()=>json({members:await listTeam((await requireActor(request)).id)}));}
