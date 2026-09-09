import {z} from 'zod';
import {withActor} from './db';
import {AppError} from './errors';
import {forecastLane,summarizeReliability,type DeliveryDay,type LaneForecast,type LaneReliability,type WeeklyPrice} from './lane-analytics';
import {planRoute,type GraphLane,type RoutePlan} from './itinerary';

// Public lane insight. Everything here reads through the SECURITY DEFINER aggregate
// functions added in migration 011/012, so an unauthenticated visitor can study a public
// lane without any grant on the underlying observation rows.

export type LaneMeta={id:string;origin:string;destination:string;mode:string;unit:string;serviceCoverage:GraphLane['serviceCoverage'];distanceKm:number|null;transitDays:number|null;crossBorder:boolean|null};
export type PriceSeriesOption={unit:string;currency:string;weeks:number};
export type LaneAnalysis={lane:LaneMeta;series:PriceSeriesOption[];selected:PriceSeriesOption|null;forecast:LaneForecast|null;reliability:LaneReliability};

const planSchema=z.object({origin:z.string().trim().min(2).max(120),destination:z.string().trim().min(2).max(120)}).strict();
const analysisSchema=z.object({
 weeks:z.coerce.number().int().min(1).max(8).default(4),
 confidence:z.coerce.number().refine(value=>value===80||value===95,'confidence must be 80 or 95').default(80),
 unit:z.string().trim().min(1).max(40).optional(),
 currency:z.string().regex(/^[A-Z]{3}$/).optional(),
}).strict();

async function laneGraph(db:Parameters<Parameters<typeof withActor>[1]>[0]):Promise<GraphLane[]>{
 return (await db.query(
  `SELECT id,origin,destination,mode,unit,service_coverage AS "serviceCoverage",distance_km AS "distanceKm",
          transit_days AS "transitDays",cross_border AS "crossBorder"
   FROM public.public_lane_graph()`,
 )).rows as GraphLane[];
}

export async function getRoutePlan(input:unknown):Promise<RoutePlan>{
 const search=planSchema.parse(input);
 return withActor(null,async db=>{
  const aliases=(await db.query('SELECT alias,canonical_name FROM city_aliases')).rows as Array<{alias:string;canonical_name:string}>;
  const resolve=(value:string)=>{
   const match=aliases.find(alias=>alias.alias.toLocaleLowerCase()===value.replace(/\s+/g,' ').trim().toLocaleLowerCase());
   return match?match.canonical_name:value;
  };
  return planRoute(await laneGraph(db),{origin:resolve(search.origin),destination:resolve(search.destination)});
 });
}

export async function getLaneAnalysis(laneId:string,search:URLSearchParams|Record<string,unknown>):Promise<LaneAnalysis>{
 z.uuid().parse(laneId);
 const query=search instanceof URLSearchParams
  ? Object.fromEntries([...search.entries()].filter(([,value])=>value!==''))
  : search;
 const options=analysisSchema.parse(query);
 return withActor(null,async db=>{
  const lane=(await db.query(
   `SELECT id,origin,destination,mode,unit,service_coverage AS "serviceCoverage",distance_km AS "distanceKm",
           transit_days AS "transitDays",cross_border AS "crossBorder"
    FROM public.public_lane_graph() WHERE id=$1`,[laneId],
  )).rows[0] as LaneMeta|undefined;
  if(!lane)throw new AppError(404,'NOT_FOUND','That route is not part of the public lane catalog.');

  const series=(await db.query('SELECT unit,currency,weeks FROM public.public_route_price_units($1)',[lane.id])).rows as PriceSeriesOption[];
  const selected=series.find(option=>option.unit===(options.unit??lane.unit)&&option.currency===(options.currency??'INR'))
   ??series.find(option=>option.unit===lane.unit)
   ??series[0]
   ??null;

  const deliveryDays=(await db.query(
   `SELECT promised_on AS "promisedOn",deliveries,late,early,unresolved,delay_days AS "delayDays",issues
    FROM public.public_route_delivery_days($1,$2)`,[lane.id,120],
  )).rows.map(row=>({
   promisedOn:row.promisedOn instanceof Date?row.promisedOn.toISOString():String(row.promisedOn),
   deliveries:Number(row.deliveries),
   late:Number(row.late),
   early:Number(row.early),
   unresolved:Number(row.unresolved),
   delayDays:row.delayDays===null?null:Number(row.delayDays),
   issues:(row.issues??[]) as string[],
  })) as DeliveryDay[];

  const reliability=summarizeReliability(deliveryDays);
  if(!selected)return {lane,series,selected:null,forecast:null,reliability};

  const history=(await db.query(
   `SELECT week_start AS "weekStart",selling_price AS "sellingPrice",samples
    FROM public.public_route_price_weeks($1,$2,$3)`,[lane.id,selected.unit,selected.currency],
  )).rows.map(row=>({
   weekStart:row.weekStart instanceof Date?row.weekStart.toISOString():String(row.weekStart),
   price:Number(row.sellingPrice),
   samples:Number(row.samples),
  })) as WeeklyPrice[];

  const forecast=forecastLane(history,{
   unit:selected.unit,
   currency:selected.currency,
   weeks:options.weeks,
   confidence:options.confidence as 80|95,
  });
  return {lane,series,selected,forecast,reliability};
 });
}
