/** A saved puzzle session: everything needed to pick up where the user left off. */
import type { Placement } from "./batch";
import type { Grid } from "./grid";
import type { Match } from "./match";
import type { Crop, Step } from "../types";

/** One piece at a time, or a photo of many pieces placed together. */
export type Mode = "single" | "batch";

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
  // Many pieces at once
  mode: Mode;
  piecesPhoto: Blob | null;
  batchCutoff: number;
  batchStraighten: boolean;
  /** Piece indices the user unticked. */
  excluded: number[];
  /** Photo of the partly finished puzzle, if given. */
  board: Blob | null;
  boardCrop: Crop;
  placements: Placement[] | null;
  batchSel: number;
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
    mode: "single",
    piecesPhoto: null,
    batchCutoff: 1,
    batchStraighten: true,
    excluded: [],
    board: null,
    boardCrop: { x: 0, y: 0, w: 1, h: 1 },
    placements: null,
    batchSel: 0,
  };
}

/** Fill in fields that records saved by older versions of the app lack. */
export function normaliseSession(rec: Partial<SessionRecord> & Pick<SessionRecord, "id">): SessionRecord {
  return { ...newSession(rec.createdAt), ...rec };
}

/** Whether a session holds anything worth keeping. Empty sessions are never written. */
export function hasContent(s: Pick<SessionRecord, "rawKey" | "key" | "piece" | "piecesPhoto" | "board">): boolean {
  return !!(s.rawKey || s.key || s.piece || s.piecesPhoto || s.board);
}

/** Whether the session has something to show on the Place step. */
export function hasResult(s: Pick<SessionRecord, "mode" | "results" | "placements">): boolean {
  return s.mode === "batch" ? !!s.placements?.length : !!s.results?.length;
}

/** The furthest step a restored session can legitimately show. */
export function resumeStep(s: Pick<SessionRecord, "key" | "results" | "step" | "mode" | "placements">): Step {
  if (s.step === "result" && s.key && hasResult(s)) return "result";
  if (s.step !== "key" && s.key) return "piece";
  return "key";
}

/** Human-readable one-liner for the library list. */
export function describeSession(
  s: Pick<SessionRecord, "count" | "grid" | "key" | "results" | "updatedAt"> & Partial<Pick<SessionRecord, "placements">>,
  now = Date.now(),
): string {
  const parts: string[] = [];
  if (s.grid) parts.push(`${s.grid.cols} × ${s.grid.rows}`);
  else if (s.key) parts.push(`${s.count} pieces`);
  else parts.push("key not saved yet");
  const placed = s.placements?.filter((p) => p.chosen >= 0).length ?? 0;
  if (placed) parts.push(`${placed} pieces placed`);
  else if (s.results?.length) parts.push("piece placed");
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
