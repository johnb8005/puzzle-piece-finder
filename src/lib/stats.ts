/** Pure numeric helpers, kept DOM-free so they can be unit tested. */

export function median(values: ArrayLike<number>): number {
  const a = Float32Array.from(values).sort();
  return a[a.length >> 1] ?? 0;
}

/**
 * Otsu's threshold over a 256-bin histogram: the cut that best separates
 * the histogram into two classes with minimal within-class variance.
 */
export function otsu(hist: ArrayLike<number>, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 0;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) {
      best = v;
      thr = i;
    }
  }
  return thr;
}
