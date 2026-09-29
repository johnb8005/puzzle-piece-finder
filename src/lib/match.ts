/**
 * Matching: masked, lighting-tolerant template search.
 *
 * Both the key and the piece are high-passed (each channel minus its local
 * mean over about half a cell), which removes vignetting, glossy highlights
 * and colour casts that differ between the two photos. Pass 1 slides the
 * piece over a small copy of the key at every position, in four turns and
 * three sizes, scoring zero-mean correlation of the high-passed channels
 * minus a penalty for a different overall hue. Pass 2 re-scores the strongest
 * peaks on a 3x finer copy, nudging position, size and tilt, and returns the
 * top distinct spots.
 */
import { clamp, ctx2d, makeCanvas, resizeCanvas, tick } from "./canvas";

export interface Match {
  /** Horizontal centre of the piece on the key, 0..1. */
  u: number;
  /** Vertical centre of the piece on the key, 0..1. */
  v: number;
  /** Quarter turns clockwise the piece must be rotated to sit like the key. */
  rot: number;
  /** Similarity score; roughly -1..1, higher is better. */
  score: number;
  /** How much detail the piece has to match on (RMS of its high-passed channels). Low means plain sky or water. */
  texture: number;
}

/** Below this texture a piece is too plain for its placement to be trusted. */
export const PLAIN_TEXTURE = 12;
export const isPlain = (m: Pick<Match, "texture">): boolean => m.texture < PLAIN_TEXTURE;

/** Per-channel float copies of the key at a given size: high-passed, plus local means for hue. */
interface KeyChannels {
  W: number;
  H: number;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  /** Chromaticity (r / sum, g / sum) of the local mean colour, for the hue penalty. */
  cr: Float32Array;
  cg: Float32Array;
}

/** Key channels are expensive to build, so callers keep them between runs. */
export interface KeyCache {
  cols?: number;
  coarsePx?: number;
  src?: HTMLCanvasElement;
  coarse?: KeyChannels;
  fine?: KeyChannels;
  /** Near the key photo's own resolution, for the last pass. */
  native?: KeyChannels;
  nativeFactor?: number;
}

interface Template {
  w: number;
  h: number;
  n: number;
  /** Offsets (relative to a top-left base index) of each opaque piece pixel. */
  off: Int32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  /** Chromaticity of the piece's mean colour. */
  cr: number;
  cg: number;
  /** Total sum of squares of the zero-mean template, for normalisation. */
  tss: number;
  rot: number;
  /** Centroid of the opaque pixels, relative to the template's top-left. A tab
   *  on one side pulls the bounding box but barely moves the centroid, so this
   *  is where the piece's body actually sits. */
  cx: number;
  cy: number;
}

export class MatchCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "MatchCancelled";
  }
}

/** Piece outline vs. one grid cell: no tabs … tabs on both sides. */
const SCALES = [1.0, 1.2, 1.4] as const;
/** How hard a different hue is punished (chromaticity distance is ~0.02 for a colour cast, ~0.15 for a different colour). */
const CHROMA_WEIGHT = 1.2;
/** Keeps flat, texture-free areas from scoring on noise. Per-pixel, per-channel variance units. */
const REG = 60;
/** Fine pass detail multiplier. */
const FINE = 3;
/** Most detail multiplier for the last pass; capped by the key photo's own size. */
const NATIVE_MAX = 8;
const RESULTS = 3;
/** Candidates carried from the fine pass into the last pass. */
const FINALISTS = 8;
/** Extra tilts tried in the fine pass, degrees. */
const TILTS = [-4, 0, 4] as const;
const FINE_SCALES = [-0.1, 0, 0.1] as const;
/** Nudges tried in the last pass. */
const LAST_TILTS = [-2, 0, 2] as const;
const LAST_SCALES = [-0.05, 0, 0.05] as const;

export interface SearchOptions {
  /** Coarse-pass pixels per grid cell. More finds textured pieces, at quadratic cost. */
  coarsePx?: number;
  /** Coarse-pass peaks carried into the fine pass. */
  peaks?: number;
  /** Cells the piece may land in (1-based). Others are skipped in the coarse pass. */
  allowedCell?: (col: number, row: number) => boolean;
  rows?: number;
  /** How far outside an allowed cell the piece's centre may still fall, in cells. */
  cellMargin?: number;
}

export const DEFAULT_SEARCH: Required<Pick<SearchOptions, "coarsePx" | "peaks">> = { coarsePx: 8, peaks: 24 };

/** Separable box blur of `src` weighted by `wgt` (alpha), radius r. Returns blurred value = sum(src*wgt)/sum(wgt). */
function boxMean(src: Float32Array, wgt: Float32Array | null, W: number, H: number, r: number): Float32Array {
  const n = W * H;
  const num = new Float32Array(n);
  const den = new Float32Array(n);
  const tmpN = new Float32Array(n);
  const tmpD = new Float32Array(n);
  // horizontal
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let sn = 0, sd = 0;
    for (let x = -r; x <= r; x++) {
      const xx = clamp(x, 0, W - 1);
      const w = wgt ? wgt[row + xx] : 1;
      sn += src[row + xx] * w;
      sd += w;
    }
    for (let x = 0; x < W; x++) {
      tmpN[row + x] = sn;
      tmpD[row + x] = sd;
      const xo = clamp(x - r, 0, W - 1);
      const xi = clamp(x + r + 1, 0, W - 1);
      const wo = wgt ? wgt[row + xo] : 1;
      const wi = wgt ? wgt[row + xi] : 1;
      sn += src[row + xi] * wi - src[row + xo] * wo;
      sd += wi - wo;
    }
  }
  // vertical
  for (let x = 0; x < W; x++) {
    let sn = 0, sd = 0;
    for (let y = -r; y <= r; y++) {
      const yy = clamp(y, 0, H - 1);
      sn += tmpN[yy * W + x];
      sd += tmpD[yy * W + x];
    }
    for (let y = 0; y < H; y++) {
      num[y * W + x] = sn;
      den[y * W + x] = sd;
      const yo = clamp(y - r, 0, H - 1);
      const yi = clamp(y + r + 1, 0, H - 1);
      sn += tmpN[yi * W + x] - tmpN[yo * W + x];
      sd += tmpD[yi * W + x] - tmpD[yo * W + x];
    }
  }
  for (let i = 0; i < n; i++) num[i] = den[i] > 0 ? num[i] / den[i] : 0;
  return num;
}

/** At high detail, a touch of blur before the high-pass drops JPEG block noise while keeping real structure. */
const smoothRadius = (cellPx: number): number => (cellPx >= 20 ? 1 : 0);

function keyChannels(canvas: HTMLCanvasElement, W: number, H: number, cellPx: number): KeyChannels {
  const c = resizeCanvas(canvas, W, H);
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
  const n = c.width * c.height;
  let r: Float32Array = new Float32Array(n);
  let g: Float32Array = new Float32Array(n);
  let b: Float32Array = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = d[i * 4];
    g[i] = d[i * 4 + 1];
    b[i] = d[i * 4 + 2];
  }
  const sm = smoothRadius(cellPx);
  if (sm) {
    r = boxMean(r, null, c.width, c.height, sm);
    g = boxMean(g, null, c.width, c.height, sm);
    b = boxMean(b, null, c.width, c.height, sm);
  }
  const rad = Math.max(1, Math.round(cellPx * 0.5));
  const mr = boxMean(r, null, c.width, c.height, rad);
  const mg = boxMean(g, null, c.width, c.height, rad);
  const mb = boxMean(b, null, c.width, c.height, rad);
  const cr = new Float32Array(n);
  const cg = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const sum = mr[i] + mg[i] + mb[i] + 1;
    cr[i] = mr[i] / sum;
    cg[i] = mg[i] / sum;
    r[i] -= mr[i];
    g[i] -= mg[i];
    b[i] -= mb[i];
  }
  return { W: c.width, H: c.height, r, g, b, cr, cg };
}

/**
 * Build a template of the piece at a given size and turn (plus a small extra
 * tilt), high-passed the same way as the key.
 */
function buildTemplate(piece: HTMLCanvasElement, rot: number, tiltDeg: number, longSide: number, cellPx: number, keyW: number): Template | null {
  const f = longSide / Math.max(piece.width, piece.height);
  const tw = Math.max(3, Math.round(piece.width * f));
  const th = Math.max(3, Math.round(piece.height * f));
  const scaled = resizeCanvas(piece, tw, th);
  const swap = rot % 2 === 1;
  const pad = tiltDeg ? Math.ceil(Math.max(tw, th) * 0.1) : 0;
  const cw = (swap ? th : tw) + 2 * pad;
  const ch = (swap ? tw : th) + 2 * pad;
  const c = makeCanvas(cw, ch);
  const cx = ctx2d(c);
  cx.imageSmoothingQuality = "high";
  cx.translate(cw / 2, ch / 2);
  cx.rotate((rot * Math.PI) / 2 + (tiltDeg * Math.PI) / 180);
  cx.drawImage(scaled, -tw / 2, -th / 2);
  const d = cx.getImageData(0, 0, cw, ch).data;
  const n0 = cw * ch;
  let R: Float32Array = new Float32Array(n0);
  let G: Float32Array = new Float32Array(n0);
  let B: Float32Array = new Float32Array(n0);
  const A = new Float32Array(n0);
  for (let i = 0; i < n0; i++) {
    R[i] = d[i * 4];
    G[i] = d[i * 4 + 1];
    B[i] = d[i * 4 + 2];
    A[i] = d[i * 4 + 3] > 200 ? 1 : 0;
  }
  const sm = smoothRadius(cellPx);
  if (sm) {
    R = boxMean(R, A, cw, ch, sm);
    G = boxMean(G, A, cw, ch, sm);
    B = boxMean(B, A, cw, ch, sm);
  }
  const rad = Math.max(1, Math.round(cellPx * 0.5));
  const mR = boxMean(R, A, cw, ch, rad);
  const mG = boxMean(G, A, cw, ch, rad);
  const mB = boxMean(B, A, cw, ch, rad);

  const off: number[] = [];
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  let sx = 0, sy = 0, sr = 0, sg = 0, sb = 0;
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const i = y * cw + x;
      if (!A[i]) continue;
      off.push(y * keyW + x);
      r.push(R[i] - mR[i]);
      g.push(G[i] - mG[i]);
      b.push(B[i] - mB[i]);
      sx += x + 0.5;
      sy += y + 0.5;
      sr += R[i];
      sg += G[i];
      sb += B[i];
    }
  const n = off.length;
  if (n < 6) return null;
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < n; i++) { mr += r[i]; mg += g[i]; mb += b[i]; }
  mr /= n; mg /= n; mb /= n;
  const tr = new Float32Array(n);
  const tg = new Float32Array(n);
  const tb = new Float32Array(n);
  let tss = 0;
  for (let i = 0; i < n; i++) {
    tr[i] = r[i] - mr;
    tg[i] = g[i] - mg;
    tb[i] = b[i] - mb;
    tss += tr[i] * tr[i] + tg[i] * tg[i] + tb[i] * tb[i];
  }
  const sum = sr + sg + sb + 1;
  return { w: cw, h: ch, n, off: Int32Array.from(off), r: tr, g: tg, b: tb, cr: sr / sum, cg: sg / sum, tss, rot, cx: sx / n, cy: sy / n };
}

/** Pattern agreement (zero-mean correlation of high-passed channels) minus a penalty for a different hue. */
function scoreAt(K: KeyChannels, t: Template, base: number): number {
  const { r: KR, g: KG, b: KB } = K;
  const { off, r: TR, g: TG, b: TB, n } = t;
  let sr = 0, sg = 0, sb = 0, qr = 0, qg = 0, qb = 0, c = 0;
  for (let i = 0; i < n; i++) {
    const idx = base + off[i];
    const R = KR[idx], G = KG[idx], B = KB[idx];
    sr += R; sg += G; sb += B;
    qr += R * R; qg += G * G; qb += B * B;
    c += TR[i] * R + TG[i] * G + TB[i] * B;
  }
  const wss = qr - (sr * sr) / n + (qg - (sg * sg) / n) + (qb - (sb * sb) / n);
  const reg = n * REG;
  const zncc = c / Math.sqrt((t.tss + reg) * (wss + reg));
  const centre = base + Math.round(t.cy) * K.W + Math.round(t.cx);
  const hue = Math.abs(K.cr[centre] - t.cr) + Math.abs(K.cg[centre] - t.cg);
  return zncc - CHROMA_WEIGHT * hue;
}

export interface FindPieceOptions {
  keyCanvas: HTMLCanvasElement;
  piece: HTMLCanvasElement;
  cols: number;
  cache: KeyCache;
  onProgress: (fraction: number) => void;
  isCancelled: () => boolean;
  search?: SearchOptions;
}

export async function findPiece({ keyCanvas, piece, cols, cache, onProgress, isCancelled, search = {} }: FindPieceOptions): Promise<Match[]> {
  const coarsePx = search.coarsePx ?? DEFAULT_SEARCH.coarsePx;
  const PEAKS = search.peaks ?? DEFAULT_SEARCH.peaks;
  const Wc = clamp(cols * coarsePx, 160, 800);
  const Hc = Math.round((Wc * keyCanvas.height) / keyCanvas.width);
  const cs = Wc / cols; // one grid cell, in coarse pixels
  if (cache.cols !== cols || cache.src !== keyCanvas || cache.coarsePx !== coarsePx || !cache.coarse || !cache.fine || !cache.native) {
    cache.cols = cols;
    cache.src = keyCanvas;
    cache.coarsePx = coarsePx;
    cache.coarse = keyChannels(keyCanvas, Wc, Hc, cs);
    cache.fine = keyChannels(keyCanvas, Wc * FINE, Hc * FINE, cs * FINE);
    const factor = Math.max(FINE, Math.min(NATIVE_MAX, keyCanvas.width / Wc));
    cache.nativeFactor = factor;
    cache.native = keyChannels(keyCanvas, Math.round(Wc * factor), Math.round(Hc * factor), cs * factor);
  }
  const KC = cache.coarse;
  const KF = cache.fine;
  const KN = cache.native;
  const NF = cache.nativeFactor ?? FINE;
  const W = KC.W;
  const H = KC.H;

  // Positions whose centre falls outside every allowed cell (plus a margin) are skipped.
  let allowed: Uint8Array | null = null;
  if (search.allowedCell && search.rows) {
    allowed = new Uint8Array(W * H);
    const rows = search.rows;
    const cellW = W / cols;
    const cellH = H / rows;
    const m = search.cellMargin ?? 0;
    for (let r = 1; r <= rows; r++)
      for (let c = 1; c <= cols; c++) {
        if (!search.allowedCell(c, r)) continue;
        const x0 = Math.max(0, Math.floor((c - 1 - m) * cellW));
        const x1 = Math.min(W - 1, Math.ceil((c + m) * cellW) - 1);
        const y0 = Math.max(0, Math.floor((r - 1 - m) * cellH));
        const y1 = Math.min(H - 1, Math.ceil((r + m) * cellH) - 1);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) allowed[y * W + x] = 1;
      }
  }

  // Pass 1: every position, 4 turns x 3 sizes, on a small copy of the key.
  const combos: { t: Template; rot: number; k: number }[] = [];
  for (let rot = 0; rot < 4; rot++)
    for (const k of SCALES) {
      const t = buildTemplate(piece, rot, 0, cs * k, cs, W);
      if (t) combos.push({ t, rot, k });
    }
  if (!combos.length) throw new Error("The piece cut-out is too small to match. Retake the photo closer.");

  const best = new Float32Array(W * H).fill(-9);
  const bestCombo = new Int8Array(W * H);
  let last = performance.now();
  for (let ci = 0; ci < combos.length; ci++) {
    const t = combos[ci].t;
    const maxY = H - t.h;
    const maxX = W - t.w;
    if (maxY < 0 || maxX < 0) continue;
    const hx = Math.round(t.cx);
    const hy = Math.round(t.cy);
    for (let y = 0; y <= maxY; y++) {
      const row = y * W;
      for (let x = 0; x <= maxX; x++) {
        const center = (y + hy) * W + x + hx;
        if (allowed && !allowed[center]) continue;
        const s = scoreAt(KC, t, row + x);
        if (s > best[center]) {
          best[center] = s;
          bestCombo[center] = ci;
        }
      }
      if (performance.now() - last > 32) {
        onProgress(((ci + y / (maxY + 1)) / combos.length) * 0.85);
        await tick();
        if (isCancelled()) throw new MatchCancelled();
        last = performance.now();
      }
    }
  }

  // Strongest peaks, kept apart from each other.
  const peaks: { x: number; y: number; combo: (typeof combos)[number] }[] = [];
  const rad = Math.ceil(cs * 0.7);
  for (let p = 0; p < PEAKS; p++) {
    let bi = -1;
    let bs = -8;
    for (let i = 0; i < best.length; i++)
      if (best[i] > bs) { bs = best[i]; bi = i; }
    if (bi < 0) break;
    const px = bi % W;
    const py = (bi / W) | 0;
    peaks.push({ x: px, y: py, combo: combos[bestCombo[bi]] });
    for (let y = Math.max(0, py - rad); y <= Math.min(H - 1, py + rad); y++)
      for (let x = Math.max(0, px - rad); x <= Math.min(W - 1, px + rad); x++) best[y * W + x] = -9;
  }

  // Pass 2: re-score each peak at 3x detail, nudging position, size and tilt.
  const fineTemplates = new Map<string, Template | null>();
  const getFine = (rot: number, k: number, tilt: number): Template | null => {
    const id = rot + ":" + k.toFixed(2) + ":" + tilt;
    let t = fineTemplates.get(id);
    if (t === undefined) {
      t = buildTemplate(piece, rot, tilt, cs * FINE * k, cs * FINE, KF.W);
      fineTemplates.set(id, t);
    }
    return t;
  };
  const R = Math.ceil(cs * FINE * 0.45);
  interface Candidate { score: number; cx: number; cy: number; rot: number; k: number; tilt: number }
  const refined: Candidate[] = [];
  for (let pi = 0; pi < peaks.length; pi++) {
    const pk = peaks[pi];
    const fx = pk.x * FINE + 1;
    const fy = pk.y * FINE + 1;
    let top: Candidate | null = null;
    for (const dk of FINE_SCALES)
      for (const tilt of TILTS) {
        const t = getFine(pk.combo.rot, pk.combo.k + dk, tilt);
        if (!t) continue;
        const hx = Math.round(t.cx);
        const hy = Math.round(t.cy);
        for (let oy = -R; oy <= R; oy++) {
          const y = fy - hy + oy;
          if (y < 0 || y + t.h > KF.H) continue;
          for (let ox = -R; ox <= R; ox++) {
            const x = fx - hx + ox;
            if (x < 0 || x + t.w > KF.W) continue;
            const s = scoreAt(KF, t, y * KF.W + x);
            if (!top || s > top.score) top = { score: s, cx: x + t.cx, cy: y + t.cy, rot: pk.combo.rot, k: pk.combo.k + dk, tilt };
          }
        }
      }
    if (top) refined.push(top);
    onProgress(0.85 + (0.1 * (pi + 1)) / peaks.length);
    await tick();
    if (isCancelled()) throw new MatchCancelled();
  }

  refined.sort((a, b) => b.score - a.score);
  const finalists: Candidate[] = [];
  for (const c of refined) {
    if (finalists.every((p) => Math.hypot(p.cx - c.cx, p.cy - c.cy) > cs * FINE * 0.6)) finalists.push(c);
    if (finalists.length === FINALISTS) break;
  }

  // Pass 3: the finalists at (near) the key's own resolution, where fine
  // texture such as foliage or rock actually lines up.
  const lastTemplates = new Map<string, Template | null>();
  const getLast = (rot: number, k: number, tilt: number): Template | null => {
    const id = rot + ":" + k.toFixed(2) + ":" + tilt;
    let t = lastTemplates.get(id);
    if (t === undefined) {
      t = buildTemplate(piece, rot, tilt, cs * NF * k, cs * NF, KN.W);
      lastTemplates.set(id, t);
    }
    return t;
  };
  const R2 = Math.max(2, Math.round(NF / FINE));
  const final: Candidate[] = [];
  for (let fi = 0; fi < finalists.length; fi++) {
    const c = finalists[fi];
    const nx = (c.cx / KF.W) * KN.W;
    const ny = (c.cy / KF.H) * KN.H;
    let top: Candidate | null = null;
    for (const dk of LAST_SCALES)
      for (const dt of LAST_TILTS) {
        const t = getLast(c.rot, c.k + dk, c.tilt + dt);
        if (!t) continue;
        const bx = Math.round(nx - t.cx);
        const by = Math.round(ny - t.cy);
        for (let oy = -R2; oy <= R2; oy++) {
          const y = by + oy;
          if (y < 0 || y + t.h > KN.H) continue;
          for (let ox = -R2; ox <= R2; ox++) {
            const x = bx + ox;
            if (x < 0 || x + t.w > KN.W) continue;
            const s = scoreAt(KN, t, y * KN.W + x);
            if (!top || s > top.score) top = { ...c, score: s, cx: x + t.cx, cy: y + t.cy };
          }
        }
      }
    final.push(top ?? { ...c, cx: nx, cy: ny });
    onProgress(0.95 + (0.05 * (fi + 1)) / finalists.length);
    await tick();
    if (isCancelled()) throw new MatchCancelled();
  }
  final.sort((a, b) => b.score - a.score);
  const ref = getFine(0, SCALES[1], 0);
  const texture = ref ? Math.sqrt(ref.tss / (3 * ref.n)) : 0;
  return final.slice(0, RESULTS).map((c) => ({ u: c.cx / KN.W, v: c.cy / KN.H, rot: c.rot, score: c.score, texture }));
}
