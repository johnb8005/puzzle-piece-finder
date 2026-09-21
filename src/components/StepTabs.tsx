import { FONT, P } from "../theme";
import type { Step } from "../types";

interface Props {
  step: Step;
  setStep: (s: Step) => void;
  hasKey: boolean;
  hasResult: boolean;
}

export function StepTabs({ step, setStep, hasKey, hasResult }: Props) {
  const tabs: { id: Step; label: string; ok: boolean }[] = [
    { id: "key", label: "1  Key", ok: true },
    { id: "piece", label: "2  Piece", ok: hasKey },
    { id: "result", label: "3  Place", ok: hasResult },
  ];
  return (
    <div className="flex gap-2" role="tablist">
      {tabs.map((t) => {
        const active = step === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            disabled={!t.ok}
            className="pf-btn"
            onClick={() => setStep(t.id)}
            style={{
              flex: 1,
              fontFamily: FONT,
              fontWeight: 700,
              fontSize: 14,
              padding: "9px 0",
              borderRadius: 999,
              whiteSpace: "pre",
              border: `1.5px solid ${active ? P.paper : P.line}`,
              background: active ? P.paper : "transparent",
              color: active ? P.ink : P.paper,
              opacity: t.ok ? 1 : 0.35,
              cursor: t.ok ? "pointer" : "default",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
