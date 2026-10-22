"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_CAMERA_ADJUST, FabricScanner, adjustHex, type FabricMode } from "@/lib/fabricCamera";
import type { PatternAdjust } from "@/lib/renderer";
import { CameraError, listBackLenses, openCamera, stopStream, type Lens } from "@/lib/live";
import { IconClose } from "./icons";
import { Button, Segmented, Slider, Spinner, cx } from "./ui";

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

const LENS_KEY = "drape-fabric-lens";

function readSavedLens(): string | null {
  try {
    return localStorage.getItem(LENS_KEY);
  } catch {
    return null;
  }
}

function saveLens(id: string) {
  try {
    localStorage.setItem(LENS_KEY, id);
  } catch {
    // Private mode: the choice just isn't remembered.
  }
}

export default function FabricCameraPanel({
  onFrame,
  onKeepPrint,
  onKeepColour,
  onClose,
  onAdjust,
  compact = false,
}: {
  /** Live colour correction for the camera fabric (brightness/colour strength). */
  onAdjust: (adjust: PatternAdjust) => void;
  /**
   * Phone layout: the camera view floats as a small thumbnail over the page and
   * the controls fit in a slim bar, so the photo of him stays fully visible.
   */
  compact?: boolean;
  /** Receives the live image every frame, and null when the camera closes. */
  onFrame: (tile: HTMLCanvasElement | null) => void;
  onKeepPrint: (tile: HTMLCanvasElement, adjust: PatternAdjust) => void;
  onKeepColour: (hex: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<VideoWithFrameCallback>(null);
  const scannerRef = useRef<FabricScanner | null>(null);
  const [mode, setMode] = useState<FabricMode>("print");
  const [zoom, setZoom] = useState(1);
  const [adjust, setAdjust] = useState<PatternAdjust>(DEFAULT_CAMERA_ADJUST);
  const [state, setState] = useState<"starting" | "live" | { error: string }>("starting");
  const [swatch, setSwatch] = useState("#808080");
  const [lenses, setLenses] = useState<Lens[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(readSavedLens);
  const [activeLens, setActiveLens] = useState<string | null>(null);
  /** Where the floating camera thumbnail sits in the phone layout; tap it to move it out of the way. */
  const [thumbAtBottom, setThumbAtBottom] = useState(false);
  const live = useRef({ mode, zoom, onFrame });
  useEffect(() => {
    live.current = { mode, zoom, onFrame };
  }, [mode, zoom, onFrame]);

  useEffect(() => {
    onAdjust(adjust);
  }, [adjust, onAdjust]);

  // Camera lifetime; restarts when a different lens is chosen.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let handle = 0;
    let lastSwatch = 0;
    const scanner = new FabricScanner();
    scannerRef.current = scanner;

    // Update once per new camera frame where supported, otherwise once per display frame.
    const schedule = () => {
      if (cancelled) return;
      handle = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    };
    const tick = () => {
      if (cancelled) return;
      if (scanner.update(video, live.current.mode, live.current.zoom)) {
        live.current.onFrame(scanner.tile);
        const now = performance.now();
        if (now - lastSwatch > 300) {
          lastSwatch = now;
          setSwatch(scanner.colour);
        }
      }
      schedule();
    };

    void (async () => {
      try {
        stream = await openCamera("environment", { deviceId, width: 1920, height: 1080 });
        if (cancelled) return stopStream(stream);
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        setState("live");
        schedule();

        // Lens names are only available after permission. Prefer the lens that can focus closest.
        const found = await listBackLenses();
        if (cancelled) return;
        setLenses(found);
        const current = stream.getVideoTracks()[0]?.getSettings().deviceId ?? null;
        setActiveLens(current);
        const best = found[0];
        if (!deviceId && best && best.deviceId !== current && found.length > 1) {
          saveLens(best.deviceId);
          setDeviceId(best.deviceId);
        }
      } catch (e) {
        if (!cancelled) setState({ error: e instanceof CameraError ? e.message : "The camera couldn't be started." });
      }
    })();

    return () => {
      cancelled = true;
      if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(handle);
      cancelAnimationFrame(handle);
      stopStream(stream);
      video.srcObject = null;
      live.current.onFrame(null);
      scanner.dispose();
      scannerRef.current = null;
    };
  }, [deviceId]);

  const keep = () => {
    const s = scannerRef.current;
    if (!s) return;
    if (mode === "colour") onKeepColour(adjustHex(s.colour, adjust.brightness, adjust.saturation));
    else onKeepPrint(s.snapshot(), adjust);
  };

  const error = typeof state === "object" ? state.error : null;
  const selectedLens = activeLens ?? deviceId;

  const pickLens = (id: string) => {
    if (id === selectedLens) return;
    saveLens(id);
    setState("starting");
    setDeviceId(id);
  };

  const cameraView = (
    <>
      {/* Scaled like the crop, so the preview is exactly what goes on the shirt. */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="h-full w-full object-cover"
        style={{ transform: `scale(${zoom})` }}
        aria-label="Camera view of the fabric"
      />
      {state === "starting" && (
        <div className="absolute inset-0 flex items-center justify-center text-white">
          <Spinner />
        </div>
      )}
    </>
  );

  const modeSwitch = (
    <Segmented<FabricMode>
      label="Use the fabric's"
      size="sm"
      value={mode}
      onChange={setMode}
      options={[
        { value: "print", label: "Print" },
        { value: "colour", label: "Colour" },
      ]}
    />
  );

  const zoomSlider = <Slider label="Zoom" value={zoom} min={1} max={4} format={(v) => `${v.toFixed(1)}×`} onChange={setZoom} />;

  // Phone cameras brighten dark cloth and flatten colours; these bring it back to how it looks in person.
  const colourSliders = (
    <div className="grid grid-cols-2 gap-3">
      <Slider
        label="Brightness"
        value={adjust.brightness}
        min={-1.5}
        max={1}
        format={(v) => (Math.abs(v) < 0.05 ? "0" : v < 0 ? `${Math.round(-v * 100)}% darker` : `${Math.round(v * 100)}% lighter`)}
        onChange={(v) => setAdjust((a) => ({ ...a, brightness: v }))}
      />
      <Slider
        label="Colour"
        value={adjust.saturation}
        min={0.5}
        max={2}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => setAdjust((a) => ({ ...a, saturation: v }))}
      />
    </div>
  );

  const keepButton = (
    <Button className="h-11 flex-1" disabled={state !== "live"} onClick={keep}>
      {mode === "colour" && (
        <span className="h-4 w-4 rounded-full border border-paper/60" style={{ background: adjustHex(swatch, adjust.brightness, adjust.saturation) }} />
      )}
      {mode === "colour" ? "Keep this colour" : "Keep this fabric"}
    </Button>
  );

  const errorText = error && (
    <p role="alert" className="text-[0.8125rem] leading-snug text-danger">
      {error}
    </p>
  );

  if (compact) {
    return (
      <div className="space-y-2">
        {typeof document !== "undefined" &&
          createPortal(
            <button
              type="button"
              aria-label={thumbAtBottom ? "Move camera view to the top" : "Move camera view to the bottom"}
              title="Tap to move"
              onClick={() => setThumbAtBottom((b) => !b)}
              className={cx(
                "fixed right-3 z-30 h-[108px] w-[108px] overflow-hidden rounded-2xl border-2 border-white bg-[#0d0c0b] shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)]",
                thumbAtBottom ? "bottom-[calc(8.75rem+env(safe-area-inset-bottom))]" : "top-[calc(4.25rem+env(safe-area-inset-top))]",
              )}
            >
              {cameraView}
            </button>,
            document.body,
          )}
        <div className="flex items-end gap-3">
          <div className="shrink-0 pb-0.5">{modeSwitch}</div>
          <div className="min-w-0 flex-1">{zoomSlider}</div>
        </div>
        {colourSliders}
        {errorText}
        <div className="flex items-center gap-2">
          {lenses.length > 1 && (
            <label className="relative shrink-0">
              <span className="sr-only">Camera lens</span>
              <select
                value={selectedLens ?? ""}
                onChange={(e) => pickLens(e.target.value)}
                className="h-11 max-w-[8.5rem] appearance-none truncate rounded-full border border-line-strong bg-paper pl-3.5 pr-7 text-[0.8125rem] font-medium"
              >
                {lenses.map((l) => (
                  <option key={l.deviceId} value={l.deviceId}>
                    {l.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[0.6rem] text-muted">▼</span>
            </label>
          )}
          {keepButton}
          <button type="button" aria-label="Close camera" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line-strong">
            <IconClose size={18} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="tag text-muted">Fabric from camera</p>
          <p className="mt-0.5 text-[0.8125rem] leading-snug text-ink-soft">
            Whatever is in the square is what he wears. Blurry up close? Try another lens, or hold back a little and zoom.
          </p>
        </div>
        <button type="button" aria-label="Close camera" onClick={onClose} className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-sand">
          <IconClose size={18} />
        </button>
      </div>

      <div className="mt-3 flex gap-3">
        <div className="relative aspect-square w-[150px] shrink-0 overflow-hidden rounded-2xl bg-[#0d0c0b]">{cameraView}</div>
        <div className="min-w-0 flex-1 space-y-1.5">
          {modeSwitch}
          {zoomSlider}
        </div>
      </div>
      <div className="mt-2">{colourSliders}</div>

      {lenses.length > 1 && (
        <div className="no-scrollbar mt-2 flex items-center gap-1.5 overflow-x-auto" role="radiogroup" aria-label="Camera lens">
          <span className="tag shrink-0 pr-1 text-muted">Lens</span>
          {lenses.map((l) => (
            <button
              key={l.deviceId}
              type="button"
              role="radio"
              aria-checked={selectedLens === l.deviceId}
              onClick={() => pickLens(l.deviceId)}
              className={cx(
                "h-8 shrink-0 rounded-full border px-3 text-[0.75rem] font-medium transition-colors",
                selectedLens === l.deviceId ? "border-ink bg-ink text-paper" : "border-line text-ink-soft hover:border-ink",
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex">{error ? errorText : keepButton}</div>
    </div>
  );
}
