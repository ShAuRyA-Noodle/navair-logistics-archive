/** Small decoded cache; eviction explicitly releases GPU-backed ImageBitmaps. */
export class FrameCache<T extends {close(): void}> {
  readonly entries = new Map<number,T>();
  constructor(readonly capacity: number) {}
  put(index: number, frame: T, target: number) {
    this.entries.get(index)?.close(); this.entries.set(index,frame);
    while(this.entries.size > this.capacity) {
      let farthest = index, distance = -1;
      for(const key of this.entries.keys()) if(Math.abs(key-target)>distance) {farthest=key;distance=Math.abs(key-target);}
      this.entries.get(farthest)?.close();this.entries.delete(farthest);
    }
  }
  clear(){for(const item of this.entries.values())item.close();this.entries.clear();}
}
export function frameOrder(target:number,count:number,radius=8){
  const centre=Math.max(0,Math.min(count-1,Math.round(target)));
  const result=[centre];
  for(let i=1;i<=radius;i++){if(centre+i<count)result.push(centre+i);if(centre-i>=0)result.push(centre-i);}
  return result;
}
