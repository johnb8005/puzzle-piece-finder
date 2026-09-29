import { describe, expect, test } from "bun:test";
import { applyOccupancy, assignCells, type Placement } from "./batch";

const grid = { cols: 10, rows: 10 };
const at = (col: number, row: number, score: number) => ({ u: (col - 0.5) / 10, v: (row - 0.5) / 10, rot: 0, score, texture: 20 });
const place = (index: number, ...options: ReturnType<typeof at>[]): Placement => ({ index, options, chosen: -1, filled: null });

describe("assignCells", () => {
  test("gives a contested cell to the more confident piece", () => {
    const a = place(0, at(3, 3, 0.6), at(7, 7, 0.4));
    const b = place(1, at(3, 3, 0.9), at(5, 5, 0.5));
    assignCells([a, b], grid);
    expect(b.chosen).toBe(0);
    expect(a.chosen).toBe(1);
  });
  test("leaves a piece unplaced when every option is taken", () => {
    const a = place(0, at(3, 3, 0.9));
    const b = place(1, at(3, 3, 0.5));
    assignCells([a, b], grid);
    expect(a.chosen).toBe(0);
    expect(b.chosen).toBe(-1);
  });
  test("a piece with no options stays unplaced", () => {
    const a = place(0);
    assignCells([a], grid);
    expect(a.chosen).toBe(-1);
  });
  test("keeps the input order", () => {
    const list = [place(2, at(1, 1, 0.1)), place(0, at(2, 2, 0.9)), place(1, at(3, 3, 0.5))];
    expect(assignCells(list, grid).map((p) => p.index)).toEqual([2, 0, 1]);
  });
});

describe("applyOccupancy", () => {
  test("is a no-op without a board", () => {
    const options = [at(1, 1, 0.5), at(2, 2, 0.4)];
    expect(applyOccupancy(options, null)).toEqual({ options, filled: [] });
  });
  test("demotes a spot the board already shows as filled", () => {
    const options = [at(1, 1, 0.5), at(2, 2, 0.45)];
    const filledAtFirst = (u: number) => (u < 0.15 ? 0.9 : 0.0);
    const out = applyOccupancy(options, filledAtFirst);
    expect(out.options[0].u).toBeCloseTo(0.15);
    expect(out.options[1].score).toBeCloseTo(0.35);
    expect(out.filled).toEqual([0, 0.9]);
  });
  test("leaves ranking alone when nothing is filled", () => {
    const options = [at(1, 1, 0.5), at(2, 2, 0.45)];
    const out = applyOccupancy(options, () => 0.1);
    expect(out.options.map((o) => o.score)).toEqual([0.5, 0.45]);
  });
});
