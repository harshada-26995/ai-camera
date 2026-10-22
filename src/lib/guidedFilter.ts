/**
 * Edge-aware mask refinement.
 *
 * The segmentation model works at 256×256, so its raw mask is blurry at the
 * photo's resolution. A guided filter (He et al., 2010) snaps the soft mask
 * to edges in the photo itself. We use the "fast guided filter" variant: the
 * linear coefficients are solved at low resolution and then upsampled, which
 * keeps memory and time low enough for phones.
 */

/** Mean filter over a (2r+1)² window, clamped at the borders. O(N) via prefix sums. */
export function boxFilter(
  src: Float32Array,
  w: number,
  h: number,
  r: number,
  out: Float32Array = new Float32Array(w * h),
  tmp: Float32Array = new Float32Array(w * h),
): Float32Array {
  const acc = new Float64Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) acc[x + 1] = acc[x] + src[row + x];
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      tmp[row + x] = (acc[x1 + 1] - acc[x0]) / (x1 - x0 + 1);
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) acc[y + 1] = acc[y] + tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h - 1, y + r);
      out[y * w + x] = (acc[y1 + 1] - acc[y0]) / (y1 - y0 + 1);
    }
  }
  return out;
}

export interface GuidedCoefficients {
  a: Float32Array;
  b: Float32Array;
  width: number;
  height: number;
}

/** Solves q = a·I + b locally for guide I and input p (both 0..1, same size). */
export function guidedCoefficients(
  guide: Float32Array,
  input: Float32Array,
  w: number,
  h: number,
  r: number,
  eps: number,
): GuidedCoefficients {
  const n = w * h;
  const tmp = new Float32Array(n);
  const meanI = boxFilter(guide, w, h, r, new Float32Array(n), tmp);
  const meanP = boxFilter(input, w, h, r, new Float32Array(n), tmp);
  const prod = new Float32Array(n);
  for (let i = 0; i < n; i++) prod[i] = guide[i] * guide[i];
  const corrI = boxFilter(prod, w, h, r, new Float32Array(n), tmp);
  for (let i = 0; i < n; i++) prod[i] = guide[i] * input[i];
  const corrIp = boxFilter(prod, w, h, r, new Float32Array(n), tmp);

  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varI = corrI[i] - meanI[i] * meanI[i];
    const covIp = corrIp[i] - meanI[i] * meanP[i];
    a[i] = covIp / (varI + eps);
    b[i] = meanP[i] - a[i] * meanI[i];
  }
  return {
    a: boxFilter(a, w, h, r, new Float32Array(n), tmp),
    b: boxFilter(b, w, h, r, new Float32Array(n), tmp),
    width: w,
    height: h,
  };
}

/** Bilinear sample of a w×h float grid at continuous pixel coords (x, y). */
export function sampleBilinear(src: Float32Array, w: number, h: number, x: number, y: number): number {
  const cx = Math.min(Math.max(x, 0), w - 1);
  const cy = Math.min(Math.max(y, 0), h - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const top = src[y0 * w + x0] * (1 - fx) + src[y0 * w + x1] * fx;
  const bottom = src[y1 * w + x0] * (1 - fx) + src[y1 * w + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Resamples a float grid to a new size (bilinear, pixel-centre aligned). */
export function resizeFloat(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  if (sw === dw && sh === dh) return src.slice();
  const out = new Float32Array(dw * dh);
  const sx = sw / dw;
  const sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = (y + 0.5) * sy - 0.5;
    for (let x = 0; x < dw; x++) {
      out[y * dw + x] = sampleBilinear(src, sw, sh, (x + 0.5) * sx - 0.5, fy);
    }
  }
  return out;
}

export interface ColorGuidedCoefficients {
  ar: Float32Array;
  ag: Float32Array;
  ab: Float32Array;
  b: Float32Array;
  width: number;
  height: number;
}

/**
 * Colour-guide variant: edges are separated by colour, not just brightness
 * (e.g. a blue shirt against green grass of similar luminance).
 */
export function guidedCoefficientsColor(
  r: Float32Array,
  g: Float32Array,
  bl: Float32Array,
  input: Float32Array,
  w: number,
  h: number,
  radius: number,
  eps: number,
): ColorGuidedCoefficients {
  const n = w * h;
  const tmp = new Float32Array(n);
  const prod = new Float32Array(n);
  const box = (src: Float32Array) => boxFilter(src, w, h, radius, new Float32Array(n), tmp);
  const boxProd = (x: Float32Array, y: Float32Array) => {
    for (let i = 0; i < n; i++) prod[i] = x[i] * y[i];
    return box(prod);
  };
  const mr = box(r);
  const mg = box(g);
  const mb = box(bl);
  const mp = box(input);
  const rr = boxProd(r, r);
  const rg = boxProd(r, g);
  const rb = boxProd(r, bl);
  const gg = boxProd(g, g);
  const gb = boxProd(g, bl);
  const bb = boxProd(bl, bl);
  const rp = boxProd(r, input);
  const gp = boxProd(g, input);
  const bp = boxProd(bl, input);

  const ar = new Float32Array(n);
  const ag = new Float32Array(n);
  const ab = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Covariance of the guide (+ eps on the diagonal) and covariance with the input.
    const a11 = rr[i] - mr[i] * mr[i] + eps;
    const a12 = rg[i] - mr[i] * mg[i];
    const a13 = rb[i] - mr[i] * mb[i];
    const a22 = gg[i] - mg[i] * mg[i] + eps;
    const a23 = gb[i] - mg[i] * mb[i];
    const a33 = bb[i] - mb[i] * mb[i] + eps;
    const cr = rp[i] - mr[i] * mp[i];
    const cg = gp[i] - mg[i] * mp[i];
    const cb = bp[i] - mb[i] * mp[i];
    const i11 = a22 * a33 - a23 * a23;
    const i12 = a13 * a23 - a12 * a33;
    const i13 = a12 * a23 - a13 * a22;
    const i22 = a11 * a33 - a13 * a13;
    const i23 = a12 * a13 - a11 * a23;
    const i33 = a11 * a22 - a12 * a12;
    const det = a11 * i11 + a12 * i12 + a13 * i13;
    const inv = det !== 0 ? 1 / det : 0;
    ar[i] = (i11 * cr + i12 * cg + i13 * cb) * inv;
    ag[i] = (i12 * cr + i22 * cg + i23 * cb) * inv;
    ab[i] = (i13 * cr + i23 * cg + i33 * cb) * inv;
    b[i] = mp[i] - ar[i] * mr[i] - ag[i] * mg[i] - ab[i] * mb[i];
  }
  return { ar: box(ar), ag: box(ag), ab: box(ab), b: box(b), width: w, height: h };
}

/**
 * Applies low-res colour coefficients at full resolution, sampling them
 * bilinearly per pixel so no full-size coefficient buffers are allocated.
 * `rgba` is the full-res photo; channels are normalised to 0..1.
 */
export function applyGuidedUpsampleColor(c: ColorGuidedCoefficients, rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const sx = c.width / w;
  const sy = c.height / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(Math.max((y + 0.5) * sy - 0.5, 0), c.height - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, c.height - 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(Math.max((x + 0.5) * sx - 0.5, 0), c.width - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, c.width - 1);
      const tx = fx - x0;
      const i00 = y0 * c.width + x0;
      const i01 = y0 * c.width + x1;
      const i10 = y1 * c.width + x0;
      const i11 = y1 * c.width + x1;
      const w00 = (1 - tx) * (1 - ty);
      const w01 = tx * (1 - ty);
      const w10 = (1 - tx) * ty;
      const w11 = tx * ty;
      const lerp = (a: Float32Array) => a[i00] * w00 + a[i01] * w01 + a[i10] * w10 + a[i11] * w11;
      const o = (y * w + x) * 4;
      out[y * w + x] = lerp(c.ar) * (rgba[o] / 255) + lerp(c.ag) * (rgba[o + 1] / 255) + lerp(c.ab) * (rgba[o + 2] / 255) + lerp(c.b);
    }
  }
  return out;
}

/** Applies low-res coefficients to a full-res guide: q = up(a)·I + up(b). */
export function applyGuidedUpsample(coeffs: GuidedCoefficients, guide: Float32Array, w: number, h: number): Float32Array {
  const a = resizeFloat(coeffs.a, coeffs.width, coeffs.height, w, h);
  const b = resizeFloat(coeffs.b, coeffs.width, coeffs.height, w, h);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = a[i] * guide[i] + b[i];
  return out;
}
