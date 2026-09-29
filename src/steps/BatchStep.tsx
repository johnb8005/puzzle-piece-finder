import { RotateCcw, X } from "lucide-react";
import { CropBox } from "../components/CropBox";
import { Note } from "../components/Note";
import { PhotoButtons } from "../components/PhotoButtons";
import { PieceGallery, type GalleryPiece } from "../components/PieceGallery";
import type { Grid } from "../lib/grid";
import { hint, label, lead, P, primaryBtn, quietBtn } from "../theme";
import type { Crop } from "../types";

export interface BatchProgress {
  done: number;
  total: number;
  fraction: number;
}

interface Props {
  // pieces photo
  piecesUrl: string;
  pieces: GalleryPiece[];
  excluded: ReadonlySet<number>;
  onToggle: (i: number) => void;
  cutoff: number;
  setCutoff: (v: number) => void;
  straighten: boolean;
  setStraighten: (v: boolean) => void;
  onLoadPieces: (f: File) => void;
  onRetakePieces: () => void;
  // board photo
  boardUrl: string;
  boardCrop: Crop;
  setBoardCrop: (c: Crop) => void;
  grid: Grid;
  onLoadBoard: (f: File) => void;
  onRemoveBoard: () => void;
  // run
  progress: BatchProgress | null;
  onRun: () => void;
  onCancel: () => void;
}

/** Step 2, many pieces: photograph the pieces, optionally the puzzle so far, then place them all. */
export function BatchStep(p: Props) {
  const selected = p.pieces.length - p.excluded.size;
  const section = (title: string, body: React.ReactNode) => (
    <div className="flex flex-col gap-3" style={{ borderTop: `1px solid ${P.line}`, paddingTop: 16 }}>
      <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-0.01em" }}>{title}</div>
      {body}
    </div>
  );

  return (
    <section className="flex flex-col gap-5">
      {section(
        "The pieces",
        !p.piecesUrl ? (
          <>
            <p style={lead}>
              Spread the loose pieces face up on plain paper so none touch, and photograph them from straight above. Ten to twenty at a time works well.
            </p>
            <PhotoButtons onFile={p.onLoadPieces} cameraLabel="Photograph the pieces" />
          </>
        ) : (
          <>
            {p.pieces.length === 0 ? (
              <Note>No pieces separated from the background. Move the slider below, or retake the photo on paper of a different colour.</Note>
            ) : (
              <PieceGallery photoUrl={p.piecesUrl} pieces={p.pieces} excluded={p.excluded} onToggle={p.onToggle} />
            )}
            <div>
              <div className="flex justify-between" style={{ ...label, display: "flex" }}>
                <span>Keep more</span>
                <span>Cut more away</span>
              </div>
              <input className="pf-in w-full" type="range" min={0.4} max={1.8} step={0.05} value={p.cutoff} aria-label="Background cut-off" onChange={(e) => p.setCutoff(parseFloat(e.target.value))} />
            </div>
            <label className="flex items-center gap-3" style={{ fontSize: 15 }}>
              <input className="pf-in" type="checkbox" checked={p.straighten} onChange={(e) => p.setStraighten(e.target.checked)} style={{ width: 20, height: 20, accentColor: P.mark }} />
              Straighten tilted pieces
            </label>
            <button className="pf-btn" style={quietBtn} onClick={p.onRetakePieces}>
              <RotateCcw size={18} /> Retake the pieces photo
            </button>
          </>
        ),
      )}

      {section(
        "Your puzzle so far",
        !p.boardUrl ? (
          <>
            <p style={hint}>
              Strongly recommended. Photograph the partly finished puzzle from straight above: the pieces are marked on it, and every spot that is already
              filled is ruled out, which is what makes placing many pieces reliable. Without it, only pieces with clear detail can be placed.
            </p>
            <PhotoButtons onFile={p.onLoadBoard} cameraLabel="Photograph the puzzle" />
          </>
        ) : (
          <>
            <p style={hint}>Drag the corners to where the finished puzzle's edges are, even where pieces are still missing, so the grid lines up with the key.</p>
            <CropBox url={p.boardUrl} crop={p.boardCrop} setCrop={p.setBoardCrop} cols={p.grid.cols} rows={p.grid.rows} />
            <button className="pf-btn" style={quietBtn} onClick={p.onRemoveBoard}>
              <X size={18} /> Remove the puzzle photo
            </button>
          </>
        ),
      )}

      {p.progress === null ? (
        <button className="pf-btn" style={{ ...primaryBtn, opacity: selected > 0 ? 1 : 0.4 }} disabled={selected === 0} onClick={p.onRun}>
          Place {selected > 0 ? selected : "the"} {selected === 1 ? "piece" : "pieces"}
        </button>
      ) : (
        <div className="flex flex-col gap-3" aria-live="polite">
          <div style={{ height: 14, borderRadius: 7, background: P.feltDeep, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.round(p.progress.fraction * 100)}%`, background: P.mark, transition: "width 120ms linear" }} />
          </div>
          <span style={{ fontSize: 14, color: P.dim }}>
            Piece {Math.min(p.progress.done + 1, p.progress.total)} of {p.progress.total}… {Math.round(p.progress.fraction * 100)}%
          </span>
          <button className="pf-btn" style={quietBtn} onClick={p.onCancel}>
            Stop
          </button>
        </div>
      )}
    </section>
  );
}
