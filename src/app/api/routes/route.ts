import { handle,json } from '@/lib/http';
import { withActor } from '@/lib/db';
import { currentActor } from '@/lib/auth';
export async function GET(request:Request){return handle(async()=>json({routes:await withActor((await currentActor(request))?.id??null,async db=>(await db.query('SELECT id,origin,destination,mode,unit FROM routes ORDER BY origin,destination')).rows)}));}
