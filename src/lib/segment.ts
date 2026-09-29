/**
 * Piece segmentation: cut photographed pieces away from a plain background.
 *
 * Pipeline: shrink the photo, estimate the background colour from the outer
 * frame, threshold by colour distance (Otsu), label the blobs, and for each
 * blob worth keeping: fill its holes, shave the bevelled rim, optionally
 * straighten, then crop tight.
 */
import { ctx2d, makeCanvas, resizeCanvas } from "./canvas";
import { median, otsu } from "./stats";

export interface Segmentation {
  /** The piece with a transparent background, or null if nothing usable was found. */
  canvas: HTMLCanvasElement | null;
  /** Fraction of the photo covered by the piece; used to warn about bad cut-outs. */
  areaFrac: number;
}

/** Normalised rectangle (0..1 of the photo) around a piece, for overlays. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PieceCut {
  canvas: HTMLCanvasElement;
  areaFrac: number;
  box: Box;
}

export interface SegmentOptions {
  /** Long side of the working copy. Larger keeps more detail per piece when many share a photo. */
  workSize?: number;
  /** Most pieces to return, largest first. */
  maxPieces?: number;
  /** Blobs smaller than this fraction of the largest blob are ignored as dust or shadow. */
  minRelSize?: number;
}

const SINGLE_WORK_SIZE = 360;
const MULTI_WORK_SIZE = 900;

/** Indices of the pixels in the photo's outer frame, assumed to be background. */
function frameIndices(W: number, H: number): number[] {
  const m = Math.max(2, Math.round(Math.min(W, H) * 0.04));
  const out: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (x < m || y < m || x >= W - m || y >= H - m) out.push(y * W + x);
  return out;
}

/** Median colour of the photo's outer frame, taken as the background. */
function backgroundColour(d: Uint8ClampedArray, frame: number[]): [number, number, number] {
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  for (const i of frame) {
    r.push(d[i * 4]);
    g.push(d[i * 4 + 1]);
    b.push(d[i * 4 + 2]);
  }
  return [median(r), median(g), median(b)];
}

/**
 * A shadow on the paper is the paper colour dimmed by the same factor in every
 * channel. Such pixels count as background so the cut-out hugs the piece, not
 * its shadow. Anything tinted, or much darker than a shadow would be, is kept.
 */
function isShadow(r: number, g: number, b: number, mr: number, mg: number, mb: number): boolean {
  const kr = r / Math.max(1, mr);
  const kg = g / Math.max(1, mg);
  const kb = b / Math.max(1, mb);
  const lo = Math.min(kr, kg, kb);
  const hi = Math.max(kr, kg, kb);
  return hi - lo < 0.05 && lo > 0.5 && hi < 1;
}

/**
 * Colour-distance threshold separating pieces from background. Otsu's cut can
 * land far too high when a piece has saturated colours next to pale paper,
 * chopping off its pale parts, so it is capped by how much the background
 * itself varies: anything well outside the frame's own spread is not paper.
 */
function pieceThreshold(hist: Uint32Array, N: number, frameDist: Float32Array, cutoff: number): number {
  const sorted = Float32Array.from(frameDist).sort();
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const fromBackground = p95 * 1.6 + 10;
  return Math.max(12, Math.min(otsu(hist, N), fromBackground) * cutoff);
}

/** Label 4-connected blobs above `thr`. Returns the label map and each label's pixel count (index 0 unused). */
function labelBlobs(dist: Float32Array, W: number, H: number, thr: number): { label: Int32Array; sizes: number[] } {
  const N = W * H;
  const label = new Int32Array(N);
  const stack = new Int32Array(N);
  const sizes: number[] = [0];
  for (let i0 = 0; i0 < N; i0++) {
    if (label[i0] || dist[i0] <= thr) continue;
    const id = sizes.length;
    let sp = 0;
    let size = 0;
    stack[sp++] = i0;
    label[i0] = id;
    while (sp) {
      const i = stack[--sp];
      size++;
      const x = i % W;
      if (x > 0 && !label[i - 1] && dist[i - 1] > thr) { label[i - 1] = id; stack[sp++] = i - 1; }
      if (x < W - 1 && !label[i + 1] && dist[i + 1] > thr) { label[i + 1] = id; stack[sp++] = i + 1; }
      if (i >= W && !label[i - W] && dist[i - W] > thr) { label[i - W] = id; stack[sp++] = i - W; }
      if (i < N - W && !label[i + W] && dist[i + W] > thr) { label[i + W] = id; stack[sp++] = i + W; }
    }
    sizes.push(size);
  }
  return { label, sizes };
}

interface Mask {
  /** Sub-window mask with a 1px empty margin: (bw + 2) x (bh + 2). */
  mask: Uint8Array;
  mw: number;
  mh: number;
  count: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Everything the outside cannot reach without crossing the blob belongs to
 * the piece. Other blobs count as outside, so pieces do not swallow each other.
 */
function fillHoles(label: Int32Array, blob: number, W: number, H: number, scratch: { outside: Uint8Array; stack: Int32Array }): Mask | null {
  const N = W * H;
  const { outside, stack } = scratch;
  outside.fill(0);
  let sp = 0;
  const pushOut = (i: number) => {
    if (!outside[i] && label[i] !== blob) { outside[i] = 1; stack[sp++] = i; }
  };
  for (let x = 0; x < W; x++) { pushOut(x); pushOut(N - W + x); }
  for (let y = 0; y < H; y++) { pushOut(y * W); pushOut(y * W + W - 1); }
  while (sp) {
    const i = stack[--sp];
    const x = i % W;
    if (x > 0) pushOut(i - 1);
    if (x < W - 1) pushOut(i + 1);
    if (i >= W) pushOut(i - W);
    if (i < N - W) pushOut(i + W);
  }
  let x0 = W, y0 = H, x1 = -1, y1 = -1, count = 0;
  for (let i = 0; i < N; i++)
    if (!outside[i]) {
      count++;
      const x = i % W;
      const y = (i / W) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  if (x1 < 0) return null;
  const mw = x1 - x0 + 3;
  const mh = y1 - y0 + 3;
  const mask = new Uint8Array(mw * mh);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (!outside[y * W + x]) mask[(y - y0 + 1) * mw + (x - x0 + 1)] = 1;
  return { mask, mw, mh, count, x0, y0, x1, y1 };
}

/** Shave the rim: bevels and shadows there never match the box art. */
function erode(mask: Uint8Array, W: number, H: number, rounds: number): Uint8Array {
  const N = W * H;
  let cur = mask;
  for (let r = 0; r < rounds; r++) {
    const nm = new Uint8Array(N);
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        nm[i] = cur[i] & cur[i - 1] & cur[i + 1] & cur[i - W] & cur[i + W];
      }
    cur = nm;
  }
  return cur;
}

/**
 * Estimate the piece's tilt in degrees (-45, 45]. The straight sides dominate
 * the outline's edge directions while round tabs spread evenly, so the peak
 * of the gradient-direction histogram (mod 90°) is the tilt.
 */
function estimateTilt(mask: Uint8Array, W: number, H: number): number {
  const N = W * H;
  let soft = Float32Array.from(mask);
  for (let pass = 0; pass < 2; pass++) {
    const nb = new Float32Array(N);
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        nb[i] =
          (soft[i - W - 1] + soft[i - W] + soft[i - W + 1] +
            soft[i - 1] + soft[i] + soft[i + 1] +
            soft[i + W - 1] + soft[i + W] + soft[i + W + 1]) / 9;
      }
    soft = nb;
  }
  const bins = new Float32Array(90);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = soft[i - W + 1] + 2 * soft[i + 1] + soft[i + W + 1] - soft[i - W - 1] - 2 * soft[i - 1] - soft[i + W - 1];
      const gy = soft[i + W - 1] + 2 * soft[i + W] + soft[i + W + 1] - soft[i - W - 1] - 2 * soft[i - W] - soft[i - W + 1];
      const mag = Math.hypot(gx, gy);
      if (mag < 0.5) continue;
      let a = (Math.atan2(gy, gx) * 180) / Math.PI;
      a = ((a % 90) + 90) % 90;
      const lo = Math.floor(a);
      const fr = a - lo;
      bins[lo % 90] += mag * (1 - fr);
      bins[(lo + 1) % 90] += mag * fr;
    }
  let bestBin = 0;
  let bestVal = -1;
  for (let k = 0; k < 90; k++) {
    let v = 0;
    for (let j = -3; j <= 3; j++) v += bins[(k + j + 90) % 90] * (4 - Math.abs(j));
    if (v > bestVal) { bestVal = v; bestBin = k; }
  }
  let num = 0;
  let den = 0;
  for (let j = -4; j <= 4; j++) {
    const w = bins[(bestBin + j + 90) % 90];
    num += w * j;
    den += w;
  }
  let theta = bestBin + (den ? num / den : 0);
  if (theta > 45) theta -= 90;
  return theta;
}

/** Cut-out with alpha from the mask, straightened by `theta`, then trimmed tight. */
function cutOut(d: Uint8ClampedArray, W: number, m: Mask, theta: number): HTMLCanvasElement | null {
  const bw = m.x1 - m.x0 + 1;
  const bh = m.y1 - m.y0 + 1;
  const crop = makeCanvas(bw, bh);
  const cx = ctx2d(crop);
  const img = cx.createImageData(bw, bh);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const src = ((y + m.y0) * W + (x + m.x0)) * 4;
      const dst = (y * bw + x) * 4;
      img.data[dst] = d[src];
      img.data[dst + 1] = d[src + 1];
      img.data[dst + 2] = d[src + 2];
      img.data[dst + 3] = m.mask[(y + 1) * m.mw + (x + 1)] ? 255 : 0;
    }
  cx.putImageData(img, 0, 0);

  const D = Math.ceil(Math.hypot(bw, bh)) + 2;
  const rot = makeCanvas(D, D);
  const rx = ctx2d(rot);
  rx.imageSmoothingQuality = "high";
  rx.translate(D / 2, D / 2);
  rx.rotate((-theta * Math.PI) / 180);
  rx.drawImage(crop, -bw / 2, -bh / 2);
  const rd = rx.getImageData(0, 0, D, D).data;
  let tx0 = D, ty0 = D, tx1 = 0, ty1 = 0;
  for (let y = 0; y < D; y++)
    for (let x = 0; x < D; x++)
      if (rd[(y * D + x) * 4 + 3] > 128) {
        if (x < tx0) tx0 = x;
        if (x > tx1) tx1 = x;
        if (y < ty0) ty0 = y;
        if (y > ty1) ty1 = y;
      }
  if (tx1 <= tx0 || ty1 <= ty0) return null;
  const out = makeCanvas(tx1 - tx0 + 1, ty1 - ty0 + 1);
  ctx2d(out).drawImage(rot, -tx0, -ty0);
  return out;
}

/**
 * Cut every piece out of a photo of pieces on a plain background.
 *
 * @param src        Photo of one or more pieces, spread out so none touch.
 * @param cutoff     Multiplier on the Otsu threshold; >1 cuts more away.
 * @param straighten Rotate each cut-out so its straight sides sit square.
 */
export function segmentPieces(src: HTMLCanvasElement, cutoff: number, straighten: boolean, opts: SegmentOptions = {}): PieceCut[] {
  const workSize = opts.workSize ?? MULTI_WORK_SIZE;
  const maxPieces = opts.maxPieces ?? 40;
  const minRelSize = opts.minRelSize ?? 0.2;

  const s = Math.min(1, workSize / Math.max(src.width, src.height));
  const small = resizeCanvas(src, src.width * s, src.height * s);
  const W = small.width;
  const H = small.height;
  const N = W * H;
  const d = ctx2d(small).getImageData(0, 0, W, H).data;

  const frame = frameIndices(W, H);
  const [mr, mg, mb] = backgroundColour(d, frame);
  const dist = new Float32Array(N);
  const hist = new Uint32Array(256);
  for (let i = 0; i < N; i++) {
    const r = d[i * 4];
    const g = d[i * 4 + 1];
    const b = d[i * 4 + 2];
    const dr = r - mr;
    const dg = g - mg;
    const db = b - mb;
    const v = isShadow(r, g, b, mr, mg, mb) ? 0 : Math.min(255, Math.sqrt(dr * dr + dg * dg + db * db));
    dist[i] = v;
    hist[v | 0]++;
  }
  const thr = pieceThreshold(hist, N, Float32Array.from(frame, (i) => dist[i]), cutoff);

  const { label, sizes } = labelBlobs(dist, W, H, thr);
  const largest = Math.max(0, ...sizes);
  if (!largest) return [];
  const minSize = Math.max(largest * minRelSize, N * 0.0005);
  const ids = sizes
    .map((size, id) => ({ size, id }))
    .filter(({ size, id }) => id > 0 && size >= minSize)
    .sort((a, b) => b.size - a.size)
    .slice(0, maxPieces)
    .map(({ id }) => id);

  const scratch = { outside: new Uint8Array(N), stack: new Int32Array(N) };
  const pieces: PieceCut[] = [];
  for (const id of ids) {
    const filled = fillHoles(label, id, W, H, scratch);
    if (!filled) continue;
    const { x0, y0, x1, y1, mw, mh, count } = filled;
    const rounds = Math.max(1, Math.round(Math.max(x1 - x0, y1 - y0) * 0.025));
    const mask = erode(filled.mask, mw, mh, rounds);
    const theta = straighten ? estimateTilt(mask, mw, mh) : 0;
    const canvas = cutOut(d, W, { ...filled, mask }, theta);
    if (!canvas) continue;
    pieces.push({
      canvas,
      areaFrac: count / N,
      box: { x: x0 / W, y: y0 / H, w: (x1 - x0 + 1) / W, h: (y1 - y0 + 1) / H },
    });
  }
  return readingOrder(pieces);
}

/**
 * Number pieces the way a person would read them: group into rows of pieces
 * whose centres sit within about half a piece height of each other, then
 * left to right within each row.
 */
export function readingOrder<T extends { box: Box }>(pieces: T[]): T[] {
  if (pieces.length < 2) return pieces;
  const cy = (p: T) => p.box.y + p.box.h / 2;
  const byY = [...pieces].sort((a, b) => cy(a) - cy(b));
  const tol = median(byY.map((p) => p.box.h)) * 0.6;
  const rows: T[][] = [];
  let rowStart = -Infinity;
  for (const p of byY) {
    if (cy(p) - rowStart > tol) {
      rows.push([]);
      rowStart = cy(p);
    }
    rows[rows.length - 1].push(p);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.box.x - b.box.x));
}

/**
 * Cut the single largest piece out of a photo.
 *
 * @param src        Photo of a single piece on a plain background.
 * @param cutoff     Multiplier on the Otsu threshold; >1 cuts more away.
 * @param straighten Rotate the cut-out so its straight sides sit square.
 */
export function segmentPiece(src: HTMLCanvasElement, cutoff: number, straighten: boolean): Segmentation {
  const [piece] = segmentPieces(src, cutoff, straighten, { workSize: SINGLE_WORK_SIZE, maxPieces: 1 });
  return piece ? { canvas: piece.canvas, areaFrac: piece.areaFrac } : { canvas: null, areaFrac: 0 };
}
