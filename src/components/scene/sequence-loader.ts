import {FrameCache, frameOrder} from './frame-cache';

type Options<T> = {
  count: number; capacity: number; radius: number; concurrency: number;
  load: (index: number, signal: AbortSignal) => Promise<T>;
  onFrame: (frame: T, index: number) => void;
  onError: (index: number) => void;
};

/** Loads only a bounded neighborhood; old promises remain counted until settled. */
export class SequenceLoader<T extends {close(): void}> {
  private cache: FrameCache<T>;
  private pending = new Map<number, AbortController>();
  private errors = new Set<number>();
  private target = 0;
  private last = -1;
  private active = false;
  private disposed = false;
  constructor(private options: Options<T>) { this.cache = new FrameCache(options.capacity); }
  get cacheSize() { return this.cache.entries.size; }
  get pendingCount() { return this.pending.size; }
  get displayed() { return this.last; }
  get requested() { return this.target; }

  seek(frame: number) {
    if (this.disposed) return;
    this.active = true;
    this.target = Math.max(0, Math.min(this.options.count - 1, Math.round(frame)));
    const wanted = new Set(this.order());
    for (const [index, request] of this.pending) if (!wanted.has(index)) request.abort();
    this.render();
    if (this.errors.has(this.target)) this.options.onError(this.target);
    this.pump();
  }
  pause() { this.active = false; for (const request of this.pending.values()) request.abort(); }
  retry() { this.errors.clear(); this.seek(this.target); }
  dispose() { this.disposed = true; this.pause(); this.cache.clear(); }
  private order() {
    // Never request a window larger than the decoded cache: avoids eviction/refetch loops.
    return frameOrder(this.target, this.options.count, this.options.radius).slice(0, this.options.capacity);
  }
  private render() {
    let best = this.last;
    let distance = best < 0 ? Infinity : Math.abs(best - this.target);
    for (const index of this.cache.entries.keys()) {
      const next = Math.abs(index - this.target);
      if (next < distance) { best = index; distance = next; }
    }
    if (best >= 0 && best !== this.last) {
      const frame = this.cache.entries.get(best);
      if (frame) { this.last = best; this.options.onFrame(frame, best); }
    }
  }
  private pump() {
    if (this.disposed || !this.active) return;
    for (const index of this.order()) {
      if (this.pending.size >= this.options.concurrency) break;
      if (this.pending.has(index) || this.cache.entries.has(index) || this.errors.has(index)) continue;
      const request = new AbortController(); this.pending.set(index, request);
      void this.options.load(index, request.signal).then(frame => {
        if (this.disposed || request.signal.aborted) { frame.close(); return; }
        this.cache.put(index, frame, this.target);
        this.render();
      }).catch(() => {
        if (!this.disposed && !request.signal.aborted) {
          this.errors.add(index);
          if (index === this.target) this.options.onError(index);
        }
      }).finally(() => { this.pending.delete(index); this.pump(); });
    }
  }
}
