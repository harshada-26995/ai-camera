/**
 * Crop geometry shared by the on-screen cropper and the final render, so what
 * the user frames is exactly what gets processed.
 *
 * The image is centred in the frame, offset by `pan`, rotated by θ and scaled
 * by s. Pan is stored in frame-width units so it survives layout changes.
 */

export type AspectId = "original" | "4:5" | "3:4" | "1:1" | "9:16";

export const ASPECTS: { id: AspectId; label: string; ratio: number | null }[] = [
  { id: "original", label: "Original", ratio: null },
  { id: "4:5", label: "4:5", ratio: 4 / 5 },
  { id: "3:4", label: "3:4", ratio: 3 / 4 },
  { id: "1:1", label: "Square", ratio: 1 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
];

export interface CropState {
  aspect: AspectId;
  /** Quarter turns clockwise (0..3). */
  quarter: number;
  /** Fine straighten angle in degrees. */
  straighten: number;
  /** Zoom on top of the minimum "cover" scale (≥ 1). */
  zoom: number;
  panX: number;
  panY: number;
}

export const DEFAULT_CROP: CropState = { aspect: "original", quarter: 0, straighten: 0, zoom: 1, panX: 0, panY: 0 };

export const MAX_OUTPUT_EDGE = 1600;

export function cropAngle(c: CropState): number {
  return (c.quarter * Math.PI) / 2 + (c.straighten * Math.PI) / 180;
}

/** Frame aspect (width / height) for a given image and crop. */
export function frameAspect(iw: number, ih: number, c: CropState): number {
  const preset = ASPECTS.find((a) => a.id === c.aspect)?.ratio;
  if (preset) return preset;
  return c.quarter % 2 === 1 ? ih / iw : iw / ih;
}

/** Smallest scale at which the rotated image fully covers a fw×fh frame. */
export function coverScale(iw: number, ih: number, fw: number, fh: number, theta: number): number {
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  return Math.max((fw * c + fh * s) / iw, (fw * s + fh * c) / ih);
}

/** Clamps a pan (in frame pixels) so the frame never shows outside the image. */
export function clampPan(
  panX: number,
  panY: number,
  iw: number,
  ih: number,
  fw: number,
  fh: number,
  theta: number,
  scale: number,
): { x: number; y: number } {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  // Pan expressed in the image's rotated axes.
  let lx = c * panX + s * panY;
  let ly = -s * panX + c * panY;
  const ex = (fw * Math.abs(c) + fh * Math.abs(s)) / 2;
  const ey = (fw * Math.abs(s) + fh * Math.abs(c)) / 2;
  const limX = Math.max(0, (iw * scale) / 2 - ex);
  const limY = Math.max(0, (ih * scale) / 2 - ey);
  lx = Math.min(Math.max(lx, -limX), limX);
  ly = Math.min(Math.max(ly, -limY), limY);
  return { x: c * lx - s * ly, y: s * lx + c * ly };
}

/** Output pixel size: native resolution of the framed region, capped at MAX_OUTPUT_EDGE. */
export function outputSize(iw: number, ih: number, c: CropState, maxEdge = MAX_OUTPUT_EDGE): { width: number; height: number } {
  const aspect = frameAspect(iw, ih, c);
  const unitScale = c.zoom * coverScale(iw, ih, 1, 1 / aspect, cropAngle(c));
  let width = 1 / unitScale;
  let height = width / aspect;
  const k = Math.min(1, maxEdge / Math.max(width, height));
  width *= k;
  height *= k;
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

export function isIdentityCrop(c: CropState): boolean {
  return c.aspect === "original" && c.quarter === 0 && c.straighten === 0 && c.zoom === 1 && c.panX === 0 && c.panY === 0;
}
