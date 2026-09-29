import { FolderOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Library } from "./components/Library";
import { ModeToggle } from "./components/ModeToggle";
import { Note } from "./components/Note";
import { StepTabs } from "./components/StepTabs";
import { placePieces, type Placement } from "./lib/batch";
import { boardOccupancy } from "./lib/board";
import { canvasToBlob, ctx2d, fileToCanvas, makeCanvas, resizeCanvas, thumbnail } from "./lib/canvas";
import { deleteSession, getCurrentSessionId, listSessions, loadSession, saveSession, setCurrentSessionId } from "./lib/db";
import { autoGrid, type Grid } from "./lib/grid";
import { findPiece, MatchCancelled, type KeyCache, type Match } from "./lib/match";
import { segmentPiece, segmentPieces, type PieceCut } from "./lib/segment";
import { hasContent, hasResult, newSession, normaliseSession, resumeStep, type Mode, type SessionRecord } from "./lib/session";
import { BatchResultStep } from "./steps/BatchResultStep";
import { BatchStep, type BatchProgress } from "./steps/BatchStep";
import { KeyStep } from "./steps/KeyStep";
import { PieceStep } from "./steps/PieceStep";
import { ResultStep } from "./steps/ResultStep";
import { FONT, P } from "./theme";
import type { Crop, Step } from "./types";

const KEY_MAX_SIDE = 1600;
const PIECE_MAX_SIDE = 1200;
const PIECES_MAX_SIDE = 1800;
const BOARD_MAX_SIDE = 1600;
const SAVE_DEBOUNCE_MS = 400;
const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface CutPiece extends PieceCut {
  thumbUrl: string;
}

function cropCanvas(src: HTMLCanvasElement, crop: Crop): HTMLCanvasElement {
  const c = makeCanvas(crop.w * src.width, crop.h * src.height);
  ctx2d(c).drawImage(src, crop.x * src.width, crop.y * src.height, crop.w * src.width, crop.h * src.height, 0, 0, c.width, c.height);
  return c;
}

export default function App() {
  const [step, setStep] = useState<Step>("key");
  const [error, setError] = useState("");

  // Session bookkeeping. Photos are kept as Blobs next to their canvases so
  // saving never re-encodes them.
  const session = useRef<SessionRecord>(newSession());
  const rawKeyBlob = useRef<Blob | null>(null);
  const keyBlob = useRef<Blob | null>(null);
  const pieceBlob = useRef<Blob | null>(null);
  const piecesBlob = useRef<Blob | null>(null);
  const boardBlob = useRef<Blob | null>(null);
  const thumb = useRef("");
  const [hydrated, setHydrated] = useState(false);
  const [library, setLibrary] = useState(false);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);

  // Step 1: the key (box art)
  const rawKey = useRef<HTMLCanvasElement | null>(null);
  const keyCanvas = useRef<HTMLCanvasElement | null>(null);
  const [rawKeyUrl, setRawKeyUrl] = useState("");
  const [keyUrl, setKeyUrl] = useState("");
  const [crop, setCrop] = useState<Crop>(FULL);
  const [count, setCount] = useState(500);
  const [manual, setManual] = useState<Grid | null>(null);
  const [rawSize, setRawSize] = useState({ w: 4, h: 3 });
  const [grid, setGrid] = useState<Grid | null>(null);

  // Step 2: one piece
  const [mode, setMode] = useState<Mode>("single");
  const pieceSrc = useRef<HTMLCanvasElement | null>(null);
  const pieceCut = useRef<HTMLCanvasElement | null>(null);
  const [pieceUrl, setPieceUrl] = useState("");
  const [cutUrl, setCutUrl] = useState("");
  const [cutArea, setCutArea] = useState(0);
  const [cutoff, setCutoff] = useState(1);
  const [straighten, setStraighten] = useState(true);

  // Step 2: many pieces
  const piecesSrc = useRef<HTMLCanvasElement | null>(null);
  const [piecesUrl, setPiecesUrl] = useState("");
  const [pieceCuts, setPieceCuts] = useState<CutPiece[]>([]);
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const [batchCutoff, setBatchCutoffState] = useState(1);
  const [batchStraighten, setBatchStraightenState] = useState(true);
  const boardSrc = useRef<HTMLCanvasElement | null>(null);
  const boardCanvas = useRef<HTMLCanvasElement | null>(null);
  const [boardUrl, setBoardUrl] = useState("");
  const [boardCrop, setBoardCrop] = useState<Crop>(FULL);
  const [boardCropUrl, setBoardCropUrl] = useState("");
  const [placements, setPlacements] = useState<Placement[] | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [batchSel, setBatchSel] = useState(0);

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
    setBatchProgress(null);
  }, []);

  /** The board photo cropped to the puzzle frame, for display and occupancy checks. */
  const cropBoard = useCallback((c: Crop) => {
    if (!boardSrc.current) {
      boardCanvas.current = null;
      setBoardCropUrl("");
      return null;
    }
    const cropped = cropCanvas(boardSrc.current, c);
    boardCanvas.current = cropped;
    setBoardCropUrl(cropped.toDataURL("image/jpeg", 0.85));
    return cropped;
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
    setMode(rec.mode);
    setBatchCutoffState(rec.batchCutoff);
    setBatchStraightenState(rec.batchStraighten);
    setExcluded(new Set(rec.excluded));
    setBoardCrop(rec.boardCrop);
    setPlacements(rec.placements);
    setBatchSel(rec.batchSel);

    const decode = async (blob: Blob | null, maxSide: number) => (blob ? fileToCanvas(blob, maxSide) : null);

    rawKeyBlob.current = rec.rawKey;
    const raw = await decode(rec.rawKey, KEY_MAX_SIDE);
    rawKey.current = raw;
    if (raw) setRawSize({ w: raw.width, h: raw.height });
    setRawKeyUrl(raw ? raw.toDataURL("image/jpeg", 0.85) : "");

    keyBlob.current = rec.key;
    const key = await decode(rec.key, KEY_MAX_SIDE);
    keyCanvas.current = key;
    setKeyUrl(key ? key.toDataURL("image/jpeg", 0.85) : "");

    pieceBlob.current = rec.piece;
    const piece = await decode(rec.piece, PIECE_MAX_SIDE);
    pieceSrc.current = piece;
    if (!piece) {
      pieceCut.current = null;
      setCutUrl("");
    }
    setPieceUrl(piece ? piece.toDataURL("image/jpeg", 0.8) : "");

    piecesBlob.current = rec.piecesPhoto;
    const pieces = await decode(rec.piecesPhoto, PIECES_MAX_SIDE);
    piecesSrc.current = pieces;
    if (!pieces) setPieceCuts([]);
    setPiecesUrl(pieces ? pieces.toDataURL("image/jpeg", 0.8) : "");

    boardBlob.current = rec.board;
    const board = await decode(rec.board, BOARD_MAX_SIDE);
    boardSrc.current = board;
    setBoardUrl(board ? board.toDataURL("image/jpeg", 0.8) : "");
    cropBoard(rec.boardCrop);

    setStep(resumeStep(rec));
    setHydrated(true);
  }, [cancelMatch, cropBoard]);

  // Boot: restore the session that was open last time, if any.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const id = getCurrentSessionId();
      const rec = id ? await loadSession(id) : null;
      try {
        await applySession(rec ? normaliseSession(rec) : newSession());
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
        mode,
        piecesPhoto: piecesUrl ? piecesBlob.current : null,
        batchCutoff,
        batchStraighten,
        excluded: [...excluded],
        board: boardUrl ? boardBlob.current : null,
        boardCrop,
        placements,
        batchSel,
      };
      if (!hasContent(rec)) return;
      session.current = rec;
      if (await saveSession(rec)) {
        setCurrentSessionId(rec.id);
        setSessions((prev) => [rec, ...prev.filter((s) => s.id !== rec.id)]);
      }
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [hydrated, rawKeyUrl, crop, count, manual, keyUrl, grid, pieceUrl, cutoff, straighten, results, sel, step, mode, piecesUrl, batchCutoff, batchStraighten, excluded, boardUrl, boardCrop, placements, batchSel]);

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
    await applySession(normaliseSession(rec));
    setLibrary(false);
  };

  const removeSession = async (id: string) => {
    if (!window.confirm("Delete this puzzle and its photos from this browser?")) return;
    await deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    // Deleting the puzzle being worked on leaves an empty one open, but stays in the library.
    if (id === session.current.id) await resetToNew();
  };

  // ---------------------------------------------------------------- step 1
  const loadKey = async (file: File) => {
    setError("");
    try {
      const c = await fileToCanvas(file, KEY_MAX_SIDE);
      rawKeyBlob.current = await canvasToBlob(c);
      thumb.current = thumbnail(c);
      rawKey.current = c;
      setRawSize({ w: c.width, h: c.height });
      setCrop(FULL);
      setManual(null);
      setRawKeyUrl(c.toDataURL("image/jpeg", 0.85));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const saveKey = async () => {
    const src = rawKey.current;
    if (!src) return;
    const c = cropCanvas(src, crop);
    keyCanvas.current = c;
    keyBlob.current = await canvasToBlob(c);
    thumb.current = thumbnail(c);
    cache.current = {};
    setKeyUrl(c.toDataURL("image/jpeg", 0.85));
    setGrid({ cols: draft.cols, rows: draft.rows });
    setResults(null);
    setPlacements(null);
    setStep("piece");
  };

  // ---------------------------------------------------------------- step 2: one piece
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

  // ---------------------------------------------------------------- step 2: many pieces
  const loadPieces = async (file: File) => {
    setError("");
    try {
      const c = await fileToCanvas(file, PIECES_MAX_SIDE);
      piecesBlob.current = await canvasToBlob(c, "image/jpeg", 0.85);
      piecesSrc.current = c;
      setPlacements(null);
      setExcluded(new Set());
      setPiecesUrl(c.toDataURL("image/jpeg", 0.8));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  // Re-cut all pieces whenever the photo or the cut settings change.
  useEffect(() => {
    if (!piecesUrl || !piecesSrc.current) return;
    const cuts = segmentPieces(piecesSrc.current, batchCutoff, batchStraighten);
    setPieceCuts(
      cuts.map((p) => {
        const s = Math.min(1, 96 / Math.max(p.canvas.width, p.canvas.height));
        return { ...p, thumbUrl: resizeCanvas(p.canvas, p.canvas.width * s, p.canvas.height * s).toDataURL("image/png") };
      }),
    );
  }, [piecesUrl, batchCutoff, batchStraighten]);

  // Changing the cut invalidates earlier placements; restoring a session does not.
  const setBatchCutoff = (v: number) => { setBatchCutoffState(v); setPlacements(null); };
  const setBatchStraighten = (v: boolean) => { setBatchStraightenState(v); setPlacements(null); };

  const clearPieces = () => {
    cancelMatch();
    piecesBlob.current = null;
    piecesSrc.current = null;
    setPiecesUrl("");
    setPieceCuts([]);
    setExcluded(new Set());
    setPlacements(null);
  };

  const togglePiece = (i: number) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
    setPlacements(null);
  };

  const loadBoard = async (file: File) => {
    setError("");
    try {
      const c = await fileToCanvas(file, BOARD_MAX_SIDE);
      boardBlob.current = await canvasToBlob(c, "image/jpeg", 0.85);
      boardSrc.current = c;
      setBoardCrop(FULL);
      setBoardUrl(c.toDataURL("image/jpeg", 0.8));
      setPlacements(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const removeBoard = () => {
    boardBlob.current = null;
    boardSrc.current = null;
    boardCanvas.current = null;
    setBoardUrl("");
    setBoardCropUrl("");
    setPlacements(null);
  };

  const runBatch = async () => {
    if (!keyCanvas.current || !grid) return;
    const pieces = pieceCuts.map((p, index) => ({ index, canvas: p.canvas })).filter((p) => !excluded.has(p.index));
    if (!pieces.length) return;
    const id = ++runId.current;
    setError("");
    setBatchProgress({ done: 0, total: pieces.length, fraction: 0 });
    try {
      const board = boardUrl ? cropBoard(boardCrop) : null;
      const occupancy = board ? boardOccupancy(board, keyCanvas.current, grid) : null;
      const placed = await placePieces({
        keyCanvas: keyCanvas.current,
        pieces,
        grid,
        cache: cache.current,
        occupancy,
        onProgress: (done, total, fraction) => { if (runId.current === id) setBatchProgress({ done, total, fraction }); },
        isCancelled: () => runId.current !== id,
      });
      if (runId.current !== id) return;
      setPlacements(placed);
      setBatchSel(Math.max(0, placed.findIndex((p) => p.chosen >= 0)));
      setStep("result");
    } catch (e) {
      if (!(e instanceof MatchCancelled)) setError(errorMessage(e));
    } finally {
      if (runId.current === id) setBatchProgress(null);
    }
  };

  const cutProblem = !!pieceUrl && (!cutUrl || cutArea < 0.02 || cutArea > 0.85);
  const savedCount = sessions.length;
  const showResult = hasResult({ mode, results, placements });

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
            <StepTabs step={step} setStep={setStep} hasKey={!!keyUrl} hasResult={showResult} />

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
              <>
                <ModeToggle mode={mode} setMode={(m) => { cancelMatch(); setMode(m); }} />
                {mode === "single" ? (
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
                ) : (
                  grid && (
                    <BatchStep
                      piecesUrl={piecesUrl}
                      pieces={pieceCuts}
                      excluded={excluded}
                      onToggle={togglePiece}
                      cutoff={batchCutoff}
                      setCutoff={setBatchCutoff}
                      straighten={batchStraighten}
                      setStraighten={setBatchStraighten}
                      onLoadPieces={loadPieces}
                      onRetakePieces={clearPieces}
                      boardUrl={boardUrl}
                      boardCrop={boardCrop}
                      setBoardCrop={(c) => { setBoardCrop(c); setPlacements(null); }}
                      grid={grid}
                      onLoadBoard={loadBoard}
                      onRemoveBoard={removeBoard}
                      progress={batchProgress}
                      onRun={runBatch}
                      onCancel={cancelMatch}
                    />
                  )
                )}
              </>
            )}

            {step === "result" && mode === "single" && results && results.length > 0 && grid && keyCanvas.current && (
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

            {step === "result" && mode === "batch" && placements && placements.length > 0 && grid && keyCanvas.current && (
              <BatchResultStep
                placements={placements}
                pieces={pieceCuts}
                grid={grid}
                keyUrl={keyUrl}
                keyCanvas={keyCanvas.current}
                boardUrl={boardUrl ? boardCropUrl : ""}
                sel={batchSel}
                setSel={setBatchSel}
                onMore={() => { clearPieces(); setStep("piece"); }}
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
