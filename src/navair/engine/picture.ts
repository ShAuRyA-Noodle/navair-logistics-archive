/**
 * SVG-art → Canvas2D compiler.
 *
 * Face art is authored as SVG markup (so it stays readable and identical to the
 * SVG backend). For the canvas backend each face's markup is parsed ONCE into a
 * flat list of draw ops with pre-built Path2D objects and art-space matrices;
 * per frame a face is drawn with one setTransform per op. No DOM, no style or
 * layout work — this is what lets thousands of shapes hold 60 fps.
 *
 * Supported: g, rect (rx), path, circle, ellipse, line, polygon, polyline, text,
 * nested svg (viewBox + clip), clipPath, linear/radial gradients (both unit
 * systems for simple shapes), patterns (rasterised tiles), and the common
 * presentation attributes. Group opacity is multiplied into children (exact
 * for non-overlapping children, which is how face art is drawn).
 */

export type Mat = [number, number, number, number, number, number];

const I: Mat = [1, 0, 0, 1, 0, 0];

export function mmul(p: Mat, q: Mat): Mat {
  return [
    p[0] * q[0] + p[2] * q[1],
    p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3],
    p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4],
    p[1] * q[4] + p[3] * q[5] + p[5],
  ];
}

type Paint =
  | { k: 'color'; v: string }
  | { k: 'grad'; id: string; box: [number, number, number, number] | null }
  | { k: 'pat'; id: string };

interface Clip {
  path: Path2D;
  m: Mat;
  /** Axis-aligned window in the space of the ops' parent (nested <svg> viewport). */
  rect?: [number, number, number, number];
}

type Box = [number, number, number, number]; // x0, y0, x1, y1

interface PathOp {
  t: 'p';
  path: Path2D;
  /** Bounds in the op's own coordinates (before m), or null if unknown. */
  bb: Box | null;
  m: Mat;
  fill: Paint | null;
  stroke: Paint | null;
  fa: number;
  sa: number;
  lw: number;
  cap: CanvasLineCap;
  join: CanvasLineJoin;
  dash: number[] | null;
  dashOff: number;
  clips: Clip[];
}

interface TextOp {
  t: 't';
  bb: Box | null;
  text: string;
  x: number;
  y: number;
  m: Mat;
  font: string;
  stretch: string;
  align: CanvasTextAlign;
  ls: number;
  fill: Paint | null;
  fa: number;
  clips: Clip[];
}

export type Op = PathOp | TextOp;

export interface Picture {
  ops: Op[];
  /** Definitions (gradients/patterns) resolved lazily against a context. */
  defs: Map<string, Element>;
}

/* ------------------------------------------------------------------ parsing */

const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

function nums(s: string | null): number[] {
  if (!s) return [];
  return (s.match(NUM) ?? []).map(Number);
}

export function parseTransform(s: string | null): Mat {
  if (!s) return I;
  let m: Mat = I;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(s))) {
    const a = nums(r[2]);
    let t: Mat = I;
    switch (r[1]) {
      case 'matrix':
        t = [a[0], a[1], a[2], a[3], a[4], a[5]];
        break;
      case 'translate':
        t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case 'scale':
        t = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
        break;
      case 'rotate': {
        const rad = ((a[0] ?? 0) * Math.PI) / 180;
        const c = Math.cos(rad), sn = Math.sin(rad);
        const cx = a[1] ?? 0, cy = a[2] ?? 0;
        t = [c, sn, -sn, c, cx - c * cx + sn * cy, cy - sn * cx - c * cy];
        break;
      }
      case 'skewX':
        t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = mmul(m, t);
  }
  return m;
}

interface Style {
  fill: string;
  stroke: string;
  fa: number;
  sa: number;
  op: number;
  lw: number;
  cap: CanvasLineCap;
  join: CanvasLineJoin;
  dash: string;
  dashOff: number;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStretch: string;
  anchor: string;
  ls: number;
}

const ROOT_STYLE: Style = {
  fill: '#000',
  stroke: 'none',
  fa: 1,
  sa: 1,
  op: 1,
  lw: 1,
  cap: 'butt',
  join: 'miter',
  dash: 'none',
  dashOff: 0,
  fontSize: 16,
  fontFamily: 'sans-serif',
  fontWeight: '400',
  fontStretch: '100%',
  anchor: 'start',
  ls: 0,
};

function inlineStyle(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  const s = el.getAttribute('style');
  if (!s) return out;
  for (const part of s.split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function styleOf(el: Element, parent: Style): Style {
  const st = { ...parent };
  const css = inlineStyle(el);
  const g = (k: string) => css[k] ?? el.getAttribute(k);
  const v = (k: string) => {
    const x = g(k);
    return x === null || x === undefined ? null : x;
  };
  let x: string | null;
  if ((x = v('fill')) !== null) st.fill = x;
  if ((x = v('stroke')) !== null) st.stroke = x;
  if ((x = v('fill-opacity')) !== null) st.fa = parseFloat(x);
  if ((x = v('stroke-opacity')) !== null) st.sa = parseFloat(x);
  st.op = parent.op * ((x = v('opacity')) !== null ? parseFloat(x) : 1);
  if ((x = v('stroke-width')) !== null) st.lw = parseFloat(x);
  if ((x = v('stroke-linecap')) !== null) st.cap = x as CanvasLineCap;
  if ((x = v('stroke-linejoin')) !== null) st.join = x as CanvasLineJoin;
  if ((x = v('stroke-dasharray')) !== null) st.dash = x;
  if ((x = v('stroke-dashoffset')) !== null) st.dashOff = parseFloat(x);
  if ((x = v('font-size')) !== null) st.fontSize = parseFloat(x);
  if ((x = v('font-family')) !== null) st.fontFamily = x;
  if ((x = v('font-weight')) !== null) st.fontWeight = x;
  if ((x = v('font-stretch')) !== null) st.fontStretch = x;
  if ((x = v('text-anchor')) !== null) st.anchor = x;
  if ((x = v('letter-spacing')) !== null) st.ls = parseFloat(x);
  return st;
}

function paintOf(s: string, box: [number, number, number, number] | null): Paint | null {
  if (!s || s === 'none' || s === 'transparent') return null;
  const u = /url\(#([^)]+)\)/.exec(s);
  if (u) return { k: 'grad', id: u[1], box } as Paint;
  return { k: 'color', v: s };
}

function a(el: Element, k: string, d = 0) {
  const v = el.getAttribute(k);
  return v === null ? d : parseFloat(v);
}

function resolveFamily(f: string) {
  // Face art references the page fonts through CSS custom properties.
  return f.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
    const v = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '';
    return v || 'sans-serif';
  });
}

function stretchKeyword(p: string): string {
  const n = parseFloat(p);
  if (!Number.isFinite(n)) return p || 'normal';
  if (n <= 62.5) return 'ultra-condensed';
  if (n <= 75) return 'extra-condensed';
  if (n <= 87.5) return 'condensed';
  if (n < 100) return 'semi-condensed';
  if (n === 100) return 'normal';
  if (n <= 112.5) return 'semi-expanded';
  if (n <= 125) return 'expanded';
  if (n <= 150) return 'extra-expanded';
  return 'ultra-expanded';
}

/** Parse face art into a Picture. `defsOut` collects gradients/patterns/clipPaths by id. */
export function compile(art: string, sharedDefs?: Map<string, Element>): Picture {
  const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${art}</svg>`, 'image/svg+xml');
  const root = doc.documentElement;
  const defs = sharedDefs ?? new Map<string, Element>();
  root.querySelectorAll('[id]').forEach((el) => defs.set(el.getAttribute('id')!, el));
  const ops: Op[] = [];

  const clipOf = (ref: string | null, m: Mat): Clip[] => {
    if (!ref) return [];
    const id = /url\(#([^)]+)\)/.exec(ref)?.[1];
    const cp = id ? defs.get(id) : undefined;
    if (!cp) return [];
    const out: Clip[] = [];
    for (const child of Array.from(cp.children)) {
      const sh = shapeOf(child);
      if (sh) out.push({ path: sh.path, m: mmul(m, parseTransform(child.getAttribute('transform'))) });
    }
    return out;
  };

  const walk = (el: Element, m: Mat, st: Style, clips: Clip[]) => {
    const tag = el.tagName;
    if (tag === 'defs' || tag === 'clipPath' || tag === 'linearGradient' || tag === 'radialGradient' || tag === 'pattern' || tag === 'mask' || tag === 'filter') return;
    const s = styleOf(el, st);
    let mm = m;
    const tr = el.getAttribute('transform');
    if (tr) mm = mmul(m, parseTransform(tr));
    let cl = clips;
    const cref = el.getAttribute('clip-path');
    if (cref) cl = clips.concat(clipOf(cref, mm));

    if (tag === 'svg' && el !== root) {
      // Nested viewport: translate to x/y, map viewBox → width/height, clip if overflow hidden.
      const x = a(el, 'x'), y = a(el, 'y');
      const w = a(el, 'width'), h = a(el, 'height');
      const vb = nums(el.getAttribute('viewBox'));
      let vm: Mat = [1, 0, 0, 1, x, y];
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
        const sx = w / vb[2], sy = h / vb[3];
        vm = mmul(vm, [sx, 0, 0, sy, -vb[0] * sx, -vb[1] * sy]);
      }
      const inner = mmul(mm, vm);
      const box = new Path2D();
      box.rect(x, y, w, h);
      const ov = el.getAttribute('overflow');
      const cl2 = ov === 'visible' ? cl : cl.concat([{ path: box, m: mm, rect: [x, y, x + w, y + h] }]);
      for (const c of Array.from(el.children)) walk(c, inner, s, cl2);
      return;
    }
    if (tag === 'g' || tag === 'svg' || tag === 'a') {
      for (const c of Array.from(el.children)) walk(c, mm, s, cl);
      return;
    }
    if (tag === 'text') {
      const txt = el.textContent ?? '';
      if (!txt) return;
      const css = inlineStyle(el);
      const stretch = css['font-stretch'] ?? s.fontStretch;
      const fx = a(el, 'x'), fy = a(el, 'y'), fs = s.fontSize;
      const wEst = txt.length * fs * 0.75 + txt.length * Math.abs(s.ls);
      const x0 = s.anchor === 'middle' ? fx - wEst / 2 : s.anchor === 'end' ? fx - wEst : fx;
      ops.push({
        t: 't',
        bb: [x0 - fs, fy - fs * 1.2, x0 + wEst + fs, fy + fs * 0.4],
        text: txt,
        x: a(el, 'x'),
        y: a(el, 'y'),
        m: mm,
        font: `${s.fontWeight} ${s.fontSize}px ${resolveFamily(s.fontFamily)}`,
        stretch: stretchKeyword(stretch),
        align: s.anchor === 'middle' ? 'center' : s.anchor === 'end' ? 'right' : 'left',
        ls: s.ls,
        fill: paintOf(s.fill, null),
        fa: s.fa * s.op,
        clips: cl,
      });
      return;
    }
    const sh = shapeOf(el);
    if (!sh) return;
    const dash = s.dash && s.dash !== 'none' ? nums(s.dash) : null;
    const bb: Box | null = sh.bb !== undefined ? sh.bb : sh.box ? [sh.box[0], sh.box[1], sh.box[0] + sh.box[2], sh.box[1] + sh.box[3]] : null;
    const pad = s.stroke && s.stroke !== 'none' ? s.lw : 0;
    ops.push({
      t: 'p',
      path: sh.path,
      bb: bb ? [bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad] : null,
      m: mm,
      fill: paintOf(s.fill, sh.box),
      stroke: paintOf(s.stroke, sh.box),
      fa: s.fa * s.op,
      sa: s.sa * s.op,
      lw: s.lw,
      cap: s.cap,
      join: s.join,
      dash: dash && dash.length ? dash : null,
      dashOff: s.dashOff,
      clips: cl,
    });
  };

  for (const c of Array.from(root.children)) walk(c, I, ROOT_STYLE, []);
  return { ops: batch(windowed(ops)), defs };
}

/* ------------------------------------------------------------ optimisation */

function xformBox(m: Mat, b: Box): Box {
  const xs = [b[0], b[2], b[0], b[2]], ys = [b[1], b[1], b[3], b[3]];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 4; i++) {
    const x = m[0] * xs[i] + m[2] * ys[i] + m[4];
    const y = m[1] * xs[i] + m[3] * ys[i] + m[5];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

function invert(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/**
 * Nested-<svg> windows (from splitFace) clip every op. Resolve them statically:
 * ops fully outside a window are dropped, ops fully inside lose that clip.
 * Only ops straddling a window edge keep a real canvas clip.
 */
function windowed(ops: Op[]): Op[] {
  const out: Op[] = [];
  const clipCache = new Map<string, Clip[]>();
  for (const op of ops) {
    if (!op.clips.length || !op.bb) {
      out.push(op);
      continue;
    }
    let drop = false;
    const keep: Clip[] = [];
    for (const c of op.clips) {
      if (!c.rect) {
        keep.push(c);
        continue;
      }
      // Op bounds in the window's space: window space → op space is inv(c.m)·op.m.
      const inv = invert(c.m);
      if (!inv) {
        keep.push(c);
        continue;
      }
      const b = xformBox(mmulLocal(inv, op.m), op.bb);
      const r = c.rect;
      if (b[2] < r[0] || b[0] > r[2] || b[3] < r[1] || b[1] > r[3]) {
        drop = true;
        break;
      }
      const inside = b[0] >= r[0] && b[2] <= r[2] && b[1] >= r[1] && b[3] <= r[3];
      if (!inside) keep.push(c);
    }
    if (drop) continue;
    if (keep.length === op.clips.length) {
      out.push(op);
      continue;
    }
    // Share identical clip arrays so the drawer's clip-state reuse still works.
    const key = keep.map((c) => clipId(c)).join('|');
    let arr = clipCache.get(key);
    if (!arr) clipCache.set(key, (arr = keep));
    out.push({ ...op, clips: arr });
  }
  return out;
}

const clipIds = new WeakMap<Clip, number>();
let clipSeq = 0;
function clipId(c: Clip) {
  let id = clipIds.get(c);
  if (id === undefined) clipIds.set(c, (id = ++clipSeq));
  return id;
}

function mmulLocal(p: Mat, q: Mat): Mat {
  return mmul(p, q);
}

function samePaint(a: Paint | null, b: Paint | null) {
  if (!a || !b) return a === b;
  return a.k === 'color' && b.k === 'color' && a.v === b.v;
}

/**
 * Merge consecutive fill-only path ops that share paint, alpha and clip state
 * into one Path2D (transforms baked with addPath). Order is preserved, so the
 * result paints identically with far fewer fill calls.
 */
function batch(ops: Op[]): Op[] {
  const out: Op[] = [];
  let cur: PathOp | null = null;
  for (const op of ops) {
    const mergeable = op.t === 'p' && !op.stroke && op.fill && op.fill.k === 'color';
    if (
      mergeable &&
      cur &&
      samePaint(cur.fill, (op as PathOp).fill) &&
      cur.fa === (op as PathOp).fa &&
      cur.clips === op.clips
    ) {
      cur.path.addPath((op as PathOp).path, new DOMMatrix(op.m));
      continue;
    }
    if (mergeable) {
      const p = new Path2D();
      p.addPath((op as PathOp).path, new DOMMatrix(op.m));
      cur = { ...(op as PathOp), path: p, m: I, bb: null };
      out.push(cur);
    } else {
      cur = null;
      out.push(op);
    }
  }
  return out;
}

/** Conservative bounds of SVG path data (control points and arc radii included). */
export function pathBounds(d: string): Box | null {
  const tok = d.match(/[a-df-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi);
  if (!tok) return null;
  let x = 0, y = 0, sx = 0, sy = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (px: number, py: number, r = 0) => {
    if (px - r < x0) x0 = px - r;
    if (px + r > x1) x1 = px + r;
    if (py - r < y0) y0 = py - r;
    if (py + r > y1) y1 = py + r;
  };
  let i = 0;
  let cmd = 'M';
  const n = () => parseFloat(tok[i++]);
  const isCmd = (t: string) => /^[a-z]$/i.test(t);
  while (i < tok.length) {
    if (isCmd(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') {
      x = sx;
      y = sy;
      continue;
    }
    if (i >= tok.length || isCmd(tok[i])) continue;
    const bx = rel ? x : 0, by = rel ? y : 0;
    switch (C) {
      case 'M':
      case 'L':
      case 'T': {
        x = bx + n();
        y = by + n();
        add(x, y);
        if (C === 'M') {
          sx = x;
          sy = y;
          cmd = rel ? 'l' : 'L';
        }
        break;
      }
      case 'H':
        x = bx + n();
        add(x, y);
        break;
      case 'V':
        y = by + n();
        add(x, y);
        break;
      case 'C': {
        add(bx + n(), by + n());
        add(bx + n(), by + n());
        x = bx + n();
        y = by + n();
        add(x, y);
        break;
      }
      case 'S':
      case 'Q': {
        add(bx + n(), by + n());
        x = bx + n();
        y = by + n();
        add(x, y);
        break;
      }
      case 'A': {
        const rx = Math.abs(n()), ry = Math.abs(n());
        n();
        n();
        n();
        add(x, y, Math.max(rx, ry));
        x = bx + n();
        y = by + n();
        add(x, y, Math.max(rx, ry));
        break;
      }
      default:
        i++;
    }
  }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}

function shapeOf(el: Element): { path: Path2D; box: [number, number, number, number] | null; bb?: Box | null } | null {
  const p = new Path2D();
  switch (el.tagName) {
    case 'rect': {
      const x = a(el, 'x'), y = a(el, 'y'), w = a(el, 'width'), h = a(el, 'height');
      if (w <= 0 || h <= 0) return null;
      const rx = el.hasAttribute('rx') ? a(el, 'rx') : el.hasAttribute('ry') ? a(el, 'ry') : 0;
      if (rx > 0) p.roundRect(x, y, w, h, Math.min(rx, w / 2, h / 2));
      else p.rect(x, y, w, h);
      return { path: p, box: [x, y, w, h] };
    }
    case 'circle': {
      const cx = a(el, 'cx'), cy = a(el, 'cy'), r = a(el, 'r');
      if (r <= 0) return null;
      p.arc(cx, cy, r, 0, Math.PI * 2);
      return { path: p, box: [cx - r, cy - r, 2 * r, 2 * r] };
    }
    case 'ellipse': {
      const cx = a(el, 'cx'), cy = a(el, 'cy'), rx = a(el, 'rx'), ry = a(el, 'ry');
      if (rx <= 0 || ry <= 0) return null;
      p.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      return { path: p, box: [cx - rx, cy - ry, 2 * rx, 2 * ry] };
    }
    case 'polygon':
    case 'polyline': {
      const n = nums(el.getAttribute('points'));
      if (n.length < 4) return null;
      p.moveTo(n[0], n[1]);
      for (let i = 2; i + 1 < n.length; i += 2) p.lineTo(n[i], n[i + 1]);
      if (el.tagName === 'polygon') p.closePath();
      return { path: p, box: null };
    }
    case 'path': {
      const d = el.getAttribute('d');
      if (!d) return null;
      return { path: new Path2D(d), box: null, bb: pathBounds(d) };
    }
    case 'line': {
      const x1 = a(el, 'x1'), y1 = a(el, 'y1'), x2 = a(el, 'x2'), y2 = a(el, 'y2');
      p.moveTo(x1, y1);
      p.lineTo(x2, y2);
      return { path: p, box: null, bb: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)] };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ drawing */

const gradCache = new WeakMap<Element, Map<string, CanvasGradient | CanvasPattern | null>>();

function stopsOf(el: Element, g: CanvasGradient) {
  for (const s of Array.from(el.querySelectorAll('stop'))) {
    const css = inlineStyle(s);
    const off = parseFloat(s.getAttribute('offset') ?? '0');
    const color = css['stop-color'] ?? s.getAttribute('stop-color') ?? '#000';
    const op = parseFloat(css['stop-opacity'] ?? s.getAttribute('stop-opacity') ?? '1');
    g.addColorStop(Math.max(0, Math.min(1, off > 1 ? off / 100 : off)), withAlpha(color, op));
  }
}

function withAlpha(c: string, a: number) {
  if (a >= 1) return c;
  const h = c.replace('#', '');
  if (/^[0-9a-f]{6}$/i.test(h)) {
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  if (/^[0-9a-f]{3}$/i.test(h)) {
    const [r, g, b] = h.split('').map((x) => parseInt(x + x, 16));
    return `rgba(${r},${g},${b},${a})`;
  }
  return c;
}

function resolvePaint(ctx: CanvasRenderingContext2D, pic: Picture, p: Paint): string | CanvasGradient | CanvasPattern | null {
  if (p.k === 'color') return p.v;
  const el = pic.defs.get(p.id);
  if (!el) return null;
  const key = p.k === 'grad' && p.box ? p.box.join(',') : '_';
  let cache = gradCache.get(el);
  if (!cache) gradCache.set(el, (cache = new Map()));
  if (cache.has(key)) return cache.get(key)!;
  let out: CanvasGradient | CanvasPattern | null = null;
  const bbox = el.getAttribute('gradientUnits') !== 'userSpaceOnUse' && el.tagName !== 'pattern';
  const box = p.k === 'grad' ? p.box : null;
  if (el.tagName === 'linearGradient') {
    let x1 = a(el, 'x1', 0), y1 = a(el, 'y1', 0), x2 = a(el, 'x2', bbox ? 1 : 0), y2 = a(el, 'y2', 0);
    if (bbox && box) [x1, y1, x2, y2] = [box[0] + x1 * box[2], box[1] + y1 * box[3], box[0] + x2 * box[2], box[1] + y2 * box[3]];
    out = ctx.createLinearGradient(x1, y1, x2, y2);
    stopsOf(el, out);
  } else if (el.tagName === 'radialGradient') {
    let cx = a(el, 'cx', 0.5), cy = a(el, 'cy', 0.5), r = a(el, 'r', 0.5);
    if (bbox && box) [cx, cy, r] = [box[0] + cx * box[2], box[1] + cy * box[3], r * Math.max(box[2], box[3])];
    out = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    stopsOf(el, out);
  } else if (el.tagName === 'pattern') {
    out = patternOf(ctx, el, pic);
  }
  cache.set(key, out);
  return out;
}

/** Rasterise a pattern tile once (userSpaceOnUse), scaled back to art units. */
function patternOf(ctx: CanvasRenderingContext2D, el: Element, pic: Picture): CanvasPattern | null {
  const w = a(el, 'width'), h = a(el, 'height');
  if (w <= 0 || h <= 0) return null;
  const S = Math.max(1, Math.min(8, 256 / Math.max(w, h)));
  const cw = Math.max(1, Math.round(w * S)), ch = Math.max(1, Math.round(h * S));
  const tile = document.createElement('canvas');
  tile.width = cw;
  tile.height = ch;
  const tctx = tile.getContext('2d')!;
  const inner = compile(el.innerHTML, pic.defs);
  drawPicture(tctx, inner, [cw / w, 0, 0, ch / h, 0, 0], 1);
  const pat = ctx.createPattern(tile, 'repeat');
  if (!pat) return null;
  const x = a(el, 'x'), y = a(el, 'y');
  pat.setTransform(new DOMMatrix([w / cw, 0, 0, h / ch, x, y]).multiply(parseTransform(el.getAttribute('patternTransform')) as unknown as DOMMatrix));
  return pat;
}

function setM(ctx: CanvasRenderingContext2D, M: Mat, m: Mat) {
  ctx.setTransform(
    M[0] * m[0] + M[2] * m[1],
    M[1] * m[0] + M[3] * m[1],
    M[0] * m[2] + M[2] * m[3],
    M[1] * m[2] + M[3] * m[3],
    M[0] * m[4] + M[2] * m[5] + M[4],
    M[1] * m[4] + M[3] * m[5] + M[5],
  );
}

/** Draw a compiled picture under screen matrix M with extra alpha. */
export function drawPicture(ctx: CanvasRenderingContext2D, pic: Picture, M: Mat, alpha: number) {
  let curClips: Clip[] | null = null;
  let saved = false;
  for (const op of pic.ops) {
    if (op.clips !== curClips) {
      if (saved) {
        ctx.restore();
        saved = false;
      }
      curClips = op.clips;
      if (op.clips.length) {
        ctx.save();
        saved = true;
        for (const c of op.clips) {
          setM(ctx, M, c.m);
          ctx.clip(c.path);
        }
      }
    }
    setM(ctx, M, op.m);
    if (op.t === 'p') {
      if (op.fill && op.fa > 0) {
        const f = resolvePaint(ctx, pic, op.fill);
        if (f) {
          ctx.globalAlpha = alpha * op.fa;
          ctx.fillStyle = f;
          ctx.fill(op.path);
        }
      }
      if (op.stroke && op.sa > 0 && op.lw > 0) {
        const s = resolvePaint(ctx, pic, op.stroke);
        if (s) {
          ctx.globalAlpha = alpha * op.sa;
          ctx.strokeStyle = s;
          ctx.lineWidth = op.lw;
          ctx.lineCap = op.cap;
          ctx.lineJoin = op.join;
          if (op.dash) {
            ctx.setLineDash(op.dash);
            ctx.lineDashOffset = op.dashOff;
          }
          ctx.stroke(op.path);
          if (op.dash) ctx.setLineDash([]);
        }
      }
    } else {
      const f = op.fill ? resolvePaint(ctx, pic, op.fill) : null;
      if (f && op.fa > 0) {
        ctx.globalAlpha = alpha * op.fa;
        ctx.fillStyle = f;
        ctx.font = op.font;
        ctx.textAlign = op.align;
        ctx.textBaseline = 'alphabetic';
        ctx.letterSpacing = `${op.ls}px`;
        ctx.fontStretch = op.stretch as CanvasFontStretch;
        ctx.fillText(op.text, op.x, op.y);
      }
    }
  }
  if (saved) ctx.restore();
  ctx.globalAlpha = 1;
}
