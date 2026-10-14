/**
 * NAVAIR container feeder.
 *
 * SHIP space: origin = hull centre at the WATERLINE, bow toward +X, beam
 * across Z (+Z = starboard, the quay side at the berth), Y up. Only the hull
 * above the waterline is modelled. The water itself (sea, wake, hull foam and
 * the hull's shadow on the water) is WebGL: see scene/oceanGL.ts.
 *
 *   LOA 17 000 · beam 2 500 · main deck y = 500 · forecastle deck y = 750
 *   hatch-cover top (container floor) y = 650
 *
 * HULL FORM: parallel middle body; a raked, flared bow (the side plating leans
 * outward toward the stem, so the waterline is finer than the deck and the
 * stem rakes forward) over a faint submerged bulb; a transom stern that is
 * curved in plan (five facets); a sheer line painted as the NAVAIR blue
 * stripe that rises toward both ends.
 *
 * Cargo: 7 bays of 40' boxes (long axis along X) × 8 rows. Every stack (one
 * bay/row column of 1–4 tiers) is drawn as ONE box whose side art paints its
 * stacked containers; each bay's two end walls are a single face with the
 * bay's skyline painted on it. Side walls are only emitted where a stack
 * stands taller than its neighbour, so hidden walls cost nothing. Boxes carry
 * slight tone/dirt variation, some are reefers (flat walls, machinery end)
 * and some 20' pairs; about a fifth are stowed doors-forward.
 *
 * Sun: the engine's light comes from −X / +Z / above, so hand-placed shadows
 * fall toward +X and −Z (port walkway, roofs beside taller stacks).
 *
 * HERO SLOT: bay 3 (x ≈ 850), row 4 (just starboard of the centreline),
 * tier 3 — the neighbours in rows 3 and 5 stand three high, the hero column
 * two high, so the empty slot reads as a gap in the top tier.
 */

import { Node3, box, prism } from '../engine/engine';
import { type V3, I3, add, apply, clamp, euler, mul, rng, scaleM } from '../engine/math';
import { circle, path, polyD, rect, rr, rrD, stroke, text } from '../engine/art';
import { mix, shade, tint } from '../engine/color';
import { BOX, C } from '../world';
import { LIVERY, container, containerTones } from './container';
import type { LabEntry } from './registry';

/* ------------------------------------------------------------------------ */
/* Dimensions                                                                */
/* ------------------------------------------------------------------------ */

const LOA = 17000;
const BEAM = 2500;
const HB = BEAM / 2;
const DECK_Y = 500;
const XS = -LOA / 2; // transom (aftmost point, centreline)
const XB = LOA / 2; // stem
const TR = 150; // transom curvature: the side plating ends this far forward of XS
const XT = XS + TR;
const FC_X = 6000; // forecastle break
const FC_Y = 750; // forecastle deck
const HATCH_Y = 650; // hatch-cover top = container floor
const YM = 1000; // hull-side art origin height (above the tallest bulwark)
const STERN_H = 610; // stern bulwark top

const CL = BOX.L, CW = BOX.W, CH = BOX.H;

const BAYS = 7;
const ROWS = 8;
const BAY_PITCH = 1400;
const BAY0 = -3350.4;
const ROW_PITCH = 249.8;
const ROW_HALF = ((ROWS - 1) / 2) * ROW_PITCH + CW / 2; // 996.2
const MAXT = [3, 4, 3, 3, 4, 3, 2];
const HERO_BAY = 3;
const HERO_ROW = 4;
const HERO_TIER = 2; // zero-based: the third tier
const xcOf = (k: number) => BAY0 + k * BAY_PITCH;
const zrOf = (r: number) => (r - (ROWS - 1) / 2) * ROW_PITCH;

/** Hero container floor-centre in ship space. */
const SLOT_LOCAL: V3 = [xcOf(HERO_BAY), HATCH_Y + HERO_TIER * CH, zrOf(HERO_ROW)];

/* ------------------------------------------------------------------------ */
/* Palette                                                                   */
/* ------------------------------------------------------------------------ */

const HULL = '#1A2231';
const HULL_HI = '#263144';
const BOOT = '#8A2A22';
const CAP = '#8995A3';
const RAIL = '#AFB7C0';
const INNER = '#56616E';
const DECK = '#2A3440';
const DECK2 = '#323E4B';
const HATCH = '#384654';
const WHITE = '#E8EBEE';
const TRIM = '#BEC5CD';
const GLASS = '#17212C';
const DOOR = '#98A2AD';
const MACH = '#6F7B87';
const ORANGE = '#EE631F';
const REEFER = '#E4E7E3';
const ROPE = '#BCA676';
const SHADOW = 'rgba(4,10,24,.3)';

/* ------------------------------------------------------------------------ */
/* Small helpers                                                             */
/* ------------------------------------------------------------------------ */

const f1 = (v: number) => Math.round(v * 10) / 10;
const f2 = (v: number) => Math.round(v * 100) / 100;
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
let UID = 0;
const uid = (p: string) => `nv${p}${++UID}`;
const ptsD = (p: [number, number][]) => 'M' + p.map((q) => `${f1(q[0])} ${f1(q[1])}`).join('L');
const circD = (x: number, y: number, r: number) =>
  `M${f1(x + r)} ${f1(y)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0Z`;
const rectD = (x: number, y: number, w: number, h: number) => `M${f1(x)} ${f1(y)}h${f1(w)}v${f1(h)}h${f1(-w)}Z`;

/** Vertical (objectBoundingBox) gradient: stops are [offset, colour, opacity]. */
const gradV = (id: string, stops: [number, string, number][]) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
/** Horizontal (objectBoundingBox) gradient. */
const gradH = (id: string, stops: [number, string, number][]) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;

/* ------------------------------------------------------------------------ */
/* Hull plan                                                                 */
/* ------------------------------------------------------------------------ */

function hwSmooth(x: number) {
  if (x <= -7200) {
    const u = clamp((x - XS) / (-7200 - XS), 0, 1);
    return HT0 + (HB - HT0) * (1 - (1 - u) * (1 - u));
  }
  if (x <= 4600) return HB;
  const s = clamp((x - 4600) / (XB - 4600), 0, 1);
  return s >= 1 ? 0 : HB * Math.pow(1 - Math.pow(s, 2.1), 0.72);
}
/** Transom half-width reference (the plan function's value at XS). */
const HT0 = 1000;

const PLAN_X = [XT, -8150, -7750, -7200, 4600, 5300, FC_X, 6550, 7000, 7400, 7750, 8030, 8250, 8410, XB];
const PLAN_Z = PLAN_X.map(hwSmooth);
const HW0 = PLAN_Z[0];

/** Transom plan, port → starboard: a parabola from (XT, −HW0) through (XS, 0) to (XT, +HW0), flat across the middle. */
const TPTS: [number, number][] = [-1, -0.6, -0.2, 0.2, 0.6, 1].map((t) => [XS + (TR * (t * t - 0.04)) / 0.96, t * HW0]);

/** Half-beam of the deck plan at x (follows the transom curve aft of XT). */
function hwP(x: number) {
  if (x < XT) return HW0 * Math.sqrt(clamp(((x - XS) / TR) * 0.96 + 0.04, 0, 1));
  for (let i = 0; i < PLAN_X.length - 1; i++) {
    if (x <= PLAN_X[i + 1]) {
      const t = (x - PLAN_X[i]) / (PLAN_X[i + 1] - PLAN_X[i]);
      return PLAN_Z[i] + (PLAN_Z[i + 1] - PLAN_Z[i]) * t;
    }
  }
  return 0;
}

/** Closed plan polygon for x ∈ [x0, x1] as [x, z] points (includes the transom curve when x0 ≤ XT). */
function planPoly(x0: number, x1: number): [number, number][] {
  const a = Math.max(x0, XT);
  const xs = [a, ...PLAN_X.filter((x) => x > a && x < x1), x1];
  const pts: [number, number][] = [...xs.map((x) => [x, hwP(x)] as [number, number]), ...xs.slice().reverse().map((x) => [x, -hwP(x)] as [number, number])];
  if (x0 <= XT) pts.push(...TPTS.slice(1, -1));
  return pts;
}

/** Top of the solid hull side (bulwark / sheer) at x. */
function solidTop(x: number) {
  if (x < -4450) return STERN_H;
  if (x < -4380) return STERN_H - (110 * (x + 4450)) / 70;
  if (x < 5800) return DECK_Y;
  return DECK_Y + (870 - DECK_Y) * smooth(5800, 6150, x) + 80 * Math.pow(clamp((x - 6000) / 2500, 0, 1), 2);
}

/** Sheer line: lower edge of the blue sheer stripe (22 high); lifts aft and sweeps up the forecastle to the bow. */
function sheerY(x: number) {
  return 440 + 60 * (1 - smooth(-5200, -3800, x)) + (x > 5700 ? Math.max(0, solidTop(x) - 92 - 440) : 0);
}

/** Stem rake at the waterline (cm the waterline tip sits aft of the stem head). */
const RAKE = 330;
/** Knuckle height: above it the bow bulwark is vertical, below it the plating tucks in (flare / stem rake). */
const KNUCKLE_Y = FC_Y;
/** 0 → 1 blend from the parallel body (x ≤ 5300) to the stem. */
const wFlare = (x: number) => smooth(5300, XB, x);

/** Waterline point under the bow plan vertex (x, ±hwP(x)): pulled aft (stem rake) and in (flare). */
function wlPoint(x: number, sgn: number): [number, number] {
  const w = wFlare(x);
  if (w <= 0) return [x, sgn * hwP(x)];
  const xb = x - RAKE * w;
  const s = clamp((xb - 4600) / (XB - RAKE - 4600), 0, 1);
  const hwWL = s >= 1 ? 0 : HB * Math.pow(1 - Math.pow(s, 2.1), 0.72);
  return [xb, sgn * (hwP(x) + (hwWL * (1 - 0.35 * w) - hwP(x)) * w)];
}

interface Seg {
  P: [number, number];
  Q: [number, number];
  len: number;
  S0: number;
  /** Waterline points under P and Q (equal to P / Q along the parallel body). */
  BP: [number, number];
  BQ: [number, number];
  flared: boolean;
}

function sideSegs(s: 1 | -1): Seg[] {
  const pts = PLAN_X.map((x, i) => [x, s * PLAN_Z[i]] as [number, number]);
  const ord = s > 0 ? pts : pts.slice().reverse();
  const out: Seg[] = [];
  let S = 0;
  for (let i = 0; i < ord.length - 1; i++) {
    const P = ord[i], Q = ord[i + 1];
    const len = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
    out.push({ P, Q, len, S0: S, BP: wlPoint(P[0], s), BQ: wlPoint(Q[0], s), flared: wFlare(P[0]) > 0 || wFlare(Q[0]) > 0 });
    S += len;
  }
  return out;
}

function sAtX(segs: Seg[], x: number) {
  for (const g of segs) {
    const a = Math.min(g.P[0], g.Q[0]), b = Math.max(g.P[0], g.Q[0]);
    if (x >= a && x <= b) return g.S0 + ((x - g.P[0]) / (g.Q[0] - g.P[0])) * g.len;
  }
  return 0;
}

/* ------------------------------------------------------------------------ */
/* Hull side art                                                             */
/* ------------------------------------------------------------------------ */

interface Item {
  a: number;
  b: number;
  svg: string;
}

const MARK = '#EDF1F4';

function draftMarks(S: number, V: (y: number) => number) {
  let s = '', d = '';
  for (let m = 1; m <= 4; m++) {
    s += text(S, V(100 * m - 12), `${8 + m}M`, 13, 'rgba(236,240,244,.85)', { family: 'mono', 'text-anchor': 'middle', 'font-weight': 600 });
    for (const k of [0.2, 0.4, 0.6, 0.8]) d += rectD(S - 7, V(100 * (m - 1) + 100 * k) - 1.5, 14, 3);
  }
  return s + path(d, 'rgba(236,240,244,.7)');
}

function sideItems(segs: Seg[]): Item[] {
  const it: Item[] = [];
  const at = (x: number, half: number, svg: (S: number) => string) => {
    const S = sAtX(segs, x);
    it.push({ a: S - half, b: S + half, svg: svg(S) });
  };
  const V = (y: number) => YM - y;
  // Plating butts (faint) and a few weathering streaks.
  for (let x = -8000; x <= 8000; x += 800) at(x, 2, (S) => rect(S - 1, 0, 2, YM - 105, `rgba(255,255,255,${x % 1600 === 0 ? 0.045 : 0.025})`));
  for (const x of [-7000, -2300, 1300, 3900, 5400]) at(x, 30, (S) => path(`M${f1(S - 14)} ${V(DECK_Y - 30)}h28l-9 260h-10Z`, 'rgba(0,0,0,.13)'));
  // Hull wordmark amidships-forward.
  at(2400, 1150, (S) =>
    text(S, V(150), 'NAVAIR', 360, 'rgba(240,243,246,.94)', { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 70 }),
  );
  // Ship's name + IMO number on the bow flare.
  at(6850, 820, (S) =>
    text(S, V(612), 'NAVAIR', 200, '#F1F3F5', { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 16 }) +
    text(S, V(522), 'IMO 9412137', 54, 'rgba(241,243,245,.72)', { 'text-anchor': 'middle', 'font-weight': 700, 'letter-spacing': 10 }),
  );
  // Draft marks: bow, midship, stern.
  for (const x of [8120, 0, -8250]) at(x, 40, (S) => draftMarks(S, V));
  // Load line mark.
  at(-400, 90, (S) => {
    let s = `<circle cx="${f1(S)}" cy="${V(150)}" r="30" fill="none" stroke="${MARK}" stroke-width="5"/>`;
    s += rect(S - 45, V(150) - 2.5, 90, 5, MARK);
    s += text(S - 42, V(186), 'L', 16, MARK, { 'font-weight': 700 }) + text(S + 30, V(186), 'R', 16, MARK, { 'font-weight': 700 });
    s += rect(S - 45, V(478), 90, 6, MARK);
    s += rect(S + 70, V(215), 4, 110, MARK);
    for (const y of [215, 185, 160, 130]) s += rect(S + 70, V(y), 30, 4, MARK);
    return s;
  });
  // Bow thruster symbol + tunnel grille just above the waterline.
  at(7640, 50, (S) =>
    `<circle cx="${f1(S)}" cy="${V(215)}" r="40" fill="none" stroke="${MARK}" stroke-width="6"/>` +
    stroke(`M${f1(S - 26)} ${V(215)}H${f1(S + 26)}M${f1(S - 26)} ${V(215)}l12 -10M${f1(S - 26)} ${V(215)}l12 10M${f1(S + 26)} ${V(215)}l-12 -10M${f1(S + 26)} ${V(215)}l-12 10`, MARK, 5),
  );
  at(7470, 90, (S) => `<ellipse cx="${f1(S)}" cy="${V(40)}" rx="82" ry="40" fill="#0A0E14"/>` + path(`M${f1(S - 70)} ${V(40)}h140M${f1(S)} ${V(78)}v76`, 'none', { stroke: '#3A4250', 'stroke-width': 8 }));
  // Bulbous-bow warning symbol.
  at(8230, 45, (S) =>
    stroke(`M${f1(S + 30)} ${V(250)}V${V(200)}Q${f1(S + 30)} ${V(170)} ${f1(S)} ${V(170)}Q${f1(S - 30)} ${V(170)} ${f1(S - 30)} ${V(200)}H${f1(S + 30)}`, MARK, 5),
  );
  // Anchor pocket with the stockless anchor stowed, plus the rust bleed below.
  at(7720, 140, (S) => {
    const v = V(700);
    return (
      path(`M${f1(S - 22)} ${v + 60}h44l-16 330h-12Z`, 'rgba(150,72,42,.34)') +
      path(`M${f1(S + 60)} ${v + 60}h14l-6 180h-4Z`, 'rgba(150,72,42,.2)') +
      rr(S - 118, v - 78, 236, 156, 50, '#3A4352') +
      rr(S - 108, v - 70, 216, 140, 44, '#070A0F') +
      rr(S - 96, v - 62, 192, 12, 6, 'rgba(255,255,255,.06)') +
      rr(S - 17, v - 60, 34, 92, 8, '#444C56') + rect(S - 12, v - 58, 8, 86, 'rgba(255,255,255,.14)') +
      path(`M${f1(S - 78)} ${v + 14}Q${f1(S)} ${v + 72} ${f1(S + 78)} ${v + 14}L${f1(S + 58)} ${v + 52}Q${f1(S)} ${v + 90} ${f1(S - 58)} ${v + 52}Z`, '#4E5661') +
      path(`M${f1(S - 70)} ${v + 20}Q${f1(S)} ${v + 66} ${f1(S + 70)} ${v + 20}l-4 8Q${f1(S)} ${v + 72} ${f1(S - 66)} ${v + 28}Z`, 'rgba(255,255,255,.14)')
    );
  });
  // Mooring fairleads through the bulwarks.
  for (const [x, y] of [[-8150, 560], [-7300, 560], [-6200, 560], [-5000, 560], [6250, 740], [7450, 740]] as const) {
    at(x, 60, (S) =>
      path(`M${f1(S - 6)} ${V(y) + 18}h12l-5 150h-2Z`, 'rgba(150,72,42,.25)') +
      `<ellipse cx="${f1(S)}" cy="${V(y)}" rx="40" ry="22" fill="#5A6470"/><ellipse cx="${f1(S)}" cy="${V(y)}" rx="30" ry="14" fill="#090C11"/>`,
    );
  }
  // Portholes along the aft accommodation / steering-gear flat.
  for (let x = -8020; x <= -4700; x += 230) {
    if ([-8150, -7300, -6200, -5000].some((f) => Math.abs(x - f) < 90)) continue;
    at(x, 22, (S) => circle(S, V(395), 19, '#5B6574') + circle(S, V(395), 13, '#0B1017') + circle(S - 4, V(399), 4, 'rgba(170,195,225,.55)'));
  }
  // Accommodation ladder stowed along the side, with its davit brackets.
  at(-3300, 560, (S) => {
    let rungs = '';
    for (let i = 0; i < 24; i++) rungs += rectD(S - 494 + i * 42, V(356), 5, 26);
    return (
      path(rectD(S - 420, V(318), 16, 30) + rectD(S - 8, V(318), 16, 30) + rectD(S + 404, V(318), 16, 30), '#4D5663') +
      rr(S - 520, V(372), 1040, 54, 10, '#6B7683') + rect(S - 510, V(372) + 5, 1020, 5, 'rgba(255,255,255,.28)') + path(rungs, '#3B434D')
    );
  });
  // Scuppers with faint streaks.
  for (let x = -4000; x <= 5400; x += 1400) {
    at(x, 12, (S) => rect(S - 8, V(478), 16, 8, '#0A0E14') + path(`M${f1(S - 4)} ${V(470)}h8l-3 140h-2Z`, 'rgba(0,0,0,.22)'));
  }
  return it;
}

type P2 = [number, number];

/** Sutherland–Hodgman: clip a polygon by a convex polygon (both [u, v], any consistent winding). */
function clipConvex(subject: P2[], clip: P2[]): P2[] {
  let area = 0;
  for (let i = 0; i < clip.length; i++) {
    const p = clip[i], q = clip[(i + 1) % clip.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  const sgn = area > 0 ? 1 : -1;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const A = clip[i], B = clip[(i + 1) % clip.length];
    const side = (p: P2) => sgn * ((B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]));
    const inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length];
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out;
}

const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl3 = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];

function sideFace(n: Node3, g: Seg, items: Item[]) {
  const { P, Q, len } = g;
  const dx = (Q[0] - P[0]) / len, dz = (Q[1] - P[1]) / len;
  const xAt = (u: number) => P[0] + (Q[0] - P[0]) * (u / len);
  const uAtX = (x: number) => ((x - P[0]) / (Q[0] - P[0])) * len;
  const us = new Set<number>([0, len]);
  const x0 = Math.min(P[0], Q[0]), x1 = Math.max(P[0], Q[0]);
  const step = x1 > 5700 ? 50 : 400;
  for (let u = 0; u < len; u += step) us.add(u);
  for (const bx of [-4450, -4380, 5800, 8150]) {
    const u = uAtX(bx);
    if (u > 0 && u < len) us.add(u);
  }
  const su = [...us].sort((a, b) => a - b);
  const top = su.map((u) => [u, YM - solidTop(xAt(u))] as P2);
  const olPts: P2[] = [...top, [len, YM], [0, YM]];
  const outline = polyD(olPts);
  const cid = uid('hc'), gid = uid('hg');
  const range = (xa: number, xb: number): [number, number] | null => {
    const lo = Math.max(xa, x0), hi = Math.min(xb, x1);
    if (hi <= lo) return null;
    const ua = uAtX(lo), ub = uAtX(hi);
    return [Math.max(0, Math.min(ua, ub)), Math.min(len, Math.max(ua, ub))];
  };

  let s = `<clipPath id="${cid}"><path d="${outline}"/></clipPath>`;
  s += gradV(gid, [[0.45, '#FFFFFF', 0.08], [0.62, '#FFFFFF', 0], [0.86, '#000000', 0.06], [1, '#000000', 0.22]]);
  s += path(outline, HULL);
  s += path(polyD([...top, ...top.slice().reverse().map(([u, v]) => [u, v + 30] as P2)]), HULL_HI);
  s += rect(0, YM - 262, len, 2, 'rgba(255,255,255,.035)') + rect(0, YM - 372, len, 2, 'rgba(255,255,255,.03)');
  // Sheer stripe.
  const sp = su.filter((u) => xAt(u) >= XT - 1 && xAt(u) <= 8150.5);
  if (sp.length > 1) {
    const hiE = sp.map((u) => [u, YM - sheerY(xAt(u)) - 22] as P2);
    const loE = sp.map((u) => [u, YM - sheerY(xAt(u))] as P2).reverse();
    s += path(polyD([...hiE, ...loE]), C.blue) + stroke(ptsD(hiE), 'rgba(255,255,255,.3)', 4);
  }
  // Boot-top (antifouling red), its highlight and the wet line.
  s += rect(0, YM - 105, len, 105, BOOT) + rect(0, YM - 30, len, 30, 'rgba(0,0,0,.32)') + rect(0, YM - 108, len, 3, 'rgba(255,255,255,.22)');
  const mine = items.filter((i) => i.b > g.S0 && i.a < g.S0 + len);
  s += `<g clip-path="url(#${cid})">` + rect(0, 0, len, YM, `url(#${gid})`);
  if (mine.length) s += `<g transform="translate(${f1(-g.S0)} 0)">${mine.map((i) => i.svg).join('')}</g>`;
  s += `</g>`;
  s += stroke(ptsD(top), CAP, 6);
  // Open railing where the side top is the bare deck edge.
  const rg = range(-4380, 5800);
  if (rg && rg[1] - rg[0] > 2) {
    const w = rg[1] - rg[0];
    let d = rectD(rg[0], YM - 600, w, 6) + rectD(rg[0], YM - 552, w, 4);
    const xa = Math.min(xAt(rg[0]), xAt(rg[1])), xb = Math.max(xAt(rg[0]), xAt(rg[1]));
    for (let x = Math.ceil(xa / 170) * 170; x <= xb; x += 170) d += rectD(uAtX(x) - 2.5, YM - 600, 5, 100);
    s += path(d, RAIL);
  }

  const vert = { a: [dx, 0, dz] as V3, b: [0, -1, 0] as V3, o: [P[0], YM, P[1]] as V3 };
  if (!g.flared) {
    n.face({ ...vert, w: len, h: YM, art: s, outline, name: 'hullSide' });
  } else {
    // Flared bow: vertical bulwark above the knuckle, and below it two planar
    // triangles down to a finer, raked waterline plan; neighbouring segments
    // share their corners exactly, so the flare is continuous.
    const v0 = YM - KNUCKLE_Y, y0 = KNUCKLE_Y;
    const clipped = (poly: P2[], grow: P2[]) => {
      const exact = clipConvex(olPts, poly);
      const loose = clipConvex(olPts, grow);
      if (exact.length < 3) return null;
      const id = uid('hk');
      return { outline: polyD(exact), art: `<clipPath id="${id}"><path d="${polyD(loose)}"/></clipPath><g clip-path="url(#${id})">${s}</g>` };
    };
    const BIG = 1e5;
    const up = clipped([[-BIG, -BIG], [BIG, -BIG], [BIG, v0], [-BIG, v0]], [[-BIG, -BIG], [BIG, -BIG], [BIG, v0 + 2], [-BIG, v0 + 2]]);
    if (up) n.face({ ...vert, w: len, h: YM, art: up.art, outline: up.outline, name: 'hullSide' });
    const W1: V3 = [P[0], y0, P[1]], W2: V3 = [Q[0], y0, Q[1]];
    const W3: V3 = [g.BP[0], 0, g.BP[1]];
    const W4: V3 = [g.BQ[0], 0, g.BQ[1]];
    {
      const a = scl3(sub3(W2, W1), 1 / len), b = scl3(sub3(W3, W1), 1 / y0);
      const t = clipped([[0, v0], [len, v0], [0, YM]], [[-2, v0 - 2], [len + 3, v0 - 2], [-2, YM + 2]]);
      if (t) n.face({ o: sub3(W1, scl3(b, v0)), a, b, w: len, h: YM, art: t.art, outline: t.outline, name: 'hullSide' });
    }
    {
      const a = scl3(sub3(W4, W3), 1 / len), b = scl3(sub3(W4, W2), 1 / y0);
      const t = clipped([[len, v0], [len, YM], [0, YM]], [[len + 2, v0 - 3], [len + 2, YM + 2], [-3, YM + 2]]);
      if (t) n.face({ o: sub3(sub3(W2, scl3(a, len)), scl3(b, v0)), a, b, w: len, h: YM, art: t.art, outline: t.outline, name: 'hullSide' });
    }
  }

  // Inner bulwark faces (forecastle and stern), so the far side reads from above.
  const fore = x0 >= FC_X - 1;
  const aft = x1 <= -7199;
  if (fore || aft) {
    const base = fore ? FC_Y : DECK_Y;
    const xr = (u: number) => Q[0] + (P[0] - Q[0]) * (u / len);
    const tp = su.map((u) => [u, YM - solidTop(xr(u))] as P2);
    const ol = polyD([...tp, [len, YM - base], [0, YM - base]]);
    let d = '';
    for (let u = 50; u < len - 20; u += 110) d += rectD(u, YM - solidTop(xr(u)) + 10, 7, solidTop(xr(u)) - base - 10);
    const art = path(ol, INNER) + path(d, 'rgba(0,0,0,.16)') + stroke(ptsD(tp), CAP, 12) + rect(0, YM - base - 14, len, 14, 'rgba(0,0,0,.2)');
    n.face({ o: [Q[0], YM, Q[1]], a: [-dx, 0, -dz], b: [0, -1, 0], w: len, h: YM, art, outline: ol });
  }
}

/** Transom art in arc-length coordinates (u across the curved stern, port → starboard as seen from astern). */
function transomArt(w: number) {
  const h = STERN_H;
  const V = (y: number) => h - y;
  const gid = uid('tg');
  let s = gradV(gid, [[0, '#FFFFFF', 0.08], [0.3, '#FFFFFF', 0], [0.8, '#000000', 0.08], [1, '#000000', 0.22]]);
  s += rect(0, 0, w, h, HULL);
  s += rect(0, 0, w, 30, HULL_HI) + rect(0, 0, w, 6, CAP);
  s += rect(0, V(sheerY(XS) + 22), w, 22, C.blue) + rect(0, V(sheerY(XS) + 22), w, 4, 'rgba(255,255,255,.3)');
  s += rect(0, V(105), w, 105, BOOT) + rect(0, h - 30, w, 30, 'rgba(0,0,0,.32)') + rect(0, V(105) - 3, w, 3, 'rgba(255,255,255,.22)');
  s += rect(0, 0, w, h, `url(#${gid})`);
  s += text(w / 2, V(262), 'NAVAIR', 168, '#F1F3F5', { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 14 });
  s += text(w / 2, V(186), 'ROTTERDAM', 56, 'rgba(241,243,245,.9)', { 'text-anchor': 'middle', 'font-weight': 600, 'letter-spacing': 16 });
  // Stern fairleads (Panama chocks) and the stern light.
  for (const u of [250, w - 250]) s += `<ellipse cx="${f1(u)}" cy="${V(580)}" rx="46" ry="17" fill="#5A6470"/><ellipse cx="${f1(u)}" cy="${V(580)}" rx="35" ry="10" fill="#090C11"/>` + path(`M${f1(u - 5)} ${V(560)}h10l-4 150h-2Z`, 'rgba(150,72,42,.22)');
  s += rr(w / 2 - 22, 12, 44, 18, 4, '#F4F1DA');
  // Rudder-stock hatch light and draft marks near the quarters.
  for (const u of [90, w - 90]) s += draftMarks(u, V);
  return s;
}

/* ------------------------------------------------------------------------ */
/* Decks                                                                     */
/* ------------------------------------------------------------------------ */

const bollards = (x: number, z: number, along = true) => {
  const dx = along ? 38 : 0, dz = along ? 0 : 38;
  return (
    path(rrD(x - dx - 34, z - dz - 34, 68 + 2 * dx, 68 + 2 * dz, 20), '#20262D') +
    circle(x - dx, z - dz, 22, '#11151A') + circle(x + dx, z + dz, 22, '#11151A') +
    circle(x - dx - 5, z - dz - 5, 8, '#4E5863') + circle(x + dx - 5, z + dz - 5, 8, '#4E5863')
  );
};
const coil = (x: number, z: number, r = 90) =>
  circle(x + 10, z - 12, r + 6, 'rgba(0,0,0,.25)') +
  `<g fill="none" stroke="${ROPE}" stroke-width="7">${[r, r * 0.78, r * 0.56, r * 0.34].map((q) => `<circle cx="${x}" cy="${z}" r="${f1(q)}"/>`).join('')}</g>` +
  circle(x, z, r * 0.18, '#1B2026');
/** Rope flaked on deck in long loops (mooring line ready to run). */
const flake = (x: number, z: number, len: number, loops: number, sg: number) => {
  let d = `M${x} ${z}`;
  for (let i = 0; i < loops; i++) {
    const zz = z + sg * i * 26;
    d += `L${x + len} ${zz}Q${x + len + 40} ${zz + sg * 13} ${x + len} ${zz + sg * 26}L${x} ${zz + sg * 26}`;
    if (i < loops - 1) d += `Q${x - 40} ${zz + sg * 39} ${x} ${zz + sg * 52}`;
  }
  return `<path d="${d}" fill="none" stroke="rgba(0,0,0,.3)" stroke-width="12" transform="translate(6 -6)"/><path d="${d}" fill="none" stroke="${ROPE}" stroke-width="8"/>`;
};

function mainDeckArt(poly: [number, number][], bays: Tier[][][]) {
  const d = polyD(poly);
  let s = path(d, DECK);
  // Deck plate butts (faint transverse seams).
  let seams = '';
  for (let x = -8000; x <= 5800; x += 600) seams += `M${x} ${f1(-hwP(x) + 20)}V${f1(hwP(x) - 20)}`;
  s += `<path d="${seams}" stroke="rgba(0,0,0,.14)" stroke-width="4" fill="none"/>`;
  // Walkways outboard of the hatch coamings (painted), with the yellow guide line.
  for (const sg of [1, -1]) {
    const pts: [number, number][] = [];
    for (let x = -4400; x <= 5950; x += 150) pts.push([x, sg * (hwP(x) - 36)]);
    const inner: [number, number][] = [[5950, sg * 1016], [-4400, sg * 1016]];
    s += path(polyD([...pts, ...inner]), DECK2);
    s += `<path d="M-4400 ${sg * 1022}H5760" stroke="${C.hazard}" stroke-opacity=".75" stroke-width="7" stroke-dasharray="70 45" fill="none"/>`;
    // Fire main with hydrants, vent heads and pipe brackets.
    const fm: [number, number][] = [];
    for (let x = -4300; x <= 5900; x += 150) fm.push([x, sg * Math.min(1182, hwP(x) - 70)]);
    s += stroke(ptsD(fm), '#8F3428', 12) + stroke(ptsD(fm.map(([x, z]) => [x, z - 3])), 'rgba(255,255,255,.2)', 3);
    let br = '';
    for (let x = -4200; x <= 5700; x += 450) br += rectD(x - 5, sg * 1182 - 14, 10, 28);
    s += path(br, '#5C2219');
    for (let x = -3700; x <= 5200; x += 2100) s += rect(x - 18, sg * 1182 - 12, 36, 24, '#B8412F');
    for (const x of [-3000, 1200, 4300]) s += bollards(x, sg * 1128);
    for (const x of [-1900, 2600]) s += circle(x, sg * 1110, 26, '#8C959F') + circle(x, sg * 1110, 12, '#59626B');
    // Aft mooring deck.
    s += bollards(-8180, sg * 780, false) + bollards(-7150, sg * 1080) + bollards(-6250, sg * 1110);
    s += rr(-8445, sg * 600 - 55, 50, 110, 12, '#737E89') + rr(-8436, sg * 600 - 40, 32, 80, 10, '#3A424B');
    s += coil(-7250, sg * 420) + coil(-8050, sg * 270, 70);
    s += flake(-7560, sg * 960, 420, 3, -sg);
    s += path(rrD(-7880, sg * 600 - 130, 360, 260, 10), '#1F262E');
    s += `<path d="M-7920 ${sg * 600 - 170}h440v340h-440Z" fill="none" stroke="${C.hazard}" stroke-opacity=".6" stroke-width="6" stroke-dasharray="40 30"/>`;
  }
  // Crossover between the house and the first hatch.
  s += rect(-4396, -1000, 10, 2000, C.hazard);
  s += rr(-4290, -560, 130, 130, 8, '#3A4550') + rr(-4290, 430, 130, 130, 8, '#3A4550');
  // Steering-gear hatch + emergency towing pack at the stern.
  s += rr(-8260, -100, 220, 200, 10, '#3A4450') + rect(-8250, -90, 200, 6, 'rgba(255,255,255,.12)');
  s += rr(-8420, -120, 70, 240, 10, '#C9A227') + rr(-8410, -105, 50, 210, 8, '#8E7418');

  // Hand-placed sun shadows (sun from −X/+Z): stacks over the port walkway, the coaming lip, the house.
  let sh = rectD(-4010 + 60, -1090, 9770 - 60, 80);
  for (let k = 0; k < BAYS; k++) {
    const t = Math.max(bays[k][0].length, bays[k][1].length * 0.9);
    if (t <= 0) continue;
    const a = xcOf(k) - CL / 2 + 20, b = xcOf(k) + CL / 2;
    sh += polyD([[a, -1010], [b, -1010], [b + 180, -1250], [a + 180, -1250]]);
  }
  sh += polyD([[-5800, -1000], [-4400, -1000], [-4220, -1250], [-5620, -1250]]);
  sh += polyD([[-6500, -450], [-5800, -450], [-5590, -740], [-6290, -740]]);
  s += path(sh, SHADOW);

  // Deck edge: dark rim, bulwark capping aft (round the transom), guard rail midships.
  s += `<path d="${d}" fill="none" stroke="#10151B" stroke-width="34" stroke-linejoin="round"/>`;
  const rim: [number, number][] = [];
  for (let x = -4420; x > XT; x -= 100) rim.push([x, hwP(x) - 16]);
  for (let j = TPTS.length - 1; j >= 0; j--) rim.push([TPTS[j][0] + 16, (TPTS[j][1] * (HW0 - 16)) / HW0]);
  for (let x = XT + 100; x <= -4420; x += 100) rim.push([x, -(hwP(x) - 16)]);
  s += stroke(ptsD(rim), '#7C8793', 14) + stroke(ptsD(rim.map(([x, z]) => [x, z * 0.994])), 'rgba(255,255,255,.2)', 3);
  for (const sg of [1, -1]) {
    const rl: [number, number][] = [];
    for (let x = -4420; x <= FC_X - 10; x += 150) rl.push([x, sg * (hwP(x) - 12)]);
    rl.push([FC_X - 10, sg * (hwP(FC_X - 10) - 12)]);
    s += stroke(ptsD(rl), RAIL, 6);
  }
  return s;
}

function forecastleArt(poly: [number, number][]) {
  const d = polyD(poly);
  let s = path(d, '#2D3844');
  let seams = '';
  for (let x = 6300; x <= 8100; x += 450) seams += `M${x} ${f1(-hwP(x) + 30)}V${f1(hwP(x) - 30)}`;
  s += `<path d="${seams}" stroke="rgba(0,0,0,.14)" stroke-width="4" fill="none"/>`;
  for (const sg of [1, -1]) {
    const hz = hwP(7780) - 150;
    // Anchor chains: gypsy → hawse pipe, and gypsy → spurling pipe.
    const chain = `M7150 ${sg * 430}L7780 ${sg * hz}M7150 ${sg * 430}L6880 ${sg * 430}`;
    s += `<path d="${chain}" stroke="#1D2025" stroke-width="30" fill="none"/>`;
    s += `<path d="${chain}" stroke="#6A717A" stroke-width="14" stroke-dasharray="20 12" fill="none"/>`;
    s += `<ellipse cx="7800" cy="${f1(sg * (hz + 12))}" rx="60" ry="46" fill="#0B0E12"/>` + circle(6860, sg * 430, 34, '#0B0E12');
    s += rr(7440, sg * (hz * 0.6 + 170) - 30, 80, 60, 10, '#C9A227');
    s += bollards(6450, sg * 920) + bollards(7500, sg * 180, false) + bollards(8000, sg * 330);
    s += rr(6330, sg * (hwP(6330) - 40) - 30, 110, 60, 14, '#737E89');
    s += coil(6700, sg * 700, 80);
    s += flake(6300, sg * 280, 320, 2, sg);
    const cap: [number, number][] = [];
    for (let x = FC_X + 20; x <= XB; x += 60) cap.push([x, sg * Math.max(0, hwP(x) - 16)]);
    s += stroke(ptsD(cap), '#8B96A2', 16);
  }
  // Forepeak hatch, bosun's store vent, bell.
  s += rr(6580, -80, 160, 160, 10, '#3A4550') + rect(6590, -70, 140, 8, 'rgba(255,255,255,.12)');
  s += circle(6420, 0, 34, '#8C959F') + circle(6420, 0, 16, '#4B535C');
  s += circle(8055, 0, 40, '#0F1318');
  // Breakwater shadow on the deck (sun from −X).
  s += path(polyD([[6680, 0], [6150, hwP(6150) - 70], [6260, hwP(6150) - 110], [6780, 10]]), SHADOW);
  s += `<path d="${d}" fill="none" stroke="#10151B" stroke-width="30" stroke-linejoin="round"/>`;
  s += stroke(`M${FC_X + 12} ${f1(-hwP(FC_X) + 20)}V${f1(hwP(FC_X) - 20)}`, RAIL, 6);
  return s;
}

/* ------------------------------------------------------------------------ */
/* Containers (stack art)                                                    */
/* ------------------------------------------------------------------------ */

interface Tier {
  /** Aft (or only) box colour. */
  c: string;
  /** Fore 20' box colour when the slot carries two 20' boxes. */
  c2?: string;
  /** Reefer: flat insulated walls, machinery end opposite the doors. */
  r?: boolean;
  /** Stowed doors-forward (doors on the +X end). */
  df?: boolean;
}

function castD(a: number, b: number, v0: number, h: number, cw = 17, chh = 12) {
  return rectD(a, v0, cw, chh) + rectD(b - cw, v0, cw, chh) + rectD(a, v0 + h - chh, cw, chh) + rectD(b - cw, v0 + h - chh, cw, chh);
}

/*
 * Corrugation is a per-face stripe <pattern> (translucent white/black bands
 * over the base colour) instead of dozens of vector flutes: one rect per
 * container wall, far cheaper to rasterise when hundreds of boxes repaint.
 */
function stripes(id: string, pitch: number, lw: number, dw: number, horizontal: boolean, lo = 0.17, dk = 0.2) {
  const L = 4000;
  const a = f1(pitch * 0.2), b = f1(pitch * 0.2 + lw + pitch * 0.12);
  const r = (o: number | string, w: number, fill: string, op: number) =>
    horizontal
      ? `<rect y="${o}" width="${L}" height="${w}" fill="${fill}" fill-opacity="${op}"/>`
      : `<rect x="${o}" width="${w}" height="${L}" fill="${fill}" fill-opacity="${op}"/>`;
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${horizontal ? L : pitch}" height="${horizontal ? pitch : L}">${r(a, lw, '#fff', lo)}${r(b, dw, '#000', dk)}</pattern>`;
}

/** Per-face accumulator: castings / door gear / seams / grime of every box share one path each. */
interface Acc {
  cast: string;
  bars: string;
  seam: string;
  /** Road grime / rust wash on the lower third of each wall. */
  dirt: string;
}
const newAcc = (): Acc => ({ cast: '', bars: '', seam: '', dirt: '' });
const grime = (acc: Acc, x: number, v0: number, w: number) => {
  acc.dirt += rectD(x, v0 + CH * 0.66, w, CH * 0.34 - 4);
};
/** Close a face's accumulators into paths (grime under the steel gear); empty ones cost nothing. */
const accArt = (acc: Acc) =>
  (acc.dirt ? path(acc.dirt, 'rgba(42,34,24,.13)') : '') + (acc.seam ? path(acc.seam, 'rgba(0,0,0,.13)') : '') +
  (acc.bars ? path(acc.bars, '#2E3136') : '') + path(acc.cast, '#1E2024');

/** One tier on a side wall at art row v0. foreRight: +X end is at the art's right. */
function tierSide(t: Tier, v0: number, foreRight: boolean, pid: string, acc: Acc) {
  const halves: [number, number, string][] = t.c2
    ? foreRight ? [[0, CL / 2, t.c], [CL / 2, CL, t.c2]] : [[0, CL / 2, t.c2], [CL / 2, CL, t.c]]
    : [[0, CL, t.c]];
  let s = '';
  for (const [a, b, col] of halves) {
    const k = containerTones(col);
    const w = b - a;
    s += rect(a, v0, w, CH, k.base);
    if (t.r) {
      // Reefer: smooth insulated panels with riveted butt seams.
      for (let u = a + 150; u < b - 60; u += 152) acc.seam += rectD(u, v0 + 14, 3, CH - 32);
      s += rect(a + 14, v0 + 13, w - 28, 12, 'rgba(255,255,255,.4)');
    } else s += rect(a + 14, v0 + 13, w - 28, CH - 30, `url(#${pid})`);
    s += path(rectD(a, v0, w, 12) + rectD(a, v0 + CH - 16, w, 16) + rectD(a, v0, 14, CH) + rectD(b - 14, v0, 14, CH), k.rail);
    grime(acc, a, v0, w);
    acc.cast += castD(a, b, v0, CH);
  }
  // Tier seam: the dark gap between stacked boxes.
  acc.cast += rectD(0, v0 + CH - 4, CL, 4);
  return s;
}

/**
 * occ: extra tiers of the +Z / −Z neighbours (cast sun shadow / contact AO on this roof).
 * aftOcc: extra tiers of the same row in the bay aft (its shadow reaches over the lashing bridge).
 */
function tierRoof(t: Tier, occ: [number, number], aftOcc: number, pid: string) {
  const halves: [number, number, string][] = t.c2 ? [[0, CL / 2, t.c], [CL / 2, CL, t.c2]] : [[0, CL, t.c]];
  let s = t.r ? '' : stripes(pid, 61, 20, 6, false, 0.2, 0.08), cast = '';
  for (const [a, b, col] of halves) {
    const k = containerTones(col);
    const w = b - a;
    s += rect(a, 0, w, CW, tint(col, 0.06));
    if (t.r) s += path(rectD(a + 30, 58, w - 60, 3) + rectD(a + 30, CW / 2 - 1.5, w - 60, 3) + rectD(a + 30, CW - 61, w - 60, 3), 'rgba(0,0,0,.09)');
    else s += rect(a + 14, 10, w - 28, CW - 20, `url(#${pid})`);
    s += path(rectD(a, 0, w, 9) + rectD(a, CW - 9, w, 9) + rectD(a, 0, 14, CW) + rectD(b - 14, 0, 14, CW), k.rail);
    cast += castD(a, b, 0, CW, 18, 16);
  }
  s += path(cast, '#2A2C30') + rect(0, CW - 3, CL, 3, 'rgba(0,0,0,.25)');
  if (occ[0] > 0) {
    const w = Math.min(CW, occ[0] * CH * 0.52);
    s += rect(0, CW - w, CL, w, 'rgba(4,8,20,.34)') + rect(0, CW - 16, CL, 16, 'rgba(0,0,0,.2)');
  }
  if (occ[1] > 0) s += rect(0, 0, CL, 26, 'rgba(0,0,0,.14)') + rect(0, 0, CL, 11, 'rgba(0,0,0,.18)');
  const L = aftOcc * CH * 0.38 - (BAY_PITCH - CL);
  if (L > 0) s += rect(0, 0, Math.min(CL, L), CW, 'rgba(4,8,20,.3)');
  return s;
}

const endFrame = (u0: number, v0: number) => rectD(u0, v0, CW, 22) + rectD(u0, v0 + CH - 20, CW, 20) + rectD(u0, v0, 12, CH) + rectD(u0 + CW - 12, v0, 12, CH);

/** Front (blind) end wall, or a reefer's machinery end. */
function endFront(col: string, u0: number, v0: number, pid: string, acc: Acc, reefer = false) {
  const k = containerTones(col);
  let s = rect(u0, v0, CW, CH, k.base);
  if (reefer) {
    s += rr(u0 + 16, v0 + 26, CW - 32, CH - 52, 6, '#A9B0B7') + rr(u0 + 22, v0 + 32, 100, 150, 4, '#6B737C');
    for (let i = 0; i < 9; i++) acc.bars += rectD(u0 + 28, v0 + 40 + i * 15, 88, 6);
    s += circle(u0 + 176, v0 + 92, 42, '#3F464E') + circle(u0 + 176, v0 + 92, 30, '#2A3037') + circle(u0 + 176, v0 + 92, 8, '#8C949C');
    s += rr(u0 + 136, v0 + 164, 84, 70, 4, '#DADEE2') + rect(u0 + 146, v0 + 176, 40, 14, '#27303A') + circle(u0 + 204, v0 + 212, 7, '#3BB26A');
    s += rr(u0 + 28, v0 + 196, 94, 48, 4, '#8C949C');
  } else s += rect(u0 + 12, v0 + 22, CW - 24, CH - 42, `url(#${pid})`);
  s += path(endFrame(u0, v0), k.rail);
  grime(acc, u0, v0, CW);
  acc.cast += castD(u0, u0 + CW, v0, CH) + rectD(u0, v0 + CH - 4, CW, 4);
  return s;
}

function endDoors(col: string, u0: number, v0: number, pid: string, acc: Acc) {
  const k = containerTones(col);
  acc.bars += rectD(u0 + CW / 2 - 1.5, v0 + 22, 3, CH - 42);
  for (const bx of [30, 78, CW - 78, CW - 30]) {
    acc.bars += rectD(u0 + bx - 2.6, v0 + 18, 5.2, CH - 34) + rectD(u0 + bx - 3, v0 + CH / 2 + 10, 6, 34) + rectD(u0 + bx - 6, v0 + 14, 12, 12) + rectD(u0 + bx - 6, v0 + CH - 26, 12, 12);
  }
  for (const hy of [44, CH / 2, CH - 50]) acc.bars += rectD(u0 + 12, v0 + hy, 12, 16) + rectD(u0 + CW - 24, v0 + hy, 12, 16);
  let s = rect(u0, v0, CW, CH, k.base) + rect(u0 + 12, v0 + 22, CW - 24, CH - 42, `url(#${pid})`);
  s += path(endFrame(u0, v0), k.rail);
  grime(acc, u0, v0, CW);
  acc.cast += castD(u0, u0 + CW, v0, CH) + rectD(u0, v0 + CH - 4, CW, 4);
  return s;
}

const PAL: [string, number][] = [
  [C.boxNavy, 3], [C.boxOrange, 2], [C.boxRed, 2], [C.boxGreen, 1.4], [C.boxSky, 2.2],
  [C.boxPink, 1], [C.boxMustard, 1.4], [C.boxWhite, 1.2], [C.boxGrey, 2],
];

function planCargo(): Tier[][][] {
  const R = rng(0x5eed17);
  const tot = PAL.reduce((a, p) => a + p[1], 0);
  const pick = () => {
    let v = R() * tot;
    for (const [c, w] of PAL) if ((v -= w) <= 0) return c;
    return PAL[0][0];
  };
  const bays: Tier[][][] = [];
  for (let k = 0; k < BAYS; k++) {
    const rows: Tier[][] = [];
    for (let r = 0; r < ROWS; r++) {
      let T = MAXT[k] - (R() < 0.38 ? 1 : 0) - (R() < 0.12 ? 1 : 0);
      if ((r === 0 || r === ROWS - 1) && R() < 0.3) T -= 1;
      if (R() < 0.035) T = 0;
      T = Math.max(0, T);
      const st: Tier[] = [];
      for (let t = 0; t < T; t++) st.push(R() < 0.14 ? { c: pick(), c2: pick() } : { c: pick() });
      rows.push(st);
    }
    bays.push(rows);
  }
  // Hero slot: a two-high column between two three-high neighbours.
  const hb = bays[HERO_BAY];
  const fill = (r: number, n: number, top: string) => {
    while (hb[r].length < n) hb[r].push({ c: pick() });
    hb[r].length = n;
    hb[r][n - 1] = { c: top };
  };
  fill(HERO_ROW - 1, 3, C.boxNavy);
  fill(HERO_ROW + 1, 3, C.boxOrange);
  fill(HERO_ROW, 2, C.boxGrey);
  // Second pass (own RNG, so the stowage above never changes): reefers, weathering, door direction.
  const R2 = rng(0x7eefe7);
  const jit = (c: string) => mix(mix(c, R2() < 0.5 ? '#000000' : '#FFFFFF', R2() * 0.07), '#6E604C', R2() * 0.09);
  for (let k = 0; k < BAYS; k++) {
    for (let r = 0; r < ROWS; r++) {
      const keep = k === HERO_BAY && Math.abs(r - HERO_ROW) <= 1;
      for (const t of bays[k][r]) {
        const reefer = R2() < 0.085;
        const df = R2() < 0.22;
        if (keep) continue;
        if (reefer && !t.c2) {
          t.c = REEFER;
          t.r = true;
        }
        t.c = jit(t.c);
        if (t.c2) t.c2 = jit(t.c2);
        t.df = df;
      }
    }
  }
  return bays;
}

function buildCargo(n: Node3, bays: Tier[][][]) {
  for (let k = 0; k < BAYS; k++) {
    const xc = xcOf(k), x0 = xc - CL / 2;
    const rows = bays[k];
    const T = (r: number) => (r < 0 || r >= ROWS ? 0 : rows[r].length);
    for (let r = 0; r < ROWS; r++) {
      const st = rows[r], t = st.length;
      if (!t) continue;
      const z0 = zrOf(r) - CW / 2;
      const tp = T(r + 1), tn = T(r - 1);
      const aft = k > 0 ? bays[k - 1][r].length : 0;
      box(n, x0, HATCH_Y, z0, CL, t * CH, CW, { py: tierRoof(st[t - 1], [tp - t, tn - t], aft - t, uid('fl')) }, { name: 'stack' });
      for (const [side, nb] of [[1, tp], [-1, tn]] as const) {
        if (t <= nb) continue;
        const pid = uid('fl');
        let a = stripes(pid, 54.8, 18, 8, false);
        const acc = newAcc();
        for (let i = t - 1; i >= nb; i--) a += tierSide(st[i], (t - 1 - i) * CH, side > 0, pid, acc);
        a += accArt(acc);
        // Contact shade where the exposed wall meets the neighbour's roof.
        if (nb > 0) a += rect(0, (t - nb) * CH - 30, CL, 30, 'rgba(0,0,0,.14)');
        box(n, x0, HATCH_Y + nb * CH, z0, CL, (t - nb) * CH, CW, side > 0 ? { pz: a } : { nz: a }, { name: 'stack' });
      }
    }
    // Bay end walls: one face per end carrying every column's skyline.
    const mt = Math.max(...rows.map((s) => s.length));
    if (!mt) continue;
    const h = mt * CH;
    const fid = uid('fl'), nid = uid('fl');
    let fa = stripes(fid, 40, 12, 5, true), na = stripes(nid, 40, 12, 5, true), fo = '', no = '';
    const accF = newAcc(), accN = newAcc();
    for (let r = 0; r < ROWS; r++) {
      const st = rows[r];
      if (!st.length) continue;
      const uf = ROW_HALF - (zrOf(r) + CW / 2);
      const un = zrOf(r) - CW / 2 + ROW_HALF;
      for (let i = 0; i < st.length; i++) {
        const v0 = h - (i + 1) * CH;
        const tt = st[i];
        const cf = tt.c2 ?? tt.c;
        fa += tt.df ? endDoors(cf, uf, v0, fid, accF) : endFront(cf, uf, v0, fid, accF, !!tt.r);
        na += tt.df ? endFront(tt.c, un, v0, nid, accN, !!tt.r) : endDoors(tt.c, un, v0, nid, accN);
      }
      fo += rectD(uf, h - st.length * CH, CW, st.length * CH);
      no += rectD(un, h - st.length * CH, CW, st.length * CH);
    }
    fa += accArt(accF);
    na += accArt(accN);
    n.face({ o: [xc + CL / 2, HATCH_Y + h, ROW_HALF], a: [0, 0, -1], b: [0, -1, 0], w: 2 * ROW_HALF, h, art: fa, outline: fo, bias: -250, name: 'bayEnd' });
    n.face({ o: [x0, HATCH_Y + h, -ROW_HALF], a: [0, 0, 1], b: [0, -1, 0], w: 2 * ROW_HALF, h, art: na, outline: no, bias: -250, name: 'bayEnd' });
  }
}

function coamingArt() {
  const X0 = -4010, Z0 = -1010;
  let s = rect(0, 0, 9770, 2020, '#232C36');
  let pan = '', rim = '', joint = '', sock = '', cleat = '', rib = '';
  for (let k = 0; k < BAYS; k++) {
    const xc = xcOf(k) - X0;
    for (const [za, zb] of [[-1000, -5], [5, 1000]]) {
      const x = xc - 655, y = za - Z0, w = 1310, h = zb - za;
      rim += rectD(x, y, w, h);
      pan += rectD(x + 12, y + 12, w - 24, h - 24);
      joint += rectD(xc - 3, y + 12, 6, h - 24);
      for (let v = y + 110; v < y + h - 60; v += 125) rib += rectD(x + 24, v, w - 48, 4);
      for (let u = x + 60; u < x + w - 40; u += 300) cleat += rectD(u, y + 2, 26, 12) + rectD(u, y + h - 14, 26, 12);
    }
    for (let r = 0; r < ROWS; r++) {
      for (const zz of [zrOf(r) - CW / 2 + 4, zrOf(r) + CW / 2 - 22]) {
        for (const xx of [xc - CL / 2 + 4, xc + CL / 2 - 22]) sock += rectD(xx, zz - Z0, 18, 18);
      }
    }
  }
  s += path(rim, '#465563') + path(pan, HATCH) + path(rib, 'rgba(255,255,255,.05)') + path(joint, 'rgba(0,0,0,.28)') + path(cleat, '#1A2027') + path(sock, '#15191E');
  s += rect(0, 0, 9770, 8, 'rgba(255,255,255,.08)');
  return s;
}

function coamingSide(w: number, brackets: boolean) {
  let s = rect(0, 0, w, 150, '#344150') + rect(0, 0, w, 12, '#4A5968') + rect(0, 140, w, 10, 'rgba(0,0,0,.25)');
  if (brackets) {
    let d = '';
    for (let u = 120; u < w - 60; u += 350) d += `M${u} 12L${u + 40} 12L${u + 40} 150L${u - 40} 150Z`;
    s += path(d, '#3E4C5B');
  }
  return s;
}

function lashBridge(n: Node3, gx: number) {
  // Top: grating walkway with yellow handrails, floodlights at both ends.
  let gr = '';
  for (let v = 6; v < 2000; v += 14) gr += `M0 ${v}h140`;
  let st = '';
  for (let r = 0; r <= ROWS; r++) {
    const v = 1000 + (r - ROWS / 2) * ROW_PITCH;
    st += rectD(2, v - 6, 14, 12) + rectD(124, v - 6, 14, 12);
  }
  const lamp = (v: number) => rr(40, v - 22, 60, 44, 8, '#2B3138') + rr(48, v - 15, 44, 30, 6, '#FFF2C2') + rect(52, v - 12, 36, 6, 'rgba(255,255,255,.7)');
  const top =
    rect(0, 0, 140, 2000, '#3A4149') +
    `<path d="${gr}" stroke="rgba(0,0,0,.35)" stroke-width="4" fill="none"/>` +
    rect(4, 0, 8, 2000, '#D9A922') + rect(128, 0, 8, 2000, '#D9A922') + path(st, '#7E6512') +
    lamp(60) + lamp(1940);
  // Sides: open truss with cell-guide posts and lashing rods.
  const truss = (w: number) => {
    let posts = '', brace = '';
    for (let r = 0; r <= ROWS; r++) {
      const u = 1000 + (r - ROWS / 2) * ROW_PITCH;
      posts += rectD(u - 9, 0, 18, 300);
      if (r < ROWS) brace += `M${f1(u)} 150L${f1(u + ROW_PITCH)} 290M${f1(u)} 150L${f1(u + ROW_PITCH)} 20`;
    }
    let rods = '';
    for (let u = 60; u < w; u += 250) for (let j = 0; j < 4; j++) rods += `M${u + j * 9} 26V250`;
    return (
      `<path d="${rods}" stroke="#9AA3AD" stroke-width="3" fill="none"/>` +
      `<path d="${brace}" stroke="#57616B" stroke-width="10" fill="none"/>` +
      path(posts, '#636D77') +
      rect(0, 0, w, 20, '#4A525B') + rect(0, 0, w, 5, '#D9A922') + rect(0, 142, w, 14, '#5A646E')
    );
  };
  const end = rect(0, 0, 18, 300, '#636D77') + rect(122, 0, 18, 300, '#636D77') + path([...Array(9)].map((_, i) => rectD(18, 20 + i * 32, 104, 5)).join(''), '#8D96A0') + rect(0, 0, 140, 20, '#4A525B');
  box(n, gx - 70, HATCH_Y, -1000, 140, 300, 2000, { py: top, px: truss(2000), nx: truss(2000), pz: end, nz: end }, { shades: { px: 0, nx: 0, pz: 0, nz: 0 } });
}

/* ------------------------------------------------------------------------ */
/* Superstructure                                                            */
/* ------------------------------------------------------------------------ */

function houseWall(
  w: number,
  decks: number,
  o: { win?: [number, number, number]; doors?: number[]; skip?: [number, number, number][]; dh?: number } = {},
) {
  const dh = o.dh ?? 280;
  const h = decks * dh;
  const [ww, wh, pitch] = o.win ?? [92, 72, 185];
  let s = rect(0, 0, w, h, WHITE);
  let gl = '', sky = '', fr = '', glint = '', tr = '', sh = '';
  for (let i = 0; i < decks; i++) {
    const y0 = i * dh;
    tr += rectD(0, y0 + dh - 10, w, 10);
    sh += rectD(0, y0, w, 16);
    const n = Math.floor((w - 80) / pitch);
    if (n < 1) continue;
    const x0 = (w - (n - 1) * pitch - ww) / 2;
    for (let j = 0; j < n; j++) {
      const x = x0 + j * pitch;
      if (o.skip?.some(([d, a, b]) => d === i && x + ww > a && x < b)) continue;
      if (i === decks - 1 && o.doors?.some((d) => x + ww > d - 24 && x < d + 108)) continue;
      const y = y0 + dh * 0.34;
      fr += rrD(x - 6, y - 6, ww + 12, wh + 12, 10);
      gl += rrD(x, y, ww, wh, 6);
      sky += rrD(x, y, ww, wh * 0.42, [6, 6, 0, 0]);
      glint += `M${f1(x + ww * 0.55)} ${f1(y)}h${f1(ww * 0.2)}l${f1(-ww * 0.35)} ${f1(wh)}h${f1(-ww * 0.2)}Z`;
    }
  }
  s += path(sh, 'rgba(0,0,0,.05)') + path(tr, TRIM) + path(fr, '#C6CDD5') + path(gl, GLASS) + path(sky, 'rgba(118,150,192,.42)') + path(glint, 'rgba(215,228,245,.16)');
  for (const d of o.doors ?? []) s += rr(d, h - 226, 84, 214, 6, DOOR) + rr(d + 10, h - 214, 64, 70, 4, GLASS) + rect(d + 10, h - 214, 64, 26, 'rgba(118,150,192,.4)') + rect(d + 66, h - 120, 10, 22, '#4B535C');
  s += rect(0, 0, w, 8, 'rgba(255,255,255,.4)') + rect(0, h - 16, w, 16, 'rgba(0,0,0,.08)');
  return s;
}

function bridgeFront(w: number, h: number) {
  let s = rect(0, 0, w, h, WHITE) + rect(0, 0, w, 26, '#CBD1D8') + rect(0, 26, w, 16, '#28303A');
  const gy = 50, gh = 150;
  const gid = uid('bg');
  s += gradV(gid, [[0, '#6F8CB0', 0.55], [0.45, '#2B3A4C', 0.2], [1, '#000000', 0]]);
  s += rect(30, gy, w - 60, gh, GLASS) + rect(30, gy, w - 60, gh, `url(#${gid})`);
  s += path(`M30 ${gy}h${f1((w - 60) * 0.3)}l-200 ${gh}H30Z`, 'rgba(150,178,210,.16)');
  s += path(`M${f1(w * 0.62)} ${gy}h120l-120 ${gh}h-60Z`, 'rgba(170,195,225,.18)');
  let m = '';
  const nW = Math.round((w - 60) / 170), pw = (w - 60) / nW;
  for (let i = 1; i < nW; i++) m += rectD(30 + i * pw - 5, gy, 10, gh);
  s += path(m, '#DDE1E5') + rect(30, gy + gh, w - 60, 10, '#C3C9D0') + rect(0, h - 12, w, 12, TRIM);
  return s;
}

function wingEnd(w: number, h: number) {
  return rect(0, 0, w, h, WHITE) + rect(0, 0, w, 26, '#CBD1D8') + rect(0, 26, w, 16, '#28303A') +
    rect(40, 50, 250, 150, GLASS) + rect(160, 50, 10, 150, '#DDE1E5') + path(`M40 50h110l-80 150h-30Z`, 'rgba(118,150,192,.34)') +
    rr(w - 150, 56, 96, 214, 6, DOOR) + rr(w - 140, 66, 76, 80, 4, GLASS) +
    rect(0, h - 12, w, 12, TRIM);
}

function roofBase(w: number, h: number, fill = '#C7CED5') {
  return rect(0, 0, w, h, fill) + path(rectD(0, 0, w, 14) + rectD(0, h - 14, w, 14) + rectD(0, 0, 14, h) + rectD(w - 14, 0, 14, h), '#A3ACB6') +
    `<path d="${rectD(34, 34, w - 68, h - 68)}" fill="none" stroke="rgba(0,0,0,.16)" stroke-width="4"/>` +
    `<path d="${rectD(28, 28, w - 56, h - 56)}" fill="none" stroke="#F3F5F7" stroke-width="5"/>`;
}

const raft = (x: number, y: number, vert = false) =>
  vert
    ? rr(x - 28, y - 60, 56, 120, 26, '#F2F3F4') + rect(x - 28, y - 30, 56, 7, '#5C6670') + rect(x - 28, y + 23, 56, 7, '#5C6670')
    : rr(x - 60, y - 28, 120, 56, 26, '#F2F3F4') + rect(x - 30, y - 28, 7, 56, '#5C6670') + rect(x + 23, y - 28, 7, 56, '#5C6670');

const acUnit = (x: number, y: number) =>
  rr(x + 10, y + 10, 150, 100, 8, 'rgba(0,0,0,.18)') +
  rr(x, y, 150, 100, 8, '#9BA5AF') + circle(x + 42, y + 50, 32, '#39414A') + circle(x + 108, y + 50, 32, '#39414A') +
  circle(x + 42, y + 50, 8, '#8A939D') + circle(x + 108, y + 50, 8, '#8A939D');

const vent = (x: number, y: number, r = 26) => circle(x + 8, y + 8, r, 'rgba(0,0,0,.2)') + circle(x, y, r, '#E4E8EC') + circle(x, y, r * 0.55, '#A9B2BC');

/** External stair between decks, seen from above (treads). */
function stair(x: number, y: number, w: number, h: number) {
  let d = '';
  for (let u = 8; u < w - 4; u += 22) d += rectD(x + u, y + 6, 8, h - 12);
  return rect(x, y, w, h, '#7F8994') + path(d, '#C3CAD1') + rect(x, y, w, 5, '#E9ECEF') + rect(x, y + h - 5, w, 5, '#E9ECEF');
}

function machineBox(n: Node3, x: number, y: number, z: number, sx: number, sy: number, sz: number, drum: 'x' | 'z') {
  const body = MACH, dk = shade(MACH, 0.35);
  const rope = (w: number, h: number) => {
    let d = '';
    for (let v = 6; v < h - 4; v += 12) d += `M0 ${v}h${w}`;
    return rect(0, 0, w, h, ROPE) + `<path d="${d}" stroke="rgba(60,45,20,.35)" stroke-width="4" fill="none"/>`;
  };
  const top = rect(0, 0, sx, sz, body) +
    (drum === 'z'
      ? `<g transform="translate(${f1(sx * 0.2)} ${f1(sz * 0.12)})">${rope(sx * 0.5, sz * 0.76)}</g>` + rect(sx * 0.76, sz * 0.2, sx * 0.2, sz * 0.6, dk)
      : `<g transform="translate(${f1(sx * 0.12)} ${f1(sz * 0.2)})">${rope(sx * 0.76, sz * 0.5)}</g>` + rect(sx * 0.2, sz * 0.76, sx * 0.6, sz * 0.2, dk));
  const side = (w: number, h: number) => rect(0, 0, w, h, body) + circle(w / 2, h * 0.45, Math.min(w, h) * 0.32, dk) + circle(w / 2, h * 0.45, Math.min(w, h) * 0.12, ROPE) + rect(0, h - 18, w, 18, dk);
  box(n, x, y, z, sx, sy, sz, { py: top, pz: side(sx, sy), nz: side(sx, sy), px: side(sz, sy), nx: side(sz, sy) });
}

function solid(n: Node3, x: number, y: number, z: number, sx: number, sy: number, sz: number, fill: string, top?: string) {
  box(n, x, y, z, sx, sy, sz, {
    py: top ?? rect(0, 0, sx, sz, tint(fill, 0.1)),
    pz: rect(0, 0, sx, sy, fill), nz: rect(0, 0, sx, sy, fill), px: rect(0, 0, sz, sy, fill), nx: rect(0, 0, sz, sy, fill),
  });
}

/** Thin vertical item (whip aerial, dome on a pedestal) as two crossed double-sided cards. */
function card(n: Node3, x: number, y: number, z: number, w: number, h: number, art: string) {
  for (const a of [[1, 0, 0], [0, 0, 1]] as V3[]) {
    n.face({ o: [x - (a[0] * w) / 2, y + h, z - (a[2] * w) / 2], a, b: [0, -1, 0], w, h, art, double: true, shade: 0 });
  }
}

/** Round exhaust pipe on the funnel top: a box whose sides fake the cylinder with a gradient. */
function pipe(n: Node3, x: number, y: number, z: number, d: number, h: number) {
  const side = () => {
    const gid = uid('pg');
    return gradH(gid, [[0, '#000000', 0.35], [0.35, '#FFFFFF', 0.12], [1, '#000000', 0.45]]) +
      rect(0, 0, d, h, '#50565E') + rect(0, 0, d, 26, '#16181B') + rect(0, 26, d, 8, 'rgba(0,0,0,.3)') + rect(0, h - 30, d, 12, '#6C737B') + rect(0, 0, d, h, `url(#${gid})`);
  };
  box(n, x - d / 2, y, z - d / 2, d, h, d, {
    py: circle(d / 2, d / 2, d / 2 - 2, '#2C3036') + circle(d / 2, d / 2, d / 2 - 12, '#07080A'),
    pz: side(), nz: side(), px: side(), nx: side(),
  }, { shade: 0.6 });
}

function buildHouse(n: Node3) {
  // Engine casing (aft of the house, carries the funnel).
  const casingSide = (w: number) => {
    let lv = '';
    for (let u = 120; u < w - 120; u += 170) for (let j = 0; j < 7; j++) lv += rectD(u, 170 + j * 18, 90, 8);
    return rect(0, 0, w, 560, WHITE) + rect(0, 0, w, 8, 'rgba(255,255,255,.4)') + path(lv, '#9AA3AD') + rect(0, 544, w, 16, 'rgba(0,0,0,.08)') + rr(40, 334, 84, 214, 6, DOOR);
  };
  box(n, -6500, DECK_Y, -450, 700, 560, 900, {
    py: roofBase(700, 900) + rr(60, 80, 120, 180, 8, '#8B95A0') + rr(60, 640, 120, 180, 8, '#8B95A0') + vent(620, 120) + vent(620, 780) + stair(250, 40, 200, 90),
    pz: casingSide(700), nz: casingSide(700), nx: houseWall(900, 2, { win: [80, 60, 260], doors: [410] }),
  });

  // Lower house, two decks.
  box(n, -5800, DECK_Y, -1000, 1400, 560, 2000, {
    pz: houseWall(1400, 2, { doors: [70] }),
    nz: houseWall(1400, 2, { doors: [1400 - 154] }),
    px: houseWall(2000, 2, { doors: [140, 2000 - 224] }),
    nx: houseWall(2000, 2, { doors: [200, 1716], skip: [[0, 520, 1480], [1, 520, 1480]] }),
    py:
      roofBase(1400, 2000) +
      // Shadow of the upper house on this deck (sun from −X / +Z).
      path(polyD([[200, 150], [1400, 150], [1400, 70], [260, 70]]), 'rgba(4,10,24,.16)') +
      [260, 420, 580, 900].map((u) => raft(u, 60) + raft(u, 1940)).join('') +
      rr(60, 300, 120, 120, 8, '#8B95A0') + rr(60, 1580, 120, 120, 8, '#8B95A0') + vent(110, 1000) +
      stair(1150, 40, 220, 100) + stair(1150, 1860, 220, 100),
  });
  // Upper house, three decks, NAVAIR name board on the front.
  box(n, -5600, DECK_Y + 560, -850, 1200, 840, 1700, {
    pz: houseWall(1200, 3, { doors: [60] }),
    nz: houseWall(1200, 3, { doors: [1200 - 144] }),
    px:
      houseWall(1700, 3, { skip: [[0, 470, 1230]] }) +
      rect(470, 60, 760, 170, WHITE) +
      text(850, 180, 'NAVAIR', 104, C.blue, { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 12 }),
    nx: houseWall(1700, 3, { doors: [808] }),
    py: roofBase(1200, 1700) + acUnit(60, 180) + acUnit(60, 1420) + acUnit(420, 40) + acUnit(420, 1560) +
      rr(120, 780, 160, 140, 10, '#7E8893') + circle(200, 850, 40, '#2A3038') + vent(560, 850, 20) + vent(560, 620, 18) + vent(560, 1080, 18) +
      // Shadow of the chart room on the boat-deck roof.
      path(polyD([[350, 150], [700, 150], [799, 15], [449, 15]]), 'rgba(4,10,24,.14)'),
  });
  // Wheelhouse aft part (chart room).
  box(n, -5250, DECK_Y + 1400, -700, 350, 260, 1400, {
    pz: houseWall(350, 1, { win: [70, 60, 160], dh: 260 }),
    nz: houseWall(350, 1, { win: [70, 60, 160], dh: 260 }),
    nx: houseWall(1400, 1, { win: [80, 60, 220], dh: 260, doors: [658] }),
    py: roofBase(350, 1400) + acUnit(100, 240) + acUnit(100, 1060) + vent(170, 700),
  });
  // Wheelhouse (enclosed), with open bridge wings out to the ship's side.
  const WH = 900;
  box(n, -4900, DECK_Y + 1400, -WH, 500, 280, 2 * WH, {
    px: bridgeFront(2 * WH, 280),
    pz: wingEnd(500, 280),
    nz: wingEnd(500, 280),
    nx: houseWall(2 * WH, 1, { win: [120, 110, 200], skip: [[0, 180, 1620]], doors: [60, 2 * WH - 144] }),
    py:
      roofBase(500, 2 * WH, '#CDD3D9') +
      circle(330, WH, 36, '#8C96A1') + circle(330, WH, 18, '#2B323A') +
      rr(62, WH - 38, 76, 76, 6, '#9AA4AE') +
      circle(185, WH - 700, 66, 'rgba(0,0,0,.16)') + circle(170, WH - 710, 60, '#F2F4F6') +
      circle(440, 250, 18, '#59636E') + circle(440, 2 * WH - 250, 18, '#59636E') +
      circle(20, 50, 10, '#2B323A') + circle(20, 2 * WH - 50, 10, '#2B323A') + circle(450, 50, 10, '#2B323A') + circle(250, 1300, 7, '#2B323A') +
      rr(380, 700, 70, 70, 6, '#8C96A1') + rr(380, 1030, 70, 70, 6, '#8C96A1'),
  });
  const WY = DECK_Y + 1360, WT = 40, WX = -4880, WW = 440, WZ = HB + 20 - WH;
  for (const s of [1, -1]) {
    const z0 = s > 0 ? WH : -WH - WZ;
    let gr = '';
    for (let u = 12; u < WW; u += 16) gr += rectD(u, 0, 5, WZ);
    const cons = (v: number) => rr(WW - 130, v, 90, 80, 8, '#5E6874') + rr(WW - 122, v + 8, 74, 30, 4, '#1C2530');
    const top = rect(0, 0, WW, WZ, '#B8C0C8') + path(gr, 'rgba(0,0,0,.08)') + cons(s > 0 ? WZ - 120 : 40);
    const edge = (w: number) => rect(0, 0, w, WT, '#DDE2E7') + rect(0, WT - 8, w, 8, 'rgba(0,0,0,.18)');
    box(n, WX, WY, z0, WW, WT, WZ, s > 0 ? { py: top, px: edge(WZ), nx: edge(WZ), pz: edge(WW) } : { py: top, px: edge(WZ), nx: edge(WZ), nz: edge(WW) });
    // Rails (see-through), with a solid dodger along the front.
    const rail = (L: number, dodger: boolean) => {
      let st = '';
      for (let u = 4; u < L; u += 92) st += rectD(u, 0, 6, 110);
      return path(st + rectD(0, 0, L, 8) + rectD(0, 52, L, 5), '#EEF1F4') + (dodger ? rect(0, 20, L, 90, 'rgba(230,234,238,.92)') + rect(0, 20, L, 5, '#FFFFFF') : '') + rect(L - 6, 0, 6, 110, '#EEF1F4');
    };
    const ty = WY + WT + 110;
    n.face({ o: [WX + WW, ty, z0], a: [0, 0, 1], b: [0, -1, 0], w: WZ, h: 110, art: rail(WZ, true), double: true, shade: 0.4 });
    n.face({ o: [WX, ty, z0], a: [0, 0, 1], b: [0, -1, 0], w: WZ, h: 110, art: rail(WZ, false), double: true, shade: 0.4 });
    n.face({ o: [WX, ty, s > 0 ? z0 + WZ : z0], a: [1, 0, 0], b: [0, -1, 0], w: WW, h: 110, art: rail(WW, true), double: true, shade: 0.4 });
  }
  // Mast + yardarm on the monkey island, two radar scanners, aerials and a satcom dome.
  const MAST = '#D3D8DD';
  const TOP = DECK_Y + 1680;
  solid(n, -4830, TOP, -30, 60, 820, 60, MAST);
  solid(n, -4820, TOP + 600, -520, 40, 26, 1040, MAST);
  solid(n, -4580, TOP, 590, 60, 170, 60, MAST);
  const scanner = (name: string, p: V3, half: number) => {
    const r = n.node(name, p);
    box(r, -20, 0, -half, 40, 30, 2 * half, {
      py: rr(0, 0, 40, 2 * half, 18, '#EEF0F2') + rect(16, 20, 8, 2 * half - 40, '#9AA3AD'),
      px: rect(0, 0, 2 * half, 30, '#D9DDE1') + rect(20, 12, 2 * half - 40, 6, '#39414A'),
      nx: rect(0, 0, 2 * half, 30, '#C9CED4'),
      pz: rect(0, 0, 40, 30, '#C9CED4'),
      nz: rect(0, 0, 40, 30, '#C9CED4'),
    });
    return r;
  };
  scanner('radarX', [-4800, 3000, 0], 230);
  scanner('radarS', [-4550, 2350, 620], 310);
  const whip = rect(4, 0, 6, 420, '#E6E9EC') + rect(1, 360, 12, 60, '#5E6873');
  card(n, -4880, TOP, 850, 14, 420, whip);
  card(n, -4880, TOP, -850, 14, 420, whip);
  card(n, -4450, TOP, -850, 14, 420, whip);
  const dg = uid('dg');
  card(n, -4730, TOP, -710, 140, 200,
    `<radialGradient id="${dg}" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#B9C1CA"/></radialGradient>` +
    rect(60, 120, 20, 80, '#AEB6BF') + circle(70, 70, 66, `url(#${dg})`));

  // Funnel: raked prism, NAVAIR blue band, exhaust pipes on top.
  const fn = n.node('funnel', [-6600, 0, 0]);
  const pts: [number, number][] = [[600, 0], [40, 0], [270, 1390], [790, 1390]];
  const fd = polyD(pts);
  const capArt = (mirrorText: boolean) => {
    const cid = uid('fc');
    const txt = text(380, 395, 'NAVAIR', 82, '#FFFFFF', { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 6 });
    let lv = '';
    for (let j = 0; j < 6; j++) lv += rectD(360, 1100 + j * 26, 280, 10);
    return (
      `<clipPath id="${cid}"><path d="${fd}"/></clipPath><g clip-path="url(#${cid})">` +
      rect(0, 0, 800, 1390, '#E5E8EB') +
      rect(0, 200, 800, 300, C.blue) + rect(0, 200, 800, 8, C.blueDeep) + rect(0, 492, 800, 8, 'rgba(0,0,0,.18)') +
      rect(0, 0, 800, 92, '#15171A') + rect(0, 92, 800, 12, 'rgba(0,0,0,.22)') +
      (mirrorText ? `<g transform="translate(760 0) scale(-1 1)">${txt}</g>` : txt) +
      path(lv, '#AEB6BF') +
      rect(0, 1350, 800, 40, 'rgba(0,0,0,.08)') +
      `</g>`
    );
  };
  prism(fn, pts, 2450, -330, 330, {
    capArt: capArt(false),
    capArtBack: capArt(true),
    edgeFill: (i) => (i === 2 ? null : '#DDE1E5'),
    edgeArt: (i, len, depth) => {
      const k = len / 1390;
      if (i === 0) {
        let g = '';
        for (let u = 30; u < len - 20; u += 34) g += rectD(u, 40, 14, depth - 80);
        return rect(0, 0, len, depth, '#141619') + path(rectD(0, 0, len, 22) + rectD(0, depth - 22, len, 22), '#2B2F34') + path(g, '#1E2125');
      }
      if (i === 1) return rect(0, 0, len, depth, '#DDE1E5') + rect(200 * k, 0, 300 * k, depth, C.blueDeep) + rect(0, 0, 92 * k, depth, '#141619');
      if (i === 3) return rect(0, 0, len, depth, '#DDE1E5') + rect((1390 - 500) * k, 0, 300 * k, depth, C.blue) + rect((1390 - 92) * k, 0, 92 * k, depth, '#141619');
      return null;
    },
  });
  pipe(n, -6330, 2430, 0, 150, 250);
  pipe(n, -6470, 2430, -180, 84, 180);
  pipe(n, -6470, 2430, 180, 84, 180);

  // Free-fall lifeboat on its launching ramp, aft.
  let tr = '';
  for (let u = 0; u < 820; u += 100) tr += `M${u} 0L${u + 100} 380M${u + 100} 0L${u} 380`;
  const truss = (w: number) => `<path d="${tr}" stroke="#7B8591" stroke-width="12" fill="none" transform="scale(${f2(w / 820)} 1)"/>` + rect(0, 0, w, 24, '#8B95A0') + rect(0, 0, 24, 380, '#8B95A0') + rect(w - 24, 0, 24, 380, '#8B95A0');
  box(n, -7420, DECK_Y, -230, 820, 380, 460, { px: truss(460), nx: truss(460), pz: truss(820), nz: truss(820) }, { shades: { px: 0, nx: 0, pz: 0, nz: 0 } });
  const lb = n.node('lifeboat', [-7020, 905, 0]);
  lb.r.z = 12;
  const lbSide = rr(0, 0, 860, 250, [30, 110, 30, 60], ORANGE) + rect(0, 170, 860, 80, shade(ORANGE, 0.18)) + rect(0, 164, 860, 8, '#F5F1E8') +
    path([...Array(8)].map((_, i) => rrD(120 + i * 80, 70, 46, 34, 8)).join(''), '#1C2530') + rect(0, 0, 860, 20, 'rgba(255,255,255,.18)');
  box(lb, -430, 0, -165, 860, 250, 330, {
    pz: lbSide, nz: lbSide,
    py: rr(0, 0, 860, 330, 90, tint(ORANGE, 0.08)) + rr(300, 110, 200, 110, 20, shade(ORANGE, 0.2)) + rect(40, 160, 780, 10, '#F5F1E8') +
      rr(60, 40, 180, 60, 26, 'rgba(255,255,255,.2)') + circle(640, 165, 30, shade(ORANGE, 0.25)),
    px: rr(0, 0, 330, 250, 60, ORANGE) + rr(110, 60, 110, 50, 12, '#1C2530'),
    nx: rr(0, 0, 330, 250, 40, ORANGE),
  }, { shades: { pz: 0.5, nz: 0.5 } });

  // Rescue boat hanging on its davit, port side of the boat deck.
  box(n, -5420, 980, -1190, 480, 100, 170, {
    py: rr(0, 0, 480, 170, 70, '#2F353C') + rr(30, 30, 420, 110, 50, ORANGE) + rect(200, 60, 60, 50, '#1C2530'),
    pz: rr(0, 0, 480, 100, 40, '#2F353C'), nz: rr(0, 0, 480, 100, 40, '#2F353C'),
    px: rr(0, 0, 170, 100, 40, '#2F353C'), nx: rr(0, 0, 170, 100, 40, '#2F353C'),
  });
  solid(n, -5210, 1060, -1080, 40, 160, 40, '#C9CFD6');
  solid(n, -5210, 1200, -1150, 40, 30, 150, '#C9CFD6');
  // Liferaft canisters in their cradles on the starboard boat-deck edge.
  for (const x of [-5500, -5330]) {
    box(n, x, 1060, 870, 130, 70, 110, {
      py: raft(65, 55),
      pz: rr(0, 0, 130, 70, 30, '#F2F3F4') + rect(30, 0, 7, 70, '#5C6670') + rect(93, 0, 7, 70, '#5C6670'),
      px: rr(0, 0, 110, 70, 30, '#E3E6E8'), nx: rr(0, 0, 110, 70, 30, '#E3E6E8'),
    });
  }
}

/* ------------------------------------------------------------------------ */
/* Ship                                                                      */
/* ------------------------------------------------------------------------ */

export interface Ship {
  /** The ship (lead positions root.p / root.r.y in world). */
  root: Node3;
  /** WORLD frame for the hero container: floor-centre point and yaw (container long axis = ship X). */
  slot(): { p: V3; yaw: number };
  LOA: number;
  BEAM: number;
  DECK_Y: number;
}

/**
 * Water stand-in handed to the choreography (boot builds it). The sea itself
 * is drawn by scene/oceanGL.ts; `root` only scopes its visibility.
 */
export interface Ocean {
  root: Node3;
  wake: Node3;
  update(t: number, speed: number): void;
}

export function createShip(): Ship {
  const root = new Node3('ship');
  const bays = planCargo();

  /* Hull */
  const hull = root.node('hull');
  for (const s of [1, -1] as const) {
    const segs = sideSegs(s);
    const items = sideItems(segs);
    for (const g of segs) sideFace(hull, g, items);
  }
  // Transom: five facets round the curved stern, art continuous across them.
  {
    const segs: { P: [number, number]; Q: [number, number]; L: number; S0: number }[] = [];
    let S = 0;
    for (let j = 0; j < TPTS.length - 1; j++) {
      const P = TPTS[j], Q = TPTS[j + 1], L = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
      segs.push({ P, Q, L, S0: S });
      S += L;
    }
    const art = transomArt(S);
    for (const { P, Q, L, S0 } of segs) {
      const ax = (Q[0] - P[0]) / L, az = (Q[1] - P[1]) / L;
      hull.face({
        o: [P[0], STERN_H, P[1]], a: [ax, 0, az], b: [0, -1, 0], w: L, h: STERN_H, name: 'transom',
        art: `<svg width="${f1(L + 0.8)}" height="${STERN_H}" viewBox="${f1(S0)} 0 ${f1(L + 0.8)} ${STERN_H}" overflow="hidden">${art}</svg>`,
      });
      const hb = STERN_H - DECK_Y;
      hull.face({
        o: [Q[0], STERN_H, Q[1]], a: [-ax, 0, -az], b: [0, -1, 0], w: L, h: hb,
        art: rect(0, 0, L, hb, INNER) + rect(0, 0, L, 12, CAP) + rect(0, hb - 14, L, 14, 'rgba(0,0,0,.2)'),
      });
    }
  }
  // Bulbous bow, just under the surface ahead of the stem (reads through the water from above).
  {
    const top: [number, number][] = [], bot: [number, number][] = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14, x = 7800 + 1000 * t;
      const w = 230 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.75);
      top.push([x - 7700, 300 - w]);
      bot.push([x - 7700, 300 + w]);
    }
    const d = polyD([...top, ...bot.reverse()]);
    hull.face({
      o: [7700, 2, -300], a: [1, 0, 0], b: [0, 0, 1], w: 1200, h: 600, layer: -9, shade: 0, name: 'bulb',
      art: path(d, 'rgba(6,16,40,.26)') + `<path d="${d}" fill="none" stroke="rgba(150,185,235,.12)" stroke-width="16"/>`,
    });
  }

  /* Decks */
  const md = planPoly(XS, FC_X);
  hull.face({
    o: [XS, DECK_Y, -HB], a: [1, 0, 0], b: [0, 0, 1], w: FC_X - XS, h: BEAM, layer: -2, name: 'deck',
    art: `<g transform="translate(${-XS} ${HB})">${mainDeckArt(md, bays)}</g>`,
    outline: polyD(md.map(([x, z]) => [x - XS, z + HB])),
  });
  const fc = planPoly(FC_X, XB);
  hull.face({
    o: [FC_X, FC_Y, -HB], a: [1, 0, 0], b: [0, 0, 1], w: XB - FC_X, h: BEAM, layer: -1, name: 'forecastle',
    art: `<g transform="translate(${-FC_X} ${HB})">${forecastleArt(fc)}</g>`,
    outline: polyD(fc.map(([x, z]) => [x - FC_X, z + HB])),
  });
  // Forecastle break bulkhead (faces aft onto the main deck).
  const fw = 2 * hwP(FC_X);
  hull.face({
    o: [FC_X, FC_Y, -fw / 2], a: [0, 0, 1], b: [0, -1, 0], w: fw, h: FC_Y - DECK_Y,
    art: rect(0, 0, fw, 250, '#5C6773') + rect(0, 0, fw, 12, CAP) +
      rr(fw / 2 - 560, 50, 84, 196, 6, '#838D98') + rr(fw / 2 + 476, 50, 84, 196, 6, '#838D98') +
      path([...Array(7)].map((_, i) => rectD(fw / 2 - 30, 20 + i * 32, 60, 5)).join(''), '#9AA3AD') + rect(0, 236, fw, 14, 'rgba(0,0,0,.2)'),
  });
  // Breakwater: a V of plates on the forecastle.
  const apex: [number, number] = [6680, 0];
  for (const s of [1, -1]) {
    const E: [number, number] = [6150, s * (hwP(6150) - 70)];
    const L = Math.hypot(E[0] - apex[0], E[1] - apex[1]);
    const ax = (E[0] - apex[0]) / L, az = (E[1] - apex[1]) / L;
    let st = '';
    for (let u = 60; u < L - 30; u += 95) st += rectD(u, 14, 14, 416);
    let holes = '';
    for (let u = 110; u < L - 60; u += 190) holes += `M${u} 430a34 30 0 0 1 68 0Z`;
    hull.face({
      o: [apex[0], 1180, apex[1]], a: [ax, 0, az], b: [0, -1, 0], w: L, h: 430, double: true,
      art: rect(0, 0, L, 430, '#46525F') + path(st, '#3A4552') + rect(0, 0, L, 14, '#7B8692') + path(holes, '#0D1116'),
    });
    hull.face({
      o: [apex[0], 1180, apex[1]], a: [ax, 0, az], b: [-az, 0, ax], w: L, h: 18, double: true,
      art: rect(0, 0, L, 18, '#8C97A3'),
    });
  }

  /* Hatch coamings + covers */
  const cargo = root.node('cargo');
  box(cargo, -4010, DECK_Y, -1010, 9770, 150, 2020, {
    py: coamingArt(), pz: coamingSide(9770, true), nz: coamingSide(9770, true), px: coamingSide(2020, false), nx: coamingSide(2020, false),
  }, { layer: -1 });
  for (let k = 0; k < BAYS - 1; k++) lashBridge(cargo, xcOf(k) + BAY_PITCH / 2);
  buildCargo(cargo, bays);

  /* Deck machinery */
  const mach = root.node('machinery');
  for (const s of [1, -1]) {
    machineBox(mach, -7850, DECK_Y, s * 600 - 100, 300, 170, 200, 'z');
    machineBox(mach, 7000, FC_Y, s * 430 - 110, 300, 170, 220, 'z');
  }
  // Foremast with its masthead light.
  solid(mach, 8030, FC_Y, -25, 50, 820, 50, '#D3D8DD');
  solid(mach, 7990, FC_Y + 760, -60, 130, 16, 120, '#C9CFD6');
  solid(mach, 8035, FC_Y + 820, -20, 40, 40, 40, '#F4F1DA');

  /* Superstructure */
  buildHouse(root.node('house'));

  return {
    root,
    LOA,
    BEAM,
    DECK_Y,
    slot() {
      const chain: Node3[] = [];
      for (let n: Node3 | null = root; n; n = n.parent) chain.unshift(n);
      let m = I3;
      let p: V3 = [0, 0, 0];
      let yaw = 0;
      for (const n of chain) {
        p = add(p, apply(m, n.p));
        m = mul(m, scaleM(euler(n.r.x, n.r.y, n.r.z), n.s));
        yaw += n.r.y;
      }
      return { p: add(p, apply(m, SLOT_LOCAL)), yaw };
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Lab                                                                       */
/* ------------------------------------------------------------------------ */

/** Flat stand-in sea for the lab (the real water is WebGL). */
function labSea(size = 90000) {
  const n = new Node3('lab-sea');
  n.face({ o: [-size, 0, -size], a: [1, 0, 0], b: [0, 0, 1], w: 2 * size, h: 2 * size, art: rect(0, 0, 2 * size, 2 * size, '#0B2E78'), shade: 0, layer: -10.6, double: true, name: 'lab-sea' });
  return n;
}

/** Lab stand-in for the quay: concrete apron on the +Z side of a yaw-0 ship. */
function labQuay(z0: number) {
  const n = new Node3('lab-quay');
  const W = 120000, D = 60000;
  let bol = '';
  for (let x = 1000; x < W; x += 2400) bol += circD(x, 140, 40);
  n.face({
    o: [-W / 2, 1, z0], a: [1, 0, 0], b: [0, 0, 1], w: W, h: D, layer: -10, shade: 0, double: true,
    art: rect(0, 0, W, D, C.concrete) + rect(0, 0, W, 60, '#2A2D33') + rect(0, 60, W, 30, C.hazard) + path(bol, '#2A2D33') + rect(0, 900, W, 18, C.concrete2),
  });
  return n;
}

/** Radar scanners turn in the lab (the page leaves them parked). */
function radars(ship: Ship) {
  const a = ship.root.find('radarX'), b = ship.root.find('radarS');
  return (t: number) => {
    if (a) a.r.y = (t * 150) % 360;
    if (b) b.r.y = (-t * 115) % 360;
  };
}

export const labEntries: Record<string, LabEntry> = {
  ship: {
    title: 'Container ship',
    build: () => {
      const root = new Node3('ship-lab');
      const ship = createShip();
      root.add(labSea());
      root.add(ship.root);
      return {
        root,
        frame: { tx: 0, ty: 400, tz: 0, zoom: 0.1 },
        pose: (v) => {
          // Lab-only: slide the ship so ship-space x = focus sits at the frame centre.
          ship.root.p = [-(v.focus ?? 0), 0, 0];
        },
        tick: radars(ship),
      };
    },
    controls: [{ key: 'focus', min: -9000, max: 9000, step: 50, value: 0 }],
  },
  shipBerth: {
    title: 'Container ship — moored at the berth',
    build: () => {
      const root = new Node3('ship-berth-lab');
      const ship = createShip();
      const qz = HB + 160;
      root.add(labSea());
      root.add(labQuay(qz));
      root.add(ship.root);
      return { root, frame: { tx: 0, ty: 400, tz: 0, zoom: 0.13 }, tick: radars(ship) };
    },
  },
  shipDepart: {
    title: 'Container ship — under way (chase cam yaw = shipYaw − 90)',
    build: () => {
      const root = new Node3('ship-depart-lab');
      const ship = createShip();
      root.add(labSea());
      root.add(ship.root);
      return {
        root,
        frame: { tx: 0, ty: 400, tz: 0, zoom: 0.065 },
        pose: (v) => {
          ship.root.r.y = v.shipYaw ?? 0;
        },
        tick: radars(ship),
      };
    },
    controls: [{ key: 'shipYaw', min: -180, max: 180, step: 1, value: 0 }],
  },
  shipSlot: {
    title: 'Container ship — hero slot check',
    build: () => {
      const root = new Node3('ship-slot-lab');
      const ship = createShip();
      const hero = container('hero', LIVERY.hero);
      root.add(labSea());
      root.add(ship.root);
      root.add(hero);
      const s0 = ship.slot();
      return {
        root,
        frame: { tx: s0.p[0], ty: s0.p[1], tz: s0.p[2], zoom: 0.07 },
        pose: (v) => {
          ship.root.r.y = v.shipYaw ?? 0;
          const s = ship.slot();
          hero.p = [s.p[0], s.p[1] + (v.lift ?? 0), s.p[2]];
          hero.r.y = s.yaw;
        },
      };
    },
    controls: [
      { key: 'shipYaw', min: -180, max: 180, step: 1, value: 0 },
      { key: 'lift', min: 0, max: 3000, step: 10, value: 0 },
    ],
  },
};
