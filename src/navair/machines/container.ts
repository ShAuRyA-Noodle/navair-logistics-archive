/**
 * ISO 40' high-cube container, all six faces drawn.
 * Node origin: centre of the floor. x ∈ [−L/2, L/2], y ∈ [0, H], z ∈ [−W/2, W/2].
 * Doors are on the +X end.
 */

import { Node3, box, splitFace } from '../engine/engine';
import { casting, flutes, rect, rr, text } from '../engine/art';
import { lum, shade, tint } from '../engine/color';
import { BOX, C } from '../world';

export interface Livery {
  base: string;
  /** Owner code, e.g. "NAVU". */
  code?: string;
  serial?: string;
  /** Large wordmark on the side walls. */
  mark?: string;
  markColor?: string;
  /** Simplified art (ship-deck boxes seen from afar). */
  lite?: boolean;
}

export const LIVERY = {
  hero: { base: C.boxWhite, code: 'NAVU', serial: '400 117 2', mark: 'NAVAIR', markColor: C.blue },
  navy: { base: C.boxNavy, code: 'NAVU', serial: '118 402 6' },
  orange: { base: C.boxOrange, code: 'NAVU', serial: '227 031 9' },
  grey: { base: C.boxGrey, code: 'TRLU', serial: '551 870 4' },
} satisfies Record<string, Livery>;

function tones(base: string) {
  const light = lum(base) > 0.5;
  return {
    base,
    flL: tint(base, light ? 0.35 : 0.14),
    flD: shade(base, light ? 0.12 : 0.24),
    rail: shade(base, light ? 0.2 : 0.3),
    post: shade(base, light ? 0.1 : 0.18),
    ink: light ? '#2A2D33' : tint(base, 0.78),
    faint: light ? 'rgba(20,22,26,.55)' : 'rgba(255,255,255,.6)',
  };
}

const L = BOX.L, W = BOX.W, H = BOX.H;

export function sideArt(lv: Livery, doorsRight = true) {
  const t = tones(lv.base);
  const out: string[] = [rect(0, 0, L, H, t.base)];
  if (!lv.lite) out.push(flutes(14, 13, L - 28, H - 30, 27.4, t.flL, t.flD));
  else out.push(flutes(14, 13, L - 28, H - 30, 54.8, t.flL, t.flD, { lightW: 18, darkW: 8 }));
  // Top and bottom side rails.
  out.push(rect(0, 0, L, 13, t.rail), rect(0, 0, L, 3.2, tint(t.rail, 0.18)));
  out.push(rect(0, H - 17, L, 17, t.rail), rect(0, H - 4, L, 4, shade(t.rail, 0.3)));
  // Corner posts.
  out.push(rect(0, 0, 14, H, t.post), rect(L - 14, 0, 14, H, t.post));
  // Castings.
  out.push(casting(-1, -0.5), casting(L - 16.8, -0.5), casting(-1, H - 11.3), casting(L - 16.8, H - 11.3));
  if (!lv.lite) {
    // Forklift-free 40' has no pockets; lashing D-rings along the bottom rail.
    for (let i = 1; i < 6; i++) out.push(rr((L / 6) * i - 6, H - 15, 12, 8, 2, shade(t.rail, 0.35)));
    const docEnd = doorsRight ? L - 140 : 40;
    if (lv.code) {
      out.push(
        text(doorsRight ? L - 230 : 34, 44, `${lv.code} ${lv.serial ?? ''}`, 19, t.ink, { family: 'mono', 'font-weight': 600, 'letter-spacing': 1.5 }),
        text(doorsRight ? L - 230 : 34, 66, '45G1', 15, t.ink, { family: 'mono', 'font-weight': 500, 'letter-spacing': 1.5 }),
      );
    }
    // CSC plate + document holder
    out.push(rr(docEnd, H - 70, 64, 30, 2, tint(t.base, 0.2)), rect(docEnd + 5, H - 65, 54, 3, t.faint), rect(docEnd + 5, H - 58, 40, 3, t.faint), rect(docEnd + 5, H - 51, 48, 3, t.faint));
  }
  if (lv.mark) {
    out.push(
      text(L / 2, H / 2 + 36, lv.mark, 104, lv.markColor ?? t.ink, {
        'text-anchor': 'middle',
        'font-weight': 800,
        'letter-spacing': 4,
        style: 'font-stretch:125%',
      }),
      rect(L / 2 - 250, H / 2 + 58, 500, 7, lv.markColor ?? t.ink),
    );
  }
  // Weathering: soft top-light and a dirt fade near the bottom rail.
  out.push(rect(14, 13, L - 28, 10, 'rgba(255,255,255,.07)'), rect(14, H - 40, L - 28, 23, 'rgba(0,0,0,.05)'));
  return out.join('');
}

export function doorArt(lv: Livery) {
  const t = tones(lv.base);
  const s: string[] = [rect(0, 0, W, H, t.base)];
  // Header & sill
  s.push(rect(0, 0, W, 22, t.rail), rect(0, H - 20, W, 20, t.rail));
  // Posts
  s.push(rect(0, 0, 12, H, t.post), rect(W - 12, 0, 12, H, t.post));
  // Leaves with shallow panel corrugation
  const lw = (W - 24) / 2;
  for (let i = 0; i < 2; i++) {
    const x = 12 + i * lw;
    s.push(rect(x + 1, 22, lw - 2, H - 42, t.base));
    s.push(flutes(x + 6, 30, lw - 12, H - 58, 24, t.flL, t.flD, { horizontal: true, lightW: 9, darkW: 3.5 }));
  }
  s.push(rect(W / 2 - 1.5, 22, 3, H - 42, shade(t.base, 0.45)));
  // Locking bars: 4 vertical bars with cams + handles.
  const bars = [30, 78, W - 78, W - 30];
  for (const bx of bars) {
    s.push(rect(bx - 2.6, 18, 5.2, H - 34, '#34373D'), rect(bx - 2.6, 18, 1.6, H - 34, 'rgba(255,255,255,.18)'));
    s.push(rr(bx - 6, 14, 12, 12, 2, '#2A2C31'), rr(bx - 6, H - 26, 12, 12, 2, '#2A2C31'));
    s.push(rr(bx - 5.5, 60, 11, 7, 1.5, '#2A2C31'), rr(bx - 5.5, H - 72, 11, 7, 1.5, '#2A2C31'));
  }
  // Handles (swung down) and retainers
  for (const bx of bars) {
    s.push(rr(bx - 3, H / 2 + 10, 6, 34, 3, '#26282D'), rr(bx - 9, H / 2 + 26, 18, 7, 2, t.rail));
  }
  // Hinges
  for (const y of [40, 110, 180, 250]) {
    s.push(rect(12, y, 10, 11, '#2E3035'), rect(W - 22, y, 10, 11, '#2E3035'));
  }
  // Castings
  s.push(casting(-0.5, -0.5), casting(W - 17.3, -0.5), casting(-0.5, H - 11.3), casting(W - 17.3, H - 11.3));
  if (lv.code) {
    s.push(
      text(W - 20, 48, lv.code, 13, t.ink, { family: 'mono', 'text-anchor': 'end', 'font-weight': 600 }),
      text(W - 20, 64, lv.serial ?? '', 10, t.ink, { family: 'mono', 'text-anchor': 'end' }),
      text(W - 20, 80, '45G1', 10, t.ink, { family: 'mono', 'text-anchor': 'end' }),
    );
    // Data panel
    s.push(rect(W - 64, 96, 44, 3, t.faint), rect(W - 64, 104, 36, 3, t.faint), rect(W - 64, 112, 40, 3, t.faint), rect(W - 64, 120, 30, 3, t.faint));
  }
  // Hazard strip on the header (only on the hero box: ties to the spreader)
  if (lv.mark) s.push(rect(12, 4, W - 24, 5, lv.markColor ?? C.blue));
  return s.join('');
}

export function frontArt(lv: Livery) {
  const t = tones(lv.base);
  return (
    rect(0, 0, W, H, t.base) +
    flutes(14, 22, W - 28, H - 42, 26, t.flL, t.flD, { horizontal: true }) +
    rect(0, 0, W, 22, t.rail) +
    rect(0, H - 20, W, 20, t.rail) +
    rect(0, 0, 12, H, t.post) +
    rect(W - 12, 0, 12, H, t.post) +
    casting(-0.5, -0.5) +
    casting(W - 17.3, -0.5) +
    casting(-0.5, H - 11.3) +
    casting(W - 17.3, H - 11.3)
  );
}

export function roofArt(lv: Livery) {
  const t = tones(lv.base);
  const s: string[] = [rect(0, 0, L, W, tint(t.base, 0.06))];
  // Transverse roof corrugation (shallow): light bands across the width.
  if (!lv.lite) s.push(flutes(14, 10, L - 28, W - 20, 30, tint(t.base, 0.2), shade(t.base, 0.08), { lightW: 12, darkW: 4 }));
  else s.push(flutes(14, 10, L - 28, W - 20, 61, tint(t.base, 0.16), shade(t.base, 0.06), { lightW: 20, darkW: 6 }));
  // Rails & end frames
  s.push(rect(0, 0, L, 9, t.rail), rect(0, W - 9, L, 9, t.rail), rect(0, 0, 14, W, t.post), rect(L - 14, 0, 14, W, t.post));
  // Top castings (plan): oval twistlock apertures
  for (const [x, y] of [[0, 0], [L - 17.8, 0], [0, W - 16.2], [L - 17.8, W - 16.2]] as const) {
    s.push(rect(x, y, 17.8, 16.2, '#2A2C30'), rr(x + 4.4, y + 5.2, 9, 5.8, 2.9, '#0B0C0E'));
  }
  if (lv.mark && !lv.lite) {
    s.push(
      // Rotated 180°: boxes ride with their doors at the rear, so this reads upright from a trailing camera.
      text(L / 2, W / 2 + 26, lv.mark, 76, lv.markColor ?? t.ink, {
        'text-anchor': 'middle', 'font-weight': 800, 'letter-spacing': 3, style: 'font-stretch:125%', opacity: 0.92,
        transform: `rotate(180 ${L / 2} ${W / 2})`,
      }),
    );
  }
  if (lv.code && !lv.lite) {
    s.push(text(40, 40, `${lv.code} ${lv.serial ?? ''}`, 16, t.ink, { family: 'mono', 'font-weight': 600, opacity: 0.7, transform: `rotate(180 ${L / 2} ${W / 2})` }));
  }
  // Weathering streak
  s.push(rect(14, 9, L - 28, 6, 'rgba(255,255,255,.08)'));
  return s.join('');
}

export function floorArt(lv: Livery) {
  const t = tones(lv.base);
  let s = rect(0, 0, L, W, shade(t.base, 0.55));
  for (let x = 40; x < L - 20; x += 60) s += rect(x, 0, 10, W, shade(t.base, 0.7));
  return s;
}

/**
 * Build a container node. Returns the node; its origin is the floor centre.
 */
export function container(name: string, lv: Livery, opts: { bias?: number; lite?: boolean; segments?: number } = {}) {
  const n = new Node3(name);
  const L2 = { ...lv, lite: opts.lite ?? lv.lite };
  const x0 = -L / 2, x1 = L / 2, z0 = -W / 2, z1 = W / 2;
  const seg = opts.segments ?? (L2.lite ? 1 : 4);
  const common = { bias: opts.bias };
  // Long faces are split so they depth-sort correctly against nearby parts.
  splitFace(n, { ...common, o: [x0, H, z1], a: [1, 0, 0], b: [0, -1, 0], w: L, h: H, art: sideArt(L2, true), name: `${name}.pz` }, seg);
  splitFace(n, { ...common, o: [x1, H, z0], a: [-1, 0, 0], b: [0, -1, 0], w: L, h: H, art: sideArt(L2, false), name: `${name}.nz` }, seg);
  splitFace(n, { ...common, o: [x0, H, z0], a: [1, 0, 0], b: [0, 0, 1], w: L, h: W, art: roofArt(L2), name: `${name}.py` }, seg);
  splitFace(n, { ...common, o: [x0, 0, z1], a: [1, 0, 0], b: [0, 0, -1], w: L, h: W, art: floorArt(L2), name: `${name}.ny` }, Math.min(seg, 2));
  box(n, x0, 0, z0, L, H, W, { px: doorArt(L2), nx: frontArt(L2) }, { bias: opts.bias, name });
  return n;
}

/** A small data tag used by callouts (not part of the 3D model). */
export function codeOf(lv: Livery) {
  return `${lv.code ?? ''} ${lv.serial ?? ''}`.trim();
}

export { tones as containerTones };
