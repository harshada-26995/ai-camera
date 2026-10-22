/**
 * Turns the live camera view of a fabric into a repeatable pattern tile.
 * The centre square of each frame is cropped, its lighting is evened out (so
 * shadows and vignetting don't repeat across the shirt), and it is mirrored
 * into a seamless 512² tile. No detection runs here, so it is cheap enough
 * to update every frame.
 */
import { TILE } from "./patterns";

export type FabricMode = "print" | "colour";

/** Shared key so the renderer re-uses one GPU texture for the live fabric. */
export const LIVE_FABRIC_KEY = "live-fabric";
/** Natural size of the camera tile on the shirt at scale 1 (fraction of shirt width). */
export const LIVE_FABRIC_TILE_FRACTION = 0.3;

const CELL = TILE / 2;
const LIGHT_SAMPLES = 6;

export class FabricScanner {
  readonly tile = document.createElement("canvas");
  private readonly cell = document.createElement("canvas");
  private readonly light = document.createElement("canvas");
  private readonly avg = document.createElement("canvas");
  private readonly tileCtx: CanvasRenderingContext2D;
  private readonly cellCtx: CanvasRenderingContext2D;
  private readonly lightCtx: CanvasRenderingContext2D;
  private readonly avgCtx: CanvasRenderingContext2D;
  /** Average colour of the centre square in the latest frame. */
  colour = "#808080";

  constructor() {
    this.tile.width = this.tile.height = TILE;
    this.cell.width = this.cell.height = CELL;
    this.light.width = this.light.height = LIGHT_SAMPLES;
    this.avg.width = this.avg.height = 8;
    const ctx = (c: HTMLCanvasElement) => {
      const x = c.getContext("2d", { willReadFrequently: true });
      if (!x) throw new Error("Canvas unavailable");
      return x;
    };
    this.tileCtx = ctx(this.tile);
    this.cellCtx = ctx(this.cell);
    this.lightCtx = ctx(this.light);
    this.avgCtx = ctx(this.avg);
  }

  /**
   * Updates the tile from the current video frame. `cropFraction` is the
   * share of the frame's short side used (smaller = zoomed in on the weave).
   * Returns false when no frame is available yet.
   */
  update(video: HTMLVideoElement, mode: FabricMode, cropFraction: number, evenLighting: boolean): boolean {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return false;
    const side = Math.min(vw, vh) * cropFraction;
    const sx = (vw - side) / 2;
    const sy = (vh - side) / 2;

    // Average colour (also drives colour mode).
    this.avgCtx.drawImage(video, sx, sy, side, side, 0, 0, 8, 8);
    const a = this.avgCtx.getImageData(0, 0, 8, 8).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < a.length; i += 4) {
      r += a[i];
      g += a[i + 1];
      b += a[i + 2];
    }
    const n = a.length / 4;
    const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
    this.colour = `#${hex(r)}${hex(g)}${hex(b)}`;

    if (mode === "colour") {
      this.tileCtx.fillStyle = this.colour;
      this.tileCtx.fillRect(0, 0, TILE, TILE);
      return true;
    }

    this.cellCtx.imageSmoothingQuality = "high";
    this.cellCtx.drawImage(video, sx, sy, side, side, 0, 0, CELL, CELL);
    if (evenLighting) this.flattenLighting();

    // Mirror into quadrants so every edge meets its own reflection.
    for (const [mx, my] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ] as const) {
      this.tileCtx.save();
      this.tileCtx.translate(mx === 1 ? 0 : TILE, my === 1 ? 0 : TILE);
      this.tileCtx.scale(mx, my);
      this.tileCtx.drawImage(this.cell, 0, 0);
      this.tileCtx.restore();
    }
    return true;
  }

  /** Divides out slow brightness changes (shadows, vignetting), keeping the weave and print. */
  private flattenLighting(): void {
    this.lightCtx.imageSmoothingQuality = "high";
    this.lightCtx.drawImage(this.cell, 0, 0, LIGHT_SAMPLES, LIGHT_SAMPLES);
    const lp = this.lightCtx.getImageData(0, 0, LIGHT_SAMPLES, LIGHT_SAMPLES).data;
    const lum = new Float32Array(LIGHT_SAMPLES * LIGHT_SAMPLES);
    let mean = 0;
    for (let i = 0; i < lum.length; i++) {
      lum[i] = 0.299 * lp[i * 4] + 0.587 * lp[i * 4 + 1] + 0.114 * lp[i * 4 + 2] + 1;
      mean += lum[i];
    }
    mean /= lum.length;
    const img = this.cellCtx.getImageData(0, 0, CELL, CELL);
    const d = img.data;
    const step = CELL / LIGHT_SAMPLES;
    for (let y = 0; y < CELL; y++) {
      const fy = Math.min(Math.max(y / step - 0.5, 0), LIGHT_SAMPLES - 1);
      const y0 = Math.floor(fy);
      const y1 = Math.min(y0 + 1, LIGHT_SAMPLES - 1);
      const ty = fy - y0;
      for (let x = 0; x < CELL; x++) {
        const fx = Math.min(Math.max(x / step - 0.5, 0), LIGHT_SAMPLES - 1);
        const x0 = Math.floor(fx);
        const x1 = Math.min(x0 + 1, LIGHT_SAMPLES - 1);
        const tx = fx - x0;
        const l =
          (lum[y0 * LIGHT_SAMPLES + x0] * (1 - tx) + lum[y0 * LIGHT_SAMPLES + x1] * tx) * (1 - ty) +
          (lum[y1 * LIGHT_SAMPLES + x0] * (1 - tx) + lum[y1 * LIGHT_SAMPLES + x1] * tx) * ty;
        const k = mean / l;
        const o = (y * CELL + x) * 4;
        d[o] = d[o] * k;
        d[o + 1] = d[o + 1] * k;
        d[o + 2] = d[o + 2] * k;
      }
    }
    this.cellCtx.putImageData(img, 0, 0);
  }

  /** A frozen copy of the current tile (for "Keep this fabric"). */
  snapshot(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = c.height = TILE;
    c.getContext("2d")?.drawImage(this.tile, 0, 0);
    return c;
  }

  dispose(): void {
    for (const c of [this.tile, this.cell, this.light, this.avg]) {
      c.width = 0;
      c.height = 0;
    }
  }
}
