import { Check, RotateCcw } from "lucide-react";
import { CropBox } from "../components/CropBox";
import { PhotoButtons } from "../components/PhotoButtons";
import { clamp } from "../lib/canvas";
import type { Grid } from "../lib/grid";
import { hint, label, lead, numInput, P, primaryBtn, quietBtn } from "../theme";
import type { Crop } from "../types";

const PRESETS = [100, 300, 500, 1000];

interface Props {
  rawKeyUrl: string;
  hasSavedKey: boolean;
  crop: Crop;
  setCrop: (c: Crop) => void;
  /** The grid currently shown: manual override if set, otherwise derived from the count. */
  draft: Grid;
  count: number;
  setCount: (n: number) => void;
  manual: Grid | null;
  setManual: (g: Grid | null) => void;
  onLoad: (file: File) => void;
  onSave: () => void;
  onRetake: () => void;
  onKeepCurrent: () => void;
}

/** Step 1: photograph the box art, crop it and set the piece grid. */
export function KeyStep(p: Props) {
  if (!p.rawKeyUrl) {
    return (
      <section className="flex flex-col gap-4">
        <p style={lead}>
          Photograph the finished picture from the box lid or poster. Hold the phone flat above it so the picture isn't skewed, and avoid glare.
        </p>
        <PhotoButtons onFile={p.onLoad} cameraLabel="Photograph the key" />
        {p.hasSavedKey && (
          <button className="pf-btn" style={quietBtn} onClick={p.onKeepCurrent}>
            Keep the current key
          </button>
        )}
      </section>
    );
  }

  const { draft, count, manual } = p;
  return (
    <section className="flex flex-col gap-4">
      <p style={{ ...lead, fontSize: 15 }}>
        Drag the yellow corners until the frame hugs the puzzle picture exactly. Leave out the box border and any logos around it.
      </p>
      <CropBox url={p.rawKeyUrl} crop={p.crop} setCrop={p.setCrop} cols={draft.cols} rows={draft.rows} />

      <div>
        <span style={label}>Pieces in this puzzle</span>
        <div className="flex gap-2 flex-wrap">
          {PRESETS.map((n) => {
            const active = count === n && !manual;
            return (
              <button
                key={n}
                className="pf-btn"
                onClick={() => { p.setCount(n); p.setManual(null); }}
                style={{
                  ...quietBtn,
                  width: "auto",
                  padding: "9px 14px",
                  fontSize: 14,
                  borderRadius: 999,
                  background: active ? P.paper : "transparent",
                  color: active ? P.ink : P.paper,
                }}
              >
                {n}
              </button>
            );
          })}
          <input
            className="pf-in"
            type="number"
            inputMode="numeric"
            min={4}
            max={10000}
            value={count || ""}
            aria-label="Piece count"
            onChange={(e) => { p.setCount(parseInt(e.target.value, 10) || 0); p.setManual(null); }}
            style={{ ...numInput, width: 96, padding: "8px 12px" }}
          />
        </div>
      </div>

      <div className="flex gap-3">
        <div style={{ flex: 1 }}>
          <span style={label}>Pieces across</span>
          <input
            className="pf-in"
            type="number"
            inputMode="numeric"
            min={2}
            max={200}
            value={draft.cols}
            style={numInput}
            onChange={(e) => p.setManual({ cols: clamp(parseInt(e.target.value, 10) || 2, 2, 200), rows: draft.rows })}
          />
        </div>
        <div style={{ flex: 1 }}>
          <span style={label}>Pieces down</span>
          <input
            className="pf-in"
            type="number"
            inputMode="numeric"
            min={2}
            max={200}
            value={draft.rows}
            style={numInput}
            onChange={(e) => p.setManual({ cols: draft.cols, rows: clamp(parseInt(e.target.value, 10) || 2, 2, 200) })}
          />
        </div>
      </div>
      <p style={{ ...hint, fontSize: 13 }}>
        Across and down are worked out from the piece count. If your box lists them, or you've counted an edge, type the real numbers — it sets how big one piece is on the key.
      </p>

      <button className="pf-btn" style={primaryBtn} onClick={p.onSave}>
        <Check size={20} /> Save key
      </button>
      <button className="pf-btn" style={quietBtn} onClick={p.onRetake}>
        <RotateCcw size={18} /> Retake the key photo
      </button>
    </section>
  );
}
