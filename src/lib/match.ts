/**
 * Matching: masked, lighting-tolerant template search.
 *
 * Pass 1 slides the piece over a small copy of the key at every position, in
 * four turns and three sizes, scoring zero-mean colour correlation minus a
 * penalty for overall colour drift. Pass 2 re-scores the strongest peaks on a
 * 3x finer copy, nudging position and size, and returns the top distinct spots.
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
}

/** Per-channel float copies of the key at a given size. */
interface KeyChannels {
  W: number;
  H: number;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
}

/** Key channels are expensive to build, so callers keep them between runs. */
export interface KeyCache {
  cols?: number;
  src?: HTMLCanvasElement;
  coarse?: KeyChannels;
  fine?: KeyChannels;
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
  mr: number;
  mg: number;
  mb: number;
  /** Total sum of squares of the zero-mean template, for normalisation. */
  tss: number;
  rot: number;
}

export class MatchCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "MatchCancelled";
  }
}

/** Piece outline vs. one grid cell: no tabs … tabs on both sides. */
const SCALES = [1.0, 1.2, 1.4] as const;
/** How hard a wrong overall colour is punished. */
const COLOR_WEIGHT = 1.5;
/** Fine pass detail multiplier. */
const FINE = 3;
const PEAKS = 24;
const RESULTS = 3;

function keyChannels(canvas: HTMLCanvasElement, W: number, H: number): KeyChannels {
  const c = resizeCanvas(canvas, W, H);
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
  const n = c.width * c.height;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = d[i * 4];
    g[i] = d[i * 4 + 1];
    b[i] = d[i * 4 + 2];
  }
  return { W: c.width, H: c.height, r, g, b };
}

function buildTemplate(piece: HTMLCanvasElement, rot: number, longSide: number, keyW: number): Template | null {
  const f = longSide / Math.max(piece.width, piece.height);
  const tw = Math.max(3, Math.round(piece.width * f));
  const th = Math.max(3, Math.round(piece.height * f));
  const scaled = resizeCanvas(piece, tw, th);
  const swap = rot % 2 === 1;
  const cw = swap ? th : tw;
  const ch = swap ? tw : th;
  const c = makeCanvas(cw, ch);
  const cx = ctx2d(c);
  cx.translate(cw / 2, ch / 2);
  cx.rotate((rot * Math.PI) / 2);
  cx.drawImage(scaled, -tw / 2, -th / 2);
  const d = cx.getImageData(0, 0, cw, ch).data;
  const off: number[] = [];
  const R: number[] = [];
  const G: number[] = [];
  const B: number[] = [];
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const i = (y * cw + x) * 4;
      if (d[i + 3] > 200) {
        off.push(y * keyW + x);
        R.push(d[i]);
        G.push(d[i + 1]);
        B.push(d[i + 2]);
      }
    }
  const n = off.length;
  if (n < 6) return null;
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < n; i++) { mr += R[i]; mg += G[i]; mb += B[i]; }
  mr /= n; mg /= n; mb /= n;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  let tss = 0;
  for (let i = 0; i < n; i++) {
    r[i] = R[i] - mr;
    g[i] = G[i] - mg;
    b[i] = B[i] - mb;
    tss += r[i] * r[i] + g[i] * g[i] + b[i] * b[i];
  }
  return { w: cw, h: ch, n, off: Int32Array.from(off), r, g, b, mr, mg, mb, tss, rot };
}

/** Pattern agreement (zero-mean correlation) minus a penalty for colour drift. */
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
  const reg = n * 48; // keeps flat, texture-free areas from scoring on noise
  const zncc = c / Math.sqrt((t.tss + reg) * (wss + reg));
  const dr = sr / n - t.mr;
  const dg = sg / n - t.mg;
  const db = sb / n - t.mb;
  return zncc - (COLOR_WEIGHT * Math.sqrt(dr * dr + dg * dg + db * db)) / 441.7;
}

export interface FindPieceOptions {
  keyCanvas: HTMLCanvasElement;
  piece: HTMLCanvasElement;
  cols: number;
  cache: KeyCache;
  onProgress: (fraction: number) => void;
  isCancelled: () => boolean;
}

export async function findPiece({ keyCanvas, piece, cols, cache, onProgress, isCancelled }: FindPieceOptions): Promise<Match[]> {
  const Wc = clamp(cols * 8, 160, 480);
  const Hc = Math.round((Wc * keyCanvas.height) / keyCanvas.width);
  const cs = Wc / cols; // one grid cell, in coarse pixels
  if (cache.cols !== cols || cache.src !== keyCanvas || !cache.coarse || !cache.fine) {
    cache.cols = cols;
    cache.src = keyCanvas;
    cache.coarse = keyChannels(keyCanvas, Wc, Hc);
    cache.fine = keyChannels(keyCanvas, Wc * FINE, Hc * FINE);
  }
  const KC = cache.coarse;
  const KF = cache.fine;
  const W = KC.W;
  const H = KC.H;

  // Pass 1: every position, 4 turns x 3 sizes, on a small copy of the key.
  const combos: { t: Template; rot: number; k: number }[] = [];
  for (let rot = 0; rot < 4; rot++)
    for (const k of SCALES) {
      const t = buildTemplate(piece, rot, cs * k, W);
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
    const hx = t.w >> 1;
    const hy = t.h >> 1;
    for (let y = 0; y <= maxY; y++) {
      const row = y * W;
      for (let x = 0; x <= maxX; x++) {
        const s = scoreAt(KC, t, row + x);
        const center = (y + hy) * W + x + hx;
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

  // Pass 2: re-score each peak at 3x detail, nudging position and size.
  const fineTemplates = new Map<string, Template | null>();
  const getFine = (rot: number, k: number): Template | null => {
    const id = rot + ":" + k.toFixed(2);
    let t = fineTemplates.get(id);
    if (t === undefined) {
      t = buildTemplate(piece, rot, cs * FINE * k, KF.W);
      fineTemplates.set(id, t);
    }
    return t;
  };
  const R = Math.ceil(cs * FINE * 0.45);
  const refined: { score: number; cx: number; cy: number; rot: number }[] = [];
  for (let pi = 0; pi < peaks.length; pi++) {
    const pk = peaks[pi];
    const fx = pk.x * FINE + 1;
    const fy = pk.y * FINE + 1;
    let top: { score: number; cx: number; cy: number; rot: number } | null = null;
    for (const dk of [-0.1, 0, 0.1]) {
      const t = getFine(pk.combo.rot, pk.combo.k + dk);
      if (!t) continue;
      const hx = t.w >> 1;
      const hy = t.h >> 1;
      for (let oy = -R; oy <= R; oy++) {
        const y = fy - hy + oy;
        if (y < 0 || y + t.h > KF.H) continue;
        for (let ox = -R; ox <= R; ox++) {
          const x = fx - hx + ox;
          if (x < 0 || x + t.w > KF.W) continue;
          const s = scoreAt(KF, t, y * KF.W + x);
          if (!top || s > top.score) top = { score: s, cx: x + t.w / 2, cy: y + t.h / 2, rot: pk.combo.rot };
        }
      }
    }
    if (top) refined.push(top);
    onProgress(0.85 + (0.15 * (pi + 1)) / peaks.length);
    await tick();
    if (isCancelled()) throw new MatchCancelled();
  }

  refined.sort((a, b) => b.score - a.score);
  const picked: typeof refined = [];
  for (const c of refined) {
    if (picked.every((p) => Math.hypot(p.cx - c.cx, p.cy - c.cy) > cs * FINE * 0.6)) picked.push(c);
    if (picked.length === RESULTS) break;
  }
  return picked.map((c) => ({ u: c.cx / KF.W, v: c.cy / KF.H, rot: c.rot, score: c.score }));
}
