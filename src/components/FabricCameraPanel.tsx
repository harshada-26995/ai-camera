"use client";

import { useEffect, useRef, useState } from "react";
import { FabricScanner, type FabricMode } from "@/lib/fabricCamera";
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
}: {
  /** Receives the live image every frame, and null when the camera closes. */
  onFrame: (tile: HTMLCanvasElement | null) => void;
  onKeepPrint: (tile: HTMLCanvasElement) => void;
  onKeepColour: (hex: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<VideoWithFrameCallback>(null);
  const scannerRef = useRef<FabricScanner | null>(null);
  const [mode, setMode] = useState<FabricMode>("print");
  const [zoom, setZoom] = useState(1);
  const [state, setState] = useState<"starting" | "live" | { error: string }>("starting");
  const [swatch, setSwatch] = useState("#808080");
  const [lenses, setLenses] = useState<Lens[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(readSavedLens);
  const [activeLens, setActiveLens] = useState<string | null>(null);
  const live = useRef({ mode, zoom, onFrame });
  useEffect(() => {
    live.current = { mode, zoom, onFrame };
  }, [mode, zoom, onFrame]);

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
    if (mode === "colour") onKeepColour(s.colour);
    else onKeepPrint(s.snapshot());
  };

  const error = typeof state === "object" ? state.error : null;
  const selectedLens = activeLens ?? deviceId;

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
        <div className="relative aspect-square w-[124px] shrink-0 overflow-hidden rounded-2xl bg-[#0d0c0b] md:w-[150px]">
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
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
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
          <Slider label="Zoom" value={zoom} min={1} max={4} format={(v) => `${v.toFixed(1)}×`} onChange={setZoom} />
          {mode === "colour" && (
            <div className="flex items-center gap-2">
              <span className="h-6 w-6 rounded-full border border-line" style={{ background: swatch }} />
              <span className="font-mono text-[0.75rem] text-muted">{swatch.toUpperCase()}</span>
            </div>
          )}
        </div>
      </div>

      {lenses.length > 1 && (
        <div className="no-scrollbar mt-2 flex items-center gap-1.5 overflow-x-auto" role="radiogroup" aria-label="Camera lens">
          <span className="tag shrink-0 pr-1 text-muted">Lens</span>
          {lenses.map((l) => (
            <button
              key={l.deviceId}
              type="button"
              role="radio"
              aria-checked={selectedLens === l.deviceId}
              onClick={() => {
                if (l.deviceId === selectedLens) return;
                saveLens(l.deviceId);
                setState("starting");
                setDeviceId(l.deviceId);
              }}
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

      {error ? (
        <p role="alert" className="mt-3 text-[0.8125rem] leading-snug text-danger">
          {error}
        </p>
      ) : (
        <Button className="mt-3 h-11 w-full" disabled={state !== "live"} onClick={keep}>
          {mode === "colour" ? "Keep this colour" : "Keep this fabric"}
        </Button>
      )}
    </div>
  );
}
