/**
 * The sea's wave spectrum: ONE definition shared by the GPU (GLSL generated from
 * these tables) and the CPU (ship heave / pitch / roll), so the hull rides
 * exactly the surface that is drawn under it.
 *
 * Units: metres, seconds. World xz in metres (engine cm / 100).
 *
 *  - SWELL: Gerstner trains (displacement + analytic normals + Jacobian foam),
 *    deep-water dispersion omega = sqrt(g k), directions spread round a mean
 *    heading toward the quay (+z), steepness rising toward the short waves.
 *  - DETAIL: short wind waves, slopes only (fragment shader), faded out below
 *    the pixel footprint (their lost variance becomes glitter roughness).
 *
 * The harbour shelters the berth (amplitude ramps up away from the quay) and the
 * quay wall reflects: the field near the wall is the field plus its mirror image
 * about the wall line, which is the exact Neumann (wall) condition.
 *
 * Everything is a pure function of (position, time).
 */

export interface Wave {
  dx: number;
  dz: number;
  k: number;
  w: number;
  a: number;
  q: number;
  ph: number;
}

const G = 9.81;

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mean propagation heading: toward the quay (+z), a little toward +x. */
const HEADING = 0.42;

function makeSwell(): Wave[] {
  const r = rand(7);
  const n = 12;
  const out: Wave[] = [];
  const Qs = 0.72; // sum of Q k a: crests sharpen, never loop
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const lam = 118 * Math.pow(0.755, i);
    const k = (2 * Math.PI) / lam;
    const spread = 0.12 + 0.85 * f;
    const th = HEADING + (r() * 2 - 1) * spread + (i % 2 ? 0.25 : -0.2) * f;
    const ka = 0.032 + 0.05 * f;
    const a = ka / k;
    out.push({ dx: Math.sin(th), dz: Math.cos(th), k, w: Math.sqrt(G * k), a, q: Qs / (ka * n), ph: r() * Math.PI * 2 });
  }
  return out;
}

function makeDetail(): Wave[] {
  const r = rand(23);
  const n = 16;
  const out: Wave[] = [];
  for (let i = 0; i < n; i++) {
    const lam = 4.4 * Math.pow(0.862, i);
    const k = (2 * Math.PI) / lam;
    const th = HEADING + (r() * 2 - 1) * 1.25;
    const ka = 0.085;
    out.push({ dx: Math.sin(th), dz: Math.cos(th), k, w: Math.sqrt(G * k), a: ka / k, q: 0, ph: r() * Math.PI * 2 });
  }
  return out;
}

export const SWELL = makeSwell();
export const DETAIL = makeDetail();
/** The steep wind-sea trains whose crests break into whitecaps (indices into SWELL). */
export const BREAKERS = [5, 6, 7, 8];

/* ------------------------------------------------------------- shelter */

/** Harbour shelter: amplitude factor vs distance from the quay wall (m). */
export function shelter(dQ: number) {
  const t = Math.min(1, Math.max(0, (dQ - 12) / 300));
  return 0.32 + 0.68 * t * t * (3 - 2 * t);
}
/** Wall reflection gain vs distance from the wall (m). */
export function reflGain(dQ: number) {
  return dQ < 380 ? 0.75 * Math.exp(-dQ / 90) : 0;
}

/* ------------------------------------------------------------- CPU eval */

function rawHeight(x: number, z: number, t: number) {
  let h = 0;
  for (const v of SWELL) h += v.a * Math.sin(v.k * (v.dx * x + v.dz * z) - v.w * t + v.ph);
  return h;
}

/** Surface height (m) at world (x, z) m, time t s, given the quay line z (m). */
export function seaHeight(x: number, z: number, t: number, quayZ: number) {
  const dQ = Math.max(0, quayZ - z);
  const R = reflGain(dQ);
  let h = rawHeight(x, z, t);
  if (R > 0) h += R * rawHeight(x, 2 * quayZ - z, t);
  return h * shelter(dQ);
}

export interface Motion {
  /** Heave (m), pitch (deg, bow up +), roll (deg, starboard up +). */
  heave: number;
  pitch: number;
  roll: number;
}

/**
 * Rigid-hull response: least-squares plane through the surface sampled over the
 * waterplane (5 × 3 points). Averaging over the hull is the physical low-pass
 * filter: waves much shorter than the ship barely move it.
 * c, dir in metres / unit (xz); L, B hull length / beam (m).
 */
export function hullMotion(c: [number, number], dir: [number, number], L: number, B: number, t: number, quayZ: number): Motion {
  const sx = -dir[1], sz = dir[0]; // unit toward +lat (port when dir = +x? sign handled by caller)
  let sh = 0, su = 0, sv = 0, uu = 0, vv = 0, n = 0;
  for (let i = 0; i < 5; i++) {
    const u = (i / 4 - 0.5) * L * 0.86;
    for (let j = 0; j < 3; j++) {
      const v = (j - 1) * B * 0.42;
      const x = c[0] + dir[0] * u + sx * v;
      const z = c[1] + dir[1] * u + sz * v;
      const h = seaHeight(x, z, t, quayZ);
      sh += h;
      su += h * u;
      sv += h * v;
      uu += u * u;
      vv += v * v;
      n++;
    }
  }
  const heave = sh / n;
  const slopeU = su / uu; // dh/du (bow-ward)
  const slopeV = sv / vv; // dh/dv (toward (-dir.z, dir.x))
  const DEG = 180 / Math.PI;
  return { heave, pitch: Math.atan(slopeU) * DEG, roll: Math.atan(slopeV) * DEG };
}

/* ------------------------------------------------------------- GLSL */

const f = (x: number) => {
  const s = x.toPrecision(7);
  return s.includes('.') || s.includes('e') ? s : s + '.0';
};
const v4 = (a: number, b: number, c: number, d: number) => `vec4(${f(a)},${f(b)},${f(c)},${f(d)})`;

/**
 * GLSL: wave tables + evaluators.
 *   swell(p, t, n, out disp, out grad, out jac terms)
 *   detail(p, t, px, n) -> slope + lost variance
 */
export function wavesGLSL() {
  const S = SWELL, D = DETAIL;
  return /* glsl */ `
const int NSW = ${S.length};
const int NDT = ${D.length};
// (dir.x, dir.z, k, omega)
const vec4 SW_A[NSW] = vec4[NSW](${S.map((w) => v4(w.dx, w.dz, w.k, w.w)).join(',')});
// (amplitude, Q, phase, 0)
const vec4 SW_B[NSW] = vec4[NSW](${S.map((w) => v4(w.a, w.q, w.ph, 0)).join(',')});
const vec4 DT_A[NDT] = vec4[NDT](${D.map((w) => v4(w.dx, w.dz, w.k, w.w)).join(',')});
const vec4 DT_B[NDT] = vec4[NDT](${D.map((w) => v4(w.a, 0, w.ph, 0)).join(',')});

float shelterF(float dQ) { return 0.32 + 0.68 * smoothstep(12.0, 312.0, dQ); }
float reflF(float dQ) { return dQ < 380.0 ? 0.75 * exp(-dQ / 90.0) : 0.0; }

// Gerstner sum at parameter point p. disp = (dx, h, dz); g = (dh/dx, dh/dz) of
// the displaced surface (analytic, GPU Gems 1 ch.1); J = Jacobian of the
// horizontal map (folding < ~0.3 = breaking crest).
void swellRaw(vec2 p, float t, int n, inout vec3 disp, inout vec2 g, inout vec3 jt) {
  for (int i = 0; i < NSW; i++) {
    if (i >= n) break;
    vec4 A = SW_A[i], B = SW_B[i];
    float th = A.z * dot(A.xy, p) - A.w * t + B.z;
    float s = sin(th), c = cos(th);
    float wa = A.z * B.x;
    disp += vec3(B.y * B.x * A.x * c, B.x * s, B.y * B.x * A.y * c);
    g += wa * c * A.xy;
    float qs = B.y * wa * s;
    jt += vec3(qs * A.x * A.x, qs * A.y * A.y, qs * A.x * A.y);
  }
}

struct Swell { vec3 disp; vec2 g; float J; float amp; };

Swell swell(vec2 p, float t, int n, float quayZ) {
  Swell o;
  vec3 d = vec3(0.0), jt = vec3(0.0);
  vec2 g = vec2(0.0);
  swellRaw(p, t, n, d, g, jt);
  float dQ = max(quayZ - p.y, 0.0);
  float R = reflF(dQ);
  if (R > 0.0) {
    vec3 d2 = vec3(0.0), j2 = vec3(0.0);
    vec2 g2 = vec2(0.0);
    // Only the long trains: short reflected waves are invisible and cost a full pass.
    swellRaw(vec2(p.x, 2.0 * quayZ - p.y), t, min(n, 6), d2, g2, j2);
    d += R * vec3(d2.x, d2.y, -d2.z);
    g += R * vec2(g2.x, -g2.y);
    jt += R * vec3(j2.x, j2.y, -j2.z);
  }
  float a = shelterF(dQ);
  o.disp = d * a;
  o.amp = a;
  jt *= a;
  o.g = g * a / max(1.0 - jt.x - jt.y, 0.25);
  o.J = (1.0 - jt.x) * (1.0 - jt.y) - jt.z * jt.z;
  return o;
}

// Short waves: slopes only, faded below ~3 px; returns lost slope variance in .z
vec3 detail(vec2 p, float t, float px, int n, float amp) {
  vec2 g = vec2(0.0);
  float lost = 0.0;
  for (int i = 0; i < NDT; i++) {
    if (i >= n) break;
    vec4 A = DT_A[i], B = DT_B[i];
    float lam = 6.2831853 / A.z;
    float vis = smoothstep(2.2 * px, 5.0 * px, lam);
    float ka = A.z * B.x * amp;
    lost += ka * ka * 0.5 * (1.0 - vis);
    if (vis <= 0.0) continue;
    float th = A.z * dot(A.xy, p) - A.w * t + B.z;
    g += ka * cos(th) * vis * A.xy;
  }
  // Waves we never evaluate at all (n < NDT) are lost too.
  for (int i = 0; i < NDT; i++) {
    if (i < n) continue;
    float ka = DT_A[i].z * DT_B[i].x * amp;
    lost += ka * ka * 0.5;
  }
  return vec3(g, lost);
}

// Whitecaps with temporal decay as a pure function of time: for each breaking
// train, the time since its last crest passed this point (phase arithmetic),
// gated by a slowly moving group envelope so only some crests break.
float whitecaps(vec2 p, float t, sampler2D noiseTex, float amp) {
  float f = 0.0;
  ${BREAKERS.map((i) => {
    const w = S[i];
    const cg = w.w / (2 * w.k);
    return `{
    vec4 A = SW_A[${i}], B = SW_B[${i}];
    float th = A.z * dot(A.xy, p) - A.w * t + B.z;
    float since = mod(1.5707963 - th, 6.2831853) / A.w;          // s since the crest passed
    vec2 gp = p / ${f(2.4 * (2 * Math.PI) / w.k)} - A.xy * t * ${f(cg / (2.4 * (2 * Math.PI) / w.k))} + vec2(${f(i * 0.137)}, ${f(i * 0.291)});
    float grp = texture(noiseTex, gp).b;
    float brk = smoothstep(0.72, 0.92, grp * (0.75 + 0.4 * amp));
    f += brk * exp(-since / 1.8) * smoothstep(0.0, 0.25, since + 0.05);
  }`;
  }).join('\n  ')}
  return f;
}
`;
}
