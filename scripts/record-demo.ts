/**
 * Records the landing-page demo GIF (public/demo.gif).
 *
 * Draws a synthetic box-art scene and a jigsaw-shaped piece cut from it,
 * drives the built app through all three steps in headless Chromium and
 * encodes the captured frames as a GIF.
 *
 *   bun run build && bun run demo:gif
 *
 * Needs a Chromium that playwright-core can find: either run
 * `bunx playwright install chromium` once, or set CHROMIUM_PATH.
 */
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import { PNG } from "pngjs";
import { chromium, type Page } from "playwright-core";

const PORT = 4173;
const BASE = `http://localhost:${PORT}`;
const OUT = "public/demo.gif";
const VIEWPORT = { width: 390, height: 780 };

// Box art: 800x600, 300 pieces -> 20 x 15 grid. The piece is cut from the house door.
const COLS = 20;
const ROWS = 15;
const KW = 800;
const KH = 600;
const TARGET = { row: 10, col: 13 };

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url: string, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await pause(200);
  }
  throw new Error(`Preview server did not start at ${url}`);
}

/** Draws the scene and the piece inside the page, so no native canvas is needed. */
function drawImages(page: Page) {
  return page.evaluate(
    ({ COLS, ROWS, KW, KH, TARGET }) => {
      let seed = 7;
      const rnd = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 2 ** 32;
      };
      const key = document.createElement("canvas");
      key.width = KW;
      key.height = KH;
      const g = key.getContext("2d")!;
      const sky = g.createLinearGradient(0, 0, 0, 360);
      sky.addColorStop(0, "#5aa9e6");
      sky.addColorStop(1, "#cfe8f7");
      g.fillStyle = sky;
      g.fillRect(0, 0, KW, KH);
      g.fillStyle = "#ffd23f";
      g.beginPath();
      g.arc(660, 90, 46, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.92)";
      for (const [x, y, s] of [[120, 80, 1], [330, 130, 0.8], [520, 60, 0.7]]) {
        for (const [dx, dy, r] of [[0, 0, 26], [28, -10, 32], [58, 0, 24], [30, 10, 24]]) {
          g.beginPath();
          g.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
          g.fill();
        }
      }
      const poly = (pts: number[][], col: string) => {
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(pts[0][0], pts[0][1]);
        pts.slice(1).forEach(([x, y]) => g.lineTo(x, y));
        g.closePath();
        g.fill();
      };
      poly([[0, 360], [150, 170], [300, 360]], "#6d7fa3");
      poly([[110, 170], [150, 170], [190, 230], [150, 215]], "#f4f6fb");
      poly([[200, 360], [400, 120], [600, 360]], "#55679a");
      poly([[360, 165], [400, 120], [445, 170], [410, 160]], "#f4f6fb");
      poly([[520, 360], [660, 210], [800, 360]], "#7b8bb0");
      g.fillStyle = "#6fae4e";
      g.beginPath();
      g.ellipse(200, 420, 380, 110, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#4f9a3c";
      g.beginPath();
      g.ellipse(650, 430, 360, 100, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#5fa845";
      g.fillRect(0, 430, KW, KH);
      const lake = g.createLinearGradient(0, 470, 0, 560);
      lake.addColorStop(0, "#3d8fd1");
      lake.addColorStop(1, "#1f5fa0");
      g.fillStyle = lake;
      g.beginPath();
      g.ellipse(210, 520, 190, 46, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(255,255,255,0.5)";
      g.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        g.beginPath();
        g.moveTo(90 + i * 40, 505 + (i % 2) * 18);
        g.lineTo(115 + i * 40, 505 + (i % 2) * 18);
        g.stroke();
      }
      g.fillStyle = "#d8b98a";
      g.beginPath();
      g.moveTo(470, 430);
      g.quadraticCurveTo(430, 520, 520, 600);
      g.lineTo(600, 600);
      g.quadraticCurveTo(500, 520, 540, 430);
      g.closePath();
      g.fill();
      // house
      g.fillStyle = "#c8452f";
      g.fillRect(440, 340, 120, 90);
      poly([[425, 345], [500, 285], [575, 345]], "#5b2e1a");
      g.fillStyle = "#7a3b22";
      g.fillRect(530, 295, 14, 36);
      g.fillStyle = "#ffe98a";
      g.fillRect(455, 360, 26, 26);
      g.fillRect(519, 360, 26, 26);
      g.strokeStyle = "#5b2e1a";
      g.lineWidth = 3;
      g.strokeRect(455, 360, 26, 26);
      g.strokeRect(519, 360, 26, 26);
      g.beginPath();
      g.moveTo(468, 360); g.lineTo(468, 386);
      g.moveTo(455, 373); g.lineTo(481, 373);
      g.moveTo(532, 360); g.lineTo(532, 386);
      g.moveTo(519, 373); g.lineTo(545, 373);
      g.stroke();
      g.fillStyle = "#3a6ea5";
      g.fillRect(488, 388, 24, 42);
      g.fillStyle = "#ffd23f";
      g.beginPath();
      g.arc(507, 410, 2.5, 0, Math.PI * 2);
      g.fill();
      const tree = (x: number, y: number, s: number, col: string) => {
        g.fillStyle = "#6b4423";
        g.fillRect(x - 5 * s, y - 20 * s, 10 * s, 24 * s);
        for (let i = 0; i < 3; i++)
          poly([[x - (40 - i * 8) * s, y - (18 + i * 22) * s], [x, y - (55 + i * 22) * s], [x + (40 - i * 8) * s, y - (18 + i * 22) * s]], col);
      };
      tree(60, 470, 1.1, "#2f7a3e");
      tree(360, 450, 0.9, "#3c8f4a");
      tree(640, 470, 1.2, "#276b36");
      tree(740, 500, 1.0, "#3f9a52");
      tree(400, 560, 0.8, "#2f7a3e");
      g.fillStyle = "#e9dcc4";
      for (let x = 600; x < 800; x += 22) g.fillRect(x, 440, 6, 26);
      g.fillRect(600, 446, 200, 4);
      g.fillRect(600, 458, 200, 4);
      for (let i = 0; i < 140; i++) {
        g.fillStyle = ["#ff6b6b", "#ffd23f", "#ffffff", "#c77dff"][i % 4];
        g.beginPath();
        g.arc(rnd() * KW, 560 + rnd() * 40, 3 + rnd() * 2, 0, Math.PI * 2);
        g.fill();
      }
      const grain = (c: CanvasRenderingContext2D, w: number, h: number, amp: number) => {
        const id = c.getImageData(0, 0, w, h);
        for (let i = 0; i < id.data.length; i += 4) {
          const v = (rnd() - 0.5) * amp;
          id.data[i] += v;
          id.data[i + 1] += v;
          id.data[i + 2] += v;
        }
        c.putImageData(id, 0, 0);
      };
      grain(g, KW, KH, 10);

      // Jigsaw piece: body is one cell, tabs left and bottom, blanks right and top.
      type Pt = [number, number];
      const cw = KW / COLS;
      const ch = KH / ROWS;
      const S = Math.min(cw, ch);
      const cx = (TARGET.col - 0.5) * cw;
      const cy = (TARGET.row - 0.5) * ch;
      const edge = (c: CanvasRenderingContext2D, A: Pt, B: Pt, n: Pt, d: number) => {
        const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
        const P = (t: number, u: number): Pt => [A[0] + t * (B[0] - A[0]) + u * d * n[0] * L, A[1] + t * (B[1] - A[1]) + u * d * n[1] * L];
        const bz = (a: Pt, b: Pt, e: Pt) => c.bezierCurveTo(...P(...a), ...P(...b), ...P(...e));
        c.lineTo(...P(0.36, 0));
        if (d) {
          bz([0.46, 0], [0.46, 0.05], [0.41, 0.1]);
          bz([0.34, 0.17], [0.38, 0.28], [0.5, 0.28]);
          bz([0.62, 0.28], [0.66, 0.17], [0.59, 0.1]);
          bz([0.54, 0.05], [0.54, 0], [0.64, 0]);
        }
        c.lineTo(...P(1, 0));
      };
      const piecePath = (c: CanvasRenderingContext2D, x: number, y: number, s: number) => {
        c.beginPath();
        c.moveTo(x, y);
        edge(c, [x, y], [x + s, y], [0, -1], -1);
        edge(c, [x + s, y], [x + s, y + s], [1, 0], -1);
        edge(c, [x + s, y + s], [x, y + s], [0, 1], 1);
        edge(c, [x, y + s], [x, y], [-1, 0], 1);
        c.closePath();
      };
      const piece = document.createElement("canvas");
      piece.width = 700;
      piece.height = 700;
      const p = piece.getContext("2d")!;
      p.fillStyle = "#efe9dc";
      p.fillRect(0, 0, 700, 700);
      grain(p, 700, 700, 8);
      const k = 7.5;
      p.translate(350, 350);
      p.rotate((8 * Math.PI) / 180);
      p.shadowColor = "rgba(0,0,0,0.35)";
      p.shadowBlur = 24;
      p.shadowOffsetY = 10;
      p.fillStyle = "#000";
      piecePath(p, (-S * k) / 2, (-S * k) / 2, S * k);
      p.fill();
      p.shadowColor = "transparent";
      p.save();
      piecePath(p, (-S * k) / 2, (-S * k) / 2, S * k);
      p.clip();
      p.drawImage(key, cx - S, cy - S, 2 * S, 2 * S, -S * k, -S * k, 2 * S * k, 2 * S * k);
      p.restore();
      p.strokeStyle = "rgba(0,0,0,0.25)";
      p.lineWidth = 2;
      piecePath(p, (-S * k) / 2, (-S * k) / 2, S * k);
      p.stroke();
      return { key: key.toDataURL("image/jpeg", 0.92), piece: piece.toDataURL("image/jpeg", 0.92) };
    },
    { COLS, ROWS, KW, KH, TARGET },
  );
}

const toFile = (name: string, dataUrl: string) => ({ name, mimeType: "image/jpeg", buffer: Buffer.from(dataUrl.split(",")[1], "base64") });

async function main() {
  const server = Bun.spawn(["bunx", "vite", "preview", "--port", String(PORT), "--strictPort"], { stdout: "ignore", stderr: "ignore" });
  try {
    await waitForServer(`${BASE}/app/`);
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
    const page = await browser.newPage({ viewport: VIEWPORT });
    const frames: { png: Buffer; delay: number }[] = [];
    const snap = async (seconds: number) => frames.push({ png: await page.screenshot(), delay: Math.round(seconds * 1000) });

    await page.goto(`${BASE}/app/`);
    await page.getByRole("heading", { name: /Where does this piece go/ }).waitFor();
    await pause(300);
    await snap(1.4);

    const imgs = await drawImages(page);
    const library = () => page.locator("input[type=file]:not([capture])");

    await library().setInputFiles(toFile("key.jpg", imgs.key));
    await page.getByRole("img", { name: /finished puzzle picture/ }).waitFor();
    await page.getByRole("button", { name: "300", exact: true }).click();
    await pause(300);
    await snap(2.2);
    await page.getByRole("button", { name: /Save key/ }).click();

    await page.getByRole("button", { name: /Photograph a piece/ }).waitFor();
    await pause(200);
    await snap(1.2);
    await library().setInputFiles(toFile("piece.jpg", imgs.piece));
    await page.getByRole("img", { name: /cut out from its background/ }).waitFor();
    await pause(300);
    await snap(2.2);

    await page.getByRole("button", { name: /Find where it goes/ }).click();
    const result = page.getByText(/^Row \d+, column \d+$/);
    const t0 = Date.now();
    while (!(await result.count()) && Date.now() - t0 < 120_000) {
      await snap(0.3);
      await pause(120);
    }
    await result.waitFor({ timeout: 120_000 });
    await pause(400);
    await snap(3.5);

    const text = await result.textContent();
    const expected = `Row ${TARGET.row}, column ${TARGET.col}`;
    console.log(`result: ${text} (expected ${expected})`);
    console.log(`verdict: ${await page.getByText(/match|look alike/).first().textContent()}`);
    await browser.close();
    if (text !== expected) throw new Error("The demo run did not land on the expected cell; GIF not written.");

    const gif = GIFEncoder();
    for (const { png, delay } of frames) {
      const { width, height, data } = PNG.sync.read(png);
      const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const palette = quantize(rgba, 256, { format: "rgb444" });
      const index = applyPalette(rgba, palette, "rgb444");
      gif.writeFrame(index, width, height, { palette, delay });
    }
    gif.finish();
    await Bun.write(OUT, gif.bytes());
    console.log(`wrote ${OUT}: ${frames.length} frames, ${(gif.bytes().length / 1024).toFixed(0)} kB`);
  } finally {
    server.kill();
  }
}

await main();
