import { Plus, Trash2 } from "lucide-react";
import { describeSession, type SessionRecord } from "../lib/session";
import { FONT, hint, lead, P, primaryBtn, quietBtn } from "../theme";

interface Props {
  sessions: SessionRecord[];
  currentId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}

/** Saved puzzles, kept in this browser. */
export function Library({ sessions, currentId, onOpen, onDelete, onNew, onClose }: Props) {
  return (
    <section className="flex flex-col gap-4" aria-label="Saved puzzles">
      <p style={lead}>
        Puzzles are saved in this browser as you go, so closing the window loses nothing. Open one to carry on, or start a new one.
      </p>
      <button className="pf-btn" style={primaryBtn} onClick={onNew}>
        <Plus size={20} /> Start a new puzzle
      </button>
      {sessions.length === 0 ? (
        <p style={hint}>No saved puzzles yet.</p>
      ) : (
        <ul className="flex flex-col gap-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {sessions.map((s) => {
            const current = s.id === currentId;
            return (
              <li
                key={s.id}
                className="flex items-center gap-3"
                style={{ background: P.feltDeep, border: `1.5px solid ${current ? P.mark : P.line}`, borderRadius: 14, padding: 10 }}
              >
                <button
                  className="pf-btn flex items-center gap-3"
                  onClick={() => onOpen(s.id)}
                  aria-label={`Open puzzle, ${describeSession(s)}`}
                  style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", color: P.paper, padding: 0, cursor: "pointer", textAlign: "left", fontFamily: FONT }}
                >
                  <span
                    aria-hidden
                    style={{ width: 64, height: 48, borderRadius: 8, background: P.felt, flexShrink: 0, overflow: "hidden", display: "block" }}
                  >
                    {s.thumb && <img src={s.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: 15 }}>{current ? "Current puzzle" : "Puzzle"}</span>
                    <span style={{ display: "block", fontSize: 13, color: P.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {describeSession(s)}
                    </span>
                  </span>
                </button>
                <button
                  className="pf-btn"
                  onClick={() => onDelete(s.id)}
                  aria-label="Delete this puzzle"
                  style={{ background: "transparent", border: `1.5px solid ${P.line}`, color: P.paper, borderRadius: 10, padding: 8, cursor: "pointer", flexShrink: 0 }}
                >
                  <Trash2 size={18} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button className="pf-btn" style={quietBtn} onClick={onClose}>
        Back
      </button>
    </section>
  );
}
