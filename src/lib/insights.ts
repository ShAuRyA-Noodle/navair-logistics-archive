import { z } from 'zod';
import { withActor } from './db';
import { getJourney } from './operations';
import { forecastPrices,summarizeRadar,type PriceObservation,type ShipmentEvidence } from './analytics';
export async function getForecast(actorId:string,enquiryId:string,search:URLSearchParams){
 const journey=await getJourney(actorId,enquiryId);
 const options=z.object({weeks:z.coerce.number().int().min(1).max(8),confidence:z.coerce.number().refine(x=>x===80||x===95)}).parse({weeks:search.get('weeks')??8,confidence:search.get('confidence')??80});
 return withActor(actorId,async db=>{
  const result=await db.query(`SELECT p.id,p.route_id AS "routeId",r.mode,p.unit,p.currency,p.observed_at AS "observedAt",p.selling_price AS "sellingPrice",p.is_demo AS "isDemo" FROM price_observations p JOIN routes r ON r.id=p.route_id WHERE p.route_id=$1 ORDER BY p.observed_at LIMIT 5000`,[journey.shipment.routeId]);
  const observations:PriceObservation[]=result.rows.map(row=>({...row,observedAt:row.observedAt.toISOString(),sellingPrice:Number(row.sellingPrice)}));
  return forecastPrices(observations,{routeId:journey.shipment.routeId,mode:journey.enquiry.mode,unit:journey.shipment.unit,currency:journey.shipment.currency,weeks:options.weeks,confidence:options.confidence as 80|95});
 });
}
export async function getRadar(actorId:string,enquiryId:string){
 const journey=await getJourney(actorId,enquiryId);
 return withActor(actorId,async db=>{
  const result=await db.query(`SELECT d.source_id AS id,d.route_id AS "routeId",r.mode,d.promised_at AS "promisedAt",d.actual_at AS "actualAt",d.observed_at AS "observedAt",d.issue,d.is_demo AS "isDemo" FROM delivery_evidence d JOIN routes r ON r.id=d.route_id WHERE d.route_id=$1 AND (d.observed_at>=now()-interval '30 days' OR d.promised_at>=now()-interval '30 days')`,[journey.shipment.routeId]);
  const evidence:ShipmentEvidence[]=result.rows.map(row=>({...row,promisedAt:row.promisedAt.toISOString(),actualAt:row.actualAt?.toISOString()??null,observedAt:row.observedAt.toISOString()}));
  return summarizeRadar(evidence,{routeId:journey.shipment.routeId,mode:journey.enquiry.mode});
 });
}
