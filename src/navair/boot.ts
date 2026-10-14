/**
 * Client bootstrap: engine + world + scroll + HUD. Returns a disposer.
 */

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
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
  const size = () => {
    const W = window.innerWidth, H = window.innerHeight;
    // Reference: 1080 px tall. On portrait screens scale by width instead.
    const k = W / H < 1 ? W / 1080 : Math.min(H / 1080, W / 1500);
    e.resize(W, H, k);
    // Water is soft by nature: shade it at 70% of CSS resolution.
    water.resize(W, H, 0.7);
  };
  size();

  /* ---------------------------------------------------------------- timeline */
  const { tl, state, groundAnchor, oceanState } = buildMaster({ e, ground, reach, rig, ship, ocean, crane, hero, heroShadow, root, q, qa, mobile });
  (window as unknown as { NAV_DEV: unknown }).NAV_DEV = { tl, e, state };

  /* ---------------------------------------------------------------- scroll */
  const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.95, touchMultiplier: 1.5, smoothWheel: true });
  (window as unknown as { __lenis: Lenis }).__lenis = lenis;
  lenis.on('scroll', ScrollTrigger.update);
  const raf = (t: number) => lenis.raf(t * 1000);
  gsap.ticker.add(raf);
  gsap.ticker.lagSmoothing(0);

  const track = q('.track');
  const st = ScrollTrigger.create({
    trigger: track,
    start: 'top top',
    end: 'bottom bottom',
    scrub: 0.7,
    animation: tl,
    invalidateOnRefresh: true,
  });

  /* ---------------------------------------------------------------- HUD */
  const view = q('.view');
  const speedoEl = q('[data-el="speedo"]');
  const speedoV = q('[data-el="speedo-v"]');
  const hudIdx = q('[data-el="hud-idx"]');
  const hudLabel = q('[data-el="hud-label"]');
  const spine = q('[data-el="spine-fill"]');
  const tele = q('[data-el="telemetry"]');
  const cursorProg = root.querySelector('.cursor__prog') as SVGCircleElement;
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
    cursorProg.style.strokeDashoffset = String((1 - p).toFixed(4));

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
    } else if (avg < 13) {
      if (++calm > 90 && tier > 0) {
        tier--;
        calm = 0;
        e.setDpr(tiers[tier]);
      }
    } else calm = 0;
  };

  const tick = () => {
    govern();
    e.render();
    water.visible = ocean.root.visible;
    water.render(e.view, e.W, e.H, oceanState(performance.now() / 1000));
    hud();
  };
  gsap.ticker.add(tick);

  /* ---------------------------------------------------------------- cursor */
  const cur = q('.cursor');
  const fine = window.matchMedia('(pointer: fine)').matches;
  let mx = window.innerWidth / 2, my = window.innerHeight / 2, cx = mx, cy = my;
  const onMove = (ev: PointerEvent) => {
    mx = ev.clientX;
    my = ev.clientY;
    cur.classList.add('is-live');
    const t = ev.target as HTMLElement;
    cur.classList.toggle('is-link', !!t.closest('a,button'));
  };
  const cursorTick = () => {
    cx += (mx - cx) * 0.15;
    cy += (my - cy) * 0.15;
    cur.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
  };
  if (fine) {
    window.addEventListener('pointermove', onMove, { passive: true });
    gsap.ticker.add(cursorTick);
  } else cur.style.display = 'none';

  /* ---------------------------------------------------------------- header */
  const hdr = q('.hdr');
  let lastY = 0;
  const onScroll = ({ scroll }: { scroll: number }) => {
    hdr.classList.toggle('is-scrolled', scroll > 120);
    hdr.classList.toggle('is-hidden', scroll > 400 && scroll > lastY + 2);
    if (scroll < lastY - 2) hdr.classList.remove('is-hidden');
    lastY = scroll;
  };
  lenis.on('scroll', onScroll);

  /* ---------------------------------------------------------------- chapter nav */
  const ticks = qa('.hud__tick');
  const onTick = (ev: Event) => {
    const t = Number((ev.currentTarget as HTMLElement).dataset.t);
    const y = st.start + (st.end - st.start) * (t / tl.duration());
    lenis.scrollTo(y, { duration: 1.8 });
  };
  ticks.forEach((b) => b.addEventListener('click', onTick));

  /* ---------------------------------------------------------------- intro */
  const veil = q('.veil');
  const intro = gsap.timeline({ paused: true });
  intro
    .to(q('.veil__bar span'), { scaleX: 1, duration: 0.5, ease: 'power2.inOut' })
    .to(veil, { yPercent: -100, duration: 0.9, ease: 'expo.inOut' }, '+=0.1')
    .from(qa('.fr--hero .ln-i'), { yPercent: 140, backgroundPositionX: '100%', duration: 1.2, stagger: 0.09, ease: 'expo.out' }, '-=0.35')
    .from(qa('.fr--hero [data-el]'), { autoAlpha: 0, y: 24, duration: 1, stagger: 0.08, ease: 'power3.out' }, '-=0.9')
    .call(() => root.classList.add('is-ready'), undefined, '<');
  gsap.to(q('.veil__bar span'), { scaleX: 0.7, duration: 0.9, ease: 'power2.out' });
  // Mark hero lines as already revealed for the scrubbed timeline.
  gsap.set(qa('.fr--hero .ln-i'), { backgroundPositionX: '0%' });
  lenis.stop();
  document.fonts.ready.then(() => {
    size();
    ScrollTrigger.refresh();
    tl.progress(st.progress);
    e.render();
    intro.play();
    intro.eventCallback('onComplete', () => {
      veil.style.display = 'none';
      lenis.start();
    });
  });

  /* ---------------------------------------------------------------- resize */
  let rz = 0;
  const onResize = () => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => {
      size();
      ScrollTrigger.refresh();
    });
  };
  window.addEventListener('resize', onResize);

  return () => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pointermove', onMove);
    ticks.forEach((b) => b.removeEventListener('click', onTick));
    gsap.ticker.remove(tick);
    gsap.ticker.remove(raf);
    gsap.ticker.remove(cursorTick);
    st.kill();
    tl.kill();
    intro.kill();
    lenis.destroy();
    water.dispose();
  };
}
