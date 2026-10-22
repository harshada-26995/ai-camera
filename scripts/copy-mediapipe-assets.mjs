// Copies MediaPipe's WASM runtime into /public so segmentation runs fully self-hosted.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const dest = join(root, "public", "mediapipe", "wasm");

if (existsSync(src)) {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log("[mediapipe] copied wasm runtime to public/mediapipe/wasm");
} else {
  console.warn("[mediapipe] wasm folder not found; skipping copy");
}
