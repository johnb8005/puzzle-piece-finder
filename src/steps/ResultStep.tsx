import { Camera } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Note } from "../components/Note";
import { clamp } from "../lib/canvas";
import { drawTurned, drawZoom } from "../lib/draw";
import { cellOf, type Grid } from "../lib/grid";
import type { Match } from "../lib/match";
import { verdictFor } from "../lib/verdict";
import { caption, FONT, hint, P, primaryBtn, quietBtn } from "../theme";

interface Props {
  results: Match[];
  sel: number;
  setSel: (i: number) => void;
  grid: Grid;
  keyUrl: string;
  keyCanvas: HTMLCanvasElement;
  pieceCut: HTMLCanvasElement | null;
  onAnother: () => void;
  onAdjust: () => void;
}

/** Step 3: show where the piece goes, how to turn it, and the runner-up spots. */
export function ResultStep({ results, sel, setSel, grid, keyUrl, keyCanvas, pieceCut, onAnother, onAdjust }: Props) {
  const cur = results[sel];
  const zoomRef = useRef<HTMLCanvasElement>(null);
  const turnRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (zoomRef.current) drawZoom(zoomRef.current, keyCanvas, grid, cur);
    if (turnRef.current && pieceCut) drawTurned(turnRef.current, pieceCut, cur.rot);
  }, [cur, grid, keyCanvas, pieceCut]);

  const verdict = useMemo(() => verdictFor(results.map((r) => r.score)), [results]);
  const { row, col } = cellOf(cur.u, cur.v, grid);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
          Row {row}, column {col}
        </div>
        <p style={{ ...hint, fontSize: 15, margin: "6px 0 0" }}>
          {row} down from the top edge and {col} in from the left, on a grid {grid.cols} across by {grid.rows} down.
        </p>
      </div>

      <div className="relative overflow-hidden" style={{ borderRadius: 12 }}>
        <img src={keyUrl} alt="The puzzle key with the piece's position marked" className="block w-full" />
        <div className="absolute" style={{ left: 0, right: 0, top: `${cur.v * 100}%`, height: 0, borderTop: `1.5px solid ${P.mark}`, opacity: 0.85 }} />
        <div className="absolute" style={{ top: 0, bottom: 0, left: `${cur.u * 100}%`, width: 0, borderLeft: `1.5px solid ${P.mark}`, opacity: 0.85 }} />
        <div
          key={sel}
          className="absolute pf-ring"
          style={{
            left: `${(cur.u - 0.5 / grid.cols) * 100}%`,
            top: `${(cur.v - 0.5 / grid.rows) * 100}%`,
            width: `${100 / grid.cols}%`,
            height: `${100 / grid.rows}%`,
            minWidth: 10,
            minHeight: 10,
            border: `2.5px solid ${P.mark}`,
            outline: `2px solid ${P.ink}`,
            borderRadius: 3,
          }}
        />
        {results.map(
          (r, i) =>
            i !== sel && (
              <button
                key={i}
                className="pf-btn absolute"
                onClick={() => setSel(i)}
                aria-label={`Show option ${i + 1}`}
                style={{
                  left: `calc(${r.u * 100}% - 13px)`,
                  top: `calc(${r.v * 100}% - 13px)`,
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  background: P.ink,
                  color: P.paper,
                  border: `2px solid ${P.paper}`,
                  fontFamily: FONT,
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {i + 1}
              </button>
            ),
        )}
      </div>

      <div className="flex gap-3">
        <figure style={{ flex: 3, margin: 0 }}>
          <canvas ref={zoomRef} width={420} height={420} className="block w-full" style={{ borderRadius: 12 }} />
          <figcaption style={caption}>Close-up of the spot</figcaption>
        </figure>
        <figure style={{ flex: 2, margin: 0 }}>
          <canvas ref={turnRef} width={240} height={240} className="block w-full" style={{ borderRadius: 12, background: P.feltDeep }} />
          <figcaption style={caption}>Turn the piece to sit like this</figcaption>
        </figure>
      </div>

      {verdict &&
        (verdict.weak ? (
          <Note>{verdict.label}. Pieces of sky, water or other flat colour match many places — compare the numbered options below against your piece.</Note>
        ) : (
          <div style={{ fontSize: 15, fontWeight: 700, color: P.mark }}>{verdict.label}</div>
        ))}

      {results.length > 1 && (
        <div className="flex gap-2">
          {results.map((r, i) => (
            <button
              key={i}
              className="pf-btn"
              onClick={() => setSel(i)}
              style={{
                ...quietBtn,
                flexDirection: "column",
                gap: 2,
                padding: "10px 6px",
                fontSize: 14,
                background: i === sel ? P.paper : "transparent",
                color: i === sel ? P.ink : P.paper,
              }}
            >
              <span>Option {i + 1}</span>
              <span style={{ fontWeight: 500, fontSize: 12, opacity: 0.75 }}>{Math.round(clamp(r.score, 0, 1) * 100)}% alike</span>
            </button>
          ))}
        </div>
      )}

      <button className="pf-btn" style={primaryBtn} onClick={onAnother}>
        <Camera size={20} /> Photograph another piece
      </button>
      <button className="pf-btn" style={quietBtn} onClick={onAdjust}>
        Adjust this piece's cut-out
      </button>
    </section>
  );
}
