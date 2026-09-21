export type Step = "key" | "piece" | "result";

/** Normalised crop rectangle over the raw key photo, all values 0..1. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}
