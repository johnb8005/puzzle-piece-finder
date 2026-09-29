import type { Box } from "../lib/segment";
import { caption, FONT, P } from "../theme";

export interface GalleryPiece {
  box: Box;
  thumbUrl: string;
}

interface Props {
  photoUrl: string;
  pieces: GalleryPiece[];
  excluded: ReadonlySet<number>;
  onToggle: (index: number) => void;
}

/** The pieces photo with every cut-out numbered, plus a strip to untick any that are not pieces. */
export function PieceGallery({ photoUrl, pieces, excluded, onToggle }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden" style={{ borderRadius: 12 }}>
        <img src={photoUrl} alt="Your photo of the pieces" className="block w-full" />
        {pieces.map((p, i) => {
          const off = excluded.has(i);
          return (
            <button
              key={i}
              className="pf-btn absolute"
              onClick={() => onToggle(i)}
              aria-label={`Piece ${i + 1}${off ? ", ignored" : ""}`}
              aria-pressed={!off}
              style={{
                left: `${p.box.x * 100}%`, top: `${p.box.y * 100}%`, width: `${p.box.w * 100}%`, height: `${p.box.h * 100}%`,
                border: `2px solid ${off ? "rgba(243,245,241,0.35)" : P.mark}`, borderRadius: 6, background: off ? "rgba(10,20,17,0.55)" : "transparent",
                padding: 0, cursor: "pointer",
              }}
            >
              <span
                style={{
                  position: "absolute", left: -2, top: -2, minWidth: 22, height: 22, padding: "0 6px", borderRadius: 11, fontFamily: FONT, fontWeight: 800, fontSize: 12,
                  background: off ? P.chip : P.mark, color: P.ink, display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                {i + 1}
              </span>
            </button>
          );
        })}
      </div>
      <div>
        <div className="flex gap-2" style={{ overflowX: "auto", paddingBottom: 4 }}>
          {pieces.map((p, i) => {
            const off = excluded.has(i);
            return (
              <button
                key={i}
                className="pf-btn"
                onClick={() => onToggle(i)}
                aria-label={`${off ? "Include" : "Ignore"} piece ${i + 1}`}
                style={{
                  flexShrink: 0, width: 64, height: 64, borderRadius: 10, padding: 4, cursor: "pointer", position: "relative",
                  background: P.feltDeep, border: `1.5px solid ${off ? P.line : P.mark}`, opacity: off ? 0.45 : 1,
                }}
              >
                <img src={p.thumbUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                <span style={{ position: "absolute", left: 2, top: 2, fontFamily: FONT, fontWeight: 800, fontSize: 11, color: P.ink, background: off ? P.chip : P.mark, borderRadius: 8, padding: "0 5px" }}>
                  {i + 1}
                </span>
              </button>
            );
          })}
        </div>
        <div style={caption}>
          {pieces.length} {pieces.length === 1 ? "piece" : "pieces"} found. Tap one to leave it out.
        </div>
      </div>
    </div>
  );
}
