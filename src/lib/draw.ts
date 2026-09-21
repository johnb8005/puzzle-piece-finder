/** Canvas drawing for the result view. */
import { clamp, ctx2d } from "./canvas";
import type { Grid } from "./grid";
import type { Match } from "./match";
import { P } from "../theme";

/** Close-up of the matched spot on the key, with the piece's cell outlined. */
export function drawZoom(target: HTMLCanvasElement, key: HTMLCanvasElement, grid: Grid, match: Match): void {
  const cellW = key.width / grid.cols;
  const cellH = key.height / grid.rows;
  const S = Math.min(5 * Math.max(cellW, cellH), key.width, key.height);
  const sx = clamp(match.u * key.width - S / 2, 0, key.width - S);
  const sy = clamp(match.v * key.height - S / 2, 0, key.height - S);
  const zx = ctx2d(target);
  zx.imageSmoothingQuality = "high";
  zx.clearRect(0, 0, target.width, target.height);
  zx.drawImage(key, sx, sy, S, S, 0, 0, target.width, target.height);
  const f = target.width / S;
  const bx = (match.u * key.width - cellW / 2 - sx) * f;
  const by = (match.v * key.height - cellH / 2 - sy) * f;
  zx.lineWidth = 8;
  zx.strokeStyle = P.ink;
  zx.strokeRect(bx, by, cellW * f, cellH * f);
  zx.lineWidth = 4;
  zx.strokeStyle = P.mark;
  zx.strokeRect(bx, by, cellW * f, cellH * f);
}

/** The cut-out piece, turned the way it sits in the picture. */
export function drawTurned(target: HTMLCanvasElement, piece: HTMLCanvasElement, rot: number): void {
  const tx = ctx2d(target);
  tx.setTransform(1, 0, 0, 1, 0, 0);
  tx.clearRect(0, 0, target.width, target.height);
  const f = (target.width * 0.86) / Math.max(piece.width, piece.height);
  tx.translate(target.width / 2, target.height / 2);
  tx.rotate((rot * Math.PI) / 2);
  tx.imageSmoothingQuality = "high";
  tx.drawImage(piece, (-piece.width * f) / 2, (-piece.height * f) / 2, piece.width * f, piece.height * f);
}
