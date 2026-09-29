import type { Mode } from "../lib/session";
import { FONT, P } from "../theme";

interface Props {
  mode: Mode;
  setMode: (m: Mode) => void;
}

/** One piece at a time, or many pieces from one photo. */
export function ModeToggle({ mode, setMode }: Props) {
  const opts: { id: Mode; label: string }[] = [
    { id: "single", label: "One piece" },
    { id: "batch", label: "Many pieces" },
  ];
  return (
    <div className="flex gap-2" role="radiogroup" aria-label="How many pieces">
      {opts.map((o) => {
        const active = mode === o.id;
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={active}
            className="pf-btn"
            onClick={() => setMode(o.id)}
            style={{
              flex: 1, fontFamily: FONT, fontWeight: 700, fontSize: 14, padding: "9px 0", borderRadius: 12, cursor: "pointer",
              border: `1.5px solid ${active ? P.mark : P.line}`, background: active ? "rgba(255,210,63,0.14)" : "transparent", color: P.paper,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
