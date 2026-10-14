/**
 * Ship-local GPGPU water heightfield (WebGL2, three render targets).
 *
 * Port of Evan Wallace's WebGL Water / jeantimex webgpu-water simulation
 * (update / normal / drop passes, ping-pong float textures, reflecting walls),
 * upgraded from the non-dispersive wave equation to deep-water dispersion
 * (omega^2 = g|k|, iWave-style) so a moving hull pressure patch radiates a real
 * Kelvin wake. See docs/research/webgpu-water-study.md.
 *
 * Units are metres and seconds. State texel: R = height, G = vertical velocity,
 * B = foam (0..1). The normal pass writes (dh/dx, dh/dz, h, foam) for rendering.
 *
 * Frames: the sim lives in "water coordinates" = world + drift. At sea, drift
 * absorbs any difference between the scroll-driven ship motion and the
 * physical speed U (the ship always moves through the water at U..1.5U), so
 * the wake looks like a ship under way at any scroll rate, and it stays
 * world-anchored when the scroll rate is realistic. While the quay is inside
 * the window the drift is frozen (the water is world-anchored) so the wall
 * never slides through the water. The grid is axis-aligned and recentred on the
 * ship in whole-texel shifts, so recentring never blurs.
 */

import * as THREE from 'three';

export interface SimInput {
  /** Ship centre, world metres (x, z). */
  ship: [number, number];
  /** Bow direction (unit, x z). */
  dir: [number, number];
  /** 0..1 */
  speed: number;
  /** Course distance (m); used only to detect jumps. */
  dist: number;
  /** Real time (s). */
  now: number;
}

const N = 512;
const DT = 1 / 60;
/** One step per frame; dt stretches to this on slow frames (stable: omega_max*dt < 0.3). */
const DT_MAX = 1 / 30;
const G = 9.81;
/** Window size (m): fine when moored (lapping), wide under way (Kelvin wake). */
const S_MOORED = 384;
const S_SEA = 1024;
const JUMP_FWD = 150; // m per frame forward: teleport (scroll jump)
const JUMP_BACK = 60; // m per frame backward: teleport (scrub back)
const RESET_GAP = 1.0; // s: at most one reset per this
const PREWARM = 44;
const PREWARM_ACC = 6; // s: the prewarm ship accelerates from rest over this
/** Hull pressure head (m) under way. */
const P0 = 6;

const quadVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/* Deep-water operator K ~ |k|: multi-scale 8-tap Laplacians at 1/2/5/12/30
   texels, weights least-squares fitted to |k| (±15 % over k = 0.05..2.8
   rad/texel, isotropic to a few %). The 30-texel ring keeps the long-wave
   limit (~19 m/s at 2 m texels) well above ship speed: with a plain Laplacian
   the sim behaves like shallow water and a ship near that speed piles up a
   resonant bulge. Neumann walls: a tap inside land or a moored hull reads
   the centre value, so waves reflect off the quay and the hull. */
const updateFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform float uTexel;       // 1/N
uniform float uPrevScale;   // S_new / S_old (recentring)
uniform vec2 uPrevOff;      // (O_new - O_old) / S_old
uniform float uS;           // window size (m)
uniform vec2 uO;            // grid centre, water coords (m)
uniform float uDt;
uniform float uTime;
uniform float uSeed;
uniform vec2 uShip;         // ship centre, water coords (m)
uniform vec2 uDir;
uniform float uHalfL, uHalfB;
uniform float uPress;       // hull pressure head (m)
uniform float uSolid;       // 0..1: moored hull acts as a wall
uniform float uProp;        // propeller wash strength
uniform float uSpeed;
uniform float uQuay;        // quay line, water coords z (m); land for z > uQuay
uniform float uInc;         // incident (ambient) swell amplitude scale
uniform float uLamMin;      // shortest resolvable wavelength (m)
uniform vec4 uDrop[4];      // x, z (water m), radius (m), strength (m)
uniform float uInit;        // 1: start from the incident swell everywhere (reset)

float sat(float x) { return clamp(x, 0.0, 1.0); }
vec2 world(vec2 uv) { return uO + (uv - 0.5) * uS; }

float hullHalfW(float u) {
  float bowStart = uHalfL * 0.42;
  return uHalfB * (u > bowStart ? sqrt(sat(1.0 - pow((u - bowStart) / (uHalfL - bowStart), 2.0))) : 1.0);
}
// Smooth hull footprint (0..1), soft over ~1.5 texels so the grid never aliases.
float hull(vec2 p) {
  vec2 r = p - uShip;
  float u = dot(r, uDir);
  float v = dot(r, vec2(-uDir.y, uDir.x));
  float m = 1.5 * uS * uTexel;
  float lon = smoothstep(uHalfL + m, uHalfL - 0.22 * uHalfL, u) * smoothstep(-uHalfL - m, -uHalfL + 0.3 * uHalfL, u);
  float hw = hullHalfW(u);
  float lat = smoothstep(hw + m, hw * 0.35, abs(v));
  return lon * lat;
}
// Pressure head = hull footprint. In steady motion the depression rides with the
// hull; starts are made from hydrostatic equilibrium so no transient hole is left.
float press(vec2 p, float hm) { return hm; }
float land(vec2 p) { return step(uQuay, p.y); }
bool gNear;                 // texel close enough to the hull to need hull() in its taps

vec4 prev(vec2 uv) { return texture2D(uPrev, 0.5 + (uv - 0.5) * uPrevScale + uPrevOff); }

// Surface "potential" seen by the operator: height + hull pressure head.
// Solid neighbours (quay, moored hull) read the centre value: reflecting wall.
float pot(vec2 uv, float hc) {
  vec2 p = world(uv);
  float hm = gNear ? hull(p) : 0.0;
  float s = max(land(p), uSolid * step(0.5, hm));
  return mix(prev(uv).r + uPress * (gNear ? press(p, hm) : 0.0), hc, s);
}
float ring(vec2 uv, float s, float hc) {
  float a = uTexel * s, d = a * 0.70710678;
  float sum = pot(uv + vec2(a, 0.0), hc) + pot(uv - vec2(a, 0.0), hc) + pot(uv + vec2(0.0, a), hc) + pot(uv - vec2(0.0, a), hc)
            + pot(uv + vec2(d, d), hc) + pot(uv - vec2(d, d), hc) + pot(uv + vec2(d, -d), hc) + pot(uv + vec2(-d, d), hc);
  return hc - sum * 0.125;
}
// Long rings only shape the low-k response, where 4 axial taps are isotropic.
float ring4(vec2 uv, float s, float hc) {
  float a = uTexel * s;
  return hc - 0.25 * (pot(uv + vec2(a, 0.0), hc) + pot(uv - vec2(a, 0.0), hc) + pot(uv + vec2(0.0, a), hc) + pot(uv - vec2(0.0, a), hc));
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Incident ambient swell (deep-water dispersion, heading toward the quay).
void incident(vec2 p, out float h, out float v) {
  h = 0.0; v = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float lam = max(uLamMin, vec3(8.5, 13.0, 21.0)[i]);
    float k = 6.2831853 / lam;
    float w = sqrt(9.81 * k);
    float an = vec3(-0.45, 0.18, 0.62)[i];
    vec2 d = vec2(sin(an), cos(an));
    float a = uInc * vec3(0.05, 0.07, 0.09)[i] * (lam / max(lam, 8.0));
    float ph = k * dot(d, p) - w * uTime + fi * 2.3;
    h += a * sin(ph);
    v += -a * w * cos(ph);
  }
}

void main() {
  vec2 uv = vUv;
  vec2 p = world(uv);
  vec4 c = prev(uv);
  float h = c.r, vel = c.g, foam = c.b;
  vec2 pu = 0.5 + (uv - 0.5) * uPrevScale + uPrevOff;
  if (any(lessThan(pu, vec2(0.0))) || any(greaterThan(pu, vec2(1.0)))) { incident(p, h, vel); foam = 0.0; }
  float dx = uS * uTexel;
  gNear = length(p - uShip) < uHalfL + 32.0 * dx;
  float hm0 = gNear ? hull(p) : 0.0;
  if (uInit > 0.5) { incident(p, h, vel); h -= uPress * hm0; foam = 0.0; }
  if (max(land(p), uSolid * step(0.5, hm0)) > 0.5) { gl_FragColor = vec4(0.0, 0.0, foam * 0.9, 0.0); return; }

  float hc = h + uPress * (gNear ? press(p, hm0) : 0.0);
  float K = 1.7239 * ring(uv, 1.0, hc) + 0.3105 * ring(uv, 2.0, hc) + 0.1995 * ring(uv, 5.0, hc) + 0.0451 * ring4(uv, 12.0, hc) + 0.0686 * ring4(uv, 30.0, hc);
  float acc = -9.81 * K / dx;                         // vertical acceleration (m/s^2)
  vel += acc * uDt;
  vel *= exp(-0.12 * uDt);                            // viscous + unresolved losses
  // Propeller wash: turbulent, smooth-noise impulses in a widening cone aft of the transom.
  {
    vec2 r = p - uShip;
    float u = dot(r, uDir), v = dot(r, vec2(-uDir.y, uDir.x));
    float ua = -uHalfL - u;
    float wide = uHalfB * (0.75 + ua / 70.0);
    float m = smoothstep(-6.0, 2.0, ua) * smoothstep(55.0, 5.0, ua) * smoothstep(wide, wide * 0.3, abs(v));
    if (m > 0.0 && uProp > 0.0) {
      float n = vnoise(p / (2.2 * dx) + vec2(uSeed * 7.3, uSeed * 3.1)) - 0.5;
      vel += n * uProp * m * uDt * 30.0;
      vel *= 1.0 - m * 0.04;
      foam += m * uProp * uDt * 2.0;
    }
  }
  // Drops (ambient excitation), cosine bump as in drop.frag, in metres.
  for (int i = 0; i < 4; i++) {
    vec4 d = uDrop[i];
    if (d.w != 0.0) {
      float t = max(0.0, 1.0 - length(p - d.xy) / d.z);
      h += (0.5 - 0.5 * cos(t * 3.14159265)) * d.w;
    }
  }
  h += vel * uDt;
  // Breaking crests (downward acceleration beyond ~0.4 g at a crest) make foam.
  // (Not inside the hull's pressure band, whose edge acceleration is not a wave.)
  float offHull = gNear ? 1.0 - smoothstep(0.0, 0.05, hm0) : 1.0;
  foam += smoothstep(0.5 * 9.81, 1.1 * 9.81, -acc) * smoothstep(0.05, 0.3, h) * offHull * uDt * 1.6;
  foam *= exp(-uDt / 6.0);

  // Relaxation zone at the window edge: absorbs outgoing waves and feeds the
  // incident ambient swell (wave maker), so the moored basin is alive.
  vec2 e2 = min(uv, 1.0 - uv);
  float edge = 1.0 - smoothstep(0.0, 0.07, min(e2.x, e2.y));
  if (edge > 0.0) {
    float hI, vI;
    incident(p, hI, vI);
    float r = 1.0 - exp(-uDt * 6.0 * edge);
    h = mix(h, hI, r);
    vel = mix(vel, vI, r);
    foam *= 1.0 - r;
  }
  gl_FragColor = vec4(clamp(h, -30.0, 30.0), clamp(vel, -30.0, 30.0), clamp(foam, 0.0, 1.0), 0.0);
}
`;

const normalFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uState;
uniform float uTexel;
uniform float uDx;
void main() {
  vec4 c = texture2D(uState, vUv);
  float hx1 = texture2D(uState, vUv + vec2(uTexel, 0.0)).r, hx0 = texture2D(uState, vUv - vec2(uTexel, 0.0)).r;
  float hz1 = texture2D(uState, vUv + vec2(0.0, uTexel)).r, hz0 = texture2D(uState, vUv - vec2(0.0, uTexel)).r;
  // Local height anomaly (high-passed): long, flat drifts carry no slope and must
  // not light up crests in the renderer.
  float r = 12.0 * uTexel;
  float mean = 0.25 * (texture2D(uState, vUv + vec2(r, 0.0)).r + texture2D(uState, vUv - vec2(r, 0.0)).r
                     + texture2D(uState, vUv + vec2(0.0, r)).r + texture2D(uState, vUv - vec2(0.0, r)).r);
  gl_FragColor = vec4((hx1 - hx0) / (2.0 * uDx), (hz1 - hz0) / (2.0 * uDx), c.r - mean, c.b);
}
`;

type V2 = [number, number];

export class WaterSim {
  readonly N = N;
  private r: THREE.WebGLRenderer;
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;
  private nrm: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private upd: THREE.ShaderMaterial;
  private nrmMat: THREE.ShaderMaterial;

  /** Drift: water coords = world + drift (m). */
  drift: V2 = [0, 0];
  /** Grid centre in water coords (m). */
  O: V2 = [0, 0];
  /** Window size (m). */
  S = S_MOORED;
  /** How far aft (m) the sim wake is developed (for blending with the far field). */
  coverage = 0;
  private shipW: V2 | null = null;
  private shipS: V2 = [0, 0];
  private lastDist = 0;
  private lastNow = 0;
  private lastReset = -1e9;
  private acc = 0;
  private simTime = 0;
  private seed = 0;
  private drops: { x: number; z: number; r: number; s: number }[] = [];
  private dropClock = 0;

  constructor(renderer: THREE.WebGLRenderer, private halfL: number, private halfB: number, private quayZ: number) {
    this.r = renderer;
    const mk = () =>
      new THREE.WebGLRenderTarget(N, N, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      });
    this.a = mk();
    this.b = mk();
    this.nrm = mk();
    this.upd = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: updateFrag,
      uniforms: {
        uPrev: { value: null },
        uTexel: { value: 1 / N },
        uPrevScale: { value: 1 },
        uPrevOff: { value: new THREE.Vector2() },
        uS: { value: this.S },
        uO: { value: new THREE.Vector2() },
        uDt: { value: DT },
        uTime: { value: 0 },
        uSeed: { value: 0 },
        uShip: { value: new THREE.Vector2() },
        uDir: { value: new THREE.Vector2(1, 0) },
        uHalfL: { value: halfL },
        uHalfB: { value: halfB },
        uPress: { value: 0 },
        uSolid: { value: 1 },
        uProp: { value: 0 },
        uSpeed: { value: 0 },
        uQuay: { value: quayZ },
        uInc: { value: 1 },
        uLamMin: { value: 6 },
        uDrop: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
        uInit: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.nrmMat = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: normalFrag,
      uniforms: { uState: { value: null }, uTexel: { value: 1 / N }, uDx: { value: this.S / N } },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.upd);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Normal texture: (dh/dx, dh/dz, high-passed h, foam), grid axis-aligned in water coords. */
  get texture() {
    return this.nrm.texture;
  }
  /** World position (m) of the grid centre. */
  centreWorld(): V2 {
    return [this.O[0] - this.drift[0], this.O[1] - this.drift[1]];
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.scene, this.cam);
  }

  private clear() {
    const prevAlpha = this.r.getClearAlpha();
    const col = new THREE.Color();
    this.r.getClearColor(col);
    this.r.setClearColor(0x000000, 0);
    for (const t of [this.a, this.b, this.nrm]) {
      this.r.setRenderTarget(t);
      this.r.clear(true, false, false);
    }
    this.r.setClearColor(col, prevAlpha);
  }

  private targetSize(speed: number) {
    const t = Math.min(1, Math.max(0, speed / 0.25));
    return S_MOORED + (S_SEA - S_MOORED) * t * t * (3 - 2 * t);
  }

  /** One physics step. `recentre` applies the grid shift (first substep only). */
  private ramp = 1;

  private step(dt: number, shipS: V2, dir: V2, speed: number, newS: number, newO: V2) {
    const u = this.upd.uniforms;
    const oldS = this.S;
    u.uPrevScale.value = newS / oldS;
    (u.uPrevOff.value as THREE.Vector2).set((newO[0] - this.O[0]) / oldS, (newO[1] - this.O[1]) / oldS);
    this.S = newS;
    this.O = [newO[0], newO[1]];
    const dx = newS / N;
    u.uS.value = newS;
    (u.uO.value as THREE.Vector2).set(newO[0], newO[1]);
    u.uDt.value = dt;
    this.simTime += dt;
    u.uTime.value = this.simTime;
    this.seed = (this.seed + 1) % 997;
    u.uSeed.value = this.seed;
    (u.uShip.value as THREE.Vector2).set(shipS[0], shipS[1]);
    (u.uDir.value as THREE.Vector2).set(dir[0], dir[1]);
    // Hull pressure head grows with speed (Froude scaling); moored: a wall.
    u.uPress.value = P0 * Math.min(1, speed / 0.12) * this.ramp;
    u.uSolid.value = Math.max(0, 1 - speed / 0.12);
    u.uProp.value = 0.35 * Math.min(1, speed * 2);
    u.uSpeed.value = speed;
    u.uQuay.value = this.quayZ + this.drift[1];
    u.uLamMin.value = 6.5 * dx;
    u.uInc.value = 1 - 0.6 * Math.min(1, speed * 2);
    const dv = u.uDrop.value as THREE.Vector4[];
    for (let i = 0; i < 4; i++) {
      const d = this.drops[i];
      if (d) dv[i].set(d.x, d.z, d.r, d.s);
      else dv[i].set(0, 0, 1, 0);
    }
    this.drops.length = 0;
    u.uPrev.value = this.a.texture;
    this.pass(this.upd, this.b);
    const t = this.a;
    this.a = this.b;
    this.b = t;
  }

  private normals() {
    const nu = this.nrmMat.uniforms;
    nu.uState.value = this.a.texture;
    nu.uDx.value = this.S / N;
    this.pass(this.nrmMat, this.nrm);
  }

  private snap(p: V2, S: number): V2 {
    const dx = S / N;
    return [Math.round(p[0] / dx) * dx, Math.round(p[1] / dx) * dx];
  }

  /** Ambient drops: sparse, small, near the ship's waterline and the quay. */
  private spawnDrops(dtFrame: number, shipS: V2, speed: number) {
    this.dropClock += dtFrame * (2.5 * (1 - Math.min(1, speed * 3)) + 0.5);
    while (this.dropClock > 1 && this.drops.length < 4) {
      this.dropClock -= 1;
      const a = Math.random() * Math.PI * 2;
      const rr = this.halfB * 1.2 + Math.random() * this.S * 0.3;
      this.drops.push({
        x: shipS[0] + Math.cos(a) * rr,
        z: shipS[1] + Math.sin(a) * rr,
        r: Math.max(2.5, (this.S / N) * 3),
        s: (Math.random() < 0.5 ? -1 : 1) * 0.03,
      });
    }
    if (this.dropClock > 1) this.dropClock = 1;
  }

  /** Reset and pre-warm: the ship approaches its current pose at speed U. */
  private reset(shipW: V2, dir: V2, speed: number) {
    this.clear();
    this.drift = [0, 0];
    this.S = this.targetSize(speed);
    this.shipS = [shipW[0], shipW[1]];
    this.O = this.snap(this.shipS, this.S);
    this.acc = 0;
    const U = 8 * speed;
    const n = PREWARM;
    // Largest stable step for the finest resolved wave: omega_max = sqrt(g*3.3/dx).
    const PREWARM_DT = Math.min(0.42, 1.5 / Math.sqrt((G * 3.3) / (this.S / N)));
    // Distance still to sail at step i with speed ramping smoothly from rest.
    const vAt = (t: number) => { const x = Math.min(1, t / PREWARM_ACC); return U * x * x * (3 - 2 * x); };
    const rem = new Float32Array(n + 1);
    for (let i = n - 1; i >= 0; i--) rem[i] = rem[i + 1] + vAt((i + 0.5) * PREWARM_DT) * PREWARM_DT;
    this.ramp = 1;
    for (let i = 0; i < n; i++) {
      this.upd.uniforms.uInit.value = i === 0 ? 1 : 0;
      const back = rem[i + 1];
      const s: V2 = [this.shipS[0] - dir[0] * back, this.shipS[1] - dir[1] * back];
      this.step(PREWARM_DT, s, dir, speed, this.S, this.O);
    }
    this.upd.uniforms.uInit.value = 0;
    this.ramp = 1;
    // A few fine steps to settle the high-frequency content.
    for (let i = 0; i < 8; i++) this.step(DT, this.shipS, dir, speed, this.S, this.O);
    this.coverage = rem[0];
  }

  /** Advance the sim for this frame. Call only while the ocean is visible. */
  update(inp: SimInput) {
    const shipW: V2 = [inp.ship[0], inp.ship[1]];
    const dir = inp.dir;
    const speed = inp.speed;
    const U = 8 * speed;
    let dtFrame = this.lastNow ? inp.now - this.lastNow : 0;
    this.lastNow = inp.now;
    dtFrame = Math.min(Math.max(dtFrame, 0), 0.1);

    const prevW = this.shipW;
    const dd = inp.dist - this.lastDist;
    const jump = !prevW || ((dd > JUMP_FWD || dd < -JUMP_BACK) && inp.now - this.lastReset > RESET_GAP);
    this.lastDist = inp.dist;
    this.shipW = shipW;
    if (jump) {
      this.lastReset = inp.now;
      this.reset(shipW, dir, speed);
      this.normals();
      this.r.setRenderTarget(null);
      return;
    }

    // Ship motion relative to the water: at least U, at most 1.5 U along the bow.
    const d: V2 = [shipW[0] - prevW![0], shipW[1] - prevW![1]];
    const along = d[0] * dir[0] + d[1] * dir[1];
    // The quay runs along x: sliding the water along x leaves the wall where it
    // is, but a z drift would slide the world-fixed wall through the water and
    // plough it. So near the quay only the x part of the drift is allowed.
    const quayGap = this.quayZ - shipW[1];
    const free = Math.min(1, Math.max(0, (quayGap - (this.S * 0.5 + 20)) / 80));
    const clamped = Math.min(Math.max(along, U * dtFrame), 1.5 * U * dtFrame);
    this.drift[0] += dir[0] * (clamped - along);
    this.drift[1] += dir[1] * (clamped - along) * free;
    if (free < 1 && Math.abs(this.drift[1]) > 2 && inp.now - this.lastReset > RESET_GAP) {
      // Came back toward the quay with a z drift: re-anchor.
      this.lastReset = inp.now;
      this.reset(shipW, dir, speed);
      this.normals();
      this.r.setRenderTarget(null);
      return;
    }
    const prevShipS = this.shipS;
    const shipS: V2 = [shipW[0] + this.drift[0], shipW[1] + this.drift[1]];
    this.shipS = shipS;

    // Fixed-rate physics on real time: one step per frame, dt in [1/60, 1/30].
    this.acc = Math.min(this.acc + dtFrame, DT_MAX);
    if (this.acc >= DT - 1e-4) {
      const dt = this.acc;
      this.acc = 0;
      this.spawnDrops(dt, shipS, speed);
      const newS = this.S + (this.targetSize(speed) - this.S) * Math.min(1, dt * 1.5);
      const newO = Math.abs(newS - this.S) < 1e-3 ? this.snap(shipS, this.S) : ([shipS[0], shipS[1]] as V2);
      this.step(dt, shipS, dir, speed, newS, newO);
      this.coverage += U * dt;
      this.normals();
    }
    void prevShipS;
    this.r.setRenderTarget(null);
  }

  /** Debug: read the normal texture (gx, gz, h, foam) as floats. */
  readback(): Float32Array {
    const u16 = new Uint16Array(N * N * 4);
    this.r.readRenderTargetPixels(this.nrm, 0, 0, N, N, u16);
    const out = new Float32Array(u16.length);
    for (let i = 0; i < u16.length; i++) out[i] = THREE.DataUtils.fromHalfFloat(u16[i]);
    return out;
  }

  dispose() {
    this.a.dispose();
    this.b.dispose();
    this.nrm.dispose();
    this.upd.dispose();
    this.nrmMat.dispose();
    this.quad.geometry.dispose();
  }
}
