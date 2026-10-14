/**
 * RS-45 heavy reach stacker (Kalmar DRG / Konecranes SMV class), drawn for the
 * orthographic SVG engine.
 *
 * MACHINE space: origin = ground point under the FRONT (drive) axle centre,
 * machine faces +X, Y up, width across Z (+Z = right-hand side = the near side
 * at camera yaw 0). Front axle x = 0, rear steer axle x = −600, counterweight
 * tail x ≈ −778, frame nose x ≈ +142, width ≈ 416.
 *
 * Boom: 3-section telescopic box beam pivoting at PIVOT (x −530, y 335) on
 * the rear pivot towers. Twin lift cylinders run from the front frame head to
 * trunnions on the boom sides; their angle and rod extension are solved every
 * apply(). The spreader hangs from the tip pin through a level-keeping
 * rotator (counter-rotated against the boom) and telescopes 20'→40'.
 *
 * Telescoping parts (inner boom sections, spreader arms, cylinder rods) only
 * draw their EXPOSED length: their face/wheel defs are stretched in apply() by
 * mutating the def's `a` vector / `w` (the engine reads these by reference
 * every frame). This avoids painter's-sort glitches between nested sections.
 */

import { Node3, box, type FaceDef, type WheelDef } from '../engine/engine';
import { bolts, circle, hi, lo, path, poly, polyD, rect, rr, rrD, seam, stroke, text } from '../engine/art';
import { shade, tint } from '../engine/color';
import { DEG, add, apply as mapply, clamp, lerp, mul, rng, rotX, rotY, rotZ, type M3, type V3 } from '../engine/math';
import { BOX, C } from '../world';
import { LIVERY, container } from './container';
import type { LabEntry } from './registry';

type P2 = [number, number];

/* ------------------------------------------------------------------------ */
/* Geometry                                                                  */
/* ------------------------------------------------------------------------ */

export const RS = {
  /** Boom pivot (machine x, y), centred on Z. */
  pivot: [-530, 335] as P2,
  /** Pivot → tip-pin distance with the boom fully retracted. */
  R0: 760,
  EXT_MAX: 600,
  /** Tip pin → twistlock plane (spreader underside) drop. */
  hang: 150,
  /** Lift-cylinder base pin (machine x, y) and lateral offset ±cylZ. */
  anchor: [30, 168] as P2,
  cylZ: 62,
  /** Cylinder trunnion in boom space (u along boom from the pivot, v up). */
  trunnion: [271, -26] as P2,
  rFront: 90,
  rRear: 80,
  rearAxleX: -600,
  /** Twistlock centres (spreader space): long axis at 20' / 40', and ±Z. Match container.ts casting apertures. */
  tl20: BOX.L20 / 2 - 8.9,
  tl40: BOX.L / 2 - 8.9,
  tlZ: BOX.W / 2 - 8.1,
} as const;

const [PX, PY] = RS.pivot;
const R0 = RS.R0;
/** Longest telescope extension (cm). */
export const EXT_MAX = RS.EXT_MAX;
const HANG = RS.hang;
const RF = RS.rFront;
const RR = RS.rRear;

/* ------------------------------------------------------------------------ */
/* Palette                                                                   */
/* ------------------------------------------------------------------------ */

/** Premium industrial machine blue (deeper than NAVAIR blue, which is kept for accents). */
const BLUE = '#2536B8';
const T = {
  body: BLUE,
  bodyHi: tint(BLUE, 0.2),
  bodyLo: shade(BLUE, 0.14),
  /** Lower-panel two-tone. */
  bodyDk: '#18248A',
  bodyEdge: shade(BLUE, 0.58),
  bodyInk: tint(BLUE, 0.6),
  accent: C.blue,
  frame: C.steel700,
  frameHi: C.steel600,
  frameLo: C.steel800,
  frameDk: C.steel900,
  boom: '#2A2E35',
  boomHi: '#3A3F48',
  boomLo: '#1D2025',
  s2: '#3A3F48',
  s3: '#4A505B',
  glass: '#1F2D40',
  glassHi: C.glassHi,
  glassDk: '#121821',
  sky: 'rgba(176,200,232,.16)',
  red: '#D5262B',
  amber: '#FF9E1B',
  lamp: '#FFF4D8',
  white: C.paper,
};

/* ------------------------------------------------------------------------ */
/* Art helpers                                                               */
/* ------------------------------------------------------------------------ */

const f1 = (v: number) => Math.round(v * 10) / 10;

/** Mirror art horizontally inside a w-wide box. */
const MX = (w: number, art: string) => `<g transform="translate(${f1(w)} 0) scale(-1 1)">${art}</g>`;
/** Mirror art vertically inside an h-tall box. */
const MY = (h: number, art: string) => `<g transform="translate(0 ${f1(h)}) scale(1 -1)">${art}</g>`;
/** Re-mirror (un-mirror) a piece of art about x = cx, e.g. text inside mirrored art. */
const RT = (cx: number, art: string) => `<g transform="translate(${f1(2 * cx)} 0) scale(-1 1)">${art}</g>`;

const fill = (c: string) => (_i: number, len: number, d: number) => rect(0, 0, len, d, c);

function hazClip(id: string, d: string, x: number, y: number, w: number, h: number, pitch = 20) {
  let s = '';
  for (let u = x - h; u < x + w + h; u += pitch) s += `M${f1(u)} ${f1(y + h)}L${f1(u + h)} ${f1(y)}h${f1(pitch / 2)}L${f1(u + pitch / 2)} ${f1(y + h)}Z`;
  return (
    `<clipPath id="${id}"><path d="${d}"/></clipPath>` +
    `<g clip-path="url(#${id})">${rect(x, y, w, h, C.hazard)}<path d="${s}" fill="${C.ink}"/></g>`
  );
}
const hazRect = (id: string, x: number, y: number, w: number, h: number, pitch = 20) =>
  hazClip(id, `M${x} ${y}h${w}v${h}h${-w}Z`, x, y, w, h, pitch);

function treadPlate(x: number, y: number, w: number, h: number, base: string, mark: string, pitch = 12) {
  let d = '';
  let j = 0;
  for (let v = y + pitch / 2; v < y + h - 2; v += pitch, j++) {
    for (let u = x + pitch / 2 + (j % 2) * (pitch / 2); u < x + w - 2; u += pitch) {
      d += j % 2 ? `M${f1(u - 2.4)} ${f1(v - 1.4)}l4.8 2.8` : `M${f1(u - 2.4)} ${f1(v + 1.4)}l4.8 -2.8`;
    }
  }
  return rect(x, y, w, h, base) + `<path d="${d}" stroke="${mark}" stroke-width="1.5" stroke-linecap="round" fill="none"/>`;
}

function louvres(x: number, y: number, w: number, h: number, pitch: number, frameC: string, slat: string, gap: string) {
  let a = '', b = '';
  for (let v = y + 4; v + pitch * 0.6 < y + h - 3; v += pitch) {
    a += `M${f1(x + 4)} ${f1(v)}h${f1(w - 8)}v${f1(pitch * 0.55)}h${f1(-(w - 8))}Z`;
    b += `M${f1(x + 4)} ${f1(v + pitch * 0.55)}h${f1(w - 8)}v${f1(pitch * 0.28)}h${f1(-(w - 8))}Z`;
  }
  return rr(x, y, w, h, 3, frameC) + path(a, slat) + path(b, gap);
}

function lampBox(x: number, y: number, w: number, h: number, lens: string, rim = '#15161A') {
  return (
    rr(x, y, w, h, Math.min(w, h) * 0.22, rim) +
    rr(x + 2, y + 2, w - 4, h - 4, Math.min(w, h) * 0.18, lens) +
    rr(x + 3, y + 2.6, (w - 6) * 0.45, Math.max(1, (h - 4) * 0.3), 1, 'rgba(255,255,255,.55)')
  );
}

const boltRing = (cx: number, cy: number, r: number, n: number, br: number, col: string) => {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    d += `M${f1(x + br)} ${f1(y)}a${br} ${br} 0 1 0 ${-2 * br} 0a${br} ${br} 0 1 0 ${2 * br} 0`;
  }
  return path(d, col);
};

/** Road grime: darker bands toward the bottom, speckle and a few drip streaks (deterministic). */
function grime(w: number, y0: number, h: number, seed: number, k = 1) {
  const r = rng(seed);
  let dots = '', drips = '';
  for (let i = 0; i < w / 5; i++) {
    const x = r() * w, y = y0 + h * (0.25 + 0.75 * Math.pow(r(), 0.6)), rad = 0.5 + r() * 1.6;
    dots += `M${f1(x + rad)} ${f1(y)}a${f1(rad)} ${f1(rad)} 0 1 0 ${f1(-2 * rad)} 0a${f1(rad)} ${f1(rad)} 0 1 0 ${f1(2 * rad)} 0`;
  }
  for (let i = 0; i < w / 45; i++) {
    const x = r() * w, y = y0 + h * r() * 0.4;
    drips += `M${f1(x)} ${f1(y)}v${f1(4 + r() * 12)}`;
  }
  return (
    rect(0, y0, w, h, `rgba(46,36,26,${0.07 * k})`) +
    rect(0, y0 + h * 0.5, w, h * 0.5, `rgba(46,36,26,${0.08 * k})`) +
    rect(0, y0 + h * 0.82, w, h * 0.18, `rgba(38,30,22,${0.12 * k})`) +
    path(dots, `rgba(40,32,24,${0.28 * k})`) +
    `<path d="${drips}" stroke="rgba(40,32,24,${0.18 * k})" stroke-width="1.6" stroke-linecap="round" fill="none"/>`
  );
}

/** Two-tone lower panel with a pressed crease line. */
const lowerPanel = (w: number, y0: number, y1: number) =>
  rect(0, y0, w, y1 - y0, T.bodyDk) + rect(0, y0 - 1.6, w, 1.6, 'rgba(0,0,0,.28)') + rect(0, y0, w, 1.4, 'rgba(255,255,255,.16)');

/* ------------------------------------------------------------------------ */
/* Face helpers                                                              */
/* ------------------------------------------------------------------------ */

interface ExOpts {
  /** Art for the +Z cap, in (X − minX, maxY − Y) coords. null = no face. */
  front?: string | null;
  /** Art for the −Z cap in the SAME coords (auto-mirrored). undefined = front, null = none. */
  back?: string | null;
  /** Edge art (len × depth, u along the edge p→q, v from z1 toward z0). null = no face. */
  edge?: (i: number, len: number, depth: number) => string | null;
  bias?: number;
  shade?: number;
  name?: string;
}

/** Extrude a CCW (world Y-up) XY polygon from z0 to z1. Returns face count. */
function extrude(n: Node3, pts: P2[], z0: number, z1: number, o: ExOpts) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const w = maxX - minX, h = maxY - minY;
  const art2 = pts.map(([x, y]) => [x - minX, maxY - y] as P2);
  const common = { bias: o.bias, shade: o.shade };
  if (o.front !== null) {
    n.face({ ...common, o: [minX, maxY, z1], a: [1, 0, 0], b: [0, -1, 0], w, h, art: o.front ?? '', outline: polyD(art2), name: o.name && `${o.name}.f` });
  }
  const back = o.back === undefined ? o.front : o.back;
  if (back) {
    n.face({
      ...common, o: [maxX, maxY, z0], a: [-1, 0, 0], b: [0, -1, 0], w, h,
      art: MX(w, back), outline: polyD(art2.map(([u, v]) => [w - u, v] as P2)), name: o.name && `${o.name}.b`,
    });
  }
  const depth = z1 - z0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;
    const art = o.edge?.(i, len, depth);
    if (!art) continue;
    n.face({ ...common, o: [p[0], p[1], z1], a: [dx / len, dy / len, 0], b: [0, 0, -1], w: len, h: depth, art, name: o.name && `${o.name}.e${i}` });
  }
}

/** Natural-orientation art for an edge whose u runs UP and v runs toward −Z (seen from +X). */
const edgeUpFromFront = (len: number, art: string) => `<g transform="matrix(0 1 -1 0 ${f1(len)} 0)">${art}</g>`;
/** Natural-orientation art for an edge whose u runs DOWN and v toward −Z (seen from −X). */
const edgeDownFromRear = (depth: number, art: string) => `<g transform="matrix(0 -1 1 0 0 ${f1(depth)})">${art}</g>`;

interface Stretch {
  set(x0: number, len: number): void;
}

/**
 * A rectangular tube along local X whose visible length is set every frame.
 * Art is authored 100 units long and stretched, so keep it lengthwise-invariant.
 */
function tube(n: Node3, y0: number, y1: number, zh: number, art: { side: string; top: string; bottom: string }, name: string, bias = 0): Stretch {
  const U = 100, h = y1 - y0, d = 2 * zh;
  const faces: FaceDef[] = [
    { o: [0, y1, zh], a: [1, 0, 0], b: [0, -1, 0], w: U, h, art: art.side, name: `${name}.pz`, bias },
    { o: [0, y0, -zh], a: [1, 0, 0], b: [0, 1, 0], w: U, h, art: MY(h, art.side), name: `${name}.nz`, bias },
    { o: [0, y1, -zh], a: [1, 0, 0], b: [0, 0, 1], w: U, h: d, art: art.top, name: `${name}.py`, bias },
    { o: [0, y0, zh], a: [1, 0, 0], b: [0, 0, -1], w: U, h: d, art: art.bottom, name: `${name}.ny`, bias },
  ];
  for (const f of faces) n.face(f);
  return {
    set(x0, len) {
      const k = Math.max(len, 0.05) / U;
      for (const f of faces) {
        f.o[0] = x0;
        f.a[0] = k;
      }
    },
  };
}

/** A node whose local Z points along world-ish X of its parent, for cylinder wheels. */
function axisNode(parent: Node3, name: string, p: V3) {
  const nd = parent.node(name, p);
  nd.r.y = 90;
  return nd;
}

/* ------------------------------------------------------------------------ */
/* Wheels                                                                    */
/* ------------------------------------------------------------------------ */

function tyreDisc(r: number, rim: number) {
  const s: string[] = [];
  s.push(circle(0, 0, r, '#1F2125'));
  s.push(circle(0, 0, r * 0.94, '#191A1E'));
  // Sidewall moulding blocks (asymmetric so rotation reads).
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < 7; i++) {
      const a = k * 180 + i * 7 - 21;
      s.push(`<g transform="rotate(${a})">${rr(-2.2, -r * 0.86, 4.4, r * 0.09, 1, '#2A2C31')}</g>`);
    }
  }
  s.push(`<g transform="rotate(90)">${rr(-10, -r * 0.86, 20, r * 0.07, 1.5, '#2A2C31')}</g>`);
  // Rim
  s.push(circle(0, 0, rim * 1.07, '#0F1013'));
  s.push(circle(0, 0, rim, C.steel300));
  s.push(circle(0, 0, rim * 0.9, C.steel500));
  s.push(circle(0, 0, rim * 0.8, C.steel200));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    s.push(rr(Math.cos(a) * rim * 0.6 - rim * 0.09, Math.sin(a) * rim * 0.6 - rim * 0.07, rim * 0.18, rim * 0.14, rim * 0.06, C.steel500));
  }
  s.push(circle(0, 0, rim * 0.42, C.steel400));
  s.push(boltRing(0, 0, rim * 0.34, 10, Math.max(1.6, rim * 0.035), C.steel700));
  s.push(circle(0, 0, rim * 0.24, T.accent), circle(0, 0, rim * 0.1, '#15181F'));
  // Valve stem
  s.push(rr(rim * 0.84, -2, 7, 4, 1.5, C.steel600));
  return s.join('');
}

/** Drive-tyre tread seen head-on over ±35° of arc: directional lugs foreshortened toward the top and bottom. */
const TREAD_H = Math.round(2 * RS.rFront * Math.sin(35 * DEG));
const TREAD_ART = (() => {
  const w = 54, h = TREAD_H, r = RS.rFront;
  const s = [rect(0, 0, w, h, '#1C1E22')];
  let lugs = '';
  for (let a = -34; a <= 34; a += 6.5) {
    const v = h / 2 - r * Math.sin(a * DEG);
    const t = 3.4 * Math.cos(a * DEG);
    const k = Math.round(a / 6.5) % 2 ? 1 : -1;
    // chevron halves, alternating offset (directional loader tread)
    lugs += `M3 ${f1(v + k * 2)}L${w / 2 - 2} ${f1(v - 3)}v${f1(t)}L3 ${f1(v + k * 2 + t)}Z`;
    lugs += `M${w - 3} ${f1(v + k * 2)}L${w / 2 + 2} ${f1(v - 3)}v${f1(t)}L${w - 3} ${f1(v + k * 2 + t)}Z`;
  }
  s.push(path(lugs, '#2C2F35'));
  s.push(rect(0, 0, 3, h, '#141518'), rect(w - 3, 0, 3, h, '#141518'));
  s.push(rect(0, 0, w, h * 0.16, 'rgba(0,0,0,.28)'), rect(0, h * 0.84, w, h * 0.16, 'rgba(0,0,0,.34)'), rect(0, h * 0.38, w, h * 0.08, 'rgba(255,255,255,.04)'));
  return s.join('');
})();

function tyreInner(r: number) {
  // Static light: soft crescent top-left, darker bottom-right.
  const a = r * 0.97;
  return (
    stroke(`M${f1(-a * 0.94)} ${f1(-a * 0.34)}A${f1(a)} ${f1(a)} 0 0 1 ${f1(a * 0.34)} ${f1(-a * 0.94)}`, 'rgba(255,255,255,.09)', r * 0.06) +
    stroke(`M${f1(a * 0.94)} ${f1(a * 0.34)}A${f1(a)} ${f1(a)} 0 0 1 ${f1(-a * 0.34)} ${f1(a * 0.94)}`, 'rgba(0,0,0,.25)', r * 0.08)
  );
}

/* ------------------------------------------------------------------------ */
/* Body art                                                                  */
/* ------------------------------------------------------------------------ */

function frameSide() {
  const w = 740, h = 95;
  const s = [rect(0, 0, w, h, T.frameLo), rect(0, 0, w, 9, T.frameHi), rect(0, h - 9, w, 9, T.frameDk)];
  for (let u = 40; u < w - 60; u += 78) s.push(rr(u, 26, 46, 30, 12, T.frameDk));
  s.push(stroke(`M0 70H${w}`, C.steel900, 4), stroke(`M0 68.8H${w}`, 'rgba(255,255,255,.12)', 1));
  s.push(bolts(8, w - 8, 4.5, 40, 1.6, C.steel900), grime(w, 50, 45, 41, 1.3));
  return s.join('');
}

function frameTop() {
  const w = 740, h = 168;
  const s = [rect(0, 0, w, h, T.frameDk), rect(0, 0, w, 20, T.frameLo), rect(0, h - 20, w, 20, T.frameLo)];
  for (let u = 30; u < w; u += 120) s.push(rect(u, 20, 14, h - 40, T.frameLo));
  s.push(rr(360, 36, 190, 96, 10, C.steel600), rr(372, 48, 166, 72, 8, C.steel500), rect(550, 78, 190, 12, C.steel600));
  s.push(rr(210, 50, 90, 68, 8, C.steel600), circle(255, 84, 22, C.steel500), circle(255, 84, 9, C.steel700));
  s.push(stroke('M300 70C330 70 340 60 372 60', C.steel900, 4), stroke('M300 98C330 98 340 108 372 108', C.steel900, 4));
  return s.join('');
}

function noseFront() {
  const w = 172, h = 132;
  const s = [rect(0, 0, w, h, T.frameLo)];
  // Blue top fascia with headlamps + badge
  s.push(rr(0, 0, w, 40, [8, 8, 0, 0], T.body), rect(0, 0, w, 4, T.bodyHi), rect(0, 36, w, 4, T.bodyDk));
  s.push(lampBox(8, 9, 36, 20, T.lamp), lampBox(w - 44, 9, 36, 20, T.lamp));
  s.push(rr(58, 12, 56, 16, 3, T.bodyDk), text(86, 24, 'NAVAIR', 10.5, T.white, { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 1.5 }));
  // Heavy bumper
  s.push(rect(0, 40, w, 12, T.frameHi), rect(0, 40, w, 2, 'rgba(255,255,255,.14)'));
  s.push(hazRect('rs-hz-nose', 0, 56, w, 24, 16));
  s.push(rect(0, 80, w, 3, 'rgba(0,0,0,.35)'));
  s.push(rr(70, 90, 32, 20, 4, T.frameDk), circle(86, 100, 6, C.steel400), circle(86, 100, 2.5, C.steel700));
  s.push(rr(14, 92, 26, 12, 3, T.frameDk), rr(w - 40, 92, 26, 12, 3, T.frameDk));
  s.push(lampBox(18, 94, 18, 8, T.amber), lampBox(w - 36, 94, 18, 8, T.amber));
  s.push(rect(0, h - 12, w, 12, T.frameDk), bolts(10, w - 10, h - 6, 9, 1.8, C.steel600));
  s.push(rect(0, 4, w, 2, T.accent), rr(48, 16, 6, 12, 1.5, '#E9ECEF'), rr(w - 54, 16, 6, 12, 1.5, '#E9ECEF'));
  s.push(rr(46, 94, 16, 10, 2, T.red), rr(w - 62, 94, 16, 10, 2, T.red), rr(118, 112, 38, 10, 2, '#E9ECEF'), text(137, 119.5, 'RS-45', 6.5, C.ink, { 'text-anchor': 'middle', family: 'mono', 'font-weight': 700 }));
  s.push(hi(`M0 40H${w}V46H0Z`, 0.1), lo(`M0 84H${w}V${h}H0Z`, 0.1), grime(w, 88, 44, 31, 1.2));
  return s.join('');
}

function noseSide() {
  const w = 102, h = 132;
  return [
    rect(0, 0, w, h, T.frameLo),
    rr(0, 0, w, 40, [0, 8, 0, 0], T.body), rect(0, 0, w, 4, T.bodyHi), rect(0, 36, w, 4, T.bodyDk),
    lampBox(w - 22, 12, 14, 10, T.amber),
    rect(0, 40, w, 12, T.frameHi),
    hazRect('rs-hz-noses', 0, 56, w, 24, 16),
    rect(0, 80, w, 3, 'rgba(0,0,0,.35)'),
    rr(18, 90, 22, 22, 6, T.frameDk), circle(29, 101, 6, C.steel500),
    bolts(8, w - 8, h - 6, 6, 1.8, C.steel600),
    rect(0, h - 12, w, 12, 'rgba(0,0,0,.25)'),
    grime(w, 88, 44, 37, 1.2),
  ].join('');
}

function noseTop() {
  const w = 102, h = 172;
  return treadPlate(0, 0, w, h, T.body, T.bodyLo, 11) + rect(w - 10, 0, 10, h, C.hazard) + rect(0, 0, 6, h, T.bodyDk) + bolts(8, w - 18, 6, 6, 1.6, T.bodyEdge) + bolts(8, w - 18, h - 6, 6, 1.6, T.bodyEdge);
}

function anchorSide(ax: number) {
  const w = 80, h = 46;
  const px = ax + 20, py = 186 - RS.anchor[1];
  return [
    rect(0, 0, w, h, T.frameHi),
    rect(0, 0, w, 3, 'rgba(255,255,255,.12)'),
    path(`M${px - 22} ${h}V${py}A22 22 0 0 1 ${px + 22} ${py}V${h}Z`, C.steel500),
    circle(px, py, 11, C.steel400), circle(px, py, 5.5, C.steel200), rect(px - 3, py + 12, 6, 8, C.steel700),
    bolts(6, 22, h - 6, 3, 1.6, C.steel900), bolts(58, 74, h - 6, 3, 1.6, C.steel900),
    rect(0, h - 3, w, 3, 'rgba(0,0,0,.3)'),
  ].join('');
}

function anchorTop() {
  const w = 80, h = 168;
  const z1 = 84 - RS.cylZ, z2 = 84 + RS.cylZ;
  return rect(0, 0, w, h, T.frameHi) + rr(18, z1 - 22, 44, 44, 8, C.steel800) + rr(18, z2 - 22, 44, 44, 8, C.steel800) + rect(0, 0, w, 4, 'rgba(255,255,255,.1)');
}

function anchorEnd() {
  const w = 168, h = 46;
  return rect(0, 0, w, h, T.frameHi) + rect(0, 0, w, 3, 'rgba(255,255,255,.12)') + bolts(10, w - 10, h - 8, 10, 1.8, C.steel900);
}

/** Right fuel-tank side (pz), u = X + 505, v = 168 − Y. */
function tankSideRight() {
  const w = 390, h = 110;
  const s = [rect(0, 0, w, h, T.body), lowerPanel(w, 80, h), rect(0, 9, w, 2.2, T.accent)];
  s.push(rect(0, 0, w, 6, T.bodyHi), rect(0, 6, w, 1.5, 'rgba(0,0,0,.2)'));
  s.push(rect(0, h - 14, w, 14, T.bodyDk), rect(0, h - 14, w, 1.5, 'rgba(255,255,255,.1)'));
  s.push(seam(`M132 9V${h - 15}M268 9V${h - 15}`, 'rgba(0,0,0,.32)', 1.5));
  s.push(seam(`M133.5 9V${h - 15}M269.5 9V${h - 15}`, 'rgba(255,255,255,.1)', 1));
  // Rear panel: battery isolator + vent
  s.push(rr(46, 26, 34, 28, 3, T.bodyLo), circle(63, 40, 7, T.red), rect(61, 34, 4, 12, '#7A0F12'));
  s.push(louvres(92, 24, 30, 48, 7, T.bodyDk, T.bodyLo, T.bodyEdge));
  // Middle panel: wordmark
  s.push(text(200, 50, 'NAVAIR', 25, T.white, { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 3, style: 'font-stretch:125%' }));
  s.push(rect(146, 57, 108, 3, C.hazard));
  s.push(text(200, 73, 'RS-45 · REACH STACKER', 7, T.bodyInk, { 'text-anchor': 'middle', family: 'mono', 'letter-spacing': 1.2 }));
  // Front panel: fuel filler, steps
  s.push(circle(292, 30, 11, T.bodyDk), circle(292, 30, 8.5, C.steel300), rect(286, 29, 12, 2.4, C.steel500));
  s.push(text(292, 52, 'DIESEL', 6, T.bodyInk, { 'text-anchor': 'middle', family: 'mono' }));
  s.push(path('M244 14l7 12h-14z', C.hazard), path('M244 17.5l4.6 7.8h-9.2z', C.ink), rect(243.4, 19.5, 1.2, 3, C.hazard));
  for (const v of [22, 58]) {
    s.push(rr(324, v, 50, 14, 3, T.bodyEdge), rect(327, v + 2, 44, 3, C.steel600), rect(327, v + 6, 44, 1.2, 'rgba(255,255,255,.12)'));
  }
  s.push(stroke(`M382 14V${h - 22}`, C.steel400, 3.2), stroke(`M383 14V${h - 22}`, 'rgba(255,255,255,.3)', 0.9));
  s.push(bolts(8, w - 8, h - 7, 18, 1.6, T.bodyEdge));
  s.push(seam(`M0 44H${w}`, 'rgba(0,0,0,.08)', 1), hi(`M0 11H${w}V24H0Z`, 0.06), lo(`M0 ${h - 50}H${w}V${h - 14}H0Z`, 0.06), grime(w, h - 40, 40, 11));
  return s.join('');
}

/** Left hydraulic-tank side (nz), u = −115 − X (front at u 0), v = 168 − Y. */
function tankSideLeft() {
  const w = 390, h = 110;
  const s = [rect(0, 0, w, h, T.body), lowerPanel(w, 80, h), rect(0, 9, w, 2.2, T.accent)];
  s.push(rect(0, 0, w, 6, T.bodyHi), rect(0, 6, w, 1.5, 'rgba(0,0,0,.2)'));
  s.push(rect(0, h - 14, w, 14, T.bodyDk), rect(0, h - 14, w, 1.5, 'rgba(255,255,255,.1)'));
  s.push(seam(`M122 9V${h - 15}M258 9V${h - 15}`, 'rgba(0,0,0,.32)', 1.5));
  // Front panel: hydraulic tank gauge
  s.push(rr(30, 18, 14, 54, 4, T.bodyEdge), rr(33, 36, 8, 33, 3, '#C98B1A'), rr(33, 21, 8, 15, 3, '#2A2F38'));
  s.push(text(58, 32, 'HYD OIL', 6.5, T.bodyInk, { family: 'mono' }), circle(90, 44, 10, T.bodyDk), circle(90, 44, 7.5, C.steel300));
  // Cab steps under the door
  for (const v of [24, 60]) {
    s.push(rr(146, v, 52, 14, 3, T.bodyEdge), rect(149, v + 2, 46, 3, C.steel600), rect(149, v + 6, 46, 1.2, 'rgba(255,255,255,.12)'));
  }
  s.push(stroke(`M138 14V${h - 22}`, C.steel400, 3.2));
  // Rear panel wordmark
  s.push(text(324, 50, 'NAVAIR', 25, T.white, { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 3, style: 'font-stretch:125%' }));
  s.push(rect(270, 57, 108, 3, C.hazard));
  s.push(text(324, 73, 'RS-45 · 45 t', 7, T.bodyInk, { 'text-anchor': 'middle', family: 'mono', 'letter-spacing': 1.2 }));
  s.push(bolts(8, w - 8, h - 7, 18, 1.6, T.bodyEdge));
  s.push(seam(`M0 44H${w}`, 'rgba(0,0,0,.08)', 1), hi(`M0 11H${w}V24H0Z`, 0.06), lo(`M0 ${h - 50}H${w}V${h - 14}H0Z`, 0.06), grime(w, h - 40, 40, 11));
  return s.join('');
}

function walkway(outerLow: boolean) {
  const w = 390, h = 114;
  const edgeV = outerLow ? h - 7 : 0;
  return treadPlate(0, 0, w, h, T.bodyLo, T.bodyDk, 12) + rect(0, edgeV, w, 7, C.hazard) + rect(0, 0, 6, h, T.bodyDk) + rect(w - 6, 0, 6, h, T.bodyDk);
}

function tankEnd() {
  const w = 114, h = 110;
  return [
    rect(0, 0, w, h, T.body), rect(0, 0, w, 6, T.bodyHi), lowerPanel(w, 80, h), rect(0, 9, w, 2.2, T.accent),
    seam('M8 16H106V72H8Z', 'rgba(0,0,0,.32)', 1.3), seam('M9.5 17.5H104.5', 'rgba(255,255,255,.1)', 1),
    rr(34, 34, 46, 12, 3, T.bodyEdge), rect(37, 36, 40, 3, C.steel500), rect(37, 40, 40, 1.2, 'rgba(255,255,255,.14)'),
    lampBox(12, 20, 20, 11, T.amber), rr(84, 22, 18, 8, 2, T.red),
    bolts(10, w - 10, 12, 8, 1.4, T.bodyEdge), bolts(10, w - 10, h - 7, 8, 1.6, T.bodyEdge),
    hi(`M0 6H${w * 0.25}V80H0Z`, 0.05), grime(w, 62, 48, 5),
  ].join('');
}

function hoodSide(mirrored = false) {
  const w = 230, h = 76;
  const s = [rect(0, 0, w, h, T.body), rect(0, 0, w, 5, T.bodyHi), rect(0, 5, w, 1.4, 'rgba(0,0,0,.2)'), lowerPanel(w, h - 10, h), rect(0, 7, w, 2, T.accent)];
  s.push(louvres(12, 12, 100, 50, 6.5, T.bodyDk, T.bodyLo, T.bodyEdge));
  s.push(seam('M120 10H194V66H120Z', 'rgba(0,0,0,.35)', 1.4), rr(180, 34, 10, 5, 2, T.bodyEdge), rect(122, 20, 3, 8, T.bodyDk), rect(122, 50, 3, 8, T.bodyDk));
  s.push(path('M152 22l7 12h-14z', C.hazard), path('M152 25.5l4.6 7.8h-9.2z', C.ink));
  const hot = text(157, 50, 'HOT', 6, T.bodyInk, { family: 'mono', 'text-anchor': 'middle' });
  s.push(mirrored ? RT(157, hot) : hot);
  s.push(seam('M198 10V66', 'rgba(0,0,0,.25)', 1.2), hi(`M0 9H${w}V18H0Z`, 0.06), lo(`M0 ${h - 22}H${w}V${h - 10}H0Z`, 0.08), grime(w, h - 22, 22, 17, 0.7));
  return s.join('');
}

function hoodTop() {
  const w = 230, h = 400;
  const s = [rect(0, 0, w, h, T.body), rect(0, 0, w, 6, T.bodyHi), rect(0, h - 6, w, 6, T.bodyHi)];
  s.push(rect(40, 136, 190, 128, T.bodyDk), rect(40, 136, 190, 4, 'rgba(0,0,0,.3)'));
  s.push(seam('M12 18H222V126H12Z', 'rgba(0,0,0,.3)', 1.4), seam('M12 274H222V382H12Z', 'rgba(0,0,0,.3)', 1.4));
  s.push(louvres(70, 30, 120, 84, 7, T.bodyDk, T.bodyLo, T.bodyEdge), louvres(70, 286, 120, 84, 7, T.bodyDk, T.bodyLo, T.bodyEdge));
  s.push(circle(32, 350, 14, T.bodyEdge), circle(72, 50, 18, T.bodyEdge));
  s.push(bolts(8, w - 8, 3, 16, 1.4, T.bodyEdge), bolts(8, w - 8, h - 3, 16, 1.4, T.bodyEdge));
  return s.join('');
}

function hoodFront() {
  const w = 400, h = 76;
  return [
    rect(0, 0, w, h, T.bodyLo), rect(0, 0, w, 5, T.bodyHi), rect(0, h - 6, w, 6, T.bodyDk),
    rect(136, 0, 128, h, T.bodyDk),
    louvres(20, 12, 100, 50, 6.5, T.bodyDk, T.bodyLo, T.bodyEdge),
    louvres(280, 12, 100, 50, 6.5, T.bodyDk, T.bodyLo, T.bodyEdge),
    lampBox(180, 20, 40, 14, T.lamp),
  ].join('');
}

/** Counterweight side profile (art coords u = X + 778, v = 252 − Y). */
const CW_OUT: P2[] = [[30, 0], [78, 0], [78, 212], [18, 212], [0, 184], [0, 30]];

function cwSide(mirrored = false) {
  const d = polyD(CW_OUT);
  const s = [path(d, T.body), path('M0 150H78V212H18L0 184Z', T.bodyDk), rect(0, 148.4, 78, 1.6, 'rgba(0,0,0,.28)'), rect(0, 150, 78, 1.4, 'rgba(255,255,255,.16)'), rect(0, 9, 78, 2.2, T.accent)];
  s.push(poly([[30, 0], [78, 0], [78, 5], [32, 5], [2, 33], [0, 30]], T.bodyHi));
  s.push(seam('M1 76H77M1 144H77', 'rgba(0,0,0,.35)', 1.4), seam('M1 77.5H77M1 145.5H77', 'rgba(255,255,255,.1)', 1));
  s.push(bolts(14, 64, 86, 3, 2, T.bodyEdge), bolts(14, 64, 154, 3, 2, T.bodyEdge));
  s.push(lampBox(52, 20, 16, 10, T.amber));
  const tag = text(42, 55, 'RS-45', 8, T.bodyInk, { family: 'mono', 'text-anchor': 'middle', 'font-weight': 600 });
  s.push(rr(20, 40, 44, 22, 4, T.bodyDk), mirrored ? RT(42, tag) : tag);
  s.push(`<clipPath id="rs-cwg${mirrored ? 'b' : 'a'}"><path d="${d}"/></clipPath><g clip-path="url(#rs-cwg${mirrored ? 'b' : 'a'})">${grime(78, 160, 52, 23)}</g>`);
  s.push(hi('M30 5H78V40H4Z', 0.05));
  return s.join('');
}

function cwRear() {
  const w = 404, h = 154;
  const s = [rect(0, 0, w, h, T.body), rect(0, 0, w, 5, T.bodyHi), lowerPanel(w, 128, h), rect(0, 7, w, 2.2, T.accent)];
  s.push(rr(70, 12, 264, 86, 6, T.bodyEdge));
  let a = '', b = '';
  for (let v = 18; v < 92; v += 6.4) {
    a += `M76 ${f1(v)}h252v3.6h-252Z`;
    b += `M76 ${f1(v + 3.6)}h252v1.1h-252Z`;
  }
  s.push(path(a, '#1C2585'), path(b, 'rgba(255,255,255,.1)'));
  s.push(rect(166, 14, 4, 82, T.bodyEdge), rect(234, 14, 4, 82, T.bodyEdge));
  for (const x of [14, w - 58]) {
    s.push(rr(x, 14, 44, 70, 6, '#15161A'), lampBox(x + 3, 17, 38, 20, T.red, '#15161A'), lampBox(x + 3, 39, 38, 16, T.amber, '#15161A'), lampBox(x + 3, 57, 38, 22, '#E9ECEF', '#15161A'));
  }
  s.push(rr(146, 104, 112, 22, 4, T.bodyDk), text(202, 120, 'NAVAIR', 14, T.white, { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 3, style: 'font-stretch:125%' }));
  s.push(rr(20, 100, 90, 16, 3, T.bodyDk), text(65, 111.5, 'RS-45', 8.5, T.bodyInk, { family: 'mono', 'text-anchor': 'middle', 'font-weight': 600 }));
  s.push(rr(186, 130, 32, 20, 4, C.steel800), circle(202, 140, 5.5, C.steel400));
  s.push(rr(196, 3, 12, 7, 2, '#111'), circle(202, 6.5, 2, '#3A4A66'));
  s.push(bolts(12, w - 12, h - 6, 20, 1.8, T.bodyEdge));
  s.push(seam(`M0 102H${w}`, 'rgba(0,0,0,.18)', 1.2), hi(`M0 9H${w}V18H0Z`, 0.06), grime(w, 118, 36, 29));
  return s.join('');
}

function cwTop() {
  const w = 48, h = 404;
  return rect(0, 0, w, h, T.body) + rr(14, 60, 20, 14, 6, C.steel500) + rr(14, h - 74, 20, 14, 6, C.steel500) + rr(19, 64, 10, 6, 3, C.steel800) + rr(19, h - 70, 10, 6, 3, C.steel800) + rect(0, 0, 3, h, 'rgba(255,255,255,.12)');
}

function cheekArt() {
  // Profile coords (X + 650, 372 − Y); pin at (120, 37).
  const pts: P2[] = [[0, 124], [195, 124], [152, 22], [120, 0], [84, 20], [38, 80]];
  const s = [path(polyD(pts), T.body)];
  s.push(poly([[152, 22], [120, 0], [84, 20], [88, 24], [120, 6], [148, 26]], T.bodyHi));
  s.push(path('M50 112L78 64L118 64L150 112Z', T.bodyLo));
  s.push(rr(90, 80, 44, 22, 8, T.bodyDk));
  s.push(circle(120, 37, 30, T.bodyLo), circle(120, 37, 26, T.bodyHi), circle(120, 37, 17, C.steel500), circle(120, 37, 10, C.steel300), circle(120, 37, 4, C.steel700));
  s.push(boltRing(120, 37, 22, 8, 1.7, T.bodyEdge));
  s.push(rect(150, 30, 10, 5, C.steel500), circle(162, 32.5, 2.5, C.hazard));
  s.push(lo('M0 124L38 80L60 100L184.7 100L195 124Z', 0.1));
  return s.join('');
}

/* Cab ---------------------------------------------------------------------- */

const CAB_PTS: P2[] = [[-345, 200], [-165, 200], [-142, 406], [-345, 406]];

function cabSide(outer: boolean) {
  // (u = X + 345, v = 406 − Y); w 203, h 206. Front edge runs (180,206)→(203,0).
  const s = [path('M0 206H180L203 0H0Z', T.body)];
  s.push(rect(0, 0, 203, 5, T.bodyDk));
  const fx = (v: number) => 203 - (23 * v) / 206;
  // Rear pane (door on the outer side)
  const rp = 'M10 12H90V194H10Z';
  s.push(rr(10, 12, 80, 182, 4, T.glass));
  // Front pane (raked)
  const fp = `M100 12H${f1(fx(12) - 10)}L${f1(fx(194) - 10)} 194H100Z`;
  s.push(path(fp, T.glass));
  // Interior silhouettes
  s.push(rr(34, 104, 42, 64, 8, T.glassDk), rr(28, 160, 56, 22, 5, T.glassDk));
  s.push(circle(66, 94, 11, '#10151B'), path('M50 150C50 118 58 108 70 108C86 108 94 120 96 150Z', '#10151B'));
  s.push(rr(118, 132, 36, 62, 5, T.glassDk), path('M132 132L148 108L154 112L140 136Z', '#10151B'), rr(146, 102, 14, 7, 3, '#10151B'));
  s.push(rr(96, 150, 16, 44, 4, T.glassDk), rr(122, 128, 26, 8, 2, '#2C4A66'), rr(124, 130, 8, 4, 1, '#7FD3FF'));
  // Sky reflection band + reflections
  s.push(path('M10 12H90V44L10 66Z', T.sky), path(`M100 12H${f1(fx(12) - 10)}L${f1(fx(40) - 10)} 40L100 62Z`, T.sky));
  s.push(path('M10 70L60 12H78L10 92Z', 'rgba(255,255,255,.1)'), path('M100 96L170 12H186L100 116Z', 'rgba(255,255,255,.09)'));
  s.push(path('M10 150L90 70V82L10 162Z', 'rgba(255,255,255,.05)'));
  // Frame edge highlights
  s.push(stroke(rp, '#0E1014', 2.6, { 'stroke-linejoin': 'round' }), stroke(fp, '#0E1014', 2.6, { 'stroke-linejoin': 'round' }));
  s.push(rect(0, 5, 3, 193, 'rgba(255,255,255,.14)'), rect(94, 12, 2, 182, 'rgba(0,0,0,.25)'));
  s.push(rect(91, 12, 1.4, 182, 'rgba(255,255,255,.18)'));
  if (outer) {
    // Door seam, handle, hinges, grab rail
    s.push(seam('M6 8H94V200H6Z', 'rgba(0,0,0,.45)', 1.4));
    s.push(rr(80, 118, 10, 5, 2, '#15161A'), rect(4, 40, 4, 12, T.bodyEdge), rect(4, 150, 4, 12, T.bodyEdge));
  }
  s.push(rect(0, 198, 180, 8, T.bodyDk));
  s.push(hi('M0 5H203V14H0Z', 0.05));
  return s.join('');
}

function cabWindshield(len: number) {
  const w = 117;
  const art = [
    rect(0, 0, w, len, T.body),
    rr(8, 10, w - 16, len - 30, 4, T.glass),
    path(`M8 10H${w - 8}V${f1(len * 0.22)}L8 ${f1(len * 0.34)}Z`, T.sky),
    rect(8, 10, w - 16, 14, 'rgba(0,0,0,.4)'),
    path(`M${w * 0.55} 24L${w - 8} 24V${f1(len * 0.2)}Z`, 'rgba(255,255,255,.06)'),
    stroke(`M8 10H${w - 8}V${len - 20}H8Z`, '#0E1014', 2.6),
    path(`M8 ${f1(len * 0.62)}L${w - 30} 24H${w - 12}L8 ${f1(len * 0.8)}Z`, 'rgba(255,255,255,.1)'),
    rr(12, len - 52, w - 24, 20, 4, T.glassDk),
    circle(22, len - 58, 10, '#10151B'),
    stroke(`M${w / 2} ${len - 24}L${w / 2 - 38} ${len - 84}`, '#0E0F12', 2.4), circle(w / 2, len - 24, 3, '#0E0F12'),
    rr(w / 2 - 22, len - 30, 44, 6, 2, '#2C4A66'),
    rect(0, len - 20, w, 20, T.bodyDk),
    lampBox(10, len - 16, 16, 9, T.amber), lampBox(w - 26, len - 16, 16, 9, T.amber),
  ].join('');
  return edgeUpFromFront(len, art);
}

function cabRearWindow() {
  const w = 117, h = 206;
  const art = [
    rect(0, 0, w, h, T.body), rect(0, 0, w, 5, T.bodyDk),
    rr(10, 12, w - 20, 128, 4, T.glass),
    rr(22, 70, 50, 70, 6, T.glassDk),
    path('M10 90L74 12H90L10 110Z', 'rgba(255,255,255,.09)'),
    rr(20, 150, w - 40, 36, 4, T.bodyLo), louvres(26, 154, w - 52, 28, 5, T.bodyDk, T.bodyLo, T.bodyEdge),
    rect(0, h - 8, w, 8, T.bodyDk),
  ].join('');
  return edgeDownFromRear(w, art);
}

function roofSide() {
  return rect(0, 0, 220, 12, T.bodyLo) + rect(0, 0, 220, 2.5, T.bodyHi) + rect(0, 9, 220, 3, T.bodyEdge);
}
function roofFront() {
  return rect(0, 0, 131, 12, T.bodyLo) + rect(0, 0, 131, 2.5, T.bodyHi) + lampBox(10, 1.5, 28, 9, T.lamp) + lampBox(93, 1.5, 28, 9, T.lamp);
}
function roofRear() {
  return rect(0, 0, 131, 12, T.bodyLo) + rect(0, 0, 131, 2.5, T.bodyHi) + lampBox(12, 1.5, 22, 9, T.lamp) + lampBox(97, 1.5, 22, 9, T.lamp);
}
function roofTop() {
  const w = 220, h = 131;
  return [
    rect(0, 0, w, h, T.body), rect(0, 0, w, 5, T.bodyHi), rect(0, h - 5, w, 5, T.bodyDk),
    seam(`M8 8H${w - 8}V${h - 8}H8Z`, 'rgba(0,0,0,.25)', 1.2),
    text(172, 72, 'RS-45', 13, T.white, { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 1.5 }),
    rr(160, 20, 22, 5, 2, C.steel700),
  ].join('');
}

function cabBaseSide(outer: boolean) {
  const w = 217, h = 32;
  const s = [rect(0, 0, w, h, T.frameLo), rect(0, 0, w, 3, T.frameHi), rect(0, h - 4, w, 4, T.frameDk)];
  if (outer) {
    // nz: u = −135 − X. Steps under the door (door X −335…−255 → u 120…200).
    s.push(rr(128, 8, 64, 14, 3, C.steel900), rect(131, 10, 58, 3, C.steel500), rect(131, 14, 58, 1.2, 'rgba(255,255,255,.12)'));
  }
  s.push(bolts(10, w - 10, h - 9, 10, 1.6, C.steel900));
  return s.join('');
}

/* Boom --------------------------------------------------------------------- */

const S1_PTS: P2[] = [[-58, -22], [-10, -48], [648, -42], [648, 42], [-38, 48], [-58, 28]];

function s1Cap(mirrored: boolean, id: string) {
  // Art coords (u + 58, 48 − v); w 706, h 96.
  const ol: P2[] = S1_PTS.map(([u, v]) => [u + 58, 48 - v]);
  const s = [path(polyD(ol), T.boom)];
  s.push(poly([[20, 0], [706, 6], [706, 12], [20, 6.5], [1, 24.5], [0, 20]], T.boomHi));
  s.push(poly([[48, 96], [706, 90], [706, 84], [48, 90]], T.boomLo));
  s.push(seam('M26 15L700 20', 'rgba(0,0,0,.35)', 1.2));
  s.push(seam('M300 20V86M470 21V85', 'rgba(0,0,0,.22)', 1));
  // Hydraulic hose bundle running to the tip
  for (const [y0, y1, c] of [[62, 58, C.steel900], [70, 66, '#15171B']] as const) {
    const d = `M94 ${y0}C220 ${y0 + 2} 440 ${y1} 690 ${y1}`;
    s.push(stroke(d, c, 4.2), stroke(d, 'rgba(255,255,255,.14)', 1, { transform: 'translate(0 -1.3)' }));
  }
  for (const u of [150, 250, 350, 450, 550]) s.push(rr(u, 54, 6, 18, 1.5, C.steel500));
  // Chevron warning block at the mouth
  s.push(hazClip(`${id}-hz`, 'M598 14H690V84H598Z', 598, 14, 92, 70, 18));
  s.push(rect(596, 14, 3, 70, 'rgba(0,0,0,.35)'));
  // Pivot boss
  s.push(circle(58, 48, 30, T.boomLo), circle(58, 48, 25, T.boomHi), circle(58, 48, 14, C.steel400), circle(58, 48, 6, C.steel800));
  s.push(boltRing(58, 48, 20, 6, 1.6, T.boomLo));
  // Trunnion boss for the lift cylinders
  const tx = RS.trunnion[0] + 58, ty = 48 - RS.trunnion[1];
  s.push(circle(tx, ty, 20, T.boomLo), circle(tx, ty, 16, C.steel600), circle(tx, ty, 8, C.steel400), boltRing(tx, ty, 12.5, 6, 1.4, C.steel800));
  // Lube points
  s.push(circle(110, 84, 2.2, C.hazard), circle(tx + 26, ty + 8, 2.2, C.hazard));
  // Lettering
  const mark =
    text(390, 46, 'NAVAIR', 30, T.white, { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 5, style: 'font-stretch:125%' });
  const model = text(535, 45, 'RS-45', 14, C.hazard, { 'text-anchor': 'middle', family: 'mono', 'font-weight': 700, 'letter-spacing': 1.5 });
  const swl = text(150, 37, 'SWL 45 000 kg', 7.5, C.steel300, { 'text-anchor': 'middle', family: 'mono', 'letter-spacing': 1 });
  if (mirrored) s.push(RT(390, mark), RT(535, model), RT(150, swl));
  else s.push(mark, model, swl);
  s.push(lo('M48 90L706 84V90L48 96Z', 0.12));
  return s.join('');
}

function s1Top(len: number, d: number) {
  const s = [rect(0, 0, len, d, T.boom), rect(0, 0, len, 5, T.boomHi), rect(0, d - 5, len, 5, T.boomHi)];
  for (const [v, c] of [[d / 2 - 9, C.steel900], [d / 2 + 5, '#15171B']] as const) {
    s.push(rect(40, v, len - 80, 5, c), rect(40, v, len - 80, 1.2, 'rgba(255,255,255,.15)'));
  }
  for (let u = 80; u < len - 40; u += 100) s.push(rr(u, d / 2 - 13, 6, 26, 1.5, C.steel500));
  // Anti-slip service strips near the pivot end, bolt rows along both edges, grease points
  s.push(treadPlate(len - 230, 8, 170, 12, '#23262C', '#3A3F48', 8), treadPlate(len - 230, d - 20, 170, 12, '#23262C', '#3A3F48', 8));
  s.push(bolts(40, len - 40, 7, Math.round(len / 28), 1.2, '#15171B'), bolts(40, len - 40, d - 7, Math.round(len / 28), 1.2, '#15171B'));
  for (const u of [120, 340, 560]) s.push(circle(u, d / 2 + 18, 2.2, C.hazard));
  s.push(rect(0, 0, 36, d, T.boomLo), hazRect('rs-hz-s1top', 0, 0, 30, d, 12), lampBox(44, d / 2 - 8, 22, 16, T.lamp));
  s.push(hi(`M0 5H${len}V14H0Z`, 0.05), lo(`M0 ${d - 14}H${len}V${d - 5}H0Z`, 0.08));
  return s.join('');
}

/**
 * Extended inner telescope section: machined, lightly greased steel so every centimetre of extension reads
 * against the painted outer boom. Bright slide tracks (worn bare by the wear pads) run along the top and
 * bottom of each side; a grease film and a cool sky-reflection band sell the curvature. Lengthwise invariant.
 */
function innerArt(h: number, d: number, tone = 0) {
  const k = (c: string) => (tone ? shade(c, tone) : c);
  const side = [
    rect(0, 0, 100, h, k('#8E97A3')),
    rect(0, 0, 100, 3, k('#5A626D')),
    rect(0, 3, 100, h * 0.1, k('#C9D0D8')), // upper slide track (worn bright)
    rect(0, 3 + h * 0.1, 100, 1.2, 'rgba(0,0,0,.25)'),
    rect(0, h * 0.2, 100, h * 0.16, k('#AEB6C0')), // sky reflection
    rect(0, h * 0.24, 100, 1.6, 'rgba(255,255,255,.75)'), // specular line
    rect(0, h * 0.5, 100, h * 0.12, k('#7B8490')),
    rect(0, h * 0.62, 100, 1, 'rgba(40,32,20,.35)'), // grease film edge
    rect(0, h * 0.78, 100, h * 0.1, k('#B9C0C9')), // lower slide track
    rect(0, h * 0.78, 100, 1, 'rgba(255,255,255,.5)'),
    rect(0, h - 4, 100, 4, k('#4B525C')),
  ].join('');
  const top = [
    rect(0, 0, 100, d, k('#A2AAB5')),
    rect(0, 0, 100, 3, k('#D5DBE1')), rect(0, d - 3, 100, 3, k('#D5DBE1')),
    rect(0, 5, 100, d * 0.16, k('#C4CBD3')), rect(0, d - 5 - d * 0.16, 100, d * 0.16, k('#C4CBD3')), // pad tracks
    rect(0, d / 2 - 1.5, 100, 3, 'rgba(60,48,30,.28)'), // grease line
    rect(0, d * 0.3, 100, 1.2, 'rgba(255,255,255,.6)'),
  ].join('');
  const bottom = rect(0, 0, 100, d, k('#5E6670')) + rect(0, 4, 100, d * 0.18, k('#7D8691')) + rect(0, d - 4 - d * 0.18, 100, d * 0.18, k('#7D8691'));
  return { side, top, bottom };
}

/** Hydraulic hose pair running outside the inner sections (stretched along X; lengthwise invariant). */
const HOSE_ART =
  rect(0, 1, 100, 5.2, '#141619') + rect(0, 1.6, 100, 1.3, 'rgba(255,255,255,.22)') +
  rect(0, 8, 100, 5.2, '#1B1E22') + rect(0, 8.6, 100, 1.3, 'rgba(255,255,255,.18)');

function collarSide(w: number, h: number, base: string) {
  return rect(0, 0, w, h, base) + rect(0, 0, w, 4, tint(base, 0.16)) + rect(0, h - 5, w, 5, shade(base, 0.35)) + rect(w - 4, 0, 4, h, tint(base, 0.1)) + bolts(w / 2 - 0.5, w / 2 + 0.5, 12, 1, 1.8, C.steel400) + bolts(w / 2 - 0.5, w / 2 + 0.5, h - 12, 1, 1.8, C.steel400);
}
function collarFace(w: number, h: number, base: string, iw: number, ih: number) {
  // Mouth with UHMW wear pads (ivory) top, bottom and at the sides, bolted through the collar.
  const x0 = (w - iw) / 2, y0 = (h - ih) / 2;
  const pad = '#E6DFC8';
  return (
    rect(0, 0, w, h, base) + rr(x0 - 2, y0 - 2, iw + 4, ih + 4, 3, '#0B0C0E') + rect(0, 0, w, 3, tint(base, 0.18)) +
    rect(x0 + iw * 0.18, y0 - 4, iw * 0.64, 4.5, pad) + rect(x0 + iw * 0.18, y0 + ih - 0.5, iw * 0.64, 4.5, pad) +
    rect(x0 - 4, y0 + ih * 0.3, 4.5, ih * 0.4, pad) + rect(x0 + iw - 0.5, y0 + ih * 0.3, 4.5, ih * 0.4, pad) +
    bolts(x0 + iw * 0.25, x0 + iw * 0.75, y0 - 8, 3, 1.3, C.steel400) + bolts(x0 + iw * 0.25, x0 + iw * 0.75, y0 + ih + 8, 3, 1.3, C.steel400)
  );
}

/* Spreader ----------------------------------------------------------------- */

const EB_PTS: P2[] = [[-134, -118], [-122, -150], [122, -150], [134, -118], [134, -88], [-134, -88]];

function endBeamOuter(id: string) {
  // (X + 134, −88 − Y); w 268, h 62
  const ol = polyD(EB_PTS.map(([x, y]) => [x + 134, -88 - y] as P2));
  return [
    hazClip(id, ol, 0, 0, 268, 62, 22),
    rect(0, 0, 268, 9, '#1E2126'), rect(0, 0, 268, 2, 'rgba(255,255,255,.15)'),
    path('M0 30L12 62H34V38H0Z', '#1B1D22'), path('M268 30L256 62H234V38H268Z', '#1B1D22'),
    circle(21, 50, 4, C.steel400), circle(247, 50, 4, C.steel400),
    rr(116, 14, 36, 12, 2, '#1E2126'), text(134, 23, '40′', 8, C.hazard, { 'text-anchor': 'middle', family: 'mono', 'font-weight': 700 }),
    rr(60, 15, 10, 16, 2, '#E9ECEF'), rr(198, 15, 10, 16, 2, '#E9ECEF'), bolts(20, 248, 4.5, 14, 1.2, '#0E0F12'),
    lo('M7.5 50H260.5L256 62H12Z', 0.12),
  ].join('');
}
function endBeamInner() {
  const ol = polyD(EB_PTS.map(([x, y]) => [x + 134, -88 - y] as P2));
  return path(ol, '#25282E') + rect(0, 0, 268, 5, '#343840') + rr(106, 6, 56, 38, 3, '#15171B') + rect(16, 40, 236, 4, C.hazard) + path('M0 30L12 62H42V38H0Z', '#1B1D22') + path('M268 30L256 62H226V38H268Z', '#1B1D22');
}

function beamSide(mirrored: boolean) {
  const w = 530, h = 42;
  const s = [rect(0, 0, w, h, '#23262C'), rect(0, 0, w, 4, '#343840'), rect(0, h - 5, w, 5, '#16181C')];
  s.push(seam('M140 5V37M390 5V37', 'rgba(0,0,0,.4)', 1.2), seam('M141.5 5V37M391.5 5V37', 'rgba(255,255,255,.08)', 1));
  s.push(stroke('M10 30H520', '#111317', 3.2), stroke('M10 29H520', 'rgba(255,255,255,.1)', 0.8));
  // telescope cylinders + cable chain drawn along the beam
  s.push(rr(150, 9, 110, 10, 5, C.steel500), rr(260, 12, 80, 4, 2, C.steel200), rr(290, 9, 90, 10, 5, C.steel500), rr(210, 12, 80, 4, 2, C.steel200));
  let chain = '';
  for (let u = 150; u < 380; u += 7) chain += `M${u} 33h5v4h-5Z`;
  s.push(path(chain, '#0E0F12'), rect(0, 0, 3, h, C.hazard), rect(w - 3, 0, 3, h, C.hazard));
  s.push(hi(`M0 4H${w}V9H0Z`, 0.06), lo(`M0 ${h - 12}H${w}V${h - 5}H0Z`, 0.1));
  const t = text(70, 22, 'NAVAIR', 11, T.white, { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 2 });
  const t2 = text(460, 22, 'SWL 45 t', 8, C.hazard, { 'text-anchor': 'middle', family: 'mono', 'font-weight': 700 });
  s.push(mirrored ? RT(70, t) + RT(460, t2) : t + t2);
  s.push(bolts(12, w - 12, 8, 24, 1.3, '#15171B'));
  return s.join('');
}

/* ------------------------------------------------------------------------ */
/* Public API                                                                */
/* ------------------------------------------------------------------------ */

export interface ReachPose {
  /** Machine front-axle x in world (cm). The machine moves along its heading line. */
  x: number;
  /** World z of the machine centreline. */
  z: number;
  /** Yaw degrees (0 = faces +X). */
  heading: number;
  /** Boom elevation degrees above horizontal. */
  boom: number;
  /** Telescope extension in cm (0..EXT_MAX). */
  ext: number;
  /** Spreader length 0 (20') .. 1 (40'). */
  spread: number;
  /** Spreader rotation about vertical, degrees (0 = beam across machine Z). */
  spreaderYaw: number;
  /** 0 unlocked .. 1 locked. */
  twist: number;
  /** Small extra boom-nod degrees (nose down) for "taking the weight". */
  dip: number;
  /**
   * Fore/aft pendulum of the whole hanging group (link, rotator, spreader, carried box) about the boom-head
   * pin, degrees. + swings the load toward machine +X (forward). The hanging group is otherwise gravity-level.
   */
  swayX?: number;
  /** Lateral pendulum about the head pin, degrees. + swings the load toward machine +Z (right / near side at yaw 0). */
  swayZ?: number;
  /** Alias added to swayX (fore/aft), for choreography that only animates one axis. */
  sway?: number;
  /**
   * Carried weight 0 (empty) .. 1 (rated load at this reach). The rear steer axle unloads: the sprung body
   * pitches nose-down up to 0.6° about the front axle, the front tyres squash ~3.5 %, the rear of the body
   * lifts ~6 cm and the rear tyres relax. seat()/solve()/plan() include this.
   */
  load?: number;
  /** Spreader side-shift along its own long axis, cm (±80 typical). + = toward spreader local +X (machine +Z at spreaderYaw 0). */
  side?: number;
  /** Spreader side-tilt about its short axis, degrees (±5 typical). + raises the spreader local +X end. */
  tilt?: number;
}

export interface ReachStacker {
  root: Node3;
  pose: ReachPose;
  apply(): void;
  /**
   * Where a carried container goes, computed analytically from pose.
   * p   = world position for the CONTAINER ORIGIN (floor centre) so its roof sits flush on the twistlock plane.
   * yaw = container r.y so its long axis (local X) runs along the spreader.
   * plane = world point at the centre of the twistlock plane (spreader underside) = p + [0, BOX.H, 0].
   */
  seat(): {
    p: V3;
    yaw: number;
    plane: V3;
    /**
     * Full container Euler rotation (engine order yaw → pitch(z) → roll(x)), including sway and spreader tilt.
     * r.y === yaw. Use `Object.assign(box.r, s.r)` instead of `box.r.y = s.yaw` once sway/tilt are animated.
     */
    r: { x: number; y: number; z: number };
  };
  /**
   * Inverse kinematics (dip = 0, sway = 0): boom angle + ext that put the TWISTLOCK PLANE centre at
   * machine-forward distance dx from the front axle and world height y. To land on a stack whose top is at
   * y, pass y. To set a carried box's floor at height f, pass f + BOX.H. Exact (not clamped to EXT_MAX).
   * Accounts for the body pitch of `load` (defaults to the current pose.load).
   */
  solve(dx: number, y: number, load?: number): { boom: number; ext: number };
  /** See the exported `plan()`; uses this machine's current pose.load unless given. */
  plan(dx: number, y: number, opts?: PlanOpts): Plan;
  EXT_MAX: number;
}

export interface PlanOpts {
  /** How far (cm, ±) the machine may drive along its heading to reach a realistic combo. Default Infinity. 0 = exact solve, clamped. */
  maxShift?: number;
  /** Load for the body-pitch correction (0..1). Default 0. */
  load?: number;
}

export interface Plan {
  boom: number;
  ext: number;
  /** Drive the machine this far along its heading (+ = toward the load) before using boom/ext: pose.x += shift·cos(heading). */
  shift: number;
  /** Resulting machine-forward distance of the target from the front axle (= dx − shift). */
  dx: number;
  /** True when the returned combo puts the plane on the target (within 0.5 cm). */
  exact: boolean;
}

/** Body pitch (deg, nose-down negative) and front-tyre squash fraction for a load 0..1. */
function suspension(load: number) {
  const l = clamp(load, 0, 1);
  return { pb: -0.6 * l, sq: 0.035 * l };
}

/** Body point (original machine coords) → machine coords under suspension. */
function bodyToMachine(pt: V3, load: number): V3 {
  const { pb, sq } = suspension(load);
  return add(mapply(rotZ(pb), [pt[0], pt[1] - RF, pt[2]]), [0, RF * (1 - sq), 0]);
}
function machineToBody(pt: V3, load: number): V3 {
  const { pb, sq } = suspension(load);
  return add(mapply(rotZ(-pb), [pt[0], pt[1] - RF * (1 - sq), pt[2]]), [0, RF, 0]);
}

/** Exact IK in machine coords (twistlock plane centre at (dx, y), spreader level and un-swayed). */
function solveAt(dx: number, y: number, load: number) {
  const [bx, by] = machineToBody([dx, y + HANG, 0], load);
  const vx = bx - PX, vy = by - PY;
  return { boom: Math.atan2(vy, vx) / DEG, ext: Math.hypot(vx, vy) - R0 };
}

/**
 * Realistic boom/extension planner. Real operators keep the boom between ~5° and ~60° and use the telescope
 * in proportion to the stack height (first tier ≈ retracted, fifth tier ≈ fully out) and then position the
 * MACHINE, rather than reaching with odd combos. Given the twistlock-plane target (dx forward of the front
 * axle, world height y) this picks that preferred combo and returns how far to drive (`shift`, clamped to
 * ±maxShift) so the target is still met exactly. With maxShift 0 it is solve() clamped to the limits.
 */
export function plan(dx: number, y: number, opts: PlanOpts = {}): Plan {
  const load = opts.load ?? 0;
  const maxShift = opts.maxShift ?? Infinity;
  const [, byT] = machineToBody([dx, y + HANG, 0], load);
  const vy = byT - PY;
  // Preferred extension grows with height: tier 1 (plane ≈ 290) retracted → tier 5 (≈ 1450) fully out.
  const f = clamp((y - 290) / (1300 - 290), 0, 1);
  let R = R0 + EXT_MAX * f * f * (3 - 2 * f);
  let boom = Math.asin(clamp(vy / R, -1, 1)) / DEG;
  if (boom > 60) {
    // Too steep: extend further at 60°; past full extension the target is out of realistic reach.
    boom = 60;
    R = clamp(vy / Math.sin(60 * DEG), R0, R0 + EXT_MAX);
  } else if (boom < 5 && vy > 0) {
    // Low targets: stay retracted with a flat boom rather than over-reaching.
    R = R0;
    boom = Math.asin(clamp(vy / R, -1, 1)) / DEG;
  }
  // Machine-forward distance of the plane that this combo reaches.
  const [mx] = bodyToMachine([PX + R * Math.cos(boom * DEG), PY + R * Math.sin(boom * DEG), 0], load);
  const want = dx - mx;
  const shift = clamp(want, -maxShift, maxShift);
  const TOL = 0.5;
  if (Math.abs(shift - want) < 1e-9) {
    return { boom, ext: R - R0, shift, dx: dx - shift, exact: Math.abs(R * Math.sin(boom * DEG) - vy) < TOL };
  }
  // Machine can't move far enough: exact IK from where it may stand, clamped to the mechanical range.
  const rel = dx - shift;
  const s = solveAt(rel, y, load);
  const bC = clamp(s.boom, -5, 65), eC = clamp(s.ext, 0, EXT_MAX);
  const R2 = R0 + eC;
  const [px, py] = bodyToMachine([PX + R2 * Math.cos(bC * DEG), PY + R2 * Math.sin(bC * DEG), 0], load);
  return { boom: bC, ext: eC, shift, dx: rel, exact: Math.hypot(px - rel, py - HANG - y) < TOL };
}

/**
 * Deterministic damped pendulum curve for scroll-scrubbed timelines (no integration, so it scrubs backwards).
 * t = seconds since the kick (≤ 0 → 0). Returns degrees. Reach-stacker hang ≈ 1.5 m → period ≈ 2.5 s;
 * an STS spreader on 20 m of rope ≈ 9 s.
 */
export function swayCurve(t: number, amp: number, period = 2.5, damping = 0.16) {
  if (t <= 0) return 0;
  const w = (2 * Math.PI) / period;
  return amp * Math.exp(-damping * w * t) * Math.sin(w * t);
}

/** Decompose a rotation matrix into the engine's Euler order (M = Ry·Rz·Rx), degrees. */
export function eulerOf(m: M3) {
  return {
    x: Math.atan2(-m[5], m[4]) / DEG,
    y: Math.atan2(-m[6], m[0]) / DEG,
    z: Math.asin(clamp(m[3], -1, 1)) / DEG,
  };
}
/** Unwrap angle a (deg) to the branch nearest ref. */
const near = (a: number, ref: number) => ref + ((((a - ref) % 360) + 540) % 360) - 180;

function trunnionAt(boomDeg: number): P2 {
  const t = boomDeg * DEG, c = Math.cos(t), s = Math.sin(t);
  const [tu, tv] = RS.trunnion;
  return [PX + tu * c - tv * s, PY + tu * s + tv * c];
}

/** Barrel length: shortest pin-to-pin distance over the working range, minus the rod-eye stand-off. */
const LBAR = (() => {
  let dmin = Infinity;
  for (let a = -12; a <= 72; a += 0.5) {
    const [bx, by] = trunnionAt(a);
    dmin = Math.min(dmin, Math.hypot(bx - RS.anchor[0], by - RS.anchor[1]));
  }
  return Math.round(dmin - 26);
})();

export function createReachStacker(): ReachStacker {
  const root = new Node3('reachstacker');
  // Sprung body: pitches about the front-axle centre when the load unloads the rear axle.
  // Wheels stay on `root`; everything else hangs under B (authored in the original machine coords).
  const susp = root.node('rs-susp', [0, RF, 0]);
  const B = susp.node('rs-body', [0, -RF, 0]);

  /* ---- chassis --------------------------------------------------------- */
  // Main frame, split so each visible side face sorts locally (a single 7 m face mis-sorts against the tyres).
  {
    const side = frameSide(), top = frameTop();
    const clip = (w: number, h: number, dx: number, art: string) => `<svg width="${w}" height="${h}" overflow="hidden"><g transform="translate(${-dx} 0)">${art}</g></svg>`;
    const seg = (x0: number, x1: number) => clip(x1 - x0, 95, x0 + 700, side);
    const segM = (x0: number, x1: number) => MX(x1 - x0, seg(x0, x1));
    box(B, -700, 55, -84, 195, 95, 168, { pz: seg(-700, -505), nz: segM(-700, -505) }, { name: 'rs-frameR' });
    box(B, -505, 55, -84, 390, 95, 168, { py: clip(390, 168, 195, top) }, { name: 'rs-frameM' });
    box(B, -115, 55, -84, 155, 95, 168, { pz: seg(-115, 40), nz: segM(-115, 40), py: clip(155, 168, 585, top) }, { name: 'rs-frameF' });
  }
  box(B, 40, 40, -86, 102, 132, 172, { px: noseFront(), pz: noseSide(), nz: MX(102, noseSide()), py: noseTop() }, { name: 'rs-nose' });
  box(B, -20, 140, -84, 80, 46, 168, { pz: anchorSide(RS.anchor[0]), nz: MX(80, anchorSide(RS.anchor[0])), py: anchorTop(), px: anchorEnd(), nx: anchorEnd() }, { name: 'rs-anchor' });

  // Side tanks (fuel right, hydraulic left) with walkway tops
  box(B, -505, 58, 86, 390, 110, 114, { pz: tankSideRight(), py: walkway(true), px: tankEnd(), nx: tankEnd() }, { name: 'rs-tankR' });
  box(B, -505, 58, -200, 390, 110, 114, { nz: tankSideLeft(), py: walkway(false), px: tankEnd(), nx: tankEnd() }, { name: 'rs-tankL' });

  // Arched mudguards over the twin drive tyres (band cap + 5 chord plates)
  {
    const Ro = 106, Ri = 97, cy = RF;
    const angs = [18, 48, 74, 106, 132, 162];
    const outer = angs.map((a) => [Ro * Math.cos(a * DEG), cy + Ro * Math.sin(a * DEG)] as P2);
    const inner = angs.slice().reverse().map((a) => [Ri * Math.cos(a * DEG), cy + Ri * Math.sin(a * DEG)] as P2);
    const pts = [...outer, ...inner];
    const minX = Math.min(...pts.map((p) => p[0])), maxY = Math.max(...pts.map((p) => p[1]));
    const toArt = (p: P2): P2 => [p[0] - minX, maxY - p[1]];
    const band = polyD(pts.map(toArt));
    const oArt = outer.map(toArt);
    const lip = 'M' + oArt.map((p) => `${f1(p[0])} ${f1(p[1])}`).join('L');
    const cap = path(band, T.body) + stroke(lip, T.bodyHi, 2.4) + stroke('M' + inner.map(toArt).map((p) => `${f1(p[0])} ${f1(p[1])}`).join('L'), '#15161A', 3);
    const plate = (i: number, len: number, d: number) => {
      if (i > 4) return null;
      const s = [treadPlate(0, 0, len, d, T.body, T.bodyLo, 11), rect(0, 0, len, 4, T.bodyHi), rect(0, d - 4, len, 4, T.bodyDk)];
      if (i === 0) s.push(lampBox(len / 2 - 14, d / 2 - 48, 28, 12, T.amber), lampBox(len / 2 - 14, d / 2 + 36, 28, 12, T.amber));
      return s.join('');
    };
    extrude(B, pts, 88, 208, { front: cap, back: null, edge: plate, name: 'rs-guardR' });
    extrude(B, pts, -208, -88, { front: null, back: cap, edge: plate, name: 'rs-guardL' });
  }

  // Rear wheel-well liners (depth behind the steer tyres)
  const liner = rect(0, 0, 195, 132, C.steel900) + rect(0, 0, 195, 10, 'rgba(0,0,0,.4)');
  B.face({ o: [-700, 172, 132], a: [1, 0, 0], b: [0, -1, 0], w: 195, h: 132, art: liner, shade: 0.3, name: 'rs-wellR' });
  B.face({ o: [-505, 172, -132], a: [-1, 0, 0], b: [0, -1, 0], w: 195, h: 132, art: liner, shade: 0.3, name: 'rs-wellL' });

  // Engine hood over the rear axle
  box(B, -700, 172, -200, 230, 76, 400, { pz: hoodSide(), nz: MX(230, hoodSide(true)), py: hoodTop(), px: hoodFront() }, { name: 'rs-hood' });

  // Counterweight (chamfered profile)
  {
    const art = cwSide();
    const olR = polyD(CW_OUT);
    const olL = polyD(CW_OUT.map(([u, v]) => [78 - u, v] as P2));
    B.face({ o: [-778, 252, 202], a: [1, 0, 0], b: [0, -1, 0], w: 78, h: 212, art, outline: olR, name: 'rs-cw.pz' });
    B.face({ o: [-700, 252, -202], a: [-1, 0, 0], b: [0, -1, 0], w: 78, h: 212, art: MX(78, cwSide(true)), outline: olL, name: 'rs-cw.nz' });
    B.face({ o: [-778, 222, -202], a: [0, 0, 1], b: [0, -1, 0], w: 404, h: 154, art: cwRear(), name: 'rs-cw.nx' });
    B.face({ o: [-748, 252, -202], a: [1, 0, 0], b: [0, 0, 1], w: 48, h: 404, art: cwTop(), name: 'rs-cw.py' });
    const ch = Math.SQRT1_2;
    B.face({
      o: [-748, 252, -202], a: [0, 0, 1], b: [-ch, -ch, 0], w: 404, h: 42.43,
      art: rect(0, 0, 404, 42.43, T.body) + rect(0, 0, 404, 3, T.bodyHi) + rr(186, 12, 32, 14, 4, T.bodyDk) + lampBox(192, 14, 20, 10, T.amber),
      name: 'rs-cw.ch',
    });
    const lc = Math.hypot(18, 28);
    B.face({
      o: [-778, 68, -202], a: [0, 0, 1], b: [18 / lc, -28 / lc, 0], w: 404, h: lc,
      art: hazRect('rs-hz-cw', 0, 0, 404, lc, 20) + rect(0, 0, 404, 2.5, 'rgba(0,0,0,.35)'),
      name: 'rs-cw.lc',
    });
  }

  // Pivot towers
  const CHEEK: P2[] = [[-650, 248], [-455, 248], [-498, 350], [-530, 372], [-566, 352], [-612, 292]];
  const cheekEdge = (i: number, len: number, d: number) => (i === 0 ? null : rect(0, 0, len, d, i === 2 || i === 3 ? T.bodyHi : T.bodyLo));
  extrude(B, CHEEK, 40, 56, { front: cheekArt(), back: null, edge: cheekEdge, name: 'rs-cheekR' });
  extrude(B, CHEEK, -56, -40, { front: null, back: cheekArt(), edge: cheekEdge, name: 'rs-cheekL' });

  // Service ladder (right) + deck handrails
  B.face({
    o: [-502, 292, 205], a: [1, 0, 0], b: [0, -1, 0], w: 28, h: 266, bias: 160, shade: 0, name: 'rs-ladder',
    art: (() => {
      const s = [stroke('M3 76V14Q3 4 13 4H15Q25 4 25 14V76', C.hazard, 3.2)];
      s.push(stroke('M3 56V266M25 56V266', C.steel600, 3.4), stroke('M2 56V266', 'rgba(255,255,255,.2)', 0.8));
      for (let v = 80; v < 262; v += 24) s.push(rect(3, v, 22, 3.4, C.steel400), rect(3, v, 22, 1, 'rgba(255,255,255,.35)'));
      return s.join('');
    })(),
  });
  const railArt = (w: number) => {
    let d = `M0 6H${w}M0 24H${w}`;
    for (let u = 3; u <= w; u += (w - 6) / 3) d += `M${f1(u)} 6V42`;
    return stroke(d, C.hazard, 3) + stroke(`M0 5H${w}`, 'rgba(255,255,255,.35)', 0.8);
  };
  B.face({ o: [-690, 290, 194], a: [1, 0, 0], b: [0, -1, 0], w: 185, h: 42, art: railArt(185), double: true, shade: 0, name: 'rs-railR' });
  B.face({ o: [-690, 290, -194], a: [1, 0, 0], b: [0, -1, 0], w: 185, h: 42, art: railArt(185), double: true, shade: 0, name: 'rs-railL' });

  // Mirrors
  B.face({
    o: [60, 262, 212], a: [1, 0, 0], b: [0, -1, 0], w: 40, h: 100, double: true, shade: 0, name: 'rs-mirrorR',
    art: stroke('M14 100V40Q14 22 24 22', '#15161A', 3) + rr(20, 0, 18, 36, 3, '#15161A') + rr(22, 3, 14, 30, 2, T.glassHi) + rect(24, 5, 3, 24, 'rgba(255,255,255,.35)'),
  });
  B.face({
    o: [-150, 392, -226], a: [1, 0, 0], b: [0, -1, 0], w: 34, h: 58, double: true, shade: 0, name: 'rs-mirrorL',
    art: stroke('M4 56Q4 30 16 26', '#15161A', 3) + rr(12, 0, 16, 32, 3, '#15161A') + rr(14, 3, 12, 26, 2, T.glassHi),
  });

  // Exhaust stack + pre-cleaner (vertical cylinders)
  const exh = B.node('rs-exhaust', [-668, 294, 150]);
  exh.r.x = -90;
  exh.wheel({ r: 7, w: 92, tread: C.steel500, disc: circle(0, 0, 7, C.steel600) + circle(0, 0, 5, '#0C0D10') });
  B.face({
    o: [-678, 330, 158], a: [1, 0, 0], b: [0, -1, 0], w: 20, h: 70, shade: 0.5, name: 'rs-exhaust-shield',
    outline: rrD(0, 0, 20, 70, 4),
    art: (() => {
      let d = '';
      for (let v = 8; v < 58; v += 6) for (let u = 5 + ((v / 6) % 2) * 2; u < 17; u += 5) d += `M${u + 1.1} ${v}a1.1 1.1 0 1 0 -2.2 0a1.1 1.1 0 1 0 2.2 0`;
      return rr(0, 0, 20, 70, 4, C.steel400) + path(d, C.steel700) + rect(0, 60, 20, 4, C.steel600) + rect(0, 4, 20, 3, C.steel600) + rect(2, 0, 4, 70, 'rgba(255,255,255,.18)');
    })(),
  });
  const pre = B.node('rs-precleaner', [-628, 272, -150]);
  pre.r.x = -90;
  pre.wheel({ r: 13, w: 48, tread: T.frameLo, disc: circle(0, 0, 13, C.steel600) + circle(0, 0, 9, C.steel700) + circle(0, 0, 3, C.steel400) });

  /* ---- cab ------------------------------------------------------------- */
  box(B, -352, 168, -212, 217, 32, 126, { pz: cabBaseSide(false), nz: cabBaseSide(true), px: rect(0, 0, 126, 32, T.frameLo) + rect(0, 0, 126, 3, T.frameHi), nx: rect(0, 0, 126, 32, T.frameLo) }, { name: 'rs-cabbase' });
  extrude(B, CAB_PTS, -205, -88, {
    front: cabSide(false),
    back: cabSide(true),
    edge: (i, len) => (i === 1 ? cabWindshield(len) : i === 3 ? cabRearWindow() : null),
    name: 'rs-cab',
  });
  box(B, -352, 406, -212, 220, 12, 131, { pz: roofSide(), nz: roofSide(), px: roofFront(), nx: roofRear(), py: roofTop() }, { name: 'rs-roof' });
  box(B, -322, 418, -186, 70, 14, 76, {
    py: rect(0, 0, 70, 76, C.steel300) + louvres(8, 8, 54, 60, 6, C.steel400, C.steel200, C.steel500),
    pz: rect(0, 0, 70, 14, C.steel300) + rect(0, 0, 70, 2, C.steel100),
    px: rect(0, 0, 76, 14, C.steel400) + rect(0, 0, 76, 2, C.steel200),
  }, { name: 'rs-ac' });
  const bBase = B.node('rs-beacon-base', [-190, 421, -170]);
  bBase.r.x = -90;
  bBase.wheel({ r: 10, w: 6, tread: '#15161A', disc: circle(0, 0, 8, '#1C1D21') });
  const beacon = B.node('beacon', [-190, 432.5, -170]);
  beacon.r.x = -90;
  beacon.wheel({ r: 9, w: 17, tread: T.amber, disc: circle(0, 0, 9, '#FFB84A') + circle(0, 0, 4.5, '#FFE3A8') });

  /* ---- wheels ---------------------------------------------------------- */
  const front: Node3[] = [];
  const rear: Node3[] = [];
  const fDisc = tyreDisc(RF, 50), fIn = tyreInner(RF);
  const rDisc = tyreDisc(RR, 44), rIn = tyreInner(RR);
  for (const [nm, z] of [['wheel-fro', 176], ['wheel-fri', 117], ['wheel-fli', -117], ['wheel-flo', -176]] as const) {
    const w = root.node(nm, [0, RF, z]);
    w.wheel({ r: RF, w: 54, disc: fDisc, inner: fIn, tread: C.rubber });
    // Tread card on the tangent plane facing +X: the front-view (yaw 90) read of the drive tyres.
    w.face({ o: [RF - 1, TREAD_H / 2, 27], a: [0, 0, -1], b: [0, -1, 0], w: 54, h: TREAD_H, art: TREAD_ART, shade: 0.4, name: `${nm}.tread` });
    front.push(w);
  }
  for (const [nm, z] of [['wheel-rr', 168], ['wheel-rl', -168]] as const) {
    const w = root.node(nm, [RS.rearAxleX, RR, z]);
    w.wheel({ r: RR, w: 55, disc: rDisc, inner: rIn, tread: C.rubber });
    rear.push(w);
  }

  /* ---- lift cylinders --------------------------------------------------- */
  interface Cyl { fr: Node3; rod: Node3; rodDef: WheelDef; eye: Node3; hl: Stretch }
  const cyls: Cyl[] = [];
  for (const sgn of [1, -1]) {
    const z = sgn * RS.cylZ;
    const fr = B.node(sgn > 0 ? 'lift-r' : 'lift-l', [RS.anchor[0], RS.anchor[1], z]);
    const bar = axisNode(fr, `${fr.name}-barrel`, [LBAR / 2, 0, 0]);
    bar.wheel({ r: 17, w: LBAR, tread: '#2B2F36', disc: circle(0, 0, 17, '#3A3F48') + circle(0, 0, 12, C.steel500) + circle(0, 0, 7, C.steel300) });
    // Gland nut at the rod end + base cap: heavier rings read as a real double-acting cylinder.
    const gland = axisNode(fr, `${fr.name}-gland`, [LBAR - 7, 0, 0]);
    gland.wheel({ r: 20, w: 14, tread: C.steel500, disc: circle(0, 0, 20, C.steel400) + circle(0, 0, 13, C.steel600) + boltRing(0, 0, 16.5, 6, 1.4, C.steel800) + circle(0, 0, 10, '#D5DAE0') });
    const rod = axisNode(fr, `${fr.name}-rod`, [LBAR, 0, 0]);
    const rodDef: WheelDef = { r: 9.5, w: 10, tread: '#C7CDD5', disc: circle(0, 0, 9.5, '#E3E7EB') };
    rod.wheel(rodDef);
    // Barrel shading + brand band + the two feed hoses (cap end → rod end) on the outward tangent plane.
    const bArt =
      rect(0, 3, LBAR, 3.4, 'rgba(255,255,255,.16)') + rect(0, 22, LBAR, 10, 'rgba(0,0,0,.26)') +
      rect(LBAR * 0.44, 0, 16, 34, T.accent) + rect(LBAR * 0.44, 0, 16, 4, 'rgba(255,255,255,.2)') +
      rect(0, 0, 12, 34, C.steel600) + rect(0, 0, 12, 3, 'rgba(255,255,255,.2)') +
      // hoses: steel tube along the top, rubber loop to the frame at the base
      rect(16, 8.2, LBAR - 44, 3.2, C.steel300) + rect(16, 8.2, LBAR - 44, 1, 'rgba(255,255,255,.6)') +
      rr(LBAR - 32, 6.5, 8, 7, 1.5, C.steel500) + rr(14, 6.5, 8, 7, 1.5, C.steel500) +
      stroke('M18 13C14 22 6 30 -6 40', '#15171B', 4.2) + stroke('M26 14C24 24 18 34 6 44', '#15171B', 4.2);
    fr.face({ o: [0, 17, sgn * 17.5], a: [1, 0, 0], b: [0, -1, 0], w: LBAR, h: 34, art: bArt, double: true, shade: 0, name: `${fr.name}.hl` });
    // Chrome rod: hard white specular, sky band, dark horizon reflection — stretched to the exposed length.
    const hlFace: FaceDef = {
      o: [LBAR, 9.5, sgn * 9.6], a: [1, 0, 0], b: [0, -1, 0], w: 100, h: 19, double: true, shade: 0,
      art:
        rect(0, 1.2, 100, 3.6, 'rgba(255,255,255,.95)') + rect(0, 4.8, 100, 3, 'rgba(190,210,235,.5)') +
        rect(0, 9.4, 100, 3.2, 'rgba(28,32,40,.55)') + rect(0, 12.6, 100, 1.2, 'rgba(255,255,255,.45)') +
        rect(0, 15, 100, 3, 'rgba(0,0,0,.2)'),
      name: `${fr.name}.rodhl`,
    };
    fr.face(hlFace);
    const hl: Stretch = { set: (x0, len) => { hlFace.o[0] = x0; hlFace.a[0] = Math.max(len, 0.05) / 100; } };
    const eye = fr.node(`${fr.name}-eye`, [LBAR, 0, 0]);
    eye.face({
      o: [-14, 14, sgn * 12], a: [1, 0, 0], b: [0, -1, 0], w: 28, h: 28, double: true, shade: 0.4,
      outline: 'M0 14a14 14 0 1 0 28 0a14 14 0 1 0 -28 0Z',
      art: circle(14, 14, 14, C.steel500) + circle(14, 14, 10, C.steel400) + circle(14, 14, 5, C.steel700) + rect(0, 10, 6, 8, C.steel300),
      name: `${fr.name}.eye`,
    });
    cyls.push({ fr, rod, rodDef, eye, hl });
  }

  /* ---- boom ------------------------------------------------------------ */
  const boom = B.node('boom', [PX, PY, 0]);
  extrude(boom, S1_PTS, -38, 38, {
    front: s1Cap(false, 'rs-s1a'),
    back: s1Cap(true, 'rs-s1b'),
    edge: (i, len, d) => {
      if (i === 2) return null;
      if (i === 3) return s1Top(len, d);
      if (i === 1) return rect(0, 0, len, d, T.boomLo) + rect(0, d / 2 - 12, len, 24, '#191B20') + rect(0, 0, len, 3, T.boom);
      return rect(0, 0, len, d, i === 4 ? T.boomHi : T.boomLo);
    },
    name: 'rs-s1',
  });
  // S1 mouth collar
  box(boom, 632, -50, -42, 32, 100, 84, {
    pz: collarSide(32, 100, T.boomHi), nz: collarSide(32, 100, T.boomHi),
    py: rect(0, 0, 32, 84, T.boomHi) + rect(0, 0, 4, 84, 'rgba(255,255,255,.12)'),
    ny: rect(0, 0, 32, 84, T.boomLo),
    px: collarFace(84, 100, T.boomHi, 62, 72),
  }, { name: 'rs-c1' });
  const tube2 = tube(boom, -36, 36, 31, innerArt(72, 62), 'rs-t2');
  // Work lights on the S1 top, just behind the mouth collar, aimed down the boom at the spreader.
  for (const sgn of [1, -1]) {
    const lens = rr(0, 0, 14, 14, 2.5, '#15161A') + rr(1.6, 1.6, 10.8, 10.8, 2, T.lamp) + rr(2.6, 2.4, 5, 3, 1, 'rgba(255,255,255,.85)') + rect(1.6, 9, 10.8, 1.2, 'rgba(0,0,0,.18)');
    const side = rect(0, 0, 22, 14, '#1A1C20') + rect(0, 0, 22, 2, '#34383F') + rect(5, 5, 12, 1.4, '#2A2D33') + rect(5, 8, 12, 1.4, '#2A2D33');
    box(boom, 592, 42, sgn > 0 ? 20 : -34, 22, 14, 14, {
      px: lens, py: rect(0, 0, 22, 14, '#23262B') + rect(0, 0, 22, 2, '#3A3F48'),
      ...(sgn > 0 ? { pz: side } : { nz: side }),
    }, { name: `rs-worklight${sgn}` });
  }
  // Hose pair from the S1 mouth to the head manifold (stretched with the extension, both sides).
  const hoseFaces: FaceDef[] = [];
  for (const sgn of [1, -1]) {
    const f: FaceDef = sgn > 0
      ? { o: [664, 28, 34], a: [1, 0, 0], b: [0, -1, 0], w: 100, h: 14, art: HOSE_ART, shade: 0.5, name: 'rs-hoses.pz' }
      : { o: [664, 14, -34], a: [1, 0, 0], b: [0, 1, 0], w: 100, h: 14, art: MY(14, HOSE_ART), shade: 0.5, name: 'rs-hoses.nz' };
    boom.face(f);
    hoseFaces.push(f);
  }

  const s2 = boom.node('boom-s2', [0, 0, 0]);
  box(s2, 670, -40, -35, 24, 80, 70, {
    pz: collarSide(24, 80, T.s2), nz: collarSide(24, 80, T.s2),
    py: rect(0, 0, 24, 70, tint(T.s2, 0.08)) + rect(4, 10, 16, 50, '#E6DFC8'), ny: rect(0, 0, 24, 70, shade(T.s2, 0.3)),
    px: collarFace(70, 80, T.s2, 48, 56), nx: rect(0, 0, 70, 80, shade(T.s2, 0.2)),
  }, { name: 'rs-c2' });
  const tube3 = tube(s2, -28, 28, 24, innerArt(56, 48, 0.06), 'rs-t3');

  const s3 = s2.node('boom-s3', [0, 0, 0]);
  const HEAD: P2[] = [[722, -30], [786, -30], [800, -14], [800, 18], [784, 34], [722, 34]];
  extrude(s3, HEAD, -30, 30, {
    front: (() => {
      const ol = polyD(HEAD.map(([u, v]) => [u - 722, 34 - v] as P2));
      return (
        path(ol, T.boom) + rect(0, 0, 62, 4, T.boomHi) + circle(38, 34, 16, T.boomLo) + circle(38, 34, 12, C.steel500) + circle(38, 34, 5.5, C.steel300) + boltRing(38, 34, 9, 6, 1.2, C.steel700) + rect(0, 0, 5, 64, 'rgba(0,0,0,.3)') +
        // hose manifold where the boom hoses land
        rr(1, 5, 16, 16, 2, C.steel700) + circle(6, 10, 2.4, C.steel400) + circle(12, 10, 2.4, C.steel400) + circle(6, 16, 2.4, C.steel400) + circle(12, 16, 2.4, C.steel400) +
        lampBox(22, 7, 18, 9, T.lamp)
      );
    })(),
    edge: (i, len, d) => {
      if (i === 5) return null;
      if (i === 2) return hazRect(`rs-hz-head${i}`, 0, 0, len, d, 12);
      // Nose plate: twin forward work lamps (the front-view read of the boom head).
      if (i === 3) return edgeUpFromFront(len, rect(0, 0, d, len, T.boomLo) + lampBox(5, 8, 20, 14, T.lamp) + lampBox(d - 25, 8, 20, 14, T.lamp) + rect(0, 0, d, 2.5, T.boomHi));
      return rect(0, 0, len, d, i === 4 ? T.boomHi : T.boomLo);
    },
    name: 'rs-head',
  });

  /* ---- head link → pendulum → rotator → spreader --------------------- */
  // `rot` is kept gravity-level (counter-rotated against boom + body pitch); `pend` swings about the head
  // pin (sway); `spr` slews (spreaderYaw); `sprF` side-shifts and tilts about the twistlock-plane centre.
  const rot = s3.node('rotator', [R0, 0, 0]);
  const pend = rot.node('rs-pendulum', [0, 0, 0]);
  const plateOl = 'M0 18A17 17 0 0 1 34 18V84H0Z';
  const plateArt = path(plateOl, C.steel800) + circle(17, 18, 10, C.steel500) + circle(17, 18, 5, C.steel300) + rect(0, 60, 34, 4, 'rgba(255,255,255,.08)') + bolts(8, 26, 74, 3, 1.6, C.steel500) + circle(17, 18, 13, 'none', { stroke: C.steel600, 'stroke-width': 2 });
  pend.face({ o: [-17, 18, 36], a: [1, 0, 0], b: [0, -1, 0], w: 34, h: 84, art: plateArt, outline: plateOl, name: 'rs-link.pz' });
  pend.face({ o: [17, 18, -36], a: [-1, 0, 0], b: [0, -1, 0], w: 34, h: 84, art: plateArt, outline: plateOl, name: 'rs-link.nz' });
  // Hose loop: head manifold → drape → rotator valve block.
  {
    const d1 = 'M34 12C8 14 -4 44 10 70S30 86 36 88', d2 = 'M40 14C18 18 6 46 18 70S34 84 40 88';
    const art = stroke(d1, '#15171B', 5) + stroke(d1, 'rgba(255,255,255,.2)', 1.2, { transform: 'translate(-1 -1)' }) + stroke(d2, '#1B1E22', 5) + stroke(d2, 'rgba(255,255,255,.16)', 1.2, { transform: 'translate(-1 -1)' });
    pend.face({ o: [-70, 26, 40], a: [1, 0, 0], b: [0, -1, 0], w: 50, h: 90, art, double: true, shade: 0, name: 'rs-hoseloop.pz' });
    pend.face({ o: [-20, 26, -40], a: [-1, 0, 0], b: [0, -1, 0], w: 50, h: 90, art, double: true, shade: 0, name: 'rs-hoseloop.nz' });
  }
  const rotSide = rect(0, 0, 84, 24, '#1E2126') + rect(0, 0, 84, 3, '#343840') + rect(0, 9, 84, 6, T.accent) + bolts(8, 76, 20, 6, 1.4, C.steel500) + rr(58, 3, 18, 6, 1.5, C.steel600);
  box(pend, -42, -82, -42, 84, 24, 84, {
    pz: rotSide, nz: rotSide, px: rotSide, nx: rotSide,
    py: rect(0, 0, 84, 84, '#23262C') + circle(42, 42, 34, '#2C3037') + boltRing(42, 42, 28, 12, 1.6, C.steel500) + rr(30, 30, 24, 24, 4, '#15171B') + rr(6, 6, 20, 14, 2, C.steel600),
  }, { name: 'rs-rot' });
  // Slewing ring (gear rim + bolt circle) between the rotator head and the spreader frame.
  const slew = pend.node('rs-slew', [0, -85, 0]);
  slew.r.x = -90;
  slew.wheel({
    r: 52, w: 7, tread: '#30343B',
    disc:
      circle(0, 0, 52, '#262A30') + circle(0, 0, 49, 'none', { stroke: '#474D57', 'stroke-width': 4, 'stroke-dasharray': '3.2 3.2' }) +
      circle(0, 0, 44, '#2E3239') + boltRing(0, 0, 40, 18, 1.5, C.steel400) + circle(0, 0, 34, '#1E2126'),
  });

  const spr = pend.node('spreader', [0, 0, 0]);
  const sprF = spr.node('rs-spreader-frame', [0, -HANG, 0]);
  const sprB = sprF.node('rs-spreader-body', [0, HANG, 0]);
  box(sprB, -265, -130, -28, 530, 42, 56, {
    pz: beamSide(false), nz: MX(530, beamSide(true)),
    py: rect(0, 0, 530, 56, '#2A2E35') + rect(0, 0, 530, 4, '#3A3F48') + rect(0, 52, 530, 4, '#3A3F48') + rect(20, 24, 490, 8, '#15171B') + rect(20, 24, 490, 1.5, 'rgba(255,255,255,.12)'),
    ny: rect(0, 0, 530, 56, '#15171B'),
    px: collarFace(56, 42, '#2A2E35', 44, 32), nx: collarFace(56, 42, '#2A2E35', 44, 32),
  }, { name: 'rs-beam' });
  for (const x of [70, -120]) {
    box(sprB, x, -88, -18, 50, 16, 36, {
      pz: rect(0, 0, 50, 16, C.steel600) + rect(0, 0, 50, 2, C.steel400) + bolts(6, 44, 11, 4, 1.3, C.steel800),
      nz: rect(0, 0, 50, 16, C.steel600) + rect(0, 0, 50, 2, C.steel400),
      py: rect(0, 0, 50, 36, C.steel500) + circle(25, 18, 9, C.steel600) + circle(25, 18, 4, C.steel800),
    }, { name: `rs-motor${x}` });
  }
  const armArt = innerArt(34, 44, 0.04);
  const armP = tube(sprB, -126, -92, 22, armArt, 'rs-armP');
  const armN = tube(sprB, -126, -92, 22, armArt, 'rs-armN');

  const endP = sprB.node('endbeam-p', [RS.tl40, 0, 0]);
  endP.r.y = 90;
  const endN = sprB.node('endbeam-n', [-RS.tl40, 0, 0]);
  endN.r.y = -90;
  const ebEdge = (i: number, len: number, d: number) => {
    if (i === 1) return null;
    if (i === 4) return rect(0, 0, len, d, '#2A2E35') + rect(0, 0, len, 3, C.hazard) + rect(0, d - 3, len, 3, C.hazard);
    if (i === 3 || i === 5) return rect(0, 0, len, d, '#1E2126') + lampBox(len / 2 - 5, d / 2 - 6, 10, 12, T.amber);
    return rect(0, 0, len, d, '#1B1D22');
  };
  extrude(endP, EB_PTS, -20, 20, { front: endBeamOuter('rs-hz-ebp'), back: endBeamInner(), edge: ebEdge, name: 'rs-ebP' });
  extrude(endN, EB_PTS, -20, 20, { front: endBeamOuter('rs-hz-ebn'), back: endBeamInner(), edge: ebEdge, name: 'rs-ebN' });
  // Twistlock indicator lamps on the outer caps: green = locked, red = unlocked (opacity driven by twist).
  const lockLamps: { on: Node3[]; off: Node3[] } = { on: [], off: [] };
  for (const eb of [endP, endN]) {
    for (const [kind, x, col] of [['on', -30, '#2BD46A'], ['off', 12, '#FF3B30']] as const) {
      const n = eb.node(`lock-${kind}-${eb.name}`, [x, 0, 0]);
      n.face({ o: [0, -89, 20.6], a: [1, 0, 0], b: [0, -1, 0], w: 18, h: 9, bias: 45, shade: 0, art: rr(0, 0, 18, 9, 2, '#0E0F12') + rr(2, 1.5, 14, 6, 2, col) + rr(3, 2, 6, 2, 1, 'rgba(255,255,255,.6)'), name: `rs-lamp-${kind}` });
      lockLamps[kind].push(n);
    }
  }

  const locks: Node3[] = [];
  const coneW = 'M1 0H13L11 6L8.5 11H5.5L3 6Z';
  const coneN = 'M0.5 0H7.5L6.5 6L5 11H3L1.5 6Z';
  for (let i = 0; i < 4; i++) {
    const tl = sprB.node(`twistlock-${i + 1}`, [0, -HANG, 0]);
    tl.face({ o: [-7, 0, 0], a: [1, 0, 0], b: [0, -1, 0], w: 14, h: 11, art: path(coneW, C.steel300) + rect(1, 0, 12, 2, C.steel100), outline: coneW, double: true, shade: 0.6, name: `tl${i}.w` });
    tl.face({ o: [0, 0, 4], a: [0, 0, -1], b: [0, -1, 0], w: 8, h: 11, art: path(coneN, C.steel400), outline: coneN, double: true, shade: 0.6, name: `tl${i}.n` });
    tl.face({
      o: [-14, 90, 0], a: [1, 0, 0], b: [0, -1, 0], w: 28, h: 28, double: true, shade: 0,
      art: rect(12.5, 12, 3, 16, C.steel700) + rr(0, 0, 28, 13, 3, C.hazard) + rect(0, 4.5, 28, 4, C.ink) + rr(0.5, 0.5, 27, 12, 2.5, 'none', { stroke: '#8A6A00', 'stroke-width': 1 }),
      name: `tl${i}.flag`,
    });
    locks.push(tl);
  }

  /* ---- pose ------------------------------------------------------------ */
  const pose: ReachPose = { x: 0, z: 0, heading: 0, boom: 12, ext: 0, spread: 1, spreaderYaw: 0, twist: 0, dip: 0, swayX: 0, swayZ: 0, load: 0, side: 0, tilt: 0 };

  function apply() {
    const h = pose.heading;
    root.p = [pose.x, 0, pose.z];
    root.r.y = h;
    const travel = pose.x * Math.cos(h * DEG);
    for (const w of front) w.spin = travel / RF / DEG;
    for (const w of rear) w.spin = travel / RR / DEG;

    // Suspension: nose-down body pitch about the front axle, squashed front tyres, relaxed rear tyres.
    const load = clamp(pose.load ?? 0, 0, 1);
    const { pb, sq } = suspension(load);
    susp.p = [0, RF * (1 - sq), 0];
    susp.r.z = pb;
    for (const w of front) {
      w.p = [0, RF * (1 - sq), w.p[2]];
      w.k = [1, 1 - sq, 1];
    }
    for (const w of rear) {
      w.p = [RS.rearAxleX, RR + 1.5 * load, w.p[2]];
      w.k = [1, 1 + (1.5 * load) / RR, 1];
    }

    const th = pose.boom - pose.dip;
    const ext = clamp(pose.ext, 0, EXT_MAX);
    const e2 = ext / 2;
    boom.r.z = th;
    s2.p = [e2, 0, 0];
    s3.p = [ext - e2, 0, 0];
    tube2.set(664, 6 + e2);
    tube3.set(694, 28 + (ext - e2));
    for (const f of hoseFaces) {
      f.o[0] = 664;
      f.a[0] = (58 + ext) / 100;
    }
    rot.r.z = -th - pb;
    pend.r.z = (pose.swayX ?? 0) + (pose.sway ?? 0);
    pend.r.x = -(pose.swayZ ?? 0);

    spr.r.y = pose.spreaderYaw - 90;
    sprF.p = [pose.side ?? 0, -HANG, 0];
    sprF.r.z = pose.tilt ?? 0;
    const Xt = lerp(RS.tl20, RS.tl40, clamp(pose.spread, 0, 1));
    endP.p = [Xt, 0, 0];
    endN.p = [-Xt, 0, 0];
    const armLen = Xt - 20 - 265;
    armP.set(265, armLen);
    armN.set(-265 - armLen, armLen);
    const tw = clamp(pose.twist, 0, 1) * 90;
    const corners: P2[] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
    locks.forEach((tl, i) => {
      tl.p = [corners[i][0] * Xt, -HANG, corners[i][1] * RS.tlZ];
      tl.r.y = tw;
    });
    const lk = clamp(pose.twist, 0, 1);
    for (const n of lockLamps.on) n.opacity = 0.18 + 0.82 * lk;
    for (const n of lockLamps.off) n.opacity = 0.18 + 0.82 * (1 - lk);

    const [bx, by] = trunnionAt(th);
    for (const c of cyls) {
      const dx = bx - RS.anchor[0], dy = by - RS.anchor[1];
      const D = Math.hypot(dx, dy);
      c.fr.r.z = Math.atan2(dy, dx) / DEG;
      const rl = Math.max(D - LBAR, 0.5);
      c.rod.p = [LBAR + rl / 2, 0, 0];
      c.rodDef.w = rl;
      c.eye.p = [D, 0, 0];
      c.hl.set(LBAR, rl);
    }
  }

  function seat() {
    const load = pose.load ?? 0;
    const th = (pose.boom - pose.dip) * DEG;
    const R = R0 + clamp(pose.ext, 0, EXT_MAX);
    const pin = bodyToMachine([PX + R * Math.cos(th), PY + R * Math.sin(th), 0], load);
    // Hanging chain in the (level) heading frame: pendulum → slew → side-shift → tilt.
    const Mh = mul(mul(rotZ((pose.swayX ?? 0) + (pose.sway ?? 0)), rotX(-(pose.swayZ ?? 0))), rotY(pose.spreaderYaw - 90));
    const planeM = add(pin, mapply(Mh, [pose.side ?? 0, -HANG, 0]));
    const Mc = mul(Mh, rotZ(pose.tilt ?? 0));
    const floorM = add(planeM, mapply(Mc, [0, -BOX.H, 0]));
    const Rh = rotY(pose.heading);
    const org: V3 = [pose.x, 0, pose.z];
    const e = eulerOf(mul(Rh, Mc));
    const yaw = near(e.y, pose.heading + pose.spreaderYaw - 90);
    return { p: add(org, mapply(Rh, floorM)), yaw, plane: add(org, mapply(Rh, planeM)), r: { x: e.x, y: yaw, z: e.z } };
  }

  const solve = (dx: number, y: number, load = pose.load ?? 0) => solveAt(dx, y, load);
  const planFn = (dx: number, y: number, opts: PlanOpts = {}) => plan(dx, y, { load: pose.load ?? 0, ...opts });

  apply();
  return { root, pose, apply, seat, solve, plan: planFn, EXT_MAX };
}

/* ------------------------------------------------------------------------ */
/* Lab                                                                       */
/* ------------------------------------------------------------------------ */

export const labEntries: Record<string, LabEntry> = {
  reachstacker: {
    title: 'Reach stacker — NAVAIR RS-45',
    build: () => {
      const rs = createReachStacker();
      const root = new Node3('lab-reach');
      root.add(rs.root);
      const load = container('rs-load', LIVERY.hero);
      load.visible = false;
      root.add(load);
      const beacon = rs.root.get('beacon');
      let vals: Record<string, number> = {};
      const place = () => {
        rs.apply();
        if (vals.withBox) {
          const s = rs.seat();
          load.p = s.p;
          Object.assign(load.r, s.r);
          load.visible = true;
        } else load.visible = false;
      };
      return {
        root,
        pose: (v) => {
          vals = v;
          const keys = ['boom', 'ext', 'spread', 'spreaderYaw', 'twist', 'x', 'dip', 'swayX', 'swayZ', 'load', 'side', 'tilt'] as const;
          for (const k of keys) if (v[k] !== undefined) (rs.pose as unknown as Record<string, number>)[k] = v[k];
          place();
        },
        frame: { tx: -120, ty: 420, tz: 0, zoom: 0.5 },
        tick: (t) => {
          const ph = (t * 1.6) % 1;
          beacon.opacity = ph < 0.12 || (ph > 0.22 && ph < 0.34) ? 1 : 0.3;
          // swing=1: replay a damped fore/aft + lateral pendulum after a braking kick every 6 s.
          if (vals.swing) {
            const tt = t % 6;
            rs.pose.swayX = (vals.swayX ?? 0) + swayCurve(tt, 5);
            rs.pose.swayZ = (vals.swayZ ?? 0) + swayCurve(tt - 0.4, 1.6, 2.7);
            place();
          }
        },
      };
    },
    controls: [
      { key: 'boom', min: -5, max: 65, value: 20 },
      { key: 'ext', min: 0, max: EXT_MAX, value: 120 },
      { key: 'spread', min: 0, max: 1, step: 0.01, value: 1 },
      { key: 'spreaderYaw', min: -90, max: 90, value: 0 },
      { key: 'twist', min: 0, max: 1, step: 0.01, value: 1 },
      { key: 'x', min: -500, max: 500, value: 0 },
      { key: 'dip', min: 0, max: 4, step: 0.1, value: 0 },
      { key: 'swayX', min: -8, max: 8, step: 0.1, value: 0 },
      { key: 'swayZ', min: -8, max: 8, step: 0.1, value: 0 },
      { key: 'load', min: 0, max: 1, step: 0.01, value: 0 },
      { key: 'side', min: -80, max: 80, value: 0 },
      { key: 'tilt', min: -6, max: 6, step: 0.1, value: 0 },
      { key: 'swing', min: 0, max: 1, value: 0 },
      { key: 'withBox', min: 0, max: 1, value: 0 },
    ],
  },
};
