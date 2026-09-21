import { describe, expect, test } from "bun:test";
import { verdictFor } from "./verdict";

describe("verdictFor", () => {
  test("null when there are no results", () => {
    expect(verdictFor([])).toBeNull();
  });
  test("a high, clearly leading score is a strong match", () => {
    expect(verdictFor([0.7, 0.4])).toEqual({ label: "Strong match", weak: false });
  });
  test("a single result counts as clearly leading", () => {
    expect(verdictFor([0.6])?.weak).toBe(false);
  });
  test("a modest score with a small lead is a likely match", () => {
    expect(verdictFor([0.4, 0.35])).toEqual({ label: "Likely match", weak: false });
  });
  test("close scores are flagged as ambiguous", () => {
    expect(verdictFor([0.7, 0.68])?.weak).toBe(true);
  });
});
