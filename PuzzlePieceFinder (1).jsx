import { useState, useRef, useEffect, useMemo } from "react";
import { Camera, ImagePlus, RotateCcw, Check, AlertTriangle } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Palette: puzzle-mat felt, chipboard grey-blue, highlighter yellow  */
/* ------------------------------------------------------------------ */
const P = {
  felt: "#1F3B33",
  feltDeep: "#162B25",
  chip: "#8FA3A8",
  paper: "#F3F5F1",
  ink: "#12211D",
  mark: "#FFD23F",
  line: "rgba(243,245,241,0.18)",
  dim: "rgba(243,245,241,0.68)",
};
const FONT = '"Avenir Next", "Nunito Sans", "Segoe UI", system-ui, -apple-system, sans-serif';

/* ------------------------------------------------------------------ */
/*  Canvas helpers                                                     */
/* ------------------------------------------------------------------ */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const tick = () => new Promise((r) => setTimeout(r, 0));

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// Downscale in halving steps so small templates are averaged, not aliased.
function resizeCanvas(src, w, h) {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  let cur = src;
  while (cur.width / 2 > w && cur.height / 2 > h) {
    const n = makeCanvas(cur.width / 2, cur.height / 2);
    const nx = n.getContext("2d");
    nx.imageSmoothingQuality = "high";
    nx.drawImage(cur, 0, 0, n.width, n.height);
    cur = n;
  }
  const out = makeCanvas(w, h);
  const ox = out.getContext("2d");
  ox.imageSmoothingQuality = "high";
  ox.drawImage(cur, 0, 0, w, h);
  return out;
}

async function fileToCanvas(file, maxSide) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("That file could not be read as a photo. Try another one."));
      i.src = url;
    });
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = makeCanvas(img.naturalWidth * s, img.naturalHeight * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ------------------------------------------------------------------ */
/*  Piece segmentation: cut the piece away from a plain background     */
/* ------------------------------------------------------------------ */
function median(arr) {
  const a = Float32Array.from(arr).sort();
  return a[a.length >> 1] || 0;
}

function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 0;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = i; }
  }
  return thr;
}

function segmentPiece(src, cutoff, straighten) {
  const s = Math.min(1, 360 / Math.max(src.width, src.height));
  const small = resizeCanvas(src, src.width * s, src.height * s);
  const W = small.width, H = small.height, N = W * H;
  const ctx = small.getContext("2d");
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;

  // Background colour = median of the photo's outer frame.
  const m = Math.max(2, Math.round(Math.min(W, H) * 0.04));
  const br = [], bg = [], bb = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (x < m || y < m || x >= W - m || y >= H - m) {
        const i = (y * W + x) * 4;
        br.push(d[i]); bg.push(d[i + 1]); bb.push(d[i + 2]);
      }
  const mr = median(br), mg = median(bg), mb = median(bb);

  const dist = new Float32Array(N);
  const hist = new Uint32Array(256);
  for (let i = 0; i < N; i++) {
    const dr = d[i * 4] - mr, dg = d[i * 4 + 1] - mg, db = d[i * 4 + 2] - mb;
    const v = Math.min(255, Math.sqrt(dr * dr + dg * dg + db * db));
    dist[i] = v;
    hist[v | 0]++;
  }
  const thr = Math.max(12, otsu(hist, N) * cutoff);

  // Largest connected blob of non-background pixels.
  const label = new Int32Array(N);
  const stack = new Int32Array(N);
  let bestLabel = 0, bestSize = 0, next = 0;
  for (let i0 = 0; i0 < N; i0++) {
    if (label[i0] || dist[i0] <= thr) continue;
    next++;
    let sp = 0, size = 0;
    stack[sp++] = i0; label[i0] = next;
    while (sp) {
      const i = stack[--sp]; size++;
      const x = i % W;
      if (x > 0 && !label[i - 1] && dist[i - 1] > thr) { label[i - 1] = next; stack[sp++] = i - 1; }
      if (x < W - 1 && !label[i + 1] && dist[i + 1] > thr) { label[i + 1] = next; stack[sp++] = i + 1; }
      if (i >= W && !label[i - W] && dist[i - W] > thr) { label[i - W] = next; stack[sp++] = i - W; }
      if (i < N - W && !label[i + W] && dist[i + W] > thr) { label[i + W] = next; stack[sp++] = i + W; }
    }
    if (size > bestSize) { bestSize = size; bestLabel = next; }
  }
  if (!bestSize) return { canvas: null, areaFrac: 0 };

  // Fill holes: anything the outside can't reach belongs to the piece.
  const outside = new Uint8Array(N);
  let sp = 0;
  const pushOut = (i) => { if (!outside[i] && label[i] !== bestLabel) { outside[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < W; x++) { pushOut(x); pushOut(N - W + x); }
  for (let y = 0; y < H; y++) { pushOut(y * W); pushOut(y * W + W - 1); }
  while (sp) {
    const i = stack[--sp];
    const x = i % W;
    if (x > 0) pushOut(i - 1);
    if (x < W - 1) pushOut(i + 1);
    if (i >= W) pushOut(i - W);
    if (i < N - W) pushOut(i + W);
  }
  let mask = new Uint8Array(N);
  let x0 = W, y0 = H, x1 = 0, y1 = 0, count = 0;
  for (let i = 0; i < N; i++)
    if (!outside[i]) {
      mask[i] = 1; count++;
      const x = i % W, y = (i / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }

  // Shave the rim: bevels and shadows there never match the box art.
  const rounds = Math.max(1, Math.round(Math.max(x1 - x0, y1 - y0) * 0.025));
  for (let r = 0; r < rounds; r++) {
    const nm = new Uint8Array(N);
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        nm[i] = mask[i] & mask[i - 1] & mask[i + 1] & mask[i - W] & mask[i + W];
      }
    mask = nm;
  }

  // Straighten: the straight sides dominate the outline's edge directions,
  // while round tabs spread evenly, so the peak (mod 90 degrees) is the tilt.
  let theta = 0;
  if (straighten) {
    let soft = Float32Array.from(mask);
    for (let pass = 0; pass < 2; pass++) {
      const nb = new Float32Array(N);
      for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          nb[i] = (soft[i - W - 1] + soft[i - W] + soft[i - W + 1] + soft[i - 1] + soft[i] + soft[i + 1] + soft[i + W - 1] + soft[i + W] + soft[i + W + 1]) / 9;
        }
      soft = nb;
    }
    const bins = new Float32Array(90);
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const gx = soft[i - W + 1] + 2 * soft[i + 1] + soft[i + W + 1] - soft[i - W - 1] - 2 * soft[i - 1] - soft[i + W - 1];
        const gy = soft[i + W - 1] + 2 * soft[i + W] + soft[i + W + 1] - soft[i - W - 1] - 2 * soft[i - W] - soft[i - W + 1];
        const mag = Math.hypot(gx, gy);
        if (mag < 0.5) continue;
        let a = (Math.atan2(gy, gx) * 180) / Math.PI;
        a = ((a % 90) + 90) % 90;
        const lo = Math.floor(a), fr = a - lo;
        bins[lo % 90] += mag * (1 - fr);
        bins[(lo + 1) % 90] += mag * fr;
      }
    let bestBin = 0, bestVal = -1;
    for (let k = 0; k < 90; k++) {
      let v = 0;
      for (let j = -3; j <= 3; j++) v += bins[(k + j + 90) % 90] * (4 - Math.abs(j));
      if (v > bestVal) { bestVal = v; bestBin = k; }
    }
    let num = 0, den = 0;
    for (let j = -4; j <= 4; j++) { const w = bins[(bestBin + j + 90) % 90]; num += w * j; den += w; }
    theta = bestBin + (den ? num / den : 0);
    if (theta > 45) theta -= 90;
  }

  // Cut-out with alpha, cropped, straightened, then trimmed tight.
  for (let i = 0; i < N; i++) d[i * 4 + 3] = mask[i] ? 255 : 0;
  ctx.putImageData(img, 0, 0);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const D = Math.ceil(Math.hypot(bw, bh)) + 2;
  const rot = makeCanvas(D, D);
  const rx = rot.getContext("2d");
  rx.imageSmoothingQuality = "high";
  rx.translate(D / 2, D / 2);
  rx.rotate((-theta * Math.PI) / 180);
  rx.drawImage(small, x0, y0, bw, bh, -bw / 2, -bh / 2, bw, bh);
  const rd = rot.getContext("2d").getImageData(0, 0, D, D).data;
  let tx0 = D, ty0 = D, tx1 = 0, ty1 = 0;
  for (let y = 0; y < D; y++)
    for (let x = 0; x < D; x++)
      if (rd[(y * D + x) * 4 + 3] > 128) {
        if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y;
      }
  if (tx1 <= tx0 || ty1 <= ty0) return { canvas: null, areaFrac: 0 };
  const out = makeCanvas(tx1 - tx0 + 1, ty1 - ty0 + 1);
  out.getContext("2d").drawImage(rot, -tx0, -ty0);
  return { canvas: out, areaFrac: count / N };
}

/* ------------------------------------------------------------------ */
/*  Matching: masked, lighting-tolerant template search                */
/* ------------------------------------------------------------------ */
function keyChannels(canvas, W, H) {
  const c = resizeCanvas(canvas, W, H);
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  const n = c.width * c.height;
  const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { r[i] = d[i * 4]; g[i] = d[i * 4 + 1]; b[i] = d[i * 4 + 2]; }
  return { W: c.width, H: c.height, r, g, b };
}

function buildTemplate(piece, rot, longSide, keyW) {
  const f = longSide / Math.max(piece.width, piece.height);
  const tw = Math.max(3, Math.round(piece.width * f));
  const th = Math.max(3, Math.round(piece.height * f));
  const scaled = resizeCanvas(piece, tw, th);
  const swap = rot % 2 === 1;
  const cw = swap ? th : tw, ch = swap ? tw : th;
  const c = makeCanvas(cw, ch);
  const cx = c.getContext("2d");
  cx.translate(cw / 2, ch / 2);
  cx.rotate((rot * Math.PI) / 2);
  cx.drawImage(scaled, -tw / 2, -th / 2);
  const d = cx.getImageData(0, 0, cw, ch).data;
  const off = [], R = [], G = [], B = [];
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const i = (y * cw + x) * 4;
      if (d[i + 3] > 200) { off.push(y * keyW + x); R.push(d[i]); G.push(d[i + 1]); B.push(d[i + 2]); }
    }
  const n = off.length;
  if (n < 6) return null;
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < n; i++) { mr += R[i]; mg += G[i]; mb += B[i]; }
  mr /= n; mg /= n; mb /= n;
  const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
  let tss = 0;
  for (let i = 0; i < n; i++) {
    r[i] = R[i] - mr; g[i] = G[i] - mg; b[i] = B[i] - mb;
    tss += r[i] * r[i] + g[i] * g[i] + b[i] * b[i];
  }
  return { w: cw, h: ch, n, off: Int32Array.from(off), r, g, b, mr, mg, mb, tss, rot };
}

const COLOR_WEIGHT = 1.5; // how hard a wrong overall colour is punished

// Pattern agreement (zero-mean correlation) minus a penalty for colour drift.
function scoreAt(K, t, base) {
  const { r: KR, g: KG, b: KB } = K;
  const { off, r: TR, g: TG, b: TB, n } = t;
  let sr = 0, sg = 0, sb = 0, qr = 0, qg = 0, qb = 0, c = 0;
  for (let i = 0; i < n; i++) {
    const idx = base + off[i];
    const R = KR[idx], G = KG[idx], B = KB[idx];
    sr += R; sg += G; sb += B;
    qr += R * R; qg += G * G; qb += B * B;
    c += TR[i] * R + TG[i] * G + TB[i] * B;
  }
  const wss = qr - (sr * sr) / n + (qg - (sg * sg) / n) + (qb - (sb * sb) / n);
  const reg = n * 48; // keeps flat, texture-free areas from scoring on noise
  const zncc = c / Math.sqrt((t.tss + reg) * (wss + reg));
  const dr = sr / n - t.mr, dg = sg / n - t.mg, db = sb / n - t.mb;
  return zncc - (COLOR_WEIGHT * Math.sqrt(dr * dr + dg * dg + db * db)) / 441.7;
}

const SCALES = [1.0, 1.2, 1.4]; // piece outline vs. one grid cell: no tabs … tabs both sides
const CANCELLED = "cancelled";

async function findPiece({ keyCanvas, piece, cols, cache, onProgress, isCancelled }) {
  const Wc = clamp(cols * 8, 160, 480);
  const Hc = Math.round((Wc * keyCanvas.height) / keyCanvas.width);
  const cs = Wc / cols;
  const M = 3;
  if (cache.cols !== cols || cache.src !== keyCanvas) {
    cache.cols = cols; cache.src = keyCanvas;
    cache.coarse = keyChannels(keyCanvas, Wc, Hc);
    cache.fine = keyChannels(keyCanvas, Wc * M, Hc * M);
  }
  const KC = cache.coarse, KF = cache.fine;
  const W = KC.W, H = KC.H;

  // Pass 1: every position, 4 turns x 3 sizes, on a small copy of the key.
  const combos = [];
  for (let rot = 0; rot < 4; rot++)
    for (const k of SCALES) {
      const t = buildTemplate(piece, rot, cs * k, W);
      if (t) combos.push({ t, rot, k });
    }
  if (!combos.length) throw new Error("The piece cut-out is too small to match. Retake the photo closer.");

  const best = new Float32Array(W * H).fill(-9);
  const bestCombo = new Int8Array(W * H);
  let last = performance.now();
  for (let ci = 0; ci < combos.length; ci++) {
    const t = combos[ci].t;
    const maxY = H - t.h, maxX = W - t.w;
    if (maxY < 0 || maxX < 0) continue;
    const hx = t.w >> 1, hy = t.h >> 1;
    for (let y = 0; y <= maxY; y++) {
      const row = y * W;
      for (let x = 0; x <= maxX; x++) {
        const s = scoreAt(KC, t, row + x);
        const center = (y + hy) * W + x + hx;
        if (s > best[center]) { best[center] = s; bestCombo[center] = ci; }
      }
      if (performance.now() - last > 32) {
        onProgress(((ci + y / (maxY + 1)) / combos.length) * 0.85);
        await tick();
        if (isCancelled()) throw new Error(CANCELLED);
        last = performance.now();
      }
    }
  }

  // Strongest peaks, kept apart from each other.
  const peaks = [];
  const rad = Math.ceil(cs * 0.7);
  for (let p = 0; p < 24; p++) {
    let bi = -1, bs = -8;
    for (let i = 0; i < best.length; i++) if (best[i] > bs) { bs = best[i]; bi = i; }
    if (bi < 0) break;
    const px = bi % W, py = (bi / W) | 0;
    peaks.push({ x: px, y: py, combo: combos[bestCombo[bi]] });
    for (let y = Math.max(0, py - rad); y <= Math.min(H - 1, py + rad); y++)
      for (let x = Math.max(0, px - rad); x <= Math.min(W - 1, px + rad); x++) best[y * W + x] = -9;
  }

  // Pass 2: re-score each peak at 3x detail, nudging position and size.
  const fineTemplates = new Map();
  const getFine = (rot, k) => {
    const id = rot + ":" + k.toFixed(2);
    if (!fineTemplates.has(id)) fineTemplates.set(id, buildTemplate(piece, rot, cs * M * k, KF.W));
    return fineTemplates.get(id);
  };
  const R = Math.ceil(cs * M * 0.45);
  const refined = [];
  for (let pi = 0; pi < peaks.length; pi++) {
    const pk = peaks[pi];
    const fx = pk.x * M + 1, fy = pk.y * M + 1;
    let top = { score: -9 };
    for (const dk of [-0.1, 0, 0.1]) {
      const t = getFine(pk.combo.rot, pk.combo.k + dk);
      if (!t) continue;
      const hx = t.w >> 1, hy = t.h >> 1;
      for (let oy = -R; oy <= R; oy++) {
        const y = fy - hy + oy;
        if (y < 0 || y + t.h > KF.H) continue;
        for (let ox = -R; ox <= R; ox++) {
          const x = fx - hx + ox;
          if (x < 0 || x + t.w > KF.W) continue;
          const s = scoreAt(KF, t, y * KF.W + x);
          if (s > top.score) top = { score: s, cx: x + t.w / 2, cy: y + t.h / 2, rot: pk.combo.rot };
        }
      }
    }
    if (top.score > -9) refined.push(top);
    onProgress(0.85 + (0.15 * (pi + 1)) / peaks.length);
    await tick();
    if (isCancelled()) throw new Error(CANCELLED);
  }

  refined.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of refined) {
    if (picked.every((p) => Math.hypot(p.cx - c.cx, p.cy - c.cy) > cs * M * 0.6)) picked.push(c);
    if (picked.length === 3) break;
  }
  return picked.map((c) => ({ u: c.cx / KF.W, v: c.cy / KF.H, rot: c.rot, score: c.score }));
}

/* ------------------------------------------------------------------ */
/*  UI pieces                                                          */
/* ------------------------------------------------------------------ */
const btnBase = {
  fontFamily: FONT, fontWeight: 700, fontSize: 16, borderRadius: 14, padding: "14px 18px",
  display: "flex", alignItems: "center", justifyContent: "center", gap: 10, cursor: "pointer", width: "100%",
};
const primaryBtn = { ...btnBase, background: P.mark, color: P.ink, border: "none" };
const quietBtn = { ...btnBase, background: "transparent", color: P.paper, border: `1.5px solid ${P.line}` };

function PhotoButtons({ onFile, cameraLabel }) {
  const cam = useRef(null), lib = useRef(null);
  const pick = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) onFile(f); };
  return (
    <div className="flex flex-col gap-3">
      <input ref={cam} type="file" accept="image/*" capture="environment" onChange={pick} className="hidden" />
      <input ref={lib} type="file" accept="image/*" onChange={pick} className="hidden" />
      <button className="pf-btn" style={primaryBtn} onClick={() => cam.current.click()}>
        <Camera size={20} /> {cameraLabel}
      </button>
      <button className="pf-btn" style={quietBtn} onClick={() => lib.current.click()}>
        <ImagePlus size={20} /> Choose from photos
      </button>
    </div>
  );
}

function CropBox({ url, crop, setCrop, cols, rows }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const MIN = 0.08;
  const norm = (e) => {
    const r = ref.current.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1), pw: r.width, ph: r.height };
  };
  const down = (e) => {
    e.preventDefault();
    const p = norm(e);
    const corners = [[crop.x, crop.y], [crop.x + crop.w, crop.y], [crop.x, crop.y + crop.h], [crop.x + crop.w, crop.y + crop.h]];
    let bi = -1, bd = 36;
    corners.forEach(([cx, cy], i) => {
      const dd = Math.hypot((cx - p.x) * p.pw, (cy - p.y) * p.ph);
      if (dd < bd) { bd = dd; bi = i; }
    });
    const inside = p.x > crop.x && p.x < crop.x + crop.w && p.y > crop.y && p.y < crop.y + crop.h;
    if (bi >= 0) drag.current = { mode: "corner", ax: corners[3 - bi][0], ay: corners[3 - bi][1] };
    else if (inside) drag.current = { mode: "move", ox: p.x - crop.x, oy: p.y - crop.y };
    else drag.current = { mode: "corner", ax: p.x, ay: p.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    const g = drag.current;
    if (!g) return;
    const p = norm(e);
    if (g.mode === "move") {
      setCrop({ ...crop, x: clamp(p.x - g.ox, 0, 1 - crop.w), y: clamp(p.y - g.oy, 0, 1 - crop.h) });
    } else {
      const w = Math.max(MIN, Math.abs(p.x - g.ax)), h = Math.max(MIN, Math.abs(p.y - g.ay));
      const x = clamp(p.x < g.ax ? g.ax - w : g.ax, 0, 1 - w), y = clamp(p.y < g.ay ? g.ay - h : g.ay, 0, 1 - h);
      setCrop({ x, y, w, h });
    }
  };
  const up = () => { drag.current = null; };
  const pct = (v) => `${v * 100}%`;
  const showGrid = cols <= 60 && rows <= 60;
  return (
    <div ref={ref} className="relative overflow-hidden select-none" style={{ borderRadius: 12, touchAction: "none" }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <img src={url} alt="Your photo of the finished puzzle picture" className="block w-full" draggable={false} />
      <div className="absolute" style={{
        left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h),
        boxShadow: "0 0 0 9999px rgba(10,20,17,0.62)", outline: `2px solid ${P.mark}`,
        backgroundImage: showGrid
          ? "linear-gradient(to right, rgba(255,210,63,0.45) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,210,63,0.45) 1px, transparent 1px)"
          : "none",
        backgroundSize: `${100 / cols}% ${100 / rows}%`,
      }}>
        {[[0, 0], [1, 0], [0, 1], [1, 1]].map(([hx, hy]) => (
          <span key={`${hx}${hy}`} className="absolute" style={{
            width: 22, height: 22, borderRadius: 11, background: P.mark, border: `3px solid ${P.ink}`,
            left: `calc(${hx * 100}% - 11px)`, top: `calc(${hy * 100}% - 11px)`,
          }} />
        ))}
      </div>
    </div>
  );
}

function StepTabs({ step, setStep, hasKey, hasResult }) {
  const tabs = [
    { id: "key", label: "1  Key", ok: true },
    { id: "piece", label: "2  Piece", ok: hasKey },
    { id: "result", label: "3  Place", ok: hasResult },
  ];
  return (
    <div className="flex gap-2" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={step === t.id} disabled={!t.ok} className="pf-btn"
          onClick={() => setStep(t.id)}
          style={{
            flex: 1, fontFamily: FONT, fontWeight: 700, fontSize: 14, padding: "9px 0", borderRadius: 999, whiteSpace: "pre",
            border: `1.5px solid ${step === t.id ? P.paper : P.line}`,
            background: step === t.id ? P.paper : "transparent",
            color: step === t.id ? P.ink : P.paper, opacity: t.ok ? 1 : 0.35, cursor: t.ok ? "pointer" : "default",
          }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

const Note = ({ children }) => (
  <div className="flex gap-3" style={{ background: "rgba(255,210,63,0.12)", border: `1px solid rgba(255,210,63,0.5)`, borderRadius: 12, padding: 12, fontSize: 14, lineHeight: 1.45 }}>
    <AlertTriangle size={18} color={P.mark} style={{ flexShrink: 0, marginTop: 2 }} />
    <div>{children}</div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */
export default function PuzzlePieceFinder() {
  const [step, setStep] = useState("key");
  const [error, setError] = useState("");

  // key
  const rawKey = useRef(null);
  const keyCanvas = useRef(null);
  const [rawKeyUrl, setRawKeyUrl] = useState("");
  const [keyUrl, setKeyUrl] = useState("");
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const [count, setCount] = useState(500);
  const [manual, setManual] = useState(null);
  const [rawSize, setRawSize] = useState({ w: 4, h: 3 });
  const [grid, setGrid] = useState(null); // saved {cols, rows}

  // piece
  const pieceSrc = useRef(null);
  const pieceCut = useRef(null);
  const [pieceUrl, setPieceUrl] = useState("");
  const [cutUrl, setCutUrl] = useState("");
  const [cutArea, setCutArea] = useState(0);
  const [cutoff, setCutoff] = useState(1);
  const [straighten, setStraighten] = useState(true);

  // match
  const cache = useRef({});
  const runId = useRef(0);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(null);
  const [sel, setSel] = useState(0);
  const zoomRef = useRef(null);
  const turnRef = useRef(null);

  const auto = useMemo(() => {
    const aspect = (crop.w * rawSize.w) / (crop.h * rawSize.h);
    const n = clamp(count || 0, 4, 10000);
    const cols = Math.max(2, Math.round(Math.sqrt(n * aspect)));
    return { cols, rows: Math.max(2, Math.round(n / cols)) };
  }, [crop, rawSize, count]);
  const draft = manual || auto;

  const loadKey = async (file) => {
    setError("");
    try {
      const c = await fileToCanvas(file, 1600);
      rawKey.current = c;
      setRawSize({ w: c.width, h: c.height });
      setCrop({ x: 0, y: 0, w: 1, h: 1 });
      setManual(null);
      setRawKeyUrl(c.toDataURL("image/jpeg", 0.85));
    } catch (e) { setError(e.message); }
  };

  const saveKey = () => {
    const src = rawKey.current;
    const sx = crop.x * src.width, sy = crop.y * src.height, sw = crop.w * src.width, sh = crop.h * src.height;
    const c = makeCanvas(sw, sh);
    c.getContext("2d").drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    keyCanvas.current = c;
    setKeyUrl(c.toDataURL("image/jpeg", 0.85));
    setGrid({ cols: draft.cols, rows: draft.rows });
    setResults(null);
    setStep("piece");
  };

  const loadPiece = async (file) => {
    setError("");
    try {
      const c = await fileToCanvas(file, 1200);
      pieceSrc.current = c;
      setResults(null);
      setPieceUrl(c.toDataURL("image/jpeg", 0.8));
    } catch (e) { setError(e.message); }
  };

  // Re-cut the piece whenever the photo or the cut settings change.
  useEffect(() => {
    if (!pieceUrl || !pieceSrc.current) return;
    const { canvas, areaFrac } = segmentPiece(pieceSrc.current, cutoff, straighten);
    pieceCut.current = canvas;
    setCutArea(areaFrac);
    setCutUrl(canvas ? canvas.toDataURL("image/png") : "");
  }, [pieceUrl, cutoff, straighten]);

  const runMatch = async () => {
    const id = ++runId.current;
    setError(""); setProgress(0);
    try {
      const found = await findPiece({
        keyCanvas: keyCanvas.current, piece: pieceCut.current, cols: grid.cols, cache: cache.current,
        onProgress: (p) => runId.current === id && setProgress(p),
        isCancelled: () => runId.current !== id,
      });
      if (runId.current !== id) return;
      if (!found.length) throw new Error("No spot on the key resembled this piece. Check the piece count, then retake the photo.");
      setResults(found); setSel(0); setStep("result");
    } catch (e) {
      if (e.message !== CANCELLED) setError(e.message);
    } finally {
      if (runId.current === id) setProgress(null);
    }
  };

  const cancelMatch = () => { runId.current++; setProgress(null); };

  // Close-up of the spot, and the piece turned the way it sits in the picture.
  const cur = results && results[sel];
  useEffect(() => {
    if (step !== "result" || !cur || !keyCanvas.current || !grid) return;
    const K = keyCanvas.current;
    const cellW = K.width / grid.cols, cellH = K.height / grid.rows;
    const z = zoomRef.current;
    if (z) {
      const S = Math.min(5 * Math.max(cellW, cellH), K.width, K.height);
      const sx = clamp(cur.u * K.width - S / 2, 0, K.width - S), sy = clamp(cur.v * K.height - S / 2, 0, K.height - S);
      const zx = z.getContext("2d");
      zx.imageSmoothingQuality = "high";
      zx.clearRect(0, 0, z.width, z.height);
      zx.drawImage(K, sx, sy, S, S, 0, 0, z.width, z.height);
      const f = z.width / S;
      const bx = (cur.u * K.width - cellW / 2 - sx) * f, by = (cur.v * K.height - cellH / 2 - sy) * f;
      zx.lineWidth = 8; zx.strokeStyle = P.ink; zx.strokeRect(bx, by, cellW * f, cellH * f);
      zx.lineWidth = 4; zx.strokeStyle = P.mark; zx.strokeRect(bx, by, cellW * f, cellH * f);
    }
    const t = turnRef.current, pc = pieceCut.current;
    if (t && pc) {
      const tx = t.getContext("2d");
      tx.setTransform(1, 0, 0, 1, 0, 0);
      tx.clearRect(0, 0, t.width, t.height);
      const f = (t.width * 0.86) / Math.max(pc.width, pc.height);
      tx.translate(t.width / 2, t.height / 2);
      tx.rotate((cur.rot * Math.PI) / 2);
      tx.imageSmoothingQuality = "high";
      tx.drawImage(pc, (-pc.width * f) / 2, (-pc.height * f) / 2, pc.width * f, pc.height * f);
    }
  }, [step, cur, grid]);

  const verdict = useMemo(() => {
    if (!results || !results.length) return null;
    const s1 = results[0].score, margin = results.length > 1 ? s1 - results[1].score : 1;
    if (s1 > 0.55 && margin > 0.08) return { label: "Strong match", weak: false };
    if (s1 > 0.35 && margin > 0.03) return { label: "Likely match", weak: false };
    return { label: "Several spots look alike", weak: true };
  }, [results]);

  const cutProblem = pieceUrl && (!cutUrl || cutArea < 0.02 || cutArea > 0.85);
  const col = cur && grid ? clamp(Math.floor(cur.u * grid.cols) + 1, 1, grid.cols) : 0;
  const row = cur && grid ? clamp(Math.floor(cur.v * grid.rows) + 1, 1, grid.rows) : 0;

  const numInput = {
    fontFamily: FONT, fontSize: 16, fontWeight: 700, width: "100%", padding: "10px 12px", borderRadius: 10,
    border: `1.5px solid ${P.line}`, background: P.feltDeep, color: P.paper,
  };
  const label = { fontSize: 13, color: P.dim, marginBottom: 6, display: "block" };

  return (
    <div style={{ minHeight: "100vh", background: P.felt, color: P.paper, fontFamily: FONT }}>
      <style>{`
        .pf-btn:focus-visible, .pf-in:focus-visible { outline: 3px solid ${P.mark}; outline-offset: 2px; }
        @keyframes pf-ring { 0% { box-shadow: 0 0 0 0 rgba(255,210,63,0.9); } 100% { box-shadow: 0 0 0 26px rgba(255,210,63,0); } }
        .pf-ring { animation: pf-ring 1.4s ease-out 3; }
        @media (prefers-reduced-motion: reduce) { .pf-ring { animation: none; } }
        input[type=range].pf-in { accent-color: ${P.mark}; }
      `}</style>

      <div className="mx-auto flex flex-col gap-5" style={{ maxWidth: 520, padding: "22px 16px 40px" }}>
        <header>
          <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1, margin: 0 }}>Where does this piece go?</h1>
        </header>

        <StepTabs step={step} setStep={setStep} hasKey={!!keyUrl} hasResult={!!results} />

        {error && <Note>{error}</Note>}

        {/* ---------------- Step 1: key ---------------- */}
        {step === "key" && !rawKeyUrl && (
          <section className="flex flex-col gap-4">
            <p style={{ fontSize: 16, lineHeight: 1.5, margin: 0, color: P.dim }}>
              Photograph the finished picture from the box lid or poster. Hold the phone flat above it so the picture isn't skewed, and avoid glare.
            </p>
            <PhotoButtons onFile={loadKey} cameraLabel="Photograph the key" />
            {keyUrl && (
              <button className="pf-btn" style={quietBtn} onClick={() => setStep("piece")}>Keep the current key</button>
            )}
          </section>
        )}

        {step === "key" && rawKeyUrl && (
          <section className="flex flex-col gap-4">
            <p style={{ fontSize: 15, lineHeight: 1.5, margin: 0, color: P.dim }}>
              Drag the yellow corners until the frame hugs the puzzle picture exactly. Leave out the box border and any logos around it.
            </p>
            <CropBox url={rawKeyUrl} crop={crop} setCrop={setCrop} cols={draft.cols} rows={draft.rows} />
            <div>
              <span style={label}>Pieces in this puzzle</span>
              <div className="flex gap-2 flex-wrap">
                {[100, 300, 500, 1000].map((n) => (
                  <button key={n} className="pf-btn" onClick={() => { setCount(n); setManual(null); }}
                    style={{ ...quietBtn, width: "auto", padding: "9px 14px", fontSize: 14, borderRadius: 999,
                      background: count === n && !manual ? P.paper : "transparent", color: count === n && !manual ? P.ink : P.paper }}>
                    {n}
                  </button>
                ))}
                <input className="pf-in" type="number" inputMode="numeric" min={4} max={10000} value={count || ""} aria-label="Piece count"
                  onChange={(e) => { setCount(parseInt(e.target.value, 10) || 0); setManual(null); }}
                  style={{ ...numInput, width: 96, padding: "8px 12px" }} />
              </div>
            </div>
            <div className="flex gap-3">
              <div style={{ flex: 1 }}>
                <span style={label}>Pieces across</span>
                <input className="pf-in" type="number" inputMode="numeric" min={2} max={200} value={draft.cols} style={numInput}
                  onChange={(e) => setManual({ cols: clamp(parseInt(e.target.value, 10) || 2, 2, 200), rows: draft.rows })} />
              </div>
              <div style={{ flex: 1 }}>
                <span style={label}>Pieces down</span>
                <input className="pf-in" type="number" inputMode="numeric" min={2} max={200} value={draft.rows} style={numInput}
                  onChange={(e) => setManual({ cols: draft.cols, rows: clamp(parseInt(e.target.value, 10) || 2, 2, 200) })} />
              </div>
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.45, margin: 0, color: P.dim }}>
              Across and down are worked out from the piece count. If your box lists them, or you've counted an edge, type the real numbers — it sets how big one piece is on the key.
            </p>
            <button className="pf-btn" style={primaryBtn} onClick={saveKey}><Check size={20} /> Save key</button>
            <button className="pf-btn" style={quietBtn} onClick={() => setRawKeyUrl("")}><RotateCcw size={18} /> Retake the key photo</button>
          </section>
        )}

        {/* ---------------- Step 2: piece ---------------- */}
        {step === "piece" && !pieceUrl && (
          <section className="flex flex-col gap-4">
            <p style={{ fontSize: 16, lineHeight: 1.5, margin: 0, color: P.dim }}>
              Lay one piece face up on a plain surface that contrasts with it — a sheet of paper works. Fill most of the frame with the piece and keep its sides roughly square to the photo.
            </p>
            <PhotoButtons onFile={loadPiece} cameraLabel="Photograph a piece" />
          </section>
        )}

        {step === "piece" && pieceUrl && (
          <section className="flex flex-col gap-4">
            <div className="flex gap-3">
              <figure style={{ flex: 1, margin: 0 }}>
                <img src={pieceUrl} alt="Your photo of the piece" className="block w-full" style={{ borderRadius: 12, aspectRatio: "1", objectFit: "cover" }} />
                <figcaption style={{ ...label, marginTop: 6, marginBottom: 0 }}>Your photo</figcaption>
              </figure>
              <figure style={{ flex: 1, margin: 0 }}>
                <div className="flex items-center justify-center" style={{ borderRadius: 12, aspectRatio: "1", background: P.feltDeep, border: `1.5px dashed ${P.line}` }}>
                  {cutUrl && <img src={cutUrl} alt="The piece cut out from its background" style={{ maxWidth: "82%", maxHeight: "82%" }} />}
                </div>
                <figcaption style={{ ...label, marginTop: 6, marginBottom: 0 }}>What gets matched</figcaption>
              </figure>
            </div>

            {cutProblem ? (
              <Note>The piece didn't separate cleanly from the background. Move the slider below, or retake it on a plain surface of a different colour.</Note>
            ) : (
              <p style={{ fontSize: 14, lineHeight: 1.45, margin: 0, color: P.dim }}>
                The cut-out should show the whole piece and nothing else. Adjust the slider if background is left on or parts of the piece are missing.
              </p>
            )}

            <div>
              <div className="flex justify-between" style={{ ...label }}>
                <span>Keep more</span><span>Cut more away</span>
              </div>
              <input className="pf-in w-full" type="range" min={0.4} max={1.8} step={0.05} value={cutoff} aria-label="Background cut-off"
                onChange={(e) => setCutoff(parseFloat(e.target.value))} />
            </div>
            <label className="flex items-center gap-3" style={{ fontSize: 15 }}>
              <input className="pf-in" type="checkbox" checked={straighten} onChange={(e) => setStraighten(e.target.checked)}
                style={{ width: 20, height: 20, accentColor: P.mark }} />
              Straighten a tilted piece
            </label>

            {progress === null ? (
              <button className="pf-btn" style={{ ...primaryBtn, opacity: cutUrl ? 1 : 0.4 }} disabled={!cutUrl} onClick={runMatch}>
                Find where it goes
              </button>
            ) : (
              <div className="flex flex-col gap-3" aria-live="polite">
                <div style={{ height: 14, borderRadius: 7, background: P.feltDeep, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.round(progress * 100)}%`, background: P.mark, transition: "width 120ms linear" }} />
                </div>
                <span style={{ fontSize: 14, color: P.dim }}>Checking every spot on the key, in all four turns… {Math.round(progress * 100)}%</span>
                <button className="pf-btn" style={quietBtn} onClick={cancelMatch}>Stop</button>
              </div>
            )}
            <button className="pf-btn" style={quietBtn} onClick={() => { cancelMatch(); setPieceUrl(""); setCutUrl(""); }}>
              <RotateCcw size={18} /> Retake the piece photo
            </button>
          </section>
        )}

        {/* ---------------- Step 3: result ---------------- */}
        {step === "result" && cur && grid && (
          <section className="flex flex-col gap-4">
            <div>
              <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
                Row {row}, column {col}
              </div>
              <p style={{ fontSize: 15, lineHeight: 1.45, margin: "6px 0 0", color: P.dim }}>
                {row} down from the top edge and {col} in from the left, on a grid {grid.cols} across by {grid.rows} down.
              </p>
            </div>

            <div className="relative overflow-hidden" style={{ borderRadius: 12 }}>
              <img src={keyUrl} alt="The puzzle key with the piece's position marked" className="block w-full" />
              <div className="absolute" style={{ left: 0, right: 0, top: `${cur.v * 100}%`, height: 0, borderTop: `1.5px solid ${P.mark}`, opacity: 0.85 }} />
              <div className="absolute" style={{ top: 0, bottom: 0, left: `${cur.u * 100}%`, width: 0, borderLeft: `1.5px solid ${P.mark}`, opacity: 0.85 }} />
              <div key={sel} className="absolute pf-ring" style={{
                left: `${(cur.u - 0.5 / grid.cols) * 100}%`, top: `${(cur.v - 0.5 / grid.rows) * 100}%`,
                width: `${100 / grid.cols}%`, height: `${100 / grid.rows}%`, minWidth: 10, minHeight: 10,
                border: `2.5px solid ${P.mark}`, outline: `2px solid ${P.ink}`, borderRadius: 3,
              }} />
              {results.map((r, i) => i !== sel && (
                <button key={i} className="pf-btn absolute" onClick={() => setSel(i)} aria-label={`Show option ${i + 1}`}
                  style={{ left: `calc(${r.u * 100}% - 13px)`, top: `calc(${r.v * 100}% - 13px)`, width: 26, height: 26, borderRadius: 13,
                    background: P.ink, color: P.paper, border: `2px solid ${P.paper}`, fontFamily: FONT, fontWeight: 800, fontSize: 13, cursor: "pointer", padding: 0 }}>
                  {i + 1}
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <figure style={{ flex: 3, margin: 0 }}>
                <canvas ref={zoomRef} width={420} height={420} className="block w-full" style={{ borderRadius: 12 }} />
                <figcaption style={{ ...label, marginTop: 6, marginBottom: 0 }}>Close-up of the spot</figcaption>
              </figure>
              <figure style={{ flex: 2, margin: 0 }}>
                <canvas ref={turnRef} width={240} height={240} className="block w-full" style={{ borderRadius: 12, background: P.feltDeep }} />
                <figcaption style={{ ...label, marginTop: 6, marginBottom: 0 }}>Turn the piece to sit like this</figcaption>
              </figure>
            </div>

            {verdict && (verdict.weak ? (
              <Note>
                {verdict.label}. Pieces of sky, water or other flat colour match many places — compare the numbered options below against your piece.
              </Note>
            ) : (
              <div style={{ fontSize: 15, fontWeight: 700, color: P.mark }}>{verdict.label}</div>
            ))}

            {results.length > 1 && (
              <div className="flex gap-2">
                {results.map((r, i) => (
                  <button key={i} className="pf-btn" onClick={() => setSel(i)}
                    style={{ ...quietBtn, flexDirection: "column", gap: 2, padding: "10px 6px", fontSize: 14,
                      background: i === sel ? P.paper : "transparent", color: i === sel ? P.ink : P.paper }}>
                    <span>Option {i + 1}</span>
                    <span style={{ fontWeight: 500, fontSize: 12, opacity: 0.75 }}>{Math.round(clamp(r.score, 0, 1) * 100)}% alike</span>
                  </button>
                ))}
              </div>
            )}

            <button className="pf-btn" style={primaryBtn} onClick={() => { setPieceUrl(""); setCutUrl(""); setResults(null); setStep("piece"); }}>
              <Camera size={20} /> Photograph another piece
            </button>
            <button className="pf-btn" style={quietBtn} onClick={() => setStep("piece")}>Adjust this piece's cut-out</button>
          </section>
        )}
      </div>
    </div>
  );
}
