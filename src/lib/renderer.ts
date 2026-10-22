/**
 * WebGL try-on renderer.
 *
 * The photo, mask and shading maps are uploaded once per photo/mask. Switching
 * patterns only swaps one cached texture and redraws a single quad, so a
 * change costs a few milliseconds on the GPU with no network involved.
 *
 * Shading model (linear light): the original shirt's luminance divided by its
 * average gives a per-pixel shading ratio (folds < 1, highlights > 1). The new
 * pattern is multiplied by that ratio, so folds, seams and shadows carry over.
 * Pixels where the mask is 0 output the original photo bytes exactly.
 */
import { luminance } from "./color";
import { boxFilter } from "./guidedFilter";
import type { LookSettings } from "./look";
import { maskBounds } from "./mask";

const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPhoto;
uniform sampler2D uMask;
uniform sampler2D uCoarse;
uniform sampler2D uPattern;
uniform vec2 uSize;
uniform vec2 uCenter;
uniform float uMeanLum;
uniform float uTile;
uniform vec2 uRot;
uniform vec2 uOffset;
uniform float uIntensity;
uniform float uShading;
uniform float uDetail;
uniform float uWarp;
uniform float uExposure;
uniform float uSaturation;
uniform float uHue;
uniform float uOriginal;
uniform float uSplit;
uniform float uMaskSharpen;

vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }
float lum(vec3 lin) { return dot(lin, vec3(0.2126, 0.7152, 0.0722)); }

vec3 hueSat(vec3 c, float h, float s) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float ch = cos(h);
  float sh = sin(h);
  float i2 = (i * ch - q * sh) * s;
  float q2 = (i * sh + q * ch) * s;
  return vec3(y + 0.956 * i2 + 0.621 * q2, y - 0.272 * i2 - 0.647 * q2, y - 1.106 * i2 + 1.703 * q2);
}

void main() {
  vec2 texel = 1.0 / uSize;
  vec3 photo = texture2D(uPhoto, vUv).rgb;
  float m = texture2D(uMask, vUv).r;
  // Live masks are low-res and bilinearly upsampled; tighten their edge.
  if (uMaskSharpen > 0.5) m = smoothstep(0.25, 0.75, m);

  // Fine luminance (light 5-tap blur suppresses sensor noise).
  float lf = lum(toLinear(photo)) * 0.4;
  lf += 0.15 * lum(toLinear(texture2D(uPhoto, vUv + vec2(texel.x, 0.0)).rgb));
  lf += 0.15 * lum(toLinear(texture2D(uPhoto, vUv - vec2(texel.x, 0.0)).rgb));
  lf += 0.15 * lum(toLinear(texture2D(uPhoto, vUv + vec2(0.0, texel.y)).rgb));
  lf += 0.15 * lum(toLinear(texture2D(uPhoto, vUv - vec2(0.0, texel.y)).rgb));
  float cv = texture2D(uCoarse, vUv).r;
  float lc = cv * cv;

  // Regularised ratio keeps very dark shirts from amplifying noise.
  float k = 0.03;
  float s = mix((lc + k) / (uMeanLum + k), (lf + k) / (uMeanLum + k), uDetail);
  s = clamp(s, 0.1, 2.2);

  // Bend the pattern along large folds using the coarse shading gradient.
  vec2 g = vec2(
    texture2D(uCoarse, vUv + vec2(texel.x * 6.0, 0.0)).r - texture2D(uCoarse, vUv - vec2(texel.x * 6.0, 0.0)).r,
    texture2D(uCoarse, vUv + vec2(0.0, texel.y * 6.0)).r - texture2D(uCoarse, vUv - vec2(0.0, texel.y * 6.0)).r
  );
  vec2 p = vUv * uSize - uCenter + g * uWarp;
  vec2 rp = vec2(uRot.x * p.x + uRot.y * p.y, -uRot.y * p.x + uRot.x * p.y);
  vec3 pattern = texture2D(uPattern, rp / uTile + uOffset).rgb;

  vec3 lin = toLinear(clamp(hueSat(pattern, uHue, uSaturation), 0.0, 1.0)) * uExposure;
  float shade = mix(1.0, s, uShading);
  vec3 lit = lin * shade;
  // Highlights pick up a faint sheen like real cloth.
  lit += max(s - 1.0, 0.0) * uShading * 0.12 * (1.0 - lin);
  vec3 dressed = mix(photo, toSrgb(lit), m * uIntensity);

  bool original = uOriginal > 0.5 || (uSplit >= 0.0 && vUv.x < uSplit) || m <= 0.0;
  gl_FragColor = vec4(original ? photo : dressed, 1.0);
}`;

export interface RenderOptions {
  showOriginal: boolean;
  /** 0..1 compare split (left of it shows the original); null disables. */
  split: number | null;
}

export interface PatternSource {
  key: string;
  canvas: HTMLCanvasElement;
  /** Natural tile size, as a fraction of the shirt's width, at scale 1. */
  tileFraction: number;
  /**
   * Show the image once across the whole shirt, centred (no visible repeat at
   * scale 1), instead of tiling it. Used for fabric photographed with the camera.
   */
  cover?: boolean;
}

const TEXTURE_CACHE_LIMIT = 12;

export class WebGLUnavailableError extends Error {}

export class TryOnRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private program!: WebGLProgram;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private photoTex: WebGLTexture | null = null;
  private maskTex: WebGLTexture | null = null;
  private coarseTex: WebGLTexture | null = null;
  private patternCache = new Map<string, WebGLTexture>();
  private currentPattern: PatternSource | null = null;
  private width = 0;
  private height = 0;
  private meanLum = 0.5;
  private shirtWidth = 1;
  private shirtHeight = 1;
  private shirtCenter: [number, number] = [0, 0];
  private photoData: ImageData | null = null;
  private maskData: Uint8Array | null = null;
  private lost = false;
  /** Live camera mode: video frames + low-res masks, filtered linearly. */
  private live = false;
  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };
  private onRestored = () => {
    this.lost = false;
    this.patternCache.clear();
    // Handles from the lost context are dead; live mode re-creates them on the next frame.
    this.photoTex = this.maskTex = this.coarseTex = null;
    this.init();
    if (this.photoData) this.setPhoto(this.photoData);
    if (this.maskData) this.setMask(this.maskData);
    this.onRestoredCallback?.();
  };
  onRestoredCallback: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new WebGLUnavailableError("WebGL is not available in this browser.");
    this.gl = gl;
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
    this.init();
  }

  get isLost(): boolean {
    return this.lost;
  }

  private init(): void {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) throw new WebGLUnavailableError("Could not create shader");
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "Shader error");
      return sh;
    };
    const program = gl.createProgram();
    if (!program) throw new WebGLUnavailableError("Could not create program");
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "Link error");
    this.program = program;
    gl.useProgram(program);
    this.uniforms.clear();

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.uniform1i(this.u("uPhoto"), 0);
    gl.uniform1i(this.u("uMask"), 1);
    gl.uniform1i(this.u("uCoarse"), 2);
    gl.uniform1i(this.u("uPattern"), 3);
  }

  private u(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name) ?? null;
  }

  private makeTexture(unit: number, filter: number, wrap: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new WebGLUnavailableError("Out of GPU memory");
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.LINEAR_MIPMAP_LINEAR ? gl.LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return tex;
  }

  /** Uploads the reference photo. Raw pixels are uploaded so no colour conversion can alter them. */
  setPhoto(data: ImageData): void {
    const gl = this.gl;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (data.width > max || data.height > max) throw new WebGLUnavailableError("Photo is too large for this device's GPU.");
    this.photoData = data;
    this.width = data.width;
    this.height = data.height;
    this.canvas.width = data.width;
    this.canvas.height = data.height;
    if (this.photoTex) gl.deleteTexture(this.photoTex);
    this.photoTex = this.makeTexture(0, gl.NEAREST, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, data.width, data.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data.data.buffer, data.data.byteOffset, data.data.byteLength));
    gl.viewport(0, 0, data.width, data.height);
  }

  /** Uploads the shirt mask and precomputes the shading reference from the original shirt. */
  setMask(mask: Uint8Array): void {
    const gl = this.gl;
    const photo = this.photoData;
    if (!photo) throw new Error("setPhoto must be called first");
    if (mask.length !== this.width * this.height) throw new Error("Mask size does not match photo");
    this.maskData = mask;
    if (this.maskTex) gl.deleteTexture(this.maskTex);
    this.maskTex = this.makeTexture(1, gl.NEAREST, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, this.width, this.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, mask);

    // Mean luminance of the shirt and a mask-normalised coarse luminance map (large folds only).
    const px = photo.data;
    const step = 4;
    const cw = Math.max(1, Math.ceil(this.width / step));
    const ch = Math.max(1, Math.ceil(this.height / step));
    const lumW = new Float32Array(cw * ch);
    const wts = new Float32Array(cw * ch);
    let sum = 0;
    let wsum = 0;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = y * this.width + x;
        const m = mask[i] / 255;
        if (m <= 0) continue;
        const l = luminance(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
        sum += l * m;
        wsum += m;
        const ci = Math.floor(y / step) * cw + Math.floor(x / step);
        lumW[ci] += l * m;
        wts[ci] += m;
      }
    }
    this.meanLum = wsum > 0 ? sum / wsum : 0.5;
    const r = Math.max(2, Math.round(Math.max(cw, ch) * 0.015));
    const blurL = boxFilter(lumW, cw, ch, r);
    const blurW = boxFilter(wts, cw, ch, r);
    const coarse = new Uint8Array(cw * ch);
    for (let i = 0; i < coarse.length; i++) {
      const l = blurW[i] > 1e-4 ? blurL[i] / blurW[i] : this.meanLum;
      coarse[i] = Math.round(Math.sqrt(Math.min(Math.max(l, 0), 1)) * 255);
    }
    if (this.coarseTex) gl.deleteTexture(this.coarseTex);
    this.coarseTex = this.makeTexture(2, gl.LINEAR, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, cw, ch, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, coarse);

    const b = maskBounds(mask, this.width, this.height);
    this.shirtWidth = b ? Math.max(b.w, this.width * 0.1) : this.width * 0.5;
    this.shirtHeight = b ? Math.max(b.h, this.height * 0.1) : this.height * 0.5;
    this.shirtCenter = b ? [b.x + b.w / 2, b.y + b.h / 2] : [this.width / 2, this.height / 2];
  }

  /**
   * Live mode: uploads the current camera frame. The texture is reused across
   * frames and only reallocated when the frame size changes.
   */
  setVideoFrame(source: TexImageSource, width: number, height: number): void {
    const gl = this.gl;
    this.live = true;
    if (width !== this.width || height !== this.height || !this.photoTex) {
      this.width = width;
      this.height = height;
      this.canvas.width = width;
      this.canvas.height = height;
      gl.viewport(0, 0, width, height);
      if (this.photoTex) gl.deleteTexture(this.photoTex);
      this.photoTex = this.makeTexture(0, gl.LINEAR, gl.CLAMP_TO_EDGE);
    } else {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.photoTex);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  /**
   * Live mode: uploads a low-res shirt mask and shading reference computed on
   * the CPU from a downscaled frame. Geometry is in frame pixels.
   */
  setLiveMask(
    mask: Uint8Array,
    mw: number,
    mh: number,
    coarse: Uint8Array,
    cw: number,
    ch: number,
    meanLum: number,
    shirtCenter: [number, number],
    shirtWidth: number,
    shirtHeight = shirtWidth,
  ): void {
    const gl = this.gl;
    const upload = (tex: WebGLTexture | null, unit: number, data: Uint8Array, w: number, h: number) => {
      const t = tex ?? this.makeTexture(unit, gl.LINEAR, gl.CLAMP_TO_EDGE);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w, h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
      return t;
    };
    this.maskTex = upload(this.maskTex, 1, mask, mw, mh);
    this.coarseTex = upload(this.coarseTex, 2, coarse, cw, ch);
    this.meanLum = meanLum;
    this.shirtCenter = shirtCenter;
    this.shirtWidth = Math.max(shirtWidth, this.width * 0.1);
    this.shirtHeight = Math.max(shirtHeight, this.height * 0.1);
  }

  /** Makes a pattern current, uploading it only the first time (LRU cache). */
  setPattern(source: PatternSource): void {
    const gl = this.gl;
    this.currentPattern = source;
    let tex = this.patternCache.get(source.key);
    if (tex) {
      this.patternCache.delete(source.key);
      this.patternCache.set(source.key, tex);
      return;
    }
    tex = this.makeTexture(3, gl.LINEAR_MIPMAP_LINEAR, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source.canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.patternCache.set(source.key, tex);
    while (this.patternCache.size > TEXTURE_CACHE_LIMIT) {
      const oldest = this.patternCache.keys().next().value as string;
      const old = this.patternCache.get(oldest);
      if (old) gl.deleteTexture(old);
      this.patternCache.delete(oldest);
    }
  }

  /** Makes a pattern current and re-uploads its pixels (for tiles that change every frame, e.g. a camera feed). */
  updatePattern(source: PatternSource): void {
    const gl = this.gl;
    this.currentPattern = source;
    let tex = this.patternCache.get(source.key);
    if (tex) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, tex);
    } else {
      tex = this.makeTexture(3, gl.LINEAR_MIPMAP_LINEAR, gl.REPEAT);
      this.patternCache.set(source.key, tex);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source.canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  forgetPattern(key: string): void {
    const tex = this.patternCache.get(key);
    if (tex) this.gl.deleteTexture(tex);
    this.patternCache.delete(key);
  }

  /** Converts a drag in image pixels to a pattern offset delta (tile units), honouring rotation. */
  /** Pattern tile size in photo pixels. */
  private tileSize(pattern: Pick<PatternSource, "tileFraction" | "cover">, scale: number): number {
    const natural = pattern.cover ? Math.max(this.shirtWidth, this.shirtHeight) : this.shirtWidth * pattern.tileFraction;
    return Math.max(4, natural * scale);
  }

  dragToOffset(dx: number, dy: number, look: LookSettings, pattern: Pick<PatternSource, "tileFraction" | "cover">): { x: number; y: number } {
    const tile = this.tileSize(pattern, look.scale);
    const a = (look.rotation * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { x: -(c * dx + s * dy) / tile, y: -(-s * dx + c * dy) / tile };
  }

  render(look: LookSettings, options: RenderOptions): void {
    const gl = this.gl;
    const pattern = this.currentPattern;
    if (this.lost || !this.photoTex || !this.maskTex || !this.coarseTex || !pattern) return;
    const patternTex = this.patternCache.get(pattern.key);
    if (!patternTex) return;
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.photoTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.coarseTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, patternTex);

    const angle = (look.rotation * Math.PI) / 180;
    gl.uniform2f(this.u("uSize"), this.width, this.height);
    gl.uniform2f(this.u("uCenter"), this.shirtCenter[0], this.shirtCenter[1]);
    gl.uniform1f(this.u("uMeanLum"), this.meanLum);
    gl.uniform1f(this.u("uTile"), this.tileSize(pattern, look.scale));
    gl.uniform2f(this.u("uRot"), Math.cos(angle), Math.sin(angle));
    // Cover patterns put the image's centre (not its corner) on the shirt's centre.
    const centre = pattern.cover ? 0.5 : 0;
    gl.uniform2f(this.u("uOffset"), look.offsetX + centre, look.offsetY + centre);
    gl.uniform1f(this.u("uIntensity"), look.intensity);
    gl.uniform1f(this.u("uShading"), look.shading);
    gl.uniform1f(this.u("uDetail"), look.detail);
    gl.uniform1f(this.u("uWarp"), look.warp * this.shirtWidth * 0.25);
    gl.uniform1f(this.u("uExposure"), Math.pow(2, look.brightness));
    gl.uniform1f(this.u("uSaturation"), look.saturation);
    gl.uniform1f(this.u("uHue"), (look.hue * Math.PI) / 180);
    gl.uniform1f(this.u("uOriginal"), options.showOriginal ? 1 : 0);
    gl.uniform1f(this.u("uSplit"), options.split ?? -1);
    gl.uniform1f(this.u("uMaskSharpen"), this.live ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    const gl = this.gl;
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    for (const t of this.patternCache.values()) gl.deleteTexture(t);
    this.patternCache.clear();
    for (const t of [this.photoTex, this.maskTex, this.coarseTex]) if (t) gl.deleteTexture(t);
    this.photoTex = this.maskTex = this.coarseTex = null;
    if (this.program) gl.deleteProgram(this.program);
    this.photoData = null;
    this.maskData = null;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
