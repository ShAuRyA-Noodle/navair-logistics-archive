/**
 * Client bootstrap: engine + world + scroll + HUD. Returns a disposer.
 *
 * Homepage integration (navair-logistics):
 *  - scroll runs on the page-wide shared Lenis + gsap.ticker (src/lib/smooth-scroll.ts),
 *    never a second Lenis;
 *  - the root (.nx) fills the NavairSequence shell and IS the scroll track: the master
 *    timeline maps 'top top' → 'bottom bottom' of it, while its sticky .view holds the stage;
 *  - all per-frame work (engine, water, HUD, governor) only runs while the section is on
 *    screen;
 *  - an entry timeline swings the container doors open and reveals the opening copy as the
 *    section arrives under the globe hero (replaces the standalone veil + timed intro);
 *  - prefers-reduced-motion: native scroll, scrub without smoothing, no doors.
 */

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { acquireSmoothScroll, requestRefresh, scrollToY } from '@/lib/smooth-scroll';
import { Engine, Node3 } from './engine/engine';
import { rr } from './engine/art';
import { createGround } from './scene/ground';
import { CRANE_X, CRANE_Z, PORT_X0, QUAY_EDGE_Z } from './scene/route';
import { createStsCrane } from './machines/stscrane';
import { createReachStacker } from './machines/reachstacker';
import { createRig } from './machines/rig';
import { createShip } from './machines/ship';
import { OceanGL } from './scene/oceanGL';
import { buildMaster } from './choreo';
import { CHAPTERS, DURATION } from './story';
import { BOX } from './world';

gsap.registerPlugin(ScrollTrigger);

export function boot(root: HTMLElement) {
  const q = (s: string) => root.querySelector(s) as HTMLElement;
  const qa = (s: string) => Array.from(root.querySelectorAll(s)) as HTMLElement[];
  const canvas = root.querySelector('canvas.stage--main') as HTMLCanvasElement;
  const mobile = window.matchMedia('(max-width: 860px)').matches;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) root.dataset.nxReduced = '';
  const view = q('.view');

  // Face art (container markings) resolves its families from these root custom
  // properties; point them at the site's faces unless the page already defines them.
  const rootStyle = document.documentElement.style;
  const ownedFontVars: string[] = [];
  const css = getComputedStyle(document.documentElement);
  for (const [k, v] of [['--font-display', "'Archivo Variable', Arial"], ['--font-mono', "'IBM Plex Mono'"]] as const) {
    if (!css.getPropertyValue(k).trim()) {
      rootStyle.setProperty(k, v);
      ownedFontVars.push(k);
    }
  }

  /* ---------------------------------------------------------------- world */
  const e = new Engine(canvas, { dpr: Math.min(window.devicePixelRatio || 1, 2) });

  const ground = createGround();
  e.root.add(ground.root);

  const ship = createShip();
  e.root.add(ship.root);
  // Water is real-time WebGL on its own canvas under the world. The timeline only
  // needs a node to scope its visibility, so the ocean is a stand-in node here.
  const ocean = { root: new Node3('ocean'), wake: new Node3('wake'), update: () => {} };
  e.root.add(ocean.root);
  const water = new OceanGL(
    root.querySelector('canvas.stage--sea') as HTMLCanvasElement,
    { x0: PORT_X0, x1: PORT_X0 + 400000, z0: QUAY_EDGE_Z - 400000, z1: QUAY_EDGE_Z },
    QUAY_EDGE_Z,
    { L: ship.LOA, B: ship.BEAM },
  );

  const reach = createReachStacker();
  e.root.add(reach.root);
  const rig = createRig();
  e.root.add(rig.root);
  const crane = createStsCrane();
  crane.root.p = [CRANE_X, 0, CRANE_Z];
  e.root.add(crane.root);

  // The hero box is created by the ground (sitting on the stack); reuse it.
  const hero = ground.hero;
  const heroShadow = new Node3('hero-shadow');
  heroShadow.face({
    o: [-BOX.L / 2 - 30, 0, -BOX.W / 2 - 30],
    a: [1, 0, 0],
    b: [0, 0, 1],
    w: BOX.L + 60,
    h: BOX.W + 60,
    art:
      rr(0, 0, BOX.L + 60, BOX.W + 60, 60, 'rgba(0,10,30,.16)') +
      rr(20, 20, BOX.L + 20, BOX.W + 20, 40, 'rgba(0,10,30,.18)') +
      rr(40, 40, BOX.L - 20, BOX.W - 20, 20, 'rgba(0,10,30,.22)'),
    double: true,
    layer: -8,
    shade: 0,
  });
  heroShadow.opacity = 0;
  e.root.add(heroShadow);

  e.mount();

  /* ---------------------------------------------------------------- sizing */
  // Measured from the sticky view (100svh), not the window: mobile URL-bar show/hide
  // changes innerHeight but not the stage, so it never forces a re-layout mid-scroll.
  const size = () => {
    const W = view.clientWidth || window.innerWidth, H = view.clientHeight || window.innerHeight;
    // Reference: 1080 px tall. On portrait screens scale by width instead.
    const k = W / H < 1 ? W / 1080 : Math.min(H / 1080, W / 1500);
    e.resize(W, H, k);
    // Water is soft by nature: shade it at 70% of CSS resolution.
    water.resize(W, H, 0.7);
    dirty = true;
  };
  // Engine re-render needed even if the timeline hasn't moved (resize, DPR step, re-entry).
  let dirty = true;
  size();

  /* ---------------------------------------------------------------- timeline */
  const { tl, state, groundAnchor, oceanState } = buildMaster({ e, ground, reach, rig, ship, ocean, crane, hero, heroShadow, root, q, qa, mobile });
  (window as unknown as { NAV_DEV: unknown }).NAV_DEV = { tl, e, state };

  /* ---------------------------------------------------------------- scroll */
  const smooth = acquireSmoothScroll();

  const st = ScrollTrigger.create({
    trigger: root,
    start: 'top top',
    end: 'bottom bottom',
    scrub: reduced ? true : 0.7,
    animation: tl,
    invalidateOnRefresh: true,
  });

  /* ---------------------------------------------------------------- HUD */
  const speedoEl = q('[data-el="speedo"]');
  const speedoV = q('[data-el="speedo-v"]');
  const hudIdx = q('[data-el="hud-idx"]');
  const hudLabel = q('[data-el="hud-label"]');
  const spine = q('[data-el="spine-fill"]');
  const tele = q('[data-el="telemetry"]');
  let lastS = state.truck.s;
  let lastT = performance.now();
  let kmh = 0;
  let lastIdx = -1;
  let lastTxt = '';
  let lastTele = '';

  const hud = () => {
    const now = performance.now();
    const dt = Math.max(1, now - lastT) / 1000;
    lastT = now;
    // Speedometer = the truck's real speed along its route (so scroll speed IS truck speed).
    const ds = Math.abs(state.truck.s - lastS);
    lastS = state.truck.s;
    const target = state.flags.speedo ? Math.min(118, (ds / dt) * 0.036 * 0.42) : 0;
    kmh += (target - kmh) * (target > kmh ? 0.12 : 0.06);
    const txt = String(Math.round(kmh)).padStart(2, '0');
    if (txt !== lastTxt) {
      speedoV.textContent = txt;
      lastTxt = txt;
    }
    speedoEl.classList.toggle('is-on', !!state.flags.speedo);

    const t = tl.time();
    let idx = 0;
    for (let i = 0; i < CHAPTERS.length; i++) if (t >= CHAPTERS[i].t - 0.3) idx = i;
    if (idx !== lastIdx) {
      hudIdx.textContent = String(idx + 1).padStart(2, '0');
      hudLabel.textContent = CHAPTERS[idx].label;
      lastIdx = idx;
    }
    const p = t / DURATION;
    spine.style.transform = `scaleX(${p.toFixed(4)})`;

    const h = hero.p;
    const tl2 = `NAVU 400 117 2   X ${(h[0] / 100).toFixed(1)}  /  Z ${(h[2] / 100).toFixed(1)}  /  H ${(h[1] / 100).toFixed(1)} M`;
    if (tl2 !== lastTele) {
      tele.textContent = tl2;
      lastTele = tl2;
    }
  };

  // Ground line (screen y of the road's near edge) for the two DOM layers that sit in
  // the band. Written only on change, and only onto those layers: setting a custom
  // property on .view would restyle every SVG node beneath it each frame.
  const gyEls = [q('[data-el="panel"]'), q('[data-el="services-word"]')];
  let lastGy = NaN;
  e.onRender(() => {
    if (!state.flags.speedo && lastGy === lastGy) return; // only needed on the road
    const gy = Math.round(e.project(groundAnchor())[1]);
    if (gy === lastGy) return;
    lastGy = gy;
    for (const el of gyEls) el.style.setProperty('--gy', `${gy}px`);
  });

  // Adaptive resolution for the world canvas: a frame-time governor steps the
  // device-pixel ratio down while frames run long and back up when they're cheap.
  const maxDpr = Math.min(window.devicePixelRatio || 1, 2);
  const tiers = [maxDpr, maxDpr * 0.85, maxDpr * 0.72, Math.max(0.6, maxDpr * 0.6)];
  let tier = 0, avg = 16.7, lastFrame = performance.now(), calm = 0;
  const govern = () => {
    const now = performance.now();
    const dt = Math.min(100, now - lastFrame);
    lastFrame = now;
    avg += (dt - avg) * 0.08;
    if (avg > 21 && tier < tiers.length - 1) {
      tier++;
      avg = 16.7;
      e.setDpr(tiers[tier]);
      dirty = true;
    } else if (avg < 13) {
      if (++calm > 90 && tier > 0) {
        tier--;
        calm = 0;
        e.setDpr(tiers[tier]);
        dirty = true;
      }
    } else calm = 0;
  };

  // Render only while any part of the section is on screen. Off screen the engine,
  // water, HUD and governor cost nothing (the globe hero has the frame to itself).
  let active = false;
  const onScreen = ScrollTrigger.create({
    trigger: root,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => {
      active = self.isActive;
      if (active) {
        // Don't let the governor or speedo read the idle gap as one long frame.
        lastT = lastFrame = performance.now();
        avg = 16.7;
        dirty = true;
      }
    },
  });

  let renderedT = NaN;
  let entry: gsap.core.Timeline | null = null;
  const tick = () => {
    if (!active) return;
    // While the container doors still cover the stage (the seam under the globe), the
    // world is invisible: spend nothing on it. It was rendered once at ready.
    if (entry && entry.scrollTrigger && entry.scrollTrigger.progress < 0.03) return;
    govern();
    // The world only changes with the timeline, except at sea where the hull rides the
    // swell in real time: skip identical frames everywhere else.
    const t = tl.time();
    if (dirty || t !== renderedT || ocean.root.visible) {
      e.render();
      renderedT = t;
      dirty = false;
    }
    water.visible = ocean.root.visible;
    water.render(e.view, e.W, e.H, oceanState(performance.now() / 1000));
    hud();
  };
  gsap.ticker.add(tick);

  /* ---------------------------------------------------------------- chapter nav */
  const ticks = qa('.hud__tick');
  const onTick = (ev: Event) => {
    const t = Number((ev.currentTarget as HTMLElement).dataset.t);
    scrollToY(st.start + (st.end - st.start) * (t / tl.duration()), 1.8);
  };
  ticks.forEach((b) => b.addEventListener('click', onTick));

  /* ---------------------------------------------------------------- entry (handoff from the globe) */
  // The standalone app opened behind a veil with a timed intro. Embedded, the section
  // arrives by scroll, so the opening is scroll-scrubbed too: the container doors swing
  // out on their hinges and the opening copy rises from behind them. It is reversible
  // (scrolling back up closes the doors over the globe's navy) and it never touches the
  // properties the master timeline tweens (it moves .ln wrappers and .fr__in, never
  // .ln-i / [data-el] / the frame itself).
  gsap.set(qa('.fr--hero .ln-i'), { backgroundPositionX: '0%' });
  if (!reduced) {
    const doorL = q('.door--l'), doorR = q('.door--r');
    entry = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: root,
        start: 'top 12%',
        end: () => `top+=${Math.round(view.clientHeight * 0.85)} top`,
        scrub: true,
        invalidateOnRefresh: true,
      },
    });
    entry
      .to(q('.doors__cue'), { autoAlpha: 0, y: 24, duration: 0.18, ease: 'power1.in' }, 0)
      .fromTo(doorL, { rotationY: 0, '--sh': 0 }, { rotationY: -104, '--sh': 0.75, duration: 1, ease: 'power2.inOut' }, 0.04)
      .fromTo(doorR, { rotationY: 0, '--sh': 0 }, { rotationY: 104, '--sh': 0.75, duration: 1, ease: 'power2.inOut' }, 0.04)
      // The yard behind the doors: a slight push-in, as if stepping out of the box.
      .fromTo(q('.stage--main'), { scale: 1.06 }, { scale: 1, duration: 1.04, ease: 'power2.out' }, 0)
      .fromTo(q('.fr--hero .fr__in'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, 0.5)
      .fromTo(qa('.fr--hero .ln'), { yPercent: 38, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.42, stagger: 0.08, ease: 'power3.out' }, 0.46)
      .to(q('.doors__head'), { yPercent: -100, autoAlpha: 0, duration: 0.4, ease: 'power2.in' }, 0.55)
      .set(q('.doors'), { autoAlpha: 0 }, 1.04);
  } else {
    gsap.set(q('.doors'), { autoAlpha: 0 });
  }

  /* ---------------------------------------------------------------- layout */
  // Fonts change line boxes; the shell height is fixed in svh, so this is the only late
  // layout that matters here. Refreshes go through one shared, debounced scheduler.
  let disposed = false;
  document.fonts.ready.then(() => {
    if (disposed) return;
    size();
    requestRefresh(0);
    tl.progress(st.progress);
    e.render();
    root.dataset.nxState = 'ready';
  });
  requestRefresh();

  let rz = 0, lastW = view.clientWidth, lastH = view.clientHeight;
  const ro = new ResizeObserver(() => {
    const w = view.clientWidth, h = view.clientHeight;
    if (w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => {
      size();
      requestRefresh();
    });
  });
  ro.observe(view);

  return () => {
    disposed = true;
    ro.disconnect();
    cancelAnimationFrame(rz);
    ticks.forEach((b) => b.removeEventListener('click', onTick));
    gsap.ticker.remove(tick);
    entry?.scrollTrigger?.kill();
    entry?.kill();
    onScreen.kill();
    st.kill();
    tl.kill();
    smooth.release();
    water.dispose();
    for (const k of ownedFontVars) rootStyle.removeProperty(k);
    delete (window as unknown as { NAV_DEV?: unknown }).NAV_DEV;
  };
}
