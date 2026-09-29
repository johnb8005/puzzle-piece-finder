/**
 * Placing many pieces at once: each piece is matched against the key, the
 * board (if any) demotes spots that already look filled, and cells are handed
 * out greedily so two pieces never claim the same one.
 */
import type { Occupancy } from "./board";
import { emptyCells, FILLED_THRESHOLD } from "./board";
import { cellOf, type Grid } from "./grid";
import { findPiece, MatchCancelled, type KeyCache, type Match, type SearchOptions } from "./match";

export interface Placement {
  /** Index into the pieces list. */
  index: number;
  /** Candidate spots, best first, after the board penalty. */
  options: Match[];
  /** Which option was assigned, or -1 if none (no match, or all cells taken). */
  chosen: number;
  /** Board similarity at the chosen spot, when a board was given. */
  filled: number | null;
}

/** Penalty for a spot the board already shows as filled. */
const FILLED_PENALTY = 0.15;

export interface PlacePiecesOptions {
  keyCanvas: HTMLCanvasElement;
  pieces: { index: number; canvas: HTMLCanvasElement }[];
  grid: Grid;
  cache: KeyCache;
  occupancy: Occupancy | null;
  /** Whether the board was aligned well enough to trust cell boundaries. */
  aligned?: boolean;
  onProgress: (done: number, total: number, fraction: number) => void;
  isCancelled: () => boolean;
  search?: SearchOptions;
}

/**
 * Hand out cells greedily: the most confident placements pick first, and a
 * piece whose best cell is taken falls back to its next option.
 */
export function assignCells(placements: Placement[], grid: Grid): Placement[] {
  const order = [...placements].sort((a, b) => (b.options[0]?.score ?? -9) - (a.options[0]?.score ?? -9));
  const taken = new Set<string>();
  for (const p of order) {
    p.chosen = -1;
    for (let i = 0; i < p.options.length; i++) {
      const { row, col } = cellOf(p.options[i].u, p.options[i].v, grid);
      const key = `${row}:${col}`;
      if (!taken.has(key)) {
        taken.add(key);
        p.chosen = i;
        break;
      }
    }
  }
  return placements;
}

/** Re-rank one piece's candidates using how filled the board already looks there. */
export function applyOccupancy(options: Match[], occupancy: Occupancy | null): { options: Match[]; filled: number[] } {
  if (!occupancy) return { options, filled: [] };
  const scored = options.map((m) => {
    const f = occupancy(m.u, m.v);
    return { m: { ...m, score: m.score - (f > FILLED_THRESHOLD ? FILLED_PENALTY : 0) }, f };
  });
  scored.sort((a, b) => b.m.score - a.m.score);
  return { options: scored.map((s) => s.m), filled: scored.map((s) => s.f) };
}

export async function placePieces({ keyCanvas, pieces, grid, cache, occupancy, aligned = true, onProgress, isCancelled, search = {} }: PlacePiecesOptions): Promise<Placement[]> {
  const placements: Placement[] = [];
  const filledAt = new Map<number, number[]>();
  // With a board, only cells that still look empty are searched at all. When
  // the board is aligned the piece may sit a little over a cell's edge; when
  // it is not, whole neighbouring cells are allowed too.
  let allowedCell: SearchOptions["allowedCell"];
  const cellMargin = aligned ? 0.3 : 0;
  if (occupancy) {
    const empty = emptyCells(occupancy, grid, !aligned);
    const anyEmpty = empty.some((row) => row.some(Boolean));
    if (anyEmpty) allowedCell = (col, row) => empty[row - 1]?.[col - 1] ?? true;
  }
  for (let i = 0; i < pieces.length; i++) {
    const { index, canvas } = pieces[i];
    onProgress(i, pieces.length, i / pieces.length);
    let raw: Match[] = [];
    try {
      raw = await findPiece({
        keyCanvas,
        piece: canvas,
        cols: grid.cols,
        cache,
        onProgress: (p) => onProgress(i, pieces.length, (i + p) / pieces.length),
        isCancelled,
        search: { ...search, allowedCell, rows: grid.rows, cellMargin },
      });
    } catch (e) {
      if (e instanceof MatchCancelled) throw e;
      // A cut-out too small to match simply stays unplaced.
    }
    const { options, filled } = applyOccupancy(raw, occupancy);
    filledAt.set(index, filled);
    placements.push({ index, options, chosen: -1, filled: null });
  }
  onProgress(pieces.length, pieces.length, 1);
  assignCells(placements, grid);
  for (const p of placements) {
    const f = filledAt.get(p.index);
    p.filled = occupancy && p.chosen >= 0 && f ? f[p.chosen] : null;
  }
  return placements.sort((a, b) => a.index - b.index);
}
