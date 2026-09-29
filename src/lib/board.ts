/**
 * The board is a photo of the partly finished puzzle, cropped to the puzzle's
 * outer frame, so it roughly shares normalised coordinates with the key. The
 * crop is never exact, so the board is first aligned to the key (shift and
 * scale), then each cell is compared with the same cell on the key to tell
 * whether that spot is already filled (the picture is there) or still empty
 * (table showing).
 */
import { ctx2d, resizeCanvas } from "./canvas";
import type { Grid } from "./grid";

/** Pixels per cell for the comparison images. */
const CELL_PX = 8;

interface Lum {
  W: number;
  H: number;
  l: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
}

function channels(c: HTMLCanvasElement, W: number, H: number): Lum {
  const d = ctx2d(resizeCanvas(c, W, H)).getImageData(0, 0, W, H).data;
  const n = W * H;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = d[i * 4];
    g[i] = d[i * 4 + 1];
    b[i] = d[i * 4 + 2];
    l[i] = 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i];
  }
  return { W, H, l, r, g, b };
}

/** 3x3 box blur, to compare structure rather than pixel noise. */
function blur3(src: Float32Array, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && xx < W && yy >= 0 && yy < H) { s += src[yy * W + xx]; n++; }
        }
      out[y * W + x] = s / n;
    }
  return out;
}

/** Bilinear sample with clamping. */
function sample(src: Float32Array, W: number, H: number, x: number, y: number): number {
  const cx = Math.min(W - 1.001, Math.max(0, x));
  const cy = Math.min(H - 1.001, Math.max(0, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const fx = cx - x0;
  const fy = cy - y0;
  const i = y0 * W + x0;
  return src[i] * (1 - fx) * (1 - fy) + src[i + 1] * fx * (1 - fy) + src[i + W] * (1 - fx) * fy + src[i + W + 1] * fx * fy;
}

/** Zero-mean normalised cross-correlation of two equal-length windows. */
function zncc(a: Float32Array, b: Float32Array, n: number, reg: number): number {
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let c = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    c += da * db; va += da * da; vb += db * db;
  }
  return c / Math.sqrt((va + reg) * (vb + reg));
}

/** Alignment correlation below which the board photo is not trusted for placement. */
export const ALIGNMENT_OK = 0.5;

export interface Alignment {
  /** Board position (0..1) that corresponds to key position (0,0) and (1,1): u' = ax + bx*u. */
  ax: number;
  bx: number;
  ay: number;
  by: number;
  /** Correlation achieved; low means the board photo does not look like the key at all. */
  score: number;
}

/**
 * Find the shift and scale that best lays the board over the key, using the
 * filled part of the board. Searches ±4% shift and ±3% scale.
 */
export function alignBoard(board: HTMLCanvasElement, key: HTMLCanvasElement, grid: Grid): Alignment {
  const W = grid.cols * CELL_PX;
  const H = grid.rows * CELL_PX;
  const K = blur3(channels(key, W, H).l, W, H);
  const B = blur3(channels(board, W, H).l, W, H);
  const n = W * H;
  const win = new Float32Array(n);
  let best: Alignment = { ax: 0, bx: 1, ay: 0, by: 1, score: -2 };
  const shifts: number[] = [];
  for (let s = -0.04; s <= 0.0401; s += 0.005) shifts.push(s);
  const scales = [0.97, 0.985, 1, 1.015, 1.03];
  for (const sc of scales)
    for (const dx of shifts)
      for (const dy of shifts) {
        // key (u,v) -> board (ax + bx*u, ay + by*v); scale about the centre
        const ax = dx + (1 - sc) / 2;
        const ay = dy + (1 - sc) / 2;
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) win[y * W + x] = sample(B, W, H, (ax + (sc * (x + 0.5)) / W) * W - 0.5, (ay + (sc * (y + 0.5)) / H) * H - 0.5);
        const score = zncc(K, win, n, n * 4);
        if (score > best.score) best = { ax, bx: sc, ay, by: sc, score };
      }
  return best;
}

export type Occupancy = (u: number, v: number) => number;

/** Threshold above which a board cell counts as already filled. */
export const FILLED_THRESHOLD = 0.4;

/**
 * Returns a function giving, for a normalised point on the puzzle, how much
 * the board looks like the key there (-1..1, above FILLED_THRESHOLD means
 * filled). Compares a 2x2-cell window of blurred luminance after aligning the
 * board to the key, and also counts a cell as filled when its colour matches
 * the key closely even though it has no structure to correlate.
 */
export function boardOccupancy(board: HTMLCanvasElement, key: HTMLCanvasElement, grid: Grid, alignment = alignBoard(board, key, grid)): Occupancy {
  const W = grid.cols * CELL_PX;
  const H = grid.rows * CELL_PX;
  const Kc = channels(key, W, H);
  const Bc = channels(board, W, H);
  const K = blur3(Kc.l, W, H);
  const B = blur3(Bc.l, W, H);
  // Global brightness gain between the two photos, from their medians.
  const med = (a: Float32Array) => Float32Array.from(a).sort()[a.length >> 1];
  const gain = med(K) / Math.max(1, med(B));
  // One cell, sampled well inside its edges: the blur leaks about a pixel of
  // the neighbouring cells' structure into an empty one.
  const S = CELL_PX;
  const inset = 1.5;
  const wk = new Float32Array(S * S);
  const wb = new Float32Array(S * S);
  const toBoard = (u: number, v: number): [number, number] => [(alignment.ax + alignment.bx * u) * W - 0.5, (alignment.ay + alignment.by * v) * H - 0.5];
  return (u, v) => {
    const x0 = u * W - S / 2 + inset;
    const y0 = v * H - S / 2 + inset;
    const step = (S - 2 * inset) / S;
    let k = 0;
    let kr = 0, kg = 0, kb = 0, br = 0, bg = 0, bb = 0;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++, k++) {
        const kx = x0 + x * step;
        const ky = y0 + y * step;
        wk[k] = sample(K, W, H, kx, ky);
        const [bx, by] = toBoard((kx + 0.5) / W, (ky + 0.5) / H);
        wb[k] = sample(B, W, H, bx, by) * gain;
        kr += sample(Kc.r, W, H, kx, ky); kg += sample(Kc.g, W, H, kx, ky); kb += sample(Kc.b, W, H, kx, ky);
        br += sample(Bc.r, W, H, bx, by) * gain; bg += sample(Bc.g, W, H, bx, by) * gain; bb += sample(Bc.b, W, H, bx, by) * gain;
      }
    const n = S * S;
    const z = zncc(wk, wb, n, n * 9);
    const colour = Math.hypot(kr / n - br / n, kg / n - bg / n, kb / n - bb / n);
    // Table showing through is a different colour altogether: empty, whatever
    // the texture says.
    if (colour > 60) return Math.min(z, 0);
    // A cell with structure on the key must correlate to count as filled. Only
    // a genuinely flat cell (nothing to correlate) is judged by colour alone.
    let mean = 0;
    for (let i = 0; i < n; i++) mean += wk[i];
    mean /= n;
    let varK = 0;
    for (let i = 0; i < n; i++) varK += (wk[i] - mean) ** 2;
    const flat = Math.sqrt(varK / n) < 6;
    return flat && colour < 28 ? Math.max(z, 0.5) : z;
  };
}

/**
 * Which cells of the puzzle still look empty on the board, as a map indexed
 * [row - 1][col - 1]. With `dilate`, a cell counts as empty when neither it
 * nor any of its neighbours looks filled, for when the board could not be
 * aligned and the crop may be off by most of a cell.
 */
export function emptyCells(occupancy: Occupancy, grid: Grid, dilate = true): boolean[][] {
  const filled: boolean[][] = [];
  for (let r = 0; r < grid.rows; r++) {
    filled.push([]);
    for (let c = 0; c < grid.cols; c++) filled[r].push(occupancy((c + 0.5) / grid.cols, (r + 0.5) / grid.rows) > FILLED_THRESHOLD);
  }
  if (!dilate) return filled.map((row) => row.map((f) => !f));
  const empty: boolean[][] = [];
  for (let r = 0; r < grid.rows; r++) {
    empty.push([]);
    for (let c = 0; c < grid.cols; c++) {
      let anyEmpty = false;
      for (let dr = -1; dr <= 1 && !anyEmpty; dr++)
        for (let dc = -1; dc <= 1 && !anyEmpty; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < grid.rows && cc >= 0 && cc < grid.cols && !filled[rr][cc]) anyEmpty = true;
        }
      empty[r].push(anyEmpty);
    }
  }
  return empty;
}
