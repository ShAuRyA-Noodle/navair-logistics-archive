/**
 * Real-time WebGL ocean under the vector world.
 *
 * Two draws on one canvas:
 *  1. A ribbon mesh laid along the ship's (Catmull-Rom smoothed) course, from a
 *     little ahead of the bow to the end of the trail. Each vertex carries
 *     (s = metres aft of the stern, signed lateral offset, course tangent), so the
 *     wake is shaded in course coordinates with no per-pixel search: stern wash,
 *     aerated turquoise band, damped slick, bow wave, hull foam line and an
 *     analytic (stationary-phase) Kelvin pattern with transverse + divergent
 *     crests inside the 19.47° envelope. Depth = |lateral|, so where the ribbon
 *     overlaps itself on the inside of a turn the nearest centreline wins.
 *  2. The open-water plane (depth-tested behind the ribbon, so each pixel is
 *     shaded once). Same water model minus the wake.
 *
 * Water model (linear light, soft-knee tone map, sRGB out): Beer-Lambert navy
 * body with a turquoise subsurface lift on sun-facing crests, Schlick Fresnel
 * against a sky gradient, Beckmann sun glitter whose roughness absorbs the slope
 * variance the mip chain filters away (no speckle), three Gerstner swells, and
 * detail from baked tileable FFT-ocean slope maps (public/water, baked by
 * blender/ocean_textures.mjs) sampled at three scales and rotations. A virtual
 * perspective eye gives the glitter and Fresnel a gradient across the frame.
 *
 * Everything in the wake is a pure function of the course (trail + dist), so
 * scrolling back rewinds it exactly. The orthographic camera is rebuilt every
 * frame from the engine's view, so the water sits exactly under the canvas ship.
 */

import * as THREE from 'three';
import type { View } from '../engine/engine';
import { WaterSim } from './water/sim';

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
   * the wake's foam texture to the water (foam stays where it was laid and ages)
   * and lets the wake strength follow the speed the ship had when it passed.
   * Without it the foam pattern travels with the ship.
   */
  dist?: number;
}

/** Ship speed at speed = 1 (m/s): sets the Kelvin wavelength (2πU²/g ≈ 41 m). */
const U_MAX = 8.0;
/** Course distance over which the departure accelerates to full speed (m). */
const RAMP = 140;
const AHEAD = 60; // ribbon starts this far ahead of the stem (m)
const AFT_PAD = 60; // and runs this far past the trail's end (m)
const ROWS_MAX = 420;
const W_MAX = 480; // max ribbon half-width (m): depth normaliser

/* ------------------------------------------------------------------ GLSL */

const common = /* glsl */ `
precision highp float;
varying vec2 vW;
uniform float uTime;
uniform vec3 uEye;         // virtual perspective eye (metres, world)
uniform vec3 uSun;         // toward the sun (unit)
uniform float uQuayZ;      // metres
uniform vec4 uBasin;       // x0, z0, x1, z1 (metres)
uniform sampler2D uTexA, uTexB, uTexF;
// GPGPU heightfield (scene/water/sim.ts): (dh/dx, dh/dz, h, foam), ship-local window.
uniform sampler2D uSim;
uniform vec2 uSimC;        // world position of the window centre (m)
uniform float uSimS;       // window size (m)
uniform float uSimOn;

float sat(float x) { return clamp(x, 0.0, 1.0); }
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// ---------------------------------------------------------------- open sea
// Slopes (dh/dx, dh/dz) and a height proxy; 'lost' = slope variance the mip
// chain averaged away, handed to the glitter as roughness.
struct Sea { vec2 g; float h; float lost; float cap; float simFoam; float simW; };

const float LA = 88.0, LB = 34.0, LC = 12.5;          // tile sizes (m)
const float RA = 0.085, RB = 0.07, RC = 0.06;         // slope RMS per layer

vec3 tapSlope(sampler2D t, vec2 uv, mat2 R) {
  vec3 s = (texture2D(t, uv).rgb - 0.5) * 6.0;
  return vec3(s.xy * R, s.z);                         // back to world axes
}
float lostVar(float px, float L) { return sat(log2(max(px * 512.0 / L, 1.0)) / 4.0); }

Sea sea(vec2 p, float t, float px) {
  Sea o;
  // Long swell: three Gerstner trains (slopes only; the plane is flat).
  vec2 g = vec2(0.0);
  float h = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float lam = 150.0 * pow(0.62, fi);
    float k = 6.2831853 / lam;
    float a = 0.42 + 0.35 * sin(fi * 2.1 + 0.3);
    vec2 d = vec2(cos(a), sin(a));
    float ph = k * dot(d, p) - sqrt(9.81 * k) * t + fi * 1.9;
    float amp = lam * 0.0045;
    g += amp * k * cos(ph) * d;
    h += amp * sin(ph) / 0.7;
  }
  // Baked FFT sea: A large, B mid (rotated), A again fine (rotated the other way).
  mat2 Ra = rot(0.0), Rb = rot(0.83), Rc = rot(-1.27);
  vec2 wind = vec2(0.94, 0.34);
  vec3 a = tapSlope(uTexA, Ra * p / LA + wind * t * 0.011, Ra);
  vec3 b = tapSlope(uTexB, Rb * p / LB - vec2(0.021, -0.013) * t, Rb);
  vec3 c = tapSlope(uTexA, Rc * p / LC + vec2(0.037, 0.02) * t, Rc);
  g += a.xy * RA + b.xy * RB + c.xy * RC;
  h += a.z * 0.55 + b.z * 0.3;
  // Simulated water: ship waves, prop wash, reflections off quay and hull.
  vec2 suv = (p - uSimC) / uSimS + 0.5;
  vec2 se = min(suv, 1.0 - suv);
  float sw = uSimOn * smoothstep(0.03, 0.16, min(se.x, se.y));
  vec4 sm = sw > 0.0 ? texture2D(uSim, suv) : vec4(0.0);
  // Aerial readability: the simulated ship waves are drawn at 2x slope, and the
  // ambient chop is calmed where they are energetic (as in photos of wakes).
  float simE = sat(length(sm.xy) * 12.0) * sw;
  g = g * (1.0 - 0.45 * simE) + sm.xy * sw * 2.0;
  h += clamp(sm.z, -1.0, 1.0) * sw * 1.6;
  o.simFoam = sm.w * sw;
  o.simW = sw;
  o.g = g;
  o.h = h;
  o.lost = RA * RA * lostVar(px, LA) + RB * RB * lostVar(px, LB) + RC * RC * lostVar(px, LC);
  // Sparse whitecaps: fold foam at the mid scale, only on the highest crests.
  o.cap = texture2D(uTexF, Rb * p / LB - vec2(0.021, -0.013) * t).r * smoothstep(0.9, 1.9, h);
  return o;
}

// ---------------------------------------------------------------- lighting
vec3 skyRad(vec3 r) {
  float y = sat(r.y);
  vec3 zen = vec3(0.10, 0.24, 0.62), hor = vec3(0.55, 0.68, 0.84);
  return mix(hor, zen, pow(y, 0.55));
}

// Large-scale tone: slow depth / cloud-shadow drift + faint cyan glows.
vec3 tone(vec2 p) {
  float n = texture2D(uTexF, rot(0.7) * p / 1700.0 + vec2(0.31, 0.17) + uTime * vec2(0.0003, 0.0001)).b;
  float cloud = smoothstep(0.5, 0.8, n);
  float glow = smoothstep(0.45, 0.2, n);
  return vec3(1.0 - 0.28 * cloud) + vec3(-0.02, 0.18, 0.35) * glow * 0.35;
}

// Water radiance for a slope field; shadow = 1 in full sun.
vec3 water(vec2 p, vec2 g, float h, float rough2, float shadow) {
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 P = vec3(p.x, 0.0, p.y);
  vec3 V = normalize(uEye - P);
  vec3 L = uSun;
  float NdV = max(dot(n, V), 0.03);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, n);

  // Body: deep water returns only blue-green scattered light (Beer-Lambert).
  vec3 T = tone(p);
  vec3 absorb = exp(-vec3(0.45, 0.075, 0.03) * 60.0);
  vec3 body = vec3(0.0045, 0.029, 0.15) * (1.0 - absorb) * T;
  // Subsurface glow: light through crests on slopes facing the sun.
  float sss = sat(dot(normalize(vec3(L.x, 0.0, L.z)), -n) * 4.0 + 0.1) * sat(0.35 + 0.35 * h);
  body += vec3(0.004, 0.05, 0.075) * sss * sss;
  body *= mix(0.55, 1.0, shadow);

  vec3 col = body * (1.0 - F) + skyRad(R) * F * mix(0.8, 1.0, shadow);

  // Sun glitter: Beckmann lobe, roughness from unresolved slope variance.
  vec3 H = normalize(L + V);
  float cosH = max(dot(n, H), 1e-3);
  float c2 = cosH * cosH;
  float a2 = rough2;
  float D = exp(-(1.0 - c2) / (c2 * a2)) / (3.14159 * a2 * c2 * c2);
  float Fh = 0.02 + 0.98 * pow(1.0 - sat(dot(V, H)), 5.0);
  float spec = D * Fh / (4.0 * NdV) * sat(dot(n, L) * 4.0);
  col += vec3(1.0, 0.95, 0.86) * spec * 2.2 * shadow;
  return col;
}

vec3 finish(vec3 c) {
  // Soft knee: keeps the darks linear, rolls glitter off instead of clipping.
  const float k = 0.55;
  vec3 over = max(c - k, 0.0);
  c = min(c, vec3(k)) + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
  return srgb(clamp(c, 0.0, 1.0));
}
`;

/* ---- quay wall: lapping, backwash ripples, wall shadow (both passes) */
const quay = /* glsl */ `
  float dQ = uQuayZ - p.y;
  float wallShadow = smoothstep(0.6, 4.5, dQ);
  // Backwash ripples running off the wall.
  float rp = dQ * 1.35 - uTime * 1.7 + 0.8 * sin(p.x * 0.05 + uTime * 0.3);
  S.g.y += -0.05 * cos(rp) * exp(-dQ / 9.0);
  float quayFoam = 0.0;
  if (dQ < 20.0) {
    float lap = texture2D(uTexF, vec2(p.x / 45.0, dQ / 30.0 + uTime * 0.004)).g;
    quayFoam = exp(-dQ / 0.45) * (0.2 + 0.45 * lap) + exp(-dQ / 1.8) * 0.25 * smoothstep(0.6, 0.95, lap);
  }
`;

const planeVert = /* glsl */ `
varying vec2 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xz / 100.0;
  gl_Position = projectionMatrix * viewMatrix * w;
  gl_Position.z = 0.999 * gl_Position.w;     // behind the wake ribbon
}
`;

const planeFrag = common + /* glsl */ `
void main() {
  vec2 p = vW;
  float px = max(length(dFdx(p)), length(dFdy(p)));
  Sea S = sea(p, uTime, px);
  ${quay}
  vec3 col = water(p, S.g, S.h, 0.0035 + S.lost, wallShadow);
  float lace0 = texture2D(uTexF, p / 38.0 + uTime * vec2(0.002, 0.001)).g;
  float foam = sat(S.cap * 0.14 + quayFoam + smoothstep(0.05, 0.9, S.simFoam) * (0.3 + 0.8 * lace0));
  col = mix(col, vec3(0.78, 0.84, 0.9) * mix(0.75, 1.0, wallShadow), foam);
  gl_FragColor = vec4(finish(col), 1.0);
}
`;

const ribbonVert = /* glsl */ `
attribute vec4 aWake;       // s (m aft of stern), signed lateral (m), tangent xz
varying vec2 vW;
varying float vS;
varying float vLat;
varying vec2 vT;
uniform float uWMax;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xz / 100.0;
  vS = aWake.x;
  vLat = aWake.y;
  vT = aWake.zw;
  gl_Position = projectionMatrix * viewMatrix * w;
  // Nearest centreline wins where the ribbon overlaps itself.
  gl_Position.z = (abs(aWake.y) / uWMax * 1.96 - 0.98) * gl_Position.w;
}
`;

const ribbonFrag = common + /* glsl */ `
varying float vS;
varying float vLat;
varying vec2 vT;
uniform vec2 uShip;        // metres
uniform vec2 uDir;         // bow direction
uniform float uSpeed;      // 0..1
uniform float uU;          // m/s
uniform float uDist;       // course position of the stern (m)
uniform float uHasDist;    // 1 when uDist is the real course distance
uniform float uLen;        // trail length aft of the stern (m)
uniform float uHalfL;      // hull half length (m)
uniform float uHalfB;      // hull half beam (m)
uniform float uCov;        // how far aft (m) the simulated wake is developed

float hullHalfW(float u) {   // u: metres forward of midship
  float bowStart = uHalfL * 0.42;
  return uHalfB * (u > bowStart ? sqrt(sat(1.0 - pow((u - bowStart) / (uHalfL - bowStart), 2.0))) : 1.0);
}

void main() {
  vec2 p = vW;
  if (p.y > uQuayZ || p.x < uBasin.x || p.x > uBasin.z) discard;
  float t = uTime;
  float px = max(length(dFdx(p)), length(dFdy(p)));
  float sp = uSpeed;

  float s = vS, lat = vLat, a = abs(lat);
  vec2 T = normalize(vT);                  // toward the bow along the course
  vec2 N = vec2(-T.y, T.x);                // +lat side
  float sa = max(s, 0.0);
  float D = uDist - s;                     // course position of this water (m)
  // Wake laid here: strength = speed the ship had when it passed (pure in D).
  float tailFade = smoothstep(uLen + 2.0, uLen - 120.0, s);   // trail end fades out
  float hist = (uHasDist > 0.5 ? sat(D / ${RAMP.toFixed(1)}) : sp) * tailFade;
  float wakeOn = hist * step(0.0, s);

  // ---------------------------------------------------------- ship frame
  vec2 rel = p - uShip;
  vec2 side = vec2(-uDir.y, uDir.x);
  float u = dot(rel, uDir), v = dot(rel, side);
  float hw = hullHalfW(u);
  float dHull = max(abs(v) - hw, max(-uHalfL - u, u - uHalfL));

  // ---------------------------------------------------------- stern wake geometry
  float w = uHalfB * (0.78 + 0.95 * (1.0 - exp(-sa / 110.0))) + 0.028 * sa;
  float q = a / w;                         // 0 centreline, 1 edge
  // World-anchored streak noise, stretched ~25:1 along the course.
  float st1 = texture2D(uTexF, vec2(lat / 70.0 + 0.37, D / 1600.0)).b;
  float st2 = texture2D(uTexF, vec2(lat / 26.0 + 0.11, D / 560.0 - t * 0.0005)).b;
  float lace = texture2D(uTexF, vec2(lat / 48.0, D / 260.0) + vec2(t * 0.0015, 0.0)).g;
  float streak = sat(0.5 + 1.4 * (st1 - 0.5) + 0.8 * (st2 - 0.5));

  // Slick: the turbulent band damps the ambient chop (flatter, darker, glossier).
  float slick = wakeOn * exp(-q * q * 0.7) * (0.35 + 0.65 * exp(-sa / 1600.0));
  float damp = 1.0 - 0.78 * slick;

  Sea S = sea(p, t, px);
  S.g *= damp;
  S.cap *= damp;

  // ---------------------------------------------------------- Kelvin pattern
  // Stationary phase of a point source ~35 m ahead of the stem, so the cusp
  // lines (half-angle asin(1/3) = 19.47°) pass the bow shoulders.
  float kel = 0.0, kelFoam = 0.0;
  if (sp > 0.02) {
    float c = max(uU * uU / 9.81, 0.3);
    float x = s + 2.0 * uHalfL + uHalfB / 0.35355;
    float r = a / (max(x, 1.0) * 0.35355);
    if (x > 1.0 && r < 1.12) {
      float y = max(a, 1e-3);
      float disc = sqrt(max(x * x - 8.0 * y * y, 0.0));
      float Tt = (x - disc) / (4.0 * y);
      float Td = (x + disc) / (4.0 * y);
      float st = sqrt(1.0 + Tt * Tt), sd = sqrt(1.0 + Td * Td);
      float pt = st * (x - y * Tt) / c;
      float pd = sd * (x - y * Td) / c;
      float kt = st * st / c, kd = sd * sd / c;      // wavenumbers
      float env = smoothstep(1.1, 0.96, r) * exp(-x / 2400.0) / sqrt(1.0 + x / (8.0 * c));
      float cusp = 1.0 + 1.6 * exp(-pow((1.0 - min(r, 1.0)) * 7.0, 2.0));
      // Only water the ship has actually passed carries the pattern.
      float kh = s < 0.0 ? 1.0 : (uHasDist > 0.5 ? sat(D / ${RAMP.toFixed(1)}) : 1.0) * tailFade;
      // Inside the developed sim window the simulated Kelvin wake replaces the analytic one.
      float simK = S.simW * smoothstep(uCov, uCov - 90.0, s);
      float a0 = 0.6 * sp * sp * env * cusp * kh * (1.0 - simK);
      float at = a0 * (0.75 - 0.35 * r) * sat((6.2832 / kt / px - 2.5) / 3.0);
      // Divergent crests matter near the cusp; close to the track they are short
      // and steep and would only glint as specks.
      float ad = a0 * r * r * 1.2 * sat((6.2832 / kd / px - 4.0) / 4.0);
      float ct = cos(pt + 0.785), cd = cos(pd - 0.785);
      // grad(phase) = k (cos θ, sin θ) in (aft, lateral); θ = -atan(T).
      vec2 gl = at * ct * st / c * vec2(1.0, -Tt) + ad * cd * sd / c * vec2(1.0, -Td);
      gl.y *= sign(lat);
      // (aft, lateral) -> world
      vec2 gk = gl.x * (-T) + gl.y * N;
      S.g += gk * (1.0 - 0.5 * slick);
      kel = at * sin(pt + 0.785) + ad * sin(pd - 0.785);
      S.h += kel * 2.0;
      // Breaking on the divergent crests near the cusp, close to the ship.
      float brk = smoothstep(0.9, 1.8, kel / max(a0, 1e-3)) * exp(-(x - 2.0 * uHalfL) / 110.0) * smoothstep(0.6, 0.92, r) * smoothstep(1.04, 0.94, r);
      kelFoam = brk * smoothstep(0.3, 0.8, 0.55 * lace + 0.6 * st2) * sp * 0.3;
    }
  }

  // ---------------------------------------------------------- stern wash
  float prof = exp(-q * q * 2.4);
  float edgeL = exp(-pow((q - 0.82) / 0.14, 2.0));
  float core = prof * (exp(-sa / 110.0) + 0.22 * exp(-sa / 600.0));
  // Bubbly aerated water below the foam: turquoise, long-lived.
  float aer = wakeOn * exp(-q * q * 1.5) * (0.35 + 0.65 * exp(-sa / 520.0)) * smoothstep(-2.0, 12.0, s);
  // Foam: continuous density, texture only modulates it (never gates to dots).
  float strands = smoothstep(0.25, 0.85, 0.85 * streak + 0.25 * lace);
  // Boils: patchy turbulence, less stretched, strongest near the stern.
  float boil = texture2D(uTexF, vec2(lat / 24.0 + 0.5, D / 45.0) + vec2(0.0, t * 0.003)).g;
  float dens = wakeOn * (core * (0.15 + 1.0 * strands) * mix(1.0, 0.45 + 0.9 * boil, exp(-sa / 250.0))
             + 0.45 * edgeL * exp(-sa / 300.0) * smoothstep(0.35, 0.75, st2));
  // Right at the transom the prop wash is solid white.
  dens += wakeOn * exp(-sa / 45.0) * prof * 0.7;
  float wakeFoam = smoothstep(0.12, 0.85, dens);

  // ---------------------------------------------------------- bow + hull foam
  float xb = uHalfL - u;                   // metres aft of the stem
  float bowWave = 0.0, hullFoam = 0.0;
  if (dHull < 70.0) {
  if (sp > 0.02 && xb > -2.0) {
    float xp = max(xb, 0.0);
    // Primary bow crest peels off the stem at ~11° and breaks into a lacy line.
    float yb = hullHalfW(u) + xp * 0.2;
    float wb = 0.55 + 0.022 * xp;
    float along = texture2D(uTexF, vec2(v / 30.0, u / 240.0)).b;
    float bl = texture2D(uTexF, vec2((abs(v) - yb) / 14.0, u / 70.0)).g;
    bowWave = exp(-pow((abs(v) - yb) / wb, 2.0)) * exp(-xp / 85.0) * (0.35 + 0.6 * along + 0.5 * bl)
            * smoothstep(-2.0, 2.0, xb) * sp;
    // Spray sheet right at the stem.
    bowWave += exp(-xp / 9.0) * exp(-max(abs(v) - hullHalfW(u), 0.0) / 1.5) * sp * 0.8;
    bowWave *= smoothstep(70.0, 40.0, dHull);
  }
  float hullStreak = texture2D(uTexF, vec2(v / 18.0, u / 220.0 + t * 0.002 * (1.0 - sp))).b;
  float hullLace = texture2D(uTexF, vec2(v / 40.0, u / 40.0) + t * vec2(0.003, 0.005) * (1.0 - sp)).g;
  // Boundary-layer foam line hugging the hull (lapping lace when moored).
  hullFoam = step(0.0, dHull) * ((0.1 + 0.3 * smoothstep(0.4, 0.9, hullLace)) * (1.0 - sp) * exp(-dHull / 0.7)
                 + sp * (0.45 + 0.6 * hullStreak) * exp(-dHull / (0.6 + 0.5 * sp)));
  }

  ${quay}

  // ---------------------------------------------------------- shadows
  // Hull shadow (sun from the land side) and sky occlusion close to the hull.
  vec2 sp2 = rel + vec2(uSun.x, uSun.z) * 16.0;
  float su = dot(sp2, uDir), sv = dot(sp2, side);
  float dSh = max(abs(sv) - hullHalfW(su), abs(su) - uHalfL);
  float shadow = mix(0.45, 1.0, smoothstep(-0.5, 2.5, dSh));
  shadow *= 1.0 - 0.3 * exp(-max(dHull, 0.0) / 5.0);
  shadow *= wallShadow;

  // ---------------------------------------------------------- shade
  float rough2 = 0.0035 + S.lost * damp * damp + 0.004 * slick;
  vec3 col = water(p, S.g, S.h, rough2, shadow);
  vec3 turq = vec3(0.03, 0.21, 0.25) * mix(0.6, 1.0, shadow);
  col = mix(col, turq, sat(aer * (0.45 + 0.55 * streak)) * 0.8);
  float simFoam = smoothstep(0.05, 0.9, S.simFoam) * (0.3 + 0.8 * lace) * (0.5 + 0.6 * streak);
  float foam = sat(max(wakeFoam, 0.0) + kelFoam + bowWave * (1.0 - 0.4 * S.simW) + hullFoam + quayFoam + S.cap * 0.14 + simFoam);
  // Thin foam is translucent turquoise-white, dense foam is sunlit white.
  vec3 fcol = mix(vec3(0.42, 0.62, 0.72), vec3(0.86, 0.9, 0.93), sat(foam * 1.3 - 0.2)) * mix(0.62, 1.0, shadow);
  col = mix(col, fcol, smoothstep(0.02, 0.8, foam));
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
  private cleared = true;
  private halfL: number;
  private halfB: number;
  private pos: Float32Array;
  private wake: Float32Array;
  private textures: THREE.Texture[] = [];
  private sim: WaterSim | null = null;

  constructor(canvas: HTMLCanvasElement, basin: { x0: number; x1: number; z0: number; z1: number }, quayZ: number, hull: { L: number; B: number }) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance', premultipliedAlpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.halfL = hull.L / 200;
    this.halfB = hull.B / 200;

    const loader = new THREE.TextureLoader();
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
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
    const texA = tex('water_a.jpg'), texB = tex('water_b.jpg'), texF = tex('water_f.jpg');

    const shared = {
      uTime: { value: 0 },
      uEye: { value: new THREE.Vector3(0, 1000, 0) },
      uSun: { value: new THREE.Vector3(-0.35, 0.62, 0.7).normalize() },
      uQuayZ: { value: quayZ / 100 },
      uBasin: { value: new THREE.Vector4(basin.x0 / 100, basin.z0 / 100, basin.x1 / 100, basin.z1 / 100) },
      uTexA: { value: texA },
      uTexB: { value: texB },
      uTexF: { value: texF },
      uSim: { value: null as THREE.Texture | null },
      uSimC: { value: new THREE.Vector2() },
      uSimS: { value: 1024 },
      uSimOn: { value: 0 },
    };

    this.mat = new THREE.ShaderMaterial({
      vertexShader: planeVert,
      fragmentShader: planeFrag,
      uniforms: shared,
      depthTest: true,
      depthWrite: false,
    });
    const { x0, x1, z0, z1 } = basin;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1], 3));
    geo.setIndex([0, 2, 1, 0, 3, 2]);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
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
      vertexShader: ribbonVert,
      fragmentShader: ribbonFrag,
      uniforms: {
        ...shared,
        uWMax: { value: W_MAX },
        uShip: { value: new THREE.Vector2() },
        uDir: { value: new THREE.Vector2(1, 0) },
        uSpeed: { value: 0 },
        uU: { value: 0 },
        uDist: { value: 0 },
        uHasDist: { value: 0 },
        uLen: { value: 0 },
        uHalfL: { value: this.halfL },
        uHalfB: { value: this.halfB },
        uCov: { value: 0 },
      },
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    this.ribbon = new THREE.Mesh(rg, this.ribbonMat);
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 0;
    this.scene.add(this.ribbon);

    // WebGL2 half-float render targets are core (EXT_color_buffer_half_float / _float);
    // without them the ocean keeps its analytic model.
    const gl = this.renderer.getContext();
    const canSim = this.renderer.capabilities.isWebGL2 && !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    if (canSim) {
      this.sim = new WaterSim(this.renderer, this.halfL, this.halfB, quayZ / 100);
      shared.uSim.value = this.sim.texture;
      if (process.env.NODE_ENV !== 'production') { const w = window as unknown as { __oceanSim: unknown; __oceanGL: unknown }; w.__oceanSim = { sim: this.sim, renderer: this.renderer }; w.__oceanGL = this; }
    }
  }

  resize(W: number, H: number, dpr: number) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(W, H, false);
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
    // Screen anchor (cx, cy) maps to the target; y grows downward on screen.
    cam.left = -v.cx / v.K;
    cam.right = (W - v.cx) / v.K;
    cam.top = v.cy / v.K;
    cam.bottom = -(H - v.cy) / v.K;
    cam.near = 1;
    cam.far = 400000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    // Virtual perspective eye over the frame centre, ~1.1 frame widths away:
    // gives glitter and Fresnel a natural gradient across the picture.
    const span = (W / v.K) / 100;
    const cx = (W / 2 - v.cx) / v.K, cy = (H / 2 - v.cy) / v.K;
    const c = new THREE.Vector3(v.T[0], v.T[1], v.T[2]).addScaledVector(Rr, cx).addScaledVector(Ur, -cy);
    // Drop the centre onto the water plane along the view direction.
    if (Math.abs(V.y) > 1e-3) c.addScaledVector(V, -c.y / V.y);
    // The engine's views are low (pitch ~24-35°); a photo of this framing is shot
    // from a drone much higher up, so light the water as seen from ~65° elevation
    // (grazing Fresnel would turn the whole sea sky-grey).
    const Vs = new THREE.Vector3(V.x, V.y + 1.6, V.z).normalize();
    (this.mat.uniforms.uEye.value as THREE.Vector3).set(c.x / 100, 0, c.z / 100).addScaledVector(Vs, span * 1.1);
  }

  /** Lay the wake ribbon along the smoothed course. Pure function of the state. */
  private buildRibbon(s: OceanState) {
    const hL = this.halfL, hB = this.halfB;
    const d: P2 = [s.dir[0], s.dir[1]];
    const c: P2 = [s.ship[0] / 100, s.ship[1] / 100];
    const stern: P2 = [c[0] - d[0] * hL, c[1] - d[1] * hL];
    // Control points ~15 m apart: ahead of the bow → stern (straight), then the trail.
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
    // Trail length aft of the stern, then a straight run-out past its end.
    let len = 0;
    for (let i = iStern + 1; i < ctrl.length; i++) len += Math.hypot(ctrl[i][0] - ctrl[i - 1][0], ctrl[i][1] - ctrl[i - 1][1]);
    {
      const a = ctrl[ctrl.length - 2], b = ctrl[ctrl.length - 1];
      let ex = b[0] - a[0], ez = b[1] - a[1];
      const l = Math.hypot(ex, ez) || 1;
      ex /= l; ez /= l;
      if (ctrl.length - 1 === iStern) { ex = -d[0]; ez = -d[1]; }
      const n = Math.ceil(AFT_PAD / 15);
      for (let i = 1; i <= n; i++) ctrl.push([b[0] + ex * (AFT_PAD * i) / n, b[1] + ez * (AFT_PAD * i) / n]);
    }
    // Catmull-Rom subdivision (4 per span) → smooth centreline, no kinks.
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
    // Arc length, zero at the stern.
    const sArr = new Float32Array(rows);
    for (let i = 1; i < rows; i++) sArr[i] = sArr[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const s0 = sArr[Math.min(sternRow, rows - 1)];
    const P = this.pos, Wk = this.wake;
    for (let i = 0; i < rows; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(rows - 1, i + 1)];
      // Tangent toward the bow (the ribbon runs bow → aft).
      let tx = a[0] - b[0], tz = a[1] - b[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const nx = -tz, nz = tx;
      const sv = sArr[i] - s0;
      const kx = sv + 2 * hL + hB / 0.35355; // Kelvin distance from the virtual source
      const W = Math.min(W_MAX - 1, Math.max(hB + 45, 0.35355 * Math.max(kx, 0) * 1.16 + 25));
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

  render(v: View, W: number, H: number, s: OceanState) {
    if (!this.visible) {
      if (!this.cleared) {
        this.renderer.clear();
        this.cleared = true;
      }
      return;
    }
    this.cleared = false;
    this.syncCamera(v, W, H);
    this.stepSim(s);
    const len = this.buildRibbon(s);
    const u = this.ribbonMat.uniforms;
    u.uTime.value = s.time; // shared object with the plane material
    (u.uShip.value as THREE.Vector2).set(s.ship[0] / 100, s.ship[1] / 100);
    (u.uDir.value as THREE.Vector2).set(s.dir[0], s.dir[1]);
    u.uSpeed.value = s.speed;
    u.uU.value = U_MAX * s.speed;
    u.uLen.value = len;
    if (s.dist !== undefined) {
      u.uDist.value = s.dist / 100;
      u.uHasDist.value = 1;
    } else {
      u.uDist.value = len;
      u.uHasDist.value = 0;
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Advance the GPGPU water from the ship's current pose (only while visible). */
  private stepSim(s: OceanState) {
    const sim = this.sim;
    const u = this.mat.uniforms;
    if (!sim) return;
    sim.update({
      ship: [s.ship[0] / 100, s.ship[1] / 100],
      dir: s.dir,
      speed: s.speed,
      dist: (s.dist ?? 0) / 100,
      now: s.time,
    });
    u.uSim.value = sim.texture;
    const c = sim.centreWorld();
    (u.uSimC.value as THREE.Vector2).set(c[0], c[1]);
    u.uSimS.value = sim.S;
    u.uSimOn.value = 1;
    this.ribbonMat.uniforms.uCov.value = sim.coverage;
  }

  dispose() {
    this.sim?.dispose();
    this.mesh.geometry.dispose();
    this.ribbon.geometry.dispose();
    this.mat.dispose();
    this.ribbonMat.dispose();
    for (const t of this.textures) t.dispose();
    this.renderer.dispose();
  }
}
