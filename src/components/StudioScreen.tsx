"use client";

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { createHistory, historyReducer, type History, type HistoryAction } from "@/lib/history";
import { canvasToBlob, type Photo } from "@/lib/image";
import { resetAdjustments, sameLook, type LookSettings } from "@/lib/look";
import { CUSTOM_COLOR_ID, PATTERNS, getTile, resolvePattern, tileKey, warmTiles, type PatternCategory, type PatternDef } from "@/lib/patterns";
import { TryOnRenderer, WebGLUnavailableError } from "@/lib/renderer";
import AdjustPanel from "./AdjustPanel";
import CustomPrintDialog from "./CustomPrintDialog";
import FabricCameraPanel from "./FabricCameraPanel";
import { LIVE_FABRIC_KEY } from "@/lib/fabricCamera";
import PatternPicker from "./PatternPicker";
import { useMediaQuery } from "./useMediaQuery";
import Viewport, { type DrawEvent, type ViewportHandle } from "./Viewport";
import { IconBack, IconCompare, IconDownload, IconFit, IconRedo, IconReset, IconTrash, IconUndo, IconZoomIn, IconZoomOut } from "./icons";
import { Button, IconButton, Segmented, Switch, TopBar, cx } from "./ui";

type LookHistory = History<LookSettings>;
const lookReducer = (h: LookHistory, a: HistoryAction<LookSettings>) => historyReducer(h, a);

declare global {
  interface Window {
    __drape?: { lastSwitchMs: number | null; readPixels: () => Uint8Array | null; mask: Uint8Array; photo: Uint8ClampedArray };
  }
}

export default function StudioScreen({
  photo,
  mask,
  initialLook,
  customPatterns,
  onCustomPatterns,
  onLookChange,
  remember,
  onRemember,
  onEditMask,
  onRemovePhoto,
}: {
  photo: Photo;
  mask: Uint8Array;
  initialLook: LookSettings;
  customPatterns: PatternDef[];
  onCustomPatterns: (p: PatternDef[]) => void;
  onLookChange: (look: LookSettings) => void;
  remember: boolean;
  onRemember: (v: boolean) => void;
  onEditMask: () => void;
  onRemovePhoto: () => void;
}) {
  const [history, dispatch] = useReducer(lookReducer, initialLook, createHistory);
  const look = history.present;
  const [showOriginal, setShowOriginal] = useState(false);
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(0.5);
  const [panel, setPanel] = useState<"patterns" | "adjust">("patterns");
  const [moveMode, setMoveMode] = useState(false);
  const [showAddPrint, setShowAddPrint] = useState(false);
  const [glError, setGlError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [fabricCam, setFabricCam] = useState(false);
  /** Latest tile from the camera while "Fabric from camera" is open. */
  const liveFabric = useRef<HTMLCanvasElement | null>(null);
  const desktop = useMediaQuery("(min-width: 768px)");

  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<TryOnRenderer | null>(null);
  const viewportRef = useRef<ViewportHandle>(null);
  const switchStart = useRef<number | null>(null);
  const lastSwitchMs = useRef<number | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const current = resolvePattern(look.patternId, look.customColor, customPatterns);
  const [category, setCategory] = useState<PatternCategory>(current.category);

  const draw = useCallback(() => {
    const r = rendererRef.current;
    if (!r) return;
    if (liveFabric.current) {
      r.updatePattern({ key: LIVE_FABRIC_KEY, canvas: liveFabric.current, tileFraction: 1, cover: true });
    } else {
      r.setPattern({ key: tileKey(current), canvas: getTile(current), tileFraction: current.tileFraction, cover: current.cover });
    }
    r.render(look, { showOriginal, split: compare ? split : null });
  }, [current, look, showOriginal, compare, split]);

  const drawRef = useRef(draw);
  useLayoutEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  // Renderer lifetime: one GL canvas per photo + mask.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.className = "absolute inset-0 h-full w-full";
    canvas.setAttribute("aria-label", "Try-on preview");
    canvas.setAttribute("role", "img");
    host.appendChild(canvas);
    let renderer: TryOnRenderer | null = null;
    try {
      renderer = new TryOnRenderer(canvas);
      renderer.setPhoto(photo.imageData);
      renderer.setMask(mask);
      renderer.onRestoredCallback = () => drawRef.current();
      rendererRef.current = renderer;
      drawRef.current();
    } catch (e) {
      // Reporting a failure of the external GL system is the one state update this effect makes.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGlError(e instanceof WebGLUnavailableError ? e.message : "The preview couldn't start on this device.");
    }
    const debug = new URLSearchParams(window.location.search).has("debug");
    if (debug && renderer) {
      const gl = canvas.getContext("webgl");
      window.__drape = {
        get lastSwitchMs() {
          return lastSwitchMs.current;
        },
        readPixels: () => {
          if (!gl) return null;
          const out = new Uint8Array(photo.width * photo.height * 4);
          gl.readPixels(0, 0, photo.width, photo.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
          return out;
        },
        mask,
        photo: photo.imageData.data,
      };
    }
    return () => {
      renderer?.dispose();
      rendererRef.current = null;
      canvas.remove();
      canvas.width = 0;
      canvas.height = 0;
      if (debug) delete window.__drape;
    };
  }, [photo, mask]);

  // Every state change redraws synchronously before paint.
  useLayoutEffect(() => {
    draw();
    if (switchStart.current !== null) {
      lastSwitchMs.current = performance.now() - switchStart.current;
      switchStart.current = null;
    }
  }, [draw]);

  useEffect(() => warmTiles(PATTERNS), []);

  useEffect(() => {
    onLookChange(look);
  }, [look, onLookChange]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const set = (patch: Partial<LookSettings>, commit: boolean) => {
    const next = { ...look, ...patch };
    if (sameLook(next, look)) return;
    dispatch({ type: "set", value: next, commit });
  };
  const commit = () => dispatch({ type: "commit" });

  const selectPattern = (id: string) => {
    switchStart.current = performance.now();
    setShowOriginal(false);
    set({ patternId: id }, true);
  };

  const onCustomColor = useCallback(
    (hex: string, commitNow: boolean) => {
      if (commitNow) {
        dispatch({ type: "commit" });
        return;
      }
      dispatch({ type: "set", value: { ...history.present, patternId: CUSTOM_COLOR_ID, customColor: hex }, commit: false });
    },
    [history.present],
  );

  // Each camera frame re-draws his photo with the fabric the camera sees.
  const onCameraFrame = useCallback((tile: HTMLCanvasElement | null) => {
    liveFabric.current = tile;
    drawRef.current();
  }, []);

  const keepCameraColour = (hex: string) => {
    setFabricCam(false);
    setCategory("solids");
    dispatch({ type: "set", value: { ...look, patternId: CUSTOM_COLOR_ID, customColor: hex }, commit: true });
    setToast("Colour kept — find it under Solids › Any colour");
  };

  const onDrag = (e: DrawEvent) => {
    const r = rendererRef.current;
    if (!r) return;
    if (e.phase === "start") {
      drag.current = { x: e.x, y: e.y };
    } else if (e.phase === "move" && drag.current) {
      const d = r.dragToOffset(e.x - drag.current.x, e.y - drag.current.y, look, fabricCam ? { tileFraction: 1, cover: true } : current);
      drag.current = { x: e.x, y: e.y };
      const wrap = (v: number) => ((((v + 0.5) % 1) + 1) % 1) - 0.5;
      set({ offsetX: wrap(look.offsetX + d.x), offsetY: wrap(look.offsetY + d.y) }, false);
    } else {
      drag.current = null;
      commit();
    }
  };

  const save = async () => {
    const r = rendererRef.current;
    if (!r || saving) return;
    setSaving(true);
    try {
      r.render(look, { showOriginal: false, split: null });
      const blobPromise = canvasToBlob(r.canvas, "image/jpeg", 0.95);
      draw();
      const blob = await blobPromise;
      const name = `drape-${current.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.jpg`;
      const file = new File([blob], name, { type: "image/jpeg" });
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      if (coarse && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "Shirt try-on" });
          return;
        } catch (e) {
          if ((e as DOMException).name === "AbortError") return;
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setToast("Saved to your downloads");
    } catch {
      setToast("Couldn't save the image. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const addPrint = (tile: HTMLCanvasElement, name: string, cover = false) => {
    const def: PatternDef = { id: `custom-${Date.now()}`, name, category: "custom", tileFraction: 0.35, base: "#ddd", canvas: tile, cover };
    onCustomPatterns([...customPatterns, def]);
    setShowAddPrint(false);
    setCategory("custom");
    switchStart.current = performance.now();
    dispatch({ type: "set", value: { ...look, patternId: def.id }, commit: true });
  };

  const removePrint = (id: string) => {
    rendererRef.current?.forgetPattern(id);
    onCustomPatterns(customPatterns.filter((p) => p.id !== id));
    if (look.patternId === id) set({ patternId: PATTERNS[0]!.id }, true);
  };

  const isSolid = !fabricCam && current.category === "solids";
  const wearingName = fabricCam ? "Fabric from camera" : current.name;
  const compareHandle = compare && !showOriginal && (
    <div className="absolute inset-y-0 z-10" style={{ left: `${split * 100}%` }}>
      <div className="absolute inset-y-0 -ml-px w-0.5 bg-paper shadow-[0_0_0_0.5px_rgba(0,0,0,0.25)]" />
      <div
        role="slider"
        aria-label="Compare original and try-on"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(split * 100)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setSplit((s) => Math.max(0, s - 0.05));
          if (e.key === "ArrowRight") setSplit((s) => Math.min(1, s + 0.05));
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const parent = e.currentTarget.parentElement?.parentElement?.getBoundingClientRect();
          if (parent) setSplit(Math.min(1, Math.max(0, (e.clientX - parent.left) / parent.width)));
        }}
        className="absolute top-1/2 -ml-5 -mt-5 flex h-10 w-10 cursor-ew-resize touch-none items-center justify-center rounded-full border border-line bg-paper text-ink shadow-md"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="m9 7-5 5 5 5M15 7l5 5-5 5" />
        </svg>
      </div>
    </div>
  );

  const labels = compare && !showOriginal && (
    <>
      <span className="tag pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-paper/90 px-2.5 py-1 text-ink">Before</span>
      <span className="tag pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-paper/90 px-2.5 py-1 text-ink">After</span>
    </>
  );

  const picker = (
    <PatternPicker
      patterns={PATTERNS}
      customPatterns={customPatterns}
      category={category}
      onCategory={setCategory}
      selectedId={look.patternId}
      customColor={look.customColor}
      onSelect={selectPattern}
      onCustomColor={onCustomColor}
      onAddPrint={() => setShowAddPrint(true)}
      onRemovePrint={removePrint}
      onCamera={() => {
        viewportRef.current?.reset();
        setFabricCam(true);
      }}
    />
  );
  const cameraPanel = fabricCam && (
    <FabricCameraPanel
      onFrame={onCameraFrame}
      onClose={() => setFabricCam(false)}
      onKeepPrint={(tile) => {
        setFabricCam(false);
        addPrint(tile, `Camera fabric ${customPatterns.filter((p) => p.name.startsWith("Camera fabric")).length + 1}`, true);
        setToast("Fabric kept in Your prints");
      }}
      onKeepColour={keepCameraColour}
      compact={!desktop}
    />
  );
  const adjust = (
    <AdjustPanel
      look={look}
      isSolid={isSolid}
      onChange={(p) => set(p, false)}
      onCommit={commit}
      onReset={() => set(resetAdjustments(look), true)}
      moveMode={moveMode}
      onMoveMode={setMoveMode}
    />
  );
  const privacy = (
    <div className="space-y-3 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[0.875rem] font-medium">Keep on this device</p>
          <p className="text-[0.75rem] leading-snug text-muted">Saves the photo and shirt selection in this browser only. Off by default.</p>
        </div>
        <Switch label="Keep on this device" checked={remember} onChange={onRemember} />
      </div>
      <button type="button" onClick={onRemovePhoto} className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-danger hover:underline">
        <IconTrash size={15} /> Remove photo & start over
      </button>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        step={3}
        left={
          <button type="button" onClick={onEditMask} className="inline-flex h-11 items-center gap-1 rounded-full pl-1.5 pr-3 text-[0.8125rem] font-medium hover:bg-sand">
            <IconBack size={18} /> <span>Edit shirt</span>
          </button>
        }
        right={
          <Button className="h-10 px-4" onClick={save} disabled={saving || !!glError}>
            <IconDownload size={17} /> <span className="hidden sm:inline">Save</span>
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-0 flex-1 bg-sand/60">
          {glError ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-[0.9375rem] text-ink-soft">{glError}</div>
          ) : (
            <Viewport
              ref={viewportRef}
              width={photo.width}
              height={photo.height}
              mode={moveMode ? "draw" : "pan"}
              onDraw={onDrag}
              overlay={
                <>
                  {compareHandle}
                  {labels}
                </>
              }
            >
              <div ref={hostRef} className={cx("absolute inset-0", moveMode && "cursor-move")} />
            </Viewport>
          )}

          <div className="absolute left-3 top-3">
            <Segmented<"orig" | "try">
              label="Preview mode"
              size="sm"
              value={showOriginal ? "orig" : "try"}
              onChange={(v) => setShowOriginal(v === "orig")}
              options={[
                { value: "orig", label: "Original" },
                { value: "try", label: "Try-on" },
              ]}
            />
          </div>

          <div className={cx("absolute inset-x-0 bottom-3 flex justify-center px-3", fabricCam && !desktop && "hidden")}>
            <div className="flex items-center gap-0.5 rounded-full border border-line bg-paper/95 p-1 shadow-[0_10px_30px_-12px_rgba(40,30,20,0.35)] backdrop-blur">
              <IconButton label="Compare before and after" active={compare} onClick={() => setCompare((c) => !c)}>
                <IconCompare size={18} />
              </IconButton>
              <span className="mx-0.5 h-5 w-px bg-line" />
              <IconButton label="Undo" disabled={history.past.length === 0 && history.present === history.anchor} onClick={() => dispatch({ type: "undo" })}>
                <IconUndo size={18} />
              </IconButton>
              <IconButton label="Redo" disabled={history.future.length === 0} onClick={() => dispatch({ type: "redo" })}>
                <IconRedo size={18} />
              </IconButton>
              <span className="mx-0.5 h-5 w-px bg-line" />
              <IconButton label="Zoom in" onClick={() => viewportRef.current?.zoomIn()}>
                <IconZoomIn size={18} />
              </IconButton>
              <IconButton label="Zoom out" onClick={() => viewportRef.current?.zoomOut()}>
                <IconZoomOut size={18} />
              </IconButton>
              <IconButton label="Reset view" onClick={() => viewportRef.current?.reset()}>
                <IconFit size={18} />
              </IconButton>
              <span className="mx-0.5 h-5 w-px bg-line" />
              <IconButton label="Reset pattern adjustments" onClick={() => set(resetAdjustments(look), true)}>
                <IconReset size={18} />
              </IconButton>
            </div>
          </div>

          {toast && (
            <div role="status" className="rise absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[0.8125rem] text-paper shadow-lg">
              {toast}
            </div>
          )}
        </div>

        {/* Mobile: bottom sheet. Desktop: side panel. */}
        <aside className="flex shrink-0 flex-col border-t border-line bg-paper/85 backdrop-blur md:w-[400px] md:border-l md:border-t-0">
          {desktop ? (
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-7 py-7">
              <div>
                <p className="tag text-muted">Now wearing</p>
                <h2 className="mt-1 font-display text-[1.9rem] leading-tight">{wearingName}</h2>
              </div>
              {cameraPanel || picker}
              <div className="border-t border-line pt-5">{adjust}</div>
              {privacy}
            </div>
          ) : (
            <>
              <div className={cx("flex items-center justify-between px-4 pt-3", fabricCam && "hidden")}>
                <Segmented<"patterns" | "adjust">
                  label="Studio panel"
                  size="sm"
                  value={panel}
                  onChange={setPanel}
                  options={[
                    { value: "patterns", label: "Patterns" },
                    { value: "adjust", label: "Adjust" },
                  ]}
                />
                <p className="truncate pl-3 font-display text-[1.05rem] italic">{wearingName}</p>
              </div>
              <div className={cx("overflow-y-auto px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3", !fabricCam && "h-[244px]")}>
                {fabricCam ? (
                  cameraPanel
                ) : panel === "patterns" ? (
                  picker
                ) : (
                  <div className="space-y-4">
                    {adjust}
                    {privacy}
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {showAddPrint && <CustomPrintDialog onClose={() => setShowAddPrint(false)} onAdd={addPrint} />}
    </div>
  );
}
