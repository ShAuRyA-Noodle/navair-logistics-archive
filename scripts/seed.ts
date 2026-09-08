import { config } from 'dotenv';
import { Pool } from 'pg';
config({ path: '.env.local', quiet: true });
if(process.env.LOCAL_DEMO_MODE!=='true')throw new Error('Demo seed requires LOCAL_DEMO_MODE=true.');
const db=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});
const users={owner:'10000000-0000-4000-8000-000000000001',ops:'10000000-0000-4000-8000-000000000002',sales:'10000000-0000-4000-8000-000000000003',saurabh:'10000000-0000-4000-8000-000000000004',rishi:'10000000-0000-4000-8000-000000000005'};
const routes=[
 {id:'20000000-0000-4000-8000-000000000001',origin:'Delhi',destination:'Dubai',mode:'air',unit:'kg',base:150},
 {id:'20000000-0000-4000-8000-000000000002',origin:'Mumbai',destination:'Jebel Ali',mode:'sea',unit:'container',base:125000},
 {id:'20000000-0000-4000-8000-000000000003',origin:'Delhi',destination:'Mumbai',mode:'road',unit:'shipment',base:18000},
 {id:'20000000-0000-4000-8000-000000000004',origin:'Bengaluru',destination:'Singapore',mode:'courier',unit:'kg',base:900},
 {id:'20000000-0000-4000-8000-000000000005',origin:'Mumbai',destination:'Singapore',mode:'air',unit:'kg',base:175},
 {id:'20000000-0000-4000-8000-000000000006',origin:'Chennai',destination:'Rotterdam',mode:'sea',unit:'container',base:168000},
 {id:'20000000-0000-4000-8000-000000000007',origin:'Bengaluru',destination:'Mumbai',mode:'road',unit:'shipment',base:22500},
 {id:'20000000-0000-4000-8000-000000000008',origin:'Ahmedabad',destination:'London',mode:'courier',unit:'kg',base:1125}
];
const now=new Date(); const day=(offset:number)=>new Date(now.getTime()+offset*86400000).toISOString();
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
 for(const route of routes){
  await client.query('INSERT INTO routes(id,origin,destination,mode,unit,is_public) VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(origin,destination,mode) DO UPDATE SET unit=excluded.unit,is_public=true',[route.id,route.origin,route.destination,route.mode,route.unit]);
  route.id=(await client.query('SELECT id FROM routes WHERE origin=$1 AND destination=$2 AND mode=$3',[route.origin,route.destination,route.mode])).rows[0].id;
  for(let week=0;week<40;week++){
   const price=Math.round(route.base*(0.85+week*0.004+Math.sin(week*1.7)*0.018)*100)/100;
   await client.query('INSERT INTO price_observations(source_id,route_id,observed_at,selling_price,currency,unit,is_demo) VALUES($1,$2,$3,$4,$5,$6,true) ON CONFLICT(source_id) DO NOTHING',[`demo:${route.id}:price:${week}`,route.id,day(-(39-week)*7-1),price,'INR',route.unit]);
   // Explicit synthetic cost fixture, never an inferred cost for real records.
   await client.query('INSERT INTO price_costs(observation_id,buying_cost) SELECT id,$2 FROM price_observations WHERE source_id=$1 AND is_demo ON CONFLICT DO NOTHING',[`demo:${route.id}:price:${week}`,Math.round(price*2/3*100)/100]);
  }
  for(let i=0;i<12;i++){
   const delay=route.id.endsWith('001')||route.id.endsWith('005')?(i<8?2+i%3:0):route.id.endsWith('002')||route.id.endsWith('006')?(i<5?-1:0):route.id.endsWith('003')||route.id.endsWith('007')?(i<2?1:0):route.id.endsWith('004')?(i%4===0?1:0):(i<3?1:0);
   const promise=-20+i;
   await client.query('INSERT INTO delivery_evidence(source_id,route_id,promised_at,actual_at,observed_at,issue,is_demo) VALUES($1,$2,$3,$4,$5,$6,true) ON CONFLICT(source_id) DO NOTHING',[`demo:${route.id}:delivery:${i}`,route.id,day(promise),day(promise+delay),day(promise+delay),delay>0?'capacity':null]);
  }
 }
 const pending='30000000-0000-4000-8000-000000000001', accepted='30000000-0000-4000-8000-000000000002';
 await client.query(`INSERT INTO enquiries(id,reference,customer_id,assigned_to,name,email,origin,destination,mode,description,status,is_demo)
 VALUES($1,'NAV-DEMO-001',$2,$3,'Saurabh Mehta','saurabh@demo.example','Delhi','Dubai','air','I would like help exporting 100 kg of packaged textiles. This is my first shipment.','pending',true) ON CONFLICT(id) DO NOTHING`,[pending,users.saurabh,users.sales]);
 await client.query(`INSERT INTO enquiries(id,reference,customer_id,assigned_to,name,email,origin,destination,mode,description,status,is_demo,accepted_at)
 VALUES($1,'NAV-DEMO-002',$2,$3,'Rishi Jain','rishi@demo.example','Delhi','Dubai','air','Commercial samples, air freight. The price is quoted per kilogram.','accepted',true,now()-interval '2 days') ON CONFLICT(id) DO NOTHING`,[accepted,users.rishi,users.ops]);
 const shipment='40000000-0000-4000-8000-000000000001';
 await client.query("INSERT INTO shipments(id,enquiry_id,route_id,status,promised_at,estimated_at,selling_price,currency,unit,quantity) VALUES($1,$2,$3,'in_transit',$4,$5,150,'INR','kg',100) ON CONFLICT(id) DO NOTHING",[shipment,accepted,routes[0].id,day(3),day(5)]);
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
  const route=routes[journey.route];
  await client.query('INSERT INTO enquiries(id,reference,customer_id,assigned_to,name,email,origin,destination,mode,description,status,is_demo,accepted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,\'accepted\',true,now()-interval \'3 days\') ON CONFLICT(id) DO NOTHING',[journey.enquiry,journey.reference,users.rishi,users.ops,'Rishi Jain','rishi@demo.example',route.origin,route.destination,route.mode,journey.description]);
  await client.query('INSERT INTO shipments(id,enquiry_id,route_id,status,promised_at,estimated_at,actual_at,selling_price,currency,unit,quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,\'INR\',$9,$10) ON CONFLICT(id) DO NOTHING',[journey.shipment,journey.enquiry,route.id,journey.status,day(journey.promise),day(journey.estimate),journey.status==='delivered'?day(journey.estimate):null,journey.price,route.unit,journey.quantity]);
  await client.query('INSERT INTO shipment_finance(shipment_id,buying_cost) VALUES($1,$2) ON CONFLICT DO NOTHING',[journey.shipment,journey.cost]);
  for(const [eventIndex,event] of journey.events.entries()){
   const [status,description,offset]=event;
   await client.query('INSERT INTO shipment_events(id,shipment_id,status,description,occurred_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[`50000000-0000-4000-${String(journey.route+2).padStart(4,'0')}-${String(eventIndex+1).padStart(12,'0')}`,journey.shipment,status,description,day(offset)]);
  }
 }
 await client.query('COMMIT');console.log('Demo profiles, eight routes, 40-week synthetic price histories, and Rishi customer journeys are ready. Existing records were preserved.');
}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await db.end();}
