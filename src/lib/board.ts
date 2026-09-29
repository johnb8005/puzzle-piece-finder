/**
 * The board is a photo of the partly finished puzzle, cropped to the puzzle's
 * outer frame, so it shares normalised coordinates with the key. Comparing a
 * cell on the board with the same cell on the key tells whether that spot is
 * already filled (the picture is there) or still empty (table showing).
 */
import { ctx2d, resizeCanvas } from "./canvas";
import type { Grid } from "./grid";

const CELL_PX = 10;

function luminance(c: HTMLCanvasElement, W: number, H: number): Float32Array {
  const d = ctx2d(resizeCanvas(c, W, H)).getImageData(0, 0, W, H).data;
  const out = new Float32Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return out;
}

/** Zero-mean normalised cross-correlation of two equal-length windows. */
function zncc(a: Float32Array, b: Float32Array): number {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let c = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    c += da * db; va += da * da; vb += db * db;
  }
  const reg = n * 16; // flat cells should not correlate on noise
  return c / Math.sqrt((va + reg) * (vb + reg));
}

export type Occupancy = (u: number, v: number) => number;

/**
 * Returns a function giving, for a normalised point on the puzzle, how much
 * the board looks like the key there (-1..1). Above ~0.4 the cell is very
 * likely already placed.
 */
export function boardOccupancy(board: HTMLCanvasElement, key: HTMLCanvasElement, grid: Grid): Occupancy {
  const W = grid.cols * CELL_PX;
  const H = grid.rows * CELL_PX;
  const K = luminance(key, W, H);
  const B = luminance(board, W, H);
  const win = new Float32Array(CELL_PX * CELL_PX);
  const winB = new Float32Array(CELL_PX * CELL_PX);
  return (u, v) => {
    const x0 = Math.min(W - CELL_PX, Math.max(0, Math.round(u * W - CELL_PX / 2)));
    const y0 = Math.min(H - CELL_PX, Math.max(0, Math.round(v * H - CELL_PX / 2)));
    let k = 0;
    for (let y = 0; y < CELL_PX; y++)
      for (let x = 0; x < CELL_PX; x++, k++) {
        const i = (y0 + y) * W + x0 + x;
        win[k] = K[i];
        winB[k] = B[i];
      }
    return zncc(win, winB);
  };
}

/** Threshold above which a board cell counts as already filled. */
export const FILLED_THRESHOLD = 0.4;
