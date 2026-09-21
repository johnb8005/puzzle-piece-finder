import { useEffect, useMemo, useRef, useState } from "react";
import { Note } from "./components/Note";
import { StepTabs } from "./components/StepTabs";
import { ctx2d, fileToCanvas, makeCanvas } from "./lib/canvas";
import { autoGrid, type Grid } from "./lib/grid";
import { findPiece, MatchCancelled, type KeyCache, type Match } from "./lib/match";
import { segmentPiece } from "./lib/segment";
import { KeyStep } from "./steps/KeyStep";
import { PieceStep } from "./steps/PieceStep";
import { ResultStep } from "./steps/ResultStep";
import { FONT, P } from "./theme";
import type { Crop, Step } from "./types";

const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 };
const KEY_MAX_SIDE = 1600;
const PIECE_MAX_SIDE = 1200;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [step, setStep] = useState<Step>("key");
  const [error, setError] = useState("");

  // Step 1: the key (box art)
  const rawKey = useRef<HTMLCanvasElement | null>(null);
  const keyCanvas = useRef<HTMLCanvasElement | null>(null);
  const [rawKeyUrl, setRawKeyUrl] = useState("");
  const [keyUrl, setKeyUrl] = useState("");
  const [crop, setCrop] = useState<Crop>(FULL_CROP);
  const [count, setCount] = useState(500);
  const [manual, setManual] = useState<Grid | null>(null);
  const [rawSize, setRawSize] = useState({ w: 4, h: 3 });
  const [grid, setGrid] = useState<Grid | null>(null);

  // Step 2: the piece
  const pieceSrc = useRef<HTMLCanvasElement | null>(null);
  const pieceCut = useRef<HTMLCanvasElement | null>(null);
  const [pieceUrl, setPieceUrl] = useState("");
  const [cutUrl, setCutUrl] = useState("");
  const [cutArea, setCutArea] = useState(0);
  const [cutoff, setCutoff] = useState(1);
  const [straighten, setStraighten] = useState(true);

  // Step 3: the match
  const cache = useRef<KeyCache>({});
  const runId = useRef(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [results, setResults] = useState<Match[] | null>(null);
  const [sel, setSel] = useState(0);

  const auto = useMemo(() => autoGrid(count, (crop.w * rawSize.w) / (crop.h * rawSize.h)), [crop, rawSize, count]);
  const draft = manual ?? auto;

  const loadKey = async (file: File) => {
    setError("");
    try {
      const c = await fileToCanvas(file, KEY_MAX_SIDE);
      rawKey.current = c;
      setRawSize({ w: c.width, h: c.height });
      setCrop(FULL_CROP);
      setManual(null);
      setRawKeyUrl(c.toDataURL("image/jpeg", 0.85));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const saveKey = () => {
    const src = rawKey.current;
    if (!src) return;
    const sx = crop.x * src.width;
    const sy = crop.y * src.height;
    const sw = crop.w * src.width;
    const sh = crop.h * src.height;
    const c = makeCanvas(sw, sh);
    ctx2d(c).drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    keyCanvas.current = c;
    setKeyUrl(c.toDataURL("image/jpeg", 0.85));
    setGrid({ cols: draft.cols, rows: draft.rows });
    setResults(null);
    setStep("piece");
  };

  const loadPiece = async (file: File) => {
    setError("");
    try {
      const c = await fileToCanvas(file, PIECE_MAX_SIDE);
      pieceSrc.current = c;
      setResults(null);
      setPieceUrl(c.toDataURL("image/jpeg", 0.8));
    } catch (e) {
      setError(errorMessage(e));
    }
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
    if (!keyCanvas.current || !pieceCut.current || !grid) return;
    const id = ++runId.current;
    setError("");
    setProgress(0);
    try {
      const found = await findPiece({
        keyCanvas: keyCanvas.current,
        piece: pieceCut.current,
        cols: grid.cols,
        cache: cache.current,
        onProgress: (p) => { if (runId.current === id) setProgress(p); },
        isCancelled: () => runId.current !== id,
      });
      if (runId.current !== id) return;
      if (!found.length) throw new Error("No spot on the key resembled this piece. Check the piece count, then retake the photo.");
      setResults(found);
      setSel(0);
      setStep("result");
    } catch (e) {
      if (!(e instanceof MatchCancelled)) setError(errorMessage(e));
    } finally {
      if (runId.current === id) setProgress(null);
    }
  };

  const cancelMatch = () => {
    runId.current++;
    setProgress(null);
  };

  const clearPiece = () => {
    cancelMatch();
    setPieceUrl("");
    setCutUrl("");
  };

  const cutProblem = !!pieceUrl && (!cutUrl || cutArea < 0.02 || cutArea > 0.85);

  return (
    <div style={{ minHeight: "100vh", background: P.felt, color: P.paper, fontFamily: FONT }}>
      <div className="mx-auto flex flex-col gap-5" style={{ maxWidth: 520, padding: "22px 16px 40px" }}>
        <header className="flex items-baseline justify-between gap-3">
          <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1, margin: 0 }}>Where does this piece go?</h1>
          <a href={import.meta.env.BASE_URL} style={{ color: P.dim, fontSize: 13, whiteSpace: "nowrap" }}>
            About
          </a>
        </header>

        <StepTabs step={step} setStep={setStep} hasKey={!!keyUrl} hasResult={!!results} />

        {error && <Note>{error}</Note>}

        {step === "key" && (
          <KeyStep
            rawKeyUrl={rawKeyUrl}
            hasSavedKey={!!keyUrl}
            crop={crop}
            setCrop={setCrop}
            draft={draft}
            count={count}
            setCount={setCount}
            manual={manual}
            setManual={setManual}
            onLoad={loadKey}
            onSave={saveKey}
            onRetake={() => setRawKeyUrl("")}
            onKeepCurrent={() => setStep("piece")}
          />
        )}

        {step === "piece" && (
          <PieceStep
            pieceUrl={pieceUrl}
            cutUrl={cutUrl}
            cutProblem={cutProblem}
            cutoff={cutoff}
            setCutoff={setCutoff}
            straighten={straighten}
            setStraighten={setStraighten}
            progress={progress}
            onLoad={loadPiece}
            onRun={runMatch}
            onCancel={cancelMatch}
            onRetake={clearPiece}
          />
        )}

        {step === "result" && results && results.length > 0 && grid && keyCanvas.current && (
          <ResultStep
            results={results}
            sel={sel}
            setSel={setSel}
            grid={grid}
            keyUrl={keyUrl}
            keyCanvas={keyCanvas.current}
            pieceCut={pieceCut.current}
            onAnother={() => { clearPiece(); setResults(null); setStep("piece"); }}
            onAdjust={() => setStep("piece")}
          />
        )}
      </div>
    </div>
  );
}
