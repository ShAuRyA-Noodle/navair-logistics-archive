import {z} from 'zod';
import {withActor} from './db';
import {AppError} from './errors';
import {queryForecast} from './insights';
import type {RadarSummary} from './analytics';

type PublicRoute={id:string;origin:string;destination:string;mode:string;unit:string;serviceCoverage:'supported'|'on_request'|'not_supported'|'unknown'};
export type PublicRouteMatch='matched'|'unknown_location'|'no_history'|'service_unavailable'|'not_supported'|'mode_required';
export type PublicRouteConditions={route:PublicRoute|null;radar:RadarSummary|null;match:PublicRouteMatch;suggestions:{origin:string[];destination:string[]}};
const searchSchema=z.object({origin:z.string().trim().min(2).max(120),destination:z.string().trim().min(2).max(120),mode:z.enum(['air','sea','road','courier','other','unsure'])}).strict();
const normalize=(value:string)=>value.replace(/\s+/g,' ').trim().toLocaleLowerCase();
const suggestionsFor=(value:string,cities:string[])=>{
 const query=normalize(value);
 const prefix=query.slice(0,3);
 return cities.filter(city=>{const candidate=normalize(city);return candidate.startsWith(query)||candidate.includes(query)||candidate.startsWith(prefix);}).slice(0,3);
};
export async function getPublicRouteConditions(input:unknown):Promise<PublicRouteConditions>{
 const search=searchSchema.parse(input);
 return withActor(null,async db=>{
  const values=[search.origin,search.destination].map(normalize);
  const aliases=(await db.query('SELECT alias,canonical_name FROM city_aliases WHERE alias=ANY($1)',[values])).rows;
  const names=values.map(value=>normalize(String(aliases.find(alias=>alias.alias===value)?.canonical_name??value)));
  const cities=(await db.query("SELECT DISTINCT city FROM (SELECT origin AS city FROM routes WHERE is_public UNION SELECT destination AS city FROM routes WHERE is_public) public_cities ORDER BY city")).rows.map(row=>String(row.city));
  const knownCities=new Set(cities.map(normalize));
  const unknownOrigin=!knownCities.has(names[0]),unknownDestination=!knownCities.has(names[1]);
  const suggestions={origin:unknownOrigin?suggestionsFor(search.origin,cities):[],destination:unknownDestination?suggestionsFor(search.destination,cities):[]};
  if(unknownOrigin||unknownDestination)return {route:null,radar:null,match:'unknown_location',suggestions};
  if(search.mode==='unsure')return {route:null,radar:null,match:'mode_required',suggestions};
  const route=(await db.query("SELECT id,origin,destination,mode,unit,service_coverage AS \"serviceCoverage\" FROM routes WHERE is_public AND lower(regexp_replace(trim(origin),'\\s+',' ','g'))=$1 AND lower(regexp_replace(trim(destination),'\\s+',' ','g'))=$2 AND mode=$3 LIMIT 1",[...names,search.mode])).rows[0] as PublicRoute|undefined;
  if(!route){
   const sameRoute=((await db.query("SELECT 1 FROM routes WHERE is_public AND lower(regexp_replace(trim(origin),'\\s+',' ','g'))=$1 AND lower(regexp_replace(trim(destination),'\\s+',' ','g'))=$2 LIMIT 1",names)).rowCount??0)>0;
   return {route:null,radar:null,match:sameRoute?'service_unavailable':'no_history',suggestions};
  }
  if(route.serviceCoverage==='not_supported')return {route:null,radar:null,match:'not_supported',suggestions};
  const radar=(await db.query('SELECT public.public_route_conditions($1) AS radar',[route.id])).rows[0].radar as RadarSummary|null;
  return {route,radar,match:radar?.status==='insufficient_data'||!radar?'no_history':'matched',suggestions};
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
