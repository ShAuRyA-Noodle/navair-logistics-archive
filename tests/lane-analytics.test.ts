import {describe,it,expect} from 'vitest';
import {forecastLane,summarizeReliability,type DeliveryDay,type WeeklyPrice} from '../src/lib/lane-analytics';

const MS_PER_DAY=86400000;
const now=new Date('2026-09-09T00:00:00.000Z');
const weekStart=(weeksAgo:number)=>new Date(now.getTime()-weeksAgo*7*MS_PER_DAY).toISOString().slice(0,10);

function series(weeks:number,price:(week:number,date:Date)=>number):WeeklyPrice[]{
 return Array.from({length:weeks},(_,index)=>{
  const date=new Date(now.getTime()-(weeks-1-index)*7*MS_PER_DAY);
  return {weekStart:date.toISOString().slice(0,10),price:price(index,date),samples:1};
 });
}

describe('forecastLane',()=>{
 it('refuses to forecast a lane with too little history instead of guessing',()=>{
  const result=forecastLane(series(9,()=>120),{unit:'kg',currency:'INR',weeks:4,confidence:80,now});
  expect(result.status).toBe('insufficient_data');
  expect(result.points).toEqual([]);
  expect(result.model).toBeNull();
  expect(result.reason).toContain('at least 16');
 });

 it('refuses to forecast when the newest price is stale',()=>{
  const stale=series(40,(week)=>120+week).map((point)=>({...point,weekStart:new Date(new Date(point.weekStart).getTime()-40*MS_PER_DAY).toISOString().slice(0,10)}));
  const result=forecastLane(stale,{unit:'kg',currency:'INR',weeks:4,confidence:80,now});
  expect(result.status).toBe('insufficient_data');
  expect(result.reason).toContain('older than 14 days');
 });

 it('projects a rising trend forward and keeps the confidence band around the estimate',()=>{
  const result=forecastLane(series(40,(week)=>100+week*0.5),{unit:'kg',currency:'INR',weeks:4,confidence:80,now});
  expect(result.status).toBe('available');
  expect(result.points).toHaveLength(4);
  expect(result.points[3].estimate).toBeGreaterThan(result.points[0].estimate);
  expect(result.changePercent).toBeGreaterThan(0);
  for(const point of result.points){
   expect(point.lower).toBeLessThanOrEqual(point.estimate);
   expect(point.upper).toBeGreaterThanOrEqual(point.estimate);
  }
 });

 it('picks the seasonal model only when it beats a plain trend in the backtest',()=>{
  const seasonal=forecastLane(series(78,(week,date)=>{
   const month=date.getUTCMonth()+1;
   return 120*(1+0.09*Math.exp(-((month-10.6)**2)/0.9))+week*0.05;
  }),{unit:'kg',currency:'INR',weeks:4,confidence:80,now});
  expect(seasonal.status).toBe('available');
  expect(seasonal.model).toBe('seasonal');
  expect(seasonal.metrics.seasonalMae).toBeLessThan(seasonal.metrics.trendMae!);
  expect(seasonal.seasonalNote).toContain('repeating yearly pattern');

  const straight=forecastLane(series(78,(week)=>100+week*0.4),{unit:'kg',currency:'INR',weeks:4,confidence:80,now});
  expect(straight.model).toBe('trend');
  expect(straight.seasonalNote).toContain('No repeating yearly pattern');
 });

 it('widens the band for 95% confidence and never projects a negative price',()=>{
  const noisy=series(60,(week)=>Math.max(1,40-week*0.6+(week%5)*6));
  const eighty=forecastLane(noisy,{unit:'kg',currency:'INR',weeks:8,confidence:80,now});
  const ninetyFive=forecastLane(noisy,{unit:'kg',currency:'INR',weeks:8,confidence:95,now});
  expect(ninetyFive.points[0].upper-ninetyFive.points[0].lower).toBeGreaterThanOrEqual(eighty.points[0].upper-eighty.points[0].lower);
  for(const point of ninetyFive.points)expect(point.lower).toBeGreaterThanOrEqual(0);
 });

 it('rejects an out-of-range horizon or confidence rather than silently clamping',()=>{
  expect(()=>forecastLane(series(40,()=>100),{unit:'kg',currency:'INR',weeks:9,confidence:80,now})).toThrow(RangeError);
  expect(()=>forecastLane(series(40,()=>100),{unit:'kg',currency:'INR',weeks:4,confidence:90 as 80,now})).toThrow(RangeError);
 });

 it('ignores unusable rows and future-dated weeks',()=>{
  const polluted:WeeklyPrice[]=[
   ...series(40,(week)=>110+week*0.3),
   {weekStart:'not-a-date',price:999,samples:1},
   {weekStart:new Date(now.getTime()+14*MS_PER_DAY).toISOString().slice(0,10),price:9999,samples:1},
   {weekStart:weekStart(3),price:Number.NaN,samples:1},
  ];
  const result=forecastLane(polluted,{unit:'kg',currency:'INR',weeks:4,confidence:80,now});
  expect(result.status).toBe('available');
  expect(result.metrics.historyWeeks).toBe(40);
  expect(result.points.every((point)=>point.estimate<500)).toBe(true);
 });
});

describe('summarizeReliability',()=>{
 const day=(daysAgo:number,fields:Partial<DeliveryDay>={}):DeliveryDay=>({
  promisedOn:new Date(now.getTime()-daysAgo*MS_PER_DAY).toISOString().slice(0,10),
  deliveries:1,late:0,early:0,unresolved:0,delayDays:0,issues:[],...fields,
 });

 it('says so plainly when there is no delivery record at all',()=>{
  const result=summarizeReliability([],{now});
  expect(result.status).toBe('insufficient_data');
  expect(result.headline).toBe('No delivery record yet');
  expect(result.recent.deliveries).toBe(0);
 });

 it('weights the last seven days over the longer baseline',()=>{
  const days=[
   ...Array.from({length:12},(_,index)=>day(20+index*5)),
   ...Array.from({length:5},(_,index)=>day(index+1,{late:1,delayDays:2,issues:['carrier capacity']})),
   day(6),day(7),
  ];
  const result=summarizeReliability(days,{now});
  expect(result.recent.deliveries).toBe(7);
  expect(result.recent.late).toBe(5);
  expect(result.recent.typicalDelayDays).toBe(2);
  expect(result.status).toBe('elevated');
  expect(result.headline).toBe('Running late right now');
  expect(result.detail).toContain('5 of the last 7 deliveries were late');
  expect(result.worseThanUsual).toBe(true);
  expect(result.issues).toEqual(['carrier capacity']);
  expect(result.recentDays).toHaveLength(7);
 });

 it('does not cry wolf when a lane is simply always a bit late',()=>{
  const days=[
   ...Array.from({length:20},(_,index)=>day(10+index*4,{late:index%2,delayDays:index%2?1:0})),
   ...Array.from({length:6},(_,index)=>day(index+1,{late:index<3?1:0,delayDays:index<3?1:0})),
  ];
  const result=summarizeReliability(days,{now});
  expect(result.recent.late).toBe(3);
  expect(result.worseThanUsual).toBe(false);
 });

 it('treats an overdue shipment with no arrival as elevated',()=>{
  const result=summarizeReliability([day(2,{unresolved:1,delayDays:null}),day(3),day(40)],{now});
  expect(result.status).toBe('elevated');
 });

 it('reports a clean week as clear and still states the longer-run rate',()=>{
  const result=summarizeReliability([
   ...Array.from({length:10},(_,index)=>day(15+index*5,{late:index<2?1:0,delayDays:index<2?1:0})),
   day(1),day(3),day(5),
  ],{now});
  expect(result.status).toBe('clear');
  expect(result.headline).toBe('On time this week');
  expect(result.baseline.lateRate).toBeGreaterThan(0);
  expect(result.detail).toContain('Over the last 90 days');
 });

 it('never leaks an identifier from the aggregate rows it is given',()=>{
  const result=summarizeReliability([day(1,{late:1,delayDays:3,issues:['customs hold']})],{now});
  expect(JSON.stringify(result)).not.toMatch(/source_id|shipment:|uuid|@/);
 });
});
