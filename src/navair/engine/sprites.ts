/**
 * Face sprite cache for the Canvas2D backend.
 *
 * A face's art is fixed in its own (u, v) space; only its screen affine changes
 * as the camera moves. Painting thousands of small vector ops every frame is
 * bound by per-draw GPU work (measured: cost barely changes with resolution), so
 * each face picture is rasterised ONCE into an ImageBitmap at a resolution
 * matched to its on-screen scale (quantised in √2 steps, never magnified by
 * more than that), then drawn with a single textured quad under the face's
 * affine. Identical art shares sprites (container stacks reuse a handful).
 *
 * The picture is still drawn as vectors while its sprite is being created, when
 * it would be too large, or when the caller needs exact group-alpha semantics.
 * Memory is bounded by an LRU byte budget.
 */

import { drawPicture, pictureBounds, type Mat, type Picture } from './picture';

interface Sprite {
  bmp: ImageBitmap | null;
  /** Cannot be sprited at this level (too large / unknown bounds). */
  skip: boolean;
  qx: number;
  qy: number;
  x0: number;
  y0: number;
  bytes: number;
  used: number;
}

const PAD = 2; // device px of transparent border for clean bilinear edges
const MAX_SIDE = 2048;
const MAX_AREA = 2048 * 1024;

export class SpriteCache {
  /**
   * Upper bound on bitmap memory (bytes, RGBA). A full traverse of the sequence
   * touches ~140 MB of distinct sprites; only the current view's set is hot, so
   * least-recently-drawn ones are evicted. Phones get a tighter budget.
   */
  budget = (typeof matchMedia === 'function' && matchMedia('(max-width: 860px)').matches ? 48 : 96) * 1024 * 1024;
  /** New rasterisations allowed per paint (spreads level changes over frames). */
  perPaint = 32;
  private bytes = 0;
  private frame = 0;
  private made = 0;
  private sprites = new Map<string, Sprite>();
  private ids = new Map<string, number>();
  private scratch: HTMLCanvasElement | null = null;
  private sctx: CanvasRenderingContext2D | null = null;
  private disposed = false;

  constructor(private onReady: () => void) {}

  /** Stable small id for an art string (identical art shares sprites). */
  idFor(art: string) {
    let id = this.ids.get(art);
    if (id === undefined) this.ids.set(art, (id = this.ids.size + 1));
    return id;
  }

  begin() {
    this.frame++;
    this.made = 0;
  }

  /**
   * Draw `pic` (sprite id `id`) under device matrix M with alpha. Returns false
   * when the caller must draw vectors instead.
   */
  draw(ctx: CanvasRenderingContext2D, pic: Picture, id: number, M: Mat, alpha: number): boolean {
    const sx = Math.hypot(M[0], M[1]), sy = Math.hypot(M[2], M[3]);
    if (!(sx > 0 && sy > 0)) return false;
    const lx = Math.max(-16, Math.ceil(Math.log2(sx) * 2)), ly = Math.max(-16, Math.ceil(Math.log2(sy) * 2));
    const key = `${id}|${lx}|${ly}`;
    let sp = this.sprites.get(key);
    if (!sp) {
      if (this.made >= this.perPaint) return false;
      sp = this.create(pic, 2 ** (lx / 2), 2 ** (ly / 2));
      this.sprites.set(key, sp);
    }
    sp.used = this.frame;
    if (!sp.bmp) return false;
    const ix = 1 / sp.qx, iy = 1 / sp.qy;
    ctx.setTransform(M[0] * ix, M[1] * ix, M[2] * iy, M[3] * iy, M[0] * sp.x0 + M[2] * sp.y0 + M[4], M[1] * sp.x0 + M[3] * sp.y0 + M[5]);
    ctx.globalAlpha = alpha;
    ctx.drawImage(sp.bmp, 0, 0);
    return true;
  }

  private create(pic: Picture, qx: number, qy: number): Sprite {
    const sp: Sprite = { bmp: null, skip: true, qx, qy, x0: 0, y0: 0, bytes: 0, used: this.frame };
    const bb = pictureBounds(pic);
    if (!bb) return sp;
    const w = Math.ceil((bb[2] - bb[0]) * qx) + PAD * 2, h = Math.ceil((bb[3] - bb[1]) * qy) + PAD * 2;
    if (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_AREA || w < 1 || h < 1) return sp;
    sp.skip = false;
    sp.x0 = bb[0] - PAD / qx;
    sp.y0 = bb[1] - PAD / qy;
    sp.bytes = w * h * 4;
    this.made++;
    // Preferred: rasterise into a fresh OffscreenCanvas and transfer its backing
    // store (zero-copy, synchronous, so the sprite is usable this very frame).
    if (typeof OffscreenCanvas === 'function') {
      const oc = new OffscreenCanvas(w, h);
      const g = oc.getContext('2d');
      if (g) {
        drawPicture(g as unknown as CanvasRenderingContext2D, pic, [qx, 0, 0, qy, -sp.x0 * qx, -sp.y0 * qy], 1);
        sp.bmp = oc.transferToImageBitmap();
        this.bytes += sp.bytes;
        return sp;
      }
    }
    if (typeof createImageBitmap !== 'function') {
      sp.skip = true;
      return sp;
    }
    if (!this.scratch) {
      this.scratch = document.createElement('canvas');
      this.sctx = this.scratch.getContext('2d', { alpha: true });
    }
    const c = this.scratch, g = this.sctx;
    if (!g) {
      sp.skip = true;
      return sp;
    }
    if (c.width < w || c.height < h) {
      c.width = Math.max(c.width, w);
      c.height = Math.max(c.height, h);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    drawPicture(g, pic, [qx, 0, 0, qy, -sp.x0 * qx, -sp.y0 * qy], 1);
    this.bytes += sp.bytes;
    // The canvas content is snapshotted synchronously; the scratch is reusable at once.
    createImageBitmap(c, 0, 0, w, h).then(
      (bmp) => {
        if (this.disposed || sp.skip) {
          bmp.close();
          return;
        }
        sp.bmp = bmp;
        this.onReady();
      },
      () => {
        sp.skip = true;
      },
    );
    return sp;
  }

  /** Evict least-recently-drawn sprites once over budget (call after a paint). */
  trim() {
    if (this.bytes <= this.budget) return;
    const list = [...this.sprites.entries()].filter(([, s]) => s.used < this.frame).sort((a, b) => a[1].used - b[1].used);
    for (const [key, s] of list) {
      if (this.bytes <= this.budget * 0.8) break;
      this.drop(key, s);
    }
  }

  private drop(key: string, s: Sprite) {
    this.sprites.delete(key);
    this.bytes -= s.bytes;
    s.skip = true;
    s.bmp?.close();
    s.bmp = null;
  }

  dispose() {
    this.disposed = true;
    for (const [key, s] of this.sprites) this.drop(key, s);
    if (this.scratch) this.scratch.width = this.scratch.height = 0;
    this.scratch = null;
    this.sctx = null;
  }
}
