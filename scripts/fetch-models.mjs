// Downloads the MediaPipe models into /public/models so the app never needs a third-party CDN at runtime.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "public", "models");
const models = {
  "selfie_multiclass_256x256.tflite":
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
  "pose_landmarker_lite.task":
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
};

mkdirSync(dest, { recursive: true });
for (const [name, url] of Object.entries(models)) {
  const file = join(dest, name);
  if (existsSync(file)) continue;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log(`[models] downloaded ${name}`);
  } catch (err) {
    console.warn(`[models] could not download ${name} (${err.message}); the app will fall back to the hosted URL`);
  }
}
