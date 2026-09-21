import { useRef, type PointerEvent } from "react";
import { clamp } from "../lib/canvas";
import { P } from "../theme";
import type { Crop } from "../types";

interface Props {
  url: string;
  crop: Crop;
  setCrop: (c: Crop) => void;
  cols: number;
  rows: number;
}

type Drag = { mode: "corner"; ax: number; ay: number } | { mode: "move"; ox: number; oy: number };

const MIN = 0.08;
/** Pixels within which a press grabs a corner handle. */
const GRAB = 36;
const HANDLES: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]];

/** Drag-to-crop overlay with corner handles and a faint grid preview. */
export function CropBox({ url, crop, setCrop, cols, rows }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const norm = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1), pw: r.width, ph: r.height };
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const p = norm(e);
    const corners: [number, number][] = [
      [crop.x, crop.y],
      [crop.x + crop.w, crop.y],
      [crop.x, crop.y + crop.h],
      [crop.x + crop.w, crop.y + crop.h],
    ];
    let bi = -1;
    let bd = GRAB;
    corners.forEach(([cx, cy], i) => {
      const dd = Math.hypot((cx - p.x) * p.pw, (cy - p.y) * p.ph);
      if (dd < bd) { bd = dd; bi = i; }
    });
    const inside = p.x > crop.x && p.x < crop.x + crop.w && p.y > crop.y && p.y < crop.y + crop.h;
    if (bi >= 0) {
      // Dragging a corner anchors the opposite one.
      const [ax, ay] = corners[3 - bi];
      drag.current = { mode: "corner", ax, ay };
    } else if (inside) {
      drag.current = { mode: "move", ox: p.x - crop.x, oy: p.y - crop.y };
    } else {
      drag.current = { mode: "corner", ax: p.x, ay: p.y };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    if (!g) return;
    const p = norm(e);
    if (g.mode === "move") {
      setCrop({ ...crop, x: clamp(p.x - g.ox, 0, 1 - crop.w), y: clamp(p.y - g.oy, 0, 1 - crop.h) });
    } else {
      const w = Math.max(MIN, Math.abs(p.x - g.ax));
      const h = Math.max(MIN, Math.abs(p.y - g.ay));
      const x = clamp(p.x < g.ax ? g.ax - w : g.ax, 0, 1 - w);
      const y = clamp(p.y < g.ay ? g.ay - h : g.ay, 0, 1 - h);
      setCrop({ x, y, w, h });
    }
  };

  const up = () => { drag.current = null; };
  const pct = (v: number) => `${v * 100}%`;
  const showGrid = cols <= 60 && rows <= 60;

  return (
    <div
      ref={ref}
      className="relative overflow-hidden select-none"
      style={{ borderRadius: 12, touchAction: "none" }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <img src={url} alt="Your photo of the finished puzzle picture" className="block w-full" draggable={false} />
      <div
        className="absolute"
        style={{
          left: pct(crop.x),
          top: pct(crop.y),
          width: pct(crop.w),
          height: pct(crop.h),
          boxShadow: "0 0 0 9999px rgba(10,20,17,0.62)",
          outline: `2px solid ${P.mark}`,
          backgroundImage: showGrid
            ? "linear-gradient(to right, rgba(255,210,63,0.45) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,210,63,0.45) 1px, transparent 1px)"
            : "none",
          backgroundSize: `${100 / cols}% ${100 / rows}%`,
        }}
      >
        {HANDLES.map(([hx, hy]) => (
          <span
            key={`${hx}${hy}`}
            className="absolute"
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              background: P.mark,
              border: `3px solid ${P.ink}`,
              left: `calc(${hx * 100}% - 11px)`,
              top: `calc(${hy * 100}% - 11px)`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
