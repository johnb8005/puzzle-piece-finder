import { clamp } from "./canvas";

export interface Grid {
  cols: number;
  rows: number;
}

/**
 * Work out pieces across / down from the total piece count and the aspect
 * ratio of the cropped key, assuming roughly square pieces.
 */
export function autoGrid(count: number, aspect: number): Grid {
  const n = clamp(count || 0, 4, 10000);
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const cols = Math.max(2, Math.round(Math.sqrt(n * safeAspect)));
  return { cols, rows: Math.max(2, Math.round(n / cols)) };
}

/** 1-based row / column of a normalised (u, v) point on the grid. */
export function cellOf(u: number, v: number, grid: Grid): { row: number; col: number } {
  return {
    col: clamp(Math.floor(u * grid.cols) + 1, 1, grid.cols),
    row: clamp(Math.floor(v * grid.rows) + 1, 1, grid.rows),
  };
}
