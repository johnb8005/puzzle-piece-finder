import { describe, expect, test } from "bun:test";
import { describeSession, hasContent, newSession, relativeTime, resumeStep } from "./session";

const blob = new Blob(["x"]);
const match = { u: 0.5, v: 0.5, rot: 0, score: 0.9 };

describe("newSession", () => {
  test("starts empty on the key step with sensible defaults", () => {
    const s = newSession(1000);
    expect(s.step).toBe("key");
    expect(s.count).toBe(500);
    expect(s.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(hasContent(s)).toBe(false);
  });
  test("ids are unique", () => {
    expect(newSession().id).not.toBe(newSession().id);
  });
});

describe("resumeStep", () => {
  test("falls back to the key step without a saved key", () => {
    expect(resumeStep({ key: null, results: [match], step: "result" })).toBe("key");
  });
  test("returns to the piece step when results are missing", () => {
    expect(resumeStep({ key: blob, results: null, step: "result" })).toBe("piece");
    expect(resumeStep({ key: blob, results: [], step: "result" })).toBe("piece");
  });
  test("returns to the result step when everything is there", () => {
    expect(resumeStep({ key: blob, results: [match], step: "result" })).toBe("result");
  });
  test("never skips ahead of where the user was", () => {
    expect(resumeStep({ key: blob, results: [match], step: "key" })).toBe("key");
  });
});

describe("relativeTime", () => {
  const now = 10_000_000;
  test("just now under a minute", () => expect(relativeTime(now - 30_000, now)).toBe("just now"));
  test("minutes", () => expect(relativeTime(now - 5 * 60_000, now)).toBe("5 min ago"));
  test("hours", () => expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3 h ago"));
  test("yesterday", () => expect(relativeTime(now - 24 * 3_600_000, now)).toBe("yesterday"));
  test("days", () => expect(relativeTime(now - 3 * 24 * 3_600_000, now)).toBe("3 days ago"));
});

describe("describeSession", () => {
  const now = 10_000_000;
  test("shows the grid once the key is saved", () => {
    expect(describeSession({ count: 500, grid: { cols: 25, rows: 20 }, key: blob, results: null, updatedAt: now }, now)).toBe("25 × 20 · just now");
  });
  test("notes a placed piece", () => {
    expect(describeSession({ count: 500, grid: { cols: 25, rows: 20 }, key: blob, results: [match], updatedAt: now }, now)).toBe(
      "25 × 20 · piece placed · just now",
    );
  });
  test("says when the key is not saved yet", () => {
    expect(describeSession({ count: 300, grid: null, key: null, results: null, updatedAt: now }, now)).toBe("key not saved yet · just now");
  });
});
