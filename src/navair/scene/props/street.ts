/**
 * Street furniture, drawn as technical illustration: street lamps, high-mast
 * floodlights, W-beam guardrail, jersey barriers, chain-link fence, road signs
 * and a sign gantry.
 *
 * Every builder makes ONE node standing on its ground contact point, so the
 * grounded weak perspective (node.persp) keeps it planted. Local frame: the
 * "front" of an object faces local +X (toward the road for far-side scenery,
 * toward the yaw-90 camera). Rotate the node to face elsewhere.
 */

import { Node3, box } from '../../engine/engine';
import { circle, path, rect, rr, stroke, text } from '../../engine/art';
import { mix, shade } from '../../engine/color';
import type { V3 } from '../../engine/math';
import { C } from '../../world';

export const GALV = { base: '#A9AEB5', hi: '#CED2D7', lo: '#80868F', dark: '#5E646D' };
export const CONC = { base: '#CFCEC7', hi: '#E0DFD9', lo: '#AEADA6', dark: '#8F8E88' };
const PAPER = C.paper;

const f = (n: number) => Math.round(n * 10) / 10;

/** Fade a colour toward the paper (atmospheric depth). */
export const haze = (c: string, t: number) => (t <= 0 ? c : mix(c, PAPER, t));

/* ------------------------------------------------------------ street lamp */

export interface LampOpts {
  /** Pole height (cm). */
  H?: number;
  /** Arm outreach along local +X (cm). */
  arm?: number;
  /** Atmospheric fade 0..1. */
  haze?: number;
  /** Draw the warm light pool on the ground (plan views). */
  pool?: boolean;
}

/**
 * Street lamp: concrete footing + base plate, tapered octagonal pole with a
 * cable door, curved davit arm and a flat LED luminaire. Arm reaches +X.
 */
export function streetLamp(parent: Node3, name: string, p: V3, yaw: number, o: LampOpts = {}) {
  const H = o.H ?? 1000, ARM = o.arm ?? 240, hz = o.haze ?? 0;
  const n = parent.node(name, p);
  n.r.y = yaw;
  const pole = haze('#3A3F47', hz), poleHi = haze('#5A616B', hz), poleLo = haze('#262A30', hz);
  const conc = haze(CONC.base, hz), concLo = haze(CONC.lo, hz);

  // Footing + base plate.
  const foot = rect(0, 0, 48, 16, conc) + rect(0, 0, 48, 3, haze(CONC.hi, hz)) + rect(0, 13, 48, 3, concLo);
  box(n, -24, 0, -24, 48, 16, 48, {
    px: foot,
    pz: foot,
    py: rect(0, 0, 48, 48, conc) + rect(10, 10, 28, 28, poleLo) + circle(13, 13, 2.5, poleHi) + circle(35, 13, 2.5, poleHi) + circle(13, 35, 2.5, poleHi) + circle(35, 35, 2.5, poleHi),
  }, { name: `${name}.foot` });
  // Base section: flared octagon, cable door.
  const baseArt = (door: boolean) =>
    path('M0 110L3 0H25L28 110Z', pole) +
    path('M3 0H9L7 110H0Z', poleHi, { opacity: 0.55 }) +
    path('M20 0H25L28 110H22Z', poleLo, { opacity: 0.6 }) +
    rect(0, 104, 28, 6, poleLo) +
    (door ? rr(8.5, 32, 11, 44, 1.5, poleLo) + rr(9.5, 33, 9, 42, 1, haze('#434850', hz)) + circle(14, 38, 1.2, poleHi) + circle(14, 70, 1.2, poleHi) : '');
  box(n, -14, 16, -14, 28, 110, 28, { px: baseArt(true), pz: baseArt(false) }, { name: `${name}.base` });
  // Pole: 18 → 11 cm taper.
  const PH = H - 126;
  const poleArt =
    path(`M0 ${PH}L3.5 0H14.5L18 ${PH}Z`, pole) +
    path(`M3.5 0H7L5 ${PH}H0Z`, poleHi, { opacity: 0.5 }) +
    path(`M12 0H14.5L18 ${PH}H14Z`, poleLo, { opacity: 0.55 });
  box(n, -9, 126, -9, 18, PH, 18, { px: poleArt, pz: poleArt, py: circle(9, 9, 6, poleHi) }, { name: `${name}.pole` });
  // Davit arm: rises out of the pole top and curves over to horizontal (side profile).
  const AH = 90; // arm art height
  const armProfile =
    path(`M0 ${AH}C0 30 30 8 90 6L${ARM} 4V13L90 15C40 17 11 36 11 ${AH}Z`, pole) +
    path(`M0 ${AH}C0 30 30 8 90 6L${ARM} 4V7L90 9C36 11 4 34 4 ${AH}Z`, poleHi, { opacity: 0.55 });
  box(n, -5, H - AH + 14, -5, ARM + 5, AH, 10, {
    pz: armProfile,
    nz: `<g transform="translate(${ARM + 5} 0) scale(-1 1)">${armProfile}</g>`,
    py: rect(0, 0, ARM + 5, 10, poleHi) + rect(0, 7, ARM + 5, 3, poleLo),
  }, { name: `${name}.arm` });
  // LED luminaire: flat head, heat-sink fins on top, warm lens under.
  const HL = 86, HW = 34, HT = 15;
  const hx = ARM - 16, hy = H + 2;
  const body = haze('#4A5059', hz), bodyHi = haze('#6C737E', hz), lens = haze('#FFF3C8', hz * 0.6);
  box(n, hx, hy, -HW / 2, HL, HT, HW, {
    px: rr(0, 0, HW, HT, 4, body) + rect(2, 2, HW - 4, 3, bodyHi) + rect(4, HT - 4, HW - 8, 3, lens),
    pz: path(`M0 3Q0 0 6 0H${HL - 8}Q${HL} 0 ${HL} 6L${HL - 6} ${HT}H10Q0 ${HT} 0 9Z`, body) + rect(8, 1.5, HL - 18, 3, bodyHi) + rect(12, HT - 3.5, HL - 24, 2.5, lens),
    nz: path(`M${HL} 3Q${HL} 0 ${HL - 6} 0H8Q0 0 0 6L6 ${HT}H${HL - 10}Q${HL} ${HT} ${HL} 9Z`, body) + rect(10, 1.5, HL - 18, 3, bodyHi) + rect(12, HT - 3.5, HL - 24, 2.5, lens),
    py:
      rr(0, 0, HL, HW, 8, body) +
      stroke(Array.from({ length: 9 }, (_, i) => `M${f(14 + i * 7)} 6V${HW - 6}`).join(''), bodyHi, 2.2) +
      rr(HL - 14, 10, 8, HW - 20, 2, shade(body, 0.3)),
    ny: rr(0, 0, HL, HW, 8, body) + rr(8, 5, HL - 16, HW - 10, 5, lens) + rr(14, 9, HL - 28, HW - 18, 4, '#FFFBEA'),
  }, { name: `${name}.head` });
  if (o.pool) {
    // Warm light pool on the ground under the head (visible in plan views only).
    const R = 360;
    n.face({
      o: [ARM + 30 - R, 1.5, -R],
      a: [1, 0, 0],
      b: [0, 0, 1],
      w: 2 * R,
      h: 2 * R,
      art:
        `<radialGradient id="lpool"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".075"/><stop offset=".6" stop-color="#FFFFFF" stop-opacity=".03"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>` +
        `<ellipse cx="${R}" cy="${R}" rx="${R}" ry="${R * 0.8}" fill="url(#lpool)"/>`,
      double: true,
      layer: -8.5,
      shade: 0,
      name: `${name}.pool`,
    });
  }
  return n;
}

/* ------------------------------------------------------- high-mast light */

/** High-mast floodlight: tapered mast, service ladder cage and a crown of floods. */
export function highMast(parent: Node3, name: string, p: V3, o: { H?: number; haze?: number } = {}) {
  const H = o.H ?? 2800, hz = o.haze ?? 0;
  const n = parent.node(name, p);
  const c = haze('#B9BEC5', hz), hi = haze('#DDE0E4', hz), lo = haze('#8C929B', hz), dk = haze('#4B515A', hz);
  // Base: concrete plinth + flange.
  const plinth = rect(0, 0, 110, 40, haze(CONC.base, hz)) + rect(0, 0, 110, 4, haze(CONC.hi, hz)) + rect(0, 36, 110, 4, haze(CONC.lo, hz));
  box(n, -55, 0, -55, 110, 40, 110, { px: plinth, pz: plinth, py: rect(0, 0, 110, 110, haze(CONC.base, hz)) + circle(55, 55, 34, lo) }, { name: `${name}.plinth` });
  const MH = H - 40;
  const mast =
    path(`M0 ${MH}L22 0H44L66 ${MH}Z`, c) +
    path(`M22 0H30L14 ${MH}H0Z`, hi, { opacity: 0.6 }) +
    path(`M38 0H44L66 ${MH}H50Z`, lo, { opacity: 0.6 }) +
    // Section joints.
    stroke(`M8 ${f(MH * 0.36)}H58M15 ${f(MH * 0.68)}H51`, lo, 3) +
    // Base door + flange.
    rr(24, MH - 220, 18, 90, 3, lo) + rect(0, MH - 16, 66, 16, dk);
  box(n, -33, 40, -33, 66, MH, 66, { px: mast, pz: mast }, { name: `${name}.mast` });
  // Crown: lowering ring with floods, lightning spike.
  const CW = 300, CH = 90;
  let crown = rect(20, 52, CW - 40, 12, dk) + rect(40, 0, CW - 80, 10, dk) + rect(CW / 2 - 4, -60, 8, 60, dk);
  for (let i = 0; i < 5; i++) {
    const x = 18 + i * ((CW - 36 - 50) / 4);
    crown += rr(x, 10, 50, 40, 4, haze('#3E444C', hz)) + rr(x + 5, 16, 40, 26, 3, haze('#FFF4CF', hz * 0.6)) + rect(x + 22, 50, 6, 8, dk);
  }
  box(n, -CW / 2, H - 10, -CW / 2, CW, CH, CW, {
    px: crown,
    pz: crown,
    py: circle(CW / 2, CW / 2, CW / 2 - 20, 'none', { stroke: dk, 'stroke-width': 12 }) + circle(CW / 2, CW / 2, 30, lo) +
      Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return rr(CW / 2 + Math.cos(a) * 110 - 22, CW / 2 + Math.sin(a) * 110 - 16, 44, 32, 4, haze('#3E444C', hz));
      }).join(''),
  }, { name: `${name}.crown` });
  return n;
}

/* --------------------------------------------------------- W-beam guardrail */

/**
 * Guardrail run along local −Z from z = 0 to z = −len (one face per run, drawn
 * facing +X), with C-posts every 2 m, blockouts, the W-beam and delineator caps.
 */
export function guardrail(parent: Node3, name: string, p: V3, len: number, o: { haze?: number; plan?: boolean } = {}) {
  const n = parent.node(name, p);
  const hz = o.haze ?? 0;
  const H = 82;
  const g = { base: haze(GALV.base, hz), hi: haze(GALV.hi, hz), lo: haze(GALV.lo, hz), dk: haze(GALV.dark, hz) };
  let posts = '', blocks = '', refl = '';
  for (let u = 40, i = 0; u < len - 20; u += 200, i++) {
    posts += `M${u} 22h12v${H - 22}h-12Z`;
    blocks += `M${u - 2} 26h16v22h-16Z`;
    if (i % 2 === 0) refl += `M${u + 1} 12h10v8h-10Z`;
  }
  const art =
    path(posts, g.lo) +
    path(blocks, g.dk) +
    // W-beam: 31 cm deep profile, two corrugations.
    rect(0, 14, len, 32, g.base) +
    rect(0, 16, len, 6, g.hi) +
    rect(0, 28, len, 4, g.hi) +
    rect(0, 23, len, 4, g.lo) +
    rect(0, 40, len, 5, g.lo) +
    // Splice bolts every 4 m.
    path(Array.from({ length: Math.floor(len / 400) }, (_, i) => `M${i * 400 + 200} 30m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0`).join(''), g.dk) +
    path(refl, haze('#F2B705', hz)) +
    // Flared terminal ends.
    path(`M0 14L-60 30V36L0 46Z`, g.base) +
    path(`M${len} 14L${len + 60} 30V36L${len} 46Z`, g.base);
  n.face({ o: [0, H, 0], a: [0, 0, -1], b: [0, -1, 0], w: len, h: H, art, name: `${name}.front`, shade: 0.4 });
  if (o.plan) {
    n.face({
      o: [-16, H, 0], a: [0, 0, -1], b: [1, 0, 0], w: len, h: 32,
      art: path(Array.from({ length: Math.floor((len - 60) / 200) + 1 }, (_, i) => `M${40 + i * 200} 18h12v14h-12Z`).join(''), g.lo) + rect(0, 4, len, 12, g.base) + rect(0, 4, len, 3, g.hi),
      name: `${name}.top`, shade: 0,
    });
  }
  return n;
}

/* ---------------------------------------------------------- jersey barrier */

/** Concrete F-shape barrier run (segments 3.8 m), facing +X, along −Z. */
export function jerseyRun(parent: Node3, name: string, p: V3, len: number, o: { haze?: number; striped?: boolean } = {}) {
  const n = parent.node(name, p);
  const hz = o.haze ?? 0, H = 81;
  const c = haze(CONC.base, hz), hi = haze(CONC.hi, hz), lo = haze(CONC.lo, hz);
  let joints = '', lifts = '', stripes = '';
  for (let u = 0, i = 0; u < len; u += 380, i++) {
    joints += `M${u} 0v${H}`;
    lifts += `M${u + 150} ${H - 12}h80v12h-80Z`;
    if (o.striped && i % 2 === 0) stripes += `M${u + 20} 8h140v14h-140Z`;
  }
  const art =
    rect(0, 0, len, H, c) +
    rect(0, 0, len, 5, hi) +
    rect(0, 26, len, 3, hi) + // slope break (F-shape)
    rect(0, H - 8, len, 8, lo) +
    path(lifts, lo) +
    (stripes ? path(stripes, haze(C.signal, hz)) : '') +
    stroke(joints, shade(c, 0.35), 3);
  n.face({ o: [0, H, 0], a: [0, 0, -1], b: [0, -1, 0], w: len, h: H, art, name: `${name}.front`, shade: 0.3 });
  n.face({ o: [-30, H, 0], a: [0, 0, -1], b: [1, 0, 0], w: len, h: 30, art: rect(0, 0, len, 30, hi) + stroke(joints.replace(/v81/g, 'v30'), lo, 3), name: `${name}.top`, shade: 0 });
  return n;
}

/* ------------------------------------------------------------ chain link */

let meshSeq = 0;
/** Chain-link security fence (2.4 m + barbed-wire outrigger), along −Z, facing +X. */
export function fenceRun(parent: Node3, name: string, p: V3, len: number, o: { haze?: number; H?: number } = {}) {
  const n = parent.node(name, p);
  const hz = o.haze ?? 0, H = o.H ?? 240;
  const TOP = 50; // outrigger zone
  const post = haze('#8E949C', hz), rail = haze('#9CA2AA', hz), mesh = haze('#7E858E', hz);
  const id = `cl${meshSeq++}`;
  let posts = '', wires = '';
  for (let u = 0; u <= len; u += 300) {
    posts += `M${u - 4} ${TOP - 30}h8v${H + 30}h-8Z`;
    wires += `M${u} ${TOP}l14 -32`;
  }
  const art =
    `<pattern id="${id}" patternUnits="userSpaceOnUse" width="16" height="16"><path d="M0 0L16 16M16 0L0 16" stroke="${mesh}" stroke-width="1.3" fill="none" stroke-opacity=".6"/></pattern>` +
    rect(0, TOP, len, H - 6, `url(#${id})`) +
    rect(0, TOP, len, 5, rail) +
    rect(0, TOP + H - 10, len, 4, rail) +
    path(posts, post) +
    stroke(wires, post, 3) +
    // Barbed wire strands on the outrigger.
    stroke(`M0 ${TOP - 10}H${len}M4 ${TOP - 20}H${len + 4}M8 ${TOP - 30}H${len + 8}`, haze('#6B717A', hz), 1.4, { 'stroke-dasharray': '6 5' });
  n.face({ o: [0, H + TOP, 0], a: [0, 0, -1], b: [0, -1, 0], w: len, h: H + TOP, art, double: true, name: `${name}.mesh`, shade: 0 });
  return n;
}

/* ------------------------------------------------------------ road signs */

export type SignKind = 'port' | 'yard' | 'speed' | 'km' | 'terminal';

/** Roadside sign on posts, face toward local +X. */
export function roadSign(parent: Node3, name: string, p: V3, kind: SignKind, o: { haze?: number; km?: number } = {}) {
  const n = parent.node(name, p);
  const hz = o.haze ?? 0;
  const postC = haze(GALV.base, hz), postLo = haze(GALV.lo, hz);
  const blue = haze(C.blue, hz), white = haze('#FFFFFF', hz * 0.8), ink = haze('#1A1C20', hz);
  const post = (z: number, h: number) =>
    box(n, -5, 0, z - 5, 10, h, 10, { px: rect(0, 0, 10, h, postC) + rect(0, 0, 3, h, haze(GALV.hi, hz)) + rect(7, 0, 3, h, postLo), py: rect(0, 0, 10, 10, postC) });
  let W = 300, Hs = 170, y0 = 170, art = '';
  if (kind === 'port' || kind === 'terminal') {
    W = 360; Hs = 200; y0 = 180;
    const t1 = kind === 'port' ? 'PORT TERMINAL 3' : 'NAVAIR TERMINAL';
    const t2 = kind === 'port' ? 'Container gate · 2 km' : 'Gate 3 · Berths 1–6';
    art =
      rr(0, 0, W, Hs, 12, blue) +
      rr(7, 7, W - 14, Hs - 14, 8, 'none', { stroke: white, 'stroke-width': 4 }) +
      text(26, 64, t1, 34, white, { 'font-weight': 800, style: 'font-stretch:112%' }) +
      text(26, 104, t2, 22, white, { 'font-weight': 500 }) +
      // Ship pictogram + arrow.
      path('M26 150h56l-8 14h-40Z', white) + rect(40, 130, 14, 18, white) + rect(58, 136, 12, 12, white) +
      path(`M${W - 90} 142h40v-14l26 22l-26 22v-14h-40Z`, white);
  } else if (kind === 'yard') {
    W = 280; Hs = 150; y0 = 170;
    art =
      rr(0, 0, W, Hs, 10, haze('#FFFFFF', hz * 0.8)) +
      rr(6, 6, W - 12, Hs - 12, 7, 'none', { stroke: ink, 'stroke-width': 4 }) +
      rect(6, 6, W - 12, 44, blue) +
      text(20, 40, 'NAVAIR', 26, white, { 'font-weight': 800, 'letter-spacing': 2 }) +
      text(20, 94, 'YARD 04', 34, ink, { 'font-weight': 800, style: 'font-stretch:112%' }) +
      text(20, 128, 'Reach stackers · RTG', 18, haze('#50555E', hz), { 'font-weight': 500 });
  } else if (kind === 'speed') {
    W = 110; Hs = 110; y0 = 190;
    art =
      circle(55, 55, 54, white) + circle(55, 55, 46, 'none', { stroke: haze('#D8261C', hz), 'stroke-width': 13 }) +
      text(55, 71, '40', 44, ink, { 'text-anchor': 'middle', 'font-weight': 800 });
  } else {
    // km post: slim green/white reflective marker.
    W = 60; Hs = 120; y0 = 60;
    art =
      rr(0, 0, W, Hs, 6, white) + rect(0, 0, W, 30, haze('#1E7A3C', hz)) +
      text(30, 24, 'km', 18, white, { 'text-anchor': 'middle', 'font-weight': 700, family: 'mono' }) +
      text(30, 70, String(o.km ?? 1), 32, ink, { 'text-anchor': 'middle', 'font-weight': 800 }) +
      rect(10, 92, 40, 16, haze('#F2B705', hz));
  }
  if (kind === 'km') {
    box(n, -4, y0, -W / 2, 8, Hs, W, { px: art, py: rect(0, 0, 8, W, postC) }, { name: `${name}.board` });
    box(n, -5, 0, -5, 10, y0, 10, { px: rect(0, 0, 10, y0, postC) });
    return n;
  }
  const back = rr(0, 0, W, Hs, 10, haze('#9AA0A8', hz)) + stroke(`M0 ${Hs * 0.3}H${W}M0 ${Hs * 0.7}H${W}`, postLo, 5);
  if (kind === 'speed') {
    post(0, y0 + Hs / 2);
  } else {
    post(-W / 2 + 40, y0 + Hs - 10);
    post(W / 2 - 40, y0 + Hs - 10);
  }
  box(n, -3, y0, -W / 2, 6, Hs, W, { px: art, nx: back, py: rect(0, 0, 6, W, postC) }, { name: `${name}.board`, shade: 0.5 });
  return n;
}

/* ------------------------------------------------------------- sign gantry */

/**
 * Overhead sign gantry spanning local X from 0 to span (road across), sign
 * faces facing local +Z (oncoming traffic driving −Z).
 */
export function signGantry(parent: Node3, name: string, p: V3, span: number, signs: { x: number; w: number; top: string; sub: string; arrow: 'up' | 'right' }[]) {
  const n = parent.node(name, p);
  const H = 620, BH = 70; // clearance, truss depth
  const g = GALV;
  // Columns (square hollow section) with base plates.
  for (const x of [0, span]) {
    const col = rect(0, 0, 36, H + BH, g.base) + rect(0, 0, 8, H + BH, g.hi) + rect(28, 0, 8, H + BH, g.lo) + rect(-10, H + BH - 10, 56, 10, g.dark);
    box(n, x - 18, 0, -18, 36, H + BH, 36, { px: col, pz: col, nz: col, py: rect(0, 0, 36, 36, g.hi) }, { name: `${name}.col` });
  }
  // Box truss: chords + zig-zag web on the faces.
  let web = '';
  for (let x = 0; x < span; x += 70) web += `M${x} 6L${x + 35} ${BH - 6}L${x + 70} 6`;
  const truss = rect(0, 0, span, 8, g.base) + rect(0, BH - 8, span, 8, g.base) + stroke(web, g.lo, 4);
  box(n, 0, H, -30, span, BH, 60, {
    pz: truss,
    nz: truss,
    py: rect(0, 0, span, 8, g.base) + rect(0, 52, span, 8, g.base) + stroke(Array.from({ length: Math.ceil(span / 70) }, (_, i) => `M${i * 70} 8L${i * 70 + 35} 52`).join(''), g.lo, 4),
    px: rect(0, 0, 60, BH, g.base),
  }, { name: `${name}.truss` });
  for (const s of signs) {
    const SH = 150;
    const arrow = s.arrow === 'up'
      ? `M${s.w - 70} ${SH - 26}v-50h-18l30 -40l30 40h-18v50Z`
      : `M${s.w - 110} ${SH - 60}h54v-18l40 30l-40 30v-18h-54Z`;
    const art =
      rr(0, 0, s.w, SH, 10, C.blue) +
      rr(6, 6, s.w - 12, SH - 12, 7, 'none', { stroke: '#fff', 'stroke-width': 4 }) +
      text(24, 62, s.top, 38, '#fff', { 'font-weight': 800, style: 'font-stretch:112%' }) +
      text(24, 104, s.sub, 22, '#fff', { 'font-weight': 500 }) +
      path(arrow, '#fff');
    box(n, s.x, H - SH + BH - 10, 32, s.w, SH, 6, {
      pz: art,
      nz: rr(0, 0, s.w, SH, 8, '#9AA0A8'),
      py: rect(0, 0, s.w, 6, '#8A9098'),
    }, { name: `${name}.sign`, shade: 0.4 });
  }
  return n;
}
