/** Small canvas helpers shared by segmentation, matching and the UI. */

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Yield to the event loop so the UI can repaint during long loops. */
export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw to a canvas.");
  return ctx;
}

/** Downscale in halving steps so small templates are averaged, not aliased. */
export function resizeCanvas(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  let cur = src;
  while (cur.width / 2 > w && cur.height / 2 > h) {
    const next = makeCanvas(cur.width / 2, cur.height / 2);
    const nx = ctx2d(next);
    nx.imageSmoothingQuality = "high";
    nx.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  const out = makeCanvas(w, h);
  const ox = ctx2d(out);
  ox.imageSmoothingQuality = "high";
  ox.drawImage(cur, 0, 0, w, h);
  return out;
}

/** Decode a photo (File or stored Blob) into a canvas no larger than `maxSide` on its long edge. */
export async function fileToCanvas(file: Blob, maxSide: number): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file could not be read as a photo. Try another one."));
      i.src = url;
    });
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = makeCanvas(img.naturalWidth * s, img.naturalHeight * s);
    ctx2d(c).drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Encode a canvas as a Blob for storage. */
export function canvasToBlob(c: HTMLCanvasElement, type = "image/jpeg", quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the image."))), type, quality);
  });
}

/** A small JPEG data URL of a canvas, for thumbnails. */
export function thumbnail(c: HTMLCanvasElement, maxSide = 160): string {
  const s = Math.min(1, maxSide / Math.max(c.width, c.height));
  return resizeCanvas(c, c.width * s, c.height * s).toDataURL("image/jpeg", 0.7);
}
