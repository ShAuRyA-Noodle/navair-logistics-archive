/**
 * Minimal linear algebra for the orthographic SVG engine.
 * World units are centimetres. Axes: X east (vehicle heading at yaw 0),
 * Y up, Z south (toward the default camera).
 */

export type V3 = [number, number, number];
/** Row-major 3x3. */
export type M3 = [number, number, number, number, number, number, number, number, number];

export const DEG = Math.PI / 180;

export const I3: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul(a: M3, b: M3): M3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

export function apply(m: M3, v: V3): V3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function rotX(d: number): M3 {
  const c = Math.cos(d * DEG), s = Math.sin(d * DEG);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
export function rotY(d: number): M3 {
  const c = Math.cos(d * DEG), s = Math.sin(d * DEG);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
export function rotZ(d: number): M3 {
  const c = Math.cos(d * DEG), s = Math.sin(d * DEG);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/**
 * Euler rotation used by every node: yaw about Y (heading), then pitch about
 * Z (e.g. a boom elevating in its own vertical plane), then roll about X.
 * Positive yaw turns +X toward -Z (a left turn seen from above, i.e. CCW).
 */
export function euler(x: number, y: number, z: number): M3 {
  let m = I3;
  if (y) m = mul(m, rotY(y));
  if (z) m = mul(m, rotZ(z));
  if (x) m = mul(m, rotX(x));
  return m;
}

export function scaleM(m: M3, s: number): M3 {
  return m.map((v) => v * s) as M3;
}

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const sc = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Andrew's monotone chain. Points are [x, y] pairs. */
export function hull(pts: [number, number][]): [number, number][] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const crossZ = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Deterministic PRNG so SSR, lab and page all draw identical artwork. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}
