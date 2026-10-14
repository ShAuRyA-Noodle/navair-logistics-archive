/**
 * One smooth-scroll runtime for the whole page.
 *
 * The globe hero and the Navair sequence both need Lenis + ScrollTrigger. Two
 * Lenis instances fight over window.scrollTo every frame, so both consume this
 * module instead. It is:
 *  - ref-counted: the first acquire creates Lenis, the last release destroys it;
 *    each handle releases at most once, so React strict-mode double effects and
 *    HMR re-runs cannot unbalance the count;
 *  - driven by a single gsap.ticker callback (one rAF for Lenis, GSAP and every
 *    ScrollTrigger scrub);
 *  - reduced-motion aware: with `prefers-reduced-motion: reduce` there is no
 *    Lenis (native scroll), ScrollTrigger still works;
 *  - HMR-safe: state lives on globalThis so a re-evaluated module finds the
 *    instance the previous copy created instead of stacking a second one.
 *
 * Layout settles late (fonts, loaders, lazily mounted sections), so the module
 * also owns ScrollTrigger refresh scheduling: callers ask with requestRefresh()
 * and one debounced refresh runs after layout is stable.
 */

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

type State = {
  lenis: Lenis | null;
  refs: number;
  raf: ((time: number) => void) | null;
  media: MediaQueryList | null;
  onMedia: (() => void) | null;
  observer: ResizeObserver | null;
  lastHeight: number;
  refreshTimer: number;
};

const KEY = '__navairSmoothScroll';

function state(): State {
  const g = globalThis as unknown as Record<string, State | undefined>;
  return (g[KEY] ??= { lenis: null, refs: 0, raf: null, media: null, onMedia: null, observer: null, lastHeight: 0, refreshTimer: 0 });
}

function createLenis(s: State) {
  if (s.lenis) return;
  const lenis = new Lenis({
    lerp: 0.085,
    wheelMultiplier: 0.95,
    touchMultiplier: 1.5,
    smoothWheel: true,
    syncTouch: false,
    anchors: true,
  });
  lenis.on('scroll', ScrollTrigger.update);
  s.lenis = lenis;
  s.raf = (time: number) => lenis.raf(time * 1000);
  gsap.ticker.add(s.raf);
  document.documentElement.dataset.navairSmooth = 'true';
}

function destroyLenis(s: State) {
  if (s.raf) gsap.ticker.remove(s.raf);
  s.raf = null;
  s.lenis?.destroy();
  s.lenis = null;
  delete document.documentElement.dataset.navairSmooth;
}

export type SmoothScrollHandle = {
  /** The live Lenis instance at acquire time (null under reduced motion). Prefer getLenis() for later use. */
  lenis: Lenis | null;
  release: () => void;
};

export function acquireSmoothScroll(): SmoothScrollHandle {
  const s = state();
  s.refs++;
  if (s.refs === 1) {
    // One ticker for everything; never let GSAP "catch up" after a long frame,
    // which reads as a jump in a scrubbed scene.
    gsap.ticker.lagSmoothing(0);
    ScrollTrigger.config({ ignoreMobileResize: true });
    s.media = window.matchMedia('(prefers-reduced-motion: reduce)');
    s.onMedia = () => {
      if (s.media?.matches) destroyLenis(s);
      else createLenis(s);
      requestRefresh();
    };
    s.media.addEventListener('change', s.onMedia);
    if (!s.media.matches) createLenis(s);
    // Content below a lazily mounted section, a loader collapsing, a late font:
    // any document height change re-measures every trigger once.
    s.lastHeight = document.documentElement.scrollHeight;
    s.observer = new ResizeObserver(() => {
      const h = document.documentElement.scrollHeight;
      if (h === s.lastHeight) return;
      s.lastHeight = h;
      requestRefresh();
    });
    s.observer.observe(document.body);
    void document.fonts?.ready.then(() => requestRefresh());
  }
  let released = false;
  return {
    lenis: s.lenis,
    release: () => {
      if (released) return;
      released = true;
      s.refs = Math.max(0, s.refs - 1);
      if (s.refs > 0) return;
      if (s.media && s.onMedia) s.media.removeEventListener('change', s.onMedia);
      s.media = null;
      s.onMedia = null;
      s.observer?.disconnect();
      s.observer = null;
      window.clearTimeout(s.refreshTimer);
      destroyLenis(s);
    },
  };
}

export function getLenis(): Lenis | null {
  return state().lenis;
}

/** Debounced ScrollTrigger.refresh(): many callers, one measurement pass. */
export function requestRefresh(delay = 120) {
  const s = state();
  window.clearTimeout(s.refreshTimer);
  s.refreshTimer = window.setTimeout(() => {
    s.lenis?.resize();
    ScrollTrigger.refresh();
  }, delay);
}

/** Scroll to a document y (px), smoothly when Lenis is live. */
export function scrollToY(y: number, duration = 1.6) {
  const lenis = state().lenis;
  if (lenis) lenis.scrollTo(y, { duration });
  else window.scrollTo({ top: y, behavior: 'auto' });
}
