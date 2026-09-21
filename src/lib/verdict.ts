export interface Verdict {
  label: string;
  /** True when the best score is not clearly ahead of the runner-up. */
  weak: boolean;
}

/** How confident the top match is, judged by its score and its lead over the next one. */
export function verdictFor(scores: readonly number[]): Verdict | null {
  if (!scores.length) return null;
  const s1 = scores[0];
  const margin = scores.length > 1 ? s1 - scores[1] : 1;
  if (s1 > 0.55 && margin > 0.08) return { label: "Strong match", weak: false };
  if (s1 > 0.35 && margin > 0.03) return { label: "Likely match", weak: false };
  return { label: "Several spots look alike", weak: true };
}
