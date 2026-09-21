import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { P } from "../theme";

/** A soft yellow callout for warnings and errors. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex gap-3"
      role="status"
      style={{ background: "rgba(255,210,63,0.12)", border: "1px solid rgba(255,210,63,0.5)", borderRadius: 12, padding: 12, fontSize: 14, lineHeight: 1.45 }}
    >
      <AlertTriangle size={18} color={P.mark} style={{ flexShrink: 0, marginTop: 2 }} />
      <div>{children}</div>
    </div>
  );
}
