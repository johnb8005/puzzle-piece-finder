import type { CSSProperties } from "react";

/** Palette: puzzle-mat felt, chipboard grey-blue, highlighter yellow. */
export const P = {
  felt: "#1F3B33",
  feltDeep: "#162B25",
  chip: "#8FA3A8",
  paper: "#F3F5F1",
  ink: "#12211D",
  mark: "#FFD23F",
  line: "rgba(243,245,241,0.18)",
  dim: "rgba(243,245,241,0.68)",
} as const;

export const FONT = '"Avenir Next", "Nunito Sans", "Segoe UI", system-ui, -apple-system, sans-serif';

const btnBase: CSSProperties = {
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: 16,
  borderRadius: 14,
  padding: "14px 18px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  cursor: "pointer",
  width: "100%",
};

export const primaryBtn: CSSProperties = { ...btnBase, background: P.mark, color: P.ink, border: "none" };
export const quietBtn: CSSProperties = { ...btnBase, background: "transparent", color: P.paper, border: `1.5px solid ${P.line}` };

export const numInput: CSSProperties = {
  fontFamily: FONT,
  fontSize: 16,
  fontWeight: 700,
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: `1.5px solid ${P.line}`,
  background: P.feltDeep,
  color: P.paper,
};

export const label: CSSProperties = { fontSize: 13, color: P.dim, marginBottom: 6, display: "block" };

export const caption: CSSProperties = { ...label, marginTop: 6, marginBottom: 0 };

export const lead: CSSProperties = { fontSize: 16, lineHeight: 1.5, margin: 0, color: P.dim };
export const hint: CSSProperties = { fontSize: 14, lineHeight: 1.45, margin: 0, color: P.dim };
