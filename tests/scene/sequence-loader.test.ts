import {describe,it,expect} from 'vitest';
import {SequenceLoader} from '../../src/components/scene/sequence-loader';
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(){
 const jobs:{index:number;signal:AbortSignal;resolve:(v:{close:()=>void})=>void;reject:(e:Error)=>void}[]=[];
 const drawn:number[]=[],failed:number[]=[];
 const loader=new SequenceLoader<{close:()=>void}>({count:750,capacity:7,radius:3,concurrency:2,
  load:(index,signal)=>new Promise((resolve,reject)=>jobs.push({index,signal,resolve,reject})),
  onFrame:(_,index)=>drawn.push(index),onError:index=>failed.push(index)});
 return {loader,jobs,drawn,failed};
}
describe('full movie frame scheduling',()=>{
 it('prioritizes the destination and bounds concurrent requests',async()=>{
  const f=fixture();f.loader.seek(500);expect(f.jobs.map(j=>j.index)).toEqual([500,501]);
  f.jobs[0].resolve({close(){}});await flush();expect(f.drawn).toEqual([500]);expect(f.loader.pendingCount).toBeLessThanOrEqual(2);f.loader.dispose();
 });
 it('cancels stale work on reverse seeks and releases late decoded frames',async()=>{
  const f=fixture();f.loader.seek(600);f.loader.seek(20);expect(f.jobs[0].signal.aborted).toBe(true);
  let closed=0;f.jobs[0].resolve({close(){closed++;}});f.jobs[1].resolve({close(){closed++;}});await flush();
  expect(closed).toBe(2);expect(f.drawn).toEqual([]);expect(f.jobs[2].index).toBe(20);f.loader.dispose();
 });
 it('retains the displayed frame when the new target fails and allows retry',async()=>{
  const f=fixture();f.loader.seek(0);f.jobs[0].resolve({close(){}});await flush();
  f.loader.seek(740);for(const job of f.jobs.filter(j=>j.signal.aborted))job.reject(Error('aborted'));await flush();
  const target=f.jobs.find(j=>j.index===740)!;target.reject(Error('offline'));await flush();expect(f.failed).toContain(740);expect(f.drawn.at(-1)).toBe(0);
  f.loader.retry();for(const job of f.jobs.filter(j=>j.index!==740&&!j.signal.aborted))job.resolve({close(){}});await flush();
  expect(f.jobs.filter(j=>j.index===740).length).toBe(2);f.loader.dispose();
 });
 it('bounds the decoded cache and does not draw after disposal',async()=>{
  const f=fixture();f.loader.seek(20);
  for(let n=0;n<10;n++){for(const job of [...f.jobs])job.resolve({close(){}});await flush();}
  expect(f.loader.cacheSize).toBeLessThanOrEqual(7);
  f.loader.seek(749);f.loader.dispose();const before=f.drawn.length;let closed=0;for(const job of f.jobs.filter(j=>j.index>740))job.resolve({close(){closed++;}});await flush();
  expect(closed).toBeGreaterThan(0);expect(f.drawn.length).toBe(before);
 });
 it('clamps out-of-range scroll positions to existing endpoint frames',()=>{
  const f=fixture();f.loader.seek(2000);expect(f.jobs[0].index).toBe(749);f.loader.dispose();
 });
});
