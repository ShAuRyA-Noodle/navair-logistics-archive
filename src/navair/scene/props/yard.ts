/**
 * Logistics buildings and container-yard props: warehouses with loading docks,
 * parked trailers, container blocks (RTG yard feel), rubber-tyred gantries and
 * a distant port skyline.
 *
 * Local frame: the front of every object faces local +X (the road / camera).
 * The node origin is the object's ground contact point nearest the road.
 */

import { Node3, box, splitFace } from '../../engine/engine';
import { circle, path, rect, rr, stroke, text } from '../../engine/art';
import { lum, shade, tint } from '../../engine/color';
import type { V3 } from '../../engine/math';
import { BOX, C } from '../../world';
import { CONC, haze } from './street';

const f = (n: number) => Math.round(n * 10) / 10;

export const BOX_TONES = [C.boxNavy, C.boxOrange, C.boxWhite, C.boxGrey, C.boxSky, C.boxRed, C.boxGreen, C.boxMustard, C.boxPink, '#2F3B45', '#6B2F2A'];

/* -------------------------------------------------------- container faces */

/** Door end of a container (lite), W × H at (x, y). */
export function boxEnd(x: number, y: number, base: string, hz = 0) {
  const b = haze(base, hz);
  const light = lum(base) > 0.45;
  const rail = haze(shade(base, light ? 0.22 : 0.32), hz);
  const bar = haze(light ? '#5B6068' : shade(base, 0.5), hz);
  const W = BOX.W, H = BOX.H;
  let bars = '';
  for (const bx of [34, 84, W - 84, W - 34]) bars += `M${f(x + bx - 2.5)} ${f(y + 22)}h5v${H - 44}h-5Z`;
  return (
    rect(x, y, W, H, b) +
    rect(x, y, W, 20, rail) + rect(x, y + H - 18, W, 18, rail) +
    rect(x, y, 11, H, rail) + rect(x + W - 11, y, 11, H, rail) +
    rect(x + W / 2 - 1.5, y + 20, 3, H - 38, shade(b, 0.4)) +
    path(bars, bar) +
    rect(x + 11, y + 20, W - 22, 8, 'rgba(255,255,255,.08)')
  );
}

/** Long side of a container (lite), L × H at (x, y). */
export function boxSide(x: number, y: number, base: string, hz = 0, L: number = BOX.L) {
  const b = haze(base, hz);
  const light = lum(base) > 0.45;
  const rail = haze(shade(base, light ? 0.2 : 0.3), hz);
  const fl = haze(tint(base, light ? 0.3 : 0.12), hz), fd = haze(shade(base, light ? 0.12 : 0.24), hz);
  let L1 = '', D1 = '';
  for (let u = 20; u < L - 20; u += 42) {
    L1 += `M${f(x + u)} ${f(y + 14)}h14v${BOX.H - 30}h-14Z`;
    D1 += `M${f(x + u + 22)} ${f(y + 14)}h7v${BOX.H - 30}h-7Z`;
  }
  return rect(x, y, L, BOX.H, b) + path(L1, fl) + path(D1, fd) + rect(x, y, L, 13, rail) + rect(x, y + BOX.H - 16, L, 16, rail) + rect(x, y, 13, BOX.H, rail) + rect(x + L - 13, y, 13, BOX.H, rail);
}

/** Roof of a container seen from above, L × W at (x, y). */
export function boxRoof(x: number, y: number, base: string, hz = 0, L: number = BOX.L) {
  const b = haze(tint(base, 0.06), hz);
  const fl = haze(tint(base, 0.18), hz);
  let d = '';
  for (let u = 24; u < L - 24; u += 60) d += `M${f(x + u)} ${f(y + 10)}h18v${BOX.W - 20}h-18Z`;
  return rect(x, y, L, BOX.W, b) + path(d, fl) + rect(x, y, L, 8, shade(b, 0.18)) + rect(x, y + BOX.W - 8, L, 8, shade(b, 0.18)) + rect(x, y, 12, BOX.W, shade(b, 0.12)) + rect(x + L - 12, y, 12, BOX.W, shade(b, 0.12));
}

/* --------------------------------------------------------- container block */

export interface BlockOpts {
  rows: number;
  bays: number;
  /** Tier count per row (length = rows). */
  tiers: number[];
  seed?: () => number;
  haze?: number;
  /** Also draw the +Z long side of the last row (for 3/4 views). */
  side?: boolean;
  /** Split long faces for depth sorting (bays per segment). */
  seg?: number;
}

/**
 * A yard block of 40' boxes, long axis along local −X (away from the road),
 * rows stacked along Z (row 0 at the lowest z). Node origin = front (+X) edge,
 * block z centre, on the ground.
 */
export function yardBlock(parent: Node3, name: string, p: V3, o: BlockOpts) {
  const n = parent.node(name, p);
  const R = o.seed ?? Math.random;
  const hz = o.haze ?? 0;
  const pitchZ = BOX.W + 30, pitchX = BOX.L + 40;
  const depth = o.bays * pitchX;
  const width = o.rows * pitchZ;
  const z0 = -width / 2;
  for (let r = 0; r < o.rows; r++) {
    const t = o.tiers[r];
    if (t <= 0) continue;
    const zr = z0 + r * pitchZ;
    // Front end: the nearest bay's door ends.
    let end = '';
    const cols: string[] = [];
    for (let k = 0; k < t; k++) {
      const c = BOX_TONES[Math.floor(R() * BOX_TONES.length)];
      cols.push(c);
      end += boxEnd(0, (t - 1 - k) * BOX.H, c, hz);
    }
    // Roof: top tier of every bay.
    let roof = '';
    for (let b = 0; b < o.bays; b++) roof += boxRoof(b * pitchX + 20, 0, b === 0 ? cols[t - 1] : BOX_TONES[Math.floor(R() * BOX_TONES.length)], hz);
    box(n, -depth, 0, zr, depth, t * BOX.H, BOX.W, {
      px: end,
    }, { name: `${name}.r${r}` });
    const seg = Math.max(1, Math.ceil(o.bays / (o.seg ?? 3)));
    splitFace(n, { o: [-depth, t * BOX.H, zr], a: [1, 0, 0], b: [0, 0, 1], w: depth, h: BOX.W, art: `<g transform="translate(${depth} 0) scale(-1 1)">${roof}</g>`, name: `${name}.r${r}.top` }, seg);
    const sideArt = () => {
      let side = '';
      for (let b = 0; b < o.bays; b++) for (let k = 0; k < t; k++) side += boxSide(b * pitchX + 20, (t - 1 - k) * BOX.H, BOX_TONES[Math.floor(R() * BOX_TONES.length)], hz);
      return side;
    };
    if (o.side && r === o.rows - 1) {
      // +Z long side (u along +X from the back, so mirror to keep bay 0 at the front).
      splitFace(n, { o: [-depth, t * BOX.H, zr + BOX.W], a: [1, 0, 0], b: [0, -1, 0], w: depth, h: t * BOX.H, art: `<g transform="translate(${depth} 0) scale(-1 1)">${sideArt()}</g>`, name: `${name}.r${r}.side` }, seg);
    }
    if (o.side && r === 0) {
      // −Z long side (u along −X from the front).
      splitFace(n, { o: [0, t * BOX.H, zr], a: [-1, 0, 0], b: [0, -1, 0], w: depth, h: t * BOX.H, art: sideArt(), name: `${name}.r${r}.sideN` }, seg);
    }
  }
  return { node: n, depth, width };
}

/* --------------------------------------------------------------------- RTG */

/**
 * Rubber-tyred gantry crane straddling `span` along Z, NAVAIR white/blue.
 * Origin: centre of the near (+X) leg frame on the ground. Legs frames at z = ±span/2.
 */
export function rtg(parent: Node3, name: string, p: V3, o: { span?: number; H?: number; haze?: number; trolleyZ?: number; hoist?: number } = {}) {
  const n = parent.node(name, p);
  const span = o.span ?? 2350, H = o.H ?? 1950, hz = o.haze ?? 0;
  const wh = haze('#EEF0F2', hz), whLo = haze('#C9CDD3', hz), whDk = haze('#A7ADB5', hz);
  const blue = haze(C.blue, hz), dark = haze('#2B2F36', hz), rub = haze('#1C1D21', hz), yel = haze(C.hazard, hz);
  const LEGW = 80, FRAME = 1500; // leg section, leg-frame length along X
  const hazardBand = (w: number, y: number) => {
    let d = '';
    for (let u = -20; u < w; u += 24) d += `M${u} ${y + 30}l12 -30h12l-12 30Z`;
    return `<clipPath id="${name}hb${y}"><rect x="0" y="${y}" width="${w}" height="30"/></clipPath>` + rect(0, y, w, 30, dark) + `<path d="${d}" fill="${yel}" clip-path="url(#${name}hb${y})"/>`;
  };
  for (const s of [-1, 1]) {
    const zc = (s * span) / 2;
    // Legs: near and far, each a tall box; near leg px visible, both pz/nz for 3/4.
    const LH = H - 120;
    for (const lx of [0, -FRAME]) {
      const leg =
        rect(0, 0, LEGW, LH, wh) + rect(0, 0, 14, LH, 'rgba(255,255,255,.5)') + rect(LEGW - 16, 0, 16, LH, whLo) +
        rect(0, LH * 0.18, LEGW, 10, blue) + hazardBand(LEGW, LH - 150);
      box(n, lx - LEGW / 2, 120, zc - LEGW / 2, LEGW, LH, LEGW, lx === 0 ? { px: leg, pz: leg, nz: leg } : { pz: leg, nz: leg }, { name: `${name}.leg` });
    }
    // Sill beam + wheel bogies.
    const sill = rect(0, 0, FRAME + 300, 60, whLo) + rect(0, 0, FRAME + 300, 8, wh) +
      circle(80, 90, 32, rub) + circle(80, 90, 12, whDk) + circle(220, 90, 32, rub) + circle(220, 90, 12, whDk) +
      circle(FRAME + 80, 90, 32, rub) + circle(FRAME + 80, 90, 12, whDk) + circle(FRAME + 220, 90, 32, rub) + circle(FRAME + 220, 90, 12, whDk);
    box(n, -FRAME - 150, 0, zc - 45, FRAME + 300, 122, 90, {
      pz: sill, nz: sill,
      px: rect(0, 0, 90, 60, whLo) + rr(10, 58, 70, 64, 10, rub),
      py: rect(0, 0, FRAME + 300, 90, wh),
    }, { name: `${name}.sill` });
  }
  // Top girders spanning Z (near & far) + end ties.
  const G = 130;
  const girder = rect(0, 0, span + LEGW + 60, G, wh) + rect(0, 0, span + LEGW + 60, 12, 'rgba(255,255,255,.6)') + rect(0, G - 26, span + LEGW + 60, 26, whLo) +
    rect(0, 40, span + LEGW + 60, 12, blue) + text((span + LEGW + 60) / 2, 34, 'NAVAIR', 26, blue, { 'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 3 });
  for (const lx of [0, -FRAME]) {
    box(n, lx - 50, H, -span / 2 - LEGW / 2 - 30, 100, G, span + LEGW + 60, lx === 0 ? { px: girder, py: rect(0, 0, 100, span + LEGW + 60, wh) } : { py: rect(0, 0, 100, span + LEGW + 60, wh) }, { name: `${name}.girder` });
  }
  // Trolley on the girders + spreader on ropes.
  const tz = o.trolleyZ ?? span * 0.18;
  const TW = 420, TH = 150;
  const hoist = o.hoist ?? 900; // spreader bottom height
  const ropeH = H - hoist;
  const trolley =
    rr(0, 0, TW, TH, 6, wh) + rect(0, 0, TW, 14, 'rgba(255,255,255,.6)') + rect(0, TH - 20, TW, 20, whLo) +
    rect(24, 30, 90, 60, haze('#3A4450', hz)) + rect(30, 36, 78, 22, haze('#7F95AE', hz)) + // cab glazing
    rect(140, 40, 250, 12, blue) +
    // Ropes + spreader (hangs below the girder).
    stroke(`M${TW / 2 - 90} ${TH + G}V${TH + G + ropeH - 20}M${TW / 2 + 90} ${TH + G}V${TH + G + ropeH - 20}`, dark, 3) +
    rect(TW / 2 - 200, TH + G + ropeH - 30, 400, 34, yel) + rect(TW / 2 - 200, TH + G + ropeH - 30, 400, 8, shade(C.hazard, 0.2)) +
    rect(TW / 2 - 60, TH + G + ropeH - 56, 120, 28, dark);
  box(n, -FRAME / 2 - 380, H + G, tz - TW / 2, 760, TH, TW, {
    px: trolley,
    py: rect(0, 0, 760, TW, wh) + rect(40, 40, 300, TW - 80, whLo) + rect(420, 60, 280, TW - 120, haze('#DDE1E5', hz)) + circle(560, TW / 2, 40, whDk),
    pz: rr(0, 0, 760, TH, 6, wh) + rect(0, TH - 20, 760, 20, whLo) + rect(40, 40, 680, 12, blue),
  }, { name: `${name}.trolley` });
  // Engine house on one leg frame.
  box(n, -FRAME / 2 - 250, 420, span / 2 + LEGW / 2, 500, 260, 160, {
    px: rect(0, 0, 160, 260, whLo) + rect(20, 30, 120, 90, haze('#8C939C', hz)) + stroke('M30 150H130M30 170H130M30 190H130', whDk, 5),
    pz: rect(0, 0, 500, 260, wh) + rect(0, 0, 500, 10, 'rgba(255,255,255,.6)') + rect(30, 40, 180, 110, haze('#9AA2AC', hz)) + stroke('M240 60H470M240 90H470M240 120H470', whDk, 6) + rect(0, 200, 500, 14, blue),
    py: rect(0, 0, 500, 160, wh) + circle(400, 80, 36, whDk),
  }, { name: `${name}.house` });
  return n;
}

/* --------------------------------------------------------------- warehouse */

export interface WarehouseOpts {
  /** Facade length along Z (cm). */
  len: number;
  /** Eave height. */
  H: number;
  /** Depth along −X. */
  depth: number;
  docks?: number;
  name2?: string;
  haze?: number;
  tone?: string;
  seed?: () => number;
  /** Draw the +Z gable side (for yaw < 90 views) and roof. */
  full?: boolean;
}

/**
 * Distribution warehouse: plinth, profiled cladding with a NAVAIR band, a row
 * of dock doors with shelters, bumpers, dock lights, numbers and a canopy, an
 * office block with glazing at one end. Front faces +X, origin at the front
 * facade centre on the ground.
 */
export function warehouse(parent: Node3, name: string, p: V3, o: WarehouseOpts) {
  const n = parent.node(name, p);
  const hz = o.haze ?? 0, L = o.len, H = o.H, D = o.depth;
  const tone = haze(o.tone ?? '#D6DADF', hz);
  const rib = haze(shade(o.tone ?? '#D6DADF', 0.07), hz);
  const plinthC = haze(CONC.base, hz), plinthLo = haze(CONC.lo, hz);
  const blue = haze(C.blue, hz), ink = haze('#2A2E35', hz), rubber = haze('#1E2024', hz);
  const glass = haze('#44505E', hz), glassHi = haze('#7F92A8', hz);
  const PL = 120; // plinth / dock height
  const office = Math.min(1400, L * 0.22);
  const id = `${name}rib`;
  let s =
    `<pattern id="${id}" patternUnits="userSpaceOnUse" width="32" height="40"><rect width="32" height="40" fill="${tone}"/><rect x="0" width="7" height="40" fill="${rib}"/><rect x="7" width="2" height="40" fill="${haze('#E9ECEF', hz)}"/></pattern>` +
    rect(0, 0, L, H, `url(#${id})`) +
    // Parapet coping + NAVAIR band.
    rect(0, 0, L, 18, haze('#8E959E', hz)) + rect(0, 18, L, 4, haze('#FFFFFF', hz * 0.6)) +
    rect(0, 70, L - office, 22, blue) +
    text(90, 58, o.name2 ?? 'NAVAIR LOGISTICS', 46, blue, { 'font-weight': 800, style: 'font-stretch:112%', 'letter-spacing': 1 }) +
    // Plinth.
    rect(0, H - PL, L, PL, plinthC) + rect(0, H - PL, L, 5, haze(CONC.hi, hz)) + rect(0, H - 10, L, 10, plinthLo);
  // Docks.
  const docks = o.docks ?? Math.max(2, Math.floor((L - office - 400) / 420));
  const dx0 = 260, pitch = (L - office - dx0 - 200) / docks;
  const DW = 300, DH = 300;
  let doors = '', shelters = '', bumpers = '', lights = '', nums = '';
  for (let i = 0; i < docks; i++) {
    const x = dx0 + i * pitch;
    const y = H - PL - DH;
    shelters += `M${f(x - 22)} ${f(y - 26)}h${DW + 44}v${DH + 26}h-22v-${DH}h-${DW}v${DH}h-22Z`;
    doors += rect(x, y, DW, DH, haze('#B9BFC7', hz));
    let seams = '';
    for (let k = 1; k < 6; k++) seams += `M${f(x)} ${f(y + k * 50)}h${DW}`;
    doors += stroke(seams, haze('#9AA1AA', hz), 3) + rect(x + 30, y + 110, DW - 60, 18, haze('#6D7682', hz));
    bumpers += `M${f(x + 30)} ${f(H - PL + 10)}h30v46h-30ZM${f(x + DW - 60)} ${f(H - PL + 10)}h30v46h-30Z`;
    lights += `M${f(x + DW + 30)} ${f(y + 20)}h10v40h-10Z`;
    nums += circle(x + DW / 2, y - 56, 22, haze('#FFFFFF', hz * 0.8)) + text(x + DW / 2, y - 47, String(i + 1).padStart(2, '0'), 22, ink, { 'text-anchor': 'middle', 'font-weight': 800 });
  }
  s += doors + path(shelters, rubber) + path(bumpers, rubber) + path(lights, haze('#5A616B', hz)) + nums;
  // Canopy over the dock run (seen edge-on in elevation as a band with a shadow).
  const cy = H - PL - DH - 110;
  s += rect(dx0 - 80, cy, L - office - dx0 - 40, 16, haze('#6F7780', hz)) + rect(dx0 - 80, cy + 16, L - office - dx0 - 40, 30, 'rgba(0,0,0,.08)');
  // Downpipes.
  for (let x = 120; x < L - office; x += 1800) s += rect(x, 22, 10, H - PL - 22, haze('#9AA1AA', hz));
  // Office block at the far end (+u end = −Z): glazing bands, entrance.
  const ox = L - office;
  s +=
    rect(ox, 0, office, H, haze('#E7EAED', hz)) + rect(ox, 0, 10, H, haze('#BFC5CC', hz)) +
    rect(ox + 60, 150, office - 120, 150, glass) + rect(ox + 60, 150, office - 120, 26, glassHi) +
    rect(ox + 60, 360, office - 120, 150, glass) + rect(ox + 60, 360, office - 120, 26, glassHi) +
    stroke(Array.from({ length: Math.floor((office - 120) / 120) }, (_, i) => `M${ox + 60 + (i + 1) * 120} 150v150M${ox + 60 + (i + 1) * 120} 360v150`).join(''), haze('#2F3843', hz), 5) +
    rect(ox + office / 2 - 120, H - 280, 240, 280, glass) + rect(ox + office / 2 - 150, H - 300, 300, 22, haze('#3A4048', hz)) +
    rect(ox + 60, 100, office - 120, 14, blue);
  // Facade: split so parked trailers and lamps sort against it locally.
  const segs = Math.max(1, Math.round(L / 2400));
  splitFace(n, { o: [0, H, L / 2], a: [0, 0, -1], b: [0, -1, 0], w: L, h: H, art: s, name: `${name}.front`, shade: 0.35 }, segs);
  if (o.full) {
    // Roof: standing seam, ridge vents, skylights.
    // Roof art: u along +Z (length L, u = 0 at the −Z / office end), v along −X (depth D).
    const rid = `${name}rf`;
    const edge = haze('#8E959E', hz);
    const roof =
      `<pattern id="${rid}" patternUnits="userSpaceOnUse" width="60" height="60"><rect width="60" height="60" fill="${haze('#C3C8CE', hz)}"/><rect width="8" height="60" fill="${haze('#B0B6BD', hz)}"/></pattern>` +
      rect(0, 0, L, D, `url(#${rid})`) +
      Array.from({ length: Math.floor((L - office) / 900) }, (_, i) => rect(office + 300 + i * 900, D * 0.3, 160, D * 0.4, haze('#DCE6EE', hz)) + rect(office + 300 + i * 900, D * 0.3, 30, D * 0.4, haze('#AFC0CF', hz))).join('') +
      rect(0, 0, L, 20, edge) + rect(0, D - 20, L, 20, edge) + rect(0, 0, 20, D, edge) + rect(L - 20, 0, 20, D, edge) + rect(office, 0, 14, D, edge) +
      // Rooftop plant on the office block.
      rect(200, D * 0.25, 300, 240, haze('#9CA3AB', hz)) + circle(350, D * 0.25 + 120, 70, haze('#7C848D', hz));
    splitFace(n, { o: [0, H, -L / 2], a: [0, 0, 1], b: [-1, 0, 0], w: L, h: D, art: roof, name: `${name}.roof`, shade: 0 }, segs);
    // Gable end facing +Z.
    const gable =
      `<pattern id="${id}g" patternUnits="userSpaceOnUse" width="32" height="40"><rect width="32" height="40" fill="${tone}"/><rect x="0" width="7" height="40" fill="${rib}"/></pattern>` +
      rect(0, 0, D, H, `url(#${id}g)`) + rect(0, 0, D, 18, haze('#8E959E', hz)) + rect(0, H - PL, D, PL, plinthC) + rect(0, 70, D, 22, blue) +
      rect(D * 0.6, H - 380, 360, 380 - 0, haze('#B9BFC7', hz));
    n.face({ o: [-D, H, L / 2], a: [1, 0, 0], b: [0, -1, 0], w: D, h: H, art: gable, name: `${name}.gable`, shade: 0.6 });
  }
  return n;
}

/* ---------------------------------------------------------- parked trailer */

/**
 * Container trailer parked nose-out (rear against a dock at local x = 0,
 * nose toward +X), with landing legs down. Origin: dock end, centreline.
 */
export function parkedTrailer(parent: Node3, name: string, p: V3, base: string, o: { haze?: number; reefer?: boolean } = {}) {
  const n = parent.node(name, p);
  const hz = o.haze ?? 0;
  const L = BOX.L + 60, deck = 128;
  const steel = haze('#2B2E34', hz), tyre = haze('#17181B', hz), rim = haze('#9AA0A8', hz);
  // Front view: box front end on the chassis, landing legs, gooseneck.
  const W = BOX.W;
  const front =
    boxEnd(0, 0, base, hz) +
    rect(-6, BOX.H, W + 12, 22, steel) + // gooseneck front beam
    rect(40, BOX.H + 22, 14, deck - 22 - 6, haze('#3C4047', hz)) + rect(W - 54, BOX.H + 22, 14, deck - 22 - 6, haze('#3C4047', hz)) +
    rect(30, BOX.H + deck - 8, 34, 8, steel) + rect(W - 64, BOX.H + deck - 8, 34, 8, steel) +
    rect(54, BOX.H + 50, W - 108, 8, haze('#3C4047', hz)) +
    (o.reefer ? rr(24, 30, W - 48, 150, 8, haze('#E3E6E9', hz)) + rect(40, 50, W - 80, 60, haze('#5E6772', hz)) + stroke('M44 130H200M44 145H200', haze('#9AA2AC', hz), 5) : '');
  box(n, 0, 0, -W / 2, L, BOX.H + deck, W, {
    px: front,
    pz:
      boxSide(60, 0, base, hz) + rect(0, BOX.H, L, 26, steel) +
      circle(160, BOX.H + deck - 52, 52, tyre) + circle(160, BOX.H + deck - 52, 22, rim) + circle(290, BOX.H + deck - 52, 52, tyre) + circle(290, BOX.H + deck - 52, 22, rim) + circle(420, BOX.H + deck - 52, 52, tyre) + circle(420, BOX.H + deck - 52, 22, rim) +
      rect(L - 260, BOX.H + 22, 14, deck - 28, haze('#3C4047', hz)),
    py: boxRoof(60, 0, base, hz),
  }, { name: `${name}` });
  return n;
}

/* -------------------------------------------------------- terminal office */

/** Low office / gate building with glazing and a flat roof. Front faces +X. */
export function office(parent: Node3, name: string, p: V3, o: { len: number; H: number; depth: number; haze?: number; label?: string }) {
  const n = parent.node(name, p);
  const hz = o.haze ?? 0, L = o.len, H = o.H, D = o.depth;
  const wall = haze('#EEF0F1', hz), glass = haze('#3E4A58', hz), glassHi = haze('#8497AD', hz), blue = haze(C.blue, hz);
  let s = rect(0, 0, L, H, wall) + rect(0, 0, L, 16, haze('#A9AFB6', hz));
  const floors = Math.max(1, Math.floor((H - 60) / 360));
  for (let k = 0; k < floors; k++) {
    const y = 70 + k * 360;
    s += rect(40, y, L - 80, 200, glass) + rect(40, y, L - 80, 40, glassHi) +
      stroke(Array.from({ length: Math.floor((L - 80) / 150) }, (_, i) => `M${40 + (i + 1) * 150} ${y}v200`).join(''), haze('#26303A', hz), 6);
  }
  s += rect(0, H - 14, L, 14, haze(CONC.lo, hz)) + rect(40, 36, L * 0.4, 14, blue);
  if (o.label) s += text(40, 30, o.label, 22, blue, { 'font-weight': 800, 'letter-spacing': 2 });
  box(n, -D, 0, -L / 2, D, H, L, {
    px: s,
    pz: rect(0, 0, D, H, shade(wall, 0.04)) + rect(0, 0, D, 16, haze('#A9AFB6', hz)) + rect(D * 0.2, 70, D * 0.6, 200, glass),
    py: rect(0, 0, D, L, haze('#C9CDD2', hz)) + rect(10, 10, D - 20, L - 20, 'none', { stroke: haze('#AEB4BB', hz), 'stroke-width': 10 }) + rect(D * 0.3, L * 0.3, 240, 180, haze('#9CA3AB', hz)),
  }, { name, shade: 0.5 });
  return n;
}

/* ---------------------------------------------------------------- skyline */

/**
 * Distant port skyline: flat silhouettes on one face each (STS cranes, silos,
 * sheds, high masts), strongly hazed toward the paper. Face lies in local
 * plane x = 0 facing +X, running along −Z from z = 0.
 */
export function skyline(parent: Node3, name: string, p: V3, kind: 'sts' | 'silo' | 'shed' | 'masts' | 'stack', o: { haze: number; w?: number; seed?: () => number }) {
  const n = parent.node(name, p);
  const hz = o.haze;
  const c = haze('#8A929C', hz), lo = haze('#707883', hz), hi = haze('#A9B0B8', hz), blue = haze(C.blue, Math.min(0.95, hz + 0.1));
  let w = o.w ?? 3000, h = 0, art = '';
  if (kind === 'sts') {
    // Quay crane, boom lowered, seen side-on: legs, portal, boom + backreach, A-frame.
    w = 7200; h = 7600;
    const g = 4300; // portal top
    art =
      path(`M2400 ${h}L2560 ${h - g}H2700L2620 ${h}ZM4200 ${h}L4120 ${h - g}H4260L4420 ${h}Z`, c) +
      rect(2300, h - g - 260, 2200, 260, hi) + rect(2300, h - g - 60, 2200, 60, lo) +
      // Boom (waterside, to the left) and backreach.
      path(`M0 ${h - g - 700}H7000V${h - g - 480}H0Z`, c) + rect(0, h - g - 720, 7000, 40, hi) +
      // A-frame + stays.
      stroke(`M3050 ${h - g - 700}L3400 ${200}L3800 ${h - g - 700}M3400 200L400 ${h - g - 700}M3400 200L6600 ${h - g - 700}`, c, 70) +
      rect(3150, h - g - 1100, 700, 400, lo) + rect(3180, h - g - 1070, 640, 80, blue) + // machinery house
      rect(1400, h - g - 480, 520, 300, lo); // trolley + cab
  } else if (kind === 'silo') {
    w = 3000; h = 3600;
    for (let i = 0; i < 3; i++) {
      const x = i * 1000;
      art += rect(x, 700, 900, h - 700, i % 2 ? c : hi) + path(`M${x} 700Q${x + 450} 420 ${x + 900} 700Z`, i % 2 ? c : hi) + rect(x + 420, 300, 60, 400, lo) + stroke(`M${x} 1400H${x + 900}M${x} 2200H${x + 900}M${x} 3000H${x + 900}`, lo, 18);
    }
    art += rect(-200, 250, w + 400, 90, lo) + rect(w + 100, 250, 140, h - 250, lo);
  } else if (kind === 'shed') {
    w = o.w ?? 9000; h = 1500;
    art = path(`M0 ${h}V300L${w / 2} 80L${w} 300V${h}Z`, hi) + rect(0, 300, w, 40, lo) + rect(0, h - 400, w, 30, blue);
    for (let x = 400; x < w - 500; x += 900) art += rect(x, h - 380, 500, 380, lo);
  } else if (kind === 'stack') {
    // Distant container stacks: stepped blocks with coloured tiers.
    const R = o.seed ?? Math.random;
    w = o.w ?? 8000; h = 1200;
    let x = 0;
    while (x < w) {
      const bw = 900 + R() * 1400, t = 1 + Math.floor(R() * 4);
      for (let k = 0; k < t; k++) {
        const col = haze(BOX_TONES[Math.floor(R() * BOX_TONES.length)], hz);
        art += rect(x, h - (k + 1) * 290, bw, 284, col) + rect(x, h - (k + 1) * 290, bw, 30, 'rgba(255,255,255,.18)');
      }
      x += bw + 60 + R() * 300;
    }
  } else {
    // High masts: three thin masts with crowns.
    w = o.w ?? 6000; h = 3000;
    for (const x of [300, w / 2, w - 300]) art += path(`M${x - 40} ${h}L${x - 14} 90H${x + 14}L${x + 40} ${h}Z`, c) + rect(x - 150, 40, 300, 60, lo) + rect(x - 130, 50, 260, 30, haze('#FFF4CF', Math.min(0.95, hz + 0.1)));
  }
  n.face({ o: [0, h, 0], a: [0, 0, -1], b: [0, -1, 0], w, h, art, name: `${name}.sky`, shade: 0, layer: -1 });
  return n;
}
