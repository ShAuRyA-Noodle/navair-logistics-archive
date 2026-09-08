import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:3000';
async function request(path:string,method='GET',body?:unknown,cookie='',extra:Record<string,string>={}){
 const response=await fetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]??''};
}
const profiles=await request('/api/auth/demo');assert.equal(profiles.status,200);
const owner=profiles.data.users.find((u:{email:string})=>u.email==='owner@demo.example');assert.ok(owner);
const signedOwner=await request('/api/auth/demo','POST',{userId:owner.id});assert.equal(signedOwner.status,200);
const ownerCookie=signedOwner.cookie;
const tag=randomUUID().slice(0,8),email=`walkthrough-${tag}@demo.example`;
const details={enquiry:{name:'Local Walkthrough',email,phone:'',origin:'Delhi',destination:'Dubai',mode:'air',description:'100 kg of textile samples for the local test.'},website:''};
const key=randomUUID();const created=await request('/api/enquiries','POST',details,'',{'Idempotency-Key':key});assert.equal(created.status,201);
const duplicate=await request('/api/enquiries','POST',details,'',{'Idempotency-Key':key});assert.equal(duplicate.data.id,created.data.id);
const freshProfiles=await request('/api/auth/demo');const customer=freshProfiles.data.users.find((u:{email:string})=>u.email===email);
const signedCustomer=await request('/api/auth/demo','POST',{userId:customer.id});assert.equal(signedCustomer.status,200);
const cookie=signedCustomer.cookie,id=created.data.id;
assert.equal((await request(`/api/enquiries/${id}/forecast`,'GET',undefined,cookie)).status,403);
assert.equal((await request('/api/team','GET',undefined,cookie)).status,403);
const accepted=await request(`/api/enquiries/${id}/accept`,'POST',{sellingPrice:150,buyingCost:100,currency:'INR',unit:'kg',quantity:100,promisedAt:new Date(Date.now()+86400000*3).toISOString(),version:1},ownerCookie);assert.equal(accepted.status,201);
const journey=await request(`/api/enquiries/${id}/journey`,'GET',undefined,cookie);assert.equal(journey.status,200);assert.equal(journey.data.shipment.sellingPrice,150);assert.doesNotMatch(JSON.stringify(journey.data),/buying|margin|profit/i);
assert.equal((await request(`/api/enquiries/${id}/finance`,'GET',undefined,cookie)).status,403);
const forecast80=await request(`/api/enquiries/${id}/forecast?weeks=8&confidence=80`,'GET',undefined,cookie);assert.equal(forecast80.status,200);assert.equal(forecast80.data.status,'available');assert.equal(forecast80.data.isDemo,true);
const forecast95=await request(`/api/enquiries/${id}/forecast?weeks=8&confidence=95`,'GET',undefined,cookie);assert.equal(forecast95.data.points[0].estimate,forecast80.data.points[0].estimate);assert.ok(forecast95.data.points[0].upper>=forecast80.data.points[0].upper);
const radar=await request(`/api/enquiries/${id}/radar`,'GET',undefined,cookie);assert.equal(radar.status,200);assert.equal(radar.data.isDemo,true);
const rishi=freshProfiles.data.users.find((u:{email:string})=>u.email==='rishi@demo.example');const rishiSession=await request('/api/auth/demo','POST',{userId:rishi.id});
assert.equal((await request(`/api/enquiries/${id}/journey`,'GET',undefined,rishiSession.cookie)).status,404);
for(const status of ['booked','collected','in_transit','delivered']){
 const current=await request(`/api/enquiries/${id}/journey`,'GET',undefined,ownerCookie);
 const result=await request(`/api/shipments/${current.data.shipment.id}`,'PATCH',{status,note:`Local walkthrough: ${status}`,version:current.data.shipment.version,...(status==='delivered'?{actualAt:new Date().toISOString()}:{})},ownerCookie);assert.equal(result.status,200);
}
const final=await request(`/api/enquiries/${id}/journey`,'GET',undefined,cookie);assert.equal(final.data.shipment.status,'delivered');assert.ok(final.data.shipment.actualAt);assert.equal(final.data.shipment.promisedAt,journey.data.shipment.promisedAt);
for(let i=0;i<10;i++){const r=await request('/api/mail/process','POST',undefined,ownerCookie);assert.equal(r.status,200);}
const mail=await request('/api/mail','GET',undefined,ownerCookie);assert.equal(mail.status,200);
assert.ok(mail.data.messages.some((m:{recipient:string;kind:string;status:string})=>m.recipient===email&&m.kind==='acknowledgment'&&m.status==='preview'));
const csrf=await request('/api/enquiries','POST',details,'',{'Idempotency-Key':randomUUID(),Origin:'https://untrusted.example'});assert.equal(csrf.status,403);
await request('/api/auth/logout','POST',{},cookie);assert.equal((await request('/api/enquiries','GET',undefined,cookie)).status,401);
console.log('PASS: HTTP enquiry → acceptance → customer pricing/forecast → delivery → preview mail, ownership denial, CSRF rejection and logout.');
console.log(`Walkthrough reference: ${created.data.reference}. All records are labelled demo data.`);
