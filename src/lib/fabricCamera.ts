/**
 * Turns the live camera view of a fabric into the image shown on his shirt.
 * The camera's centre square is copied as-is (no mirroring, no relighting),
 * so the shirt shows exactly the cloth that is visible on screen. No
 * detection runs here, so it is cheap enough to update every frame.
 */

export type FabricMode = "print" | "colour";

/** Shared key so the renderer re-uses one GPU texture for the live fabric. */
export const LIVE_FABRIC_KEY = "live-fabric";

/** Power of two so WebGL can mipmap it; high enough to stay sharp on a 1600 px photo. */
const SIZE = 1024;

export class FabricScanner {
  readonly tile = document.createElement("canvas");
  private readonly avg = document.createElement("canvas");
  private readonly tileCtx: CanvasRenderingContext2D;
  private readonly avgCtx: CanvasRenderingContext2D;
  /** Average colour of the camera square in the latest frame. */
  colour = "#808080";

  constructor() {
    this.tile.width = this.tile.height = SIZE;
    this.avg.width = this.avg.height = 8;
    const tileCtx = this.tile.getContext("2d");
    const avgCtx = this.avg.getContext("2d", { willReadFrequently: true });
    if (!tileCtx || !avgCtx) throw new Error("Canvas unavailable");
    this.tileCtx = tileCtx;
    this.avgCtx = avgCtx;
  }

  /**
   * Copies the centre square of the current frame, zoomed in by `zoom` (the
   * same crop the preview shows). Returns false when no frame is available yet.
   */
  update(video: HTMLVideoElement, mode: FabricMode, zoom = 1): boolean {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return false;
    const side = Math.min(vw, vh) / Math.max(1, zoom);
    const sx = (vw - side) / 2;
    const sy = (vh - side) / 2;

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
      this.tileCtx.fillRect(0, 0, SIZE, SIZE);
    } else {
      this.tileCtx.imageSmoothingQuality = "high";
      this.tileCtx.drawImage(video, sx, sy, side, side, 0, 0, SIZE, SIZE);
    }
    return true;
  }

  /** A frozen copy of the current image (for "Keep this fabric"). */
  snapshot(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = c.height = SIZE;
    c.getContext("2d")?.drawImage(this.tile, 0, 0);
    return c;
  }

  dispose(): void {
    for (const c of [this.tile, this.avg]) {
      c.width = 0;
      c.height = 0;
    }
  }
}
