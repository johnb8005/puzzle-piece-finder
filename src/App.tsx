import { FolderOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Library } from "./components/Library";
import { Note } from "./components/Note";
import { StepTabs } from "./components/StepTabs";
import { canvasToBlob, ctx2d, fileToCanvas, makeCanvas, thumbnail } from "./lib/canvas";
import { deleteSession, getCurrentSessionId, listSessions, loadSession, saveSession, setCurrentSessionId } from "./lib/db";
import { autoGrid, type Grid } from "./lib/grid";
import { findPiece, MatchCancelled, type KeyCache, type Match } from "./lib/match";
import { segmentPiece } from "./lib/segment";
import { hasContent, newSession, resumeStep, type SessionRecord } from "./lib/session";
import { KeyStep } from "./steps/KeyStep";
import { PieceStep } from "./steps/PieceStep";
import { ResultStep } from "./steps/ResultStep";
import { FONT, P } from "./theme";
import type { Crop, Step } from "./types";

const KEY_MAX_SIDE = 1600;
const PIECE_MAX_SIDE = 1200;
const SAVE_DEBOUNCE_MS = 400;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [step, setStep] = useState<Step>("key");
  const [error, setError] = useState("");

  // Session bookkeeping. Photos are kept as Blobs next to their canvases so
  // saving never re-encodes them.
  const session = useRef<SessionRecord>(newSession());
  const rawKeyBlob = useRef<Blob | null>(null);
  const keyBlob = useRef<Blob | null>(null);
  const pieceBlob = useRef<Blob | null>(null);
  const thumb = useRef("");
  const [hydrated, setHydrated] = useState(false);
  const [library, setLibrary] = useState(false);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);

  // Step 1: the key (box art)
  const rawKey = useRef<HTMLCanvasElement | null>(null);
  const keyCanvas = useRef<HTMLCanvasElement | null>(null);
  const [rawKeyUrl, setRawKeyUrl] = useState("");
  const [keyUrl, setKeyUrl] = useState("");
  const [crop, setCrop] = useState<Crop>(session.current.crop);
  const [count, setCount] = useState(session.current.count);
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

  const cancelMatch = useCallback(() => {
    runId.current++;
    setProgress(null);
  }, []);

  /** Replace all working state with a session record, decoding its photos. */
  const applySession = useCallback(async (rec: SessionRecord) => {
    cancelMatch();
    setHydrated(false);
    session.current = rec;
    thumb.current = rec.thumb;
    cache.current = {};
    setError("");
    setCrop(rec.crop);
    setCount(rec.count);
    setManual(rec.manual);
    setGrid(rec.grid);
    setCutoff(rec.cutoff);
    setStraighten(rec.straighten);
    setResults(rec.results);
    setSel(rec.sel);

    rawKeyBlob.current = rec.rawKey;
    if (rec.rawKey) {
      const c = await fileToCanvas(rec.rawKey, KEY_MAX_SIDE);
      rawKey.current = c;
      setRawSize({ w: c.width, h: c.height });
      setRawKeyUrl(c.toDataURL("image/jpeg", 0.85));
    } else {
      rawKey.current = null;
      setRawKeyUrl("");
    }
    keyBlob.current = rec.key;
    if (rec.key) {
      const c = await fileToCanvas(rec.key, KEY_MAX_SIDE);
      keyCanvas.current = c;
      setKeyUrl(c.toDataURL("image/jpeg", 0.85));
    } else {
      keyCanvas.current = null;
      setKeyUrl("");
    }
    pieceBlob.current = rec.piece;
    if (rec.piece) {
      const c = await fileToCanvas(rec.piece, PIECE_MAX_SIDE);
      pieceSrc.current = c;
      setPieceUrl(c.toDataURL("image/jpeg", 0.8));
    } else {
      pieceSrc.current = null;
      pieceCut.current = null;
      setPieceUrl("");
      setCutUrl("");
    }
    setStep(resumeStep(rec));
    setHydrated(true);
  }, [cancelMatch]);

  // Boot: restore the session that was open last time, if any.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const id = getCurrentSessionId();
      const rec = id ? await loadSession(id) : null;
      try {
        await applySession(rec ?? newSession());
      } catch {
        await applySession(newSession());
      }
      setSessions(await listSessions());
    })();
  }, [applySession]);

  // Persist: write the current session shortly after anything changes.
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(async () => {
      const rec: SessionRecord = {
        ...session.current,
        updatedAt: Date.now(),
        thumb: thumb.current,
        rawKey: rawKeyUrl ? rawKeyBlob.current : null,
        crop,
        count,
        manual,
        key: keyUrl ? keyBlob.current : null,
        grid,
        piece: pieceUrl ? pieceBlob.current : null,
        cutoff,
        straighten,
        results,
        sel,
        step,
      };
      if (!hasContent(rec)) return;
      session.current = rec;
      if (await saveSession(rec)) {
        setCurrentSessionId(rec.id);
        setSessions((prev) => [rec, ...prev.filter((s) => s.id !== rec.id)]);
      }
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [hydrated, rawKeyUrl, crop, count, manual, keyUrl, grid, pieceUrl, cutoff, straighten, results, sel, step]);

  const openLibrary = async () => {
    setSessions(await listSessions());
    setLibrary(true);
  };

  const resetToNew = async () => {
    const rec = newSession();
    setCurrentSessionId(rec.id);
    await applySession(rec);
  };

  const startNew = async () => {
    await resetToNew();
    setLibrary(false);
  };

  const openSession = async (id: string) => {
    const rec = await loadSession(id);
    if (!rec) {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      return;
    }
    setCurrentSessionId(rec.id);
    await applySession(rec);
    setLibrary(false);
  };

  const removeSession = async (id: string) => {
    if (!window.confirm("Delete this puzzle and its photos from this browser?")) return;
    await deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    // Deleting the puzzle being worked on leaves an empty one open, but stays in the library.
    if (id === session.current.id) await resetToNew();
  };

  const loadKey = async (file: File) => {
    setError("");
    try {
      const c = await fileToCanvas(file, KEY_MAX_SIDE);
      rawKeyBlob.current = await canvasToBlob(c);
      thumb.current = thumbnail(c);
      rawKey.current = c;
      setRawSize({ w: c.width, h: c.height });
      setCrop({ x: 0, y: 0, w: 1, h: 1 });
      setManual(null);
      setRawKeyUrl(c.toDataURL("image/jpeg", 0.85));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const saveKey = async () => {
    const src = rawKey.current;
    if (!src) return;
    const sx = crop.x * src.width;
    const sy = crop.y * src.height;
    const sw = crop.w * src.width;
    const sh = crop.h * src.height;
    const c = makeCanvas(sw, sh);
    ctx2d(c).drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    keyCanvas.current = c;
    keyBlob.current = await canvasToBlob(c);
    thumb.current = thumbnail(c);
    setKeyUrl(c.toDataURL("image/jpeg", 0.85));
    setGrid({ cols: draft.cols, rows: draft.rows });
    setResults(null);
    setStep("piece");
  };

  const loadPiece = async (file: File) => {
    setError("");
    try {
      const c = await fileToCanvas(file, PIECE_MAX_SIDE);
      pieceBlob.current = await canvasToBlob(c, "image/jpeg", 0.8);
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

  const clearPiece = () => {
    cancelMatch();
    pieceBlob.current = null;
    setPieceUrl("");
    setCutUrl("");
  };

  const cutProblem = !!pieceUrl && (!cutUrl || cutArea < 0.02 || cutArea > 0.85);
  const savedCount = sessions.length;

  return (
    <div style={{ minHeight: "100vh", background: P.felt, color: P.paper, fontFamily: FONT }}>
      <div className="mx-auto flex flex-col gap-5" style={{ maxWidth: 520, padding: "22px 16px 40px" }}>
        <header className="flex items-start justify-between gap-3">
          <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1, margin: 0 }}>Where does this piece go?</h1>
          <button
            className="pf-btn"
            onClick={() => (library ? setLibrary(false) : openLibrary())}
            aria-pressed={library}
            style={{
              display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginTop: 4, padding: "7px 12px", borderRadius: 999,
              fontFamily: FONT, fontWeight: 700, fontSize: 13, cursor: "pointer",
              background: library ? P.paper : "transparent", color: library ? P.ink : P.paper, border: `1.5px solid ${library ? P.paper : P.line}`,
            }}
          >
            <FolderOpen size={16} /> Puzzles
          </button>
        </header>

        {library ? (
          <Library
            sessions={sessions}
            currentId={hasContent(session.current) ? session.current.id : null}
            onOpen={openSession}
            onDelete={removeSession}
            onNew={startNew}
            onClose={() => setLibrary(false)}
          />
        ) : (
          <>
            <StepTabs step={step} setStep={setStep} hasKey={!!keyUrl} hasResult={!!results} />

            {error && <Note>{error}</Note>}

            {step === "key" && (
              <KeyStep
                rawKeyUrl={rawKeyUrl}
                hasSavedKey={!!keyUrl}
                savedCount={hydrated && !rawKeyUrl ? savedCount : 0}
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
                onOpenLibrary={openLibrary}
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
          </>
        )}

        <footer style={{ marginTop: 8, fontSize: 13, color: P.dim, display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>Saved in this browser only.</span>
          <a href={import.meta.env.BASE_URL} style={{ color: P.dim }}>About</a>
        </footer>
      </div>
    </div>
  );
}
