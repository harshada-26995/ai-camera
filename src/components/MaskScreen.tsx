"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createHistory, historyReducer, type History, type HistoryAction } from "@/lib/history";
import type { Photo } from "@/lib/image";
import { closeAndFeather, floodSelect, mergeMax, strokeSegment, stampBrush, unionRect, type BrushMode, type Rect } from "@/lib/mask";
import type { DetectStage } from "@/lib/segmentation";
import Viewport, { type DrawEvent, type ViewportHandle } from "./Viewport";
import { IconBack, IconBrush, IconEraser, IconEye, IconEyeOff, IconFit, IconRedo, IconRestore, IconSparkle, IconUndo, IconWand, IconZoomIn, IconZoomOut } from "./icons";
import { Button, IconButton, Slider, Spinner, TopBar, cx } from "./ui";

export type DetectState =
  | { status: "idle" }
  | { status: "running"; stage: DetectStage }
  | { status: "done"; trousersSeparated: boolean }
  | { status: "empty" }
  | { status: "failed"; message: string };

type Tool = BrushMode | "magic";

const MASK_RGB = [196, 83, 46] as const;
const MASK_HISTORY_LIMIT = 15;

const maskHistoryReducer = (h: History<Uint8Array>, a: HistoryAction<Uint8Array>) => historyReducer(h, a, MASK_HISTORY_LIMIT);

const STAGE_TEXT: Record<DetectStage, string> = {
  "loading-model": "Loading the shirt detector — first time only",
  detecting: "Finding the shirt",
  refining: "Refining edges around collar and sleeves",
};

export default function MaskScreen({
  photo,
  autoMask,
  initialMask,
  detect,
  onRedetect,
  onBack,
  onDone,
}: {
  photo: Photo;
  autoMask: Uint8Array | null;
  initialMask: Uint8Array | null;
  detect: DetectState;
  onRedetect: () => void;
  onBack: () => void;
  onDone: (mask: Uint8Array) => void;
}) {
  const { width: W, height: H } = photo;
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const overlayData = useRef<ImageData | null>(null);
  const viewportRef = useRef<ViewportHandle>(null);
  const [initial] = useState(() => (initialMask ? initialMask.slice() : new Uint8Array(W * H)));
  const maskRef = useRef<Uint8Array>(initial);
  const [history, dispatch] = useReducer(maskHistoryReducer, initial, (m) => createHistory(m.slice()));
  const [tool, setTool] = useState<Tool>("add");
  const [brushPx, setBrushPx] = useState(22);
  const [tolerance, setTolerance] = useState(14);
  const [showOverlay, setShowOverlay] = useState(true);
  const [cursor, setCursor] = useState<{ x: number; y: number; r: number } | null>(null);
  const [hasMask, setHasMask] = useState(() => initial.some((v) => v > 0));
  const stroke = useRef<{ last: { x: number; y: number }; dirty: Rect | null } | null>(null);
  const rafRef = useRef(0);
  const pendingDirty = useRef<Rect | null>(null);
  const appliedAuto = useRef<Uint8Array | null>(initialMask ? autoMask : null);

  const paintOverlay = useCallback(
    (rect: Rect | null) => {
      const ctx = overlayRef.current?.getContext("2d");
      const img = overlayData.current;
      if (!ctx || !img) return;
      const r = rect ?? { x: 0, y: 0, w: W, h: H };
      const m = maskRef.current;
      const d = img.data;
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const i = y * W + x;
          d[i * 4 + 3] = (m[i] * 150) >> 8;
        }
      }
      ctx.putImageData(img, 0, 0, r.x, r.y, r.w, r.h);
    },
    [W, H],
  );

  const schedulePaint = useCallback(
    (rect: Rect | null) => {
      pendingDirty.current = unionRect(pendingDirty.current, rect);
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const r = pendingDirty.current;
        pendingDirty.current = null;
        if (r) paintOverlay(r);
      });
    },
    [paintOverlay],
  );

  // Base photo + overlay buffers.
  useEffect(() => {
    baseRef.current?.getContext("2d")?.putImageData(photo.imageData, 0, 0);
    const ctx = overlayRef.current?.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      img.data[i * 4] = MASK_RGB[0];
      img.data[i * 4 + 1] = MASK_RGB[1];
      img.data[i * 4 + 2] = MASK_RGB[2];
    }
    overlayData.current = img;
    paintOverlay(null);
    return () => cancelAnimationFrame(rafRef.current);
  }, [photo, W, H, paintOverlay]);

  const loadSnapshot = useCallback(
    (snapshot: Uint8Array) => {
      maskRef.current.set(snapshot);
      setHasMask(snapshot.some((v) => v > 0));
      paintOverlay(null);
    },
    [paintOverlay],
  );

  const commit = useCallback(() => {
    const snap = maskRef.current.slice();
    dispatch({ type: "set", value: snap, commit: true });
    setHasMask(snap.some((v) => v > 0));
  }, []);

  // A freshly detected mask becomes the working mask (as an undoable step).
  useEffect(() => {
    if (!autoMask || appliedAuto.current === autoMask) return;
    appliedAuto.current = autoMask;
    maskRef.current.set(autoMask);
    paintOverlay(null);
    commit();
  }, [autoMask, paintOverlay, commit]);

  const undo = () => {
    const next = historyReducer(history, { type: "undo" }, MASK_HISTORY_LIMIT);
    dispatch({ type: "undo" });
    loadSnapshot(next.present);
  };
  const redo = () => {
    const next = historyReducer(history, { type: "redo" }, MASK_HISTORY_LIMIT);
    dispatch({ type: "redo" });
    loadSnapshot(next.present);
  };

  const onDraw = (e: DrawEvent) => {
    const radius = brushPx / e.screenScale;
    const inside = e.x >= 0 && e.y >= 0 && e.x < W && e.y < H;
    if (tool === "magic") {
      if (e.phase === "start" && inside) {
        const region = floodSelect(photo.imageData.data, W, H, e.x, e.y, tolerance);
        mergeMax(maskRef.current, closeAndFeather(region, W, H, 1));
        paintOverlay(null);
        commit();
      }
      return;
    }
    if (e.phase !== "cancel" && e.phase !== "end") setCursor({ x: e.x, y: e.y, r: radius });
    const ref = autoMask;
    if (e.phase === "start") {
      const dirty = stampBrush(maskRef.current, ref, W, H, e.x, e.y, radius, 0.55, tool);
      stroke.current = { last: { x: e.x, y: e.y }, dirty };
      schedulePaint(dirty);
    } else if (e.phase === "move" && stroke.current) {
      const dirty = strokeSegment(maskRef.current, ref, W, H, stroke.current.last, e, radius, 0.55, tool);
      stroke.current.last = { x: e.x, y: e.y };
      stroke.current.dirty = unionRect(stroke.current.dirty, dirty);
      schedulePaint(dirty);
    } else if (e.phase === "end" && stroke.current) {
      stroke.current = null;
      commit();
    } else if (e.phase === "cancel") {
      stroke.current = null;
      loadSnapshot(history.present); // a pinch started: discard the partial stroke
    }
  };

  const running = detect.status === "running";
  const tools: { id: Tool; label: string; icon: React.ReactNode; hint: string }[] = [
    { id: "add", label: "Brush", icon: <IconBrush size={18} />, hint: "Paint to add shirt — collar, cuffs, buttons." },
    { id: "erase", label: "Erase", icon: <IconEraser size={18} />, hint: "Paint to remove areas that aren't shirt." },
    { id: "restore", label: "Restore", icon: <IconRestore size={18} />, hint: "Paint to bring back the automatic selection." },
    { id: "magic", label: "Magic", icon: <IconWand size={18} />, hint: "Tap the shirt to select similar connected fabric." },
  ];
  const activeTool = tools.find((t) => t.id === tool);

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        step={2}
        left={
          <IconButton label="Back" onClick={onBack}>
            <IconBack />
          </IconButton>
        }
        right={
          <Button className="h-10 px-5" disabled={!hasMask || running} onClick={() => onDone(maskRef.current.slice())}>
            Continue
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-0 flex-1 bg-sand/60">
          <Viewport
            ref={viewportRef}
            width={W}
            height={H}
            mode={running ? "pan" : "draw"}
            onDraw={onDraw}
            onHover={(p) => setCursor(p && tool !== "magic" ? { x: p.x, y: p.y, r: brushPx / p.screenScale } : null)}
            overlay={
              cursor && (
                <div
                  className="pointer-events-none absolute rounded-full border border-white mix-blend-difference"
                  style={{
                    left: `${((cursor.x - cursor.r) / W) * 100}%`,
                    top: `${((cursor.y - cursor.r) / H) * 100}%`,
                    width: `${((2 * cursor.r) / W) * 100}%`,
                    height: `${((2 * cursor.r) / H) * 100}%`,
                  }}
                />
              )
            }
          >
            <canvas ref={baseRef} width={W} height={H} className="absolute inset-0 h-full w-full" />
            <canvas
              ref={overlayRef}
              width={W}
              height={H}
              className={cx("absolute inset-0 h-full w-full transition-opacity duration-200", showOverlay ? "opacity-100" : "opacity-0")}
              aria-label="Shirt selection overlay"
            />
          </Viewport>

          <div className="pointer-events-none absolute inset-x-3 top-3 flex justify-center">
            <DetectBanner detect={detect} onRetry={onRedetect} />
          </div>

          <div className="absolute bottom-3 right-3 flex flex-col gap-1 rounded-full border border-line bg-paper/90 p-1 shadow-sm backdrop-blur">
            <IconButton label="Zoom in" onClick={() => viewportRef.current?.zoomIn()}>
              <IconZoomIn size={18} />
            </IconButton>
            <IconButton label="Zoom out" onClick={() => viewportRef.current?.zoomOut()}>
              <IconZoomOut size={18} />
            </IconButton>
            <IconButton label="Fit to screen" onClick={() => viewportRef.current?.reset()}>
              <IconFit size={18} />
            </IconButton>
          </div>
        </div>

        <aside className="shrink-0 border-t border-line bg-paper/80 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:w-[360px] md:border-l md:border-t-0 md:px-7 md:pt-8">
          <h2 className="hidden font-display text-2xl md:block">Confirm the shirt</h2>
          <p className="mb-5 hidden text-[0.875rem] leading-relaxed text-muted md:block">
            Only the tinted area will change. His face, skin, trousers and the background stay exactly as photographed.
          </p>
          <div className="grid grid-cols-4 gap-1 rounded-2xl border border-line bg-paper p-1" role="radiogroup" aria-label="Mask tool">
            {tools.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={tool === t.id}
                onClick={() => setTool(t.id)}
                className={cx(
                  "flex h-14 flex-col items-center justify-center gap-1 rounded-xl text-[0.75rem] font-medium transition-colors",
                  tool === t.id ? "bg-ink text-paper" : "text-ink-soft hover:bg-sand",
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
          <p className="mt-2 min-h-[1.25rem] text-[0.8125rem] text-muted">{activeTool?.hint}</p>
          <div className="mt-1">
            {tool === "magic" ? (
              <Slider label="Colour tolerance" value={tolerance} min={4} max={40} step={1} format={(v) => String(v)} onChange={setTolerance} />
            ) : (
              <Slider label="Brush size" value={brushPx} min={4} max={80} step={1} format={(v) => `${v}px`} onChange={setBrushPx} />
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <IconButton label="Undo" disabled={history.past.length === 0} onClick={undo}>
              <IconUndo size={18} />
            </IconButton>
            <IconButton label="Redo" disabled={history.future.length === 0} onClick={redo}>
              <IconRedo size={18} />
            </IconButton>
            <IconButton label={showOverlay ? "Hide selection" : "Show selection"} onClick={() => setShowOverlay((v) => !v)}>
              {showOverlay ? <IconEye size={18} /> : <IconEyeOff size={18} />}
            </IconButton>
            <div className="flex-1" />
            <button
              type="button"
              disabled={running}
              onClick={onRedetect}
              className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-medium text-ink-soft hover:bg-sand disabled:opacity-40"
            >
              <IconSparkle size={16} /> Auto-detect
            </button>
            <button
              type="button"
              onClick={() => {
                maskRef.current.fill(0);
                paintOverlay(null);
                commit();
              }}
              className="inline-flex h-10 items-center rounded-full px-3 text-[0.8125rem] font-medium text-ink-soft hover:bg-sand"
            >
              Clear
            </button>
          </div>
          <p className="mt-1 hidden text-[0.75rem] text-muted md:block">Tip: pinch or scroll to zoom in on the collar; two fingers pan without painting.</p>
        </aside>
      </div>
    </div>
  );
}

function DetectBanner({ detect, onRetry }: { detect: DetectState; onRetry: () => void }) {
  if (detect.status === "idle") return null;
  const base = "pointer-events-auto flex max-w-md items-start gap-2.5 rounded-2xl border px-4 py-2.5 text-[0.8125rem] leading-snug shadow-sm backdrop-blur";
  if (detect.status === "running") {
    return (
      <div className={cx(base, "border-line bg-paper/95 text-ink")} role="status">
        <Spinner size={16} />
        <span>{STAGE_TEXT[detect.stage]}…</span>
      </div>
    );
  }
  if (detect.status === "done") {
    return (
      <div className={cx(base, "rise border-line bg-paper/95 text-ink-soft")} role="status">
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-mask" />
        <span>
          Shirt found{detect.trousersSeparated ? ", trousers excluded" : ""}. Check the collar, cuffs and buttons, then continue.
        </span>
      </div>
    );
  }
  const text =
    detect.status === "empty"
      ? "We couldn't find a shirt automatically. Tap the shirt with Magic, or paint it with the Brush."
      : `Automatic detection isn't available (${detect.message}). Select the shirt manually with Magic or the Brush.`;
  return (
    <div className={cx(base, "border-danger/25 bg-paper/95 text-ink")} role="alert">
      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-danger" />
      <span className="flex-1">{text}</span>
      <button type="button" onClick={onRetry} className="shrink-0 font-medium underline underline-offset-2">
        Retry
      </button>
    </div>
  );
}
