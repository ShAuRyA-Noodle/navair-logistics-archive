import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {withActor,pool} from '../src/lib/db';
import {getPublicRouteConditions,getRouteForecast} from '../src/lib/route-insights';
const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});
const routeId=randomUUID(),privateId=randomUUID(),sparseId=randomUUID(),customer=randomUUID(),outsider=randomUUID(),enquiry=randomUUID();
const tag=randomUUID().slice(0,8),origin=`Origin ${tag}`;
const day=(n:number)=>new Date(Date.now()+n*86400000).toISOString();
beforeAll(async()=>{
 for(const [id,destination,published] of [[routeId,'Mumbai',true],[privateId,`Private ${tag}`,false],[sparseId,`Sparse ${tag}`,true]])await admin.query('INSERT INTO routes(id,origin,destination,mode,unit,is_public) VALUES($1,$2,$3,$4,$5,$6)',[id,origin,destination,'road','shipment',published]);
 for(const id of [customer,outsider])await admin.query("INSERT INTO app_users(id,name,email,role,is_demo) VALUES($1,'Test customer',$2,'customer',true)",[id,`${id}@example.test`]);
 await admin.query("INSERT INTO enquiries(id,reference,customer_id,name,email,origin,destination,mode,description,status,is_demo) VALUES($1,$2,$3,'Test customer',$4,$5,'Mumbai','road','Test route shipment','accepted',true)",[enquiry,tag,customer,`${customer}@example.test`,origin]);
 await admin.query("INSERT INTO shipments(enquiry_id,route_id,promised_at,selling_price,currency,unit,quantity) VALUES($1,$2,$3,150,'INR','shipment',1)",[enquiry,routeId,day(4)]);
 for(let i=0;i<6;i++)await admin.query('INSERT INTO delivery_evidence(source_id,route_id,promised_at,actual_at,observed_at,is_demo) VALUES($1,$2,$3,$4,$4,true)',[`${tag}:${i}`,routeId,day(-8),day(i<4?-5:-9)]);
 await admin.query("INSERT INTO delivery_evidence(source_id,route_id,promised_at,actual_at,observed_at,issue,is_demo) VALUES($1,$2,$3,$4,$4,'private note with name',true)",[`${tag}:sparse`,sparseId,day(-8),day(-7)]);
 for(let i=0;i<40;i++)await admin.query("INSERT INTO price_observations(source_id,route_id,observed_at,selling_price,currency,unit,is_demo) VALUES($1,$2,$3,$4,'INR','shipment',true)",[`${tag}:price:${i}`,routeId,day(-i*7),150-i+Math.sin(i)*2]);
});
afterAll(async()=>{await admin.end();await pool.end();});
it('resolves case/whitespace and Bombay alias to published Mumbai route with real aggregates',async()=>{
 const result=await getPublicRouteConditions({origin:`  ${origin.toUpperCase()}  `,destination:' bombay ',mode:'road'});
 expect(result.route?.id).toBe(routeId);expect(result.radar).toMatchObject({sampleCount:6,delayedCount:4,earlyCount:2,typicalDelayDays:3,status:'elevated',isDemo:true});
 expect(JSON.stringify(result)).not.toMatch(/source_id|customer|sellingPrice|buyingCost|private note/);
});
it('does not expose private, unknown or direction-reversed routes',async()=>{
 for(const input of [{origin,destination:`Private ${tag}`,mode:'road'},{origin,destination:'Unknown',mode:'road'},{origin:'Mumbai',destination:origin,mode:'road'}])expect(await getPublicRouteConditions(input)).toEqual({route:null,radar:null});
});
it('suppresses detailed evidence below the public privacy threshold',async()=>{
 const {radar}=await getPublicRouteConditions({origin,destination:`Sparse ${tag}`,mode:'road'});
 expect(radar).toMatchObject({status:'insufficient_data',sampleCount:0,delayedCount:0,earlyCount:0,unresolvedCount:0,typicalDelayDays:null,dataThrough:null,issues:[]});
});
it('keeps raw shipment evidence and prices inaccessible to anonymous database access',async()=>{
 for(const table of ['delivery_evidence','price_observations'])expect((await withActor(null,db=>db.query(`SELECT * FROM ${table} WHERE route_id=$1`,[routeId]))).rowCount).toBe(0);
});
it('recomputes route notices from updated database evidence',async()=>{
 await admin.query('UPDATE delivery_evidence SET actual_at=promised_at-interval \'1 day\' WHERE source_id LIKE $1',[`${tag}:%`]);
 const {radar}=await getPublicRouteConditions({origin,destination:'Mumbai',mode:'road'});
 expect(radar).toMatchObject({sampleCount:6,delayedCount:0,earlyCount:6,status:'clear'});
});
it('returns historical and future selling-price series only for an accepted authorized route',async()=>{
 const result=await getRouteForecast(customer,routeId,new URLSearchParams('weeks=8&confidence=80'));
 expect(result.history).toHaveLength(40);expect(result.points).toHaveLength(8);expect(result.status).toBe('available');
 expect(JSON.stringify(result)).not.toMatch(/buying|margin|customer|source_id/);
 const wide=await getRouteForecast(customer,routeId,new URLSearchParams('weeks=8&confidence=95'));
 expect(wide.points[0].estimate).toBe(result.points[0].estimate);expect(wide.points[0].upper).toBeGreaterThanOrEqual(result.points[0].upper);
 await expect(getRouteForecast(outsider,routeId,new URLSearchParams())).rejects.toMatchObject({status:403});
});
it('does not let direct aggregate calls reveal private route evidence',async()=>{
 const result=await withActor(null,db=>db.query('SELECT public.public_route_conditions($1) AS radar',[privateId]));
 expect(result.rows[0].radar).toBeNull();
});
it('does not count future deliveries as completed evidence',async()=>{
 for(let i=0;i<5;i++)await admin.query('INSERT INTO delivery_evidence(source_id,route_id,promised_at,actual_at,observed_at,is_demo) VALUES($1,$2,$3,$4,$5,true)',[`${tag}:future:${i}`,sparseId,day(1),day(2),day(0)]);
 const {radar}=await getPublicRouteConditions({origin,destination:`Sparse ${tag}`,mode:'road'});
 expect(radar).toMatchObject({status:'insufficient_data',sampleCount:0,delayedCount:0});
});
it('withholds stale route summaries even with enough old observations',async()=>{
 await admin.query("UPDATE delivery_evidence SET observed_at=now()-interval '20 days',promised_at=now()-interval '22 days',actual_at=now()-interval '21 days' WHERE route_id=$1",[routeId]);
 const {radar}=await getPublicRouteConditions({origin,destination:'Mumbai',mode:'road'});
 expect(radar).toMatchObject({status:'insufficient_data',sampleCount:0,dataThrough:null});
});
