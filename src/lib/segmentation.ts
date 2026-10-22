/**
 * Automatic shirt detection, entirely in the browser.
 *
 * 1. MediaPipe's multiclass selfie segmenter (Apache-2.0) gives a per-pixel
 *    "clothes" probability plus face/hair/skin probabilities.
 * 2. MediaPipe's pose landmarker finds the hips so the shirt can be separated
 *    from trousers (the segmenter labels both as "clothes").
 * 3. Small blobs (other people, specks) are dropped.
 * 4. A colour-guided filter snaps the 256px mask to the photo's real edges.
 * 5. Face, hair and skin are explicitly protected.
 *
 * The photo never leaves the device; only the model files are fetched.
 */
import type { ImageSegmenter, PoseLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { rgbaToLab } from "./color";
import { applyGuidedUpsampleColor, boxFilter, guidedCoefficientsColor, resizeFloat } from "./guidedFilter";
import { fillHoles, keepMainComponents, maskCoverage } from "./mask";

const WASM_PATH = "/mediapipe/wasm";
const SEGMENTER_MODEL = {
  local: "/models/selfie_multiclass_256x256.tflite",
  remote:
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
};
const POSE_MODEL = {
  local: "/models/pose_landmarker_lite.task",
  remote: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
};

/** Long edge of the analysis image; the model itself runs at 256². */
const ANALYSIS_EDGE = 512;

export type DetectStage = "loading-model" | "detecting" | "refining";

export interface DetectionResult {
  mask: Uint8Array;
  coverage: number;
  trousersSeparated: boolean;
  poseFound: boolean;
}

type Vision = typeof import("@mediapipe/tasks-vision");

let visionPromise: Promise<{ vision: Vision; fileset: Awaited<ReturnType<Vision["FilesetResolver"]["forVisionTasks"]>> }> | null =
  null;
let segmenterPromise: Promise<ImageSegmenter> | null = null;
let posePromise: Promise<PoseLandmarker | null> | null = null;

function loadVision() {
  visionPromise ??= (async () => {
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
    return { vision, fileset };
  })();
  visionPromise.catch(() => {
    visionPromise = null;
  });
  return visionPromise;
}

async function withModelFallback<T>(create: (path: string) => Promise<T>, model: { local: string; remote: string }): Promise<T> {
  try {
    return await create(model.local);
  } catch {
    return await create(model.remote);
  }
}

export function getSegmenter(): Promise<ImageSegmenter> {
  segmenterPromise ??= (async () => {
    const { vision, fileset } = await loadVision();
    return withModelFallback(
      (modelAssetPath) =>
        vision.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath, delegate: "CPU" },
          runningMode: "IMAGE",
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        }),
      SEGMENTER_MODEL,
    );
  })();
  segmenterPromise.catch(() => {
    segmenterPromise = null;
  });
  return segmenterPromise;
}

export function getPose(): Promise<PoseLandmarker | null> {
  posePromise ??= (async () => {
    try {
      const { vision, fileset } = await loadVision();
      return await withModelFallback(
        (modelAssetPath) =>
          vision.PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath, delegate: "CPU" },
            runningMode: "IMAGE",
            numPoses: 1,
          }),
        POSE_MODEL,
      );
    } catch {
      return null; // pose is an optional refinement
    }
  })();
  // Don't cache a failed load: a later "Retry" should try again.
  void posePromise.then((p) => {
    if (!p) posePromise = null;
  });
  return posePromise;
}

let liveSegmenterPromise: Promise<ImageSegmenter> | null = null;
let livePosePromise: Promise<PoseLandmarker | null> | null = null;

/**
 * GPU-delegated instances for the live camera loop, where the CPU path is too
 * slow for real time. Falls back to the CPU instances if the GPU path fails.
 */
export function getLiveSegmenter(): Promise<ImageSegmenter> {
  liveSegmenterPromise ??= (async () => {
    try {
      const { vision, fileset } = await loadVision();
      return await withModelFallback(
        (modelAssetPath) =>
          vision.ImageSegmenter.createFromOptions(fileset, {
            baseOptions: { modelAssetPath, delegate: "GPU" },
            runningMode: "IMAGE",
            outputCategoryMask: false,
            outputConfidenceMasks: true,
          }),
        SEGMENTER_MODEL,
      );
    } catch {
      return getSegmenter();
    }
  })();
  liveSegmenterPromise.catch(() => {
    liveSegmenterPromise = null;
  });
  return liveSegmenterPromise;
}

export function getLivePose(): Promise<PoseLandmarker | null> {
  livePosePromise ??= (async () => {
    try {
      const { vision, fileset } = await loadVision();
      return await withModelFallback(
        (modelAssetPath) =>
          vision.PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath, delegate: "GPU" },
            runningMode: "IMAGE",
            numPoses: 1,
          }),
        POSE_MODEL,
      );
    } catch {
      return getPose();
    }
  })();
  void livePosePromise.then((p) => {
    if (!p) livePosePromise = null;
  });
  return livePosePromise;
}

/** Starts downloading the models early (e.g. while the user is cropping). */
export function preloadModels(): void {
  void getSegmenter().catch(() => undefined);
  void getPose();
}

const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

export interface Landmarks {
  shoulderY: number;
  hipY: number;
  hipLeftX: number;
  hipRightX: number;
  shoulderLeftX: number;
  shoulderRightX: number;
}

export function readLandmarks(lm: NormalizedLandmark[] | undefined, w: number, h: number): Landmarks | null {
  if (!lm) return null;
  const ls = lm[11];
  const rs = lm[12];
  const lh = lm[23];
  const rh = lm[24];
  if (!ls || !rs || !lh || !rh) return null;
  const visible = (p: NormalizedLandmark) => (p.visibility ?? 1) > 0.4 && p.y > 0 && p.y < 1.05;
  if (!visible(ls) || !visible(rs) || !visible(lh) || !visible(rh)) return null;
  const shoulderY = ((ls.y + rs.y) / 2) * h;
  const hipY = ((lh.y + rh.y) / 2) * h;
  if (hipY - shoulderY < h * 0.08) return null;
  return {
    shoulderY,
    hipY,
    hipLeftX: Math.min(lh.x, rh.x) * w,
    hipRightX: Math.max(lh.x, rh.x) * w,
    shoulderLeftX: Math.min(ls.x, rs.x) * w,
    shoulderRightX: Math.max(ls.x, rs.x) * w,
  };
}

/**
 * Removes trousers from the clothes probability map, using the hips as a guide
 * and colour to decide where the shirt ends. Returns false when no separation
 * was needed or possible.
 */
export function separateTrousers(prob: Float32Array, lab: Float32Array, w: number, h: number, lm: Landmarks): boolean {
  const torso = lm.hipY - lm.shoulderY;
  const bandTop = lm.hipY - 0.2 * torso;
  const bandBottom = lm.hipY + 0.5 * torso;
  if (bandTop >= h) return false;

  const mean = (y0: number, y1: number, x0: number, x1: number) => {
    let n = 0;
    const acc = [0, 0, 0];
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) {
        const i = y * w + x;
        if (prob[i] < 0.6) continue;
        acc[0] += lab[i * 3];
        acc[1] += lab[i * 3 + 1];
        acc[2] += lab[i * 3 + 2];
        n++;
      }
    }
    return n >= 40 ? acc.map((v) => v / n) : null;
  };

  const shirt = mean(lm.shoulderY + 0.2 * torso, lm.hipY - 0.25 * torso, lm.shoulderLeftX, lm.shoulderRightX);
  const hipPad = (lm.hipRightX - lm.hipLeftX) * 0.5;
  const trousers = mean(lm.hipY + 0.55 * torso, lm.hipY + 1.2 * torso, lm.hipLeftX - hipPad, lm.hipRightX + hipPad);
  if (!trousers) return false; // nothing worn below the hips is visible

  const dist = (i: number, ref: number[]) => {
    const dl = (lab[i * 3] - ref[0]) * 0.6;
    const da = lab[i * 3 + 1] - ref[1];
    const db = lab[i * 3 + 2] - ref[2];
    return dl * dl + da * da + db * db;
  };
  let distinct = false;
  if (shirt) {
    const dl = (shirt[0] - trousers[0]) * 0.6;
    distinct = Math.sqrt(dl * dl + (shirt[1] - trousers[1]) ** 2 + (shirt[2] - trousers[2]) ** 2) > 12;
  }

  for (let y = Math.max(0, Math.floor(bandTop)); y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (prob[i] <= 0) continue;
      if (y >= bandBottom) {
        prob[i] = 0;
      } else if (distinct && shirt) {
        if (dist(i, trousers) < dist(i, shirt)) prob[i] = 0;
      } else {
        // Same colour top and bottom: fall back to a soft hem just below the hips.
        prob[i] *= 1 - smoothstep(lm.hipY, lm.hipY + 0.15 * torso, y);
      }
    }
  }
  return true;
}

export interface LowResSegmentation {
  /** Probability of "clothes" per pixel (0..1). */
  clothes: Float32Array;
  /** Max probability of face, hair or body skin per pixel (0..1). */
  protect: Float32Array;
}

/** Runs the segmenter on a small canvas and returns its clothes and protection maps at that size. */
export function segmentLowRes(segmenter: ImageSegmenter, canvas: HTMLCanvasElement, lw: number, lh: number): LowResSegmentation {
  const result = segmenter.segment(canvas);
  try {
    const labels = segmenter.getLabels().map((l) => l.toLowerCase());
    const indexOf = (name: string, fallback: number) => {
      const i = labels.findIndex((l) => l.includes(name));
      return i >= 0 ? i : fallback;
    };
    const masks = result.confidenceMasks ?? [];
    const readMask = (i: number): Float32Array | null => {
      const m = masks[i];
      if (!m) return null;
      return resizeFloat(m.getAsFloat32Array(), m.width, m.height, lw, lh);
    };
    const clothes = readMask(indexOf("clothes", 4));
    if (!clothes) throw new Error("Segmentation returned no clothes mask");
    const protect = new Float32Array(lw * lh);
    for (const src of [readMask(indexOf("face", 3)), readMask(indexOf("hair", 1)), readMask(indexOf("body", 2))]) {
      if (!src) continue;
      for (let i = 0; i < protect.length; i++) if (src[i] > protect[i]) protect[i] = src[i];
    }
    return { clothes, protect };
  } finally {
    result.close();
  }
}

export async function detectShirt(photo: HTMLCanvasElement, onStage?: (s: DetectStage) => void): Promise<DetectionResult> {
  const W = photo.width;
  const H = photo.height;
  const ls = Math.min(1, ANALYSIS_EDGE / Math.max(W, H));
  const lw = Math.max(1, Math.round(W * ls));
  const lh = Math.max(1, Math.round(H * ls));
  const low = document.createElement("canvas");
  low.width = lw;
  low.height = lh;
  const lctx = low.getContext("2d", { willReadFrequently: true });
  if (!lctx) throw new Error("Canvas unavailable");
  lctx.imageSmoothingQuality = "high";
  lctx.drawImage(photo, 0, 0, lw, lh);
  const lowPixels = lctx.getImageData(0, 0, lw, lh).data;

  onStage?.("loading-model");
  const [segmenter, pose] = await Promise.all([getSegmenter(), getPose()]);

  onStage?.("detecting");
  await nextFrame();
  const { clothes, protect: protectLow } = segmentLowRes(segmenter, low, lw, lh);

  let landmarks: Landmarks | null = null;
  if (pose) {
    try {
      const poseResult = pose.detect(low);
      landmarks = readLandmarks(poseResult.landmarks[0], lw, lh);
      (poseResult as { close?: () => void }).close?.();
    } catch {
      landmarks = null;
    }
  }

  onStage?.("refining");
  await nextFrame();
  const n = lw * lh;
  const lab = rgbaToLab(lowPixels, n);
  const trousersSeparated = landmarks ? separateTrousers(clothes, lab, lw, lh, landmarks) : false;

  // Keep the main garment only, and close small enclosed gaps (buttons, pens, specular spots).
  const binary = new Uint8Array(n);
  for (let i = 0; i < n; i++) binary[i] = clothes[i] > 0.5 ? 1 : 0;
  const main = keepMainComponents(binary, lw, lh, 0.12);
  let mainArea = 0;
  for (let i = 0; i < n; i++) mainArea += main[i];
  const keep = fillHoles(main, lw, lh, Math.max(16, mainArea * 0.03));
  for (let i = 0; i < n; i++) if (keep[i] && !main[i]) clothes[i] = 1;
  // Soft edge probabilities survive only near kept components (keep, dilated by the filter radius).
  const keepSoft = new Float32Array(n);
  for (let i = 0; i < n; i++) keepSoft[i] = keep[i];
  const r = Math.max(2, Math.round(Math.max(lw, lh) / 128));
  const near = boxFilter(keepSoft, lw, lh, r);
  for (let i = 0; i < n; i++) if (near[i] <= 0) clothes[i] = 0;

  // Edge refinement guided by the photo's colours.
  const gr = new Float32Array(n);
  const gg = new Float32Array(n);
  const gb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gr[i] = lowPixels[i * 4] / 255;
    gg[i] = lowPixels[i * 4 + 1] / 255;
    gb[i] = lowPixels[i * 4 + 2] / 255;
  }
  const coeffs = guidedCoefficientsColor(gr, gg, gb, clothes, lw, lh, r, 5e-4);

  const full = photo.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, W, H).data;
  if (!full) throw new Error("Canvas unavailable");
  const refined = applyGuidedUpsampleColor(coeffs, full, W, H);

  // Protection map: anything that is clearly face, hair or skin stays untouched.
  const protect = resizeFloat(protectLow, lw, lh, W, H);
  const coarse = resizeFloat(clothes, lw, lh, W, H);

  const mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) {
    // The guided result can't introduce shirt far from where the model saw it.
    let a = smoothstep(0.35, 0.65, refined[i]) * smoothstep(0.02, 0.2, coarse[i]);
    a *= 1 - smoothstep(0.5, 0.75, protect[i]);
    mask[i] = Math.round(a * 255);
  }
  releaseLow(low);

  return { mask, coverage: maskCoverage(mask), trousersSeparated, poseFound: landmarks !== null };
}

function releaseLow(c: HTMLCanvasElement) {
  c.width = 0;
  c.height = 0;
}
