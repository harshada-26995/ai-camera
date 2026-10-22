import { describe, expect, it } from "vitest";
import { boxFilter, guidedCoefficients, applyGuidedUpsample, applyGuidedUpsampleColor, guidedCoefficientsColor, resizeFloat } from "@/lib/guidedFilter";
import { createHistory, historyReducer } from "@/lib/history";
import { closeAndFeather, fillHoles, floodSelect, keepMainComponents, maskBounds, maskCoverage, stampBrush, strokeSegment } from "@/lib/mask";
import { clampPan, coverScale, outputSize, DEFAULT_CROP } from "@/lib/crop";
import { rgbToLab } from "@/lib/color";
import { adjustHex } from "@/lib/fabricCamera";

describe("boxFilter", () => {
  it("matches a naive clamped mean", () => {
    const w = 7;
    const h = 5;
    const src = new Float32Array(w * h).map((_, i) => (i * 37) % 11);
    const r = 2;
    const out = boxFilter(src, w, h, r);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) {
          for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
            sum += src[yy * w + xx];
            n++;
          }
        }
        expect(out[y * w + x]).toBeCloseTo(sum / n, 4);
      }
    }
  });
});

describe("guided filter", () => {
  it("snaps a blurry mask to a sharp edge in the guide", () => {
    const w = 64;
    const h = 8;
    const guide = new Float32Array(w * h);
    const blurry = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        guide[y * w + x] = x < 32 ? 0.1 : 0.9; // hard edge at x = 32
        blurry[y * w + x] = Math.min(1, Math.max(0, (x - 22) / 20)); // soft ramp 22..42
      }
    }
    const coeffs = guidedCoefficients(guide, blurry, w, h, 4, 1e-4);
    const q = applyGuidedUpsample(coeffs, guide, w, h);
    const row = 4 * w;
    // The ramp becomes a step located at the real edge: pixels either side are pulled apart,
    // and the change across the edge dwarfs the change within one side.
    expect(q[row + 30]).toBeLessThan(blurry[row + 30]);
    expect(q[row + 34]).toBeGreaterThan(blurry[row + 34]);
    const acrossEdge = q[row + 32] - q[row + 31];
    const withinSide = q[row + 31] - q[row + 30];
    expect(acrossEdge).toBeGreaterThan(0.2);
    expect(acrossEdge).toBeGreaterThan(5 * Math.abs(withinSide));
  });

  it("resizes identically when size is unchanged", () => {
    const src = new Float32Array([1, 2, 3, 4]);
    expect(Array.from(resizeFloat(src, 2, 2, 2, 2))).toEqual([1, 2, 3, 4]);
  });
});

describe("history", () => {
  it("only creates undo steps on commit", () => {
    let h = createHistory(0);
    h = historyReducer(h, { type: "set", value: 1, commit: false });
    h = historyReducer(h, { type: "set", value: 2, commit: false });
    expect(h.past).toEqual([]);
    h = historyReducer(h, { type: "commit" });
    expect(h.past).toEqual([0]);
    h = historyReducer(h, { type: "set", value: 5, commit: true });
    expect(h.past).toEqual([0, 2]);
    h = historyReducer(h, { type: "undo" });
    expect(h.present).toBe(2);
    h = historyReducer(h, { type: "undo" });
    expect(h.present).toBe(0);
    h = historyReducer(h, { type: "redo" });
    h = historyReducer(h, { type: "redo" });
    expect(h.present).toBe(5);
    expect(h.future).toEqual([]);
  });

  it("undo during a live edit reverts that edit first", () => {
    let h = createHistory("a");
    h = historyReducer(h, { type: "set", value: "b", commit: true });
    h = historyReducer(h, { type: "set", value: "c", commit: false });
    h = historyReducer(h, { type: "undo" });
    expect(h.present).toBe("b");
    expect(h.future).toEqual(["c"]);
  });

  it("a new edit clears the redo branch and the limit caps memory", () => {
    let h = createHistory(0);
    for (let i = 1; i <= 10; i++) h = historyReducer(h, { type: "set", value: i, commit: true }, 3);
    expect(h.past).toEqual([7, 8, 9]);
    h = historyReducer(h, { type: "undo" }, 3);
    h = historyReducer(h, { type: "set", value: 99, commit: true }, 3);
    expect(h.future).toEqual([]);
  });
});

describe("mask brushes", () => {
  const w = 40;
  const h = 40;

  it("add, erase and restore behave as expected", () => {
    const mask = new Uint8Array(w * h);
    const auto = new Uint8Array(w * h).fill(200);
    stampBrush(mask, auto, w, h, 20, 20, 6, 0.5, "add");
    expect(mask[20 * w + 20]).toBe(255);
    expect(mask[0]).toBe(0);
    stampBrush(mask, auto, w, h, 20, 20, 3, 1, "erase");
    expect(mask[20 * w + 20]).toBe(0);
    stampBrush(mask, auto, w, h, 20, 20, 3, 1, "restore");
    expect(mask[20 * w + 20]).toBe(200);
  });

  it("strokes are continuous and report a dirty rect", () => {
    const mask = new Uint8Array(w * h);
    const dirty = strokeSegment(mask, null, w, h, { x: 5, y: 5 }, { x: 35, y: 5 }, 2, 1, "add");
    for (let x = 6; x < 35; x++) expect(mask[5 * w + x]).toBe(255);
    expect(dirty).not.toBeNull();
    // The start dab is stamped by the caller on pointer-down, so the segment begins just after it.
    expect(dirty!.x).toBeLessThanOrEqual(5);
    expect(dirty!.x + dirty!.w).toBeGreaterThanOrEqual(36);
  });

  it("stamping outside the image is a no-op", () => {
    const mask = new Uint8Array(w * h);
    expect(stampBrush(mask, null, w, h, -50, -50, 5, 1, "add")).toBeNull();
    expect(maskCoverage(mask)).toBe(0);
  });
});

describe("magic select", () => {
  it("selects the connected region of similar colour only", () => {
    const w = 30;
    const h = 20;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const shirt = x >= 5 && x < 15;
        const sameColourButDisconnected = x >= 25;
        const [r, g, b] = shirt || sameColourButDisconnected ? [30, 50, 120 + (y % 3)] : [230, 220, 200];
        rgba.set([r, g, b, 255], o);
      }
    }
    const region = floodSelect(rgba, w, h, 10, 10, 12);
    expect(region[10 * w + 10]).toBe(255);
    expect(region[10 * w + 2]).toBe(0);
    expect(region[10 * w + 27]).toBe(0);
    const bounds = maskBounds(region, w, h)!;
    expect(bounds).toEqual({ x: 5, y: 0, w: 10, h: 20 });
  });

  it("closeAndFeather fills a single-pixel hole (e.g. a button)", () => {
    const w = 9;
    const h = 9;
    const region = new Uint8Array(w * h).fill(255);
    region[4 * w + 4] = 0;
    const out = closeAndFeather(region, w, h, 1);
    expect(out[4 * w + 4]).toBe(255);
  });
});

describe("keepMainComponents", () => {
  it("drops small blobs but keeps comparable ones", () => {
    const w = 20;
    const h = 10;
    const bin = new Uint8Array(w * h);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bin[y * w + x] = 1; // 64 px
    for (let y = 0; y < 7; y++) for (let x = 10; x < 17; x++) bin[y * w + x] = 1; // 49 px
    bin[9 * w + 19] = 1; // 1 px speck
    const out = keepMainComponents(bin, w, h, 0.12);
    expect(out[0]).toBe(1);
    expect(out[10]).toBe(1);
    expect(out[9 * w + 19]).toBe(0);
  });
});

describe("crop geometry", () => {
  it("cover scale fills the frame at any angle", () => {
    const s = coverScale(400, 300, 200, 200, Math.PI / 8);
    // All frame corners must map inside the image.
    const c = Math.cos(Math.PI / 8);
    const sn = Math.sin(Math.PI / 8);
    for (const [fx, fy] of [
      [-100, -100],
      [100, -100],
      [100, 100],
      [-100, 100],
    ]) {
      const ux = (c * fx + sn * fy) / s;
      const uy = (-sn * fx + c * fy) / s;
      expect(Math.abs(ux)).toBeLessThanOrEqual(200 + 1e-6);
      expect(Math.abs(uy)).toBeLessThanOrEqual(150 + 1e-6);
    }
  });

  it("clamps pan so the frame stays covered", () => {
    const s = coverScale(400, 300, 200, 150, 0) * 2;
    const p = clampPan(1000, -1000, 400, 300, 200, 150, 0, s);
    expect(p.x).toBeCloseTo((400 * s) / 2 - 100);
    expect(p.y).toBeCloseTo(-((300 * s) / 2 - 75));
  });

  it("keeps native resolution for an identity crop and caps the long edge", () => {
    expect(outputSize(1200, 900, DEFAULT_CROP)).toEqual({ width: 1200, height: 900 });
    expect(outputSize(4032, 3024, DEFAULT_CROP)).toEqual({ width: 1600, height: 1200 });
    expect(outputSize(3024, 4032, { ...DEFAULT_CROP, quarter: 1 })).toEqual({ width: 1600, height: 1200 });
  });
});

describe("colour", () => {
  it("converts reference colours to Lab", () => {
    const out = new Float32Array(3);
    rgbToLab(255, 255, 255, out, 0);
    expect(out[0]).toBeCloseTo(100, 0);
    expect(Math.abs(out[1])).toBeLessThan(0.5);
    rgbToLab(0, 0, 0, out, 0);
    expect(out[0]).toBeCloseTo(0, 1);
  });
});

describe("fillHoles", () => {
  it("fills enclosed gaps but not regions open to the border or large holes", () => {
    const w = 12;
    const h = 12;
    const bin = new Uint8Array(w * h);
    for (let y = 1; y < 11; y++) for (let x = 1; x < 11; x++) bin[y * w + x] = 1;
    bin[3 * w + 3] = 0; // small enclosed hole
    for (let y = 6; y < 10; y++) for (let x = 5; x < 10; x++) bin[y * w + x] = 0; // 20 px enclosed hole
    const out = fillHoles(bin, w, h, 5);
    expect(out[3 * w + 3]).toBe(1);
    expect(out[7 * w + 7]).toBe(0);
    expect(out[0]).toBe(0);
  });
});

describe("colour guided filter", () => {
  it("separates regions of equal luminance but different colour", () => {
    const w = 48;
    const h = 6;
    const n = w * h;
    // Left: blue-ish, right: green-ish with matched luminance; mask is a soft ramp.
    const r = new Float32Array(n);
    const g = new Float32Array(n);
    const b = new Float32Array(n);
    const p = new Float32Array(n);
    const rgba = new Uint8ClampedArray(n * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const left = x < 24;
        r[i] = left ? 0.2 : 0.35;
        g[i] = left ? 0.35 : 0.45;
        b[i] = left ? 0.8 : 0.2;
        p[i] = Math.min(1, Math.max(0, (32 - x) / 16));
        rgba.set([r[i] * 255, g[i] * 255, b[i] * 255, 255], i * 4);
      }
    }
    const coeffs = guidedCoefficientsColor(r, g, b, p, w, h, 3, 1e-4);
    const q = applyGuidedUpsampleColor(coeffs, rgba, w, h);
    const row = 3 * w;
    // Input changes 1/16 per pixel; across the colour edge the output jumps several times that.
    expect(q[row + 23] - q[row + 24]).toBeGreaterThan(3 / 16);
    expect(Math.abs(q[row + 21] - q[row + 22])).toBeLessThan(0.05);
  });
});

describe("camera colour correction", () => {
  it("is the identity at neutral settings", () => {
    for (const hex of ["#1f2a44", "#6a1b2a", "#d6c4a3", "#ffffff", "#000000"]) {
      const out = adjustHex(hex, 0, 1);
      const diff = [1, 3, 5].map((i) => Math.abs(parseInt(out.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16)));
      expect(Math.max(...diff)).toBeLessThanOrEqual(1);
    }
  });

  it("darkens with negative brightness and enriches with more colour", () => {
    const lum = (h: string) => [1, 3, 5].reduce((a, i) => a + parseInt(h.slice(i, i + 2), 16), 0);
    expect(lum(adjustHex("#8a6a9a", -0.5, 1))).toBeLessThan(lum("#8a6a9a"));
    const spread = (h: string) => {
      const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      return Math.max(...c) - Math.min(...c);
    };
    expect(spread(adjustHex("#8a6a9a", 0, 1.5))).toBeGreaterThan(spread("#8a6a9a"));
  });
});
