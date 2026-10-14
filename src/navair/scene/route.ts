/**
 * The truck's route, as exact geometry (lines + one arc), in the ground plane.
 *
 * Headings follow the engine's yaw convention: 0 = +X, 90 = −Z.
 * Direction of heading ψ: (cos ψ, −sin ψ) in (X, Z). Right-hand normal: (sin ψ, cos ψ).
 *
 *   A  yard gate, driving −Z (screen-right in the yaw-90 elevation)
 *   B  junction: right-hand 90° turn, R = 2400
 *   C  straight +X down to the quay
 */

import { ROAD } from '../world';

export const LANE_X = -950;
export const START_Z = 9000;
export const TURN_Z = -32000;
export const TURN_R = 2400;
/** The port: the final straight runs along a quay; water lies to the −Z side. */
export const PORT_X0 = 2600;
export const PORT_X1 = 64000;
/** Quay wall (water begins at z < QUAY_EDGE_Z). */
export const QUAY_EDGE_Z = -36400;
/** Landside limit of the port apron. */
export const APRON_Z1 = -32600;
/** Truck rear-axle stop (box centre lands at STOP_X − 500, under the quay crane). */
export const STOP_X = 14500;
export const CRANE_X = STOP_X - 500;
/** Crane waterside rail. */
export const CRANE_Z = -36080;

export const TURN_CX = LANE_X + TURN_R;
export const TURN_CZ = TURN_Z;
export const EXIT_Z = TURN_Z - TURN_R;

const L1 = START_Z - TURN_Z;
const L2 = (Math.PI / 2) * TURN_R;
const L3 = STOP_X - TURN_CX;

export const ROUTE_LEN = L1 + L2 + L3;
/** s at which the arc begins / ends. */
export const S_TURN_IN = L1;
export const S_TURN_OUT = L1 + L2;

export interface RoutePt {
  x: number;
  z: number;
  heading: number;
}

/** Point on the lane centreline at arc length s (clamped, extrapolates straight past both ends). */
export function routeAt(s: number): RoutePt {
  if (s <= L1) return { x: LANE_X, z: START_Z - s, heading: 90 };
  if (s <= L1 + L2) {
    const th = (s - L1) / TURN_R;
    return {
      x: TURN_CX - TURN_R * Math.cos(th),
      z: TURN_CZ - TURN_R * Math.sin(th),
      heading: 90 - (th * 180) / Math.PI,
    };
  }
  return { x: TURN_CX + (s - L1 - L2), z: EXIT_Z, heading: 0 };
}

/** s for a point on the first straight (the elevation chapters live here). */
export const sAtZ = (z: number) => START_Z - z;

/**
 * SVG path for the route offset `o` cm to the right of travel, in plan-art
 * coordinates (u = X − ox, v = Z − oz). Used for asphalt, edge lines, lanes.
 */
export function routePathD(o: number, ox: number, oz: number, extendStart = 0) {
  const u = (x: number) => (x - ox).toFixed(1);
  const v = (z: number) => (z - oz).toFixed(1);
  // Straight 1 (heading 90): right normal = (1, 0)
  const x1 = LANE_X + o;
  const r = TURN_R - o;
  const a1 = `M${u(x1)} ${v(START_Z + extendStart)}L${u(x1)} ${v(TURN_Z)}`;
  // Arc: right turn, centre on the right; sweep: from heading 90 to 0.
  const ex = TURN_CX, ez = TURN_CZ - r;
  // In art space (v = Z, pointing down) a right turn when heading −Z → +X is clockwise on screen? We only need the
  // sweep flag consistent with the geometry: start (cx − r, cz), end (cx, cz − r), centre (cx, cz).
  const arc = `A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${u(ex)} ${v(ez)}`;
  const a3 = `L${u(PORT_X1)} ${v(ez)}`;
  return a1 + arc + a3;
}

/** The straight branch that continues −Z past the junction (decor road). */
export function branchPathD(o: number, ox: number, oz: number, len = 26000) {
  const u = (x: number) => (x - ox).toFixed(1);
  const v = (z: number) => (z - oz).toFixed(1);
  return `M${u(LANE_X + o)} ${v(TURN_Z + 10)}L${u(LANE_X + o)} ${v(TURN_Z - len)}`;
}

export const HALF = ROAD.W / 2;
