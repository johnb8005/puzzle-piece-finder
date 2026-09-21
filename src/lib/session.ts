/** A saved puzzle session: everything needed to pick up where the user left off. */
import type { Grid } from "./grid";
import type { Match } from "./match";
import type { Crop, Step } from "../types";

export interface SessionRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Small JPEG data URL of the key, for the library list. */
  thumb: string;
  // Step 1
  rawKey: Blob | null;
  crop: Crop;
  count: number;
  manual: Grid | null;
  key: Blob | null;
  grid: Grid | null;
  // Step 2
  piece: Blob | null;
  cutoff: number;
  straighten: boolean;
  // Step 3
  results: Match[] | null;
  sel: number;
  step: Step;
}

export function newSession(now = Date.now()): SessionRecord {
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    thumb: "",
    rawKey: null,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    count: 500,
    manual: null,
    key: null,
    grid: null,
    piece: null,
    cutoff: 1,
    straighten: true,
    results: null,
    sel: 0,
    step: "key",
  };
}

/** Whether a session holds anything worth keeping. Empty sessions are never written. */
export function hasContent(s: Pick<SessionRecord, "rawKey" | "key" | "piece">): boolean {
  return !!(s.rawKey || s.key || s.piece);
}

/** The furthest step a restored session can legitimately show. */
export function resumeStep(s: Pick<SessionRecord, "key" | "results" | "step">): Step {
  if (s.step === "result" && s.key && s.results?.length) return "result";
  if (s.step !== "key" && s.key) return "piece";
  return "key";
}

/** Human-readable one-liner for the library list. */
export function describeSession(s: Pick<SessionRecord, "count" | "grid" | "key" | "results" | "updatedAt">, now = Date.now()): string {
  const parts: string[] = [];
  if (s.grid) parts.push(`${s.grid.cols} × ${s.grid.rows}`);
  else if (s.key) parts.push(`${s.count} pieces`);
  else parts.push("key not saved yet");
  if (s.results?.length) parts.push("piece placed");
  parts.push(relativeTime(s.updatedAt, now));
  return parts.join(" · ");
}

export function relativeTime(then: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return d === 1 ? "yesterday" : `${d} days ago`;
  return new Date(then).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
