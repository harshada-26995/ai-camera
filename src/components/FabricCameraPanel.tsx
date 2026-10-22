"use client";

import { useEffect, useRef, useState } from "react";
import { FabricScanner, type FabricMode } from "@/lib/fabricCamera";
import { CameraError, openCamera, stopStream } from "@/lib/live";
import { IconClose } from "./icons";
import { Button, Segmented, Slider, Spinner } from "./ui";

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export default function FabricCameraPanel({
  onFrame,
  onKeepPrint,
  onKeepColour,
  onClose,
  scale,
  onScale,
  onScaleCommit,
}: {
  /** Receives the live tile every frame, and null when the camera closes. */
  onFrame: (tile: HTMLCanvasElement | null) => void;
  onKeepPrint: (tile: HTMLCanvasElement) => void;
  onKeepColour: (hex: string) => void;
  onClose: () => void;
  scale: number;
  onScale: (v: number) => void;
  onScaleCommit: () => void;
}) {
  const videoRef = useRef<VideoWithFrameCallback>(null);
  const scannerRef = useRef<FabricScanner | null>(null);
  const [mode, setMode] = useState<FabricMode>("print");
  const [state, setState] = useState<"starting" | "live" | { error: string }>("starting");
  const [swatch, setSwatch] = useState("#808080");
  const modeRef = useRef(mode);
  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    modeRef.current = mode;
    onFrameRef.current = onFrame;
  }, [mode, onFrame]);

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
      if (scanner.update(video, modeRef.current)) {
        onFrameRef.current(scanner.tile);
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
        stream = await openCamera("environment");
        if (cancelled) return stopStream(stream);
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        setState("live");
        schedule();
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
      onFrameRef.current(null);
      scanner.dispose();
      scannerRef.current = null;
    };
  }, []);

  const keep = () => {
    const s = scannerRef.current;
    if (!s) return;
    if (mode === "colour") onKeepColour(s.colour);
    else onKeepPrint(s.snapshot());
  };

  const error = typeof state === "object" ? state.error : null;

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="tag text-muted">Fabric from camera</p>
          <p className="mt-0.5 text-[0.8125rem] leading-snug text-ink-soft">
            Whatever is in the square is what he wears. Hold the phone 20–30 cm away so it can focus.
          </p>
        </div>
        <button type="button" aria-label="Close camera" onClick={onClose} className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-sand">
          <IconClose size={18} />
        </button>
      </div>

      <div className="mt-3 flex gap-3">
        <div className="relative aspect-square w-[124px] shrink-0 overflow-hidden rounded-2xl bg-[#0d0c0b] md:w-[150px]">
          <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" aria-label="Camera view of the fabric" />
          {state === "starting" && (
            <div className="absolute inset-0 flex items-center justify-center text-white">
              <Spinner />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
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
          {mode === "colour" ? (
            <div className="flex items-center gap-2 pt-1">
              <span className="h-8 w-8 rounded-full border border-line" style={{ background: swatch }} />
              <span className="font-mono text-[0.75rem] text-muted">{swatch.toUpperCase()}</span>
            </div>
          ) : (
            <Slider label="Print size" value={scale} min={0.25} max={3} format={(v) => `${v.toFixed(2)}×`} onChange={onScale} onCommit={onScaleCommit} />
          )}
        </div>
      </div>

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
