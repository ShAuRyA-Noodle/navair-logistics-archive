/**
 * Real-time WebGL ocean under the vector world.
 *
 * Deterministic by construction: every pixel is a pure function of
 * (position, real time, ship course). There is no integrated state, so
 * scrubbing the timeline in either direction can never leave ghosts, pops or
 * resets behind; ambient waves keep rolling on real time even when the scroll
 * is idle.
 *
 * Two passes per frame:
 *  1. COURSE BUFFER. A ribbon laid along the ship's Catmull-Rom smoothed course
 *     is rasterised top-down into a float target covering the visible water:
 *     each texel stores (s = metres aft of the stern, signed lateral offset,
 *     course tangent). Depth = |lateral|, so where the ribbon overlaps itself on
 *     the inside of a turn the nearest centreline wins. This turns "where am I
 *     relative to the wake" into one texture fetch per pixel.
 *  2. SEA. A screen-space grid is unprojected onto the water plane and displaced
 *     by Gerstner swell (water/waves.ts: deep-water dispersion, harbour shelter,
 *     mirror-image reflection off the quay wall) plus the ship's Kelvin and bow
 *     waves. The fragment shader re-evaluates the swell analytically at the
 *     pixel for normals and the Jacobian (crest foam), adds short wind waves
 *     faded below the pixel footprint (their lost variance becomes glitter
 *     roughness), then the wake in course coordinates:
 *       - analytic stationary-phase Kelvin pattern (transverse + divergent
 *         crests inside the 19.47° envelope, wavelength 2πU²/g from ship speed),
 *       - bow wave peeling off the stem with breaking crest foam,
 *       - hull boundary-layer foam line, mid-body trough, contact darkening,
 *       - propeller wash: turquoise aerated band, churn and foam that decays with
 *         its age (s / U), anchored to the water it was laid on, wake edge lines,
 *       - the slick: the turbulent band damps the ambient chop (glossy lane).
 *     Lighting: Beer-Lambert body, crest subsurface tint, Schlick Fresnel against
 *     a sky gradient, Beckmann sun glitter, soft hull and quay-wall shadows,
 *     whitecaps with temporal decay (phase arithmetic: time since each breaking
 *     crest passed), soft-knee tone map.
 *
 * Quality governor: frame-time driven tiers scale the shading resolution and the
 * number of wave octaves; the grid density follows the shading resolution.
 * Nothing renders while the sea is hidden or out of frame.
 */

import * as THREE from 'three';
import type { View } from '../engine/engine';
import { wavesGLSL } from './water/waves';
import { classifyGPU } from './water/gpu';

export const TRAIL_N = 48;

export interface OceanState {
  /** Ship centre (world cm, xz) and bow direction (unit, xz). */
  ship: [number, number];
  dir: [number, number];
  /** 0..1 */
  speed: number;
  /** Stern positions along the course, newest first (world cm, xz). */
  trail: [number, number][];
  /** Seconds. */
  time: number;
  /**
   * Optional: distance sailed along the course (cm, e.g. `sea.dist`). Anchors
   * the wake's foam to the water (foam stays where it was laid and ages) and
   * lets the wake strength follow the speed the ship had when it passed.
   */
  dist?: number;
}

/** Ship speed at speed = 1 (m/s): sets the Kelvin wavelength (2πU²/g ≈ 41 m). */
export const U_MAX = 8.0;
/** Course distance over which the departure accelerates to full speed (m). */
const RAMP = 140;
const AHEAD = 60; // ribbon starts this far ahead of the stem (m)
const AFT_PAD = 60; // and runs this far past the trail's end (m)
const ROWS_MAX = 420;
const W_MAX = 480; // max ribbon half-width (m): depth normaliser

/** Quality tiers: shading-resolution scale, swell octaves, detail octaves, course-buffer size, grid px. */
const TIERS = [
  { res: 1.0, sw: 12, dt: 16, cb: 1024, grid: 6 },
  { res: 0.85, sw: 12, dt: 12, cb: 1024, grid: 7 },
  { res: 0.7, sw: 10, dt: 8, cb: 768, grid: 8 },
  { res: 0.56, sw: 8, dt: 5, cb: 512, grid: 10 },
];

/* ------------------------------------------------------------------ GLSL */

const common = /* glsl */ `
precision highp float;
precision highp int;
uniform float uTime;
uniform vec3 uEye;         // virtual perspective eye (m, world)
uniform vec3 uSun;         // toward the sun (unit)
uniform float uQuayZ;      // m
uniform vec4 uBasin;       // x0, z0, x1, z1 (m)
uniform int uNSw;          // swell octaves in use
uniform int uNDt;          // detail octaves in use
uniform sampler2D uTexA, uTexF;
// Course buffer (pass 1)
uniform sampler2D uCourse;
uniform vec2 uWinC;        // window centre (m)
uniform float uWinS;       // window size (m)
uniform float uCourseOn;
// Ship
uniform vec2 uShip;        // m
uniform vec2 uDir;         // bow direction
uniform float uSpeed;      // 0..1
uniform float uU;          // m/s
uniform float uDist;       // course position of the stern (m)
uniform float uHasDist;
uniform float uLen;        // trail length aft of the stern (m)
uniform float uHalfL, uHalfB;

float sat(float x) { return clamp(x, 0.0, 1.0); }
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float gauss(float x) { return exp(-x * x); }

${wavesGLSL()}

float hullHalfW(float u) {   // u: metres forward of midship
  float bowStart = uHalfL * 0.42;
  return uHalfB * (u > bowStart ? sqrt(sat(1.0 - pow((u - bowStart) / (uHalfL - bowStart), 2.0))) : 1.0);
}

struct Course { float s; float lat; vec2 T; float w; };

Course course(vec2 p) {
  Course c;
  vec2 uv = (p - uWinC) / uWinS + 0.5;
  vec2 e = min(uv, 1.0 - uv);
  vec4 t = uCourseOn > 0.5 && min(e.x, e.y) > 0.0 ? textureLod(uCourse, uv, 0.0) : vec4(0.0);
  float cov = length(t.zw);
  // All channels scale with coverage at the ribbon's filtered edge: divide it out.
  float inv = 1.0 / max(cov, 1e-4);
  c.s = t.x * inv;
  c.lat = t.y * inv;
  c.T = cov > 1e-4 ? t.zw * inv : vec2(1.0, 0.0);
  c.w = smoothstep(0.25, 0.9, cov) * smoothstep(0.0, 0.04, min(e.x, e.y));
  return c;
}

// Wake strength laid at course position D (pure in D): the departure ramp.
float histAt(float s) {
  float tailFade = smoothstep(uLen + 2.0, uLen - 120.0, s);
  return (uHasDist > 0.5 ? sat((uDist - s) / ${RAMP.toFixed(1)}) : uSpeed) * tailFade;
}

// Analytic Kelvin wake (stationary phase of a point source ahead of the stem,
// so the cusp lines at asin(1/3) = 19.47° pass the bow shoulders). Adds height
// (m) and world gradient. px = pixel footprint (m) for anti-aliasing.
void kelvin(Course C, float px, inout float h, inout vec2 g, out float brk) {
  brk = 0.0;
  if (uSpeed < 0.02 || C.w <= 0.0) return;
  float a = abs(C.lat);
  float c = max(uU * uU / 9.81, 0.3);
  float x = C.s + 2.0 * uHalfL + uHalfB / 0.35355;
  float r = a / (max(x, 1.0) * 0.35355);
  if (x <= 1.0 || r >= 1.12) return;
  float y = max(a, 1e-3);
  float disc = sqrt(max(x * x - 8.0 * y * y, 0.0));
  float Tt = (x - disc) / (4.0 * y);
  float Td = (x + disc) / (4.0 * y);
  float st = sqrt(1.0 + Tt * Tt), sd = sqrt(1.0 + Td * Td);
  float pt = st * (x - y * Tt) / c;
  float pd = sd * (x - y * Td) / c;
  float kt = st * st / c, kd = sd * sd / c;
  float env = smoothstep(1.1, 0.95, r) * exp(-x / 2600.0) / sqrt(1.0 + x / (6.0 * c));
  float cusp = 1.0 + 1.5 * exp(-pow((1.0 - min(r, 1.0)) * 7.0, 2.0));
  // Only water the ship has actually passed carries the pattern.
  float kh = C.s < 0.0 ? 1.0 : histAt(C.s);
  // The near field alongside the hull belongs to the bow-wave model.
  float near = smoothstep(uHalfL * 0.6, uHalfL * 2.2, x - uHalfB / 0.35355);
  float A = 0.95 * uSpeed * uSpeed * env * cusp * kh * C.w * near;
  float at = A * (0.8 - 0.4 * r) * sat((6.2832 / kt / px - 2.5) / 3.0);
  float ad = A * r * r * 1.25 * sat((6.2832 / kd / px - 3.0) / 3.0);
  float ct = cos(pt + 0.785), cd = cos(pd - 0.785);
  // Stationary phase: d(phase)/dT = 0, so grad(phase) = (s, -s T) / c exactly.
  vec2 gl = at * ct * st / c * vec2(1.0, -Tt) + ad * cd * sd / c * vec2(1.0, -Td);
  gl.y *= sign(C.lat);
  vec2 N = vec2(-C.T.y, C.T.x);
  g += gl.x * (-C.T) + gl.y * N;
  float kel = at * sin(pt + 0.785) + ad * sin(pd - 0.785);
  h += kel;
  // Breaking on the divergent crests near the cusp, close to the ship.
  brk = smoothstep(0.55, 1.0, kel / max(A, 1e-3)) * exp(-max(x - 2.0 * uHalfL, 0.0) / 140.0)
      * smoothstep(0.55, 0.9, r) * smoothstep(1.06, 0.95, r) * uSpeed;
}

// Bow wave + hull pressure field in the ship frame. Height (m) and gradient.
void bowField(vec2 p, inout float h, inout vec2 g, out float crest, out float dHull, out vec2 uv) {
  vec2 rel = p - uShip;
  vec2 side = vec2(-uDir.y, uDir.x);
  float u = dot(rel, uDir), v = dot(rel, side);
  uv = vec2(u, v);
  float hw = hullHalfW(u);
  dHull = max(abs(v) - hw, max(-uHalfL - u, u - uHalfL));
  crest = 0.0;
  float sp2 = uSpeed * uSpeed;
  if (uSpeed < 0.02 || dHull > 120.0) return;
  float xb = uHalfL - u;                     // metres aft of the stem
  float xp = max(xb, 0.0);
  // Primary bow crest: leaves the stem ~20° off the hull, spreads and decays aft.
  float yb = min(hw, uHalfB) + 0.36 * xp + 1.2;
  float wb = 1.6 + 0.04 * xp;
  float d = abs(v) - yb;
  float env = sp2 * exp(-xp / 120.0) * smoothstep(-8.0, 0.0, xb);
  float G1 = gauss(d / wb), G2 = gauss((d - 2.4 * wb) / (1.4 * wb));
  float hb = 1.15 * env * (G1 - 0.5 * G2);
  float dh = 1.15 * env * (-2.0 * d / (wb * wb) * G1 + 0.5 * 2.0 * (d - 2.4 * wb) / pow(1.4 * wb, 2.0) * G2);
  float hwp = (hullHalfW(u + 0.5) - hullHalfW(u - 0.5));
  float ddu = 0.36 - hwp;
  h += hb;
  g += dh * (sign(v) * side + ddu * uDir);
  crest = G1 * env;
  // Pressure: water piles at the stem, dips along the parallel body.
  float stem = gauss(length(vec2(xb + 3.0, v * 1.2)) / 9.0);
  h += 0.7 * sp2 * stem;
  float mid = exp(-max(dHull, 0.0) / 12.0) * smoothstep(uHalfL * 0.85, uHalfL * 0.2, abs(u));
  h -= 0.35 * sp2 * mid;
}
`;

/* -------------------------------------------------------------- course pass */

const courseVert = /* glsl */ `
attribute vec4 aWake;       // s (m aft of stern), signed lateral (m), tangent xz
varying vec4 vC;
uniform vec2 uWinC;
uniform float uWinS;
uniform float uWMax;
void main() {
  vec2 p = position.xz / 100.0;
  vC = aWake;
  gl_Position = vec4((p - uWinC) / (uWinS * 0.5), abs(aWake.y) / uWMax * 1.96 - 0.98, 1.0);
}
`;
const courseFrag = /* glsl */ `
precision highp float;
varying vec4 vC;
void main() {
  vec2 T = normalize(vC.zw);
  gl_FragColor = vec4(vC.x, vC.y, T);
}
`;

/* -------------------------------------------------------------- sea pass */

const seaVert = common + /* glsl */ `
uniform mat4 uInvPV;
varying vec2 vP;           // undisplaced (parameter) point, m
varying vec3 vD;           // displacement, m
void main() {
  vec4 a = uInvPV * vec4(position.xy, -1.0, 1.0);
  vec4 b = uInvPV * vec4(position.xy, 1.0, 1.0);
  a /= a.w; b /= b.w;
  float k = a.y / (a.y - b.y);
  vec3 w = mix(a.xyz, b.xyz, k);           // on the water plane (cm)
  vec2 p = w.xz / 100.0;
  Swell S = swell(p, uTime, uNSw, uQuayZ);
  vec3 disp = S.disp;
  // Ship waves (heights only).
  float h = 0.0;
  vec2 g = vec2(0.0);
  float crest, dHull, brk;
  vec2 uvs;
  bowField(p, h, g, crest, dHull, uvs);
  Course C = course(p);
  kelvin(C, 0.5, h, g, brk);
  disp.y += h;
  // Keep the wall line fixed so the water never slides under the quay.
  float dQ = uQuayZ - p.y;
  disp.xz *= smoothstep(0.0, 6.0, dQ);
  vP = p;
  vD = disp;
  gl_Position = projectionMatrix * viewMatrix * vec4((vec3(p.x, 0.0, p.y) + disp) * 100.0, 1.0);
}
`;

const seaFrag = common + /* glsl */ `
varying vec2 vP;
varying vec3 vD;

vec3 skyRad(vec3 r) {
  float y = sat(r.y);
  vec3 zen = vec3(0.075, 0.2, 0.55), hor = vec3(0.6, 0.72, 0.86);
  return mix(hor, zen, pow(y, 0.6));
}

// Slow large-scale tone: cloud shadows drifting over the sea + faint glows.
vec3 tone(vec2 p) {
  float n = texture(uTexF, rot(0.7) * p / 1700.0 + vec2(0.31, 0.17) + uTime * vec2(0.0004, 0.00015)).b;
  float cloud = smoothstep(0.52, 0.82, n);
  float glow = smoothstep(0.45, 0.2, n);
  return vec3(1.0 - 0.26 * cloud) + vec3(-0.02, 0.16, 0.3) * glow * 0.35;
}

vec3 finish(vec3 c) {
  const float k = 0.55;
  vec3 over = max(c - k, 0.0);
  c = min(c, vec3(k)) + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
  return srgb(clamp(c, 0.0, 1.0));
}

// Tileable slope noise from the baked FFT sea (rg = slope, b = height).
vec3 tapSlope(vec2 uv, mat2 R) {
  vec3 s = (texture(uTexA, uv).rgb - 0.5) * 6.0;
  return vec3(s.xy * R, s.z);
}

void main() {
  vec2 p = vP;
  if (p.y > uQuayZ + 0.5 || p.x < uBasin.x || p.x > uBasin.z) discard;
  float t = uTime;
  float px = max(length(dFdx(p)), length(dFdy(p)));

  // ------------------------------------------------------------ ambient sea
  Swell S = swell(p, t, uNSw, uQuayZ);
  vec3 det = detail(p, t, px, uNDt, S.amp);
  mat2 Ra = rot(0.83);
  vec3 micro = tapSlope(Ra * p / 23.0 + vec2(0.013, -0.009) * t, Ra);
  vec2 gAmb = S.g + det.xy + micro.xy * 0.035 * S.amp;
  float lost = det.z + 0.0012 * sat(log2(max(px * 512.0 / 23.0, 1.0)) / 4.0);
  float h = vD.y;

  // ------------------------------------------------------------ ship + wake
  vec2 gW = vec2(0.0);
  float hW = 0.0, crest, dHull, kelBrk;
  vec2 uvs;
  bowField(p, hW, gW, crest, dHull, uvs);
  Course C = course(p);
  kelvin(C, px, hW, gW, kelBrk);

  float sp = uSpeed;
  float s = C.s, lat = C.lat, a = abs(lat);
  float D = uDist - s;                       // course position of this water (m)
  float sa = max(s, 0.0);
  float hist = histAt(s) * step(-1.0, s) * C.w;
  float age = sa / max(uU, 0.6);             // s since the stern passed this water
  float w = uHalfB * (0.66 + 0.95 * (1.0 - exp(-sa / 120.0))) + 0.03 * sa;
  float q = a / w;

  float slick = 0.0, aer = 0.0, washFoam = 0.0, churn = 0.0;
  float lace = texture(uTexF, p / 31.0 + t * vec2(0.0021, 0.0013)).g;
  if (hist > 0.0 && q < 2.2) {
    float prof = exp(-q * q * 2.2);
    // World-anchored streaks, stretched ~20:1 along the course.
    float st1 = texture(uTexF, vec2(lat / 60.0 + 0.37, D / 1200.0)).b;
    float st2 = texture(uTexF, vec2(lat / 22.0 + 0.11, D / 420.0)).b;
    float boil = texture(uTexF, vec2(lat / 19.0 + 0.5, D / 34.0) + vec2(0.0, t * 0.012)).g;
    float wl = texture(uTexF, vec2(lat / 40.0, D / 160.0) + vec2(t * 0.002, 0.0)).g;
    float streak = sat(0.5 + 1.5 * (st1 - 0.5) + 0.9 * (st2 - 0.5));
    slick = hist * exp(-q * q * 0.55) * (0.45 + 0.55 * exp(-age / 160.0));
    aer = hist * exp(-q * q * 1.3) * (0.3 + 0.7 * exp(-age / 45.0)) * smoothstep(-2.0, 10.0, s);
    churn = hist * prof * exp(-age / 2.6);
    // Foam density: churned white at the transom, breaking into streaks and lace
    // that thin out with age (coverage threshold rises), plus the wake's edge lines.
    float edgeL = exp(-pow((q - 0.88) / 0.11, 2.0)) * exp(-age / 35.0) * smoothstep(0.35, 0.75, st2);
    float dens = churn * (0.55 + 0.7 * boil)
               + prof * (0.35 + 0.65 * exp(-age / 40.0)) * (0.1 + 1.0 * streak) * (0.25 + 0.9 * wl) * (0.6 + 0.6 * boil)
               + 0.6 * edgeL;
    float thr = mix(0.3, 0.66, 1.0 - exp(-age / 30.0));
    washFoam = hist * smoothstep(thr, thr + 0.28, dens);
    // Turbulent surface in the churn: chaotic small slopes.
    vec3 tb = tapSlope(vec2(lat, D) / 7.5 + vec2(0.0, t * 0.05), mat2(1.0));
    vec2 N = vec2(-C.T.y, C.T.x);
    gW += (tb.x * N - tb.y * C.T) * 0.09 * (churn + 0.3 * aer);
    hW += 0.3 * churn;
  }

  // Bow crest + hull foam (ship frame).
  float bowFoam = 0.0, hullFoam = 0.0;
  if (dHull < 60.0) {
    float u = uvs.x, v = uvs.y;
    float xb = uHalfL - u;
    float bl = texture(uTexF, vec2(v / 13.0, u / 46.0 + uDist / 46.0)).g;
    float al = texture(uTexF, vec2(v / 30.0, (u + uDist) / 160.0)).b;
    bowFoam = crest * smoothstep(0.25, 0.75, 0.45 * bl + 0.45 * al + 0.35 * exp(-max(xb, 0.0) / 25.0)) * 1.4;
    // Spray sheet at the stem.
    bowFoam += sp * exp(-max(xb, 0.0) / 7.0) * smoothstep(-6.0, 0.0, xb) * exp(-max(abs(v) - hullHalfW(u), 0.0) / 2.0);
    // Boundary-layer foam hugging the hull: streaky under way, thin lapping lace moored.
    float hs = texture(uTexF, vec2(v / 16.0, (u + uDist) / 190.0)).b;
    float hl = texture(uTexF, vec2(v / 9.0, u / 9.0) + t * vec2(0.006, 0.009)).g;
    float out_ = max(dHull, 0.0);
    hullFoam = step(-0.3, dHull) * (
        (1.0 - sp) * exp(-out_ / 0.6) * (0.15 + 0.55 * smoothstep(0.45, 0.85, hl))
      + sp * exp(-out_ / (0.45 + 0.5 * sp)) * smoothstep(0.35, 0.8, 0.6 * hs + 0.4 * hl + 0.2 * smoothstep(0.0, -uHalfL, u)));
  }

  // ------------------------------------------------------------ combine
  // The turbulent band damps the ambient chop: a glossy, darker lane.
  float damp = 1.0 - 0.72 * slick;
  vec2 g = gAmb * damp + gW;
  float rough2 = 0.0028 + lost * damp * damp + 0.006 * churn;

  // ------------------------------------------------------------ quay wall
  float dQ = uQuayZ - p.y;
  float wallShadow = smoothstep(0.4, 4.0, dQ);
  float quayFoam = 0.0;
  if (dQ < 25.0) {
    float lap = texture(uTexF, vec2(p.x / 38.0, dQ / 26.0 + t * 0.006)).g;
    float rise = smoothstep(-0.1, 0.45, h);
    quayFoam = exp(-dQ / 0.55) * (0.25 + 0.6 * lap) * (0.5 + 0.8 * rise)
             + exp(-dQ / 2.5) * 0.35 * smoothstep(0.62, 0.95, lap) * rise;
    // Backwash ripples running off the wall.
    float rp = dQ * 1.4 - t * 1.8 + 0.8 * sin(p.x * 0.05 + t * 0.3);
    g.y += -0.05 * cos(rp) * exp(-dQ / 8.0);
  }

  // ------------------------------------------------------------ shadows
  vec2 rel = p - uShip;
  vec2 side = vec2(-uDir.y, uDir.x);
  vec2 sp2 = rel + uSun.xz / uSun.y * 9.0;
  float su = dot(sp2, uDir), sv = dot(sp2, side);
  float dSh = max(abs(sv) - hullHalfW(su), abs(su) - uHalfL);
  float shadow = mix(0.5, 1.0, smoothstep(-1.5, 3.0, dSh));
  float contact = exp(-max(dHull, 0.0) / 2.5);
  shadow *= 1.0 - 0.35 * contact;
  shadow *= wallShadow;

  // ------------------------------------------------------------ light
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 P = vec3(p.x, h, p.y);
  vec3 V = normalize(uEye - P);
  vec3 L = uSun;
  float NdV = max(dot(n, V), 0.03);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, n);

  vec3 T = tone(p);
  float harbour = smoothstep(90.0, 5.0, dQ);
  vec3 deep = mix(vec3(0.0042, 0.03, 0.135), vec3(0.006, 0.045, 0.09), harbour * 0.6);
  vec3 body = deep * T;
  // Crests lighter, troughs darker (thicker water toward the eye on the crest flanks).
  float amp = 0.25 + 1.2 * S.amp;
  body *= 0.78 + 0.44 * sat(0.5 + h / amp);
  // Subsurface: sun through the backs of crests.
  float sss = sat(dot(normalize(vec2(L.x, L.z)), -n.xz) * 5.0 + 0.1) * sat(0.3 + 0.55 * h / amp);
  body += vec3(0.0, 0.055, 0.07) * sss * sss * S.amp;
  // Aerated wake water: bubbles scatter, turquoise.
  body = mix(body, vec3(0.02, 0.2, 0.24) * T, sat(aer * 0.85));
  body *= mix(0.55, 1.0, shadow);

  vec3 col = body * (1.0 - F) + skyRad(R) * F * mix(0.75, 1.0, shadow);

  vec3 H = normalize(L + V);
  float cosH = max(dot(n, H), 1e-3);
  float c2 = cosH * cosH;
  float Dg = exp(-(1.0 - c2) / (c2 * rough2)) / (3.14159 * rough2 * c2 * c2);
  float Fh = 0.02 + 0.98 * pow(1.0 - sat(dot(V, H)), 5.0);
  float spec = Dg * Fh / (4.0 * NdV) * sat(dot(n, L) * 4.0);
  col += vec3(1.0, 0.95, 0.86) * spec * 2.0 * shadow;

  // ------------------------------------------------------------ foam
  // Crest foam: folding (Jacobian) right now + decaying trails of recent breakers.
  float jf = smoothstep(0.32, 0.12, S.J);
  float wc = S.amp > 0.36 ? whitecaps(p, t, uTexF, S.amp) : 0.0;
  float capCov = sat(jf * 0.45 + wc * 0.4) * (1.0 - slick) * smoothstep(0.35, 0.8, S.amp);
  float fine = texture(uTexF, p / 11.0 - t * vec2(0.004, 0.006)).g;
  float capFoam = smoothstep(1.0 - capCov, 1.0 - capCov + 0.18, 0.45 * lace + 0.65 * fine) * sat(capCov * 1.5);
  float kelFoam = kelBrk * smoothstep(0.45, 0.85, 0.5 * lace + 0.5 * fine) * 0.7;
  float foam = sat(washFoam + bowFoam + hullFoam + quayFoam + capFoam * 0.9 + kelFoam);
  float lit = 0.72 + 0.28 * sat(dot(n, L));
  vec3 fcol = mix(vec3(0.38, 0.62, 0.7), vec3(0.88, 0.92, 0.95), sat(foam * 1.4 - 0.2)) * lit * mix(0.6, 1.0, shadow);
  col = mix(col, fcol, smoothstep(0.02, 0.85, foam));

  gl_FragColor = vec4(finish(col), 1.0);
}
`;

/* ---------------------------------------------------------------- class */

type P2 = [number, number];

export class OceanGL {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400000);
  mat: THREE.ShaderMaterial;
  mesh: THREE.Mesh;
  ribbonMat: THREE.ShaderMaterial;
  ribbon: THREE.Mesh;
  visible = false;
  private courseScene = new THREE.Scene();
  private course: THREE.WebGLRenderTarget | null = null;
  private courseType: THREE.TextureDataType | null = null;
  private cleared = true;
  private halfL: number;
  private halfB: number;
  private pos: Float32Array;
  private wake: Float32Array;
  private textures: THREE.Texture[] = [];
  private basin: { x0: number; x1: number; z0: number; z1: number };
  private quayZ: number;
  // sizing + quality
  private W = 1;
  private H = 1;
  private dpr = 0.7;
  private tier = 0;
  private gridKey = '';
  private lastFrame = 0;
  private avg = 16.7;
  private calm = 0;
  private settle = 0;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, basin: { x0: number; x1: number; z0: number; z1: number }, quayZ: number, hull: { L: number; B: number }) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance', premultipliedAlpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.halfL = hull.L / 200;
    this.halfB = hull.B / 200;
    this.basin = basin;
    this.quayZ = quayZ;
    // Start where the device can hold 60 fps; the governor moves from there.
    const gpu = classifyGPU(this.renderer.getContext() as WebGL2RenderingContext);
    this.tier = gpu.weak ? TIERS.length - 1 : 0;

    const loader = new THREE.TextureLoader();
    const aniso = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const tex = (name: string) => {
      const t = loader.load(`/water/${name}`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = aniso;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      this.textures.push(t);
      return t;
    };
    const texA = tex('water_a.jpg'), texF = tex('water_f.jpg');

    // Course buffer: float target (32-bit when it can be filtered, else 16-bit).
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const cbf = !!gl.getExtension('EXT_color_buffer_float');
    const f32lin = !!gl.getExtension('OES_texture_float_linear');
    const cbh = cbf || !!gl.getExtension('EXT_color_buffer_half_float');
    this.courseType = cbf && f32lin ? THREE.FloatType : cbh ? THREE.HalfFloatType : null;

    const uniforms = {
      uTime: { value: 0 },
      uEye: { value: new THREE.Vector3(0, 1000, 0) },
      uSun: { value: new THREE.Vector3(-0.38, 0.8, 0.52).normalize() },
      uQuayZ: { value: quayZ / 100 },
      uBasin: { value: new THREE.Vector4(basin.x0 / 100, basin.z0 / 100, basin.x1 / 100, basin.z1 / 100) },
      uNSw: { value: TIERS[this.tier].sw },
      uNDt: { value: TIERS[this.tier].dt },
      uTexA: { value: texA },
      uTexF: { value: texF },
      uCourse: { value: null as THREE.Texture | null },
      uWinC: { value: new THREE.Vector2() },
      uWinS: { value: 1000 },
      uCourseOn: { value: 0 },
      uShip: { value: new THREE.Vector2() },
      uDir: { value: new THREE.Vector2(1, 0) },
      uSpeed: { value: 0 },
      uU: { value: 0 },
      uDist: { value: 0 },
      uHasDist: { value: 0 },
      uLen: { value: 0 },
      uHalfL: { value: this.halfL },
      uHalfB: { value: this.halfB },
      uInvPV: { value: new THREE.Matrix4() },
    };

    this.mat = new THREE.ShaderMaterial({
      vertexShader: seaVert,
      fragmentShader: seaFrag,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    // Wake ribbon: ROWS_MAX rows × 3 vertices (port edge, centreline, starboard edge).
    this.pos = new Float32Array(ROWS_MAX * 3 * 3);
    this.wake = new Float32Array(ROWS_MAX * 3 * 4);
    const idx: number[] = [];
    for (let r = 0; r < ROWS_MAX - 1; r++) {
      const a = r * 3, b = a + 3;
      idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    rg.setAttribute('aWake', new THREE.BufferAttribute(this.wake, 4).setUsage(THREE.DynamicDrawUsage));
    rg.setIndex(idx);
    this.ribbonMat = new THREE.ShaderMaterial({
      vertexShader: courseVert,
      fragmentShader: courseFrag,
      uniforms: { uWinC: uniforms.uWinC, uWinS: uniforms.uWinS, uWMax: { value: W_MAX } },
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    this.ribbon = new THREE.Mesh(rg, this.ribbonMat);
    this.ribbon.frustumCulled = false;
    this.courseScene.add(this.ribbon);

    if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') (window as unknown as { __oceanGL: unknown }).__oceanGL = this;
  }

  /** Shading resolution = CSS size × dpr × tier scale. */
  resize(W: number, H: number, dpr: number) {
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.applySize();
  }

  /** Current quality tier (0 = best). */
  get quality() {
    return this.tier;
  }

  private applySize() {
    const T = TIERS[this.tier];
    this.renderer.setPixelRatio(this.dpr * T.res);
    this.renderer.setSize(this.W, this.H, false);
    this.mat.uniforms.uNSw.value = T.sw;
    this.mat.uniforms.uNDt.value = T.dt;
    // Grid: one vertex every T.grid CSS px, 4% past the frame for displacement.
    const nx = Math.min(320, Math.max(24, Math.ceil(this.W / T.grid)));
    const ny = Math.min(320, Math.max(24, Math.ceil(this.H / T.grid)));
    const key = `${nx}x${ny}`;
    if (key !== this.gridKey) {
      this.gridKey = key;
      const P = new Float32Array((nx + 1) * (ny + 1) * 3);
      for (let j = 0; j <= ny; j++)
        for (let i = 0; i <= nx; i++) {
          const o = (j * (nx + 1) + i) * 3;
          P[o] = (i / nx) * 2.08 - 1.04;
          P[o + 1] = (j / ny) * 2.08 - 1.04;
        }
      const I = new Uint32Array(nx * ny * 6);
      let k = 0;
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
          I[k++] = a; I[k++] = b; I[k++] = d;
          I[k++] = a; I[k++] = d; I[k++] = c;
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      g.setIndex(new THREE.BufferAttribute(I, 1));
      this.mesh.geometry.dispose();
      this.mesh.geometry = g;
    }
    // Course buffer resolution follows the tier.
    if (this.courseType !== null && (!this.course || this.course.width !== T.cb)) {
      this.course?.dispose();
      this.course = new THREE.WebGLRenderTarget(T.cb, T.cb, {
        type: this.courseType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: true,
        stencilBuffer: false,
        generateMipmaps: false,
      });
      this.mat.uniforms.uCourse.value = this.course.texture;
    }
  }

  /** Frame-time governor: steps quality down on long frames, back up when calm. */
  private govern() {
    const now = performance.now();
    const dt = this.lastFrame ? Math.min(100, now - this.lastFrame) : 16.7;
    this.lastFrame = now;
    if (dt > 90) return; // tab switch / hitch: not a load signal
    this.avg += (dt - this.avg) * 0.06;
    if (this.settle > 0) {
      this.settle--;
      return;
    }
    if (this.avg > 20.5 && this.tier < TIERS.length - 1) {
      this.tier++;
      this.avg = 16.7;
      this.settle = 45;
      this.calm = 0;
      this.applySize();
    } else if (this.avg < 12.5 && this.tier > 0) {
      if (++this.calm > 180) {
        this.tier--;
        this.calm = 0;
        this.settle = 45;
        this.applySize();
      }
    } else this.calm = 0;
  }

  /** Match the engine's orthographic view exactly (incl. screen anchor and roll). */
  private syncCamera(v: View, W: number, H: number) {
    const R = new THREE.Vector3(...v.R), U = new THREE.Vector3(...v.U), V = new THREE.Vector3(...v.V);
    const Rr = R.clone().multiplyScalar(v.cr).addScaledVector(U, v.sr);
    const Ur = U.clone().multiplyScalar(v.cr).addScaledVector(R, -v.sr);
    const m = new THREE.Matrix4().makeBasis(Rr, Ur, V);
    const cam = this.camera;
    cam.quaternion.setFromRotationMatrix(m);
    cam.position.set(v.T[0], v.T[1], v.T[2]).addScaledVector(V, 200000);
    cam.left = -v.cx / v.K;
    cam.right = (W - v.cx) / v.K;
    cam.top = v.cy / v.K;
    cam.bottom = -(H - v.cy) / v.K;
    cam.near = 1;
    cam.far = 400000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    (this.mat.uniforms.uInvPV.value as THREE.Matrix4).multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).invert();
    // Virtual perspective eye over the frame centre, ~1.1 frame widths away: gives
    // glitter and Fresnel a natural gradient across the picture. The engine's
    // views are low (pitch ~16-35°); a photo of this framing is shot from a drone
    // much higher up, so light the water as seen from ~60° elevation (grazing
    // Fresnel would turn the whole sea sky-grey).
    const span = W / v.K / 100;
    const cx = (W / 2 - v.cx) / v.K, cy = (H / 2 - v.cy) / v.K;
    const c = new THREE.Vector3(v.T[0], v.T[1], v.T[2]).addScaledVector(Rr, cx).addScaledVector(Ur, -cy);
    if (Math.abs(V.y) > 1e-3) c.addScaledVector(V, -c.y / V.y);
    const Vs = new THREE.Vector3(V.x, V.y + 1.6, V.z).normalize();
    (this.mat.uniforms.uEye.value as THREE.Vector3).set(c.x / 100, 0, c.z / 100).addScaledVector(Vs, span * 1.1);
  }

  /** Screen NDC point → water plane (world m). */
  private ground(x: number, y: number): P2 {
    const a = this.tmpA.set(x, y, -1).unproject(this.camera);
    const b = this.tmpB.set(x, y, 1).unproject(this.camera);
    const k = a.y / (a.y - b.y || 1e-6);
    return [(a.x + (b.x - a.x) * k) / 100, (a.z + (b.z - a.z) * k) / 100];
  }

  /** Lay the wake ribbon along the smoothed course. Pure function of the state. */
  private buildRibbon(s: OceanState) {
    const hL = this.halfL, hB = this.halfB;
    const d: P2 = [s.dir[0], s.dir[1]];
    const c: P2 = [s.ship[0] / 100, s.ship[1] / 100];
    const stern: P2 = [c[0] - d[0] * hL, c[1] - d[1] * hL];
    const ctrl: P2[] = [];
    const fwd = 2 * hL + AHEAD;
    const nF = Math.max(2, Math.round(fwd / 15));
    for (let i = 0; i < nF; i++) {
      const k = fwd * (1 - i / nF);
      ctrl.push([stern[0] + d[0] * k, stern[1] + d[1] * k]);
    }
    ctrl.push(stern);
    const iStern = ctrl.length - 1;
    for (let i = 1; i < s.trail.length; i++) {
      const q: P2 = [s.trail[i][0] / 100, s.trail[i][1] / 100];
      const l = ctrl[ctrl.length - 1];
      if (Math.hypot(q[0] - l[0], q[1] - l[1]) > 1.0) ctrl.push(q);
    }
    let len = 0;
    for (let i = iStern + 1; i < ctrl.length; i++) len += Math.hypot(ctrl[i][0] - ctrl[i - 1][0], ctrl[i][1] - ctrl[i - 1][1]);
    {
      const a = ctrl[ctrl.length - 2], b = ctrl[ctrl.length - 1];
      let ex = b[0] - a[0], ez = b[1] - a[1];
      const l = Math.hypot(ex, ez) || 1;
      ex /= l;
      ez /= l;
      if (ctrl.length - 1 === iStern) {
        ex = -d[0];
        ez = -d[1];
      }
      const n = Math.ceil(AFT_PAD / 15);
      for (let i = 1; i <= n; i++) ctrl.push([b[0] + (ex * (AFT_PAD * i)) / n, b[1] + (ez * (AFT_PAD * i)) / n]);
    }
    const pts: P2[] = [];
    const at = (i: number) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
    let sternRow = 0;
    for (let i = 0; i < ctrl.length - 1; i++) {
      if (i === iStern) sternRow = pts.length;
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      for (let k = 0; k < 4; k++) {
        const t = k / 4, t2 = t * t, t3 = t2 * t;
        const f = (a: number, b: number, cc: number, dd: number) =>
          0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - dd) * t2 + (-a + 3 * b - 3 * cc + dd) * t3);
        pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    pts.push(ctrl[ctrl.length - 1]);
    const rows = Math.min(ROWS_MAX, pts.length);
    const sArr = new Float32Array(rows);
    for (let i = 1; i < rows; i++) sArr[i] = sArr[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const s0 = sArr[Math.min(sternRow, rows - 1)];
    const P = this.pos, Wk = this.wake;
    for (let i = 0; i < rows; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(rows - 1, i + 1)];
      let tx = a[0] - b[0], tz = a[1] - b[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const nx = -tz, nz = tx;
      const sv = sArr[i] - s0;
      const kx = sv + 2 * hL + hB / 0.35355;
      const W = Math.min(W_MAX - 1, Math.max(hB + 60, 0.35355 * Math.max(kx, 0) * 1.16 + 30));
      for (let j = 0; j < 3; j++) {
        const lat = (j - 1) * W;
        const o = (i * 3 + j) * 3;
        P[o] = (pts[i][0] + nx * lat) * 100;
        P[o + 1] = 0;
        P[o + 2] = (pts[i][1] + nz * lat) * 100;
        const w = (i * 3 + j) * 4;
        Wk[w] = sv;
        Wk[w + 1] = lat;
        Wk[w + 2] = tx;
        Wk[w + 3] = tz;
      }
    }
    const g = this.ribbon.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aWake.needsUpdate = true;
    g.setDrawRange(0, Math.max(0, rows - 1) * 12);
    return len;
  }

  private clear() {
    if (!this.cleared) {
      this.renderer.setRenderTarget(null);
      this.renderer.clear();
      this.cleared = true;
    }
  }

  render(v: View, W: number, H: number, s: OceanState) {
    if (!this.visible) {
      this.clear();
      this.lastFrame = 0;
      return;
    }
    this.govern();
    this.syncCamera(v, W, H);

    // Visible water footprint (corners of the frame on the water plane).
    const cs = [this.ground(-1, -1), this.ground(1, -1), this.ground(1, 1), this.ground(-1, 1)];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of cs) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    const Q = this.quayZ / 100;
    if (z0 > Q + 2 || x1 < this.basin.x0 / 100 || x0 > this.basin.x1 / 100) {
      this.clear();
      return;
    }
    this.cleared = false;

    const u = this.mat.uniforms;
    u.uTime.value = s.time;
    (u.uShip.value as THREE.Vector2).set(s.ship[0] / 100, s.ship[1] / 100);
    (u.uDir.value as THREE.Vector2).set(s.dir[0], s.dir[1]);
    u.uSpeed.value = s.speed;
    u.uU.value = U_MAX * s.speed;

    // Pass 1: course buffer over the visible water (clipped to the sea side of the quay).
    if (this.course) {
      const len = this.buildRibbon(s);
      u.uLen.value = len;
      if (s.dist !== undefined) {
        u.uDist.value = s.dist / 100;
        u.uHasDist.value = 1;
      } else {
        u.uDist.value = len;
        u.uHasDist.value = 0;
      }
      const zz1 = Math.min(z1, Q + 5);
      let S = Math.max(x1 - x0, zz1 - z0) * 1.04 + 20;
      let cx = (x0 + x1) / 2, cz = (z0 + zz1) / 2;
      if (S > 2400) {
        // Very wide frame: centre on the ship's wake instead.
        S = 2400;
        cx = s.ship[0] / 100 - s.dir[0] * 500;
        cz = s.ship[1] / 100 - s.dir[1] * 500;
      }
      S = Math.max(S, 200);
      (u.uWinC.value as THREE.Vector2).set(cx, cz);
      u.uWinS.value = S;
      u.uCourseOn.value = 1;
      this.renderer.setRenderTarget(this.course);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, true, false);
      this.renderer.render(this.courseScene, this.camera);
      this.renderer.setRenderTarget(null);
    } else {
      u.uCourseOn.value = 0;
    }

    // Pass 2: the sea.
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.ribbon.geometry.dispose();
    this.mat.dispose();
    this.ribbonMat.dispose();
    this.course?.dispose();
    for (const t of this.textures) t.dispose();
    this.renderer.dispose();
  }
}
