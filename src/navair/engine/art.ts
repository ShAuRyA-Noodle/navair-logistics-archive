/**
 * String builders for face art. All coordinates are art-space centimetres
 * (u right, v down). Keep drawings flat-filled: depth comes from the engine's
 * lambert overlay plus hand-placed light/dark overlay shapes.
 */

const n = (v: number) => Math.round(v * 100) / 100;

type Attrs = Record<string, string | number | undefined>;

function at(a?: Attrs) {
  if (!a) return '';
  let s = '';
  for (const k in a) {
    const v = a[k];
    if (v === undefined) continue;
    s += ` ${k}="${typeof v === 'number' ? n(v) : v}"`;
  }
  return s;
}

export const g = (children: string | string[], a?: Attrs) =>
  `<g${at(a)}>${Array.isArray(children) ? children.join('') : children}</g>`;

export const rect = (x: number, y: number, w: number, h: number, fill: string, a?: Attrs) =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}"${at(a)}/>`;

export const path = (d: string, fill: string, a?: Attrs) => `<path d="${d}" fill="${fill}"${at(a)}/>`;

export const stroke = (d: string, color: string, width: number, a?: Attrs) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${n(width)}"${at(a)}/>`;

export const circle = (cx: number, cy: number, r: number, fill: string, a?: Attrs) =>
  `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"${at(a)}/>`;

export const line = (x1: number, y1: number, x2: number, y2: number, color: string, w: number, a?: Attrs) =>
  `<path d="M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}" stroke="${color}" stroke-width="${n(w)}" fill="none"${at(a)}/>`;

export const text = (
  x: number,
  y: number,
  s: string,
  size: number,
  fill: string,
  a?: Attrs & { family?: 'mono' | 'display' },
) => {
  const fam = a?.family === 'mono' ? 'var(--font-mono), monospace' : 'var(--font-display), sans-serif';
  const rest = { ...a };
  delete rest.family;
  return `<text x="${n(x)}" y="${n(y)}" font-size="${n(size)}" fill="${fill}" font-family="${fam}"${at(rest)}>${s}</text>`;
};

/** Rounded rectangle path data. r may be a single radius or [tl, tr, br, bl]. */
export function rrD(x: number, y: number, w: number, h: number, r: number | [number, number, number, number] = 0) {
  const [tl, tr, br, bl] = typeof r === 'number' ? [r, r, r, r] : r;
  const c = (v: number) => Math.max(0, Math.min(v, w / 2, h / 2));
  const a = c(tl), b = c(tr), cc = c(br), d = c(bl);
  return (
    `M${n(x + a)} ${n(y)}H${n(x + w - b)}` +
    (b ? `Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + b)}` : '') +
    `V${n(y + h - cc)}` +
    (cc ? `Q${n(x + w)} ${n(y + h)} ${n(x + w - cc)} ${n(y + h)}` : '') +
    `H${n(x + d)}` +
    (d ? `Q${n(x)} ${n(y + h)} ${n(x)} ${n(y + h - d)}` : '') +
    `V${n(y + a)}` +
    (a ? `Q${n(x)} ${n(y)} ${n(x + a)} ${n(y)}` : '') +
    'Z'
  );
}

export const rr = (x: number, y: number, w: number, h: number, r: number | [number, number, number, number], fill: string, a?: Attrs) =>
  path(rrD(x, y, w, h, r), fill, a);

export function polyD(pts: [number, number][], close = true) {
  return 'M' + pts.map((p) => `${n(p[0])} ${n(p[1])}`).join('L') + (close ? 'Z' : '');
}

export const poly = (pts: [number, number][], fill: string, a?: Attrs) => path(polyD(pts), fill, a);

/** A row of bolts. */
export function bolts(x0: number, x1: number, y: number, count: number, r: number, fill: string) {
  if (count < 2) return circle((x0 + x1) / 2, y, r, fill);
  let s = '';
  for (let i = 0; i < count; i++) s += `M${n(x0 + ((x1 - x0) * i) / (count - 1) + r)} ${n(y)}a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0`;
  return path(s, fill);
}

/**
 * Container-style corrugation: repeated trapezoid flutes rendered as
 * alternating light/dark bands. Vertical flutes (for side walls) by default.
 */
export function flutes(
  x: number,
  y: number,
  w: number,
  h: number,
  pitch: number,
  light: string,
  dark: string,
  opts: { horizontal?: boolean; lightW?: number; darkW?: number } = {},
) {
  const lw = opts.lightW ?? pitch * 0.34;
  const dw = opts.darkW ?? pitch * 0.18;
  let L = '', D = '';
  if (!opts.horizontal) {
    for (let u = x + pitch * 0.2; u < x + w - pitch * 0.2; u += pitch) {
      L += `M${n(u)} ${n(y)}h${n(lw)}v${n(h)}h${n(-lw)}Z`;
      D += `M${n(u + lw + pitch * 0.12)} ${n(y)}h${n(dw)}v${n(h)}h${n(-dw)}Z`;
    }
  } else {
    for (let v = y + pitch * 0.2; v < y + h - pitch * 0.2; v += pitch) {
      L += `M${n(x)} ${n(v)}h${n(w)}v${n(lw)}h${n(-w)}Z`;
      D += `M${n(x)} ${n(v + lw + pitch * 0.12)}h${n(w)}v${n(dw)}h${n(-w)}Z`;
    }
  }
  return path(L, light) + path(D, dark);
}

/** Diagonal hazard stripes clipped to a rect. */
export function hazard(x: number, y: number, w: number, h: number, a: string, b: string, pitch = 24, id?: string) {
  const cid = id ?? `hz${Math.round(x)}_${Math.round(y)}_${Math.round(w)}_${Math.round(h)}_${Math.round(Math.random() * 1e6)}`;
  let d = '';
  for (let u = x - h; u < x + w + h; u += pitch) d += `M${n(u)} ${n(y + h)}L${n(u + h)} ${n(y)}h${n(pitch / 2)}L${n(u + pitch / 2)} ${n(y + h)}Z`;
  return (
    `<clipPath id="${cid}"><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/></clipPath>` +
    rect(x, y, w, h, a) +
    `<path d="${d}" fill="${b}" clip-path="url(#${cid})"/>`
  );
}

/** ISO corner casting (side view): dark block with an oval aperture. */
export function casting(x: number, y: number, s = 17.8, fill = '#2A2C30', hole = '#0B0C0E') {
  return rect(x, y, s, s * 0.66, fill) + rr(x + s * 0.25, y + s * 0.2, s * 0.5, s * 0.26, s * 0.12, hole);
}

/** Stroke-only helper for panel seams. */
export const seam = (d: string, color = 'rgba(0,0,0,.22)', w = 1.4) => stroke(d, color, w, { 'stroke-linecap': 'round' });

/** Soft light / shadow overlays for hand shading. */
export const hi = (d: string, o = 0.12) => path(d, `rgba(255,255,255,${o})`);
export const lo = (d: string, o = 0.18) => path(d, `rgba(0,0,0,${o})`);
