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
 {id:'20000000-0000-4000-8000-000000000004',origin:'Bengaluru',destination:'Singapore',mode:'courier',unit:'kg',base:900}
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
   const delay=route.mode==='air'?(i<8?2+i%3:0):route.mode==='sea'?(i<5?-1:0):i<2?1:0;
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
 await client.query('COMMIT');console.log('Demo profiles, four routes, synthetic price history and two customer journeys are ready. Existing records were preserved.');
}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await db.end();}
