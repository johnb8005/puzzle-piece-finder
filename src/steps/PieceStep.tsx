import { RotateCcw } from "lucide-react";
import { Note } from "../components/Note";
import { PhotoButtons } from "../components/PhotoButtons";
import { caption, hint, label, lead, P, primaryBtn, quietBtn } from "../theme";

interface Props {
  pieceUrl: string;
  cutUrl: string;
  cutProblem: boolean;
  cutoff: number;
  setCutoff: (v: number) => void;
  straighten: boolean;
  setStraighten: (v: boolean) => void;
  /** 0..1 while a search is running, null when idle. */
  progress: number | null;
  onLoad: (file: File) => void;
  onRun: () => void;
  onCancel: () => void;
  onRetake: () => void;
}

/** Step 2: photograph a piece, check the cut-out and start the search. */
export function PieceStep(p: Props) {
  if (!p.pieceUrl) {
    return (
      <section className="flex flex-col gap-4">
        <p style={lead}>
          Lay one piece face up on a plain surface that contrasts with it — a sheet of paper works. Fill most of the frame with the piece and keep its sides roughly square to the photo.
        </p>
        <PhotoButtons onFile={p.onLoad} cameraLabel="Photograph a piece" />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex gap-3">
        <figure style={{ flex: 1, margin: 0 }}>
          <img src={p.pieceUrl} alt="Your photo of the piece" className="block w-full" style={{ borderRadius: 12, aspectRatio: "1", objectFit: "cover" }} />
          <figcaption style={caption}>Your photo</figcaption>
        </figure>
        <figure style={{ flex: 1, margin: 0 }}>
          <div className="flex items-center justify-center" style={{ borderRadius: 12, aspectRatio: "1", background: P.feltDeep, border: `1.5px dashed ${P.line}` }}>
            {p.cutUrl && <img src={p.cutUrl} alt="The piece cut out from its background" style={{ maxWidth: "82%", maxHeight: "82%" }} />}
          </div>
          <figcaption style={caption}>What gets matched</figcaption>
        </figure>
      </div>

      {p.cutProblem ? (
        <Note>The piece didn't separate cleanly from the background. Move the slider below, or retake it on a plain surface of a different colour.</Note>
      ) : (
        <p style={hint}>The cut-out should show the whole piece and nothing else. Adjust the slider if background is left on or parts of the piece are missing.</p>
      )}

      <div>
        <div className="flex justify-between" style={label}>
          <span>Keep more</span>
          <span>Cut more away</span>
        </div>
        <input
          className="pf-in w-full"
          type="range"
          min={0.4}
          max={1.8}
          step={0.05}
          value={p.cutoff}
          aria-label="Background cut-off"
          onChange={(e) => p.setCutoff(parseFloat(e.target.value))}
        />
      </div>
      <label className="flex items-center gap-3" style={{ fontSize: 15 }}>
        <input
          className="pf-in"
          type="checkbox"
          checked={p.straighten}
          onChange={(e) => p.setStraighten(e.target.checked)}
          style={{ width: 20, height: 20, accentColor: P.mark }}
        />
        Straighten a tilted piece
      </label>

      {p.progress === null ? (
        <button className="pf-btn" style={{ ...primaryBtn, opacity: p.cutUrl ? 1 : 0.4 }} disabled={!p.cutUrl} onClick={p.onRun}>
          Find where it goes
        </button>
      ) : (
        <div className="flex flex-col gap-3" aria-live="polite">
          <div style={{ height: 14, borderRadius: 7, background: P.feltDeep, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.round(p.progress * 100)}%`, background: P.mark, transition: "width 120ms linear" }} />
          </div>
          <span style={{ fontSize: 14, color: P.dim }}>Checking every spot on the key, in all four turns… {Math.round(p.progress * 100)}%</span>
          <button className="pf-btn" style={quietBtn} onClick={p.onCancel}>
            Stop
          </button>
        </div>
      )}
      <button className="pf-btn" style={quietBtn} onClick={p.onRetake}>
        <RotateCcw size={18} /> Retake the piece photo
      </button>
    </section>
  );
}
