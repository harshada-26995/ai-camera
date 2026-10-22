/**
 * Live camera try-on: the same shirt detector and WebGL renderer as the photo
 * flow, run continuously on camera frames. Everything stays on the device;
 * frames are never recorded or uploaded.
 *
 * Per frame: the video is uploaded to the GPU and drawn with the latest mask.
 * Segmentation (GPU-delegated) runs on a small copy of the frame after the
 * paint, on an adaptive budget so slow devices keep smooth video. Pose (for
 * separating shirt from trousers) refreshes every few updates.
 */
import type { ImageSegmenter, PoseLandmarker } from "@mediapipe/tasks-vision";
import { luminance, rgbaToLab } from "./color";
import { boxFilter } from "./guidedFilter";
import type { LookSettings } from "./look";
import { keepMainComponents, maskBounds } from "./mask";
import { TryOnRenderer, type PatternSource } from "./renderer";
import { getLivePose, getLiveSegmenter, readLandmarks, segmentLowRes, separateTrousers, smoothstep, type Landmarks } from "./segmentation";

export type Facing = "environment" | "user";

export type LiveStatus =
  | { kind: "starting" }
  | { kind: "loading-model" }
  | { kind: "searching" }
  | { kind: "tracking" }
  | { kind: "error"; message: string };

const ANALYSIS_EDGE = 256;
/** Hips move slowly; refresh them every few detection updates. */
const POSE_EVERY = 8;
/** Weight of the newest mask in the temporal blend (lower = steadier, laggier). */
const MASK_BLEND = 0.6;
const MIN_COVERAGE = 0.01;
/** Never leave the mask un-updated for longer than this, however slow the device. */
const MAX_ANALYSIS_GAP_MS = 250;
const WARMUP_RUNS = 2;

export class CameraError extends Error {}

export async function openCamera(facing: Facing): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new CameraError(
      window.isSecureContext
        ? "This browser can't open the camera."
        : "The live camera needs a secure (https) link. Open the site with https:// and try again.",
    );
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (e) {
    const name = (e as DOMException).name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new CameraError("Camera access was blocked. On iPhone: Settings › Safari › Camera › Allow, then reload this page.");
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") throw new CameraError("No camera was found on this device.");
    if (name === "NotReadableError") throw new CameraError("The camera is being used by another app. Close it and try again.");
    throw new CameraError("The camera couldn't be started.");
  }
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Copies the current frame at up to `maxEdge` pixels on the long side. */
export function captureFrame(video: HTMLVideoElement, maxEdge = 1600): HTMLCanvasElement {
  const k = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * k);
  canvas.height = Math.round(video.videoHeight * k);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export class LiveTryOn {
  private readonly renderer: TryOnRenderer;
  private readonly video: HTMLVideoElement;
  private readonly low = document.createElement("canvas");
  private readonly lowCtx: CanvasRenderingContext2D;
  private segmenter: ImageSegmenter | null = null;
  private pose: PoseLandmarker | null = null;
  private landmarks: Landmarks | null = null;
  private prevMask: Float32Array | null = null;
  private center: [number, number] | null = null;
  private shirtWidth = 0;
  private raf = 0;
  private running = false;
  private analyses = 0;
  private analysisPending = false;
  private lastAnalysisEnd = 0;
  private status: LiveStatus["kind"] | null = null;
  private look: LookSettings;
  private pattern: PatternSource;
  /** Recent cost of one detection update (ms), for honest on-device diagnostics. */
  segMs = 0;
  /** Detection updates per second, measured. */
  updatesPerSec = 0;
  private updateTimes: number[] = [];
  onStatus: ((s: LiveStatus) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, video: HTMLVideoElement, look: LookSettings, pattern: PatternSource) {
    this.renderer = new TryOnRenderer(canvas);
    this.video = video;
    const ctx = this.low.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas unavailable");
    this.lowCtx = ctx;
    this.look = look;
    this.pattern = pattern;
    this.renderer.setPattern(pattern);
    this.renderer.setLiveMask(new Uint8Array(1), 1, 1, new Uint8Array([128]), 1, 1, 0.25, [0, 0], 1);
  }

  private emit(s: LiveStatus) {
    if (s.kind === this.status && s.kind !== "error") return;
    this.status = s.kind;
    this.onStatus?.(s);
  }

  async start(): Promise<void> {
    this.running = true;
    this.emit({ kind: "loading-model" });
    this.loop();
    try {
      const [segmenter, pose] = await Promise.all([getLiveSegmenter(), getLivePose()]);
      if (!this.running) return;
      this.segmenter = segmenter;
      this.pose = pose;
      this.emit({ kind: "searching" });
    } catch {
      if (this.running) this.emit({ kind: "error", message: "The shirt detector couldn't load. Check your connection and try again." });
    }
  }

  setLook(look: LookSettings, pattern: PatternSource): void {
    this.look = look;
    if (pattern.key !== this.pattern.key || pattern.canvas !== this.pattern.canvas) this.renderer.setPattern(pattern);
    this.pattern = pattern;
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    this.low.width = 0;
    this.low.height = 0;
  }

  private loop = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth || this.renderer.isLost) return;
    // Draw this frame straight away with the latest mask so the video stays smooth...
    this.renderer.setVideoFrame(v, v.videoWidth, v.videoHeight);
    this.renderer.render(this.look, { showOriginal: false, split: null });
    // ...and run detection after the paint, spending at most ~half the time on it
    // when the device is slow (on fast devices this is every frame).
    const now = performance.now();
    if (this.segmenter && !this.analysisPending && now - this.lastAnalysisEnd >= Math.min(this.segMs, MAX_ANALYSIS_GAP_MS)) {
      this.analysisPending = true;
      setTimeout(() => {
        try {
          if (this.running && v.videoWidth) this.analyse(v.videoWidth, v.videoHeight);
        } catch (e) {
          console.error("Live segmentation failed", e);
        } finally {
          this.analysisPending = false;
          this.lastAnalysisEnd = performance.now();
        }
      }, 0);
    }
  };

  private analyse(W: number, H: number) {
    const segmenter = this.segmenter;
    if (!segmenter) return;
    const t0 = performance.now();
    const k = ANALYSIS_EDGE / Math.max(W, H);
    const lw = Math.max(1, Math.round(W * k));
    const lh = Math.max(1, Math.round(H * k));
    if (this.low.width !== lw || this.low.height !== lh) {
      this.low.width = lw;
      this.low.height = lh;
      this.prevMask = null;
    }
    this.lowCtx.drawImage(this.video, 0, 0, lw, lh);
    const pixels = this.lowCtx.getImageData(0, 0, lw, lh).data;
    const n = lw * lh;

    const { clothes, protect } = segmentLowRes(segmenter, this.low, lw, lh);

    this.analyses++;
    if (this.pose && this.analyses % POSE_EVERY === 1) {
      try {
        const r = this.pose.detect(this.low);
        this.landmarks = readLandmarks(r.landmarks[0], lw, lh);
        (r as { close?: () => void }).close?.();
      } catch {
        this.landmarks = null;
      }
    }
    if (this.landmarks) separateTrousers(clothes, rgbaToLab(pixels, n), lw, lh, this.landmarks);

    // Main garment only, face/skin protected, then blended over time to stop flicker.
    const binary = new Uint8Array(n);
    for (let i = 0; i < n; i++) binary[i] = clothes[i] > 0.5 ? 1 : 0;
    const keep = keepMainComponents(binary, lw, lh, 0.15);
    const near = boxFilter(Float32Array.from(keep), lw, lh, 2);
    const prev = this.prevMask;
    const blended = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let a = near[i] > 0 ? clothes[i] : 0;
      a *= 1 - smoothstep(0.5, 0.75, protect[i]);
      blended[i] = prev ? MASK_BLEND * a + (1 - MASK_BLEND) * prev[i] : a;
    }
    this.prevMask = blended;

    const mask = new Uint8Array(n);
    let covered = 0;
    for (let i = 0; i < n; i++) {
      mask[i] = Math.round(blended[i] * 255);
      if (mask[i] > 127) covered++;
    }

    // Shading reference: mask-normalised blurred luminance and the shirt's mean.
    const lum = new Float32Array(n);
    const wts = new Float32Array(n);
    let sum = 0;
    let wsum = 0;
    for (let i = 0; i < n; i++) {
      const m = blended[i];
      const l = luminance(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]);
      lum[i] = l * m;
      wts[i] = m;
      sum += l * m;
      wsum += m;
    }
    const meanLum = wsum > 0 ? sum / wsum : 0.5;
    const bl = boxFilter(lum, lw, lh, 3);
    const bw = boxFilter(wts, lw, lh, 3);
    const coarse = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const l = bw[i] > 1e-4 ? bl[i] / bw[i] : meanLum;
      coarse[i] = Math.round(Math.sqrt(Math.min(Math.max(l, 0), 1)) * 255);
    }

    // Anchor the pattern to the shirt, smoothed so it moves with him without jitter.
    const b = maskBounds(mask, lw, lh);
    if (b) {
      const cx = ((b.x + b.w / 2) / lw) * W;
      const cy = ((b.y + b.h / 2) / lh) * H;
      const bw2 = (b.w / lw) * W;
      if (!this.center) {
        this.center = [cx, cy];
        this.shirtWidth = bw2;
      } else {
        this.center = [this.center[0] * 0.8 + cx * 0.2, this.center[1] * 0.8 + cy * 0.2];
        this.shirtWidth = this.shirtWidth * 0.9 + bw2 * 0.1;
      }
    }
    this.renderer.setLiveMask(mask, lw, lh, coarse, lw, lh, meanLum, this.center ?? [W / 2, H / 2], this.shirtWidth || W * 0.5);

    const end = performance.now();
    // The first runs include one-off GPU shader compilation; don't let them skew the budget.
    this.segMs = this.analyses <= WARMUP_RUNS ? 0 : this.segMs ? this.segMs * 0.7 + (end - t0) * 0.3 : end - t0;
    this.updateTimes.push(end);
    while (this.updateTimes.length && end - this.updateTimes[0]! > 2000) this.updateTimes.shift();
    this.updatesPerSec = this.updateTimes.length / 2;
    this.emit({ kind: covered / n >= MIN_COVERAGE ? "tracking" : "searching" });
  }
}
