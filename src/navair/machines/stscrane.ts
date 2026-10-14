/**
 * NQ-07 ship-to-shore (STS) container gantry crane.
 *
 * CRANE space: origin = ground point on the WATERSIDE rail centre. Rails run
 * along local X (the gantry travels along X). Waterside rail z = 0, landside
 * rail z = +GAUGE. The trolley girders run across Z: outreach over the water
 * to z = −OUTREACH, backreach over land to z = GAUGE + BACKREACH.
 *
 * Twin box girders at x = ±GX carry the trolley; the operator cab hangs under
 * the trolley and moves with it. The 40' spreader (long axis along local X)
 * hangs on four hoist ropes, stretched every apply() with node scale `k`.
 * Stays and ropes are wheel-cylinders (no faces) so they read as round bars
 * from every angle.
 */

import { Node3, box, splitFace, type FaceDef } from '../engine/engine';
import { bolts, circle, hi, lo, path, polyD, rect, rr, seam, stroke, text } from '../engine/art';
import { shade, tint } from '../engine/color';
import { DEG, clamp, type V3 } from '../engine/math';
import { BOX, C } from '../world';
import { LIVERY, container } from './container';
import { swayCurve } from './reachstacker';
import type { LabEntry } from './registry';

type P2 = [number, number];

/* ------------------------------------------------------------------------ */
/* Dimensions (cm)                                                           */
/* ------------------------------------------------------------------------ */

export const STS = {
  GAUGE: 2700,
  OUTREACH: 4200,
  BACKREACH: 1400,
  /** Girder underside height. */
  BOOM_Y: 3400,
  /** Girder depth → top of girders (trolley rails). */
  girderD: 280,
  /** Girder centreline x (±) and half width. */
  GX: 420,
  gHalf: 55,
  /** Leg centreline x (±), leg half sizes. */
  LX: 850,
  legHX: 80,
  legHZ: 100,
  legY0: 520,
  legY1: 3200,
  /** A-frame apex (z, y). */
  apex: [450, 5150] as P2,
  /** Spreader underside → headblock top. */
  headTop: 132,
  /** Twistlock centres (match container.ts casting apertures). */
  tlX: BOX.L / 2 - 8.9,
  tlZ: BOX.W / 2 - 8.1,
  /** Trolley travel limits (spreader centre z). */
  trolleyMin: -3600,
  trolleyMax: 2600,
  /** Hoist limits (spreader underside). */
  hoistMin: 0,
  hoistMax: 3150,
} as const;

const { GAUGE, OUTREACH, BACKREACH, BOOM_Y, GX, LX } = STS;
const GT = BOOM_Y + STS.girderD;
const ZTIP = -OUTREACH;
const ZEND = GAUGE + BACKREACH;
const GLEN = ZEND - ZTIP;
/** Festoon (trolley power/data cable) system: girder side (x sign) and landside anchor z. */
const FEST_SIDE = 1;
const FEST_ANCHOR = ZEND - 160;

/* ------------------------------------------------------------------------ */
/* Palette                                                                   */
/* ------------------------------------------------------------------------ */

const S = {
  w: '#ECEEF1',
  w2: '#DCE0E5',
  w3: '#C5CBD2',
  edge: '#A3AAB3',
  dk: '#6B7480',
  grate: '#8C939C',
  grate2: '#6F7780',
  graphite: '#2E3239',
  graphite2: '#23262B',
  glass: '#26364A',
  glassHi: '#5F7390',
  glassDk: '#121A24',
  red: '#E0262B',
  lamp: '#FFF4D8',
};

/* ------------------------------------------------------------------------ */
/* Art helpers                                                               */
/* ------------------------------------------------------------------------ */

const f1 = (v: number) => Math.round(v * 10) / 10;

function hazRect(id: string, x: number, y: number, w: number, h: number, pitch = 40) {
  let d = '';
  for (let u = x - h; u < x + w + h; u += pitch) d += `M${f1(u)} ${f1(y + h)}L${f1(u + h)} ${f1(y)}h${f1(pitch / 2)}L${f1(u + pitch / 2)} ${f1(y + h)}Z`;
  return (
    `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>` +
    `<g clip-path="url(#${id})">${rect(x, y, w, h, C.hazard)}<path d="${d}" fill="${C.ink}"/></g>`
  );
}

function hazPoly(id: string, d: string, x: number, y: number, w: number, h: number, pitch = 22) {
  let s = '';
  for (let u = x - h; u < x + w + h; u += pitch) s += `M${f1(u)} ${f1(y + h)}L${f1(u + h)} ${f1(y)}h${f1(pitch / 2)}L${f1(u + pitch / 2)} ${f1(y + h)}Z`;
  return `<clipPath id="${id}"><path d="${d}"/></clipPath><g clip-path="url(#${id})">${rect(x, y, w, h, C.hazard)}<path d="${s}" fill="${C.ink}"/></g>`;
}

/** Steel grating via an SVG pattern (cheap for very long walkways). */
function grating(id: string, x: number, y: number, w: number, h: number) {
  return (
    `<pattern id="${id}" width="9" height="9" patternUnits="userSpaceOnUse">` +
    `<rect width="9" height="9" fill="${S.grate}"/><path d="M0 0H9M0 4.5H9" stroke="${S.grate2}" stroke-width="1.6"/><path d="M0 0V9" stroke="${S.grate2}" stroke-width="0.8"/></pattern>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id})"/>`
  );
}

function louvres(x: number, y: number, w: number, h: number, pitch: number, frameC: string, slat: string, gap: string) {
  let a = '', b = '';
  for (let v = y + 5; v + pitch * 0.6 < y + h - 4; v += pitch) {
    a += `M${f1(x + 5)} ${f1(v)}h${f1(w - 10)}v${f1(pitch * 0.55)}h${f1(-(w - 10))}Z`;
    b += `M${f1(x + 5)} ${f1(v + pitch * 0.55)}h${f1(w - 10)}v${f1(pitch * 0.25)}h${f1(-(w - 10))}Z`;
  }
  return rr(x, y, w, h, 4, frameC) + path(a, slat) + path(b, gap);
}

function lampBox(x: number, y: number, w: number, h: number, lens: string, rim = '#15161A') {
  return rr(x, y, w, h, Math.min(w, h) * 0.22, rim) + rr(x + 3, y + 3, w - 6, h - 6, Math.min(w, h) * 0.18, lens) + rr(x + 5, y + 4, (w - 10) * 0.45, Math.max(1, (h - 6) * 0.3), 1, 'rgba(255,255,255,.55)');
}

/** Vertical corrugated cladding. */
function cladding(x: number, y: number, w: number, h: number, base: string) {
  let a = '', b = '';
  for (let u = x + 6; u < x + w - 10; u += 22) {
    a += `M${f1(u)} ${y}h8v${h}h-8Z`;
    b += `M${f1(u + 10)} ${y}h3v${h}h-3Z`;
  }
  return rect(x, y, w, h, base) + path(a, tint(base, 0.35)) + path(b, shade(base, 0.12));
}

function cylinder(parent: Node3, name: string, a: V3, b: V3, r: number, tread: string, cap = '') {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(d[0], d[1], d[2]);
  const n = parent.node(name, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  n.r.y = Math.atan2(d[0], d[2]) / DEG;
  n.r.x = -Math.asin(d[1] / L) / DEG;
  n.wheel({ r, w: L, tread, disc: cap || circle(0, 0, r, shade(tread, 0.25)) });
  return n;
}

/* ------------------------------------------------------------------------ */
/* Structure art                                                             */
/* ------------------------------------------------------------------------ */

function legArt(w: number, h: number, id: string, o: { num?: boolean; ladder?: boolean; light?: boolean } = {}) {
  const s = [rect(0, 0, w, h, o.light === false ? S.w2 : S.w)];
  s.push(rect(0, 0, 6, h, 'rgba(255,255,255,.55)'), rect(w - 7, 0, 7, h, 'rgba(0,0,0,.07)'));
  let d = '';
  for (let v = 300; v < h - 420; v += 320) d += `M0 ${v}H${w}`;
  s.push(seam(d, 'rgba(0,0,0,.1)', 2.2));
  // Top connection plate
  s.push(rect(0, 0, w, 46, S.w2), rect(0, 44, w, 3, 'rgba(0,0,0,.12)'), bolts(14, w - 14, 22, Math.max(2, Math.round(w / 30)), 3.4, S.edge));
  if (o.ladder) {
    const lx = w / 2 - 24;
    let r = '';
    for (let v = 80; v < h - 360; v += 32) r += `M${lx} ${v}h48`;
    s.push(stroke(`M${lx} 60V${h - 340}M${lx + 48} 60V${h - 340}`, S.dk, 5), stroke(r, S.edge, 4));
    let c = '';
    for (let v = 300; v < h - 380; v += 70) c += `M${lx - 10} ${v}a34 34 0 0 0 68 0`;
    s.push(stroke(c, S.dk, 3));
  }
  if (o.num) {
    s.push(text(w / 2, 760, 'NQ', 64, C.blue, { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 2 }));
    s.push(text(w / 2, 900, '07', 128, C.blue, { 'text-anchor': 'middle', 'font-weight': 800 }));
  }
  // Blue band + hazard band + grime at the foot
  s.push(rect(0, h - 352, w, 40, C.blue), rect(0, h - 352, w, 5, 'rgba(255,255,255,.25)'));
  s.push(hazRect(id, 0, h - 300, w, 250, 64));
  s.push(rect(0, h - 50, w, 50, S.w3), rect(0, h - 50, w, 4, 'rgba(0,0,0,.2)'));
  s.push(rect(0, h - 120, w, 70, 'rgba(70,58,44,.12)'), rect(0, h - 70, w, 20, 'rgba(70,58,44,.14)'));
  s.push(hi(`M0 0H${w * 0.3}V${h}H0Z`, 0.06), lo(`M${w * 0.7} 0H${w}V${h}H${w * 0.7}Z`, 0.04));
  return s.join('');
}

function sillArt(w: number, h: number) {
  return [
    rect(0, 0, w, h, S.w), rect(0, 0, w, 8, 'rgba(255,255,255,.6)'), rect(0, h - 12, w, 12, S.w3),
    rect(0, h * 0.45, w, 16, C.blue),
    seam(`M${w / 3} 8V${h - 12}M${(2 * w) / 3} 8V${h - 12}`, 'rgba(0,0,0,.12)', 2),
    bolts(20, w - 20, h - 22, 40, 3, S.edge),
    rect(0, h - 44, w, 32, 'rgba(70,58,44,.1)'),
  ].join('');
}

function portalArt(w: number, h: number, mark: boolean) {
  const s = [rect(0, 0, w, h, S.w), rect(0, 0, w, 10, 'rgba(255,255,255,.6)'), rect(0, h - 14, w, 14, S.w3)];
  s.push(seam(`M${w * 0.25} 10V${h - 14}M${w * 0.75} 10V${h - 14}`, 'rgba(0,0,0,.1)', 2));
  if (mark) {
    s.push(text(w / 2, h / 2 + 44, 'NAVAIR', 126, C.blue, { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 10, style: 'font-stretch:125%' }));
    s.push(rect(w / 2 - 330, h - 34, 660, 10, C.blue));
    s.push(text(150, h / 2 + 18, 'NQ-07', 42, S.dk, { 'text-anchor': 'middle', family: 'mono', 'font-weight': 700 }), text(w - 150, h / 2 + 18, 'SWL 65 t', 36, S.dk, { 'text-anchor': 'middle', family: 'mono', 'font-weight': 700 }));
  } else {
    s.push(rect(0, h / 2 - 8, w, 16, C.blue));
  }
  return s.join('');
}

function bogieSide(w: number, h: number) {
  const s = [rect(0, 0, w, h, S.graphite), rect(0, 0, w, 10, '#3E434B'), rect(0, h - 16, w, 16, S.graphite2)];
  // equaliser beam silhouettes + wheel housings
  s.push(path(`M20 ${h}L60 60H${w - 60}L${w - 20} ${h}Z`, '#383D45'));
  for (const u of [w / 2 - 180, w / 2, w / 2 + 180]) s.push(circle(u, 90, 22, '#1B1D21'), circle(u, 90, 12, S.edge), circle(u, 90, 5, S.graphite2));
  s.push(hazRect('sts-hz-bogie', 0, 20, 40, h - 36, 20), `<g transform="translate(${w - 40} 0)">${hazRect('sts-hz-bogie2', 0, 20, 40, h - 36, 20)}</g>`);
  s.push(bolts(60, w - 60, 30, 14, 3, '#15171A'));
  return s.join('');
}

function girderSide(len: number, h: number, id: string, readLTR: boolean, festoon = false) {
  // u along the girder from its landside end (readLTR=false → u from the tip).
  const s = [rect(0, 0, len, h, S.w), rect(0, 0, len, 14, 'rgba(255,255,255,.65)'), rect(0, 14, len, 3, 'rgba(0,0,0,.08)'), rect(0, h - 18, len, 18, S.w3)];
  s.push(rect(0, 222, len, 22, C.blue), rect(0, 222, len, 4, 'rgba(255,255,255,.22)'));
  let d = '';
  for (let u = 300; u < len; u += 600) d += `M${u} 17V${h - 18}`;
  s.push(seam(d, 'rgba(0,0,0,.1)', 2.4));
  // stiffener ribs (short)
  let r = '';
  for (let u = 150; u < len; u += 300) r += `M${u} 20V70`;
  s.push(seam(r, 'rgba(0,0,0,.08)', 5));
  // Boom hinge at z −250 and forestay lugs
  const zu = (z: number) => (readLTR ? z - ZTIP : ZEND - z);
  const hx = zu(-250);
  s.push(rect(hx - 40, 0, 80, h, S.w2), circle(hx, h - 60, 34, S.edge), circle(hx, h - 60, 18, S.dk), seam(`M${hx} 0V${h}`, 'rgba(0,0,0,.35)', 3));
  for (const z of [-1900, -3700, 2700]) s.push(path(`M${zu(z) - 40} 0L${zu(z)} -2L${zu(z) + 40} 0Z`, S.edge), circle(zu(z), 26, 14, S.edge));
  // Wordmark on the backreach half, readable from this side
  const mx = zu(1400);
  s.push(text(mx, 204, 'NAVAIR', 112, C.blue, { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 8, style: 'font-stretch:125%' }));
  // Hazard at the tip
  const tu = zu(ZTIP + 200);
  s.push(hazRect(id, Math.min(tu, zu(ZTIP)), 17, 200, h - 35, 50));
  // Floodlights under the girder every 1500
  for (let z = -3800; z < 2600; z += 1500) s.push(lampBox(zu(z) - 26, h - 16, 52, 16, S.lamp));
  // Box-girder plate panels: alternate faint light/dark diaphragm bays read as welded plate, not a flat bar.
  let bay = '';
  for (let u = 0; u < len; u += 1200) bay += `M${u} 17h600V${h - 18}h-600Z`;
  s.push(path(bay, 'rgba(0,0,0,.025)'));
  if (festoon) {
    // Festoon C-track (the cable trolleys hang from it, see FESTOON in createStsCrane).
    const u0 = zu(STS.trolleyMin - 150), u1 = zu(FEST_ANCHOR + 60);
    const a = Math.min(u0, u1), w = Math.abs(u1 - u0);
    s.push(rect(a, h - 30, w, 12, '#4A5059'), rect(a, h - 30, w, 3, '#8A919A'), rect(a, h - 19, w, 2, 'rgba(0,0,0,.3)'));
    let br = '';
    for (let u = a + 40; u < a + w; u += 300) br += `M${f1(u)} ${h - 44}h10v26h-10Z`;
    s.push(path(br, '#5A616B'));
  }
  s.push(lo(`M0 ${h - 60}H${len}V${h - 18}H0Z`, 0.05), hi(`M0 17H${len}V60H0Z`, 0.05));
  return s.join('');
}

function girderTop(len: number, w: number, id: string) {
  // u = z − ZTIP, v across (0 = outer edge side decided by caller)
  const s = [rect(0, 0, len, w, S.w2), rect(0, 0, len, 8, 'rgba(255,255,255,.5)'), rect(0, w - 8, len, 8, 'rgba(0,0,0,.08)')];
  // trolley rail
  s.push(rect(0, w / 2 - 12, len, 24, '#50575F'), rect(0, w / 2 - 5, len, 10, '#9AA1A9'), rect(0, w / 2 - 5, len, 2.5, '#D4D8DD'));
  let c = '';
  for (let u = 40; u < len; u += 120) c += `M${u} ${w / 2 - 17}h14v34h-14Z`;
  s.push(path(c, '#3A3F46'));
  let d = '';
  for (let u = 300; u < len; u += 600) d += `M${u} 0V${w}`;
  s.push(seam(d, 'rgba(0,0,0,.12)', 2));
  const hx = -250 - ZTIP;
  s.push(rect(hx - 40, 0, 80, w, S.w3));
  s.push(hazRect(id, 0, 0, 200, w, 40));
  return s.join('');
}

function railArt(len: number, h: number) {
  let posts = '';
  for (let u = 3; u < len; u += 200) posts += `M${f1(u)} 0h6v${h}h-6Z`;
  return rect(0, 0, len, 6, C.hazard) + rect(0, 0, len, 1.6, 'rgba(255,255,255,.5)') + rect(0, h * 0.48, len, 4, C.hazard) + rect(0, h - 14, len, 12, '#C99A00') + path(posts, C.hazard);
}

function walkwayArt(len: number, w: number, id: string, outerAtV0: boolean) {
  const eo = outerAtV0 ? 0 : w - 10;
  const ei = outerAtV0 ? w - 6 : 0;
  let posts = '';
  for (let u = 20; u < len; u += 200) posts += `M${u} ${eo - 3}h10v16h-10Z`;
  return grating(id, 0, 0, len, w) + rect(0, eo, len, 10, C.hazard) + rect(0, ei, len, 6, S.dk) + path(posts, '#B08400');
}

function houseEnd(w: number, h: number, landside: boolean) {
  const s = [cladding(0, 0, w, h, S.w)];
  s.push(rect(0, 0, w, 26, S.w2), rect(0, 24, w, 3, 'rgba(0,0,0,.12)'), rect(0, h - 70, w, 70, C.blue), rect(0, h - 70, w, 6, 'rgba(255,255,255,.25)'));
  if (landside) {
    s.push(rr(w / 2 - 310, 90, 620, 150, 6, 'rgba(255,255,255,.92)'));
    s.push(text(w / 2, 202, 'NAVAIR', 118, C.blue, { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 8, style: 'font-stretch:125%' }));
    s.push(text(w / 2, 292, 'PORT SYSTEMS · NQ-07', 30, S.dk, { 'text-anchor': 'middle', family: 'mono', 'font-weight': 600, 'letter-spacing': 4 }));
  } else {
    s.push(louvres(80, 90, 280, 260, 14, S.w3, S.w, S.dk), louvres(w - 360, 90, 280, 260, 14, S.w3, S.w, S.dk));
    s.push(text(w / 2, 220, 'NQ-07', 90, C.blue, { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 4 }));
  }
  // door + landing
  s.push(rr(w - 170, h - 330, 110, 250, 4, S.w3), rr(w - 162, h - 322, 94, 234, 3, S.w2), rr(w - 90, h - 200, 16, 6, 2, S.dk));
  s.push(lampBox(w - 150, h - 360, 70, 22, S.lamp));
  s.push(hi(`M0 27H${w}V60H0Z`, 0.06), lo(`M0 ${h - 110}H${w}V${h - 70}H0Z`, 0.06));
  return s.join('');
}

function houseSide(w: number, h: number) {
  const s = [cladding(0, 0, w, h, S.w)];
  s.push(rect(0, 0, w, 26, S.w2), rect(0, h - 70, w, 70, C.blue), rect(0, h - 70, w, 6, 'rgba(255,255,255,.25)'));
  for (let i = 0; i < 4; i++) s.push(louvres(60 + i * 230, 110, 170, 150, 12, S.w3, S.w, S.dk));
  s.push(rr(60, 300, 160, 100, 4, S.glass), rr(66, 306, 60, 88, 3, 'rgba(255,255,255,.12)'));
  s.push(text(w - 60, 360, 'NAVAIR', 64, C.blue, { 'text-anchor': 'end', 'font-weight': 800, 'letter-spacing': 5, style: 'font-stretch:125%' }));
  return s.join('');
}

function houseRoof(w: number, h: number) {
  const s = [rect(0, 0, w, h, S.w2), rect(0, 0, w, 12, 'rgba(255,255,255,.5)'), rect(0, h - 12, w, 12, S.w3)];
  let d = '';
  for (let v = 60; v < h; v += 120) d += `M0 ${v}H${w}`;
  s.push(seam(d, 'rgba(0,0,0,.08)', 3));
  s.push(rr(60, 60, 260, 200, 10, S.w3), louvres(80, 80, 220, 160, 12, S.edge, S.w2, S.dk));
  s.push(rr(60, 320, 260, 200, 10, S.w3), circle(190, 420, 80, S.edge), circle(190, 420, 66, S.dk), stroke('M190 354V486M124 420H256', S.edge, 6));
  s.push(rr(w - 320, 60, 260, 460, 10, S.w3), louvres(w - 300, 80, 220, 420, 14, S.edge, S.w2, S.dk));
  s.push(text(w / 2, h - 170, 'NAVAIR', 150, C.blue, { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 12, style: 'font-stretch:125%', opacity: 0.95 }));
  s.push(rect(w / 2 - 360, h - 140, 720, 14, C.blue));
  s.push(hazRect('sts-hz-roof', 0, h - 40, w, 28, 40));
  return s.join('');
}

/* Trolley / cab / spreader -------------------------------------------------- */

function trolleyTop(w: number, h: number) {
  // u = x + 520, v = z + 300
  const s = [rect(0, 0, w, h, S.w2), rect(0, 0, w, 10, 'rgba(255,255,255,.5)'), rect(0, h - 10, w, 10, S.w3)];
  s.push(grating('sts-tr-grate', 20, 20, w - 40, h - 40));
  // hoist drums
  for (const u of [180, w - 380]) {
    s.push(rr(u, 110, 200, 150, 14, S.graphite), rr(u + 10, 120, 180, 130, 12, '#474D56'));
    let wr = '';
    for (let k = 0; k < 16; k++) wr += `M${u + 16 + k * 11} 124v122`;
    s.push(stroke(wr, '#2A2D32', 3));
    s.push(rr(u + 30, 300, 140, 110, 10, C.blue), rr(u + 40, 310, 120, 90, 8, tint(C.blue, 0.12)), rect(u + 40, 310, 120, 6, 'rgba(255,255,255,.3)'));
  }
  // sheaves
  for (const [u, v] of [[w / 2 - 200, 230], [w / 2 + 200, 230], [w / 2 - 200, 370], [w / 2 + 200, 370]]) {
    s.push(circle(u, v, 34, S.graphite), circle(u, v, 24, '#565C66'), circle(u, v, 8, S.graphite2));
  }
  s.push(rr(w / 2 - 90, 470, 180, 90, 8, S.w3), text(w / 2, 528, 'NQ-07', 30, C.blue, { 'text-anchor': 'middle', 'font-weight': 800 }));
  s.push(hazRect('sts-hz-tr1', 0, 0, 60, h, 30), `<g transform="translate(${w - 60} 0)">${hazRect('sts-hz-tr2', 0, 0, 60, h, 30)}</g>`);
  return s.join('');
}

function trolleySide(w: number, h: number, mark: boolean) {
  const s = [rect(0, 0, w, h, S.w), rect(0, 0, w, 8, 'rgba(255,255,255,.6)'), rect(0, h - 16, w, 16, S.w3), rect(0, 60, w, 16, C.blue)];
  s.push(louvres(60, 20, 160, 36, 8, S.w3, S.w, S.dk), louvres(w - 220, 20, 160, 36, 8, S.w3, S.w, S.dk));
  if (mark) s.push(text(w / 2, 52, 'NAVAIR', 38, C.blue, { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 4 }));
  s.push(lampBox(20, 90, 60, 30, S.lamp), lampBox(w - 80, 90, 60, 30, S.lamp));
  s.push(bolts(20, w - 20, h - 8, Math.round(w / 40), 2.6, S.edge));
  return s.join('');
}

function cabFront(w: number, h: number) {
  // Raked, fully glazed front with a centre mullion, sun visor, wipers and the operator silhouette.
  const g = `M14 40H${w - 14}L${w - 30} ${h - 34}H30Z`;
  return [
    rect(0, 0, w, h, S.w), rect(0, 0, w, 28, S.w2), rect(0, 26, w, 3, 'rgba(0,0,0,.12)'), rect(0, h - 22, w, 22, C.blue), rect(0, h - 22, w, 3, 'rgba(255,255,255,.25)'),
    path(g, S.glass),
    path(`M14 40H${w - 14}L${w - 16} 70H16Z`, 'rgba(10,14,20,.55)'), // visor shadow
    path(`M14 40H${w * 0.45}L30 ${h * 0.72}L22 ${h * 0.5}Z`, 'rgba(255,255,255,.13)'),
    path(`M${w * 0.62} 40H${w * 0.72}L${w * 0.52} ${h - 34}H${w * 0.42}Z`, 'rgba(255,255,255,.07)'),
    circle(w / 2 - 40, h - 128, 26, S.glassDk), rr(w / 2 - 84, h - 104, 90, 70, 12, S.glassDk), rr(w / 2 + 30, h - 90, 70, 12, 3, '#2C4A66'), rr(w / 2 + 40, h - 88, 20, 6, 2, '#7FD3FF'),
    stroke(g, '#11151A', 5), stroke(`M${w / 2} 40V${h - 34}`, '#11151A', 4),
    stroke(`M${w * 0.3} ${h - 40}L${w * 0.2} ${h - 150}M${w * 0.7} ${h - 40}L${w * 0.8} ${h - 150}`, '#0B0D10', 3),
    rect(8, 28, w - 16, 10, S.dk), lampBox(20, 4, 54, 18, S.lamp), lampBox(w - 74, 4, 54, 18, S.lamp), rr(w / 2 - 14, 6, 28, 14, 3, S.red),
  ].join('');
}
function cabSide(w: number, h: number) {
  const g = `M14 40H${w - 14}V${h - 34}H14Z`;
  return [
    rect(0, 0, w, h, S.w), rect(0, 0, w, 28, S.w2), rect(0, 26, w, 3, 'rgba(0,0,0,.12)'), rect(0, h - 22, w, 22, C.blue), rect(0, h - 22, w, 3, 'rgba(255,255,255,.25)'),
    path(g, S.glass), rect(14, 40, w - 28, 26, 'rgba(10,14,20,.5)'),
    path(`M14 40H${w * 0.5}L14 ${h * 0.74}Z`, 'rgba(255,255,255,.1)'), path(`M${w * 0.62} 40H${w * 0.7}L${w * 0.3} ${h - 34}H${w * 0.22}Z`, 'rgba(255,255,255,.06)'),
    rr(w * 0.46, h - 150, 64, 116, 10, S.glassDk), circle(w * 0.46 + 32, h - 172, 24, S.glassDk),
    stroke(g, '#11151A', 5), stroke(`M${w / 2} 40V${h - 34}M14 ${h * 0.62}H${w - 14}`, '#11151A', 3.4),
    rr(w - 30, h * 0.45, 8, 30, 2, S.dk),
  ].join('');
}

const EB: P2[] = [[-134, 30], [-122, 0], [122, 0], [134, 30], [134, 62], [-134, 62]];

function endBeamCap(id: string) {
  const ol = polyD(EB.map(([x, y]) => [x + 134, 62 - y] as P2));
  return [
    hazPoly(id, ol, 0, 0, 268, 62, 22),
    rect(0, 0, 268, 9, '#1E2126'), rect(0, 0, 268, 2, 'rgba(255,255,255,.15)'),
    path('M0 32L12 62H34V38H0Z', '#1B1D22'), path('M268 32L256 62H234V38H268Z', '#1B1D22'),
    circle(20, 50, 4, C.steel400), circle(248, 50, 4, C.steel400),
    rr(110, 14, 48, 13, 2, '#1E2126'), text(134, 24, 'NAVAIR', 8, C.hazard, { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 1 }),
  ].join('');
}

/* ------------------------------------------------------------------------ */
/* Public API                                                                */
/* ------------------------------------------------------------------------ */

export interface StsPose {
  /** Local z of the spreader centre. */
  trolley: number;
  /** Spreader underside height (world y, crane root assumed at ground). */
  hoist: number;
  /** 0 unlocked .. 1 locked. */
  twist: number;
  /**
   * Spreader pendulum along the boom (trolley direction, crane local Z), degrees. + swings toward +Z (landside).
   * The four-rope reeving keeps the spreader level: it translates on the rope arc (and rises slightly).
   */
  sway?: number;
  /** Spreader pendulum across the boom (crane local X, gantry direction), degrees. + swings toward +X. */
  swayX?: number;
  /** Gantry travel along the rails (crane local X), cm. Bogie wheels and the cable reel turn with it. */
  gantry?: number;
  /** Headblock / spreader skew about vertical, degrees (trim ±5° typical, 90 turns the box across the boom). */
  headblock?: number;
}

export interface StsCrane {
  root: Node3;
  pose: StsPose;
  apply(): void;
  /**
   * World frame for a container hanging from the spreader: p = container floor centre, yaw = container r.y
   * (long axis along crane local X at headblock 0). Includes gantry, sway and headblock. r = full Euler (level, so x = z = 0).
   */
  seat(): { p: V3; yaw: number; r: { x: number; y: number; z: number } };
  GAUGE: number;
  OUTREACH: number;
  BACKREACH: number;
  BOOM_Y: number;
}

export function createStsCrane(): StsCrane {
  const root = new Node3('stscrane');
  /** Everything that travels with the gantry (pose.gantry along local X). */
  const G = root.node('sts-gantry', [0, 0, 0]);

  /* ---- gantry: bogies, sills, legs, portal beams ---------------------- */
  const gWheels: Node3[] = [];
  const sillEnd = rect(0, 0, 160, 220, S.w2) + rect(0, 0, 160, 8, 'rgba(255,255,255,.5)') + hazRect('sts-hz-sillend', 0, 150, 160, 58, 24) + rect(0, 99, 160, 16, C.blue);
  const portalEnd = rect(0, 0, 220, 200, S.w2) + rect(0, 0, 220, 10, 'rgba(255,255,255,.55)') + rect(0, 92, 220, 16, C.blue) + lampBox(80, 130, 60, 22, S.lamp);
  const wheelDisc = circle(0, 0, 45, S.graphite) + circle(0, 0, 34, '#565C66') + circle(0, 0, 14, S.graphite2) + rect(-3, -34, 6, 20, '#3A3F46') + rect(-3, 14, 6, 20, '#3A3F46');
  for (const zr of [0, GAUGE]) {
    for (const xs of [-1, 1]) {
      const xc = xs * LX;
      box(G, xc - 290, 90, zr - 75, 580, 210, 150, {
        pz: bogieSide(580, 210), nz: bogieSide(580, 210),
        px: rect(0, 0, 150, 210, S.graphite) + hazRect(`sts-hz-bpx${zr}${xs}`, 0, 20, 150, 40, 20),
        nx: rect(0, 0, 150, 210, S.graphite) + hazRect(`sts-hz-bnx${zr}${xs}`, 0, 20, 150, 40, 20),
        py: rect(0, 0, 580, 150, '#3A3F46') + rect(0, 0, 580, 6, 'rgba(255,255,255,.12)') + bolts(20, 560, 75, 12, 4, '#1B1D21'),
      }, { name: `sts-bogie${zr}${xs}` });
      for (const dx of [-210, -70, 70, 210]) {
        const w = G.node(`sts-wheel${zr}${xs}${dx}`, [xc + dx, 45, zr]);
        w.wheel({ r: 45, w: 46, tread: '#1A1C20', disc: wheelDisc });
        gWheels.push(w);
      }
    }
    box(G, -930, 300, zr - 80, 1860, 220, 160, {
      pz: sillArt(1860, 220), nz: sillArt(1860, 220),
      py: rect(0, 0, 1860, 160, S.w2) + rect(0, 0, 1860, 6, 'rgba(255,255,255,.5)') + rect(0, 70, 1860, 20, C.blue),
      px: sillEnd, nx: sillEnd,
    }, { name: `sts-sill${zr}` });
  }
  // Legs rest on the sills
  const legH = STS.legY1 - STS.legY0;
  for (const zr of [0, GAUGE]) {
    for (const xs of [-1, 1]) {
      const xc = xs * LX;
      const id = `sts-hz-leg${zr}${xs}`;
      box(G, xc - STS.legHX, STS.legY0, zr - STS.legHZ, 2 * STS.legHX, legH, 2 * STS.legHZ, {
        pz: legArt(160, legH, `${id}a`, { num: zr === GAUGE }),
        nz: legArt(160, legH, `${id}b`, { num: zr === 0 }),
        px: legArt(200, legH, `${id}c`, { ladder: xs < 0 }),
        nx: legArt(200, legH, `${id}d`, { ladder: xs > 0 }),
      }, { name: `sts-leg${zr}${xs}` });
    }
    box(G, -940, STS.legY1, zr - 110, 1880, BOOM_Y - STS.legY1, 220, {
      pz: portalArt(1880, 200, zr === GAUGE), nz: portalArt(1880, 200, zr === 0),
      py: rect(0, 0, 1880, 220, S.w2) + rect(0, 0, 1880, 8, 'rgba(255,255,255,.5)'),
      ny: rect(0, 0, 1880, 220, S.w3) + bolts(40, 1840, 110, 30, 4, S.edge),
      px: portalEnd, nx: portalEnd,
    }, { name: `sts-portal${zr}` });
  }
  // Stair tower on the landside legs
  const stairArt = (() => {
    const w = 300, h = STS.legY1 - STS.legY0;
    const s: string[] = [];
    let flights = '', treads = '';
    const fl = 360;
    for (let i = 0, v = h; v > fl; i++, v -= fl) {
      const a = i % 2 === 0;
      const x0 = a ? 20 : w - 20, x1 = a ? w - 20 : 20;
      flights += `M${x0} ${v}L${x1} ${v - fl}`;
      for (let k = 1; k < 12; k++) {
        const t = k / 12;
        const x = x0 + (x1 - x0) * t, y = v - fl * t;
        treads += `M${f1(x - 10)} ${f1(y)}h20`;
      }
      s.push(rect(0, v - fl - 8, w, 10, S.grate));
    }
    s.push(stroke(flights, S.dk, 7), stroke(treads, S.edge, 4));
    s.push(stroke(flights.replace(/(\d+(\.\d+)?) (\d+(\.\d+)?)/g, (_m, x, _a, y) => `${x} ${Number(y) - 50}`), C.hazard, 3.2));
    s.push(stroke(`M4 0V${h}M${w - 4} 0V${h}`, S.edge, 6));
    return s.join('');
  })();
  for (const xs of [-1, 1]) {
    G.face({ o: [xs * LX - 150, STS.legY1, GAUGE + STS.legHZ + 60], a: [1, 0, 0], b: [0, -1, 0], w: 300, h: STS.legY1 - STS.legY0, art: stairArt, shade: 0, bias: 40, name: `sts-stair${xs}` });
  }

  // Power cable reel on the landside sill (drum axis across the rails)
  const reel = G.node('sts-cablereel', [-1090, 484, GAUGE]);
  {
    let wraps = '';
    for (let r = 70; r < 138; r += 9) wraps += `M${r} 0A${r} ${r} 0 1 0 ${-r} 0A${r} ${r} 0 1 0 ${r} 0`;
    reel.wheel({
      r: 160, w: 70, tread: '#23262B',
      disc: circle(0, 0, 160, C.blue) + circle(0, 0, 140, '#1E2126') + stroke(wraps, '#2E3239', 3) + circle(0, 0, 62, tint(C.blue, 0.1)) + circle(0, 0, 24, S.edge) + rect(-6, -150, 12, 90, tint(C.blue, 0.25)) + rect(-6, 60, 12, 90, tint(C.blue, 0.25)),
    });
    box(G, -1260, 300, GAUGE - 70, 340, 22, 140, {
      pz: rect(0, 0, 340, 22, S.graphite) + hazRect('sts-hz-reel', 0, 0, 340, 22, 16),
      nz: rect(0, 0, 340, 22, S.graphite),
      py: rect(0, 0, 340, 140, '#3A3F46') + rect(150, 0, 40, 140, S.graphite2),
    }, { name: 'sts-reelbase' });
  }

  /* ---- twin girders + walkways ---------------------------------------- */
  const gh = STS.girderD, gw = 2 * STS.gHalf;
  for (const xs of [1, -1]) {
    const xo = xs * (GX + STS.gHalf), xi = xs * (GX - STS.gHalf);
    // outer side
    const side: FaceDef = xs > 0
      ? { o: [xo, GT, ZEND], a: [0, 0, -1], b: [0, -1, 0], w: GLEN, h: gh, art: girderSide(GLEN, gh, `sts-hz-g${xs}`, false, xs === FEST_SIDE), name: `sts-gside${xs}` }
      : { o: [xo, GT, ZTIP], a: [0, 0, 1], b: [0, -1, 0], w: GLEN, h: gh, art: girderSide(GLEN, gh, `sts-hz-g${xs}`, true, xs === FEST_SIDE), name: `sts-gside${xs}` };
    splitFace(G, side, 8);
    // inner side (plain)
    const inArt = rect(0, 0, GLEN, gh, S.w2) + rect(0, 0, GLEN, 10, 'rgba(255,255,255,.4)') + rect(0, gh - 16, GLEN, 16, S.w3);
    splitFace(G, xs > 0
      ? { o: [xi, GT, ZTIP], a: [0, 0, 1], b: [0, -1, 0], w: GLEN, h: gh, art: inArt, name: `sts-gin${xs}` }
      : { o: [xi, GT, ZEND], a: [0, 0, -1], b: [0, -1, 0], w: GLEN, h: gh, art: inArt, name: `sts-gin${xs}` }, 3);
    // top (u = z − ZTIP, v from +x edge toward −x)
    splitFace(G, { o: [xs * GX + STS.gHalf, GT, ZTIP], a: [0, 0, 1], b: [-1, 0, 0], w: GLEN, h: gw, art: girderTop(GLEN, gw, `sts-hz-gt${xs}`), name: `sts-gtop${xs}` }, 8);
    // bottom
    splitFace(G, { o: [xs * GX - STS.gHalf, BOOM_Y, ZTIP], a: [0, 0, 1], b: [1, 0, 0], w: GLEN, h: gw, art: rect(0, 0, GLEN, gw, S.w3) + rect(0, gw / 2 - 4, GLEN, 8, S.edge), name: `sts-gbot${xs}` }, 2);
    // walkway deck outside the girder
    const wz0 = ZTIP + 60, wz1 = GAUGE + 200;
    splitFace(G, {
      o: [xs > 0 ? GX + STS.gHalf + 115 : -(GX + STS.gHalf), GT, wz0], a: [0, 0, 1], b: [-1, 0, 0], w: wz1 - wz0, h: 115,
      art: walkwayArt(wz1 - wz0, 115, `sts-grate${xs}`, xs > 0), shade: 0.5, name: `sts-walk${xs}`,
    }, 4);
    // Handrail on the walkway's outer edge (top rail, knee rail, toe board, posts every 2 m).
    splitFace(G, {
      o: [xs * (GX + STS.gHalf + 113), GT + 110, wz0], a: [0, 0, 1], b: [0, -1, 0], w: wz1 - wz0, h: 110,
      art: railArt(wz1 - wz0, 110), double: true, shade: 0, name: `sts-rail${xs}`,
    }, 4);
  }
  // Tip nose + backreach end cap
  box(G, -GX - STS.gHalf - 20, BOOM_Y + 20, ZTIP - 90, 2 * (GX + STS.gHalf + 20), gh - 20, 90, {
    nz: (() => {
      const w = 2 * (GX + STS.gHalf + 20), h = gh - 20;
      return rect(0, 0, w, h, S.w) + rect(0, 0, w, 10, 'rgba(255,255,255,.6)') + hazRect('sts-hz-nose', 0, h - 70, w, 56, 50) + lampBox(40, 30, 90, 36, S.lamp) + lampBox(w - 130, 30, 90, 36, S.lamp) + text(w / 2, 90, 'NQ-07', 60, C.blue, { 'text-anchor': 'middle', 'font-weight': 800 });
    })(),
    py: rect(0, 0, 2 * (GX + STS.gHalf + 20), 90, S.w2) + hazRect('sts-hz-nosetop', 0, 0, 2 * (GX + STS.gHalf + 20), 90, 50),
    px: rect(0, 0, 90, gh - 20, S.w2), nx: rect(0, 0, 90, gh - 20, S.w2),
  }, { name: 'sts-nose' });
  box(G, -GX - STS.gHalf, BOOM_Y, ZEND, 2 * (GX + STS.gHalf), gh, 60, {
    pz: rect(0, 0, 2 * (GX + STS.gHalf), gh, S.w) + rect(0, gh - 60, 2 * (GX + STS.gHalf), 40, C.blue) + lampBox(60, 40, 90, 34, S.red),
    py: rect(0, 0, 2 * (GX + STS.gHalf), 60, S.w2),
  }, { name: 'sts-tail' });

  /* ---- A-frame, apex, stays ------------------------------------------- */
  const [AZ, AY] = STS.apex;
  const strut = (name: string, x: number, z0: number, zTop: number) => {
    const dz = zTop - z0, dy = AY - GT;
    const L = Math.hypot(dz, dy);
    const n = G.node(name, [x, GT, z0]);
    n.r.y = -90;
    n.r.z = Math.atan2(dy, dz) / DEG;
    const face = (w: number, h: number, band: boolean) => rect(0, 0, w, h, S.w) + rect(0, 0, w, 6, 'rgba(255,255,255,.5)') + rect(0, h - 8, w, 8, S.w3) + (band ? rect(w * 0.18, 0, 30, h, C.blue) : '') + seam(`M${w * 0.5} 0V${h}`, 'rgba(0,0,0,.1)', 2);
    box(n, 0, -45, -50, L, 90, 100, { pz: face(L, 90, true), nz: face(L, 90, true), py: face(L, 100, false), ny: face(L, 100, false) }, { name });
  };
  for (const xs of [-1, 1]) {
    strut(`sts-afront${xs}`, xs * GX, -150, AZ);
    strut(`sts-aback${xs}`, xs * GX, 1350, AZ);
  }
  // A-frame cross ties (front + back leg pairs) and portal knee braces: the structure reads as braced steel.
  for (const [z0, nm] of [[-150, 'f'], [1350, 'b']] as const) {
    const t = 0.46, y = GT + (AY - GT) * t, z = z0 + (AZ - z0) * t;
    cylinder(G, `sts-atie-${nm}`, [-GX, y, z], [GX, y, z], 20, S.w2, circle(0, 0, 20, S.w3) + circle(0, 0, 12, S.edge));
  }
  for (const zr of [0, GAUGE]) {
    for (const xs of [-1, 1]) {
      const xin = xs * (LX - STS.legHX);
      cylinder(G, `sts-knee${zr}${xs}`, [xin, STS.legY1 - 560, zr], [xin - xs * 460, STS.legY1, zr], 22, S.w2, circle(0, 0, 22, S.w3) + circle(0, 0, 13, S.edge));
    }
  }
  box(G, -GX - 120, AY - 40, AZ - 80, 2 * GX + 240, 150, 160, {
    pz: rect(0, 0, 2 * GX + 240, 150, S.w) + rect(0, 0, 2 * GX + 240, 8, 'rgba(255,255,255,.6)') + rect(0, 90, 2 * GX + 240, 22, C.blue) + text(GX + 120, 70, 'NAVAIR', 54, C.blue, { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 5 }),
    nz: rect(0, 0, 2 * GX + 240, 150, S.w) + rect(0, 90, 2 * GX + 240, 22, C.blue) + text(GX + 120, 70, 'NQ-07', 54, C.blue, { 'text-anchor': 'middle', 'font-weight': 800 }),
    py: rect(0, 0, 2 * GX + 240, 160, S.w2) + hazRect('sts-hz-apex', 0, 0, 60, 160, 30) + `<g transform="translate(${2 * GX + 180} 0)">${hazRect('sts-hz-apex2', 0, 0, 60, 160, 30)}</g>`,
  }, { name: 'sts-apex' });
  const av = G.node('sts-aviation', [0, AY + 130, AZ]);
  av.r.x = -90;
  av.wheel({ r: 14, w: 26, tread: S.red, disc: circle(0, 0, 14, '#FF5A5E') + circle(0, 0, 6, '#FFD0D0') });
  cylinder(G, 'sts-aviation-mast', [0, AY + 110, AZ], [0, AY + 20, AZ], 5, S.dk);
  for (const xs of [-1, 1]) {
    const top: V3 = [xs * GX, AY + 20, AZ];
    cylinder(G, `sts-fstay1${xs}`, top, [xs * GX, GT, -1900], 11, '#B9BFC7');
    cylinder(G, `sts-fstay2${xs}`, top, [xs * GX, GT, -3700], 11, '#B9BFC7');
    cylinder(G, `sts-bstay${xs}`, top, [xs * GX, GT, GAUGE], 13, '#B9BFC7');
  }

  /* ---- machinery house ------------------------------------------------ */
  const HZ0 = GAUGE + 250, HZ1 = GAUGE + 1250, HX = 560, HH = 580;
  box(G, -HX, GT, HZ0, 2 * HX, HH, HZ1 - HZ0, {
    pz: houseEnd(2 * HX, HH, true), nz: houseEnd(2 * HX, HH, false),
    px: houseSide(HZ1 - HZ0, HH), nx: houseSide(HZ1 - HZ0, HH),
    py: houseRoof(2 * HX, HZ1 - HZ0),
  }, { name: 'sts-house' });

  /* ---- trolley + cab (moves along z) ---------------------------------- */
  const trolley = G.node('sts-trolley', [0, GT, 0]);
  box(trolley, -520, 30, -300, 1040, 150, 600, {
    py: trolleyTop(1040, 600),
    pz: trolleySide(1040, 150, true), nz: trolleySide(1040, 150, true),
    px: trolleySide(600, 150, false), nx: trolleySide(600, 150, false),
  }, { name: 'sts-trolleybox' });
  const tWheels: Node3[] = [];
  for (const xs of [-1, 1]) for (const zs of [-1, 1]) {
    const w = trolley.node(`sts-twheel${xs}${zs}`, [xs * GX, 32, zs * 230]);
    w.r.y = 90;
    w.wheel({ r: 32, w: 30, tread: '#2A2D32', disc: circle(0, 0, 32, '#3A3F46') + circle(0, 0, 12, S.edge) + rect(-3, -28, 6, 16, S.graphite2) });
    tWheels.push(w);
  }
  // Hoist sheaves standing proud of the trolley deck (the ropes drop through them), axis along X.
  const sheaves: Node3[] = [];
  for (const xs of [-1, 1]) for (const zs of [-1, 1]) {
    const sh = trolley.node(`sts-sheave${xs}${zs}`, [xs * 200, 186, zs * 70]);
    sh.r.y = 90;
    sh.wheel({
      r: 42, w: 16, tread: '#50565F',
      disc: circle(0, 0, 42, '#2E3239') + circle(0, 0, 36, '#6A717B') + circle(0, 0, 30, '#454B54') + circle(0, 0, 11, S.edge) + circle(0, 0, 5, S.graphite2) +
        rect(-2.5, -29, 5, 18, '#3A3F46') + rect(-2.5, 11, 5, 18, '#3A3F46') + rect(-29, -2.5, 18, 5, '#3A3F46') + rect(11, -2.5, 18, 5, '#3A3F46'),
    });
    sheaves.push(sh);
  }
  const CZ0 = -560, CZ1 = -320, CY0 = -600, CY1 = -270;
  box(trolley, -150, CY0, CZ0, 300, CY1 - CY0, CZ1 - CZ0, {
    nz: cabFront(300, CY1 - CY0), pz: cabSide(300, CY1 - CY0),
    px: cabSide(CZ1 - CZ0, CY1 - CY0), nx: cabSide(CZ1 - CZ0, CY1 - CY0),
    py: rect(0, 0, 300, CZ1 - CZ0, S.w2) + rr(40, 40, 220, 160, 8, S.w3) + lampBox(20, 10, 60, 20, S.lamp),
    ny: rect(0, 0, 300, CZ1 - CZ0, S.w3) + rr(40, 30, 220, 180, 6, S.glass) + path('M40 30H160L40 150Z', 'rgba(255,255,255,.1)'),
  }, { name: 'sts-cab' });
  for (const xs of [-1, 1]) cylinder(trolley, `sts-hanger${xs}`, [xs * 110, CY1, (CZ0 + CZ1) / 2], [xs * 110, 30, (CZ0 + CZ1) / 2], 9, '#9AA1A9');

  /* ---- ropes, headblock, spreader ------------------------------------ */
  // Every rope is a unit-length round bar re-aimed between its two end points each apply(): the reeving stays
  // taut and correct for any trolley / hoist / sway / headblock skew.
  const rod = (name: string, r: number, tread: string) => {
    const n = G.node(name);
    n.wheel({ r, w: 1, tread, disc: circle(0, 0, r, tread) });
    return n;
  };
  const aim = (n: Node3, a: V3, b: V3) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = Math.max(Math.hypot(dx, dy, dz), 0.5);
    n.p = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    n.r.y = Math.atan2(dx, dz) / DEG;
    n.r.x = -Math.asin(clamp(dy / L, -1, 1)) / DEG;
    n.k = [1, 1, L];
  };
  /** Hoist falls: trolley sheave (top) → headblock sheave (bottom), a slight trapezoid like real 4-fall reeving. */
  const ropes: { n: Node3; xs: number; zs: number }[] = [];
  for (const xs of [-1, 1]) for (const zs of [-1, 1]) {
    ropes.push({ n: rod(`sts-rope${xs > 0 ? 'p' : 'n'}${zs > 0 ? 'p' : 'n'}`, 3.5, '#2B2E33'), xs, zs });
  }
  /** Main hoist ropes running along the boom: trolley ↔ boom-tip anchor, trolley ↔ machinery-house drums. */
  const runs: { n: Node3; xs: number; tip: boolean }[] = [];
  for (const xs of [-1, 1]) for (const tip of [true, false]) runs.push({ n: rod(`sts-run${xs}${tip ? 't' : 'h'}`, 3, '#3A3E45'), xs, tip });

  const spr = G.node('sts-spreader', [0, 0, 0]);
  const HT = STS.headTop;
  box(spr, -230, 62, -100, 460, HT - 62, 200, {
    py: rect(0, 0, 460, 200, S.w2) + circle(90, 100, 50, S.graphite) + circle(90, 100, 36, '#565C66') + circle(370, 100, 50, S.graphite) + circle(370, 100, 36, '#565C66') + rr(170, 60, 120, 80, 8, C.blue) + hazRect('sts-hz-hb', 0, 0, 30, 200, 20) + `<g transform="translate(430 0)">${hazRect('sts-hz-hb2', 0, 0, 30, 200, 20)}</g>`,
    pz: rect(0, 0, 460, HT - 62, S.w) + rect(0, 26, 460, 14, C.blue) + bolts(20, 440, 10, 12, 2.4, S.edge),
    nz: rect(0, 0, 460, HT - 62, S.w) + rect(0, 26, 460, 14, C.blue),
    px: rect(0, 0, 200, HT - 62, S.w2) + hazRect('sts-hz-hbx', 0, 0, 200, 20, 20), nx: rect(0, 0, 200, HT - 62, S.w2) + hazRect('sts-hz-hbx2', 0, 0, 200, 20, 20),
  }, { name: 'sts-headblock' });
  const beamSide = () => {
    const w = 1160, h = 44;
    const s = [rect(0, 0, w, h, '#23262C'), rect(0, 0, w, 4, '#3A3F48'), rect(0, h - 5, w, 5, '#16181C')];
    s.push(seam('M300 5V39M860 5V39', 'rgba(0,0,0,.4)', 1.4), stroke('M20 31H1140', '#111317', 3.2), stroke('M20 30H1140', 'rgba(255,255,255,.1)', 0.8));
    // telescope cylinders drawn along the beam
    s.push(rr(120, 12, 260, 12, 6, C.steel500), rr(780, 12, 260, 12, 6, C.steel500), rr(380, 15, 120, 6, 3, C.steel200), rr(660, 15, 120, 6, 3, C.steel200));
    const t = text(w / 2, 28, 'NAVAIR · SWL 65 t', 12, C.hazard, { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 1.5 });
    s.push(t);
    s.push(bolts(12, w - 12, 8, 40, 1.4, '#15171B'));
    return s.join('');
  };
  box(spr, -580, 18, -32, 1160, 44, 64, {
    pz: beamSide(), nz: beamSide(),
    py: rect(0, 0, 1160, 64, '#2A2E35') + rect(0, 0, 1160, 4, '#3A3F48') + rect(0, 60, 1160, 4, '#3A3F48') + rect(20, 28, 1120, 8, '#15171B') + rect(20, 28, 1120, 1.5, 'rgba(255,255,255,.12)'),
    ny: rect(0, 0, 1160, 64, '#15171B'),
  }, { name: 'sts-beam' });
  const ebEdge = (i: number, len: number, d: number) => {
    if (i === 1) return null;
    if (i === 4) return rect(0, 0, len, d, '#2A2E35') + rect(0, 0, len, 4, C.hazard) + rect(0, d - 4, len, 4, C.hazard);
    if (i === 3 || i === 5) return hazRect(`sts-hz-ebend${i}${len}`, 0, 0, len, d, 12) + lampBox(len / 2 - 7, d / 2 - 7, 14, 14, '#FF9E1B');
    return rect(0, 0, len, d, '#1B1D22');
  };
  for (const xs of [1, -1]) {
    const eb = spr.node(`sts-endbeam${xs}`, [xs * STS.tlX, 0, 0]);
    eb.r.y = xs * 90;
    // cap + edges (profile in child XY, extruded along child Z = outward)
    const minX = -134, maxY = 62;
    const art2 = EB.map(([x, y]) => [x - minX, maxY - y] as P2);
    eb.face({ o: [minX, maxY, 20], a: [1, 0, 0], b: [0, -1, 0], w: 268, h: 62, art: endBeamCap(`sts-hz-eb${xs}`), outline: polyD(art2), name: `sts-eb${xs}.f` });
    eb.face({ o: [134, maxY, -20], a: [-1, 0, 0], b: [0, -1, 0], w: 268, h: 62, art: `<g transform="translate(268 0) scale(-1 1)">${path(polyD(art2), '#25282E')}${rect(16, 40, 236, 4, C.hazard)}</g>`, outline: polyD(art2.map(([u, v]) => [268 - u, v] as P2)), name: `sts-eb${xs}.b` });
    for (let i = 0; i < EB.length; i++) {
      const p = EB[i], q = EB[(i + 1) % EB.length];
      const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
      const art = ebEdge(i, len, 40);
      if (!art) continue;
      eb.face({ o: [p[0], p[1], 20], a: [dx / len, dy / len, 0], b: [0, 0, -1], w: len, h: 40, art, name: `sts-eb${xs}.e${i}` });
    }
  }
  const locks: Node3[] = [];
  const coneW = 'M1 0H15L13 7L10 12H6L3 7Z';
  const coneN = 'M0.5 0H8.5L7.5 7L6 12H3L1.5 7Z';
  for (let i = 0; i < 4; i++) {
    const tl = spr.node(`sts-twistlock-${i + 1}`, [0, 0, 0]);
    tl.face({ o: [-8, 0, 0], a: [1, 0, 0], b: [0, -1, 0], w: 16, h: 12, art: path(coneW, C.steel300) + rect(1, 0, 14, 2, C.steel100), outline: coneW, double: true, shade: 0.6, name: `sts-tl${i}.w` });
    tl.face({ o: [0, 0, 4.5], a: [0, 0, -1], b: [0, -1, 0], w: 9, h: 12, art: path(coneN, C.steel400), outline: coneN, double: true, shade: 0.6, name: `sts-tl${i}.n` });
    tl.face({
      o: [-16, 92, 0], a: [1, 0, 0], b: [0, -1, 0], w: 32, h: 30, double: true, shade: 0,
      art: rect(14, 12, 4, 18, C.steel700) + rr(0, 0, 32, 13, 2.5, C.hazard) + rect(0, 5, 32, 3, C.ink),
      name: `sts-tl${i}.flag`,
    });
    locks.push(tl);
  }

  /* ---- festoon: cable trolleys on the girder-side C-track ------------- */
  // FEST_N spans between the trolley's landside end and the fixed anchor. Cars run on the track; each span's
  // flat cable bundle hangs in a U whose depth follows the spare cable (deep loops when bunched, shallow when
  // spread). Each U is 3 stretched band faces (a rect band keeps its thickness under a lengthwise stretch).
  const FEST_N = 5;
  const fx = FEST_SIDE * (GX + STS.gHalf + 22);
  const fy = GT - 280;
  const festCars: Node3[] = [];
  for (let i = 1; i <= FEST_N; i++) {
    const car = G.node(`sts-festcar${i}`, [fx, fy, 0]);
    car.r.y = 90;
    car.wheel({ r: 15, w: 30, tread: i === FEST_N ? S.dk : '#3A3F46', disc: circle(0, 0, 15, '#4A5059') + circle(0, 0, 6, C.hazard) + circle(0, 0, 2.5, S.graphite2) });
    festCars.push(car);
  }
  // Three flat cables side by side (power, control, fibre), 18 cm bundle.
  const CABLE = rect(0, 0, 100, 5, '#1A1C21') + rect(0, 6.5, 100, 5, '#23262C') + rect(0, 13, 100, 5, '#1A1C21') + rect(0, 0.8, 100, 1.2, 'rgba(255,255,255,.22)') + rect(0, 7.3, 100, 1.2, 'rgba(255,255,255,.18)') + rect(0, 13.8, 100, 1.2, 'rgba(255,255,255,.22)');
  const festSegs: FaceDef[] = [];
  for (let i = 0; i < FEST_N * 3; i++) {
    const f: FaceDef = { o: [fx, 0, 0], a: [0, 0, 1], b: [0, -1, 0], w: 100, h: 18, art: CABLE, double: true, shade: 0, name: `sts-festoon${i}` };
    G.face(f);
    festSegs.push(f);
  }
  /** Stretch band face f along the segment p→q (both in the x = fx plane, given as [y, z]). */
  const band = (f: FaceDef, p: P2, q: P2) => {
    const dy = q[0] - p[0], dz = q[1] - p[1];
    const L = Math.max(Math.hypot(dy, dz), 0.5);
    const uy = dy / L, uz = dz / L;
    const ext = 4;
    f.a[0] = 0; f.a[1] = (uy * (L + 2 * ext)) / 100; f.a[2] = (uz * (L + 2 * ext)) / 100;
    f.b[0] = 0; f.b[1] = -uz; f.b[2] = uy;
    f.o[0] = fx; f.o[1] = p[0] - uy * ext + uz * 9; f.o[2] = p[1] - uz * ext - uy * 9;
  };
  const CABLE_PER_SPAN = ((FEST_ANCHOR - (STS.trolleyMin + 300)) / FEST_N) * 1.04;

  /* ---- pose ------------------------------------------------------------ */
  const pose: StsPose = { trolley: 1400, hoist: 1600, twist: 0, sway: 0, swayX: 0, gantry: 0, headblock: 0 };

  /** Pendulum offset of the (level) spreader for the current hoist + sway. */
  const swing = (hy: number) => {
    const Lp = GT + 30 - (hy + HT);
    const a = (pose.sway ?? 0) * DEG, b = (pose.swayX ?? 0) * DEG;
    return { dx: Lp * Math.sin(b), dy: Lp * (1 - Math.cos(a) * Math.cos(b)), dz: Lp * Math.sin(a) };
  };

  function apply() {
    const tz = clamp(pose.trolley, STS.trolleyMin, STS.trolleyMax);
    const hy = clamp(pose.hoist, STS.hoistMin, STS.hoistMax);
    const g = pose.gantry ?? 0;
    G.p = [g, 0, 0];
    for (const w of gWheels) w.spin = g / 45 / DEG;
    reel.spin = -g / 150 / DEG;
    trolley.p = [0, GT, tz];
    // Trolley wheels roll along Z (axis along X after r.y = 90, so +spin rolls toward −Z).
    for (const w of tWheels) w.spin = -tz / 32 / DEG;
    for (const s of sheaves) s.spin = -(tz - hy) / 40 / DEG;

    const { dx, dy, dz } = swing(hy);
    const hb = pose.headblock ?? 0;
    spr.p = [dx, hy + dy, tz + dz];
    spr.r.y = hb;
    const c = Math.cos(hb * DEG), s = Math.sin(hb * DEG);
    for (const r of ropes) {
      const lx = r.xs * 140, lz = r.zs * 45;
      aim(r.n, [r.xs * 200, GT + 30, tz + r.zs * 70], [spr.p[0] + c * lx + s * lz, spr.p[1] + HT, spr.p[2] - s * lx + c * lz]);
    }
    for (const r of runs) {
      const y = GT + 62, x = r.xs * 200;
      if (r.tip) aim(r.n, [x, y, ZTIP + 150], [x, y, tz - 300]);
      else aim(r.n, [x, y, tz + 300], [x, y, HZ0]);
    }

    // Festoon
    const z0 = tz + 300;
    const span = (FEST_ANCHOR - z0) / FEST_N;
    const depth = Math.min(520, 0.5 * Math.sqrt(Math.max(0, CABLE_PER_SPAN * CABLE_PER_SPAN - span * span))) + 30;
    for (let i = 0; i < FEST_N; i++) {
      const za = z0 + span * i, zb = za + span;
      const k = Math.min(0.22 * span, 90);
      const top = fy - 12, bot = fy - depth;
      band(festSegs[i * 3], [top, za], [bot, za + k]);
      band(festSegs[i * 3 + 1], [bot, za + k], [bot, zb - k]);
      band(festSegs[i * 3 + 2], [bot, zb - k], [top, zb]);
      festCars[i].p = [fx, fy, zb];
    }

    const tw = clamp(pose.twist, 0, 1) * 90;
    const corners: P2[] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
    locks.forEach((tl, i) => {
      tl.p = [corners[i][0] * STS.tlX, 0, corners[i][1] * STS.tlZ];
      tl.r.y = tw;
    });
  }

  function seat() {
    const tz = clamp(pose.trolley, STS.trolleyMin, STS.trolleyMax);
    const hy = clamp(pose.hoist, STS.hoistMin, STS.hoistMax);
    const { dx, dy, dz } = swing(hy);
    const lx = (pose.gantry ?? 0) + dx, ly = hy + dy - BOX.H, lz = tz + dz;
    const ry = root.r.y * DEG, c = Math.cos(ry), s = Math.sin(ry);
    const yaw = root.r.y + (pose.headblock ?? 0);
    return {
      p: [root.p[0] + c * lx + s * lz, root.p[1] + ly, root.p[2] - s * lx + c * lz] as V3,
      yaw,
      r: { x: 0, y: yaw, z: 0 },
    };
  }

  apply();
  return { root, pose, apply, seat, GAUGE, OUTREACH, BACKREACH, BOOM_Y };
}

/* ------------------------------------------------------------------------ */
/* Lab                                                                       */
/* ------------------------------------------------------------------------ */

export const labEntries: Record<string, LabEntry> = {
  stsCrane: {
    title: 'STS quay crane — NAVAIR NQ-07',
    build: () => {
      const sts = createStsCrane();
      const root = new Node3('lab-sts');
      root.add(sts.root);
      const load = container('box', LIVERY.hero);
      load.visible = false;
      root.add(load);
      const av = sts.root.get('sts-aviation');
      let vals: Record<string, number> = {};
      const place = () => {
        sts.apply();
        if (vals.withBox) {
          const s = sts.seat();
          load.p = s.p;
          Object.assign(load.r, s.r);
          load.visible = true;
        } else load.visible = false;
      };
      return {
        root,
        pose: (v) => {
          vals = v;
          for (const k of ['trolley', 'hoist', 'twist', 'sway', 'swayX', 'gantry', 'headblock'] as const) {
            if (v[k] !== undefined) (sts.pose as unknown as Record<string, number>)[k] = v[k];
          }
          place();
        },
        frame: { tx: 0, ty: 2300, tz: 0, zoom: 0.1 },
        tick: (t) => {
          av.opacity = (t * 0.8) % 1 < 0.5 ? 1 : 0.25;
          // swing=1: trolley stop every 12 s → damped along-boom pendulum (long ropes ≈ 8 s period).
          if (vals.swing) {
            sts.pose.sway = (vals.sway ?? 0) + swayCurve(t % 12, 3, 8, 0.1);
            place();
          }
        },
      };
    },
    controls: [
      { key: 'trolley', min: STS.trolleyMin, max: STS.trolleyMax, value: 1400 },
      { key: 'hoist', min: 300, max: STS.hoistMax, value: 1600 },
      { key: 'twist', min: 0, max: 1, step: 0.01, value: 1 },
      { key: 'sway', min: -6, max: 6, step: 0.1, value: 0 },
      { key: 'swayX', min: -6, max: 6, step: 0.1, value: 0 },
      { key: 'gantry', min: -1500, max: 1500, value: 0 },
      { key: 'headblock', min: -90, max: 90, value: 0 },
      { key: 'swing', min: 0, max: 1, value: 0 },
      { key: 'withBox', min: 0, max: 1, value: 1 },
    ],
  },
};
