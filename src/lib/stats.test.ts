import { describe, expect, test } from "bun:test";
import { median, otsu } from "./stats";

describe("median", () => {
  test("returns the middle value of an odd-length list", () => {
    expect(median([5, 1, 3])).toBe(3);
  });
  test("returns the upper-middle value of an even-length list", () => {
    expect(median([4, 1, 3, 2])).toBe(3);
  });
  test("returns 0 for an empty list", () => {
    expect(median([])).toBe(0);
  });
});

describe("otsu", () => {
  test("splits two well-separated clusters between them", () => {
    const hist = new Uint32Array(256);
    hist[20] = 100;
    hist[200] = 100;
    const thr = otsu(hist, 200);
    expect(thr).toBeGreaterThanOrEqual(20);
    expect(thr).toBeLessThan(200);
  });
  test("returns 0 when every pixel has the same value", () => {
    const hist = new Uint32Array(256);
    hist[77] = 50;
    expect(otsu(hist, 50)).toBe(0);
  });
});
