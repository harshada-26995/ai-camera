"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CameraError, LiveTryOn, captureFrame, openCamera, stopStream, type Facing, type LiveStatus } from "@/lib/live";
import type { LookSettings } from "@/lib/look";
import { CUSTOM_COLOR_ID, PATTERNS, getTile, resolvePattern, tileKey, warmTiles, type PatternCategory, type PatternDef } from "@/lib/patterns";
import type { PatternSource } from "@/lib/renderer";
import CustomPrintDialog from "./CustomPrintDialog";
import PatternPicker from "./PatternPicker";
import { useMediaQuery } from "./useMediaQuery";
import { IconClose, IconFlip } from "./icons";
import { Button, IconButton, Spinner, TopBar, cx } from "./ui";

const toSource = (def: PatternDef): PatternSource => ({ key: tileKey(def), canvas: getTile(def), tileFraction: def.tileFraction, cover: def.cover });

const STATUS_TEXT: Partial<Record<LiveStatus["kind"], string>> = {
  starting: "Opening the camera…",
  "loading-model": "Loading the shirt detector — first time only…",
  searching: "Point the camera at him so his shirt is clearly in view",
};

declare global {
  interface Window {
    __drapeLive?: LiveTryOn;
  }
}

export default function LiveScreen({
  initialLook,
  customPatterns,
  onCustomPatterns,
  onClose,
  onCapture,
}: {
  initialLook: LookSettings;
  customPatterns: PatternDef[];
  onCustomPatterns: (p: PatternDef[]) => void;
  onClose: () => void;
  onCapture: (frame: HTMLCanvasElement, look: LookSettings) => void;
}) {
  const [facing, setFacing] = useState<Facing>("environment");
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<LiveStatus>({ kind: "starting" });
  const [look, setLook] = useState(initialLook);
  const [showAddPrint, setShowAddPrint] = useState(false);
  const [flash, setFlash] = useState(false);
  const [perf, setPerf] = useState<string | null>(null);
  const desktop = useMediaQuery("(min-width: 768px)");
  const videoRef = useRef<HTMLVideoElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<LiveTryOn | null>(null);

  const current = resolvePattern(look.patternId, look.customColor, customPatterns);
  const [category, setCategory] = useState<PatternCategory>(current.category);

  // The engine reads the latest look when it (re)starts, without restarting on every tap.
  const latest = useRef({ look, current });
  useLayoutEffect(() => {
    latest.current = { look, current };
    engineRef.current?.setLook(look, toSource(current));
  }, [look, current]);

  useEffect(() => warmTiles(PATTERNS), []);

  // With ?debug=1, show measured detector speed so on-device performance can be reported honestly.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("debug")) return;
    const id = setInterval(() => {
      const e = engineRef.current;
      if (e) setPerf(`Detector ${Math.round(e.segMs)} ms · ${e.updatesPerSec.toFixed(1)} updates/s`);
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Camera + engine lifetime. Restarts when switching cameras or retrying.
  useEffect(() => {
    const host = hostRef.current;
    const video = videoRef.current;
    if (!host || !video) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let engine: LiveTryOn | null = null;
    const canvas = document.createElement("canvas");
    canvas.className = "h-full w-full object-contain";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Live try-on preview");
    host.appendChild(canvas);

    void (async () => {
      try {
        stream = await openCamera(facing);
        if (cancelled) return stopStream(stream);
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        engine = new LiveTryOn(canvas, video, latest.current.look, toSource(latest.current.current));
        engine.onStatus = setStatus;
        engineRef.current = engine;
        if (new URLSearchParams(window.location.search).has("debug")) window.__drapeLive = engine;
        await engine.start();
      } catch (e) {
        if (!cancelled) setStatus({ kind: "error", message: e instanceof CameraError ? e.message : "The camera couldn't be started." });
      }
    })();

    return () => {
      cancelled = true;
      engine?.stop();
      engineRef.current = null;
      stopStream(stream);
      video.srcObject = null;
      canvas.remove();
      delete window.__drapeLive;
    };
  }, [facing, attempt]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    onCapture(captureFrame(video), look);
  };

  const onCustomColor = (hex: string, commit: boolean) => {
    if (!commit) setLook((l) => ({ ...l, patternId: CUSTOM_COLOR_ID, customColor: hex }));
  };

  const addPrint = (tile: HTMLCanvasElement, name: string) => {
    const def: PatternDef = { id: `custom-${Date.now()}`, name, category: "custom", tileFraction: 0.35, base: "#ddd", canvas: tile };
    onCustomPatterns([...customPatterns, def]);
    setShowAddPrint(false);
    setCategory("custom");
    setLook((l) => ({ ...l, patternId: def.id }));
  };

  const ready = status.kind === "tracking" || status.kind === "searching";
  const picker = (
    <PatternPicker
      patterns={PATTERNS}
      customPatterns={customPatterns}
      category={category}
      onCategory={setCategory}
      selectedId={look.patternId}
      customColor={look.customColor}
      onSelect={(id) => setLook((l) => ({ ...l, patternId: id }))}
      onCustomColor={onCustomColor}
      onAddPrint={() => setShowAddPrint(true)}
      onRemovePrint={(id) => {
        onCustomPatterns(customPatterns.filter((p) => p.id !== id));
        if (look.patternId === id) setLook((l) => ({ ...l, patternId: PATTERNS[0]!.id }));
      }}
    />
  );

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        step={3}
        left={
          <IconButton label="Close camera" onClick={onClose}>
            <IconClose />
          </IconButton>
        }
        right={
          <IconButton label="Switch camera" onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}>
            <IconFlip />
          </IconButton>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-0 flex-1 bg-[#0d0c0b]">
          <video ref={videoRef} playsInline muted autoPlay className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-0" />
          <div ref={hostRef} className="absolute inset-0" style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }} />
          <div className={cx("pointer-events-none absolute inset-0 bg-white transition-opacity duration-150", flash ? "opacity-70" : "opacity-0")} />

          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-white backdrop-blur">
            <span className={cx("h-1.5 w-1.5 rounded-full", status.kind === "tracking" ? "bg-[#ff4d3d]" : "bg-white/50")} />
            Live
          </div>

          {perf && (
            <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/45 px-2.5 py-1 font-mono text-[0.6875rem] text-white backdrop-blur">
              {perf}
            </div>
          )}

          {status.kind !== "tracking" && status.kind !== "error" && STATUS_TEXT[status.kind] && (
            <div className="pointer-events-none absolute inset-x-3 top-12 flex justify-center" role="status">
              <span className="flex max-w-sm items-center gap-2 rounded-2xl bg-black/55 px-4 py-2.5 text-center text-[0.8125rem] text-white backdrop-blur">
                {status.kind !== "searching" && <Spinner size={15} />}
                {STATUS_TEXT[status.kind]}
              </span>
            </div>
          )}

          {status.kind === "error" && (
            <div className="absolute inset-0 flex items-center justify-center p-6" role="alert">
              <div className="max-w-sm rounded-[24px] bg-paper p-5 text-center">
                <p className="font-display text-xl">Camera unavailable</p>
                <p className="mt-2 text-[0.875rem] leading-relaxed text-ink-soft">{status.message}</p>
                <div className="mt-4 flex justify-center gap-2">
                  <Button variant="secondary" className="h-10 px-4" onClick={onClose}>
                    Use a photo
                  </Button>
                  <Button
                    className="h-10 px-4"
                    onClick={() => {
                      setStatus({ kind: "starting" });
                      setAttempt((a) => a + 1);
                    }}
                  >
                    Try again
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="absolute inset-x-0 bottom-4 flex flex-col items-center gap-2">
            <button
              type="button"
              aria-label="Capture this look"
              disabled={!ready}
              onClick={capture}
              className="flex h-[68px] w-[68px] items-center justify-center rounded-full border-[3px] border-white/90 transition-transform active:scale-90 disabled:opacity-40"
            >
              <span className="h-[54px] w-[54px] rounded-full bg-white" />
            </button>
            <span className="rounded-full bg-black/40 px-2.5 py-0.5 text-[0.6875rem] text-white/90 backdrop-blur">
              Capture to fine-tune & save
            </span>
          </div>
        </div>

        <aside className="flex shrink-0 flex-col border-t border-line bg-paper/90 backdrop-blur md:w-[400px] md:border-l md:border-t-0">
          {desktop ? (
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-7 py-7">
              <div>
                <p className="tag text-muted">Live — now wearing</p>
                <h2 className="mt-1 font-display text-[1.9rem] leading-tight">{current.name}</h2>
              </div>
              {picker}
              <p className="text-[0.8125rem] leading-relaxed text-muted">
                The camera feed is processed on this device only. Nothing is recorded or uploaded.
              </p>
            </div>
          ) : (
            <div className="px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
              <p className="mb-2 truncate font-display text-[1.05rem] italic">{current.name}</p>
              {picker}
            </div>
          )}
        </aside>
      </div>

      {showAddPrint && <CustomPrintDialog onClose={() => setShowAddPrint(false)} onAdd={addPrint} />}
    </div>
  );
}
