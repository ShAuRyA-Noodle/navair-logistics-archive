import { config } from 'dotenv';
import { Pool, type PoolClient } from 'pg';
import { generateLanes, priceSeries, deliverySeries, type Lane } from './lanes';
config({ path: '.env.local', quiet: true });
if(process.env.LOCAL_DEMO_MODE!=='true')throw new Error('Demo seed requires LOCAL_DEMO_MODE=true.');
const db=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});
const users={owner:'10000000-0000-4000-8000-000000000001',ops:'10000000-0000-4000-8000-000000000002',sales:'10000000-0000-4000-8000-000000000003',saurabh:'10000000-0000-4000-8000-000000000004',rishi:'10000000-0000-4000-8000-000000000005'};
const PRICE_WEEKS=78;
const BATCH_ROWS=500;
// Fixture keys are namespaced per generation so a regenerated catalog replaces its own
// rows rather than colliding with an older generation's identifiers.
const SOURCE_PREFIX='demo:v2:';

// The demo journeys below narrate these eight lanes, so they must exist and must be
// declared supported regardless of what the generator's coverage draw would have said.
const flagships=[
 ['Delhi','Dubai','air'],['Mumbai','Jebel Ali','sea'],['Delhi','Mumbai','road'],['Bengaluru','Singapore','courier'],
 ['Mumbai','Singapore','air'],['Chennai','Rotterdam','sea'],['Bengaluru','Mumbai','road'],['Ahmedabad','London','courier'],
] as const;
const flagshipKey=(origin:string,destination:string,mode:string)=>`${origin}>${destination}>${mode}`;
const flagshipKeys=new Set(flagships.map(([origin,destination,mode])=>flagshipKey(origin,destination,mode)));

async function insertBatched(client:PoolClient,label:string,columns:string,table:string,conflict:string,rows:unknown[][]){
 const width=rows[0]?.length??0;
 for(let start=0;start<rows.length;start+=BATCH_ROWS){
  const chunk=rows.slice(start,start+BATCH_ROWS);
  const values=chunk.map((_,rowIndex)=>`(${Array.from({length:width},(__,column)=>`$${rowIndex*width+column+1}`).join(',')})`).join(',');
  await client.query(`INSERT INTO ${table}(${columns}) VALUES${values} ${conflict}`,chunk.flat());
 }
 console.log(`  ${label}: ${rows.length.toLocaleString()} rows`);
}

const now=new Date(); const day=(offset:number)=>new Date(now.getTime()+offset*86400000).toISOString();
const lanes=generateLanes();
const client=await db.connect();
try{
 await client.query('BEGIN');
 for(const [id,name,email,role,permissions] of [
  [users.owner,'Navair Owner','owner@demo.example','owner',[]],
  [users.ops,'Aditi · Operations','operations@demo.example','staff',['cases.assigned','shipments.update','commitments.manage']],
  [users.sales,'Arjun · Sales','sales@demo.example','staff',['cases.assigned','commitments.manage']],
  [users.saurabh,'Saurabh Mehta','saurabh@demo.example','customer',[]],
  [users.rishi,'Rishi Jain','rishi@demo.example','customer',[]]
 ])await client.query('INSERT INTO app_users(id,name,email,role,permissions,is_demo) VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(id) DO NOTHING',[id,name,email,role,permissions]);

 await insertBatched(client,'routes','origin,destination,mode,unit,is_public,service_coverage,distance_km,transit_days,cross_border','routes',
  'ON CONFLICT(origin,destination,mode) DO UPDATE SET unit=excluded.unit,is_public=true,service_coverage=excluded.service_coverage,distance_km=excluded.distance_km,transit_days=excluded.transit_days,cross_border=excluded.cross_border',
  lanes.map(lane=>[lane.origin,lane.destination,lane.mode,lane.unit,true,
   flagshipKeys.has(flagshipKey(lane.origin,lane.destination,lane.mode))?'supported':lane.coverage,lane.distanceKm,lane.transitDays,lane.crossBorder]));

 const ids=new Map<string,string>();
 for(const row of (await client.query('SELECT id,origin,destination,mode FROM routes')).rows){
  ids.set(flagshipKey(row.origin,row.destination,row.mode),row.id as string);
 }
 const routeId=(lane:Lane)=>{
  const id=ids.get(flagshipKey(lane.origin,lane.destination,lane.mode));
  if(!id)throw new Error(`Route row missing after insert: ${lane.origin} to ${lane.destination} (${lane.mode})`);
  return id;
 };

 // Synthetic lanes generated before this catalog stay in the database because customer
 // journeys may reference them, but they leave the public picker rather than sit there
 // with no price history behind them.
 const stale=await client.query(
  `UPDATE routes SET is_public=false WHERE is_public AND (origin,destination,mode) NOT IN (${lanes.map((_,index)=>`($${index*3+1},$${index*3+2},$${index*3+3})`).join(',')})`,
  lanes.flatMap(lane=>[lane.origin,lane.destination,lane.mode]));
 if(stale.rowCount)console.log(`  retired ${stale.rowCount} route rows from the previous catalog`);

 // Fixtures from earlier catalogs used the same keys with different dates, so leaving
 // them in place would silently truncate a lane's history to whatever was inserted
 // first. Synthetic demo rows are regenerated deterministically, so clearing the old
 // generation is safe; imported and shipment-derived evidence is left untouched.
 const clearedPrices=await client.query("DELETE FROM price_observations WHERE is_demo AND source_id LIKE 'demo:%' AND source_id NOT LIKE $1",[`${SOURCE_PREFIX}%`]);
 const clearedDeliveries=await client.query("DELETE FROM delivery_evidence WHERE is_demo AND source_id LIKE 'demo:%' AND source_id NOT LIKE $1",[`${SOURCE_PREFIX}%`]);
 if(clearedPrices.rowCount||clearedDeliveries.rowCount){
  console.log(`  cleared previous fixtures: ${clearedPrices.rowCount?.toLocaleString()} price rows, ${clearedDeliveries.rowCount?.toLocaleString()} delivery rows`);
 }

 const priceRows:unknown[][]=[]; const costRows:unknown[][]=[]; const deliveryRows:unknown[][]=[];
 for(const lane of lanes){
  const id=routeId(lane);
  for(const point of priceSeries(lane,PRICE_WEEKS,now)){
   const source=`${SOURCE_PREFIX}${id}:price:${point.week}`;
   priceRows.push([source,id,point.observedAt.toISOString(),point.sellingPrice,'INR',lane.unit,true]);
   // Explicit synthetic cost fixture, never an inferred cost for real records.
   costRows.push([source,point.buyingCost]);
  }
  for(const point of deliverySeries(lane,now)){
   deliveryRows.push([`${SOURCE_PREFIX}${id}:delivery:${point.index}`,id,point.promisedAt.toISOString(),
    point.actualAt?.toISOString()??null,point.observedAt.toISOString(),point.issue,true]);
  }
 }
 await insertBatched(client,'price observations','source_id,route_id,observed_at,selling_price,currency,unit,is_demo','price_observations','ON CONFLICT(source_id) DO NOTHING',priceRows);
 for(let start=0;start<costRows.length;start+=BATCH_ROWS){
  const chunk=costRows.slice(start,start+BATCH_ROWS);
  await client.query(
   `INSERT INTO price_costs(observation_id,buying_cost)
    SELECT p.id,input.cost FROM price_observations p
    JOIN (SELECT * FROM unnest($1::text[],$2::numeric[]) AS t(source,cost)) input ON input.source=p.source_id
    WHERE p.is_demo ON CONFLICT DO NOTHING`,
   [chunk.map(row=>row[0]),chunk.map(row=>row[1])]);
 }
 console.log(`  buying costs: ${costRows.length.toLocaleString()} rows`);
 await insertBatched(client,'delivery evidence','source_id,route_id,promised_at,actual_at,observed_at,issue,is_demo','delivery_evidence','ON CONFLICT(source_id) DO NOTHING',deliveryRows);

 const flagshipLanes=flagships.map(([origin,destination,mode])=>{
  const lane=lanes.find(candidate=>candidate.origin===origin&&candidate.destination===destination&&candidate.mode===mode);
  if(!lane)throw new Error(`Flagship lane missing from the generated catalog: ${origin} to ${destination} (${mode})`);
  return {...lane,id:routeId(lane)};
 });

 const pending='30000000-0000-4000-8000-000000000001', accepted='30000000-0000-4000-8000-000000000002';
 await client.query(`INSERT INTO enquiries(id,reference,customer_id,assigned_to,name,email,origin,destination,mode,description,status,is_demo)
 VALUES($1,'NAV-DEMO-001',$2,$3,'Saurabh Mehta','saurabh@demo.example','Delhi','Dubai','air','I would like help exporting 100 kg of packaged textiles. This is my first shipment.','pending',true) ON CONFLICT(id) DO NOTHING`,[pending,users.saurabh,users.sales]);
 await client.query(`INSERT INTO enquiries(id,reference,customer_id,assigned_to,name,email,origin,destination,mode,description,status,is_demo,accepted_at)
 VALUES($1,'NAV-DEMO-002',$2,$3,'Rishi Jain','rishi@demo.example','Delhi','Dubai','air','Commercial samples, air freight. The price is quoted per kilogram.','accepted',true,now()-interval '2 days') ON CONFLICT(id) DO NOTHING`,[accepted,users.rishi,users.ops]);
 const shipment='40000000-0000-4000-8000-000000000001';
 await client.query("INSERT INTO shipments(id,enquiry_id,route_id,status,promised_at,estimated_at,selling_price,currency,unit,quantity) VALUES($1,$2,$3,'in_transit',$4,$5,150,'INR','kg',100) ON CONFLICT(id) DO NOTHING",[shipment,accepted,flagshipLanes[0].id,day(3),day(5)]);
 await client.query('INSERT INTO shipment_finance(shipment_id,buying_cost) VALUES($1,100) ON CONFLICT DO NOTHING',[shipment]);
 for(const [i,status,description,offset] of [[1,'accepted','Navair accepted your shipment requirements.',-2],[2,'booked','Air freight booking recorded by the operations team.',-1.8],[3,'collected','Cargo collected from the origin.',-1],[4,'in_transit','Cargo is in transit. Estimated arrival updated.',-0.5]] as const){
  await client.query('INSERT INTO shipment_events(id,shipment_id,status,description,occurred_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[`50000000-0000-4000-8000-00000000000${i}`,shipment,status,description,day(offset)]);
 }
 await client.query('INSERT INTO commitments(id,enquiry_id,assigned_to,title,due_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',['60000000-0000-4000-8000-000000000001',accepted,users.ops,'Confirm revised arrival with the customer',day(1)]);
 const additionalJourneys=[
  {enquiry:'30000000-0000-4000-8000-000000000003',shipment:'40000000-0000-4000-8000-000000000002',route:1,reference:'NAV-DEMO-003',status:'customs',promise:4,estimate:4,price:128000,cost:91000,quantity:1,label:'Container shipment is clearing destination customs.',description:'Sea freight container to Jebel Ali.',events:[['accepted','Navair accepted the sea freight requirements.',-5],['booked','Container space was confirmed with the carrier.',-4],['collected','Container was gated in at the origin terminal.',-3],['in_transit','Vessel departed the origin port.',-2],['customs','Container entered destination customs clearance.',-0.5]]},
  {enquiry:'30000000-0000-4000-8000-000000000004',shipment:'40000000-0000-4000-8000-000000000003',route:2,reference:'NAV-DEMO-004',status:'delivered',promise:-1,estimate:-1,price:19500,cost:13200,quantity:4,label:'Four road shipments were delivered ahead of schedule.',description:'Priority road shipments from Delhi to Mumbai.',events:[['accepted','Navair accepted the road shipment requirements.',-7],['booked','A dedicated vehicle was allocated.',-6],['collected','Packages were collected in Delhi.',-5],['in_transit','Vehicle is progressing on the Delhi–Mumbai corridor.',-4],['delivered','All four road shipments were delivered early in Mumbai.',-2]]},
  {enquiry:'30000000-0000-4000-8000-000000000005',shipment:'40000000-0000-4000-8000-000000000004',route:3,reference:'NAV-DEMO-005',status:'in_transit',promise:2,estimate:3,price:960,cost:640,quantity:25,label:'Courier parcel batch is in transit with a minor timing watch.',description:'Express courier samples from Bengaluru to Singapore.',events:[['accepted','Navair accepted the courier shipment requirements.',-3],['booked','Express courier pickup was booked.',-2.5],['collected','Courier collected the parcel batch.',-2],['in_transit','Parcel batch departed Bengaluru for Singapore.',-1]]},
  {enquiry:'30000000-0000-4000-8000-000000000006',shipment:'40000000-0000-4000-8000-000000000005',route:4,reference:'NAV-DEMO-006',status:'in_transit',promise:3,estimate:6,price:190,cost:127,quantity:80,label:'Air route is facing a three-day capacity-related delay.',description:'Air freight samples from Mumbai to Singapore.',events:[['accepted','Navair accepted the air freight requirements.',-4],['booked','Airline capacity was reserved.',-3],['collected','Cargo was collected in Mumbai.',-2],['in_transit','Flight connection was moved due to capacity constraints.',-1]]},
  {enquiry:'30000000-0000-4000-8000-000000000007',shipment:'40000000-0000-4000-8000-000000000006',route:5,reference:'NAV-DEMO-007',status:'delivered',promise:-2,estimate:-3,price:171000,cost:119500,quantity:1,label:'Container arrived one day earlier than the promise date.',description:'Sea freight container from Chennai to Rotterdam.',events:[['accepted','Navair accepted the sea freight requirements.',-18],['booked','Container space was confirmed with the carrier.',-17],['collected','Container was received at Chennai terminal.',-16],['in_transit','Vessel sailed from Chennai.',-14],['delivered','Container was delivered in Rotterdam one day early.',-3]]},
  {enquiry:'30000000-0000-4000-8000-000000000008',shipment:'40000000-0000-4000-8000-000000000007',route:6,reference:'NAV-DEMO-008',status:'collected',promise:2,estimate:2,price:23750,cost:16200,quantity:2,label:'Road route is tracking to its promised delivery date.',description:'Road freight from Bengaluru to Mumbai.',events:[['accepted','Navair accepted the road shipment requirements.',-3],['booked','A dedicated vehicle was allocated.',-2],['collected','Cargo was collected in Bengaluru.',-1]]},
  {enquiry:'30000000-0000-4000-8000-000000000009',shipment:'40000000-0000-4000-8000-000000000008',route:7,reference:'NAV-DEMO-009',status:'delivered',promise:-1,estimate:-1,price:1180,cost:785,quantity:18,label:'Courier deliveries reached London on the expected date.',description:'Courier documents and samples from Ahmedabad to London.',events:[['accepted','Navair accepted the courier shipment requirements.',-6],['booked','Express courier pickup was booked.',-5],['collected','Courier collected the shipment in Ahmedabad.',-4],['in_transit','Parcel batch departed for London.',-3],['delivered','Courier deliveries reached London as forecast.',-1]]}
 ] as const;
 for(const journey of additionalJourneys){
  const route=flagshipLanes[journey.route];
  await client.query('INSERT INTO enquiries(id,reference,customer_id,assigned_to,name,email,origin,destination,mode,description,status,is_demo,accepted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,\'accepted\',true,now()-interval \'3 days\') ON CONFLICT(id) DO NOTHING',[journey.enquiry,journey.reference,users.rishi,users.ops,'Rishi Jain','rishi@demo.example',route.origin,route.destination,route.mode,journey.description]);
  await client.query('INSERT INTO shipments(id,enquiry_id,route_id,status,promised_at,estimated_at,actual_at,selling_price,currency,unit,quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,\'INR\',$9,$10) ON CONFLICT(id) DO NOTHING',[journey.shipment,journey.enquiry,route.id,journey.status,day(journey.promise),day(journey.estimate),journey.status==='delivered'?day(journey.estimate):null,journey.price,route.unit,journey.quantity]);
  await client.query('INSERT INTO shipment_finance(shipment_id,buying_cost) VALUES($1,$2) ON CONFLICT DO NOTHING',[journey.shipment,journey.cost]);
  for(const [eventIndex,event] of journey.events.entries()){
   const [status,description,offset]=event;
   await client.query('INSERT INTO shipment_events(id,shipment_id,status,description,occurred_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[`50000000-0000-4000-${String(journey.route+2).padStart(4,'0')}-${String(eventIndex+1).padStart(12,'0')}`,journey.shipment,status,description,day(offset)]);
  }
 }
 await client.query('COMMIT');
 console.log(`Demo data ready: ${lanes.length.toLocaleString()} public synthetic lanes, ${PRICE_WEEKS} weeks of weekly prices each, recent delivery evidence dense over the last fortnight, and Rishi's customer journeys. Existing records were preserved.`);
}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await db.end();}
