/**
 * Articulated rig: modern European cab-over 4x2 tractor (MAN TGX / Scania S
 * class, high-roof sleeper) + 3-axle skeletal 40' container trailer
 * (gooseneck), drawn as planar illustrated faces.
 *
 * TRACTOR space: origin = rear-axle centre on the ground, +X forward, +Z = the
 * truck's right-hand side (near side at camera yaw 0).
 * TRAILER space: origin = kingpin projected to the ground, body runs −X.
 * All dimensions honour `RIG` in world.ts.
 *
 * The cab front is a swept profile (bumper → grille → windscreen → roof
 * crown). Every profile segment is a full-width strip plus two 45° corner
 * chamfers, so the cab reads rounded in plan and in 3/4 views instead of as
 * a box, while every face stays planar.
 *
 * Node tree:
 *   rig.root (identity)
 *     tractor            ← pose x/z/heading
 *       body             ← −bounce (sprung mass)
 *         cabPivot       ← −nod (cab pitch) + roll (cab lean in turns)
 *           cab
 *         coils          ← aimed at the trailer's glad-hands every apply()
 *       wheels + axles   (unsprung)
 *     trailer            ← kingpin in world, yaw = trailerHeading
 *       trBody           ← −bounce
 *       wheels + axles   (unsprung)
 */

import { Node3 } from '../engine/engine';
import { DEG, clamp, type V3 } from '../engine/math';
import { circle, path, polyD, rect, rr, rrD, stroke, text } from '../engine/art';
import { C, RIG } from '../world';
import { LIVERY, container } from './container';
import type { LabEntry } from './registry';

/* ------------------------------------------------------------------------ */
/* Palette                                                                   */
/* ------------------------------------------------------------------------ */

const K = {
  /** Gloss graphite-black cab paint (flat fallback; faces use BODY_Y ramps). */
  body: '#1B1F25',
  bodyDk: '#111318',
  /** Roof / up-facing paint reflects sky. */
  roof: '#2A3039',
  /** Matte black plastics (bumper, steps, fenders). */
  trim: '#0E0F12',
  trim2: '#17191D',
  void: '#060709',
  frame: C.steel800,
  frameHi: C.steel700,
  frameLo: '#181A1F',
  red: '#C8201A',
  tapeRed: '#D3261D',
  tapeWhite: '#EEF0F2',
  amber: '#F29A1F',
  amberHi: '#FFD27A',
  lamp: '#E9EEF3',
  led: '#F4F8FF',
  adblue: '#D6DAE0',
  alu: '#B7BEC7',
  chrome: '#D9DEE4',
  glass: '#18202B',
  dust: 'rgba(128,116,98,',
} as const;

const WR = RIG.wheelR;

/**
 * Sort bias for everything that sits *under* the container (trailer frame,
 * running gear, tractor chassis behind the cab). The 40' box is six huge
 * faces whose centre depth misleads the painter near its ends in 3/4 views;
 * pushing the under-structure back keeps it beneath the box while staying
 * small enough not to fight neighbouring machines. Exact at yaw 0/180 and
 * in plan, where no bias is needed.
 */
const UNDER = -70;

/* ------------------------------------------------------------------------ */
/* Colour helpers                                                            */
/* ------------------------------------------------------------------------ */

function rgb(c: string): [number, number, number] {
  const h = c.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function mix(a: string, b: string, t: number) {
  const A = rgb(a), B = rgb(b);
  const h = (i: number) => Math.round(A[i] + (B[i] - A[i]) * t).toString(16).padStart(2, '0');
  return `#${h(0)}${h(1)}${h(2)}`;
}

/**
 * Gloss paint tone as a function of world height: sky reflection above the
 * belt-line "horizon", a sharp dark band under it, ground bounce near the sill.
 * Shared by the cab sides, corner chamfers and front so the reflection line
 * runs continuously around the cab.
 */
const BODY_Y: [number, string][] = [
  [400, '#3C444F'],
  [372, '#2A3038'],
  [300, '#20252C'],
  [241, '#353D48'],
  [236, '#13161B'],
  [150, '#16191E'],
  [60, '#20242B'],
  [30, '#1A1D22'],
];

function toneAt(y: number) {
  if (y >= BODY_Y[0][0]) return BODY_Y[0][1];
  for (let i = 1; i < BODY_Y.length; i++) {
    const [y1, c1] = BODY_Y[i];
    if (y >= y1) {
      const [y0, c0] = BODY_Y[i - 1];
      return mix(c1, c0, (y - y1) / (y0 - y1));
    }
  }
  return BODY_Y[BODY_Y.length - 1][1];
}

/** Gradient stops covering world heights yTop → yBot (offset 0 at yTop). */
function yStops(yTop: number, yBot: number): Stop[] {
  const out: Stop[] = [[0, toneAt(yTop)]];
  for (const [y, c] of BODY_Y) if (y < yTop && y > yBot) out.push([(yTop - y) / (yTop - yBot), c]);
  out.push([1, toneAt(yBot)]);
  return out;
}

let GID = 0;
const gid = () => `rg${(GID++).toString(36)}`;

type Stop = [number, string] | [number, string, number];

function stopsXml(stops: Stop[]) {
  return stops.map(([o, c, a]) => `<stop offset="${Math.round(o * 1000) / 1000}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('');
}

/* ------------------------------------------------------------------------ */
/* Pen: draw face art in world-ish coordinates                               */
/* ------------------------------------------------------------------------ */

type P2 = [number, number];
type Attrs = Record<string, string | number | undefined>;

/**
 * Maps a 2D world coordinate pair (p, q) to face art (u, v):
 * u = (p − p0)·su, v = (q − q0)·sv. Lets one drawing routine serve both
 * mirrored sides of the machine and keeps text un-mirrored.
 */
class Pen {
  private out: string[] = [];
  private ol: string[] = [];
  constructor(
    private su: number,
    private p0: number,
    private sv: number,
    private q0: number,
  ) {}
  u(p: number) {
    return (p - this.p0) * this.su;
  }
  v(q: number) {
    return (q - this.q0) * this.sv;
  }
  pt(p: number, q: number): P2 {
    return [this.u(p), this.v(q)];
  }
  d(pts: P2[], close = true) {
    return polyD(
      pts.map(([p, q]) => this.pt(p, q)),
      close,
    );
  }
  private bx(pa: number, pb: number, qa: number, qb: number) {
    const u1 = this.u(pa), u2 = this.u(pb), v1 = this.v(qa), v2 = this.v(qb);
    return { x: Math.min(u1, u2), y: Math.min(v1, v2), w: Math.abs(u2 - u1), h: Math.abs(v2 - v1) };
  }
  rect(pa: number, pb: number, qa: number, qb: number, fill: string, a?: Attrs) {
    const b = this.bx(pa, pb, qa, qb);
    this.out.push(rect(b.x, b.y, b.w, b.h, fill, a));
    return this;
  }
  rr(pa: number, pb: number, qa: number, qb: number, r: number, fill: string, a?: Attrs) {
    const b = this.bx(pa, pb, qa, qb);
    this.out.push(rr(b.x, b.y, b.w, b.h, r, fill, a));
    return this;
  }
  poly(pts: P2[], fill: string, a?: Attrs) {
    this.out.push(path(this.d(pts), fill, a));
    return this;
  }
  circ(p: number, q: number, r: number, fill: string, a?: Attrs) {
    const [u, v] = this.pt(p, q);
    this.out.push(circle(u, v, r, fill, a));
    return this;
  }
  ell(p: number, q: number, rx: number, ry: number, fill: string) {
    const [u, v] = this.pt(p, q);
    this.out.push(`<ellipse cx="${u}" cy="${v}" rx="${rx}" ry="${ry}" fill="${fill}"/>`);
    return this;
  }
  ring(p: number, q: number, r: number, color: string, w: number) {
    const [u, v] = this.pt(p, q);
    this.out.push(circle(u, v, r, 'none', { stroke: color, 'stroke-width': w }));
    return this;
  }
  line(pts: P2[], color: string, w: number, a?: Attrs) {
    this.out.push(stroke(this.d(pts, false), color, w, { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...a }));
    return this;
  }
  text(p: number, q: number, s: string, size: number, fill: string, a: Attrs & { family?: 'mono' | 'display' } = {}) {
    const [u, v] = this.pt(p, q);
    let anchor = (a['text-anchor'] as string | undefined) ?? 'middle';
    if (this.su < 0 && anchor === 'start') anchor = 'end';
    else if (this.su < 0 && anchor === 'end') anchor = 'start';
    this.out.push(text(u, v, s, size, fill, { ...a, 'text-anchor': anchor }));
    return this;
  }
  /** Linear gradient between two pen points; returns the fill reference. */
  lin(p1: number, q1: number, p2: number, q2: number, stops: Stop[]) {
    const id = gid();
    const [x1, y1] = this.pt(p1, q1), [x2, y2] = this.pt(p2, q2);
    this.out.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stopsXml(stops)}</linearGradient>`);
    return `url(#${id})`;
  }
  /** Radial gradient centred on a pen point (radius in art units). */
  rad(p: number, q: number, r: number, stops: Stop[]) {
    const id = gid();
    const [x, y] = this.pt(p, q);
    this.out.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${x}" cy="${y}" r="${r}">${stopsXml(stops)}</radialGradient>`);
    return `url(#${id})`;
  }
  /** Add a polygon to the shading outline (winding normalised so unions never punch holes). */
  solid(pts: P2[]) {
    let m = pts.map(([p, q]) => this.pt(p, q));
    let area = 0;
    for (let i = 0; i < m.length; i++) {
      const a = m[i], b = m[(i + 1) % m.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (area < 0) m = m.slice().reverse();
    this.ol.push(polyD(m));
    return this;
  }
  solidRect(pa: number, pb: number, qa: number, qb: number, r = 0) {
    const b = this.bx(pa, pb, qa, qb);
    this.ol.push(rrD(b.x, b.y, b.w, b.h, r));
    return this;
  }
  /** Raw markup already in art coordinates (use with pt()). */
  raw(markup: string) {
    this.out.push(markup);
    return this;
  }
  art() {
    return this.out.join('');
  }
  outline() {
    return this.ol.length ? this.ol.join('') : undefined;
  }
}

function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n: number): P2[] {
  const o: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (a0 + ((a1 - a0) * i) / n) * DEG;
    o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return o;
}

/* ------------------------------------------------------------------------ */
/* Face constructors                                                         */
/* ------------------------------------------------------------------------ */

interface FOpts {
  double?: boolean;
  bias?: number;
  layer?: number;
  shade?: number;
  name?: string;
}

function put(n: Node3, o: V3, a: V3, b: V3, w: number, h: number, pen: Pen, opts: FOpts = {}) {
  n.face({ o, a, b, w, h, art: pen.art(), outline: pen.outline(), ...opts });
}

/** Vertical XY-plane face at z facing ±Z. Pen: p = x, q = y (up). */
function sideFace(n: Node3, x0: number, x1: number, y0: number, y1: number, z: number, dir: 1 | -1, draw: (p: Pen) => void, opts: FOpts = {}) {
  if (dir === 1) {
    const pen = new Pen(1, x0, -1, y1);
    draw(pen);
    put(n, [x0, y1, z], [1, 0, 0], [0, -1, 0], x1 - x0, y1 - y0, pen, opts);
  } else {
    const pen = new Pen(-1, x1, -1, y1);
    draw(pen);
    put(n, [x1, y1, z], [-1, 0, 0], [0, -1, 0], x1 - x0, y1 - y0, pen, opts);
  }
}

/** Mirrored pair at +z (facing +Z) and −z (facing −Z). */
function sidePair(n: Node3, x0: number, x1: number, y0: number, y1: number, z: number, draw: (p: Pen, s: 1 | -1) => void, opts: FOpts = {}) {
  sideFace(n, x0, x1, y0, y1, z, 1, (p) => draw(p, 1), opts);
  sideFace(n, x0, x1, y0, y1, -z, -1, (p) => draw(p, -1), opts);
}

/** Horizontal face at height y facing up. Pen: p = x, q = z. */
function planFace(n: Node3, x0: number, x1: number, z0: number, z1: number, y: number, draw: (p: Pen) => void, opts: FOpts = {}) {
  const pen = new Pen(1, x0, 1, z0);
  draw(pen);
  put(n, [x0, y, z0], [1, 0, 0], [0, 0, 1], x1 - x0, z1 - z0, pen, opts);
}

/** Vertical face at x facing +X. Pen: p = z, q = y. */
function frontFace(n: Node3, x: number, z0: number, z1: number, y0: number, y1: number, draw: (p: Pen) => void, opts: FOpts = {}) {
  const pen = new Pen(-1, z1, -1, y1);
  draw(pen);
  put(n, [x, y1, z1], [0, 0, -1], [0, -1, 0], z1 - z0, y1 - y0, pen, opts);
}

/** Vertical face at x facing −X. Pen: p = z, q = y. */
function rearFace(n: Node3, x: number, z0: number, z1: number, y0: number, y1: number, draw: (p: Pen) => void, opts: FOpts = {}) {
  const pen = new Pen(1, z0, -1, y1);
  draw(pen);
  put(n, [x, y1, z0], [0, 0, 1], [0, -1, 0], z1 - z0, y1 - y0, pen, opts);
}

/** Upward-facing strip from P (rear) to Q (front) in the XY profile. Pen: p = distance from P, q = z. */
function slopeTop(n: Node3, P: P2, Q: P2, z0: number, z1: number, draw: (p: Pen, L: number) => void, opts: FOpts = {}) {
  const L = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
  const pen = new Pen(1, 0, 1, z0);
  draw(pen, L);
  put(n, [P[0], P[1], z0], [(Q[0] - P[0]) / L, (Q[1] - P[1]) / L, 0], [0, 0, 1], L, z1 - z0, pen, opts);
}

/** Forward-facing strip from P (top) down to Q in the XY profile. Pen: p = z, q = distance from P. */
function slopeFront(n: Node3, P: P2, Q: P2, z0: number, z1: number, draw: (p: Pen, L: number) => void, opts: FOpts = {}) {
  const L = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
  const pen = new Pen(-1, z1, 1, 0);
  draw(pen, L);
  put(n, [P[0], P[1], z1], [0, 0, -1], [(Q[0] - P[0]) / L, (Q[1] - P[1]) / L, 0], z1 - z0, L, pen, opts);
}

/** z-range of a part on side s given its |z| extent. */
const zr = (s: number, a: number, b: number): [number, number] => (s > 0 ? [a, b] : [-b, -a]);

/* ------------------------------------------------------------------------ */
/* Wheels                                                                    */
/* ------------------------------------------------------------------------ */

type WheelKind = 'steer' | 'drive' | 'trailer';

function discArt(kind: WheelKind) {
  const R = WR;
  const o: string[] = [];
  const ring = (r: number, c: string, w: number) => `<circle r="${r}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
  const around = (n: number, r: number, f: (x: number, y: number, a: number) => string, a0 = 0) => {
    let s = '';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + a0 * DEG;
      s += f(Math.cos(a) * r, Math.sin(a) * r, (a * 180) / Math.PI);
    }
    return s;
  };
  const rg = (id: string, r: number, stops: Stop[], fx = 0, fy = 0) =>
    `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fx}" cy="${fy}" r="${r}">${stopsXml(stops)}</radialGradient>`;
  const id = `wd_${kind}`;
  // Tyre sidewall: moulded shoulder rings, lettering blocks (rotate with the wheel).
  o.push(circle(0, 0, R, '#1D1F23'));
  o.push(ring(R - 1.6, 'rgba(255,255,255,.05)', 1.6));
  o.push(ring(R - 5.5, 'rgba(0,0,0,.35)', 0.8));
  o.push(ring(35.6, 'rgba(255,255,255,.05)', 1));
  // "Lettering": two arcs of small raised glyph blocks + a size code block.
  const glyphs = (a0: number, a1: number, r: number) => {
    let s = '';
    for (let a = a0, i = 0; a < a1; a += 4.2, i++) {
      if (i % 7 === 6) continue;
      const h = i % 3 === 1 ? 2.2 : 3.2;
      s += `<rect x="-0.9" y="${-r - h / 2}" width="${i % 4 === 2 ? 1.2 : 1.9}" height="${h}" fill="rgba(255,255,255,.13)" transform="rotate(${a})"/>`;
    }
    return s;
  };
  o.push(glyphs(-62, 8, 43.5), glyphs(118, 188, 43.5));
  o.push(glyphs(28, 52, 40.6), glyphs(208, 232, 40.6));
  // Bead seat + rim flange
  o.push(circle(0, 0, 34.5, K.void));
  if (kind === 'drive') {
    o.push(`<defs>${rg(id, 32, [[0, '#5B626C'], [0.55, '#8E96A1'], [0.8, '#C3C9D0'], [1, '#E3E6EA']])}${rg(id + 'h', 11, [[0, '#E9ECEF'], [0.6, '#9AA1AB'], [1, '#4B515A']], -2.5, -2.5)}</defs>`);
    o.push(circle(0, 0, 32.4, C.steel300));
    o.push(circle(0, 0, 31.2, `url(#${id})`));
    o.push(ring(27.8, 'rgba(0,0,0,.28)', 1));
    o.push(around(10, 23.6, (x, y, a) => `<rect x="-3.6" y="-2" width="7.2" height="4" rx="2" fill="#23262B" transform="translate(${x} ${y}) rotate(${a + 90})"/>`, 18));
    o.push(circle(0, 0, 18.5, '#6A717C'));
    o.push(ring(18.5, 'rgba(0,0,0,.4)', 1));
    o.push(around(10, 15.4, (x, y) => circle(x, y, 2.1, '#2B2F36') + circle(x - 0.4, y - 0.4, 1.35, C.steel100)));
    o.push(circle(0, 0, 11, `url(#${id}h)`));
    o.push(circle(0, 0, 6.2, '#3B4049'));
    o.push(circle(0, 0, 3.6, '#23262B'));
    o.push(around(6, 8.6, (x, y) => circle(x, y, 0.9, '#3B4049')));
  } else if (kind === 'trailer') {
    o.push(`<defs>${rg(id, 32, [[0, '#6A717C'], [0.6, '#A2A9B3'], [1, '#D2D7DD']])}${rg(id + 'h', 9, [[0, '#DADEE3'], [1, '#6E7580']], -2, -2)}</defs>`);
    o.push(circle(0, 0, 32.4, C.steel400));
    o.push(circle(0, 0, 31.2, `url(#${id})`));
    o.push(ring(25, 'rgba(0,0,0,.25)', 1.1));
    o.push(around(10, 21.8, (x, y, a) => `<rect x="-3.4" y="-2.3" width="6.8" height="4.6" rx="2.3" fill="#2B2F36" transform="translate(${x} ${y}) rotate(${a + 90})"/>`, 18));
    o.push(circle(0, 0, 15, '#7E858F'));
    o.push(around(10, 12.4, (x, y) => circle(x, y, 1.8, '#2B2F36') + circle(x - 0.3, y - 0.3, 1.15, C.steel100)));
    o.push(circle(0, 0, 8.4, `url(#${id}h)`));
    o.push(circle(0, 0, 3.2, '#3B4049'));
  } else {
    o.push(`<defs>${rg(id, 32, [[0, '#B8BEC6'], [0.55, '#D9DDE2'], [0.85, '#F1F3F5'], [1, '#C4C9D0']])}${rg(id + 'h', 16, [[0, '#FFFFFF'], [0.45, '#DDE1E6'], [0.85, '#8E96A1'], [1, '#5B626C']], -4, -4)}</defs>`);
    o.push(circle(0, 0, 32.4, C.steel400));
    o.push(circle(0, 0, 31.2, `url(#${id})`));
    o.push(ring(28.4, 'rgba(0,0,0,.18)', 0.8));
    o.push(around(10, 23.2, (x, y) => circle(x, y, 3.2, '#2B2F36') + circle(x, y, 3.2, 'none', { stroke: 'rgba(255,255,255,.35)', 'stroke-width': 0.6 })));
    o.push(circle(0, 0, 16.4, '#7A818D'));
    o.push(circle(0, 0, 15.6, `url(#${id}h)`));
    o.push(around(10, 12.6, (x, y) => circle(x, y, 1.5, 'rgba(0,0,0,.22)') + circle(x - 0.3, y - 0.3, 1.1, 'rgba(255,255,255,.7)')));
    o.push(circle(0, 0, 4.4, '#23262B'));
    o.push(circle(0, 0, 2.6, C.blue));
  }
  // Valve stem
  o.push(`<rect x="-1" y="-30.5" width="2" height="4.4" rx=".6" fill="${C.steel500}"/>`);
  return o.join('');
}

/** Static sheen over the rolling disc: light from the upper left. */
const SHEEN =
  `<path d="M-28.5 -11A30.5 30.5 0 0 1 -9 -29.2" stroke="rgba(255,255,255,.55)" stroke-width="1.6" fill="none" stroke-linecap="round"/>` +
  `<path d="M-20 -8A21 21 0 0 1 -6 -20" stroke="rgba(255,255,255,.22)" stroke-width="2.4" fill="none" stroke-linecap="round"/>` +
  `<path d="M27 14A30.5 30.5 0 0 1 9 29.2" stroke="rgba(0,0,0,.3)" stroke-width="3" fill="none" stroke-linecap="round"/>` +
  `<path d="M-45 -22A50 50 0 0 1 -18 -47" stroke="rgba(255,255,255,.08)" stroke-width="3.4" fill="none" stroke-linecap="round"/>` +
  `<path d="M44 24A50 50 0 0 1 20 46" stroke="rgba(0,0,0,.22)" stroke-width="4" fill="none" stroke-linecap="round"/>`;

const DISC: Record<WheelKind, string> = {
  steer: discArt('steer'),
  drive: discArt('drive'),
  trailer: discArt('trailer'),
};

function wheel(parent: Node3, name: string, p: V3, kind: WheelKind, w: number) {
  const n = parent.node(name, p);
  n.wheel({ r: WR, w, disc: DISC[kind], inner: SHEEN, tread: '#131417', name });
  return n;
}

/* ------------------------------------------------------------------------ */
/* Cab geometry                                                              */
/* ------------------------------------------------------------------------ */

const CAB_W = 124;
/** Corner chamfer: x setback and z inset of the rounded front corners. */
const CHX = 16, CHZ = 16;
const WF = CAB_W - CHZ;
const CH_C = Math.hypot(CHX, CHZ);
const ARCH: P2 = [RIG.wheelbase, WR];
const ARCH_R = 64;

/**
 * Front profile at the centreline, bottom → top: bumper lip, bumper face,
 * bumper top, grille panel, wiper cowl, windscreen, three crown facets.
 */
const FP: P2[] = [
  [519, 34],
  [528, 46],
  [528, 96],
  [523, 102],
  [520, 236],
  [516, 244],
  [506, 350],
  [497, 366],
  [482, 378],
  [461, 385],
];
const ROOF0: P2 = [306, 396];
const ROOF_R: P2[] = [[292, 384], [297, 392.5], ROOF0];

/** Cab side silhouette (tractor x, y) at z = ±CAB_W. */
const CAB_SIL: P2[] = [
  [292, 42],
  ...ROOF_R,
  ...FP.slice().reverse().map(([x, y]) => [x - CHX, y] as P2),
  [448, 34],
  ...arcPts(ARCH[0], ARCH[1], ARCH_R, 0, 180, 18),
  [316, 42],
];

/** Door and window outlines (side view). */
const DOOR: P2[] = [[320, 124], [470, 124], [474, 238], [484, 342], [320, 344]];
const WIN: P2[] = [[336, 258], [336, 331], [479, 335], [471, 240], [452, 240], [433, 258]];

/**
 * One swept profile segment A (lower) → B (upper): the centre strip spans
 * z ∈ [−WF, WF], the two corner chamfers connect it to the cab sides.
 * Centre pen: p = z, q = distance from B. Chamfer pen: p = distance from the
 * front edge (0 … CH_C), q = distance from B.
 */
function frontStrip(
  n: Node3,
  A: P2,
  B: P2,
  drawF: (p: Pen, L: number) => void,
  drawC: (p: Pen, L: number, s: 1 | -1) => void,
  opts: FOpts = {},
) {
  const L = Math.hypot(A[0] - B[0], A[1] - B[1]);
  const b: V3 = [(A[0] - B[0]) / L, (A[1] - B[1]) / L, 0];
  const pen = new Pen(-1, WF, 1, 0);
  drawF(pen, L);
  put(n, [B[0], B[1], WF], [0, 0, -1], b, 2 * WF, L, pen, opts);
  for (const s of [1, -1] as const) {
    const cp = s > 0 ? new Pen(-1, CH_C, 1, 0) : new Pen(1, 0, 1, 0);
    drawC(cp, L, s);
    const o: V3 = s > 0 ? [B[0] - CHX, B[1], CAB_W] : [B[0], B[1], -WF];
    const a: V3 = s > 0 ? [CHX / CH_C, 0, -CHZ / CH_C] : [-CHX / CH_C, 0, -CHZ / CH_C];
    put(n, o, a, b, CH_C, L, cp, { ...opts, name: opts.name && `${opts.name}.${s > 0 ? 'r' : 'l'}` });
  }
}

/** Body-paint fill for a strip whose top/bottom sit at world heights yT/yB. */
function stripPaint(p: Pen, L: number, yT: number, yB: number) {
  return p.lin(0, 0, 0, L, yStops(yT, yB));
}

/* ------------------------------------------------------------------------ */
/* Cab                                                                       */
/* ------------------------------------------------------------------------ */

function cabSide(p: Pen, s: 1 | -1) {
  const [ax, ay] = ARCH;
  // Paint: gloss graphite with the sky/ground reflection ramp.
  p.poly(CAB_SIL, p.lin(0, 396, 0, 34, yStops(396, 34))).solid(CAB_SIL);
  // Sleeper roof edge catches the sky.
  p.line([[293.5, 384], [298, 391.5], [306, 394.6], [444, 384.2]], 'rgba(255,255,255,.22)', 1.3);
  p.line([[446, 383.6], [466, 376.6], [481, 364.6], [489.5, 349.5]], 'rgba(255,255,255,.12)', 1.1);
  // Soft vertical sheen bands (studio softboxes) over the upper panel.
  p.poly([[330, 390], [352, 388], [340, 228], [318, 228]], 'rgba(255,255,255,.035)');
  p.poly([[410, 386], [418, 385.4], [410, 228], [402, 228]], 'rgba(255,255,255,.03)');

  // Rear-quarter panel seam + side vents.
  p.line([[318, 124], [318, 386]], 'rgba(0,0,0,.45)', 1.1);
  p.line([[319.2, 128], [319.2, 384]], 'rgba(255,255,255,.05)', 0.8);
  for (let i = 0; i < 6; i++) {
    const y = 330 - i * 9;
    p.rr(297, 314, y - 3.6, y, 1.2, K.void);
    p.line([[297.6, y + 0.5], [313.4, y + 0.5]], 'rgba(255,255,255,.1)', 0.6);
  }

  // Door
  p.poly(DOOR, 'none', { stroke: 'rgba(0,0,0,.7)', 'stroke-width': 1.4, 'stroke-linejoin': 'round' });
  p.line([[321, 342.6], [483, 340.6]], 'rgba(255,255,255,.08)', 0.8);
  // Door character line (pressed crease) with highlight + shadow.
  p.line([[322, 196], [472, 198]], 'rgba(0,0,0,.35)', 1.2).line([[322, 197.4], [472, 199.4]], 'rgba(255,255,255,.07)', 0.9);

  // Window: tinted glass with a sky reflection and seat / headrest silhouettes.
  const wg = p.lin(0, 336, 0, 238, [[0, '#0E131A'], [0.12, '#3E4B5C'], [0.5, '#222C38'], [1, '#131920']]);
  p.poly(WIN, wg);
  const seatX = 388;
  p.rr(seatX, seatX + 30, 262, 312, 9, 'rgba(0,0,0,.42)').rr(seatX + 6, seatX + 26, 300, 322, 7, 'rgba(0,0,0,.4)');
  if (s === -1) p.line(arcPts(452, 252, 20, 30, 150, 10), 'rgba(0,0,0,.6)', 3.2);
  p.poly([[372, 331], [392, 331.8], [364, 258], [344, 258]], 'rgba(255,255,255,.09)');
  p.poly([[400, 332.4], [406, 332.6], [378, 258], [372, 258]], 'rgba(255,255,255,.06)');
  p.poly([[455, 334], [466, 334.5], [458, 250], [450, 250]], 'rgba(255,255,255,.07)');
  p.poly(WIN, 'none', { stroke: K.void, 'stroke-width': 2.6, 'stroke-linejoin': 'round' });
  // Mirror arm feet on the A-pillar.
  p.rr(474, 486, 324, 334, 2, K.trim).rr(467, 478, 244, 252, 2, K.trim);
  // Door handle (recessed) + lock + grab handle behind the door.
  p.rr(336, 362, 205, 213, 3, '#0A0B0E').rr(338, 360, 208.4, 211, 1.3, C.steel500).circ(368, 209, 1.8, C.steel500);
  p.rr(299, 304, 150, 296, 2.4, C.steel400).rect(299.4, 300.4, 152, 294, 'rgba(255,255,255,.5)').rect(302.6, 304, 152, 294, 'rgba(0,0,0,.35)');
  for (const y of [152, 294]) p.rr(298, 305, y - 3, y + 3, 1.5, K.trim);

  // Front corner panel: air-guide louvres.
  for (let i = 0; i < 6; i++) {
    const y = 226 - i * 10.5;
    p.poly([[477.5, y], [504 - (i < 1 ? 0.5 : 0), y], [504, y - 5], [478.5, y - 5]], K.void);
    p.line([[478.5, y + 0.6], [503.6, y + 0.6]], 'rgba(255,255,255,.1)', 0.7);
  }

  // Wordmark + NAVAIR blue accent (wraps onto the corner chamfer and front).
  p.rect(292, 507, 145, 147.6, C.blue);
  p.rect(292, 507, 147.6, 148.4, 'rgba(0,0,0,.4)');
  p.text(398, 168, 'NAVAIR', 17, '#E6E9ED', { 'font-weight': 800, 'letter-spacing': 3.4, style: 'font-stretch:125%' });
  p.text(398, 134, 'NVR-07 · 4×2 · 44 T', 5, C.steel400, { family: 'mono', 'letter-spacing': 0.8 });

  // Lower front corner: bumper wrap (painted top, black lower) + side marker.
  const bump: P2[] = [[448, 34], [504, 34], [512, 46], [512, 96], [507, 102], [438, 102], ...arcPts(ax, ay, ARCH_R, 45.6, 0, 6)];
  p.poly(bump, K.trim);
  p.poly([[438, 102], [507, 102], [512, 96], [512, 84], [441.5, 84]], p.lin(0, 102, 0, 84, [[0, '#2A3038'], [1, '#15181D']]));
  p.line([[442, 83.6], [511.6, 83.6]], 'rgba(0,0,0,.6)', 1.1);
  p.line([[440, 101.6], [506.6, 101.6]], 'rgba(255,255,255,.14)', 0.9);
  p.rr(488, 504, 60, 66, 1.6, K.amber).rect(489, 503, 60.4, 61.6, 'rgba(255,255,255,.4)');
  for (let x = 452; x < 500; x += 6) p.rect(x, x + 3, 40, 48, 'rgba(255,255,255,.035)');

  // Step well behind the front wheel: two aluminium treads + light.
  const well: P2[] = [[292, 42], [316, 42], ...arcPts(ax, ay, ARCH_R, 180, 146, 4), [320, 124], [292, 124]];
  p.poly(well, '#0B0C0F');
  for (const [y0, y1] of [[48, 58], [88, 98]] as const) {
    p.rr(294, 318, y0, y1, 1.5, K.void);
    p.rect(294.5, 317.5, y1 - 3, y1, K.alu).rect(294.5, 317.5, y1 - 0.8, y1, 'rgba(255,255,255,.6)');
    for (let x = 297; x < 316; x += 3.4) p.rect(x, x + 1.4, y1 - 2.6, y1 - 0.6, 'rgba(0,0,0,.25)');
  }
  p.rr(296, 312, 112, 116, 1, K.amber);

  // Wheel arch: black liner lip + flare, rubber flap behind the wheel.
  p.line(arcPts(ax, ay, ARCH_R + 2.4, 2, 178, 22), K.void, 5.4);
  p.line(arcPts(ax, ay, ARCH_R + 5.4, 8, 172, 20), 'rgba(255,255,255,.1)', 1.1);
  p.rr(318, 330, 36, 64, 2, '#1A1C20').rect(318, 330, 60, 64, '#26292E');

  // Grime near the sill and behind the arch.
  const dust = p.lin(0, 70, 0, 34, [[0, K.dust + '0)'], [1, K.dust + '0.16)']]);
  p.poly([[292, 70], [316, 70], [316, 42], [292, 42]], dust);
  p.poly([[446, 70], [512, 70], [512, 46], [504, 34], [448, 34]], dust);
}

function buildCab(cab: Node3) {
  const W = CAB_W;
  sidePair(cab, 292, 512, 34, 396, W, cabSide, { name: 'cab.side' });

  /* --- swept front: bumper → grille → windscreen → crown ---------------- */
  const seg = (i: number) => [FP[i], FP[i + 1]] as const;
  const trimC = (p: Pen, L: number) => {
    p.rect(0, CH_C, 0, L, K.trim).solidRect(0, CH_C, 0, L);
    p.rect(0, CH_C, 0, Math.min(1, L), 'rgba(255,255,255,.1)');
  };

  // 0: bumper under-lip
  frontStrip(cab, ...seg(0), (p, L) => {
    p.rect(-WF, WF, 0, L, K.trim).solidRect(-WF, WF, 0, L);
    for (const s of [1, -1]) p.rr(s * 30, s * 90, 3, L - 3, 1.5, K.void);
    p.rect(-WF, WF, 0, 1, 'rgba(255,255,255,.08)');
  }, trimC, { name: 'cab.lip' });

  // 1: bumper face — painted cap, fogs, plate, lower intake
  frontStrip(cab, ...seg(1), (p, L) => {
    p.rect(-WF, WF, 0, L, K.trim2).solidRect(-WF, WF, 0, L);
    p.rect(-WF, WF, 0, 14, stripPaint(p, 14, 96, 82));
    p.rect(-WF, WF, 14, 15.2, 'rgba(0,0,0,.6)').rect(-WF, WF, 0, 1.2, 'rgba(255,255,255,.18)');
    // Lower intake
    p.rr(-70, 70, 36, 45, 3, K.void);
    for (const q of [39, 42]) p.rect(-68, 68, q, q + 1, 'rgba(255,255,255,.07)');
    // Fog + cornering lamps
    for (const sg of [1, -1]) {
      p.rr(sg * 76, sg * 104, 19, 34, 5, K.void);
      const c = sg * 90;
      p.circ(c, 26.5, 5.6, p.rad(c - 1.4, 25, 6, [[0, '#FFFFFF'], [0.35, '#DDE6F0'], [1, '#5C6B7E']]));
      p.ring(c, 26.5, 5.6, C.steel500, 0.9);
      p.rr(sg * 70, sg * 74, 20, 33, 1, K.amber);
      // Windscreen-cleaning step recess
      p.rr(sg * 34, sg * 62, 20, 27, 1.5, K.void).rect(sg * 35, sg * 61, 25.6, 27, K.alu);
    }
    // Plate
    p.rr(-28, 28, 19.5, 33, 1.4, '#EEF0F2').rr(-28, 28, 19.5, 33, 1.4, 'none', { stroke: C.steel500, 'stroke-width': 0.7 });
    p.rect(-28, -22, 19.5, 33, '#1D3FA8');
    p.text(3, 29.6, 'NVR 07', 8.4, C.ink, { family: 'mono', 'font-weight': 600, 'letter-spacing': 0.9 });
    p.rr(-5, 5, 45.5, 48.5, 1, C.steel600);
  }, (p, L) => {
    p.rect(0, CH_C, 0, L, K.trim2).solidRect(0, CH_C, 0, L);
    p.rect(0, CH_C, 0, 14, stripPaint(p, 14, 96, 82));
    p.rect(0, CH_C, 14, 15.2, 'rgba(0,0,0,.6)');
    p.rr(3, 18, 19, 29, 2, K.amber).rect(4, 17, 19.5, 21, 'rgba(255,255,255,.4)');
    p.rr(2, 20, 36, 45, 2, K.void);
  }, { name: 'cab.bumper' });

  // 2: bumper top (walk plate)
  frontStrip(cab, ...seg(2), (p, L) => {
    p.rect(-WF, WF, 0, L, K.trim).solidRect(-WF, WF, 0, L);
    for (let z = -100; z < 100; z += 5) p.rect(z, z + 2, 1.5, L - 1.5, 'rgba(255,255,255,.05)');
    p.rect(-WF, WF, L - 1, L, 'rgba(255,255,255,.14)');
  }, trimC);

  // 3: grille panel — upper grille + badge bar, lower grille, headlamps
  frontStrip(cab, ...seg(3), (p, L) => {
    p.rect(-WF, WF, 0, L, stripPaint(p, L, 236, 102)).solidRect(-WF, WF, 0, L);
    // Cowl lip shadow
    p.rect(-WF, WF, 0, 3, 'rgba(0,0,0,.45)');
    // Upper grille
    p.rr(-92, 92, 12, 66, 7, K.void);
    for (let i = 0; i < 6; i++) {
      const q = 16 + i * 8.2;
      p.rect(-88, 88, q, q + 4.4, p.lin(0, q, 0, q + 4.4, [[0, '#8E96A1'], [0.3, '#4B525C'], [1, '#1F2328']]));
    }
    p.rr(-92, 92, 12, 66, 7, 'none', { stroke: p.lin(-92, 0, 92, 0, [[0, '#5C636D'], [0.5, '#C9CFD6'], [1, '#5C636D']]), 'stroke-width': 1.6 });
    // Chrome badge bar with wordmark
    p.rr(-40, 40, 30, 46, 3, p.lin(0, 30, 0, 46, [[0, '#F2F4F6'], [0.45, '#AEB5BE'], [0.55, '#7C848F'], [1, '#C9CFD6']]));
    p.text(0, 42.2, 'NAVAIR', 10, '#101217', { 'font-weight': 800, 'letter-spacing': 2.6, style: 'font-stretch:125%' });
    // Lower grille
    p.rr(-78, 78, 72, 98, 5, K.void);
    for (let i = 0; i < 3; i++) {
      const q = 76 + i * 7.4;
      p.rect(-74, 74, q, q + 3.4, '#262A30').rect(-74, 74, q, q + 0.8, 'rgba(255,255,255,.14)');
    }
    // Blue accent wraps across the corners
    p.rect(WF - 16, WF, 90, 92.6, C.blue).rect(-WF, -WF + 16, 90, 92.6, C.blue);
    // Grab handles either side of the grille
    for (const sg of [1, -1]) p.rr(sg * 98, sg * 102, 20, 70, 2, C.steel500).rect(sg * 98, sg * 99, 21, 69, 'rgba(255,255,255,.45)');
    // Headlamps
    for (const sg of [1, -1]) {
      const hp: P2[] = [[sg * WF, 102], [sg * 60, 104], [sg * 56, 126], [sg * 64, L - 2], [sg * WF, L - 2]];
      p.poly(hp, '#07090C');
      p.poly(hp, 'none', { stroke: C.steel600, 'stroke-width': 0.8 });
      for (const [c, r] of [[sg * 92, 6.2], [sg * 76, 5.2]] as const) {
        p.circ(c, 116, r + 1.4, '#1B1F25');
        p.circ(c, 116, r, p.rad(c - r * 0.35, 116 - r * 0.35, r * 1.4, [[0, '#FFFFFF'], [0.3, '#E8EEF5'], [0.7, '#8FA0B4'], [1, '#2A3441']]));
      }
      // LED daytime light: hooked strip along the top and inner edge
      p.line([[sg * (WF - 2), 105.2], [sg * 62, 106.8], [sg * 58.8, 122]], K.led, 1.8);
      p.line([[sg * (WF - 2), 105.2], [sg * 62, 106.8], [sg * 58.8, 122]], 'rgba(160,200,255,.35)', 3.6);
      p.rr(sg * 100, sg * 107, L - 9, L - 5, 1, K.amber);
    }
    // Specular sweep
    p.poly([[70, 2], [40, 2], [-10, L - 4], [20, L - 4]], 'rgba(255,255,255,.035)');
  }, (p, L, s) => {
    p.rect(0, CH_C, 0, L, stripPaint(p, L, 236, 102)).solidRect(0, CH_C, 0, L);
    for (let i = 0; i < 6; i++) {
      const q = 10 + i * 10.5;
      p.rr(4, CH_C - 1, q, q + 5, 1, K.void);
      p.rect(4, CH_C - 1, q + 5, q + 5.6, 'rgba(255,255,255,.1)');
    }
    p.rect(0, CH_C, 88.4, 91, C.blue);
    // Headlamp wrap + indicator
    const hw: P2[] = [[0, 102], [CH_C - 3, 104], [CH_C - 6, L - 2], [0, L - 2]];
    p.poly(hw, '#07090C');
    p.line([[0.8, 105.2], [CH_C - 4, 106.4]], K.led, 1.8);
    p.rr(3, 11, L - 10, L - 4, 1, K.amber);
    void s;
  }, { name: 'cab.grille' });

  // 4: wiper cowl
  frontStrip(cab, ...seg(4), (p, L) => {
    p.rect(-WF, WF, 0, L, '#0B0C0F').solidRect(-WF, WF, 0, L);
    for (let z = -96; z < 96; z += 6) p.rect(z, z + 3, 2, L - 2, 'rgba(255,255,255,.05)');
    for (const z of [-50, 60]) p.circ(z, L / 2, 2.4, C.steel700);
  }, (p, L) => {
    p.rect(0, CH_C, 0, L, stripPaint(p, L, 244, 236)).solidRect(0, CH_C, 0, L);
  });

  // 5: windscreen
  frontStrip(cab, ...seg(5), (p, L) => {
    p.rect(-WF, WF, 0, L, K.void).solidRect(-WF, WF, 0, L);
    const g = p.lin(0, 3, 0, L - 3, [[0, '#0B0E13'], [0.14, '#0E1218'], [0.15, '#51607A'], [0.32, '#35425A'], [0.7, '#1C2431'], [1, '#121821']]);
    p.rr(-WF + 2, WF - 2, 3, L - 3, 7, g);
    // Sun-strip wordmark
    p.text(0, 12.6, 'N A V A I R', 6.6, 'rgba(225,230,236,.55)', { 'font-weight': 700, 'letter-spacing': 1.6 });
    // Interior: sun visors, dash top, mirror, steering wheel (LHD → −Z)
    for (const z of [-62, 62]) p.rr(z - 30, z + 30, 16, 26, 4, 'rgba(0,0,0,.35)');
    p.rr(-6, 6, 17, 27, 2, 'rgba(0,0,0,.4)');
    p.poly([[-WF + 3, L - 22], [WF - 3, L - 22], [WF - 3, L - 3], [-WF + 3, L - 3]], 'rgba(0,0,0,.42)');
    p.ring(-58, L - 22, 17, 'rgba(0,0,0,.6)', 3.4);
    p.rr(-86, -30, L - 50, L - 22, 10, 'rgba(0,0,0,.2)');
    p.rr(30, 86, L - 50, L - 22, 10, 'rgba(0,0,0,.2)');
    // Sky reflection bands
    p.poly([[86, 17], [58, 17], [4, L - 4], [32, L - 4]], 'rgba(255,255,255,.07)');
    p.poly([[40, 17], [30, 17], [-24, L - 4], [-14, L - 4]], 'rgba(255,255,255,.05)');
    p.poly([[-44, 17], [-52, 17], [-100, L - 4], [-92, L - 4]], 'rgba(255,255,255,.04)');
    // Parked wipers
    p.line([[-98, L - 6], [-10, L - 12]], K.void, 2.2).line([[10, L - 6], [96, L - 12]], K.void, 2.2);
    p.circ(-98, L - 6, 2.2, C.steel700).circ(10, L - 6, 2.2, C.steel700);
    p.rr(-WF + 2, WF - 2, 3, L - 3, 7, 'none', { stroke: K.void, 'stroke-width': 2.2 });
  }, (p, L) => {
    // A-pillar: glass wraps a little, then body-colour pillar.
    p.rect(0, CH_C, 0, L, stripPaint(p, L, 350, 244)).solidRect(0, CH_C, 0, L);
    p.rect(0, 5.5, 3, L - 3, '#1A222D').rect(5.5, 7, 0, L, K.void);
    p.rect(CH_C - 1.2, CH_C, 0, L, 'rgba(255,255,255,.08)');
  }, { name: 'cab.glass' });

  // 6: sun visor band (dark gloss)
  frontStrip(cab, ...seg(6), (p, L) => {
    p.rect(-WF, WF, 0, L, p.lin(0, 0, 0, L, [[0, '#2B313A'], [0.35, '#16191E'], [1, '#08090B']])).solidRect(-WF, WF, 0, L);
    p.rect(-WF, WF, L - 1.4, L, 'rgba(255,255,255,.18)');
  }, (p, L) => {
    p.rect(0, CH_C, 0, L, p.lin(0, 0, 0, L, [[0, '#2B313A'], [1, '#0B0C0F']])).solidRect(0, CH_C, 0, L);
  });

  // 7: crown with roof marker lamps
  frontStrip(cab, ...seg(7), (p, L) => {
    p.rect(-WF, WF, 0, L, p.lin(0, 0, 0, L, [[0, '#46505D'], [1, '#2B313A']])).solidRect(-WF, WF, 0, L);
    for (const z of [-40, -20, 0, 20, 40]) p.rr(z - 5, z + 5, L / 2 - 2.4, L / 2 + 2.4, 1.6, K.amber).rect(z - 4, z + 4, L / 2 - 2, L / 2 - 1, K.amberHi);
    for (const z of [-96, 96]) p.rr(z - 6, z + 6, L / 2 - 2.4, L / 2 + 2.4, 1.6, K.lamp);
  }, (p, L) => {
    p.rect(0, CH_C, 0, L, p.lin(0, 0, 0, L, [[0, '#46505D'], [1, '#2B313A']])).solidRect(0, CH_C, 0, L);
  });

  // 8: crown top (brightest: faces the sky)
  frontStrip(cab, ...seg(8), (p, L) => {
    p.rect(-WF, WF, 0, L, p.lin(0, 0, 0, L, [[0, '#3A424D'], [0.5, '#56616F'], [1, '#46505D']])).solidRect(-WF, WF, 0, L);
    p.rect(-60, 60, L * 0.45, L * 0.55, 'rgba(255,255,255,.08)');
  }, (p, L) => {
    p.rect(0, CH_C, 0, L, p.lin(0, 0, 0, L, [[0, '#3A424D'], [1, '#46505D']])).solidRect(0, CH_C, 0, L);
  });

  /* --- roof: the plan-view hero ---------------------------------------- */
  slopeTop(cab, ROOF0, FP[9], -W, W, (p, L) => {
    const shape: P2[] = [[0, -W], [L - CHX, -W], [L, -WF], [L, WF], [L - CHX, W], [0, W]];
    p.poly(shape, p.lin(0, 0, L, 0, [[0, '#262B33'], [0.6, '#2F353E'], [1, '#39414C']])).solid(shape);
    p.poly(shape, p.rad(L * 0.55, 0, 130, [[0, '#FFFFFF', 0.1], [1, '#FFFFFF', 0]]));
    // Domed roof: edges fall away from the light
    p.poly(shape, p.lin(0, -W, 0, W, [[0, '#FFFFFF', 0.1], [0.12, '#FFFFFF', 0], [0.85, '#000000', 0], [1, '#000000', 0.3]]));
    // Deflector crown: raised centre panel with feature lines
    const dp: P2[] = [[6, -96], [96, -84], [L - 6, -70], [L - 6, 70], [96, 84], [6, 96]];
    p.poly(dp, 'rgba(255,255,255,.03)');
    p.line([[6, -96], [96, -84], [L - 6, -70]], 'rgba(255,255,255,.12)', 1.2);
    p.line([[6, 96], [96, 84], [L - 6, 70]], 'rgba(0,0,0,.45)', 1.2);
    // Roof hatch (glass sunroof) with frame
    p.rr(100, 140, -30, 30, 5, K.void);
    p.rr(103, 137, -27, 27, 4, p.lin(103, -27, 137, 27, [[0, '#101722'], [0.45, '#3A4A60'], [0.55, '#1A2330'], [1, '#0E131A']]));
    p.rr(103, 137, -27, 27, 4, 'none', { stroke: C.steel600, 'stroke-width': 0.9 });
    // Wordmark + blue chevron
    p.text(50, 6, 'NAVAIR', 15, '#E6E9ED', { 'font-weight': 800, 'letter-spacing': 3, style: 'font-stretch:125%' });
    p.line([[L - 6, -54], [L + 0.5, 0], [L - 6, 54]], C.blue, 2);
    // Beacons (terminal requirement), antennas, air horns
    for (const z of [-104, 104]) {
      p.circ(10, z, 6.4, K.trim).circ(10, z, 5, p.rad(8.6, z - 1.4, 6, [[0, '#FFE2A6'], [0.5, K.amber], [1, '#B8650E']]));
    }
    for (const z of [-76, 76]) p.circ(22, z, 2, K.void).line([[22, z], [38, z]], C.steel500, 0.9);
    p.rr(106, 128, 40, 46, 2.6, K.chrome).rr(108, 128, 50, 56, 2.6, K.chrome);
    p.rect(104, 108, 40, 56, C.steel500);
    // Rain gutters along the side edges
    p.rect(0, L - CHX, -W, -W + 2.4, 'rgba(255,255,255,.14)').rect(0, L - CHX, W - 2.4, W, 'rgba(0,0,0,.35)');
  }, { name: 'cab.roof' });
  // Rounded sleeper-roof rear edge (two facets)
  for (let i = 0; i < 2; i++) {
    slopeTop(cab, ROOF_R[i], ROOF_R[i + 1], -W, W, (p, L) => {
      p.rect(0, L, -W, W, i ? '#2A3038' : '#20252C').solidRect(0, L, -W, W);
      p.rect(0, L, -W, W, p.lin(0, -W, 0, W, [[0, '#FFFFFF', 0.07], [0.5, '#FFFFFF', 0], [1, '#000000', 0.15]]));
    });
  }

  /* --- rear wall --------------------------------------------------------- */
  rearFace(cab, 292, -W, W, 100, 384, (p) => {
    p.rect(-W, W, 100, 384, p.lin(0, 384, 0, 100, yStops(384, 100))).solidRect(-W, W, 100, 384);
    // Sleeper back panel ribs
    for (const z of [-86, -56, -26, 4, 34]) p.rect(z, z + 2, 116, 370, 'rgba(0,0,0,.24)').rect(z + 2, z + 3, 116, 370, 'rgba(255,255,255,.04)');
    // Engine air-intake chimney (right-hand rear corner)
    p.rr(76, 116, 176, 380, 5, K.trim).solidRect(76, 116, 176, 380, 5);
    for (let y = 196; y < 364; y += 8) p.rr(81, 111, y, y + 3.6, 1, K.void);
    p.rr(74, 118, 366, 382, 3, C.steel700).rect(74, 118, 380, 382, 'rgba(255,255,255,.2)');
    // LED work lamps
    for (const z0 of [-80, 20]) p.rr(z0, z0 + 30, 364, 376, 2, C.steel700).rr(z0 + 2, z0 + 28, 366, 374, 1.5, K.led);
    p.rect(-W, W, 145, 147.6, C.blue);
    p.rect(-W, W, 100, 110, K.trim);
    // Cab mounts / tilt rams peeking below
    for (const s of [1, -1]) p.rr(s * 40, s * 56, 100, 112, 1.5, C.steel600);
    p.rect(-W, -W + 3, 100, 384, 'rgba(0,0,0,.35)').rect(W - 3, W, 100, 384, 'rgba(0,0,0,.35)');
  }, { bias: UNDER, name: 'cab.back' });

  /* --- wheel-house liners ----------------------------------------------- */
  const liner: P2[] = [...arcPts(ARCH[0], ARCH[1], ARCH_R, 180, 0, 16), [444, 38], [316, 38]];
  sidePair(cab, 314, 446, 38, 118, 70, (p) => {
    p.poly(liner, K.void).solid(liner);
  }, { double: true, shade: 0, bias: UNDER });

  /* --- cab-side collars (air deflector extenders) ---------------------- */
  // Overlaps the cab side by 3 cm so no background seam shows at the joint.
  const defl: P2[] = [[295, 388], [285, 386.5], [274, 372], [268, 190], [272, 162], [295, 150]];
  sidePair(cab, 268, 295, 150, 390, CAB_W + 0.8, (p) => {
    p.poly(defl, p.lin(0, 388, 0, 150, yStops(388, 150))).solid(defl);
    p.line([[287, 385], [276, 370.5], [270.6, 190]], 'rgba(255,255,255,.14)', 1.1);
    p.line([[291, 386], [291, 152]], 'rgba(0,0,0,.5)', 1.4);
    p.rect(269.6, 295, 145, 147.6, C.blue);
  }, { double: true, name: 'cab.collar' });

  /* --- mirrors ----------------------------------------------------------- */
  const MX0 = 520, MX1 = 533, MY0 = 244, MY1 = 340;
  for (const s of [1, -1] as const) {
    const [zlo, zhi] = zr(s, 134, 152);
    const zo = s * 152, zi = s * 134;
    const shell = (p: Pen, a: number, b: number, fill: string) => {
      p.rr(a, b, MY0, MY1, 3.5, fill).solidRect(a, b, MY0, MY1, 3.5);
      p.rect(a + 1, b - 1, 296, 297.4, 'rgba(0,0,0,.6)');
    };
    // Outer + inner shell sides
    sideFace(cab, MX0, MX1, MY0, MY1, zo, s, (p) => {
      shell(p, MX0, MX1, p.lin(MX0, 0, MX1, 0, [[0, '#15181D'], [0.6, '#2A3038'], [1, '#1B1F25']]));
      p.line([[MX0 + 2, MY1 - 2], [MX1 - 2, MY1 - 2]], 'rgba(255,255,255,.2)', 1);
      p.rr(MX0 + 2, MX1 - 2, 300, 305, 1.2, K.amber);
    }, { name: 'mirror.o' });
    sideFace(cab, MX0, MX1, MY0, MY1, zi, (s === 1 ? -1 : 1) as 1 | -1, (p) => shell(p, MX0, MX1, K.trim), { name: 'mirror.i' });
    frontFace(cab, MX1, zlo, zhi, MY0, MY1, (p) => {
      p.rr(zlo, zhi, MY0, MY1, 3.5, p.lin(zi, 0, zo, 0, [[0, '#101216'], [0.5, '#2A3038'], [1, '#15181D']])).solidRect(zlo, zhi, MY0, MY1, 3.5);
      p.rect(zlo + 1, zhi - 1, 296, 297.4, 'rgba(0,0,0,.6)');
      p.rect(zlo + 2, zhi - 2, MY1 - 4, MY1 - 2.6, 'rgba(255,255,255,.14)');
    });
    rearFace(cab, MX0, zlo, zhi, MY0, MY1, (p) => {
      p.rr(zlo, zhi, MY0, MY1, 3.5, K.trim).solidRect(zlo, zhi, MY0, MY1, 3.5);
      const mg = p.lin(0, MY1, 0, MY0, [[0, '#C9D3DE'], [0.45, '#8C9AAB'], [1, '#5C6B7E']]);
      p.rr(zlo + 2, zhi - 2, 299, MY1 - 2.5, 2, mg).rr(zlo + 2, zhi - 2, MY0 + 2.5, 294, 2, mg);
      p.poly([[zlo + 3, 322], [zhi - 3, 333], [zhi - 3, 327], [zlo + 3, 314]], 'rgba(255,255,255,.45)');
      p.poly([[zlo + 3, 268], [zhi - 3, 276], [zhi - 3, 272], [zlo + 3, 263]], 'rgba(255,255,255,.3)');
    });
    planFace(cab, MX0, MX1, zlo, zhi, MY1, (p) => {
      p.rr(MX0, MX1, zlo, zhi, 3, p.lin(MX0, 0, MX1, 0, [[0, '#20252C'], [1, '#3A424D']])).solidRect(MX0, MX1, zlo, zhi, 3);
      p.rect(MX1 - 3, MX1 - 1.5, zlo + 2, zhi - 2, 'rgba(255,255,255,.12)');
    });
    // Arms: plan + side projections (thin, double-sided)
    const [alo, ahi] = zr(s, 118, 146);
    planFace(cab, 476, 530, alo, ahi, MY1 + 1, (p) => {
      p.line([[481, s * 122], [504, s * 133], [524, s * 139]], '#23272E', 3.4).line([[481, s * 121.6], [504, s * 132.4], [524, s * 138.4]], 'rgba(255,255,255,.15)', 0.8);
    }, { double: true, shade: 0 });
    sideFace(cab, 470, 530, 240, 350, s * 136, s, (p) => {
      p.line([[481, 332], [494, 345], [512, 346], [524, 339]], '#23272E', 3.4);
      p.line([[472, 248], [496, 244], [522, 247]], '#23272E', 2.8);
      p.line([[481, 333], [494, 346], [512, 347]], 'rgba(255,255,255,.14)', 0.8);
    }, { double: true, shade: 0 });
  }
}

/* ------------------------------------------------------------------------ */
/* Chassis                                                                   */
/* ------------------------------------------------------------------------ */

/** Aluminium D-tank, side elevation (x0 … x1, sits y 46 … 106). */
function dTank(p: Pen, x0: number, x1: number, fill: 'alu' | 'adblue') {
  const g = fill === 'alu'
    ? p.lin(0, 106, 0, 46, [[0, '#8E96A1'], [0.08, '#E9ECEF'], [0.3, '#C3C9D0'], [0.7, '#9AA1AB'], [1, '#5C636D']])
    : p.lin(0, 106, 0, 46, [[0, '#A9B0B9'], [0.1, '#F4F5F7'], [0.6, '#D6DAE0'], [1, '#8E96A1']]);
  p.rr(x0, x1, 46, 106, 12, g);
  p.rr(x0, x1, 46, 106, 12, 'none', { stroke: 'rgba(0,0,0,.35)', 'stroke-width': 0.8 });
  // Brushed grain
  for (let y = 58; y < 100; y += 5) p.rect(x0 + 8, x1 - 8, y, y + 0.5, 'rgba(255,255,255,.12)');
  // End seams
  p.line([[x0 + 6, 50], [x0 + 6, 102]], 'rgba(0,0,0,.18)', 1).line([[x1 - 6, 50], [x1 - 6, 102]], 'rgba(0,0,0,.18)', 1);
}

/** Tank strap with rubber pad and tensioner bolt. */
function strap(p: Pen, x: number) {
  p.rect(x, x + 4, 44, 108, C.steel700).rect(x, x + 1, 44, 108, 'rgba(255,255,255,.18)');
  p.rr(x - 1.5, x + 5.5, 44, 50, 1.5, C.steel600).circ(x + 2, 47, 1.2, C.steel300);
}

function buildChassis(body: Node3, tractor: Node3) {
  const X0 = RIG.tractorRear - 2; // −112
  // --- rails (outer + inner webs)
  sidePair(body, X0, 292, 40, 104, 47, (p) => {
    p.rect(X0, 292, 70, 100, K.frame).solidRect(X0, 292, 70, 100);
    p.rect(X0, 292, 97, 100, K.frameHi).rect(X0, 292, 70, 72.4, K.frameLo);
    p.rect(X0, 292, 99.2, 100, 'rgba(255,255,255,.14)');
    let bolts = '';
    for (let x = X0 + 12; x < 290; x += 18) for (const y of [92, 78]) {
      const [u, v] = p.pt(x, y);
      bolts += `M${u + 0.9} ${v}a.9 .9 0 1 0 -1.8 0a.9 .9 0 1 0 1.8 0`;
    }
    p.raw(path(bolts, C.steel600));
    // Air tanks under the rail
    p.rr(84, 204, 46, 68, 10, p.lin(0, 68, 0, 46, [[0, '#7A818D'], [0.3, '#A5ABB5'], [1, '#3B4049']])).solidRect(84, 204, 46, 68, 10);
    for (const x of [112, 176]) p.rect(x, x + 3, 44, 70, C.steel800);
    p.rect(92, 96, 68, 70, C.steel800).rect(190, 194, 68, 70, C.steel800);
    p.circ(206, 57, 1.8, C.steel500);
    // Grime along the lower flange
    p.rect(X0, 292, 70, 76, K.dust + '0.12)');
  }, { name: 'rail.o' });
  for (const s of [1, -1] as const) {
    sideFace(body, X0, 292, 70, 100, s * 39, s === 1 ? -1 : 1, (p) => {
      p.rect(X0, 292, 70, 100, K.frameLo).solidRect(X0, 292, 70, 100);
      p.rect(X0, 292, 97, 100, K.frame).rect(X0, 292, 70, 72.4, K.frame);
    });
  }

  // --- chassis plan (rail tops, cross-members, prop shaft, air lines)
  planFace(body, X0, 292, -124, 124, 100.3, (p) => {
    p.rr(200, 290, -78, -52, 4, C.steel500).rect(200, 290, -70, -67, 'rgba(255,255,255,.18)');
    p.circ(204, -65, 4, C.steel700);
    p.rect(-70, -64, -118, 118, C.steel700);
    for (const s of [1, -1]) p.line([[-60, s * 40], [60, s * 56], [260, s * 60]], C.hazard, 1, { opacity: 0.6 });
    // drive axle + diff
    p.rect(-7, 7, -78, 78, C.steel700).circ(0, 0, 19, C.steel700).circ(0, 0, 11, C.steel600);
    // prop shaft
    p.rect(14, 282, -3.5, 3.5, C.steel500).rect(14, 282, -3.5, -2.4, 'rgba(255,255,255,.25)');
    p.rect(140, 150, -5.5, 5.5, C.steel400).rect(262, 272, -5.5, 5.5, C.steel400);
    // cross members
    for (const [x, w] of [[X0, 7], [-34, 8], [124, 8], [210, 8], [284, 8]] as const) p.rect(x, x + w, -39, 39, K.frame).rect(x, x + 1.5, -39, 39, K.frameHi);
    // rails
    for (const s of [1, -1]) {
      p.rect(X0, 292, s * 39, s * 47, K.frameHi);
      p.rect(X0, 292, s * 46, s * 47, 'rgba(255,255,255,.12)');
    }
    p.rect(X0, X0 + 7, -124, 124, C.steel700);
  }, { shade: 0, name: 'chassis.plan' });

  // --- side equipment: battery box + fuel tank (+Z) / fuel + AdBlue (−Z)
  for (const s of [1, -1] as const) {
    const [zlo, zhi] = zr(s, 80, 124);
    sideFace(body, 66, 292, 38, 112, s * 124, s, (p) => {
      p.rr(66, 292, 40, 110, 8, K.trim).solidRect(66, 292, 40, 110, 8);
      p.line([[70, 108.6], [288, 108.6]], 'rgba(255,255,255,.08)', 1);
      if (s === 1) {
        // Battery box: ribbed lid, latch, NAVAIR tag
        p.rr(72, 146, 44, 106, 5, p.lin(0, 106, 0, 44, [[0, '#23272E'], [1, '#101216']]));
        for (let y = 56; y < 98; y += 6) p.rect(78, 140, y, y + 2.6, K.void).rect(78, 140, y + 2.6, y + 3.2, 'rgba(255,255,255,.06)');
        p.rr(102, 116, 98, 103, 1.2, C.steel500);
        dTank(p, 150, 288, 'alu');
        for (const x of [176, 258]) strap(p, x);
        p.text(219, 60, 'DIESEL', 4.6, C.steel600, { family: 'mono', 'letter-spacing': 1.2 });
      } else {
        dTank(p, 70, 206, 'alu');
        for (const x of [94, 180]) strap(p, x);
        p.text(137, 60, 'DIESEL', 4.6, C.steel600, { family: 'mono', 'letter-spacing': 1.2 });
        dTank(p, 212, 288, 'adblue');
        p.rr(236, 264, 66, 74, 1.5, C.blue).text(250, 71.6, 'AdBlue', 4.2, '#fff', { 'font-weight': 700 });
        // Exhaust tailpipe dropping out under the tank
        p.rr(286, 300, 34, 44, 3, C.steel500).rect(286, 300, 34, 36, K.void);
      }
      // Road grime along the bottom
      p.rect(66, 292, 40, 52, p.lin(0, 52, 0, 40, [[0, K.dust + '0)'], [1, K.dust + '0.2)']]));
    }, { name: 'tank.side' });
    planFace(body, 66, 292, zlo, zhi, 112, (p) => {
      p.rr(66, 292, zlo, zhi, 6, K.trim).solidRect(66, 292, zlo, zhi, 6);
      const top = (x0: number, x1: number, fill: string) => {
        p.rr(x0, x1, s * 84, s * 122, 8, fill === K.alu ? p.lin(0, s * 84, 0, s * 122, [[0, '#6E7580'], [0.45, '#C3C9D0'], [0.55, '#DDE1E6'], [1, '#7A818D']]) : fill);
        p.rect(x0 + 6, x1 - 6, s * 102, s * 103, 'rgba(255,255,255,.5)');
      };
      if (s === 1) {
        p.rr(72, 146, 84, 122, 4, '#1A1D22');
        for (let x = 80; x < 140; x += 6) p.rect(x, x + 2.6, 88, 118, K.void);
        top(150, 288, K.alu);
        for (const x of [176, 258]) p.rect(x, x + 4, 82, 124, C.steel700);
        p.circ(276, 112, 5, K.trim).circ(276, 112, 3.8, C.steel100);
      } else {
        top(70, 206, K.alu);
        for (const x of [94, 180]) p.rect(x, x + 4, -124, -82, C.steel700);
        p.circ(198, -112, 5, K.trim).circ(198, -112, 3.8, C.steel100);
        p.rr(212, 288, -120, -86, 8, K.adblue);
        p.circ(278, -110, 5, K.trim).circ(278, -110, 3.8, C.blue);
      }
    });
    rearFace(body, 66, zlo, zhi, 38, 112, (p) => {
      p.rr(zlo, zhi, 40, 110, 6, K.trim).solidRect(zlo, zhi, 40, 110, 6);
      if (s === -1) p.rr(-122, -84, 46, 106, 12, p.lin(-122, 0, -84, 0, [[0, '#6E7580'], [0.4, '#D2D7DD'], [1, '#8E96A1']]));
      else p.rr(84, 122, 44, 106, 5, '#15181D');
    });
  }

  // --- catwalk (tread plate) behind the cab
  planFace(body, 178, 288, -64, 64, 110, (p) => {
    p.rect(178, 288, -64, 64, C.steel500).solidRect(178, 288, -64, 64);
    let d = '';
    for (let x = 182; x < 286; x += 6) for (let z = -60; z < 62; z += 6) {
      const o = ((x + z) / 6) % 2 === 0 ? 0 : 3;
      const [u, v] = p.pt(x + o, z);
      d += `M${u} ${v + 1.2}l2.4 -2.4`;
    }
    p.raw(stroke(d, 'rgba(255,255,255,.22)', 0.9));
    p.rect(178, 288, -64, -61, C.steel700).rect(178, 288, 61, 64, C.steel700).rect(178, 181, -64, 64, C.steel700);
    p.circ(280, POLE_Z, 3.5, K.trim).circ(280, POLE_Z, 1.8, C.steel500);
  });

  // --- fifth wheel
  const FX0 = RIG.kingpinX - 50, FX1 = RIG.kingpinX + 50, FY = RIG.fifthY;
  planFace(body, FX0, FX1, -64, 52, FY, (p) => {
    const kx = RIG.kingpinX;
    // Release handle (signal orange) + mounting brackets
    p.rect(kx - 14, kx - 8, -62, -46, C.steel600).rr(kx - 16, kx - 6, -64, -56, 2, C.signal);
    p.rr(FX0, FX1, -48, 48, 26, p.rad(kx + 6, -8, 56, [[0, '#8E96A1'], [0.6, '#6A717C'], [1, '#3B4049']])).solidRect(FX0, FX1, -48, 48, 26);
    // Grease film + lube grooves
    p.rr(FX0 + 10, FX1 - 10, -38, 38, 20, 'none', { stroke: 'rgba(0,0,0,.35)', 'stroke-width': 1 });
    p.rr(FX0 + 22, FX1 - 22, -26, 26, 13, 'none', { stroke: 'rgba(0,0,0,.3)', 'stroke-width': 1 });
    p.poly([[kx + 22, -30], [kx + 36, -12], [kx + 40, 18], [kx + 26, 34], [kx + 10, 20]], 'rgba(20,16,10,.28)');
    p.poly([[kx + 4, -40], [kx + 18, -44], [kx + 26, -36]], 'rgba(255,255,255,.14)');
    // Throat + jaws
    p.poly([[FX0, -24], [FX0, 24], [kx - 12, 6], [kx + 6, 6], [kx + 6, -6], [kx - 12, -6]], K.void);
    p.circ(kx, 0, 7, C.steel700).circ(kx, 0, 4, K.void);
    p.rr(FX0 + 4, FX1 - 4, -46, -42, 2, 'rgba(255,255,255,.12)');
  }, { name: 'fifth.top' });
  sidePair(body, FX0, FX1, 98, FY, 50, (p, s) => {
    p.poly([[FX0 + 8, 100], [FX1 - 8, 100], [FX1 - 2, 112], [FX0 + 2, 112]], C.steel800).solid([[FX0 + 8, 100], [FX1 - 8, 100], [FX1 - 2, 112], [FX0 + 2, 112]]);
    p.rect(FX0, FX1, 112, FY, C.steel600).solidRect(FX0, FX1, 112, FY);
    p.rect(FX0, FX1, FY - 1.2, FY, 'rgba(255,255,255,.2)');
    p.circ(RIG.kingpinX, 106, 3.6, C.steel500).circ(RIG.kingpinX, 106, 1.4, K.void);
    for (const x of [FX0 + 14, FX1 - 14]) p.circ(x, 104, 1.2, C.steel500);
    if (s === -1) p.rr(RIG.kingpinX - 14, RIG.kingpinX - 8, 102, 113, 1.5, C.signal);
  });
  rearFace(body, FX0, -50, 50, 100, FY, (p) => {
    p.rect(-50, 50, 112, FY, C.steel600).rect(-40, 40, 100, 112, C.steel800).solidRect(-50, 50, 112, FY).solidRect(-40, 40, 100, 112);
    p.poly([[-24, FY], [24, FY], [8, 112], [-8, 112]], K.void);
    p.rect(-50, 50, FY - 1.2, FY, 'rgba(255,255,255,.2)');
  });

  // --- rear cross-member + lamp pods (split so each sorts by its own position)
  rearFace(body, X0, -47, 47, 68, 100, (p) => {
    p.rect(-47, 47, 70, 100, K.frame).solidRect(-47, 47, 70, 100);
    for (const s of [1, -1]) p.rect(s * 39, s * 47, 70, 100, K.frameHi);
    p.rect(-47, 47, 77, 83, C.steel700);
    for (let z = -40; z <= 40; z += 16) p.circ(z, 94, 1.1, C.steel600).circ(z, 76, 1.1, C.steel600);
    p.rr(-18, 18, 71, 76, 1, C.steel500);
  }, { double: true, name: 'tractor.rear' });
  for (const s of [1, -1] as const) {
    const [zlo, zhi] = zr(s, 47, 124);
    rearFace(body, X0, zlo, zhi, 66, 94, (p) => {
      p.rect(s * 47, s * 86, 77, 83, C.steel700).solidRect(s * 47, s * 86, 77, 83);
      p.rr(s * 84, s * 123, 68, 92, 2.5, K.trim).solidRect(s * 84, s * 123, 68, 92, 2.5);
      p.rr(s * 88, s * 103, 72, 88, 1.5, K.red).rect(s * 88, s * 103, 84, 86, 'rgba(255,255,255,.3)');
      p.rr(s * 105, s * 112, 72, 88, 1.5, K.amber);
      p.rr(s * 114, s * 120, 72, 88, 1.5, K.lamp);
      p.poly([[s * 60, 76], [s * 72, 76], [s * 66, 88]], K.red).solid([[s * 60, 76], [s * 72, 76], [s * 66, 88]]);
    }, { double: true, name: 'tractor.lamps' });
  }

  // --- rear quarter fenders (arc band, 4 facets, mud flap)
  for (const s of [1, -1] as const) {
    const [zlo, zhi] = zr(s, 76, 116);
    sideFace(body, -116, 66, 20, 122, s * 116, s, (p) => {
      const band: P2[] = [...arcPts(0, WR, 67, 18, 178, 20), ...arcPts(0, WR, 59.5, 178, 18, 20)];
      p.poly(band, p.lin(0, WR + 67, 0, WR, [[0, '#23262B'], [1, '#0B0C0F']])).solid(band);
      p.line(arcPts(0, WR, 66.2, 22, 174, 18), 'rgba(255,255,255,.16)', 1.1);
      for (let a = 34; a < 170; a += 17) p.line([[Math.cos(a * DEG) * 60.5, WR + Math.sin(a * DEG) * 60.5], [Math.cos(a * DEG) * 66, WR + Math.sin(a * DEG) * 66]], 'rgba(0,0,0,.35)', 0.8);
      // Flap hanger bracket + flap edge
      p.rect(-104, -62, 78, 81.5, C.steel700).solidRect(-104, -62, 78, 81.5);
      p.rect(-67, -62.5, 22, 62, C.rubber2).solidRect(-67, -62.5, 22, 62);
      p.rr(-115, -104, 69, 91, 2, K.trim).solidRect(-115, -104, 69, 91, 2);
      p.rect(-115, -113, 72, 88, K.red);
    });
    const facets: [number, number][] = [[176, 136], [136, 96], [96, 56], [56, 20]];
    for (const [a0, a1] of facets) {
      const P: P2 = [67 * Math.cos(a0 * DEG), WR + 67 * Math.sin(a0 * DEG)];
      const Q: P2 = [67 * Math.cos(a1 * DEG), WR + 67 * Math.sin(a1 * DEG)];
      slopeTop(body, P, Q, zlo, zhi, (p, L) => {
        p.rect(0, L, zlo, zhi, '#121417').solidRect(0, L, zlo, zhi);
        for (let t = 6; t < L - 3; t += 8) p.rect(t, t + 1.2, zlo + 3, zhi - 3, 'rgba(255,255,255,.05)');
        p.rect(0, L, s > 0 ? zhi - 1.5 : zlo, s > 0 ? zhi : zlo + 1.5, 'rgba(255,255,255,.16)');
      });
    }
    rearFace(body, -66, zlo, zhi + s * 2, 20, 92, (p) => {
      const [a, b] = s > 0 ? [zlo, zhi + 2] : [zlo - 2, zhi];
      p.rr(a, b, 20, 92, 2, '#1D1F23').solidRect(a, b, 20, 92, 2);
      p.rect(a + 3, b - 3, 26, 29, C.steel400);
      for (let y = 34; y < 50; y += 4) p.rect(a + 4, b - 4, y, y + 1.6, 'rgba(255,255,255,.05)');
      p.text((a + b) / 2, 62, 'NAVAIR', 6.5, C.steel400, { 'font-weight': 800, 'letter-spacing': 0.8 });
      p.rect(a, b, 88, 92, 'rgba(255,255,255,.08)');
    });
  }

  // --- unsprung: axles + air bags
  frontFace(tractor, 0, -78, 78, 36, 100, (p) => {
    p.rect(-78, 78, 46, 58, C.steel700).solidRect(-78, 78, 46, 58);
    p.rect(-78, 78, 55.5, 58, 'rgba(255,255,255,.1)');
    p.circ(0, 52, 17, C.steel700).circ(0, 52, 11, C.steel600).ring(0, 52, 14, 'rgba(0,0,0,.4)', 1.2);
  }, { double: true, bias: UNDER, name: 'axle.drive' });
  rearFace(tractor, -58, -74, 74, 50, 100, (p) => {
    for (const s of [1, -1]) {
      p.rr(s * 50, s * 72, 60, 96, 7, C.rubber2).solidRect(s * 50, s * 72, 60, 96, 7);
      for (const y of [70, 78, 86]) p.rect(s * 51, s * 71, y, y + 1.4, 'rgba(255,255,255,.08)');
      p.rect(s * 48, s * 74, 56, 60, C.steel600).solidRect(s * 48, s * 74, 56, 60);
      p.rect(s * 48, s * 74, 96, 99, C.steel600).solidRect(s * 48, s * 74, 96, 99);
    }
  }, { double: true, bias: UNDER, name: 'airbags.drive' });
  frontFace(tractor, RIG.wheelbase, -78, 78, 36, 70, (p) => {
    const beam: P2[] = [[-78, 56], [-50, 56], [-36, 46], [36, 46], [50, 56], [78, 56], [78, 48], [50, 48], [36, 40], [-36, 40], [-50, 48], [-78, 48]];
    p.poly(beam, C.steel700).solid(beam);
    p.rect(-74, 74, 37, 39.5, C.steel500).solidRect(-74, 74, 37, 39.5);
    for (const s of [1, -1]) p.rect(s * 40, s * 56, 56, 68, C.steel600).solidRect(s * 40, s * 56, 56, 68);
  }, { double: true, bias: UNDER, name: 'axle.steer' });
}

/* ------------------------------------------------------------------------ */
/* Air / electric suzie coils                                                */
/* ------------------------------------------------------------------------ */

const COIL_L = 160;
const COIL_COLORS = [C.signal, C.hazard, C.steel300];
/** The coil sheet leans outboard so it reads in plan as well as elevation. */
const COIL_TILT = 18 * DEG;
const COIL_TOP = 240;
const COIL_Z0 = 12 - (COIL_TOP - 109) * Math.tan(COIL_TILT);
const POLE_Z = COIL_Z0 + (COIL_TOP - 229) * Math.tan(COIL_TILT);

function coilBase(i: number): (t: number) => P2 {
  const S: P2 = [24 - i * 3, 229 - i * 1.5];
  const E: P2 = [157, 109];
  const Cc: P2 = [60 + i * 8, 116 - i * 4];
  return (t) => [
    (1 - t) * (1 - t) * S[0] + 2 * (1 - t) * t * Cc[0] + t * t * E[0],
    (1 - t) * (1 - t) * S[1] + 2 * (1 - t) * t * Cc[1] + t * t * E[1],
  ];
}

function buildCoils(coil: Node3, A: V3) {
  // Post + hanger arm (rigid, vertical, not stretched).
  const pp = new Pen(1, 0, -1, COIL_TOP);
  pp.rect(0, 4, 108, 238, C.steel700).rect(0, 1.2, 108, 238, 'rgba(255,255,255,.14)');
  pp.rect(0, 26, 232, 236, C.steel700).rr(-2, 6, 106, 112, 1.5, K.trim).rr(20, 27, 226, 236, 1.5, C.steel600);
  pp.solidRect(0, 4, 108, 238).solidRect(0, 26, 232, 236);
  coil.face({ o: [0, COIL_TOP, POLE_Z], a: [-1, 0, 0], b: [0, -1, 0], w: 30, h: 132, art: pp.art(), outline: pp.outline(), double: true, shade: 0.6, name: 'coils.post' });

  // The three coils on a leaning sheet (stretched along A as the trailer articulates).
  const cosT = Math.cos(COIL_TILT);
  const ps = new Pen(1, 0, -1 / cosT, COIL_TOP);
  for (let i = 0; i < 3; i++) {
    const base = coilBase(i);
    const pts: P2[] = [];
    const N = 220, turns = 19, amp = 4.4;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const [x, y] = base(t);
      const [x2, y2] = base(Math.min(1, t + 0.005));
      const [x1, y1] = base(Math.max(0, t - 0.005));
      const tx = x2 - x1, ty = y2 - y1, l = Math.hypot(tx, ty) || 1;
      const ux = tx / l, uy = ty / l;
      const env = amp * Math.min(1, t * 10, (1 - t) * 10);
      const ph = t * turns * Math.PI * 2;
      const n = Math.sin(ph) * env, g = Math.cos(ph) * env * 0.62;
      pts.push([x - uy * n + ux * g, y + ux * n + uy * g]);
    }
    ps.line(pts, K.void, 3.3).line(pts, COIL_COLORS[i], 1.8);
    const [ex, ey] = base(1);
    ps.rr(ex - 5, ex + 1, ey - 3, ey + 3, 1.5, COIL_COLORS[i]);
    const [sx, sy] = base(0);
    ps.circ(sx, sy, 2.2, C.steel600);
  }
  coil.face({
    o: [0, COIL_TOP, COIL_Z0],
    a: A,
    b: [0, -cosT, Math.sin(COIL_TILT)],
    w: COIL_L,
    h: 132 / cosT,
    art: ps.art(),
    double: true,
    shade: 0,
    name: 'coils',
  });
}

/* ------------------------------------------------------------------------ */
/* Trailer                                                                   */
/* ------------------------------------------------------------------------ */

const TF = RIG.trailerFront; // 80
const TR = RIG.trailerRear; // −1285
const DY = RIG.deckY; // 128
const GY = 116; // gooseneck underside
const BY = 80; // main beam underside
const GN0 = -230, GN1 = -290; // gooseneck step
const BEAM: P2[] = [[TF, DY], [TF, GY], [GN0, GY], [GN1, BY], [-1250, BY], [TR, 98], [TR, DY]];
const BOL: [number, number][] = [[56, 80], [-552, -528], [-1162, -1128]];
const XM: number[] = [];
for (let x = -30; x > -1250; x -= 86) if (!BOL.some(([a, b]) => x > a - 24 && x < b + 16)) XM.push(x);
const OUTRIG = [-236, -420, -700, -960, -1234];
const LEG_X = -330;
const TWIST_X = [60.7, -527.3, -552.7, -1140.7];
const TWIST_Z = 113.8;
const GUARD_X0 = -1206, GUARD_X1 = -822;

/** Red/white retro-reflective contour tape along a rail (x from a to b, band y0…y1). */
function tape(p: Pen, a: number, b: number, y0: number, y1: number, seg = 30) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  p.rect(lo, hi, y0, y1, K.tapeWhite);
  for (let x = lo, i = 0; x < hi; x += seg, i++) if (i % 2 === 0) p.rect(x, Math.min(hi, x + seg), y0, y1, K.tapeRed);
  p.rect(lo, hi, y0, y0 + 0.6, 'rgba(255,255,255,.35)');
}

function beamWeb(p: Pen, detail: boolean) {
  p.poly(BEAM, detail ? K.frame : K.frameLo).solid(BEAM);
  // Top flange + highlight
  p.rect(TR, TF, DY - 5, DY, K.frameHi).rect(TR, TF, DY - 1, DY, 'rgba(255,255,255,.14)');
  // Bottom flange following the gooseneck
  const lower: P2[] = [[TF, GY], [GN0, GY], [GN1, BY], [-1250, BY], [TR, 98]];
  const upper: P2[] = lower.map(([x, y]) => [x, y + 4] as P2).reverse();
  p.poly([...lower, ...upper], K.frameHi);
  // Web stiffeners
  for (let x = GN1 - 10; x > -1245; x -= 60) p.rect(x, x + 2.4, BY + 4, DY - 5, K.frameLo).rect(x + 2.4, x + 3.2, BY + 4, DY - 5, 'rgba(255,255,255,.05)');
  if (detail) {
    // Lightening holes in the deep web section
    for (let x = GN1 - 40; x > -1230; x -= 120) p.ell(x, 102, 11, 6, '#0B0C0F').ell(x, 100.6, 10, 4.4, '#101216');
    p.rect(GN1, -1250, BY + 4, BY + 7, K.dust + '0.1)');
  }
  p.poly([[GN0, GY], [GN0 - 26, GY], [GN1 + 4, BY + 4]], 'rgba(0,0,0,.25)');
}

function buildTrailer(trailer: Node3, trBody: Node3) {
  // --- main beams: outer webs with suspension, inner webs
  sidePair(trBody, TR, TF, 30, DY, 50, (p) => {
    beamWeb(p, true);
    for (const xa of RIG.trailerAxles) {
      const hanger: P2[] = [[xa + 64, BY], [xa + 36, BY], [xa + 43, 49], [xa + 57, 49]];
      p.poly(hanger, C.steel700).solid(hanger);
      const arm: P2[] = [[xa + 50, 58], [xa - 42, 62], [xa - 42, 54], [xa + 50, 51]];
      p.poly(arm, C.steel600).solid(arm);
      p.line([[xa + 50, 58], [xa - 42, 62]], 'rgba(255,255,255,.14)', 0.8);
      // Air spring: rubber bellows with rolled convolutions
      p.rr(xa - 54, xa - 24, 62, BY, 6, C.rubber2).solidRect(xa - 54, xa - 24, 62, BY, 6);
      p.rect(xa - 52, xa - 26, 69, 70.4, 'rgba(255,255,255,.1)').rect(xa - 52, xa - 26, 74, 75.4, 'rgba(255,255,255,.1)');
      p.rect(xa - 56, xa - 22, BY - 2.5, BY, C.steel600);
      // Shock absorber + brake chamber
      p.line([[xa + 20, 60], [xa + 34, BY]], C.steel500, 3).line([[xa + 20, 60], [xa + 27, 70]], C.steel300, 3.4);
      p.circ(xa + 50, 55, 3.4, C.steel500).circ(xa, WR, 9, C.steel600);
    }
    // ABS modulator, air tank, hoses
    p.rr(-770, -738, 64, BY, 2, C.steel700).solidRect(-770, -738, 64, BY, 2);
    p.line([[-754, 64], [-754, 58], [-800, 58]], C.hazard, 1.1, { opacity: 0.7 });
    p.line([[-770, 70], [-860, 72], [-1200, 72]], '#2B2F36', 1.3);
    // Manufacturer plate
    p.rr(-478, -432, 100, 112, 1.5, C.steel400);
    for (const y of [103.5, 106.5, 109.5]) p.rect(-474, -440, y, y + 1, C.steel600);
  }, { name: 'beam.o' });
  for (const s of [1, -1] as const) {
    sideFace(trBody, TR, TF, 76, DY, s * 40, s === 1 ? -1 : 1, (p) => beamWeb(p, false));
  }

  // --- gooseneck step face
  slopeFront(trBody, [GN0, GY], [GN1, BY], -50, 50, (p, L) => {
    p.rect(-50, 50, 0, L, K.frameLo).solidRect(-50, 50, 0, L);
    for (const z of [-30, -10, 10, 30]) p.rect(z, z + 2, 0, L, 'rgba(255,255,255,.05)');
  });

  // --- deck plan: centre strip between the beams
  planFace(trBody, TR, TF, -50, 50, DY, (p) => {
    p.rect(-60, 62, -40, 40, K.frameLo);
    for (let x = -52; x < 60; x += 14) p.circ(x, -34, 1.1, C.steel600).circ(x, 34, 1.1, C.steel600);
    p.circ(0, 0, 9, C.steel700).circ(0, 0, 5, K.void).circ(0, 0, 2.2, C.steel400);
    // Air + electric lines to the rear
    p.line([[76, -6], [-1150, -6]], C.hazard, 1.2).line([[76, -2], [-1150, -2]], C.signal, 1.2).line([[76, 3], [-1250, 3]], '#2B2F36', 1.4);
    for (const x of XM) p.rect(x - 3.5, x + 3.5, -40, 40, K.frame).rect(x - 3.5, x - 2, -40, 40, K.frameHi);
    for (const [a, b] of BOL) p.rect(a, b, -40, 40, K.frame).rect(a, a + 3, -40, 40, K.frameHi);
    p.rect(TR, TR + 16, -40, 40, K.frame);
    // Spare-wheel carrier
    for (const z of [-28, 24]) p.rect(-776, -664, z, z + 4, C.steel700);
    for (const s of [1, -1]) {
      p.rect(TR, TF, s * 40, s * 50, K.frameHi);
      p.rect(TR, TF, s * 49, s * 50, 'rgba(255,255,255,.14)');
    }
  }, { shade: 0, bias: -UNDER, name: 'deck.c' });
  // --- deck plan: outer strips (outriggers, side rails, twistlocks)
  for (const s of [1, -1] as const) {
    const [zlo, zhi] = zr(s, 50, 125);
    planFace(trBody, TR, TF, zlo, zhi, DY, (p) => {
      for (const x of OUTRIG) p.rect(x - 3, x + 3, s * 50, s * 119, K.frame).rect(x - 3, x - 1.6, s * 50, s * 119, K.frameHi);
      for (const [a, b] of BOL) p.rect(a, b, s * 50, s * 119, K.frame).rect(a, a + 3, s * 50, s * 119, K.frameHi);
      p.rect(TR, TR + 16, s * 50, s * 119, K.frame);
      p.rect(TR, GN0, s * 119, s * 125, K.frameHi).rect(TR, GN0, s * 124, s * 125, 'rgba(255,255,255,.16)');
      p.rect(56, 80, s * 119, s * 125, K.frameHi);
      for (const x of TWIST_X) {
        p.rect(x - 8, x + 8, s * (TWIST_Z - 7), s * (TWIST_Z + 7), C.steel600);
        p.rr(x - 5, x + 5, s * (TWIST_Z - 2.6), s * (TWIST_Z + 2.6), 2.4, C.steel200);
        p.rect(x - 1, x + 1, s * (TWIST_Z + 4), s * (TWIST_Z + 10), C.signal);
      }
      for (let x = -290; x > -1250; x -= 60) p.rect(x, x + 30, s * 123.4, s * 125, (Math.round(-x / 60) % 2) ? K.tapeRed : K.tapeWhite);
    }, { shade: 0, bias: -UNDER, name: 'deck.o' });
  }

  // --- side rails + lateral protection (double-sided so the far side reads too)
  sidePair(trBody, TR, TF, 28, DY, 125, (p) => {
    p.rect(TR, GN0, 118, DY, K.frameHi).solidRect(TR, GN0, 118, DY);
    p.rect(TR, GN0, DY - 1, DY, 'rgba(255,255,255,.16)').rect(TR, GN0, 118, 119, K.frameLo);
    // Contour marking along the rail
    tape(p, GN0 - 10, TR + 20, 120, 124);
    for (const [a, b] of BOL) {
      p.rect(a, b, 108, DY, K.frame).solidRect(a, b, 108, DY);
      p.rect(a, b, DY - 1, DY, 'rgba(255,255,255,.12)');
      const lx = (a + b) / 2;
      p.rect(lx - 1.5, lx + 1.5, 99, 110, C.steel400).solidRect(lx - 1.5, lx + 1.5, 99, 110);
      p.circ(lx, 99, 1.8, C.signal);
    }
    // Twistlock castings + levers at deck level
    for (const x of TWIST_X) {
      if (x > GN0 && x < 60) continue;
      p.rect(x - 8, x + 8, 121, DY, C.steel600).rect(x - 8, x + 8, DY - 1, DY, 'rgba(255,255,255,.25)');
      p.rr(x - 4, x + 4, 122.5, 126, 1, C.steel200);
      p.line([[x + 6, 123.5], [x + 14, 118]], C.signal, 1.6);
    }
    for (const x of OUTRIG) p.rect(x - 3, x + 3, 118, DY, K.frame);
    // Side marker lamps (LED amber)
    for (const x of [-300, -700, -1100]) {
      p.rr(x, x + 8, 111, 118, 1.2, K.trim).solidRect(x, x + 8, 111, 118, 1.2);
      p.rr(x + 1, x + 7, 112, 117, 1, K.amber).rect(x + 1.5, x + 6.5, 115, 116.4, K.amberHi);
    }
    // Lateral protection (aluminium rails on brackets)
    for (const [y0, y1] of [[58, 67], [86, 95]]) {
      p.rect(-826, -352, y0, y1, p.lin(0, y1, 0, y0, [[0, '#F0F2F4'], [0.4, '#C8CDD4'], [1, '#7A818D']])).solidRect(-826, -352, y0, y1);
      p.rect(-826, -352, y1 - 1, y1, '#FFFFFF');
    }
    for (const x of [-356, -590, -826]) {
      p.rect(x, x + 4, 56, 118, C.steel600).solidRect(x, x + 4, 56, 118);
      p.rect(x, x + 1, 56, 118, 'rgba(255,255,255,.2)');
    }
    p.rr(-800, -780, 88.5, 92.5, 1, C.signal);
    // Rear lamp bar + underride ends
    p.rr(TR, TR + 10, 82, 100, 1.5, K.trim).solidRect(TR, TR + 10, 82, 100, 1.5);
    p.rect(TR, TR + 2, 85, 97, K.red);
    p.rect(TR + 9, TR + 15, 44, 100, C.steel700).solidRect(TR + 9, TR + 15, 44, 100);
    p.rr(TR + 4, TR + 18, 40, 56, 1.5, C.steel400).solidRect(TR + 4, TR + 18, 40, 56, 1.5);
    p.rect(TR + 4, TR + 8, 40, 56, K.tapeRed);
  }, { double: true, name: 'trailer.side' });

  // --- front bolster + glad-hands
  frontFace(trBody, TF, -125, 125, 100, DY, (p) => {
    p.rect(-125, 125, GY, DY, K.frame).solidRect(-125, 125, GY, DY);
    p.rect(-125, 125, DY - 1.4, DY, 'rgba(255,255,255,.14)');
    for (const s of [1, -1]) p.rect(s * 40, s * 50, GY - 2, DY, K.frameHi).solidRect(s * 40, s * 50, GY - 2, DY);
    for (const s of [1, -1]) p.rr(s * 108, s * 122, 119, 125, 1.2, K.lamp).rect(s * 109, s * 121, 123.4, 124.4, '#fff');
    p.rr(-6, 32, 101, 116, 2, C.steel700).solidRect(-6, 32, 101, 116, 2);
    p.circ(2, 109, 4.2, C.signal).circ(12.5, 109, 4.2, C.hazard).circ(24, 109, 4.2, K.void).ring(24, 109, 4.2, C.steel500, 1);
    for (const z of [2, 12.5]) p.circ(z, 109, 1.5, 'rgba(0,0,0,.4)');
  }, { name: 'trailer.front' });

  // --- landing legs
  for (const s of [1, -1] as const) {
    const [zlo, zhi] = zr(s, 56, 68);
    sideFace(trBody, -420, -312, 14, 124, s * 68, s, (p) => {
      const brace: P2[] = [[-336, 60], [-336, 67], [-414, BY + 1], [-414, BY - 4]];
      p.poly(brace, C.steel600).solid(brace);
      p.rect(-342, -318, 116, 124, K.frame).solidRect(-342, -318, 116, 124);
      p.rect(-336, -324, 50, 118, C.steel700).solidRect(-336, -324, 50, 118);
      p.rect(-336, -334, 50, 118, 'rgba(255,255,255,.1)');
      p.rect(-334, -326, 24, 50, C.steel400).solidRect(-334, -326, 24, 50);
      p.rect(-334, -332.5, 24, 50, 'rgba(255,255,255,.3)');
      p.rr(-346, -314, 14, 24, 2, K.trim).solidRect(-346, -314, 14, 24, 2);
      p.rect(-344, -316, 22, 24, C.steel700);
      p.rr(-341, -319, 94, 108, 2, C.steel600).circ(-330, 101, 3, C.steel400);
      p.rect(-336, -324, 52, 56, C.hazard).rect(-336, -324, 60, 64, C.hazard);
      if (s === 1) {
        p.line([[-330, 101], [-330, 80], [-322, 80]], C.steel300, 2.6);
        p.rr(-324, -318, 72, 84, 2, C.signal);
        p.solid([[-332, 101], [-328, 101], [-328, 78], [-318, 78], [-318, 84], [-332, 84]]);
      }
    });
    frontFace(trBody, LEG_X + 6, zlo, zhi, 14, 124, (p) => {
      p.rect(zlo, zhi, 50, 118, C.steel700).rect(zlo + 2, zhi - 2, 24, 50, C.steel400).rr(zlo - 4, zhi + 4, 14, 24, 2, K.trim);
      p.rect(zlo - 6, zhi + 6, 116, 124, K.frame);
      p.solidRect(zlo, zhi, 24, 118).solidRect(zlo - 4, zhi + 4, 14, 24).solidRect(zlo - 6, zhi + 6, 116, 124);
    });
    rearFace(trBody, LEG_X - 6, zlo, zhi, 14, 124, (p) => {
      p.rect(zlo, zhi, 50, 118, C.steel700).rect(zlo + 2, zhi - 2, 24, 50, C.steel400).rr(zlo - 4, zhi + 4, 14, 24, 2, K.trim);
      p.rect(zlo - 6, zhi + 6, 116, 124, K.frame);
      p.solidRect(zlo, zhi, 24, 118).solidRect(zlo - 4, zhi + 4, 14, 24).solidRect(zlo - 6, zhi + 6, 116, 124);
    });
  }
  frontFace(trBody, LEG_X, -56, 56, 40, 106, (p) => {
    p.line([[-54, 44], [54, 90]], C.steel600, 3).line([[54, 44], [-54, 90]], C.steel600, 3);
    p.rect(-56, 56, 99, 103, C.steel500);
    p.solidRect(-56, 56, 99, 103);
  }, { double: true, shade: 0.5 });

  // --- mudguards over the tri-axle
  for (const s of [1, -1] as const) {
    const [zlo, zhi] = zr(s, 78, 116);
    sideFace(trBody, GUARD_X0, GUARD_X1, 26, 120, s * 116, s, (p) => {
      const pts: P2[] = [[GUARD_X1, 118], [GUARD_X0, 118], [GUARD_X0, 96]];
      const axles = [...RIG.trailerAxles].sort((a, b) => a - b);
      for (const xa of axles) {
        const dx = Math.sqrt(60 * 60 - 44 * 44);
        pts.push([xa - dx, 96], ...arcPts(xa, WR, 60, 180 - 47.2, 47.2, 10), [xa + dx, 96]);
      }
      pts.push([GUARD_X1, 96]);
      p.poly(pts, p.lin(0, 118, 0, 96, [[0, '#23262B'], [1, '#0B0C0F']])).solid(pts);
      p.rect(GUARD_X0, GUARD_X1, 116, 118, 'rgba(255,255,255,.12)');
      p.rect(GUARD_X0, GUARD_X0 + 5, 30, 96, C.rubber2).solidRect(GUARD_X0, GUARD_X0 + 5, 30, 96);
      p.rr(GUARD_X1 - 16, GUARD_X1 - 6, 104, 109, 1.2, K.amber);
      for (const xa of axles) p.line(arcPts(xa, WR, 61, 180 - 50, 50, 10), 'rgba(255,255,255,.1)', 1);
    }, { name: 'guard.side' });
    planFace(trBody, GUARD_X0, GUARD_X1, zlo, zhi, 118, (p) => {
      p.rect(GUARD_X0, GUARD_X1, zlo, zhi, '#121417').solidRect(GUARD_X0, GUARD_X1, zlo, zhi);
      for (let x = GUARD_X0 + 10; x < GUARD_X1; x += 12) p.rect(x, x + 1.4, zlo + 2, zhi - 2, 'rgba(255,255,255,.05)');
      p.rect(GUARD_X0, GUARD_X1, s > 0 ? zhi - 1.6 : zlo, s > 0 ? zhi : zlo + 1.6, 'rgba(255,255,255,.16)');
    });
    rearFace(trBody, GUARD_X0, zlo, zhi, 30, 118, (p) => {
      p.rr(zlo, zhi, 30, 118, 2, '#1D1F23').solidRect(zlo, zhi, 30, 118, 2);
      p.rect(zlo + 3, zhi - 3, 34, 38, C.steel400);
      for (let y = 44; y < 90; y += 5) p.rect(zlo + 4, zhi - 4, y, y + 1.8, 'rgba(255,255,255,.04)');
      p.rect(zlo, zhi, 96, 118, K.trim);
    });
  }

  // --- rear: light bar, plate, contour tape
  rearFace(trBody, TR, -125, 125, 78, DY, (p) => {
    p.rect(-125, 125, 118, DY, K.frame).solidRect(-125, 125, 118, DY);
    for (let z = -125, i = 0; z < 125; z += 25, i++) p.rect(z, z + 25, 120.5, 125.5, i % 2 ? K.tapeWhite : K.tapeRed);
    for (const s of [1, -1]) p.rect(s * 40, s * 50, 98, 118, K.frameLo).solidRect(s * 40, s * 50, 98, 118);
    p.rect(-125, 125, 88, 97, C.steel700).solidRect(-125, 125, 88, 97);
    for (const s of [1, -1]) {
      p.rr(s * 74, s * 123, 81, 103, 3, K.trim).solidRect(s * 74, s * 123, 81, 103, 3);
      // LED combination lamp: stop/tail, indicator, reverse, reflector triangle
      p.rr(s * 78, s * 98, 85, 99, 1.8, K.red).rect(s * 79, s * 97, 95.4, 96.8, 'rgba(255,255,255,.35)');
      for (let z = 80; z < 97; z += 4) p.circ(s * z, 89, 0.9, 'rgba(255,180,170,.6)');
      p.rr(s * 100, s * 108, 85, 99, 1.5, K.amber).rect(s * 101, s * 107, 95.4, 96.8, K.amberHi);
      p.rr(s * 110, s * 119, 85, 99, 1.5, K.lamp);
      p.poly([[s * 54, 86], [s * 70, 86], [s * 62, 99]], K.red).solid([[s * 54, 86], [s * 70, 86], [s * 62, 99]]);
      p.poly([[s * 57.5, 88], [s * 66.5, 88], [s * 62, 95.2]], '#8E1512');
    }
    p.rr(-26, 26, 84.5, 99.5, 1.5, '#EEF0F2').solidRect(-26, 26, 84.5, 99.5, 1.5);
    p.rect(-26, -21, 84.5, 99.5, '#1D3FA8');
    p.text(2, 89, 'NV 4011', 7.5, C.ink, { family: 'mono', 'font-weight': 600, 'letter-spacing': 0.8 });
  }, { name: 'trailer.rear' });
  rearFace(trBody, TR + 8, -112, 112, 38, 100, (p) => {
    for (const s of [1, -1]) p.rect(s * 66, s * 74, 54, 100, C.steel700).solidRect(s * 66, s * 74, 54, 100);
    p.rect(-112, 112, 40, 56, C.steel400).solidRect(-112, 112, 40, 56);
    for (let z = -112, i = 0; z < 112; z += 28, i++) p.rect(z, z + 28, 43, 53, i % 2 ? K.tapeWhite : K.tapeRed);
    p.rect(-112, 112, 54, 56, 'rgba(255,255,255,.3)');
  }, { name: 'underride' });

  // --- air reservoir between the beams (double so it reads from both sides)
  sideFace(trBody, -620, -430, 54, 82, 0, 1, (p) => {
    p.rr(-618, -452, 56, 80, 12, p.lin(0, 80, 0, 56, [[0, '#7A818D'], [0.3, '#A5ABB5'], [1, '#3B4049']])).solidRect(-618, -452, 56, 80, 12);
    for (const x of [-586, -490]) p.rect(x, x + 3, 54, 82, C.steel700);
    p.circ(-535, 55, 1.6, C.steel300);
  }, { double: true });

  // --- unsprung: axles in plan (beam, air springs, brake chambers, dampers)
  for (const xa of RIG.trailerAxles) {
    planFace(trailer, xa - 56, xa + 64, -82, 82, 64, (p) => {
      p.rect(xa - 5, xa + 5, -80, 80, C.steel600).rect(xa - 5, xa - 3, -80, 80, 'rgba(255,255,255,.18)');
      for (const s of [1, -1]) {
        p.rect(xa - 42, xa + 52, s * 44, s * 52, C.steel600);
        p.circ(xa - 38, s * 48, 12, C.rubber2).ring(xa - 38, s * 48, 8, 'rgba(255,255,255,.1)', 1);
        p.circ(xa + 14, s * 64, 7.5, C.steel500).circ(xa + 14, s * 64, 3.5, C.steel700).rect(xa + 5, xa + 14, s * 62.5, s * 65.5, C.steel600);
        p.rect(xa + 44, xa + 60, s * 42, s * 54, C.steel700);
      }
    }, { shade: 0 });
  }
}

/* ------------------------------------------------------------------------ */
/* Public API                                                                */
/* ------------------------------------------------------------------------ */

export interface RigPose {
  /** World position of the TRACTOR REAR-AXLE centre (ground). */
  x: number;
  z: number;
  /** Tractor yaw degrees (0 = faces +X; positive yaw turns toward −Z). */
  heading: number;
  /** Trailer yaw degrees (articulation = heading − trailerHeading). */
  trailerHeading: number;
  /** Odometer cm → wheel spin. */
  dist: number;
  /** Front-wheel steer degrees (positive = toward −Z, same sense as yaw). */
  steer: number;
  /** Suspension compression cm (sprung bodies drop, wheels stay on the ground). */
  bounce: number;
  /** Cab pitch degrees; positive = nose dips (braking). */
  nod: number;
  /**
   * Cab roll degrees on its mounts; positive leans toward +Z (the right-hand
   * side). Omit to derive a subtle lean from the articulation angle (the cab
   * leans out of the turn the trailer is following).
   */
  roll?: number;
  trailerVisible?: boolean;
}

export interface Rig {
  root: Node3;
  tractor: Node3;
  trailer: Node3;
  pose: RigPose;
  apply(): void;
  /** World frame for a container on the trailer: p = floor centre, yaw = container yaw (doors → trailer rear). */
  boxSeat(): { p: V3; yaw: number };
}

/** Cab lean per degree of articulation when `pose.roll` is not given. */
const ROLL_PER_ART = 0.045;
const ROLL_MAX = 1.8;

export function createRig(): Rig {
  const root = new Node3('rig');
  const tractor = root.node('tractor');
  const body = tractor.node('tractor.body');
  body.bias = UNDER;
  const cabPivot = body.node('cabPivot', [400, RIG.cabFloorY, 0]);
  cabPivot.bias = -UNDER;
  const cab = cabPivot.node('cab', [-400, -RIG.cabFloorY, 0]);
  buildCab(cab);
  buildChassis(body, tractor);

  const coil = body.node('coils', [280, 0, 0]);
  coil.bias = -UNDER;
  const coilA: V3 = [-1, 0, 0];
  buildCoils(coil, coilA);

  const tw = RIG.trackZ;
  const wheels: Node3[] = [];
  const fl = wheel(tractor, 'wheel.fl', [RIG.wheelbase, WR, -tw], 'steer', RIG.tyreW);
  const fr = wheel(tractor, 'wheel.fr', [RIG.wheelbase, WR, tw], 'steer', RIG.tyreW);
  fl.bias = fr.bias = UNDER;
  wheels.push(fl, fr);
  for (const s of [-1, 1]) {
    // Twin tyres on the drive axle: outer (deep-dish) + inner.
    const w = wheel(tractor, s < 0 ? 'wheel.rl' : 'wheel.rr', [0, WR, s * (tw + 3)], 'drive', RIG.tyreW);
    const wi = wheel(tractor, s < 0 ? 'wheel.rli' : 'wheel.rri', [0, WR, s * (tw - 30)], 'trailer', RIG.tyreW - 2);
    w.bias = UNDER;
    wi.bias = UNDER - 4;
    wheels.push(w, wi);
  }

  const trailer = root.node('trailer');
  trailer.bias = UNDER;
  const trBody = trailer.node('trailer.body');
  buildTrailer(trailer, trBody);
  RIG.trailerAxles.forEach((xa, i) => {
    for (const s of [1, -1]) {
      const w = wheel(trailer, `twheel.${i}.${s}`, [xa, WR, s * tw], 'trailer', RIG.tyreW + 4);
      w.bias = UNDER;
      wheels.push(w);
    }
  });
  const spare = wheel(trBody, 'spare', [-720, 64, 0], 'trailer', 28);
  spare.r.x = 90;
  spare.bias = UNDER;

  const pose: RigPose = { x: 0, z: 0, heading: 0, trailerHeading: 0, dist: 0, steer: 0, bounce: 0, nod: 0, trailerVisible: true };

  const kingpin = (): V3 => {
    const h = pose.heading * DEG;
    return [pose.x + RIG.kingpinX * Math.cos(h), 0, pose.z - RIG.kingpinX * Math.sin(h)];
  };

  const rig: Rig = {
    root,
    tractor,
    trailer,
    pose,
    apply() {
      const P = pose;
      tractor.p = [P.x, 0, P.z];
      tractor.r.y = P.heading;
      body.p = [0, -P.bounce, 0];
      cabPivot.r.z = -P.nod;
      let art = P.heading - P.trailerHeading;
      art = Math.atan2(Math.sin(art * DEG), Math.cos(art * DEG)) / DEG;
      const vis = P.trailerVisible ?? true;
      cabPivot.r.x = P.roll ?? (vis ? clamp(art * ROLL_PER_ART, -ROLL_MAX, ROLL_MAX) : 0);
      const spin = (P.dist / WR) * (180 / Math.PI);
      for (const w of wheels) w.spin = spin;
      fl.r.y = P.steer;
      fr.r.y = P.steer;
      trailer.p = kingpin();
      trailer.r.y = P.trailerHeading;
      trBody.p = [0, -P.bounce, 0];
      trailer.visible = vis;
      coil.visible = vis;
      // Aim + stretch the suzie coils at the trailer's glad-hands.
      const al = (P.heading - P.trailerHeading) * DEG;
      const dx = RIG.kingpinX + TF * Math.cos(al) - coil.p[0];
      const dz = TF * Math.sin(al);
      coil.r.y = Math.atan2(dz, -dx) / DEG;
      coilA[0] = -Math.hypot(dx, dz) / COIL_L;
    },
    boxSeat() {
      const k = kingpin();
      const t = pose.trailerHeading * DEG;
      return {
        p: [k[0] + RIG.boxX * Math.cos(t), RIG.deckY - pose.bounce, k[2] - RIG.boxX * Math.sin(t)],
        yaw: pose.trailerHeading + 180,
      };
    },
  };
  rig.apply();
  return rig;
}

/**
 * Integrate the trailer heading along a tractor path. The kingpin (not the
 * rear axle) drags the trailer: its path is derived from the tractor pose, and
 * each straight kingpin step is integrated exactly with the tractrix solution
 * tan(ψ/2)·e^(−d/L), ψ = trailer heading − kingpin travel direction, so the
 * table is stable for any ds and identical in both scroll directions.
 */
export function articulate(
  sample: (s: number) => { x: number; z: number; heading: number },
  length: number,
  ds = 10,
  initialTrailerHeading?: number,
): { s: number[]; trailer: number[] } {
  const L = RIG.trailerWB;
  const kp = (q: number): P2 => {
    const p = sample(q);
    const h = p.heading * DEG;
    return [p.x + RIG.kingpinX * Math.cos(h), p.z - RIG.kingpinX * Math.sin(h)];
  };
  const n = Math.max(1, Math.ceil(length / ds));
  const S: number[] = [0];
  let th = (initialTrailerHeading ?? sample(0).heading) * DEG;
  const T: number[] = [th / DEG];
  let prev = kp(0);
  let sPrev = 0;
  const SUB = 4;
  for (let i = 1; i <= n; i++) {
    const si = Math.min(length, i * ds);
    for (let j = 1; j <= SUB; j++) {
      const k = kp(sPrev + ((si - sPrev) * j) / SUB);
      const dx = k[0] - prev[0], dz = k[1] - prev[1];
      const d = Math.hypot(dx, dz);
      if (d > 1e-9) {
        const phi = Math.atan2(-dz, dx);
        let psi = th - phi;
        psi = Math.atan2(Math.sin(psi), Math.cos(psi));
        // ψ = ±π exactly would be a jack-knife singularity; nudge it.
        const tn = Math.tan(psi / 2);
        const psi1 = Number.isFinite(tn) ? 2 * Math.atan(tn * Math.exp(-d / L)) : psi;
        th += psi1 - psi;
      }
      prev = k;
    }
    sPrev = si;
    S.push(si);
    T.push(th / DEG);
  }
  return { s: S, trailer: T };
}

/** Linear lookup into an articulate() table. */
export function trailerHeadingAt(table: { s: number[]; trailer: number[] }, s: number): number {
  const { s: S, trailer: T } = table;
  if (s <= S[0]) return T[0];
  const n = S.length - 1;
  if (s >= S[n]) return T[n];
  let lo = 0, hi = n;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (S[m] <= s) lo = m;
    else hi = m;
  }
  const f = (s - S[lo]) / (S[hi] - S[lo] || 1);
  return T[lo] + (T[hi] - T[lo]) * f;
}

/* ------------------------------------------------------------------------ */
/* Lab                                                                       */
/* ------------------------------------------------------------------------ */

const CONTROLS = [
  { key: 'articulation', min: -60, max: 60, value: 0 },
  { key: 'steer', min: -35, max: 35, value: 0 },
  { key: 'dist', min: 0, max: 2000, value: 0 },
  { key: 'bounce', min: 0, max: 10, step: 0.1, value: 0 },
  { key: 'nod', min: -3, max: 3, step: 0.05, value: 0 },
];

function labBuild(withBox: boolean, trailerVisible = true) {
  const rig = createRig();
  const root = new Node3('rigLab');
  root.add(rig.root);
  const box = withBox ? root.add(container('box', LIVERY.hero)) : null;
  const pose = (v: Record<string, number>) => {
    const P = rig.pose;
    P.heading = 0;
    P.trailerHeading = P.heading - (v.articulation ?? 0);
    P.steer = v.steer ?? 0;
    P.dist = v.dist ?? 0;
    P.bounce = v.bounce ?? 0;
    P.nod = v.nod ?? 0;
    P.trailerVisible = trailerVisible;
    rig.apply();
    if (box) {
      const seat = rig.boxSeat();
      box.p = seat.p;
      box.r.y = seat.yaw;
    }
  };
  return { root, pose, frame: { tx: trailerVisible ? -400 : 200, ty: 200, tz: 0, zoom: trailerVisible ? 0.55 : 1.1 } };
}

export const labEntries: Record<string, LabEntry> = {
  rig: { title: 'Rig — tractor + skeletal trailer + hero box', build: () => labBuild(true), controls: CONTROLS },
  rigEmpty: { title: 'Rig — empty skeletal trailer', build: () => labBuild(false), controls: CONTROLS },
  rigTractor: { title: 'Rig — tractor only', build: () => labBuild(false, false), controls: CONTROLS },
};
