import {handle,json} from '@/lib/http';
import {withActor} from '@/lib/db';
import {currentActor} from '@/lib/auth';
export async function GET(request:Request){return handle(async()=>withActor((await currentActor(request))?.id??null,async db=>{
 const routes=(await db.query(`SELECT r.id,r.origin,r.destination,r.mode,r.unit,
 coalesce((SELECT jsonb_agg(series) FROM (SELECT DISTINCT p.unit,p.currency FROM price_observations p WHERE p.route_id=r.id ORDER BY p.unit,p.currency) series),'[]'::jsonb) AS "priceSeries"
 FROM routes r ORDER BY r.origin,r.destination,r.mode`)).rows;
 const aliases=Object.fromEntries((await db.query('SELECT alias,canonical_name FROM city_aliases')).rows.map(row=>[row.alias,row.canonical_name]));
 return json({routes,aliases});
}));}
