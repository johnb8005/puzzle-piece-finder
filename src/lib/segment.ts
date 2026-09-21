/**
 * Piece segmentation: cut the photographed piece away from a plain background.
 *
 * Pipeline: shrink the photo, estimate the background colour from the outer
 * frame, threshold by colour distance (Otsu), keep the largest blob, fill its
 * holes, shave the bevelled rim, optionally straighten, then crop tight.
 */
import { ctx2d, makeCanvas, resizeCanvas } from "./canvas";
import { median, otsu } from "./stats";

export interface Segmentation {
  /** The piece with a transparent background, or null if nothing usable was found. */
  canvas: HTMLCanvasElement | null;
  /** Fraction of the photo covered by the piece; used to warn about bad cut-outs. */
  areaFrac: number;
}

const WORK_SIZE = 360;

/** Median colour of the photo's outer frame, taken as the background. */
function backgroundColour(d: Uint8ClampedArray, W: number, H: number): [number, number, number] {
  const m = Math.max(2, Math.round(Math.min(W, H) * 0.04));
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (x < m || y < m || x >= W - m || y >= H - m) {
        const i = (y * W + x) * 4;
        r.push(d[i]);
        g.push(d[i + 1]);
        b.push(d[i + 2]);
      }
  return [median(r), median(g), median(b)];
}

/** Label 4-connected blobs above `thr`; return the label of the largest (0 if none). */
function largestBlob(dist: Float32Array, W: number, H: number, thr: number): { label: Int32Array; best: number } {
  const N = W * H;
  const label = new Int32Array(N);
  const stack = new Int32Array(N);
  let bestLabel = 0;
  let bestSize = 0;
  let next = 0;
  for (let i0 = 0; i0 < N; i0++) {
    if (label[i0] || dist[i0] <= thr) continue;
    next++;
    let sp = 0;
    let size = 0;
    stack[sp++] = i0;
    label[i0] = next;
    while (sp) {
      const i = stack[--sp];
      size++;
      const x = i % W;
      if (x > 0 && !label[i - 1] && dist[i - 1] > thr) { label[i - 1] = next; stack[sp++] = i - 1; }
      if (x < W - 1 && !label[i + 1] && dist[i + 1] > thr) { label[i + 1] = next; stack[sp++] = i + 1; }
      if (i >= W && !label[i - W] && dist[i - W] > thr) { label[i - W] = next; stack[sp++] = i - W; }
      if (i < N - W && !label[i + W] && dist[i + W] > thr) { label[i + W] = next; stack[sp++] = i + W; }
    }
    if (size > bestSize) { bestSize = size; bestLabel = next; }
  }
  return { label, best: bestLabel };
}

interface Mask {
  mask: Uint8Array;
  count: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Everything the outside cannot reach without crossing the blob belongs to the piece. */
function fillHoles(label: Int32Array, blob: number, W: number, H: number): Mask {
  const N = W * H;
  const outside = new Uint8Array(N);
  const stack = new Int32Array(N);
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
  const mask = new Uint8Array(N);
  let x0 = W, y0 = H, x1 = 0, y1 = 0, count = 0;
  for (let i = 0; i < N; i++)
    if (!outside[i]) {
      mask[i] = 1;
      count++;
      const x = i % W;
      const y = (i / W) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  return { mask, count, x0, y0, x1, y1 };
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

/**
 * @param src        Photo of a single piece on a plain background.
 * @param cutoff     Multiplier on the Otsu threshold; >1 cuts more away.
 * @param straighten Rotate the cut-out so its straight sides sit square.
 */
export function segmentPiece(src: HTMLCanvasElement, cutoff: number, straighten: boolean): Segmentation {
  const s = Math.min(1, WORK_SIZE / Math.max(src.width, src.height));
  const small = resizeCanvas(src, src.width * s, src.height * s);
  const W = small.width;
  const H = small.height;
  const N = W * H;
  const ctx = ctx2d(small);
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;

  const [mr, mg, mb] = backgroundColour(d, W, H);
  const dist = new Float32Array(N);
  const hist = new Uint32Array(256);
  for (let i = 0; i < N; i++) {
    const dr = d[i * 4] - mr;
    const dg = d[i * 4 + 1] - mg;
    const db = d[i * 4 + 2] - mb;
    const v = Math.min(255, Math.sqrt(dr * dr + dg * dg + db * db));
    dist[i] = v;
    hist[v | 0]++;
  }
  const thr = Math.max(12, otsu(hist, N) * cutoff);

  const { label, best } = largestBlob(dist, W, H, thr);
  if (!best) return { canvas: null, areaFrac: 0 };

  const filled = fillHoles(label, best, W, H);
  const { x0, y0, x1, y1, count } = filled;
  const rounds = Math.max(1, Math.round(Math.max(x1 - x0, y1 - y0) * 0.025));
  const mask = erode(filled.mask, W, H, rounds);
  const theta = straighten ? estimateTilt(mask, W, H) : 0;

  // Cut-out with alpha, cropped, straightened, then trimmed tight.
  for (let i = 0; i < N; i++) d[i * 4 + 3] = mask[i] ? 255 : 0;
  ctx.putImageData(img, 0, 0);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const D = Math.ceil(Math.hypot(bw, bh)) + 2;
  const rot = makeCanvas(D, D);
  const rx = ctx2d(rot);
  rx.imageSmoothingQuality = "high";
  rx.translate(D / 2, D / 2);
  rx.rotate((-theta * Math.PI) / 180);
  rx.drawImage(small, x0, y0, bw, bh, -bw / 2, -bh / 2, bw, bh);
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
  if (tx1 <= tx0 || ty1 <= ty0) return { canvas: null, areaFrac: 0 };
  const out = makeCanvas(tx1 - tx0 + 1, ty1 - ty0 + 1);
  ctx2d(out).drawImage(rot, -tx0, -ty0);
  return { canvas: out, areaFrac: count / N };
}
