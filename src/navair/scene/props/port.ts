/**
 * Port ground art and terminal gate: quay apron (capping beam, bollards,
 * cleats, fenders, crane rails, cable trench, painted bay and lashing
 * markings, drains, stains), landside yard pavement with RTG runways and slot
 * markings, the terminal gate (booths, islands, barrier arms, OCR portal) and
 * the stack-chapter yard deck.
 */

import { Node3, box } from '../../engine/engine';
import { circle, path, rect, rr, stroke, text } from '../../engine/art';
import { rng } from '../../engine/math';
import { C } from '../../world';
import { APRON_Z1, CRANE_X, CRANE_Z, EXIT_Z, HALF, PORT_X0, PORT_X1, QUAY_EDGE_Z } from '../route';
import { CONC, signGantry } from './street';

const f = (n: number) => Math.round(n * 10) / 10;

/** Fender strip depth beyond the quay edge (the quay face starts this far seaward). */
export const FENDER = 150;

/* ------------------------------------------------------------------ quay */

/**
 * Quay apron art. Face origin at (PORT_X0, 0, QUAY_EDGE_Z − FENDER); u = X − PORT_X0,
 * v = Z − (QUAY_EDGE_Z − FENDER).
 */
export function quayArt() {
  const w = PORT_X1 - PORT_X0;
  const E = FENDER; // v of the quay edge
  const h = APRON_Z1 - QUAY_EDGE_Z;
  const V = (z: number) => z - QUAY_EDGE_Z + E;
  const U = (x: number) => x - PORT_X0;
  const R = rng(31);
  const s: string[] = [rect(0, E, w, h, C.concrete)];
  // Slab joints (6 m panels) + subtle panel-to-panel tone variation.
  let tone = '';
  for (let x = 0; x < w; x += 600) for (let z = 0; z < h; z += 600) if (R() < 0.16) tone += `M${x} ${E + z}h600v600h-600Z`;
  s.push(path(tone, 'rgba(0,0,0,.022)'));
  let j = '';
  for (let x = 0; x < w; x += 600) j += `M${x} ${E}V${E + h}`;
  for (let z = 0; z < h; z += 600) j += `M0 ${E + z}H${w}`;
  s.push(stroke(j, 'rgba(0,0,0,.06)', 5));
  // Stains / damp patches, very soft.
  for (let i = 0; i < 70; i++) {
    const x = R() * w, z = E + 300 + R() * (h - 600);
    s.push(`<ellipse cx="${f(x)}" cy="${f(z)}" rx="${f(120 + R() * 380)}" ry="${f(60 + R() * 160)}" fill="rgba(40,48,60,${(0.025 + R() * 0.03).toFixed(3)})"/>`);
  }
  // Capping beam + yellow safety edge line.
  s.push(rect(0, E, w, 95, '#C3C2BA'), rect(0, E, w, 10, '#A9A8A1'), rect(0, E + 95, w, 6, '#B2B1AA'), rect(0, E + 118, w, 22, C.hazard));
  // Fenders (cone fenders on panels) beyond the edge, bollards + cleats on the beam.
  let fend = '', pads = '', bol = '', bolHi = '', bolSh = '';
  for (let x = 750; x < w; x += 1500) {
    fend += `M${x - 110} ${E - 120}h220v120h-220Z`;
    pads += `M${x - 96} ${E - 132}h192v22h-192Z`;
  }
  for (let x = 0; x < w; x += 1500) {
    const bx = x + 20;
    bolSh += `M${bx + 26} ${E + 58}m-30 0a30 22 0 1 0 60 0a30 22 0 1 0 -60 0`;
    bol += `M${bx - 32} ${E + 16}h64v64h-64Z`;
    bolHi += `M${bx + 22} ${E + 46}a22 22 0 1 0 -44 0a22 22 0 1 0 44 0`;
  }
  s.push(path(fend, '#1C1D21'), path(pads, '#34373D'));
  s.push(path(bolSh, 'rgba(0,0,0,.14)'), path(bol, '#8F8E88'), path(bolHi, '#2A2D33'));
  for (let x = 0; x < w; x += 1500) s.push(circle(x + 20, E + 44, 11, '#4A4E56'));
  let cleat = '';
  for (let x = 750; x < w; x += 1500) cleat += `M${x - 40} ${E + 40}h80v14h-80ZM${x - 8} ${E + 30}h16v34h-16Z`;
  s.push(path(cleat, '#3A3D44'));
  // Crane rails (waterside + landside): bed, rail, clips, stops; cable trench landside.
  const rw = V(CRANE_Z), rl = rw + 2700;
  for (const z of [rw, rl]) {
    s.push(rect(0, z - 44, w, 88, '#B9B8B0'), rect(0, z - 44, w, 6, '#A6A59E'));
    let clips = '';
    for (let x = 0; x < w; x += 60) clips += `M${x} ${z - 16}h10v32h-10Z`;
    s.push(path(clips, '#8D8C85'), rect(0, z - 8, w, 16, '#6F7078'), rect(0, z - 8, w, 4, '#9EA0A7'));
  }
  s.push(rect(0, rl + 90, w, 40, '#AEADA6'), stroke(`M0 ${rl + 110}H${w}`, '#8A8983', 6, { 'stroke-dasharray': '40 20' }));
  // Bay position ticks + numbers along the waterside rail.
  let ticks = '';
  for (let x = 0, i = 1; x < w; x += 1000, i++) {
    ticks += `M${x} ${rw + 52}v${i % 5 === 0 ? 60 : 30}`;
    if (i % 5 === 0) s.push(text(x + 16, rw + 110, String(i).padStart(3, '0'), 36, 'rgba(20,22,26,.4)', { family: 'mono', 'font-weight': 600 }));
  }
  s.push(stroke(ticks, 'rgba(20,22,26,.45)', 6));
  // Lashing lane (yellow dashed) and hatch-cover laydown boxes between the waterside rail and the road.
  const roadNear = V(EXIT_Z - HALF);
  s.push(stroke(`M0 ${rw + 190}H${w}`, C.hazard, 10, { 'stroke-dasharray': '120 80' }));
  let boxes = '';
  for (let x = 1600; x < w; x += 4200) {
    if (Math.abs(x + PORT_X0 - CRANE_X) < 2600) continue; // keep the crane bay clear
    boxes += `M${x} ${rw + 260}h1300v${roadNear - rw - 330}h-1300ZM${x} ${rw + 260}l1300 ${roadNear - rw - 330}`;
  }
  s.push(stroke(boxes, 'rgba(255,255,255,.75)', 10));
  // Crane working bay: hazard-hatched leg zones at the crane position.
  {
    const cx = U(CRANE_X);
    const hatch = (x0: number, z0: number, ww: number, hh: number, id: string) => {
      let d = '';
      for (let u = -hh; u < ww; u += 50) d += `M${x0 + u} ${z0 + hh}l${hh} ${-hh}h24l${-hh} ${hh}Z`;
      return `<clipPath id="${id}"><rect x="${x0}" y="${z0}" width="${ww}" height="${hh}"/></clipPath><path d="${d}" fill="rgba(242,183,5,.65)" clip-path="url(#${id})"/>` + stroke(`M${x0} ${z0}h${ww}v${hh}h${-ww}Z`, 'rgba(242,183,5,.8)', 8);
    };
    s.push(hatch(cx - 1900, rw - 150, 700, 300, 'qh1'), hatch(cx + 1200, rw - 150, 700, 300, 'qh2'));
    s.push(hatch(cx - 1900, rl - 150, 700, 300, 'qh3'), hatch(cx + 1200, rl - 150, 700, 300, 'qh4'));
    s.push(text(cx - 1500, rw + 380, 'STS 07', 90, 'rgba(20,22,26,.28)', { 'font-weight': 800, 'letter-spacing': 6 }));
  }
  // Pedestrian walkway along the landside edge.
  const walk = h + E - 120;
  s.push(stroke(`M0 ${walk - 60}H${w}M0 ${walk + 60}H${w}`, 'rgba(255,255,255,.8)', 8));
  let zeb = '';
  for (let x = 0; x < w; x += 1200) zeb += `M${x + 300} ${walk - 40}h300v80h-300Z`;
  s.push(path(zeb, 'rgba(46,160,90,.18)'));
  // Grated drains along the landside rail.
  let dr = '', drs = '';
  for (let x = 900; x < w; x += 2400) {
    dr += `M${x} ${rl + 160}h160v60h-160Z`;
    for (let k = 0; k < 7; k++) drs += `M${x + 14 + k * 20} ${rl + 168}v44`;
  }
  s.push(path(dr, '#5E6068'), stroke(drs, '#2E3036', 6));
  // Painted bay numbers.
  for (let x = 1200, i = 1; x < w; x += 3000, i++) s.push(text(x, E + 300, `B${String(i).padStart(2, '0')}`, 90, 'rgba(20,22,26,.16)', { family: 'mono', 'font-weight': 600 }));
  return s.join('');
}

/* -------------------------------------------------------------- landside */

export const LAND = { x0: PORT_X0, x1: 46000, z0: APRON_Z1, z1: APRON_Z1 + 9400 };
/** The container yard proper starts here (west of it only the service road is paved). */
export const YARD_X0 = 7400;

/** Landside yard pavement: service road, block slots, RTG runways. Origin (x0, 0, z0). */
export function landsideArt(blocks: { x0: number; x1: number; z0: number; z1: number }[], runways: { x0: number; x1: number; z: number }[]) {
  const { x0, x1, z0, z1 } = LAND;
  const w = x1 - x0, h = z1 - z0;
  const U = (x: number) => f(x - x0), V = (z: number) => f(z - z0);
  const R = rng(55);
  // Paved area: the service road strip along the whole apron, the yard proper only
  // from YARD_X0 on (keeps the plan view under the route copy clean paper).
  const SR = 1300, yx = U(YARD_X0);
  const area = `M0 0H${w}V${h}H${yx}V${SR}H0Z`;
  const PAVE = '#E2E1DA';
  const s: string[] = [
    `<clipPath id="landclip"><path d="${area}"/></clipPath>`,
    path(area, PAVE),
    // Fade the far edge and the yard's west edge into the paper.
    `<linearGradient id="landfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.paper}" stop-opacity="0"/><stop offset="1" stop-color="${C.paper}" stop-opacity="1"/></linearGradient>`,
    `<linearGradient id="landfadeW" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="${C.paper}" stop-opacity="0"/><stop offset="1" stop-color="${C.paper}" stop-opacity="1"/></linearGradient>`,
  ];
  // Paving joints.
  let j = '';
  for (let x = 0; x < w; x += 500) j += `M${x} 0V${h}`;
  for (let z = 0; z < h; z += 500) j += `M0 ${z}H${w}`;
  s.push(`<g clip-path="url(#landclip)">${stroke(j, 'rgba(0,0,0,.035)', 4)}</g>`);
  // Service road along the fence: two white edge lines + centre dashes.
  s.push(stroke(`M0 250H${w}M0 1150H${w}`, 'rgba(255,255,255,.9)', 10), stroke(`M0 700H${w}`, 'rgba(255,255,255,.9)', 12, { 'stroke-dasharray': '300 300' }));
  // Block slot markings (white ground slots under the stacks, visible in empty rows).
  for (const b of blocks) {
    s.push(stroke(`M${U(b.x0) - 40} ${V(b.z0) - 40}H${U(b.x1) + 40}V${V(b.z1) + 40}H${U(b.x0) - 40}Z`, 'rgba(255,255,255,.95)', 12));
    let slots = '';
    for (let x = b.x0; x < b.x1; x += 1259) slots += `M${U(x)} ${V(b.z0)}V${V(b.z1)}`;
    s.push(stroke(slots, 'rgba(255,255,255,.7)', 8));
    s.push(text(U(b.x1) + 90, V(b.z0) + 160, 'C' + String(Math.floor(R() * 9) + 1), 120, 'rgba(20,22,26,.2)', { 'font-weight': 800 }));
  }
  // RTG runways: tyre-worn strips.
  for (const r of runways) s.push(rect(U(r.x0), V(r.z) - 60, r.x1 - r.x0, 120, 'rgba(0,0,0,.06)'), stroke(`M${U(r.x0)} ${V(r.z)}H${U(r.x1)}`, 'rgba(242,183,5,.55)', 10));
  // Stains.
  for (let i = 0; i < 40; i++) s.push(`<ellipse cx="${f(yx + R() * (w - yx))}" cy="${f(1400 + R() * (h - 2000))}" rx="${f(100 + R() * 300)}" ry="${f(50 + R() * 120)}" fill="rgba(40,48,60,.03)"/>`);
  s.push(rect(yx, h - 1600, w - yx, 1600, 'url(#landfade)'));
  s.push(rect(yx, SR, 1400, h - SR, 'url(#landfadeW)'));
  return s.join('');
}

/* ------------------------------------------------------------------- gate */

/**
 * Terminal gate across the exit road at x = gx: kerb islands with booths on
 * both sides, barrier arms (outer lanes closed, the truck's lane open) and an
 * OCR / sign portal. Built in world orientation; parent should be a plan node.
 */
export function terminalGate(parent: Node3, gx: number) {
  const n = parent.node('gate', [gx, 0, 0]);
  const zN = EXIT_Z + HALF, zF = EXIT_Z - HALF; // road edges (landside / waterside)
  const glass = '#3E4A58', glassHi = '#8FA3BA', wall = '#EEF0F1', roof = '#D3D7DC';
  for (const side of [1, -1]) {
    const zi = side > 0 ? zN + 40 : zF - 40 - 260; // island min z
    // Kerb island.
    const isl = rect(0, 0, 900, 22, CONC.base) + rect(0, 0, 900, 4, CONC.hi);
    let hz = '';
    for (let u = -22; u < 260; u += 26) hz += `M${u} 22l22 -22h13l-22 22Z`;
    const islEnd = `<clipPath id="gi${side}"><rect width="260" height="22"/></clipPath>` + rect(0, 0, 260, 22, '#2A2D33') + `<path d="${hz}" fill="${C.hazard}" clip-path="url(#gi${side})"/>`;
    box(n, -300, 0, zi, 900, 22, 260, {
      py: rr(0, 0, 900, 260, 60, CONC.base) + rr(10, 10, 880, 240, 52, 'none', { stroke: CONC.lo, 'stroke-width': 6 }) + rect(0, 0, 60, 260, C.hazard),
      pz: isl,
      nx: islEnd,
    }, { name: `gate.island${side}` });
    // Booth.
    const BW = 280, BD = 170, BH = 260;
    const bz = zi + 45;
    const face = (w: number) => rect(0, 0, w, BH, wall) + rect(14, 40, w - 28, 120, glass) + rect(14, 40, w - 28, 22, glassHi) + rect(0, BH - 30, w, 30, '#B5BAC1') + rect(0, 20, w, 8, C.blue);
    box(n, 0, 22, bz, BW, BH, BD, {
      pz: face(BW),
      nz: face(BW),
      nx: face(BD) + rr(BD / 2 - 30, 60, 60, 110, 4, '#2A2D33') + circle(BD / 2, 80, 12, '#D8261C') + circle(BD / 2, 110, 12, '#3A3D44') + circle(BD / 2, 140, 12, '#2FBF5A'),
      px: face(BD),
    }, { name: `gate.booth${side}`, shade: 0.5 });
    box(n, -40, 22 + BH, bz - 30, BW + 80, 16, BD + 60, {
      py: rect(0, 0, BW + 80, BD + 60, roof) + rect(0, 0, BW + 80, 10, '#B7BCC3') + rect(BW / 2, BD / 2 + 10, 90, 60, '#9CA3AB'),
      pz: rect(0, 0, BW + 80, 16, '#B7BCC3'),
      nx: rect(0, 0, BD + 60, 16, '#B7BCC3'),
    }, { name: `gate.roof${side}` });
    // Barrier arm: pivot post on the island, arm lowered across the outer lane.
    const pz = side > 0 ? zi + 20 : zi + 240;
    box(n, -250, 22, pz - 18, 36, 100, 36, {
      py: rect(0, 0, 36, 36, '#E6E8EA') + circle(18, 18, 10, '#2A2D33'),
      nx: rect(0, 0, 36, 100, '#E6E8EA') + rect(0, 70, 36, 12, '#D8261C'),
      pz: rect(0, 0, 36, 100, '#E6E8EA'),
    }, { name: `gate.post${side}` });
    const armL = 470;
    let stripes = '';
    for (let u = 0; u < armL; u += 60) stripes += `M${u} 0h30v10h-30Z`;
    const arm = rect(0, 0, armL, 10, '#FFFFFF') + path(stripes, '#D8261C');
    const az0 = side > 0 ? pz - armL : pz;
    box(n, -240, 110, az0, 12, 10, armL, {
      py: `<g transform="rotate(90) translate(0 -12)">${arm}</g>`,
      nx: arm,
    }, { name: `gate.arm${side}` });
  }
  // OCR / sign portal spanning the road (sign faces the approaching truck, −X).
  const portal = n.node('gate-portal', [-420, 0, zF - 160]);
  portal.r.y = -90;
  signGantry(portal, 'gate-gantry', [0, 0, 0], zN - zF + 320, [
    { x: 160, w: 760, top: 'NAVAIR TERMINAL', sub: 'Gate 3 · OCR lane · Keep 10 km/h', arrow: 'up' },
  ]);
  return n;
}

/* ------------------------------------------------------------- yard deck */

/** Stack-chapter yard deck: concrete panels, painted slot grid, drains, stains. Art w × h. */
export function yardDeckArt(w: number, h: number, x0: number, z0: number) {
  const R = rng(91);
  const U = (x: number) => x - x0, V = (z: number) => z - z0;
  const s: string[] = [rect(0, 0, w, h, C.paper2)];
  let tone = '';
  for (let x = 0; x < w; x += 600) for (let z = 0; z < h; z += 600) if (R() < 0.14) tone += `M${x} ${z}h600v600h-600Z`;
  s.push(path(tone, 'rgba(0,0,0,.02)'));
  let j = '';
  for (let x = 0; x <= w; x += 600) j += `M${x} 0V${h}`;
  for (let z = 0; z <= h; z += 600) j += `M0 ${z}H${w}`;
  s.push(stroke(j, 'rgba(0,0,0,.05)', 5));
  // Slot grid for 40' boxes around the stack (rows along X, boxes end-on along Z).
  let slots = '';
  for (let k = -4; k <= 5; k++) {
    const x = U(k * (262) - 131);
    slots += `M${f(x)} ${V(-800)}v${1600}`;
  }
  slots += `M${U(-4 * 262 - 131)} ${V(-800)}H${U(5 * 262 - 131)}M${U(-4 * 262 - 131)} ${V(800)}H${U(5 * 262 - 131)}`;
  s.push(stroke(slots, 'rgba(255,255,255,.95)', 10));
  // Hero bay outline (hazard yellow) and row label.
  const bx = U(-300), bz = V(-900);
  s.push(stroke(`M${bx} ${bz}h1000v1800h-1000Z`, C.hazard, 14));
  s.push(text(bx + 30, bz + 1780, 'YARD 04 · ROW C', 70, 'rgba(20,22,26,.22)', { family: 'mono', 'font-weight': 600 }));
  // Reach-stacker lane: dashed yellow edge lines in front of the stack.
  s.push(stroke(`M${U(-9000)} ${V(1300)}H${U(4000)}M${U(-9000)} ${V(-1500)}H${U(4000)}`, 'rgba(242,183,5,.7)', 10, { 'stroke-dasharray': '160 120' }));
  // Grated trench drain across the deck.
  let slotsD = '';
  for (let x = 0; x < w; x += 24) slotsD += `M${x} ${V(-3200) + 6}v28`;
  s.push(rect(0, V(-3200), w, 40, '#8F9097'), stroke(slotsD, '#3A3C42', 8));
  // Puddles (subtle, cool) and oil stains.
  for (let i = 0; i < 14; i++) {
    const x = R() * w, z = R() * h;
    s.push(`<ellipse cx="${f(x)}" cy="${f(z)}" rx="${f(160 + R() * 380)}" ry="${f(70 + R() * 150)}" fill="rgba(120,140,165,.10)"/>`);
  }
  for (let i = 0; i < 26; i++) s.push(`<ellipse cx="${f(R() * w)}" cy="${f(R() * h)}" rx="${f(30 + R() * 90)}" ry="${f(20 + R() * 50)}" fill="rgba(30,32,38,.05)"/>`);
  // Tyre tracks of the reach stacker (soft arcs).
  s.push(stroke(`M${U(-8000)} ${V(700)}C${U(-4000)} ${V(700)} ${U(-2600)} ${V(300)} ${U(-1500)} ${V(-200)}M${U(-8000)} ${V(1000)}C${U(-4000)} ${V(1000)} ${U(-2500)} ${V(600)} ${U(-1300)} ${V(100)}`, 'rgba(30,32,38,.05)', 60));
  return s.join('');
}

