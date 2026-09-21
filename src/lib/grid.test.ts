import { describe, expect, test } from "bun:test";
import { autoGrid, cellOf } from "./grid";

describe("autoGrid", () => {
  test("a square 100-piece puzzle is 10 x 10", () => {
    expect(autoGrid(100, 1)).toEqual({ cols: 10, rows: 10 });
  });
  test("a 4:3 500-piece puzzle is wider than it is tall", () => {
    const g = autoGrid(500, 4 / 3);
    expect(g.cols).toBeGreaterThan(g.rows);
    expect(g.cols * g.rows).toBeGreaterThan(450);
    expect(g.cols * g.rows).toBeLessThan(550);
  });
  test("never drops below 2 x 2", () => {
    expect(autoGrid(0, 1)).toEqual({ cols: 2, rows: 2 });
    expect(autoGrid(4, 100)).toEqual({ cols: 20, rows: 2 });
  });
  test("tolerates a broken aspect ratio", () => {
    expect(autoGrid(100, NaN)).toEqual({ cols: 10, rows: 10 });
    expect(autoGrid(100, 0)).toEqual({ cols: 10, rows: 10 });
  });
});

describe("cellOf", () => {
  const grid = { cols: 10, rows: 5 };
  test("maps the top-left corner to row 1, column 1", () => {
    expect(cellOf(0, 0, grid)).toEqual({ row: 1, col: 1 });
  });
  test("maps the centre to the middle cell", () => {
    expect(cellOf(0.5, 0.5, grid)).toEqual({ row: 3, col: 6 });
  });
  test("clamps the far edge into the last cell", () => {
    expect(cellOf(1, 1, grid)).toEqual({ row: 5, col: 10 });
  });
});
