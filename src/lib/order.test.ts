import { describe, expect, test } from "bun:test";
import { readingOrder } from "./segment";

const box = (x: number, y: number, w = 0.1, h = 0.1) => ({ box: { x, y, w, h } });

describe("readingOrder", () => {
  test("numbers left to right, then top to bottom", () => {
    const pieces = [box(0.6, 0.6), box(0.1, 0.6), box(0.6, 0.1), box(0.1, 0.1)];
    expect(readingOrder(pieces).map((p) => `${p.box.x},${p.box.y}`)).toEqual(["0.1,0.1", "0.6,0.1", "0.1,0.6", "0.6,0.6"]);
  });
  test("keeps slightly staggered pieces on one row", () => {
    const pieces = [box(0.6, 0.13), box(0.1, 0.1), box(0.35, 0.08)];
    expect(readingOrder(pieces).map((p) => p.box.x)).toEqual([0.1, 0.35, 0.6]);
  });
  test("a single piece is untouched", () => {
    const one = [box(0.5, 0.5)];
    expect(readingOrder(one)).toBe(one);
  });
});
