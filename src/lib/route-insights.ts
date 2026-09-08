import {z} from 'zod';
import {withActor} from './db';
import {AppError} from './errors';
import {queryForecast} from './insights';
import type {RadarSummary} from './analytics';

type PublicRoute={id:string;origin:string;destination:string;mode:string;unit:string};
const searchSchema=z.object({origin:z.string().trim().min(2).max(120),destination:z.string().trim().min(2).max(120),mode:z.enum(['air','sea','road','courier','other','unsure'])}).strict();
export async function getPublicRouteConditions(input:unknown):Promise<{route:PublicRoute|null;radar:RadarSummary|null}>{
 const search=searchSchema.parse(input);
 return withActor(null,async db=>{
  const values=[search.origin,search.destination].map(value=>value.replace(/\s+/g,' ').toLowerCase());
  const aliases=(await db.query('SELECT alias,canonical_name FROM city_aliases WHERE alias=ANY($1)',[values])).rows;
  const names=values.map(value=>String(aliases.find(alias=>alias.alias===value)?.canonical_name??value).toLowerCase());
  const route=(await db.query("SELECT id,origin,destination,mode,unit FROM routes WHERE is_public AND lower(regexp_replace(trim(origin),'\\s+',' ','g'))=$1 AND lower(regexp_replace(trim(destination),'\\s+',' ','g'))=$2 AND mode=$3 LIMIT 1",[...names,search.mode])).rows[0] as PublicRoute|undefined;
  if(!route)return {route:null,radar:null};
  const radar=(await db.query('SELECT public.public_route_conditions($1) AS radar',[route.id])).rows[0].radar as RadarSummary|null;
  return {route,radar};
 });
}
export async function getRouteForecast(actorId:string,routeId:string,search:URLSearchParams){
 z.uuid().parse(routeId);
 return withActor(actorId,async db=>{
  const route=(await db.query('SELECT id,mode,unit,public.has_route(id) AS allowed FROM routes WHERE id=$1',[routeId])).rows[0];
  if(!route)throw new AppError(404,'NOT_FOUND','Route not found.');
  if(!route.allowed)throw new AppError(403,'AWAITING_ACCEPTANCE','Price history and forecasts become available after Navair accepts your enquiry for this route.');
  const unit=z.string().trim().min(1).max(40).parse(search.get('unit')??route.unit);
  const currency=z.string().regex(/^[A-Z]{3}$/).parse(search.get('currency')??'INR');
  return queryForecast(db,{routeId,mode:route.mode,unit,currency},search);
 });
}
