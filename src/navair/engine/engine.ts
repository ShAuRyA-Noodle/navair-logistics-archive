/**
 * Orthographic "illustrated 3D" engine that renders straight to SVG.
 *
 * Every visible surface is a planar Face carrying ordinary 2D vector art in
 * its own (u, v) coordinates. Under an orthographic camera a plane maps to the
 * screen by an affine transform, so a face is drawn exactly by wrapping its art
 * in <g transform="matrix(a b c d e f)">. Orbiting the camera therefore keeps
 * full drawing detail at every angle: side elevation, top-down plan and every
 * view between them are the same art, projected.
 *
 * Painter's algorithm on face-centre depth (plus per-face bias / layer),
 * back-face culling, lambert shading overlays and wheel cylinders with a
 * convex-hull tread silhouette.
 */

import { compile, drawPicture, type Mat, type Picture } from './picture';
import { SpriteCache } from './sprites';
import {
  type M3,
  type V3,
  I3,
  add,
  apply,
  clamp,
  cross,
  dot,
  euler,
  hull,
  mul,
  norm,
  sc,
  scaleM,
  sub,
  DEG,
} from './math';

const SVGNS = 'http://www.w3.org/2000/svg';
/** Faces with fewer ops than this draw as vectors (as cheap as a textured quad). */
const SPRITE_MIN_OPS = 3;

export interface FaceDef {
  /** Local-space origin of the art's (0,0). */
  o: V3;
  /** Local-space direction of +u (unit length = 1 art unit). */
  a: V3;
  /** Local-space direction of +v (art y, pointing "down" in the drawing). */
  b: V3;
  /** Art extent, used for the depth centre and the shading overlay. */
  w: number;
  h: number;
  /** SVG markup in art coordinates. */
  art: string;
  /** Outline path (art coords) for the shading overlay. Default: the w×h rect. */
  outline?: string;
  /** Draw from both sides (decals, ground, thin plates). */
  double?: boolean;
  /** Added to depth for sorting (cm). */
  bias?: number;
  /** Primary sort key. Ground −10, default 0, overlays 10. */
  layer?: number;
  /** Multiplier on the lambert shading overlay. 0 disables it. */
  shade?: number;
  name?: string;
}

export interface WheelDef {
  r: number;
  /** Tyre width along the local Z axis. */
  w: number;
  /** Disc art centred at (0,0), drawn in a box of radius r. Rotates with spin. */
  disc: string;
  /** Static art over the disc (e.g. mudguard lip) – optional. */
  inner?: string;
  tread?: string;
  name?: string;
}

interface FaceRt {
  plane: string;
  def: FaceDef;
  node: Node3;
  /** SVG backend. */
  el: SVGGElement | null;
  shadeEl: SVGPathElement | null;
  /** Canvas backend. */
  pic: Picture | null;
  shadePath: Path2D | null;
  /** Sprite-cache id for the canvas backend (0: always draw vectors). */
  sid: number;
  M: Mat;
  alpha: number;
  depth: number;
  vis: boolean;
  layer: number;
  lastT: string;
  lastO: number;
  lastS: number;
}

interface DiscRt {
  el: SVGGElement | null;
  spinEl: SVGGElement | null;
  pic: Picture | null;
  innerPic: Picture | null;
  sid: number;
  isid: number;
  M: Mat;
  sign: number;
  depth: number;
  vis: boolean;
  lastT: string;
}

interface WheelRt {
  plane: string;
  def: WheelDef;
  node: Node3;
  hullEl: SVGPathElement | null;
  hullPts: [number, number][];
  discs: DiscRt[];
  depth: number;
  vis: boolean;
  lastD: string;
  lastO: number;
}

type DrawItem =
  | { k: 'f'; f: FaceRt; layer: number; depth: number; plane: string }
  | { k: 'h'; w: WheelRt; layer: number; depth: number; plane: string }
  | { k: 'd'; w: WheelRt; d: DiscRt; layer: number; depth: number; plane: string };

interface Plane {
  kind: 'svg' | 'canvas';
  svg?: SVGSVGElement;
  g?: SVGGElement;
  canvas?: HTMLCanvasElement;
  ctx?: CanvasRenderingContext2D;
  order: unknown[];
  /** Canvas: something changed since the last draw. */
  dirty: boolean;
}

export class Node3 {
  name: string;
  parent: Node3 | null = null;
  children: Node3[] = [];
  faces: FaceDef[] = [];
  wheels: WheelDef[] = [];
  /** Position in parent space. */
  p: V3 = [0, 0, 0];
  /** Euler degrees: y = yaw, z = pitch (about local Z), x = roll. */
  r = { x: 0, y: 0, z: 0 };
  s = 1;
  /** Per-axis scale (applied inside the rotation), e.g. to stretch a slab. */
  k: V3 = [1, 1, 1];
  opacity = 1;
  visible = true;
  /** Scenery drawn with weak perspective (parallax) instead of pure ortho. Inherited. */
  persp: boolean | undefined;
  /**
   * Render plane (separate stacked <svg>). Animated content (water, wake) lives
   * on its own plane so its per-frame changes don't repaint the whole world.
   * Inherited; default 'main'.
   */
  plane: string | undefined;
  /** Wheel spin in degrees, read by this node's wheels. */
  spin = 0;
  /** Layer override applied to every face of this subtree (unless set on the face). */
  layer: number | undefined;
  /** Bias added to every face of this subtree. */
  bias = 0;

  // world state
  wm: M3 = I3;
  wp: V3 = [0, 0, 0];
  wo = 1;
  wv = true;
  wpersp = false;

  constructor(name = 'node') {
    this.name = name;
  }

  add<T extends Node3>(child: T): T {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  node(name: string, p: V3 = [0, 0, 0]): Node3 {
    const n = new Node3(name);
    n.p = p;
    return this.add(n);
  }

  face(def: FaceDef): this {
    this.faces.push(def);
    return this;
  }

  wheel(def: WheelDef): this {
    this.wheels.push(def);
    return this;
  }

  find(name: string): Node3 | null {
    if (this.name === name) return this;
    for (const c of this.children) {
      const f = c.find(name);
      if (f) return f;
    }
    return null;
  }

  get(name: string): Node3 {
    const f = this.find(name);
    if (!f) throw new Error(`node "${name}" not found under "${this.name}"`);
    return f;
  }

  /** Recompute world transforms for this subtree. */
  update(pm: M3 = I3, pp: V3 = [0, 0, 0], po = 1, pv = true, pper = false) {
    let local = scaleM(euler(this.r.x, this.r.y, this.r.z), this.s);
    const k = this.k;
    if (k[0] !== 1 || k[1] !== 1 || k[2] !== 1) {
      local = mul(local, [k[0], 0, 0, 0, k[1], 0, 0, 0, k[2]]);
    }
    this.wm = mul(pm, local);
    this.wp = add(pp, apply(pm, this.p));
    this.wo = po * this.opacity;
    this.wv = pv && this.visible && this.wo > 0.002;
    this.wpersp = this.persp ?? pper;
    for (const c of this.children) c.update(this.wm, this.wp, this.wo, this.wv, this.wpersp);
  }

  /** World position of a local point (call after update()). */
  toWorld(v: V3): V3 {
    return add(this.wp, apply(this.wm, v));
  }

  /** World direction of a local vector. */
  dirWorld(v: V3): V3 {
    return apply(this.wm, v);
  }
}

export interface Camera {
  /** Target (world cm) placed at the screen anchor. */
  tx: number;
  ty: number;
  tz: number;
  /** Degrees. yaw 0 looks along −Z (viewer on +Z side). yaw 90 puts the viewer on +X. */
  yaw: number;
  /** Degrees. 0 = horizontal elevation view, 90 = straight down plan view. */
  pitch: number;
  /** Screen roll, degrees. */
  roll: number;
  /** Screen px per cm at the reference viewport height. */
  zoom: number;
  /** Screen anchor as a fraction of the viewport. */
  ax: number;
  ay: number;
}

export function defaultCamera(): Camera {
  return { tx: 0, ty: 0, tz: 0, yaw: 0, pitch: 0, roll: 0, zoom: 0.5, ax: 0.5, ay: 0.6 };
}

export interface View {
  R: V3;
  U: V3;
  V: V3;
  K: number;
  cx: number;
  cy: number;
  cr: number;
  sr: number;
  T: V3;
}

/** Light direction for lambert shading (toward the light). */
const LIGHT = norm([-0.38, 1, 0.52]);

const f2 = (n: number) => Math.round(n * 100) / 100;
const f4 = (n: number) => Math.round(n * 10000) / 10000;

export class Engine {
  root = new Node3('world');
  svg: SVGSVGElement | null;
  layerEl: SVGGElement | null;
  cam: Camera = defaultCamera();
  W = 1920;
  H = 1080;
  /** Viewport scale: screen px per "reference px". */
  k = 1;
  view!: View;
  /** Weak-perspective distance (cm) for nodes flagged `persp`. */
  F = 9000;
  /** Screen-px slack for viewport culling (art may overhang its w×h box). */
  cullMargin = 240;
  private faces: FaceRt[] = [];
  private wheels: WheelRt[] = [];
  private planes = new Map<string, Plane>();
  /** Device-pixel ratio for canvas planes (capped; may be lowered adaptively). */
  dpr = 1;
  private constraints: (() => void)[] = [];
  private afterRender: ((e: Engine) => void)[] = [];
  dirty = true;
  /**
   * Canvas backend: draw multi-op face art from cached bitmaps (see sprites.ts)
   * instead of re-rasterising every vector op each frame.
   */
  useSprites = true;
  private sprites: SpriteCache | null = null;

  /** Main plane: an <svg> (DOM backend, used by /lab) or a <canvas> (Canvas2D backend). */
  constructor(target: SVGSVGElement | HTMLCanvasElement, opts: { dpr?: number } = {}) {
    if (opts.dpr) this.dpr = opts.dpr;
    // Dev-only handle for the perf harness (scratch benchmarks call render()/repaint()).
    if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') (window as unknown as { __navairEngine?: Engine }).__navairEngine = this;
    if (target instanceof HTMLCanvasElement) {
      this.svg = null;
      this.layerEl = null;
      this.addCanvasPlane('main', target);
    } else {
      this.svg = target;
      this.layerEl = target.appendChild(document.createElementNS(SVGNS, 'g')) as SVGGElement;
      this.planes.set('main', { kind: 'svg', svg: target, g: this.layerEl, order: [], dirty: true });
    }
  }

  /** Register an extra stacked <svg> as a named render plane (see Node3.plane). */
  addPlane(name: string, svg: SVGSVGElement) {
    const g = svg.appendChild(document.createElementNS(SVGNS, 'g')) as SVGGElement;
    this.planes.set(name, { kind: 'svg', svg, g, order: [], dirty: true });
    svg.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);
  }

  /**
   * Register a <canvas> as a named render plane. Faces on it are compiled to
   * Path2D pictures once and drawn with one transform each per frame.
   */
  addCanvasPlane(name: string, canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: true })!;
    this.sprites ??= new SpriteCache(() => {
      for (const pl of this.planes.values()) if (pl.kind === 'canvas') pl.dirty = true;
    });
    this.planes.set(name, { kind: 'canvas', canvas, ctx, order: [], dirty: true });
    this.sizeCanvas(canvas);
  }

  private sizeCanvas(c: HTMLCanvasElement) {
    const w = Math.round(this.W * this.dpr), h = Math.round(this.H * this.dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  }

  /** Release cached face bitmaps (call from the owner's teardown). */
  dispose() {
    this.sprites?.dispose();
    this.sprites = null;
  }

  /** Force every canvas plane to repaint on the next render() (benchmarks, context restore). */
  repaint() {
    for (const pl of this.planes.values()) pl.dirty = true;
    this.dirty = true;
  }

  /** Change canvas resolution (adaptive quality). */
  setDpr(dpr: number) {
    if (Math.abs(dpr - this.dpr) < 0.01) return;
    this.dpr = dpr;
    for (const pl of this.planes.values()) {
      if (pl.canvas) {
        this.sizeCanvas(pl.canvas);
        pl.dirty = true;
      }
    }
  }

  private isCanvas(plane: string) {
    return (this.planes.get(plane) ?? this.planes.get('main'))!.kind === 'canvas';
  }

  private markDirty(plane: string) {
    const pl = this.planes.get(plane) ?? this.planes.get('main')!;
    pl.dirty = true;
  }

  /** Called before world transforms are computed each frame. */
  constrain(fn: () => void) {
    this.constraints.push(fn);
  }

  onRender(fn: (e: Engine) => void) {
    this.afterRender.push(fn);
  }

  resize(W: number, H: number, k: number) {
    this.W = W;
    this.H = H;
    this.k = k;
    for (const pl of this.planes.values()) {
      if (pl.svg) pl.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      if (pl.canvas) this.sizeCanvas(pl.canvas);
      pl.dirty = true;
    }
    this.dirty = true;
  }

  /** Create DOM (SVG planes) or compiled pictures (canvas planes) for every face/wheel. */
  mount() {
    const walk = (n: Node3, layer: number | undefined, bias: number, plane: string) => {
      const L = n.layer ?? layer;
      const B = bias + n.bias;
      const P = n.plane ?? plane;
      const onCanvas = this.isCanvas(P);
      for (const def of n.faces) {
        const d2 = { ...def, bias: (def.bias ?? 0) + B };
        const shaded = (def.shade ?? 1) > 0;
        const outline = def.outline ?? `M0 0H${def.w}V${def.h}H0Z`;
        let el: SVGGElement | null = null, shadeEl: SVGPathElement | null = null;
        let pic: Picture | null = null, shadePath: Path2D | null = null, sid = 0;
        if (onCanvas) {
          pic = compile(def.art);
          if (shaded) shadePath = new Path2D(outline);
          if (this.sprites && pic.ops.length >= SPRITE_MIN_OPS) sid = this.sprites.idFor(def.art);
        } else {
          el = document.createElementNS(SVGNS, 'g') as SVGGElement;
          el.setAttribute('class', 'fc');
          if (def.name) el.setAttribute('data-f', def.name);
          el.innerHTML = def.art;
          if (shaded) {
            shadeEl = document.createElementNS(SVGNS, 'path') as SVGPathElement;
            shadeEl.setAttribute('d', outline);
            shadeEl.setAttribute('fill', '#000');
            shadeEl.setAttribute('class', 'fc-shade');
            el.appendChild(shadeEl);
          }
        }
        this.faces.push({
          plane: P,
          def: d2,
          node: n,
          el,
          shadeEl,
          pic,
          shadePath,
          sid,
          M: [1, 0, 0, 1, 0, 0],
          alpha: 1,
          depth: 0,
          vis: false,
          layer: def.layer ?? L ?? 0,
          lastT: '',
          lastO: -1,
          lastS: -1,
        });
      }
      for (const w of n.wheels) {
        let hullEl: SVGPathElement | null = null;
        if (!onCanvas) {
          hullEl = document.createElementNS(SVGNS, 'path') as SVGPathElement;
          hullEl.setAttribute('fill', w.tread ?? '#15161a');
          hullEl.setAttribute('class', 'wh-tread');
        }
        const discPic = onCanvas ? compile(w.disc) : null;
        const innerPic = onCanvas && w.inner ? compile(w.inner) : null;
        const sid = discPic && this.sprites && discPic.ops.length >= SPRITE_MIN_OPS ? this.sprites.idFor(w.disc) : 0;
        const isid = innerPic && this.sprites && w.inner && innerPic.ops.length >= SPRITE_MIN_OPS ? this.sprites.idFor(w.inner) : 0;
        const discs: DiscRt[] = [1, -1].map((sign) => {
          if (onCanvas) {
            return { el: null, spinEl: null, pic: discPic, innerPic, sid, isid, M: [1, 0, 0, 1, 0, 0] as Mat, sign, depth: 0, vis: false, lastT: '' };
          }
          const el = document.createElementNS(SVGNS, 'g') as SVGGElement;
          el.setAttribute('class', 'wh-disc');
          const spinEl = document.createElementNS(SVGNS, 'g') as SVGGElement;
          spinEl.innerHTML = w.disc;
          el.appendChild(spinEl);
          if (w.inner) {
            const st = document.createElementNS(SVGNS, 'g');
            st.innerHTML = w.inner;
            el.appendChild(st);
          }
          return { el, spinEl, pic: null, innerPic: null, sid: 0, isid: 0, M: [1, 0, 0, 1, 0, 0] as Mat, sign, depth: 0, vis: false, lastT: '' };
        });
        this.wheels.push({ plane: P, def: w, node: n, hullEl, hullPts: [], discs, depth: 0, vis: false, lastD: '', lastO: -1 });
      }
      for (const c of n.children) walk(c, L, B, P);
    };
    walk(this.root, undefined, 0, 'main');
    this.dirty = true;
  }

  computeView(): View {
    const c = this.cam;
    const cy = Math.cos(c.yaw * DEG), sy = Math.sin(c.yaw * DEG);
    const cp = Math.cos(c.pitch * DEG), sp = Math.sin(c.pitch * DEG);
    const R: V3 = [cy, 0, -sy];
    const V0: V3 = [sy, 0, cy];
    const U: V3 = [-sp * V0[0], cp, -sp * V0[2]];
    const V: V3 = [sp * 0 + cp * V0[0], sp, cp * V0[2]];
    return {
      R,
      U,
      V,
      K: this.k * c.zoom,
      cx: c.ax * this.W,
      cy: c.ay * this.H,
      cr: Math.cos(c.roll * DEG),
      sr: Math.sin(c.roll * DEG),
      T: [c.tx, c.ty, c.tz],
    };
  }

  /** World point → screen px. */
  project(P: V3, v: View = this.view ?? this.computeView()): [number, number, number] {
    const d = sub(P, v.T);
    const x = v.K * dot(d, v.R);
    const y = -v.K * dot(d, v.U);
    return [v.cx + x * v.cr - y * v.sr, v.cy + x * v.sr + y * v.cr, dot(d, v.V)];
  }

  private hideFace(f: FaceRt) {
    if (!f.vis) return;
    f.vis = false;
    if (f.el) f.el.style.display = 'none';
    else this.markDirty(f.plane);
  }

  private hideWheel(w: WheelRt) {
    if (!w.vis) return;
    w.vis = false;
    if (w.hullEl) w.hullEl.style.display = 'none';
    for (const d of w.discs) {
      d.vis = false;
      if (d.el) d.el.style.display = 'none';
    }
    if (!w.hullEl) this.markDirty(w.plane);
  }

  render() {
    for (const c of this.constraints) c();
    this.root.update();
    const v = (this.view = this.computeView());
    const { R, U, V, K, cr, sr } = v;

    const draw: DrawItem[] = [];

    for (const f of this.faces) {
      const n = f.node;
      if (!n.wv) {
        this.hideFace(f);
        continue;
      }
      const d = f.def;
      const A = apply(n.wm, d.a);
      const B = apply(n.wm, d.b);
      const N = norm(cross(B, A));
      const facing = dot(N, V);
      if (!d.double && facing <= 0.0005) {
        this.hideFace(f);
        continue;
      }
      const O = n.toWorld(d.o);
      const C = add(O, add(sc(A, d.w / 2), sc(B, d.h / 2)));
      let [ex, ey] = this.project(O, v);
      let a = K * dot(A, R), b = -K * dot(A, U), c = K * dot(B, R), dd = -K * dot(B, U);
      if (sr !== 0) {
        [a, b] = [a * cr - b * sr, a * sr + b * cr];
        [c, dd] = [c * cr - dd * sr, c * sr + dd * cr];
      }
      if (n.wpersp) {
        // Grounded weak perspective: shrink with distance and parallax sideways,
        // but keep the object standing on the (orthographic) ground under it.
        const m = this.F / Math.max(this.F * 0.15, this.F - dot(sub(C, v.T), V));
        const [, gy] = this.project([n.wp[0], 0, n.wp[2]], v);
        a *= m; b *= m; c *= m; dd *= m;
        ex = v.cx + (ex - v.cx) * m;
        ey = gy + (ey - gy) * m;
      }
      // A face seen almost exactly edge-on collapses to a line, and a face whose
      // projected quad misses the viewport costs paint for nothing: hide both.
      const det = Math.abs(a * dd - b * c);
      const aw = a * d.w, bw = b * d.w, ch = c * d.h, dh = dd * d.h;
      const x0 = Math.min(ex, ex + aw, ex + ch, ex + aw + ch), x1 = Math.max(ex, ex + aw, ex + ch, ex + aw + ch);
      const y0 = Math.min(ey, ey + bw, ey + dh, ey + bw + dh), y1 = Math.max(ey, ey + bw, ey + dh, ey + bw + dh);
      const Mg = this.cullMargin;
      const off = x1 < -Mg || x0 > this.W + Mg || y1 < -Mg || y0 > this.H + Mg;
      if (det < 1e-6 || off) {
        this.hideFace(f);
        continue;
      }
      const o = Math.round(n.wo * 1000) / 1000;
      let s = 0;
      if (f.shadeEl || f.shadePath) {
        // Facing normal for double-sided faces seen from behind.
        const Nf = facing < 0 ? sc(N, -1) : N;
        const lam = clamp(dot(Nf, LIGHT), 0, 1);
        s = Math.round((1 - lam) * 0.27 * (d.shade ?? 1) * 1000) / 1000;
      }
      const t = `${f4(a)} ${f4(b)} ${f4(c)} ${f4(dd)} ${f2(ex)} ${f2(ey)}`;
      if (f.el) {
        if (!f.vis) {
          f.el.style.display = '';
          f.vis = true;
        }
        if (t !== f.lastT) f.el.setAttribute('transform', `matrix(${t})`);
        if (o !== f.lastO) f.el.style.opacity = o >= 1 ? '' : String(o);
        if (f.shadeEl && s !== f.lastS) f.shadeEl.setAttribute('fill-opacity', String(s));
      } else {
        if (!f.vis || t !== f.lastT || o !== f.lastO || s !== f.lastS) this.markDirty(f.plane);
        f.vis = true;
        f.M = [a, b, c, dd, ex, ey];
        f.alpha = o;
      }
      f.lastT = t;
      f.lastO = o;
      f.lastS = s;
      f.depth = dot(sub(C, v.T), V) + (d.bias ?? 0);
      draw.push({ k: 'f', f, layer: f.layer, depth: f.depth, plane: f.plane });
    }

    for (const w of this.wheels) {
      const n = w.node;
      if (!n.wv) {
        this.hideWheel(w);
        continue;
      }
      const { r, w: width } = w.def;
      const ax = n.dirWorld([0, 0, 1]);
      const e1 = n.dirWorld([1, 0, 0]);
      const e2 = n.dirWorld([0, 1, 0]);
      const c0 = n.wp;
      const pts: [number, number][] = [];
      for (const s of [-1, 1]) {
        const cc = add(c0, sc(ax, (s * width) / 2));
        for (let i = 0; i < 24; i++) {
          const t = (i / 24) * Math.PI * 2;
          const P = add(cc, add(sc(e1, Math.cos(t) * r), sc(e2, Math.sin(t) * r)));
          const [x, y] = this.project(P, v);
          pts.push([x, y]);
        }
      }
      const hp = hull(pts);
      let hx0 = Infinity, hx1 = -Infinity, hy0 = Infinity, hy1 = -Infinity;
      for (const q of hp) {
        if (q[0] < hx0) hx0 = q[0];
        if (q[0] > hx1) hx1 = q[0];
        if (q[1] < hy0) hy0 = q[1];
        if (q[1] > hy1) hy1 = q[1];
      }
      if (hx1 < 0 || hx0 > this.W || hy1 < 0 || hy0 > this.H) {
        this.hideWheel(w);
        continue;
      }
      const dstr = 'M' + hp.map((p) => `${f2(p[0])} ${f2(p[1])}`).join('L') + 'Z';
      const o = Math.round(n.wo * 1000) / 1000;
      if (w.hullEl) {
        if (dstr !== w.lastD) w.hullEl.setAttribute('d', dstr);
        if (o !== w.lastO) {
          const op = o >= 1 ? '' : String(o);
          w.hullEl.style.opacity = op;
          for (const dsc of w.discs) if (dsc.el) dsc.el.style.opacity = op;
        }
        if (!w.vis) w.hullEl.style.display = '';
      } else if (dstr !== w.lastD || o !== w.lastO || !w.vis) {
        this.markDirty(w.plane);
      }
      w.hullPts = hp;
      w.lastD = dstr;
      w.lastO = o;
      w.vis = true;
      const depth = dot(sub(c0, v.T), V) + n.bias;
      w.depth = depth;
      draw.push({ k: 'h', w, layer: n.layer ?? 0, depth: depth - 0.01, plane: w.plane });

      for (const dsc of w.discs) {
        const nrm = sc(ax, dsc.sign);
        const facing = dot(nrm, V);
        if (facing <= 0.01) {
          if (dsc.vis) {
            dsc.vis = false;
            if (dsc.el) dsc.el.style.display = 'none';
            else this.markDirty(w.plane);
          }
          continue;
        }
        // Disc plane: u along e1 (sign-flipped for the inner disc so art stays unmirrored), v along −e2.
        const A = sc(e1, dsc.sign);
        const B = sc(e2, -1);
        const O = add(c0, sc(ax, (dsc.sign * width) / 2));
        const [ex, ey] = this.project(O, v);
        let a = K * dot(A, R), b = -K * dot(A, U), c = K * dot(B, R), dd = -K * dot(B, U);
        if (sr !== 0) {
          [a, b] = [a * cr - b * sr, a * sr + b * cr];
          [c, dd] = [c * cr - dd * sr, c * sr + dd * cr];
        }
        // +spin = rolling toward +X. The inner disc's art is mirrored, so it turns the other way in art space.
        const spin = n.spin * dsc.sign;
        const t = `${f4(a)} ${f4(b)} ${f4(c)} ${f4(dd)} ${f2(ex)} ${f2(ey)} ${f2(spin)}`;
        if (dsc.el && dsc.spinEl) {
          if (t !== dsc.lastT) {
            dsc.el.setAttribute('transform', `matrix(${a} ${b} ${c} ${dd} ${ex} ${ey})`);
            dsc.spinEl.setAttribute('transform', `rotate(${f2(spin)})`);
          }
          if (!dsc.vis) dsc.el.style.display = '';
        } else {
          if (t !== dsc.lastT || !dsc.vis) this.markDirty(w.plane);
          const rad = (spin * Math.PI) / 180, cs = Math.cos(rad), sn = Math.sin(rad);
          // M · rotate(spin): the disc art spins about its own origin.
          dsc.M = [a * cs + c * sn, b * cs + dd * sn, -a * sn + c * cs, -b * sn + dd * cs, ex, ey];
          (dsc as DiscRt & { M0?: Mat }).M0 = [a, b, c, dd, ex, ey];
        }
        dsc.lastT = t;
        dsc.vis = true;
        dsc.depth = dot(sub(O, v.T), V) + n.bias;
        draw.push({ k: 'd', w, d: dsc, layer: n.layer ?? 0, depth: dsc.depth, plane: w.plane });
      }
    }

    draw.sort((p, q) => p.layer - q.layer || p.depth - q.depth);
    for (const [name, pl] of this.planes) {
      const mine = draw.filter((d) => (this.planes.has(d.plane) ? d.plane : 'main') === name);
      const key = (d: DrawItem) => (d.k === 'f' ? d.f : d.k === 'h' ? d.w : d.d);
      let same = mine.length === pl.order.length;
      if (same) {
        for (let i = 0; i < mine.length; i++) {
          if (key(mine[i]) !== pl.order[i]) {
            same = false;
            break;
          }
        }
      }
      if (!same) pl.order = mine.map(key);
      if (pl.kind === 'svg') {
        if (!same) {
          for (const d of mine) {
            const el = d.k === 'f' ? d.f.el : d.k === 'h' ? d.w.hullEl : d.d.el;
            if (el) pl.g!.appendChild(el);
          }
        }
      } else if (!same || pl.dirty) {
        this.paint(pl, mine);
        pl.dirty = false;
      }
    }
    for (const fn of this.afterRender) fn(this);
    this.dirty = false;
  }

  /** Canvas backend: repaint a plane in painter's order. */
  private paint(pl: Plane, items: DrawItem[]) {
    const ctx = pl.ctx!;
    const k = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const view = { w: pl.canvas!.width, h: pl.canvas!.height };
    ctx.clearRect(0, 0, view.w, view.h);
    const S = (m: Mat): Mat => [m[0] * k, m[1] * k, m[2] * k, m[3] * k, m[4] * k, m[5] * k];
    const sprites = this.useSprites ? this.sprites : null;
    sprites?.begin();
    // Group alpha on a sprite differs from per-op alpha where ops overlap, so
    // translucent multi-op art keeps the exact vector path.
    const pic = (p: Picture, sid: number, M: Mat, alpha: number) => {
      if (!(sid && sprites && alpha >= 1 && sprites.draw(ctx, p, sid, M, alpha))) drawPicture(ctx, p, M, alpha, view);
    };
    for (const it of items) {
      if (it.k === 'f') {
        const f = it.f;
        const M = S(f.M);
        pic(f.pic!, f.sid, M, f.alpha);
        if (f.shadePath && f.lastS > 0) {
          ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
          ctx.globalAlpha = f.alpha * f.lastS;
          ctx.fillStyle = '#000';
          ctx.fill(f.shadePath);
          ctx.globalAlpha = 1;
        }
      } else if (it.k === 'h') {
        const w = it.w;
        const pts = w.hullPts;
        if (pts.length < 3) continue;
        ctx.setTransform(k, 0, 0, k, 0, 0);
        ctx.globalAlpha = w.lastO;
        ctx.fillStyle = w.def.tread ?? '#15161a';
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        const d = it.d;
        pic(d.pic!, d.sid, S(d.M), it.w.lastO);
        const M0 = (d as DiscRt & { M0?: Mat }).M0;
        if (d.innerPic && M0) pic(d.innerPic, d.isid, S(M0), it.w.lastO);
      }
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    sprites?.trim();
  }
}

/* ------------------------------------------------------------------------ */
/* Face builders                                                             */
/* ------------------------------------------------------------------------ */

export interface BoxArt {
  /** +Z side (near side at yaw 0). Art box: sx × sy. */
  pz?: string;
  /** −Z side. Art box: sx × sy, drawn as seen from −Z (u runs along −X). */
  nz?: string;
  /** +X end. Art box: sz × sy, seen from +X (u runs along −Z). */
  px?: string;
  /** −X end. Art box: sz × sy, seen from −X (u runs along +Z). */
  nx?: string;
  /** Top. Art box: sx × sz, u along +X, v along +Z. */
  py?: string;
  /** Bottom. Art box: sx × sz, u along +X, v along −Z. */
  ny?: string;
}

export interface BoxOpts {
  bias?: number;
  layer?: number;
  shade?: number;
  name?: string;
  /** Per-face shade multipliers. */
  shades?: Partial<Record<keyof BoxArt, number>>;
}

/**
 * Axis-aligned box in node-local space. (x, y, z) is the min corner.
 * Only sides with art get faces.
 */
export function box(
  n: Node3,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  art: BoxArt,
  opts: BoxOpts = {},
) {
  const x1 = x + sx, y1 = y + sy, z1 = z + sz;
  const common = { bias: opts.bias, layer: opts.layer };
  const sh = (k: keyof BoxArt) => (opts.shades?.[k] ?? 1) * (opts.shade ?? 1);
  const nm = (k: string) => (opts.name ? `${opts.name}.${k}` : undefined);
  if (art.pz) n.face({ ...common, o: [x, y1, z1], a: [1, 0, 0], b: [0, -1, 0], w: sx, h: sy, art: art.pz, shade: sh('pz'), name: nm('pz') });
  if (art.nz) n.face({ ...common, o: [x1, y1, z], a: [-1, 0, 0], b: [0, -1, 0], w: sx, h: sy, art: art.nz, shade: sh('nz'), name: nm('nz') });
  if (art.px) n.face({ ...common, o: [x1, y1, z1], a: [0, 0, -1], b: [0, -1, 0], w: sz, h: sy, art: art.px, shade: sh('px'), name: nm('px') });
  if (art.nx) n.face({ ...common, o: [x, y1, z], a: [0, 0, 1], b: [0, -1, 0], w: sz, h: sy, art: art.nx, shade: sh('nx'), name: nm('nx') });
  if (art.py) n.face({ ...common, o: [x, y1, z], a: [1, 0, 0], b: [0, 0, 1], w: sx, h: sz, art: art.py, shade: sh('py'), name: nm('py') });
  if (art.ny) n.face({ ...common, o: [x, y, z1], a: [1, 0, 0], b: [0, 0, -1], w: sx, h: sz, art: art.ny, shade: sh('ny'), name: nm('ny') });
}

/**
 * Split one long face into `count` segments along u. Painter's sort uses each
 * face's centre, so a 12 m wall as one face mis-sorts against small parts near
 * its ends; segments sort locally. The art is shared and windowed per segment
 * with a nested <svg viewBox> (which also clips it).
 */
export function splitFace(n: Node3, def: FaceDef, count: number) {
  if (count <= 1) {
    n.face(def);
    return;
  }
  const sw = def.w / count;
  for (let i = 0; i < count; i++) {
    const u0 = sw * i;
    n.face({
      ...def,
      o: [def.o[0] + def.a[0] * u0, def.o[1] + def.a[1] * u0, def.o[2] + def.a[2] * u0],
      w: sw,
      // +0.8 overlap hides anti-aliasing seams between neighbouring segments.
      art: `<svg width="${sw + 0.8}" height="${def.h}" viewBox="${u0} 0 ${sw + 0.8} ${def.h}" overflow="hidden">${def.art}</svg>`,
      outline: undefined,
      name: def.name && `${def.name}.${i}`,
    });
  }
}

/** Solid-colour box helper: every side gets a rect of `fill` unless art given. */
export function solidBox(
  n: Node3,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  fill: string,
  art: BoxArt = {},
  opts: BoxOpts & { sides?: (keyof BoxArt)[] } = {},
) {
  const sides = opts.sides ?? ['pz', 'nz', 'px', 'nx', 'py', 'ny'];
  const r = (w: number, h: number) => `<rect width="${w}" height="${h}" fill="${fill}"/>`;
  const full: BoxArt = {};
  for (const s of sides) {
    const dims: Record<keyof BoxArt, [number, number]> = {
      pz: [sx, sy], nz: [sx, sy], px: [sz, sy], nx: [sz, sy], py: [sx, sz], ny: [sx, sz],
    };
    const [w, h] = dims[s];
    full[s] = art[s] ?? r(w, h);
  }
  box(n, x, y, z, sx, sy, sz, full, opts);
}

/**
 * Extruded side profile: a polygon drawn in the XY plane (SVG coords: x → +X,
 * y → −Y, so draw it like a side elevation with y growing downward from
 * `top`) extruded from z0 to z1. Produces the two caps (with art) plus flat
 * quads for each polygon edge (coloured by `edgeFill`, or per-edge function).
 *
 * `pts` are [x, yDown] in art space where world Y = top − yDown.
 */
export function prism(
  n: Node3,
  pts: [number, number][],
  top: number,
  z0: number,
  z1: number,
  opts: {
    capArt?: string;
    capArtBack?: string;
    edgeFill?: string | ((i: number, len: number, dx: number, dy: number) => string | null);
    edgeArt?: (i: number, len: number, depth: number) => string | null;
    bias?: number;
    layer?: number;
    shade?: number;
    name?: string;
  } = {},
) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const d = 'M' + pts.map((p) => `${p[0]} ${p[1]}`).join('L') + 'Z';
  const cap = opts.capArt ?? `<path d="${d}" fill="#555"/>`;
  // Front cap at z1, art coords == profile coords, origin at (0, top).
  n.face({ o: [0, top, z1], a: [1, 0, 0], b: [0, -1, 0], w: maxX, h: maxY, art: cap, outline: d, bias: opts.bias, layer: opts.layer, shade: opts.shade, name: opts.name && `${opts.name}.cap` });
  // Back cap at z0, mirrored: u along −X, so the art is flipped with scale(-1,1).
  const back = opts.capArtBack ?? cap;
  const dBack = 'M' + pts.map((p) => `${-p[0]} ${p[1]}`).join('L') + 'Z';
  n.face({
    o: [0, top, z0], a: [-1, 0, 0], b: [0, -1, 0], w: -maxX, h: maxY,
    art: `<g transform="scale(-1 1)">${back}</g>`, outline: dBack,
    bias: opts.bias, layer: opts.layer, shade: opts.shade, name: opts.name && `${opts.name}.back`,
  });
  // Edges. Winding decides which way is "out": for a polygon that is
  // counter-clockwise in world XY (y up), b = −Z makes b × a the outward normal.
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    area += p[0] * -q[1] - q[0] * -p[1];
  }
  const ccw = area > 0;
  const depth = z1 - z0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;
    const fill = typeof opts.edgeFill === 'function' ? opts.edgeFill(i, len, dx, dy) : opts.edgeFill ?? '#444';
    if (fill === null) continue;
    const art = opts.edgeArt?.(i, len, depth) ?? `<rect width="${len}" height="${depth}" fill="${fill}"/>`;
    n.face({
      o: [p[0], top - p[1], ccw ? z1 : z0],
      a: [dx / len, -dy / len, 0],
      b: [0, 0, ccw ? -1 : 1],
      w: len,
      h: depth,
      art,
      bias: opts.bias,
      layer: opts.layer,
      shade: opts.shade,
      name: opts.name && `${opts.name}.e${i}`,
    });
  }
}
