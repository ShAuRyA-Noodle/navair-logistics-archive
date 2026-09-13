import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FrameCache,frameOrder} from '../../src/components/scene/frame-cache';
test('frame requests prioritize destination and never leave bounds',()=>{
 assert.deepEqual(frameOrder(0,362,2),[0,1,2]);assert.deepEqual(frameOrder(361,362,2),[361,360,359]);
 assert.equal(frameOrder(179,362)[0],179);
});
test('cache caps decoded memory and disposes frames furthest from destination',()=>{
 const closed:number[]=[];const cache=new FrameCache<{close():void}>(2);
 for(const i of [0,1,2])cache.put(i,{close:()=>closed.push(i)},2);
 assert.equal(cache.entries.size,2);assert.deepEqual(closed,[0]);cache.clear();assert.deepEqual(closed,[0,1,2]);assert.equal(cache.entries.size,0);
});
