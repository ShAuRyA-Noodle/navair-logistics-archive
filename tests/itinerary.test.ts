import {describe,it,expect} from 'vitest';
import {planRoute,type GraphLane} from '../src/lib/itinerary';

let counter=0;
const lane=(origin:string,destination:string,mode:string,transitDays:number|null,coverage:GraphLane['serviceCoverage']='supported',unit='kg'):GraphLane=>({
 id:`00000000-0000-4000-8000-${String(counter+=1).padStart(12,'0')}`,
 origin,destination,mode,unit,serviceCoverage:coverage,distanceKm:transitDays===null?null:transitDays*300,transitDays,crossBorder:false,
});

const graph:GraphLane[]=[
 lane('Jaipur','Mumbai','road',3),
 lane('Jaipur','Delhi','road',1),
 lane('Delhi','Bangkok','air',2),
 lane('Mumbai','Bangkok','sea',9,'supported','container'),
 lane('Mumbai','Delhi','road',3),
 lane('Delhi','Kabul','road',4,'not_supported'),
 lane('Kabul','Bangkok','air',3),
 lane('Surat','Mumbai','road',1,'on_request'),
];

describe('planRoute',()=>{
 it('returns direct services fastest-first when the lane exists',()=>{
  const plan=planRoute([...graph,lane('Jaipur','Bangkok','courier',5),lane('Jaipur','Bangkok','air',2)],{origin:'Jaipur',destination:'Bangkok'});
  expect(plan.outcome).toBe('direct');
  expect(plan.direct.map((leg)=>leg.mode)).toEqual(['air','courier']);
 });

 it('stitches a connecting itinerary when no direct lane exists',()=>{
  const plan=planRoute(graph,{origin:'Jaipur',destination:'Bangkok'});
  expect(plan.outcome).toBe('connecting');
  expect(plan.direct).toEqual([]);
  const best=plan.connecting[0];
  expect(best.legs.map((leg)=>leg.destination)).toEqual(['Delhi','Bangkok']);
  expect(best.transitDays).toBe(3);
  expect(best.handoverDays).toBe(1);
  expect(best.totalDays).toBe(4);
  expect(best.summary).toContain('Jaipur → Delhi → Bangkok');
  expect(best.summary).toContain('about 4 days');
 });

 it('never routes through a lane declared not supported',()=>{
  const plan=planRoute(graph,{origin:'Jaipur',destination:'Bangkok'});
  const cities=plan.connecting.flatMap((itinerary)=>itinerary.legs.map((leg)=>leg.destination));
  expect(cities).not.toContain('Kabul');
 });

 it('flags an itinerary that needs a desk check without hiding it',()=>{
  const plan=planRoute(graph,{origin:'Surat',destination:'Bangkok'});
  expect(plan.outcome).toBe('connecting');
  expect(plan.connecting[0].needsDeskCheck).toBe(true);
 });

 it('does not revisit a city inside one itinerary',()=>{
  const plan=planRoute(graph,{origin:'Jaipur',destination:'Bangkok'});
  for(const itinerary of plan.connecting){
   const visited=[itinerary.legs[0].origin,...itinerary.legs.map((leg)=>leg.destination)];
   expect(new Set(visited).size).toBe(visited.length);
  }
 });

 it('reports unknown cities separately and offers the served list',()=>{
  expect(planRoute(graph,{origin:'Atlantis',destination:'Bangkok'}).outcome).toBe('unknown_origin');
  expect(planRoute(graph,{origin:'Jaipur',destination:'Atlantis'}).outcome).toBe('unknown_destination');
  const both=planRoute(graph,{origin:'Atlantis',destination:'El Dorado'});
  expect(both.outcome).toBe('unknown_both');
  expect(both.cities.origins).toContain('Jaipur');
 });

 it('rejects a same-city request rather than planning a loop',()=>{
  const plan=planRoute(graph,{origin:'Mumbai',destination:' mumbai '},);
  expect(plan.outcome).toBe('same_city');
  expect(plan.connecting).toEqual([]);
 });

 it('reports no service when nothing connects within the leg limit',()=>{
  const plan=planRoute([lane('Jaipur','Delhi','road',1),lane('Chennai','Colombo','sea',4)],{origin:'Jaipur',destination:'Colombo'});
  expect(plan.outcome).toBe('no_service');
  expect(plan.connecting).toEqual([]);
 });

 it('matches city names regardless of case and spacing',()=>{
  const plan=planRoute([...graph,lane('Nhava Sheva','Colombo','sea',5,'supported','container')],{origin:'  nhava   sheva ',destination:'COLOMBO'});
  expect(plan.outcome).toBe('direct');
  expect(plan.origin).toBe('Nhava Sheva');
 });

 it('leaves transit time unstated rather than inventing one',()=>{
  const plan=planRoute([lane('Jaipur','Delhi','road',null),lane('Delhi','Bangkok','air',2)],{origin:'Jaipur',destination:'Bangkok'});
  expect(plan.outcome).toBe('connecting');
  expect(plan.connecting[0].transitDays).toBeNull();
  expect(plan.connecting[0].totalDays).toBeNull();
  expect(plan.connecting[0].summary).toContain('transit time not stated');
 });

 it('keeps at most three itineraries and at most three legs each',()=>{
  const dense=['A','B','C','D','E','F'].flatMap((city,index,all)=>all.slice(index+1).map((other)=>lane(city,other,'road',index+1)));
  const plan=planRoute(dense,{origin:'A',destination:'F'});
  expect(plan.connecting.length).toBeLessThanOrEqual(3);
  for(const itinerary of plan.connecting)expect(itinerary.legs.length).toBeLessThanOrEqual(3);
 });
});
