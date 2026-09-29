import { Camera } from "lucide-react";
import { useEffect, useRef } from "react";
import { Note } from "../components/Note";
import type { Placement } from "../lib/batch";
import { FILLED_THRESHOLD } from "../lib/board";
import { clamp } from "../lib/canvas";
import { drawTurned, drawZoom } from "../lib/draw";
import { cellOf, type Grid } from "../lib/grid";
import { verdictFor } from "../lib/verdict";
import { caption, FONT, hint, P, primaryBtn, quietBtn } from "../theme";

interface Props {
  placements: Placement[];
  pieces: { canvas: HTMLCanvasElement; thumbUrl: string }[];
  grid: Grid;
  keyUrl: string;
  keyCanvas: HTMLCanvasElement;
  /** Cropped photo of the puzzle so far, when one was given. */
  boardUrl: string;
  sel: number;
  setSel: (i: number) => void;
  onMore: () => void;
  onAdjust: () => void;
}

/** Step 3, many pieces: every piece marked on the puzzle, with details for the selected one. */
export function BatchResultStep({ placements, pieces, grid, keyUrl, keyCanvas, boardUrl, sel, setSel, onMore, onAdjust }: Props) {
  const zoomRef = useRef<HTMLCanvasElement>(null);
  const turnRef = useRef<HTMLCanvasElement>(null);
  const current = placements[sel] ?? placements[0];
  const match = current && current.chosen >= 0 ? current.options[current.chosen] : null;
  const piece = current ? pieces[current.index] : null;

  useEffect(() => {
    if (zoomRef.current && match) drawZoom(zoomRef.current, keyCanvas, grid, match);
    if (turnRef.current && piece) drawTurned(turnRef.current, piece.canvas, match?.rot ?? 0);
  }, [match, piece, grid, keyCanvas]);

  const placed = placements.filter((p) => p.chosen >= 0).length;
  const verdict = current ? verdictFor(current.options.map((o) => o.score)) : null;
  const cell = match ? cellOf(match.u, match.v, grid) : null;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
          {placed} of {placements.length} pieces placed
        </div>
        <p style={{ ...hint, fontSize: 15, margin: "6px 0 0" }}>
          Numbers match the pieces photo. Tap a number on the {boardUrl ? "puzzle" : "key"} or in the list below to see where it goes.
        </p>
      </div>

      <div className="relative overflow-hidden" style={{ borderRadius: 12 }}>
        <img src={boardUrl || keyUrl} alt={boardUrl ? "Your puzzle so far with the pieces marked" : "The puzzle key with the pieces marked"} className="block w-full" />
        {placements.map((p, i) => {
          if (p.chosen < 0) return null;
          const m = p.options[p.chosen];
          const active = i === sel;
          return (
            <button
              key={p.index}
              className={`pf-btn absolute${active ? " pf-ring" : ""}`}
              onClick={() => setSel(i)}
              aria-label={`Piece ${p.index + 1}`}
              aria-pressed={active}
              style={{
                left: `calc(${m.u * 100}% - 14px)`, top: `calc(${m.v * 100}% - 14px)`, width: 28, height: 28, borderRadius: 14,
                background: active ? P.mark : P.ink, color: active ? P.ink : P.paper, border: `2px solid ${active ? P.ink : P.paper}`,
                fontFamily: FONT, fontWeight: 800, fontSize: 13, cursor: "pointer", padding: 0, zIndex: active ? 2 : 1,
              }}
            >
              {p.index + 1}
            </button>
          );
        })}
      </div>

      {current && (
        <div className="flex flex-col gap-3" style={{ background: P.feltDeep, borderRadius: 14, padding: 12 }}>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
            Piece {current.index + 1}: {cell ? `row ${cell.row}, column ${cell.col}` : "no spot found"}
          </div>
          {match ? (
            <>
              <div className="flex gap-3">
                <figure style={{ flex: 3, margin: 0 }}>
                  <canvas ref={zoomRef} width={420} height={420} className="block w-full" style={{ borderRadius: 12 }} />
                  <figcaption style={caption}>Close-up on the key</figcaption>
                </figure>
                <figure style={{ flex: 2, margin: 0 }}>
                  <canvas ref={turnRef} width={240} height={240} className="block w-full" style={{ borderRadius: 12, background: P.felt }} />
                  <figcaption style={caption}>Turn it to sit like this</figcaption>
                </figure>
              </div>
              {verdict?.weak ? (
                <Note>{verdict.label}. This piece could belong in more than one spot; check it against the close-up.</Note>
              ) : (
                <div style={{ fontSize: 15, fontWeight: 700, color: P.mark }}>{verdict?.label}</div>
              )}
              {current.filled !== null && current.filled > FILLED_THRESHOLD && (
                <Note>That spot already looks filled on your puzzle photo. Either it is a duplicate, or the crop is off.</Note>
              )}
            </>
          ) : (
            <p style={hint}>
              {current.options.length ? "Every likely spot was claimed by a more confident piece." : "Nothing on the key resembled this cut-out."}
            </p>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {placements.map((p, i) => {
          const m = p.chosen >= 0 ? p.options[p.chosen] : null;
          const c = m ? cellOf(m.u, m.v, grid) : null;
          const active = i === sel;
          return (
            <li key={p.index}>
              <button
                className="pf-btn flex items-center gap-3"
                onClick={() => setSel(i)}
                aria-pressed={active}
                style={{
                  ...quietBtn, justifyContent: "flex-start", padding: 8, textAlign: "left",
                  background: active ? P.paper : "transparent", color: active ? P.ink : P.paper, borderColor: active ? P.paper : P.line,
                }}
              >
                <span style={{ width: 44, height: 44, borderRadius: 8, background: P.feltDeep, flexShrink: 0, overflow: "hidden" }}>
                  <img src={pieces[p.index]?.thumbUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                </span>
                <span style={{ fontWeight: 800, width: 28, flexShrink: 0 }}>{p.index + 1}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {c ? (
                    <>
                      <span style={{ display: "block", fontWeight: 700 }}>Row {c.row}, column {c.col}</span>
                      <span style={{ display: "block", fontSize: 12, opacity: 0.75, fontWeight: 500 }}>
                        {Math.round(clamp(m!.score, 0, 1) * 100)}% alike{m!.rot ? ` · turn ${m!.rot === 2 ? "half" : m!.rot === 1 ? "¼ right" : "¼ left"}` : ""}
                      </span>
                    </>
                  ) : (
                    <span style={{ display: "block", fontWeight: 500, opacity: 0.75 }}>Not placed</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <button className="pf-btn" style={primaryBtn} onClick={onMore}>
        <Camera size={20} /> Photograph more pieces
      </button>
      <button className="pf-btn" style={quietBtn} onClick={onAdjust}>
        Adjust the cut-outs
      </button>
    </section>
  );
}
