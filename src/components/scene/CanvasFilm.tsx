'use client';

import {useEffect, useRef, useState} from 'react';
import {SequenceLoader} from './sequence-loader';
import {filmReadiness} from './film-readiness';
import styles from '../scene-one.module.css';

type Manifest = {
  count: number; fps: number; duration: number;
  chapters: {time: number; label: string; title: string}[];
  variants: Record<'mobile'|'desktop', {path: string; width: number; height: number; bytes: number}>;
};

export default function CanvasFilm() {
  const root = useRef<HTMLElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const progress = useRef(0), enable = useRef<(() => void) | null>(null);
  const seek = useRef<((progress: number) => void) | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [frame, setFrame] = useState(-1);
  const [status, setStatus] = useState<'idle'|'loading'|'ready'|'error'>('idle');

  useEffect(() => {
    const element = root.current!, surface = canvas.current!;
    const ctx = surface.getContext('2d', {alpha: false});
    if (!ctx) { setStatus('error'); filmReadiness.set('error'); return; }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const small = matchMedia('(max-width: 900px)').matches;
    const request = new AbortController();
    let disposed = false, nearby = false, permitted = !reduced.matches;
    let details: Manifest | null = null, loader: SequenceLoader<ImageBitmap> | null = null;
    let killTrigger: (() => void) | undefined, loadingManifest = false;
    let started = 0, draws = 0;
    const metadataUrl = '/frames/movie-0-v4/manifest.json';
    const update = (p: number) => {
      progress.current = Math.max(0, Math.min(1, p));
      if (!loader || !details || !nearby || !permitted || document.hidden) return;
      const target = Math.round(progress.current * (details.count - 1));
      if (target !== loader.requested) started = performance.now();
      element.dataset.target = String(target);
      loader.seek(target);
      element.dataset.cache = String(loader.cacheSize);
      element.dataset.pending = String(loader.pendingCount);
    };
    const load = async () => {
      if (disposed || loadingManifest || loader) return;
      loadingManifest = true; setStatus('loading'); filmReadiness.set('loading');
      try {
        const response = await fetch(metadataUrl, {signal: request.signal});
        if (!response.ok) throw Error('Frame metadata unavailable');
        const result = await response.json() as Manifest;
        if (!Number.isInteger(result.count) || result.count < 1 || !result.variants?.mobile || !result.variants?.desktop || !Array.isArray(result.chapters)) throw Error('Invalid frame metadata');
        if (disposed) return;
        details = result; setManifest(result);
        const variant = result.variants[small ? 'mobile' : 'desktop'];
        surface.width = variant.width; surface.height = variant.height;
        const capacity = small ? 16 : 8;
        element.dataset.capacity = String(capacity);
        element.dataset.decodedBudget = String(capacity * variant.width * variant.height * 4);
        loader = new SequenceLoader({count: result.count, capacity, radius: small ? 6 : 3, concurrency: 4,
          load: async (index, signal) => {
            const response = await fetch(`${variant.path}/${String(index).padStart(4, '0')}.webp`, {signal, cache: 'force-cache'});
            if (!response.ok) throw Error('Frame unavailable');
            const blob = await response.blob();
            if (signal.aborted) throw Error('Frame cancelled');
            return createImageBitmap(blob);
          },
          onFrame: (bitmap, index) => {
            if (disposed) return;
            const drawStart = performance.now();
            ctx.drawImage(bitmap, 0, 0, surface.width, surface.height);
            element.dataset.drawMs = (performance.now() - drawStart).toFixed(2);
            element.dataset.frame = String(index); element.dataset.draws = String(++draws);
            if (index === loader?.requested) element.dataset.targetLatency = (performance.now() - started).toFixed(1);
            setFrame(index); setStatus('ready'); filmReadiness.set('ready');
          },
          onError: () => { if (!disposed) { setStatus('error'); filmReadiness.set('error'); } },
        });
        started = performance.now();
        if (permitted && !document.hidden) loader.seek(Math.round(progress.current * (result.count - 1)));
        update(progress.current);
      } catch { if (!disposed) {setStatus('error'); filmReadiness.set('error');} }
      finally { loadingManifest = false; }
    };
    enable.current = () => {
      permitted = true; nearby = true;
      if (loader) { setStatus('loading'); loader.retry(); update(progress.current); }
      else void load();
    };
    seek.current = p => { permitted = true; nearby = true; update(p); if (!loader) void load(); };
    const observer = new IntersectionObserver(entries => {
      nearby = entries.some(e => e.isIntersecting);
      if (nearby && permitted) { if (loader) update(progress.current); else void load(); }
      else if (draws > 0) loader?.pause();
    }, {rootMargin: '100% 0px'});
    observer.observe(element);
    // Warm the opening frame neighborhood at page entry; never fetch the full sequence.
    if (permitted) { nearby = true; void load(); }
    const visibility = () => { if (document.hidden) loader?.pause(); else update(progress.current); };
    document.addEventListener('visibilitychange', visibility);
    void Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([{gsap}, {ScrollTrigger}]) => {
      if (disposed) return;
      gsap.registerPlugin(ScrollTrigger);
      const trigger = ScrollTrigger.create({trigger: element, start: 'top top', end: 'bottom bottom',
        onUpdate: self => { if (!reduced.matches) update(self.progress); },
        onRefresh: self => { if (!reduced.matches) update(self.progress); },
      });
      killTrigger = () => trigger.kill();
      if (!reduced.matches) update(trigger.progress);
    }).catch(() => { if (!disposed) setStatus('error'); });
    return () => {
      disposed = true; observer.disconnect(); request.abort(); loader?.dispose(); killTrigger?.();
      document.removeEventListener('visibilitychange', visibility); enable.current = null; seek.current = null;
    };
  }, []);

  const ratio = manifest && frame >= 0 ? frame / (manifest.count - 1) : 0;
  const time = frame >= 0 ? frame / (manifest?.fps ?? 24) : 0;
  const chapter = manifest?.chapters.filter(ch => ch.time <= time).at(-1);
  return <section ref={root} id="services" className={styles.scene} data-player="canvas" data-frame="-1" aria-label="Navair full movie canvas test">
    <div className={styles.stage}>
      <div className={styles.film}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.poster} src="/video/navair-film-poster.jpg" alt="Navair cargo aircraft ready for departure" />
        <canvas ref={canvas} className={styles.video} data-ready={frame >= 0} aria-label="Aircraft departure, package descent and ship arrival" />
      </div>
      <div className={styles.controls} data-lenis-prevent>
        <a className={styles.comparisonLink} href="/#services">Compare video player ↗</a>
        {status === 'idle' && <button className={styles.retry} onClick={() => enable.current?.()}>Load canvas film</button>}
        {status === 'loading' && <span className={styles.status} role="status">Preparing frames…</span>}
        {status === 'error' && <button className={styles.retry} onClick={() => enable.current?.()}>Frame unavailable · Retry</button>}
      </div>
      <div className={styles.timeline}>
        <span className={styles.chapter} aria-live="polite">{chapter?.label ?? 'CANVAS FILM TEST'}</span>
        <span className={styles.title}>{chapter?.title ?? 'From runway to the world'}</span>
        <div className={styles.track} aria-hidden="true"><i style={{transform: `scaleX(${ratio})`}} /></div>
        <span className={styles.percent}>{Math.round(ratio * 100)}%</span>
        <label className={styles.frameControl}>Explore film
          <input type="range" min="0" max="1000" value={Math.round(ratio * 1000)} onChange={e => seek.current?.(Number(e.target.value) / 1000)} aria-label="Film position" data-lenis-prevent />
        </label>
      </div>
    </div>
  </section>;
}
