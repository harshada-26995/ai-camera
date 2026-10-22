/**
 * Shirt-mask editing primitives. A mask is a Uint8Array (0 = untouched photo,
 * 255 = fully shirt) at the working photo's resolution.
 */
import { rgbToLab } from "./color";

export type BrushMode = "add" | "erase" | "restore";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * Stamps one soft round dab. `hardness` (0..1) is the fraction of the radius
 * painted at full strength before the edge falls off. `reference` is the
 * auto-detected mask used by the restore brush.
 */
export function stampBrush(
  mask: Uint8Array,
  reference: Uint8Array | null,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  hardness: number,
  mode: BrushMode,
): Rect | null {
  const r = Math.max(0.5, radius);
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  if (x0 > x1 || y0 > y1) return null;
  const inner = r * Math.min(Math.max(hardness, 0), 1);
  const falloff = Math.max(r - inner, 1e-3);
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > r) continue;
      const t = d <= inner ? 1 : 1 - (d - inner) / falloff;
      const strength = t * t * (3 - 2 * t);
      const i = y * w + x;
      const cur = mask[i];
      if (mode === "add") {
        const v = Math.round(strength * 255);
        if (v > cur) mask[i] = v;
      } else if (mode === "erase") {
        const v = Math.round((1 - strength) * cur);
        if (v < cur) mask[i] = v;
      } else {
        const target = reference ? reference[i] : 0;
        mask[i] = Math.round(cur + (target - cur) * strength);
      }
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Stamps dabs along a line so fast strokes stay continuous. */
export function strokeSegment(
  mask: Uint8Array,
  reference: Uint8Array | null,
  w: number,
  h: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  radius: number,
  hardness: number,
  mode: BrushMode,
): Rect | null {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const step = Math.max(1, radius * 0.25);
  const steps = Math.max(1, Math.ceil(dist / step));
  let dirty: Rect | null = null;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    dirty = unionRect(
      dirty,
      stampBrush(mask, reference, w, h, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, radius, hardness, mode),
    );
  }
  return dirty;
}

/**
 * Colour-similarity region grow ("magic select"). Returns a binary region
 * (0/255) of pixels connected to the seed whose L*a*b* distance from the
 * seed's average colour is below `tolerance`.
 */
export function floodSelect(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  seedX: number,
  seedY: number,
  tolerance: number,
): Uint8Array {
  const region = new Uint8Array(w * h);
  const sx = Math.min(Math.max(Math.round(seedX), 0), w - 1);
  const sy = Math.min(Math.max(Math.round(seedY), 0), h - 1);
  const lab = new Float32Array(3);
  let sl = 0;
  let sa = 0;
  let sb = 0;
  let count = 0;
  for (let y = Math.max(0, sy - 2); y <= Math.min(h - 1, sy + 2); y++) {
    for (let x = Math.max(0, sx - 2); x <= Math.min(w - 1, sx + 2); x++) {
      const o = (y * w + x) * 4;
      rgbToLab(rgba[o], rgba[o + 1], rgba[o + 2], lab, 0);
      sl += lab[0];
      sa += lab[1];
      sb += lab[2];
      count++;
    }
  }
  sl /= count;
  sa /= count;
  sb /= count;
  // Lightness varies a lot across folds, so weigh it less than chroma.
  const tol2 = tolerance * tolerance;
  const matches = (i: number): boolean => {
    const o = i * 4;
    rgbToLab(rgba[o], rgba[o + 1], rgba[o + 2], lab, 0);
    const dl = (lab[0] - sl) * 0.5;
    const da = lab[1] - sa;
    const db = lab[2] - sb;
    return dl * dl + da * da + db * db <= tol2;
  };

  const visited = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const start = sy * w + sx;
  stack[top++] = start;
  visited[start] = 1;
  while (top > 0) {
    const i = stack[--top];
    if (!matches(i)) continue;
    region[i] = 255;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0 && !visited[i - 1]) {
      visited[i - 1] = 1;
      stack[top++] = i - 1;
    }
    if (x < w - 1 && !visited[i + 1]) {
      visited[i + 1] = 1;
      stack[top++] = i + 1;
    }
    if (y > 0 && !visited[i - w]) {
      visited[i - w] = 1;
      stack[top++] = i - w;
    }
    if (y < h - 1 && !visited[i + w]) {
      visited[i + w] = 1;
      stack[top++] = i + w;
    }
  }
  return region;
}

/** Fills small holes (e.g. buttons, specular spots) and softens a binary region's edge. */
export function closeAndFeather(region: Uint8Array, w: number, h: number, radius = 1): Uint8Array {
  const src = new Float32Array(region.length);
  for (let i = 0; i < region.length; i++) src[i] = region[i] / 255;
  const out = new Uint8Array(region.length);
  const blurred = new Float32Array(region.length);
  boxBlurInto(src, blurred, w, h, radius + 1);
  // Close: anything mostly surrounded by the region joins it, then feather.
  for (let i = 0; i < region.length; i++) src[i] = blurred[i] > 0.45 ? 1 : 0;
  boxBlurInto(src, blurred, w, h, radius);
  for (let i = 0; i < region.length; i++) out[i] = Math.round(blurred[i] * 255);
  return out;
}

function boxBlurInto(src: Float32Array, out: Float32Array, w: number, h: number, r: number): void {
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(Math.max(x, 0), w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / (2 * r + 1);
      acc += src[row + Math.min(x + r + 1, w - 1)] - src[row + Math.max(x - r, 0)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(Math.max(y, 0), h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(y + r + 1, h - 1) * w + x] - tmp[Math.max(y - r, 0) * w + x];
    }
  }
}

export function mergeMax(target: Uint8Array, source: Uint8Array): void {
  for (let i = 0; i < target.length; i++) if (source[i] > target[i]) target[i] = source[i];
}

/**
 * Keeps 4-connected components of a binary map whose area is at least
 * `minRatio` × the largest component. Drops stray specks and other people's clothes.
 */
export function keepMainComponents(binary: Uint8Array, w: number, h: number, minRatio: number): Uint8Array {
  const labels = new Int32Array(w * h);
  const sizes: number[] = [0];
  const stack = new Int32Array(w * h);
  let next = 1;
  for (let i = 0; i < binary.length; i++) {
    if (!binary[i] || labels[i]) continue;
    let top = 0;
    let size = 0;
    stack[top++] = i;
    labels[i] = next;
    while (top > 0) {
      const p = stack[--top];
      size++;
      const x = p % w;
      if (x > 0 && binary[p - 1] && !labels[p - 1]) {
        labels[p - 1] = next;
        stack[top++] = p - 1;
      }
      if (x < w - 1 && binary[p + 1] && !labels[p + 1]) {
        labels[p + 1] = next;
        stack[top++] = p + 1;
      }
      if (p >= w && binary[p - w] && !labels[p - w]) {
        labels[p - w] = next;
        stack[top++] = p - w;
      }
      if (p + w < binary.length && binary[p + w] && !labels[p + w]) {
        labels[p + w] = next;
        stack[top++] = p + w;
      }
    }
    sizes.push(size);
    next++;
  }
  let largest = 0;
  for (const s of sizes) if (s > largest) largest = s;
  const out = new Uint8Array(w * h);
  if (largest === 0) return out;
  for (let i = 0; i < out.length; i++) {
    const l = labels[i];
    if (l && sizes[l] >= largest * minRatio) out[i] = 1;
  }
  return out;
}

/**
 * Fills enclosed gaps in a binary map (buttons, a pocket pen, specular spots)
 * up to `maxHoleArea` pixels. Gaps connected to the image border are open
 * regions, not holes, and are left alone.
 */
export function fillHoles(binary: Uint8Array, w: number, h: number, maxHoleArea: number): Uint8Array {
  const out = binary.slice();
  const outside = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const seed = (i: number) => {
    if (!binary[i] && !outside[i]) {
      outside[i] = 1;
      stack[top++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  const grow = (visit: (i: number) => void) => {
    while (top > 0) {
      const p = stack[--top];
      const x = p % w;
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (p >= w) visit(p - w);
      if (p + w < w * h) visit(p + w);
    }
  };
  grow(seed);

  const seen = new Uint8Array(w * h);
  const members: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (binary[i] || outside[i] || seen[i]) continue;
    members.length = 0;
    seen[i] = 1;
    stack[top++] = i;
    while (top > 0) {
      const p = stack[--top];
      members.push(p);
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q >= 0 && q < w * h && !binary[q] && !seen[q]) {
          seen[q] = 1;
          stack[top++] = q;
        }
      }
    }
    if (members.length <= maxHoleArea) for (const p of members) out[p] = 1;
  }
  return out;
}

/** Fraction of pixels that are predominantly shirt. */
export function maskCoverage(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] > 127) n++;
  return mask.length ? n / mask.length : 0;
}

/** Bounding box of pixels above `threshold`, or null when empty. */
export function maskBounds(mask: Uint8Array, w: number, h: number, threshold = 127): Rect | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[row + x] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
