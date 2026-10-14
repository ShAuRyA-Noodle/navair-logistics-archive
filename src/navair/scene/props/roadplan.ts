/**
 * Plan-view road network: ONE road system for the straight, the junction, the
 * branch and the port approach.
 *
 * Every part is built from the same recipe: verge → kerb → asphalt → texture →
 * markings. Lane lines along the truck's route are single paths (line + arc +
 * line), so the dash rhythm runs phase-continuously through the curve; the
 * branch's lanes start phase-aligned with the straight they continue. At the
 * split a hatched gore with chevrons runs from the edge-line crossing to a
 * rounded island nose.
 *
 * Art space: u = X − ox, v = Z − oz (plan, v pointing +Z).
 */

import { path, rect, stroke } from '../../engine/art';
import { C, ROAD } from '../../world';
import { rng } from '../../engine/math';
import { EXIT_Z, HALF, LANE_X, PORT_X0, START_Z, STOP_X, TURN_CX, TURN_CZ, TURN_R, TURN_Z, routeAt, ROUTE_LEN } from '../route';

/* ----------------------------------------------------------------- palette */

/** One road palette, used everywhere (UC: near-black road, low-contrast dashes, faint edges). */
export const RP = {
  verge: '#E9E9E2',
  kerb: '#CBCAC2',
  kerbHi: '#DEDDD6',
  asphalt: C.road,
  edge: '#262930',
  dash: C.laneDash,
  wear: 'rgba(0,0,0,.2)',
  oil: 'rgba(0,0,0,.16)',
  patch: 'rgba(255,255,255,.022)',
  patchSeam: 'rgba(255,255,255,.035)',
  seam: 'rgba(255,255,255,.05)',
  stud: '#4B4E56',
};

const W = ROAD.W;
const EDGE_IN = 40; // edge line centre, inside the asphalt edge
const EDGE_W = 14;
const DASH_W = 22;
const DASH = ROAD.laneDash, GAP = ROAD.laneGap, PERIOD = DASH + GAP;
export const VERGE = 260; // shoulder band each side
const KERB = 26;
/** Lane dividers (3 lanes). */
const LANES = [-HALF / 3, HALF / 3];
/** Lane centres. */
export const LANE_C = [-(2 * HALF) / 3, 0, (2 * HALF) / 3];

/** The route's straight starts this far before START_Z (off-screen lead-in). */
const LEAD = 20000;
const Z_ORIGIN = START_Z + LEAD; // dash phase origin
export const BRANCH_LEN = 26000;

const f = (n: number) => Math.round(n * 10) / 10;

/* ---------------------------------------------------------------- geometry */

export interface Frame {
  ox: number;
  oz: number;
}

/** Route path offset o (right of travel), from the lead-in to x = xEnd. */
export function routeD(F: Frame, o: number, xEnd: number, zStart = Z_ORIGIN) {
  const u = (x: number) => f(x - F.ox), v = (z: number) => f(z - F.oz);
  const r = TURN_R - o;
  return `M${u(LANE_X + o)} ${v(zStart)}L${u(LANE_X + o)} ${v(TURN_Z)}A${f(r)} ${f(r)} 0 0 1 ${u(TURN_CX)} ${v(TURN_CZ - r)}L${u(xEnd)} ${v(TURN_CZ - r)}`;
}

/** Straight branch continuing −Z past the junction, from branch distance w0 to w1. */
export function branchD(F: Frame, o: number, w0 = 0, w1 = BRANCH_LEN) {
  const u = (x: number) => f(x - F.ox), v = (z: number) => f(z - F.oz);
  return `M${u(LANE_X + o)} ${v(TURN_Z - w0)}L${u(LANE_X + o)} ${v(TURN_Z - w1)}`;
}

/** Point on the route at arc length s, offset o to the right; heading in degrees. */
export function routePt(s: number, o: number) {
  const p = routeAt(s);
  const h = (p.heading * Math.PI) / 180;
  return { x: p.x + Math.sin(h) * o, z: p.z + Math.cos(h) * o, heading: p.heading };
}

/** Arc of radius r about the turn centre at angle th (0 = turn start, π/2 = exit), junction-local (u, w). */
const arcPt = (r: number, th: number) => ({ u: TURN_R - r * Math.cos(th), w: r * Math.sin(th) });
const arcTh = (r: number, u: number) => Math.acos((TURN_R - u) / r);

/** First phase-aligned dash start at or past branch distance w (the branch continues the straight's rhythm). */
function alignedW(w: number) {
  const base = Z_ORIGIN - TURN_Z; // straight length from the dash origin to the split
  return Math.ceil((base + w) / PERIOD) * PERIOD - base;
}

/** Branch distance where lateral offset o leaves the route's outer asphalt (plus margin m). */
function brClear(o: number, m = 120) {
  const du = TURN_R - o;
  const R = TURN_R + HALF + m;
  return du >= R ? 0 : Math.sqrt(R * R - du * du);
}

/* ------------------------------------------------------------------ gore */

const Ro = TURN_R + HALF; // route outer asphalt radius
const Rl = TURN_R + (HALF - EDGE_IN); // route outer edge-line radius
/** Nose position along the branch edge, and where it lands on the route's outer edge. */
const NOSE_A_W = 3800;
const NOSE_B_TH = (74 * Math.PI) / 180;

/** Rounded island nose from the branch edge (u = uA) to the route's outer arc (radius r). */
function noseCurve(uA: number, r: number, JU: (u: number, w: number) => string) {
  const A = { u: uA, w: NOSE_A_W };
  const B = arcPt(r, NOSE_B_TH);
  const tB = { u: Math.sin(NOSE_B_TH), w: Math.cos(NOSE_B_TH) }; // arc tangent, downstream
  const k1 = 520, k2 = 420;
  return {
    A,
    B,
    d: `C${JU(A.u, A.w - k1)} ${JU(B.u - tB.u * k2, B.w - tB.w * k2)} ${JU(B.u, B.w)}`,
  };
}

/* -------------------------------------------------------------------- art */

export function roadPlanArt(F: Frame, opts: { xEnd: number }) {
  const U = (x: number) => f(x - F.ox), V = (z: number) => f(z - F.oz);
  const JX = (u: number) => U(LANE_X + u), JZ = (w: number) => V(TURN_Z - w);
  /** Junction-local point as "u v" art text. */
  const JU = (u: number, w: number) => `${JX(u)} ${JZ(w)}`;
  const out: string[] = [];
  const xVergeEnd = PORT_X0; // on the apron the road sits flush in the concrete

  const rMain = (o: number, xEnd = opts.xEnd) => routeD(F, o, xEnd);
  const rBr = (o: number, w0 = 0, w1 = BRANCH_LEN) => branchD(F, o, w0, w1);

  /* gore / island nose geometry */
  const nose = noseCurve(HALF, Ro, JU);
  const th0 = arcTh(Ro, HALF);
  const goreFill = (() => {
    const p0 = arcPt(Ro - 300, th0 - 0.12);
    const p1 = arcPt(Ro - 300, NOSE_B_TH);
    return (
      `M${JU(p0.u, p0.w)}L${JU(HALF - 200, 2300)}L${JU(HALF, 2300)}L${JU(HALF, nose.A.w)}` +
      nose.d +
      `L${JU(p1.u, p1.w)}Z`
    );
  })();
  const noseD = `M${JU(HALF, nose.A.w + 400)}L${JU(HALF, nose.A.w)}${nose.d}`;

  /* 0 · landscape strip beyond the shoulder (planted buffer), very light */
  const gW = W + 2 * (VERGE + 420);
  out.push(stroke(rMain(0, xVergeEnd - 700), '#EAEDE5', gW, { 'stroke-linejoin': 'round' }));
  out.push(stroke(rBr(0), '#EAEDE5', gW));
  {
    // Shrub clumps along the buffer (soft sage dots), deterministic.
    const R = rng(23);
    let sh = '', sh2 = '';
    const blob = (x: number, z: number, r: number) => `M${f(U(x) + r)} ${V(z)}a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0`;
    const clump = (x: number, z: number) => {
      const r0 = 34 + R() * 34;
      sh += blob(x, z, r0) + blob(x + (R() - 0.5) * 110, z + (R() - 0.5) * 110, r0 * 0.75);
      sh2 += blob(x - r0 * 0.25, z - r0 * 0.25, r0 * 0.45);
    };
    for (let s = -19000; s < ROUTE_LEN; s += 260 + R() * 520) {
      for (const side of [-1, 1]) {
        if (R() < 0.4) continue;
        const p = routePt(s, side * (HALF + VERGE + 130 + R() * 200));
        if (p.x > xVergeEnd - 900) continue;
        // Keep the junction's inner corner tidy.
        if (side > 0 && s > ROUTE_LEN - 20000) continue;
        clump(p.x, p.z);
      }
    }
    for (let w = 5200; w < BRANCH_LEN; w += 300 + R() * 600) {
      for (const side of [-1, 1]) if (R() > 0.45) clump(LANE_X + side * (HALF + VERGE + 130 + R() * 200), TURN_Z - w);
    }
    out.push(path(sh, '#DCE2D5'), path(sh2, '#E6EBE1'));
  }
  /* 1 · verge (shoulder) */
  const vW = W + 2 * VERGE;
  out.push(stroke(rMain(0, xVergeEnd), RP.verge, vW, { 'stroke-linejoin': 'round' }));
  out.push(stroke(rBr(0), RP.verge, vW));
  out.push(stroke(noseD, RP.verge, 2 * VERGE, { 'stroke-linejoin': 'round' }));
  /* 2 · kerb */
  const kW = W + 2 * KERB;
  out.push(stroke(rMain(0, xVergeEnd), RP.kerb, kW));
  out.push(stroke(rBr(0), RP.kerb, kW));
  out.push(stroke(noseD, RP.kerb, 2 * KERB));
  /* 3 · asphalt */
  out.push(stroke(rMain(0), RP.asphalt, W));
  out.push(stroke(rBr(0), RP.asphalt, W));
  out.push(path(goreFill, RP.asphalt));

  /* 4 · texture (identical recipe everywhere) */
  // Oil band down each lane centre, tyre polish in the wheel paths.
  let oil = '', wear = '';
  for (const c of LANE_C) {
    oil += rMain(c) + rBr(c, brClear(c));
    for (const k of [-1, 1]) wear += rMain(c + k * 95) + rBr(c + k * 95, brClear(c + k * 95));
  }
  out.push(stroke(oil, RP.oil, 70));
  out.push(stroke(wear, RP.wear, 46));
  // Patching + sealed cracks, deterministic, along both roads.
  {
    const R = rng(7);
    let seams = '';
    const patch = (x: number, z: number, heading: number) => {
      const len = 260 + R() * 700, wid = 180 + R() * 240;
      return (
        `<g transform="translate(${U(x)} ${V(z)}) rotate(${f(-heading)})">` +
        rect(-len / 2, -wid / 2, len, wid, RP.patch) +
        stroke(`M${f(-len / 2)} ${f(-wid / 2)}h${f(len)}v${f(wid)}h${f(-len)}Z`, RP.patchSeam, 5) +
        '</g>'
      );
    };
    for (let s = -19000; s < ROUTE_LEN + 60000; s += 1700 + R() * 2600) {
      const lane = LANE_C[Math.floor(R() * 3)];
      const p = routePt(s, lane + (R() - 0.5) * 120);
      if (p.x > opts.xEnd - 1000) break;
      out.push(patch(p.x, p.z, p.heading));
      if (R() < 0.45) {
        // Sealed crack: a slow wandering line across the lane.
        const s2 = s + 400 + R() * 600;
        const c0 = routePt(s2, -HALF + 100 + R() * (W - 500));
        const L = 250 + R() * 500;
        const hh = (c0.heading * Math.PI) / 180;
        const dx = Math.cos(hh), dz = -Math.sin(hh);
        const nx = Math.sin(hh), nz = Math.cos(hh);
        seams += `M${U(c0.x)} ${V(c0.z)}`;
        for (let i = 1; i <= 5; i++) {
          const t = (L * i) / 5;
          const j = (R() - 0.5) * 70;
          seams += `L${U(c0.x + nx * t * 0.8 + dx * j)} ${V(c0.z + nz * t * 0.8 + dz * j)}`;
        }
      }
    }
    for (let w = 3600; w < BRANCH_LEN; w += 2200 + R() * 2600) {
      out.push(patch(LANE_X + LANE_C[Math.floor(R() * 3)], TURN_Z - w, 90));
    }
    if (seams) out.push(stroke(seams, RP.seam, 6, { 'stroke-linejoin': 'round' }));
  }

  /* 5 · markings */
  const eo = HALF - EDGE_IN;
  // Edge lines: route both sides (the outer one is the solid divider across the split),
  // branch left from the split, branch right from the gore tip.
  const wT = Math.sqrt(Rl * Rl - (TURN_R - eo) * (TURN_R - eo));
  out.push(stroke(rMain(-eo) + rMain(eo) + rBr(-eo, 0) + rBr(eo, wT), RP.edge, EDGE_W));
  // Lane dashes: one path per divider along the whole route (phase-continuous through the arc).
  const dash = { 'stroke-dasharray': `${DASH} ${GAP}` };
  for (const o of LANES) out.push(stroke(rMain(o), RP.dash, DASH_W, dash));
  // Branch lanes: continue the straight's rhythm once clear of the divider.
  for (const o of LANES) out.push(stroke(rBr(o, alignedW(brClear(o, 60))), RP.dash, DASH_W, dash));

  // Gore: hatched chevrons clipped between the two edge lines and the island nose.
  {
    const noseIn = noseCurve(eo, Rl, JU);
    const thT = arcTh(Rl, eo);
    const tip = arcPt(Rl, thT);
    const clip = `M${JU(eo, wT)}L${JU(eo, noseIn.A.w)}${noseIn.d}A${f(Rl)} ${f(Rl)} 0 0 0 ${JU(tip.u, tip.w)}Z`;
    // Bisector of the two edges at the tip, chevrons point upstream (toward the tip).
    const ta = { u: Math.sin(thT), w: Math.cos(thT) };
    let bu = ta.u, bw = 1 + ta.w;
    const bl = Math.hypot(bu, bw);
    bu /= bl;
    bw /= bl;
    const pu = -bw, pw = bu;
    let ch = '';
    for (let t = 120; t < 2600; t += 300) {
      const au = eo + bu * t, aw = wT + bw * t;
      const L = 1600;
      const lu = au + (bu * 0.7 + pu) * L, lw = aw + (bw * 0.7 + pw) * L;
      const ru = au + (bu * 0.7 - pu) * L, rw = aw + (bw * 0.7 - pw) * L;
      ch += `M${JU(lu, lw)}L${JU(au, aw)}L${JU(ru, rw)}`;
    }
    out.push(`<clipPath id="navair-gore"><path d="${clip}"/></clipPath>`);
    out.push(`<g clip-path="url(#navair-gore)">${stroke(ch, RP.dash, 44, { 'stroke-linejoin': 'miter' })}</g>`);
    // Gore border: the two edge lines are already there; close the nose end with a solid line.
    out.push(stroke(`M${JU(eo, noseIn.A.w)}${noseIn.d}`, RP.dash, DASH_W));
    // Nose kerb highlight + keep-left bollard on the island.
    out.push(stroke(noseD, RP.kerbHi, 9));
    const bp = { u: (nose.A.u + nose.B.u) / 2 + 60, w: (nose.A.w + nose.B.w) / 2 + 260 };
    out.push(`<circle cx="${JX(bp.u)}" cy="${JZ(bp.w)}" r="34" fill="rgba(0,0,0,.12)"/>`);
    out.push(`<circle cx="${JX(bp.u)}" cy="${JZ(bp.w)}" r="26" fill="#F4F4F0" stroke="#2A2D33" stroke-width="5"/>`);
    out.push(`<circle cx="${JX(bp.u)}" cy="${JZ(bp.w)}" r="10" fill="${C.blue}"/>`);
  }

  // Road studs (cat's eyes) on the edge lines, same pitch everywhere.
  {
    let sd = '';
    const dot = (x: number, z: number) => `M${f(U(x) + 7)} ${V(z)}a7 7 0 1 0 -14 0a7 7 0 1 0 14 0`;
    for (let s = -19000; s < ROUTE_LEN + 60000; s += 1200) {
      for (const o of [-eo, eo]) {
        const p = routePt(s, o);
        if (p.x > PORT_X0 - 200) continue;
        sd += dot(p.x, p.z);
      }
    }
    for (let w = 1200; w < BRANCH_LEN; w += 1200) {
      sd += dot(LANE_X - eo, TURN_Z - w);
      if (w > wT) sd += dot(LANE_X + eo, TURN_Z - w);
    }
    out.push(path(sd, RP.stud));
  }

  // Arrows: straight arrows in the middle lane on the long straight; lane arrows before the split.
  {
    const straight = `M-230 -14H90V-50L230 0L90 50V14H-230Z`;
    const right = `M-230 -14H20Q86 -14 86 52V90H120L72 170L24 90H58V52Q58 14 20 14H-230Z`;
    const put = (x: number, z: number, heading: number, d: string) =>
      `<path transform="translate(${U(x)} ${V(z)}) rotate(${f(-heading)})" d="${d}" fill="${RP.dash}"/>`;
    for (let z = START_Z - 3000; z > TURN_Z + 9000; z -= 8000) out.push(put(LANE_X, z, 90, straight));
    // Before the split: left lane straight on (branch), middle & right lanes turn right.
    const zA = TURN_Z + 2800;
    out.push(put(LANE_X + LANE_C[0], zA, 90, straight));
    out.push(put(LANE_X + LANE_C[1], zA, 90, right));
    out.push(put(LANE_X + LANE_C[2], zA, 90, right));
    for (let x = TURN_CX + 2200; x < PORT_X0 - 1200; x += 8000) out.push(put(x, EXIT_Z, 0, straight));
    // Stop line + transverse slow-down bars before the terminal gate.
    const gx = PORT_X0 - 380;
    out.push(rect(U(gx), V(EXIT_Z - HALF + 60), 40, W - 120, RP.dash));
    let bars = '';
    for (let k = 0; k < 3; k++) bars += `M${U(gx - 300 - k * 130)} ${V(EXIT_Z - HALF + 120)}h26v${W - 240}h-26Z`;
    out.push(path(bars, RP.dash));
  }

  // Positioning box under the quay crane: where the rig parks its box.
  {
    const x0 = STOP_X - 500 - 760, x1 = STOP_X - 500 + 760;
    const z0 = EXIT_Z - 260, z1 = EXIT_Z + 260;
    out.push(stroke(`M${U(x0)} ${V(z0)}H${U(x1)}V${V(z1)}H${U(x0)}Z`, 'rgba(242,183,5,.5)', 12, { 'stroke-dasharray': '60 40' }));
  }
  return out.join('');
}
