/** Colour helpers shared by segmentation clean-up and the magic-select tool. */

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function srgbByteToLinear(v: number): number {
  return SRGB_TO_LINEAR[v & 255];
}

/** Relative luminance (linear light, 0..1) of an sRGB byte triplet. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * SRGB_TO_LINEAR[r & 255] + 0.7152 * SRGB_TO_LINEAR[g & 255] + 0.0722 * SRGB_TO_LINEAR[b & 255];
}

function labF(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

/** Converts sRGB bytes to CIE L*a*b* (D65), writing into out[o..o+2]. */
export function rgbToLab(r: number, g: number, b: number, out: Float32Array, o: number): void {
  const lr = SRGB_TO_LINEAR[r & 255];
  const lg = SRGB_TO_LINEAR[g & 255];
  const lb = SRGB_TO_LINEAR[b & 255];
  const x = (0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047;
  const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const z = (0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883;
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  out[o] = 116 * fy - 16;
  out[o + 1] = 500 * (fx - fy);
  out[o + 2] = 200 * (fy - fz);
}

/** Lab buffer (3 floats per pixel) for an RGBA byte buffer. */
export function rgbaToLab(rgba: Uint8ClampedArray, pixelCount: number): Float32Array {
  const lab = new Float32Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i++) {
    rgbToLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], lab, i * 3);
  }
  return lab;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
