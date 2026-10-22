/**
 * Built-in shirt patterns, drawn procedurally into seamless 512² tiles.
 * Tiles are power-of-two so WebGL can repeat and mipmap them.
 */
import { rgbToLab } from "./color";

export type PatternCategory = "solids" | "stripes" | "checks" | "geometric" | "floral" | "festive" | "motifs" | "custom";

export const CATEGORIES: { id: PatternCategory; label: string }[] = [
  { id: "solids", label: "Solids" },
  { id: "stripes", label: "Stripes" },
  { id: "checks", label: "Checks & Plaid" },
  { id: "geometric", label: "Geometric" },
  { id: "floral", label: "Floral" },
  { id: "festive", label: "Festive" },
  { id: "motifs", label: "Motifs" },
  { id: "custom", label: "Your prints" },
];

export interface PatternDef {
  id: string;
  name: string;
  category: PatternCategory;
  /** Tile width as a fraction of the shirt's width at scale 1 (≈ tile cm / 55 cm). */
  tileFraction: number;
  /** Representative colour, used as a placeholder and for solids. */
  base: string;
  draw?: (ctx: CanvasRenderingContext2D, S: number) => void;
  /** Pre-rendered tile (custom uploads). */
  canvas?: HTMLCanvasElement;
  /** Shown once across the whole shirt rather than tiled (fabric captured with the camera). */
  cover?: boolean;
  /** Colour correction chosen when the fabric was captured. */
  adjust?: { brightness: number; saturation: number };
}

export const TILE = 512;
const TAU = Math.PI * 2;

type Ctx = CanvasRenderingContext2D;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draws `fn` at (x, y) plus any wrapped copies needed for a seamless tile. */
function tiled(ctx: Ctx, S: number, x: number, y: number, reach: number, fn: (c: Ctx) => void): void {
  for (const dx of [-S, 0, S]) {
    for (const dy of [-S, 0, S]) {
      const px = x + dx;
      const py = y + dy;
      if (px + reach < 0 || px - reach > S || py + reach < 0 || py - reach > S) continue;
      ctx.save();
      ctx.translate(px, py);
      fn(ctx);
      ctx.restore();
    }
  }
}

function fill(ctx: Ctx, S: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, S, S);
}

/** Faint twill so woven patterns read as cloth in swatches. */
function twill(ctx: Ctx, S: number, alpha: number): void {
  ctx.save();
  ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = -S; i < S; i += 4) {
    ctx.moveTo(i, 0);
    ctx.lineTo(i + S, S);
  }
  ctx.stroke();
  ctx.restore();
}

// ---------- woven patterns ----------

function stripes(bg: string, period: number, bands: [number, number, string][]) {
  return (ctx: Ctx, S: number) => {
    fill(ctx, S, bg);
    for (let x0 = 0; x0 < S; x0 += period) {
      for (const [o, w, c] of bands) {
        ctx.fillStyle = c;
        ctx.fillRect(x0 + o, 0, w, S);
      }
    }
    twill(ctx, S, 0.03);
  };
}

function gingham(bg: string, color: string, n: number, alpha: number) {
  return (ctx: Ctx, S: number) => {
    fill(ctx, S, bg);
    const b = S / n;
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    for (let i = 0; i < n; i += 2) ctx.fillRect(i * b, 0, b, S);
    for (let i = 0; i < n; i += 2) ctx.fillRect(0, i * b, S, b);
    ctx.globalAlpha = 1;
    twill(ctx, S, 0.035);
  };
}

/** Tartan from a half-sett (widths sum to S/2), mirrored to make the repeat. */
function tartan(halfSett: [string, number][], weftAlpha = 0.5) {
  return (ctx: Ctx, S: number) => {
    const scale = S / 2 / halfSett.reduce((a, [, w]) => a + w, 0);
    const sett = [...halfSett, ...[...halfSett].reverse()];
    let x = 0;
    for (const [c, w] of sett) {
      ctx.fillStyle = c;
      ctx.fillRect(x, 0, w * scale + 0.5, S);
      x += w * scale;
    }
    ctx.globalAlpha = weftAlpha;
    let y = 0;
    for (const [c, w] of sett) {
      ctx.fillStyle = c;
      ctx.fillRect(0, y, S, w * scale + 0.5);
      y += w * scale;
    }
    ctx.globalAlpha = 1;
    twill(ctx, S, 0.08);
  };
}

function gridLines(bg: string, period: number, lines: [number, number, string][]) {
  return (ctx: Ctx, S: number) => {
    fill(ctx, S, bg);
    for (let p = 0; p < S; p += period) {
      for (const [o, w, c] of lines) {
        ctx.fillStyle = c;
        ctx.fillRect(p + o, 0, w, S);
        ctx.fillRect(0, p + o, S, w);
      }
    }
    twill(ctx, S, 0.03);
  };
}

// ---------- shapes ----------

function petalFlower(ctx: Ctx, r: number, petals: number, petal: string, center: string, width = 0.55): void {
  ctx.fillStyle = petal;
  for (let i = 0; i < petals; i++) {
    ctx.save();
    ctx.rotate((i * TAU) / petals);
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.55, r * width * 0.5, r * 0.5, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = center;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.22, 0, TAU);
  ctx.fill();
}

function leaf(ctx: Ctx, len: number, width: number, color: string, vein?: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(width, -len * 0.5, 0, -len);
  ctx.quadraticCurveTo(-width, -len * 0.5, 0, 0);
  ctx.fill();
  if (vein) {
    ctx.strokeStyle = vein;
    ctx.lineWidth = Math.max(1, len * 0.03);
    ctx.beginPath();
    ctx.moveTo(0, -len * 0.05);
    ctx.lineTo(0, -len * 0.88);
    ctx.stroke();
  }
}

function hibiscus(ctx: Ctx, r: number, petal: string, throat: string, stamen: string): void {
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.rotate((i * TAU) / 5);
    ctx.fillStyle = petal;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-r * 0.75, -r * 0.3, -r * 0.7, -r * 1.08, 0, -r);
    ctx.bezierCurveTo(r * 0.7, -r * 1.08, r * 0.75, -r * 0.3, 0, 0);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.lineWidth = r * 0.03;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.15);
    ctx.lineTo(0, -r * 0.8);
    ctx.stroke();
    ctx.restore();
  }
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.45);
  g.addColorStop(0, throat);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.45, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = stamen;
  ctx.lineWidth = r * 0.05;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(r * 0.45, -r * 0.45);
  ctx.stroke();
  ctx.fillStyle = stamen;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(r * 0.45 + Math.cos(i) * r * 0.07, -r * 0.45 + Math.sin(i * 2) * r * 0.07, r * 0.04, 0, TAU);
    ctx.fill();
  }
}

function rose(ctx: Ctx, r: number, base: string, line: string): void {
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = line;
  ctx.lineCap = "round";
  for (let k = 0; k < 5; k++) {
    ctx.lineWidth = r * 0.09;
    ctx.beginPath();
    ctx.arc(0, 0, r * (0.88 - k * 0.17), k * 1.3, k * 1.3 + 3.6);
    ctx.stroke();
  }
}

function paisley(ctx: Ctx, size: number, outer: string, inner: string, accent: string): void {
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(0, 1);
    ctx.bezierCurveTo(-0.78, 0.95, -0.88, 0.05, -0.36, -0.45);
    ctx.bezierCurveTo(-0.06, -0.75, 0.26, -0.95, 0.16, -1.28);
    ctx.bezierCurveTo(0.68, -0.95, 0.88, -0.2, 0.72, 0.3);
    ctx.bezierCurveTo(0.62, 0.76, 0.36, 1.0, 0, 1);
    ctx.closePath();
  };
  ctx.save();
  ctx.scale(size, size);
  ctx.fillStyle = outer;
  path();
  ctx.fill();
  ctx.save();
  ctx.translate(0.02, 0.2);
  ctx.scale(0.66, 0.66);
  ctx.fillStyle = inner;
  path();
  ctx.fill();
  ctx.translate(0.02, 0.22);
  ctx.scale(0.55, 0.55);
  ctx.fillStyle = accent;
  path();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.arc(0.02, 0.45, 0.09, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function star(ctx: Ctx, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function mandala(ctx: Ctx, r: number, gold: string, ground: string): void {
  ctx.strokeStyle = gold;
  ctx.fillStyle = gold;
  ctx.lineWidth = r * 0.03;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.stroke();
  for (let i = 0; i < 16; i++) {
    ctx.save();
    ctx.rotate((i * TAU) / 16);
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.78, r * 0.09, r * 0.2, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  for (let i = 0; i < 32; i++) {
    const a = (i * TAU) / 32;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1, r * 0.035, 0, TAU);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.52, 0, TAU);
  ctx.stroke();
  petalFlower(ctx, r * 0.48, 8, gold, ground, 0.5);
  ctx.fillStyle = gold;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.07, 0, TAU);
  ctx.fill();
}

/** Jittered grid placement; `n` cells per side, deterministic per seed. */
function scatter(S: number, n: number, seed: number, jitter: number, halfDrop = false) {
  const rand = rng(seed);
  const cell = S / n;
  const pts: { x: number; y: number; r: number; k: number }[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const drop = halfDrop && i % 2 === 1 ? cell / 2 : 0;
      pts.push({
        x: (i + 0.5) * cell + (rand() - 0.5) * cell * jitter,
        y: (j + 0.5) * cell + drop + (rand() - 0.5) * cell * jitter,
        r: rand(),
        k: rand(),
      });
    }
  }
  return pts;
}

// ---------- catalogue ----------

const solid = (id: string, name: string, color: string): PatternDef => ({
  id,
  name,
  category: "solids",
  tileFraction: 0.5,
  base: color,
  draw: (ctx, S) => fill(ctx, S, color),
});

export const PATTERNS: PatternDef[] = [
  solid("solid-navy", "Navy Blue", "#1f2a44"),
  solid("solid-white", "White", "#f4f3ee"),
  solid("solid-black", "Black", "#171717"),
  solid("solid-maroon", "Maroon", "#6a1b2a"),
  solid("solid-olive", "Olive Green", "#5a6236"),
  solid("solid-beige", "Beige", "#d6c4a3"),
  solid("solid-sky", "Sky Blue", "#9ec5e6"),
  solid("solid-teal", "Teal", "#1e6b6b"),

  {
    id: "stripe-pin",
    name: "Navy Pinstripe",
    category: "stripes",
    tileFraction: 0.2,
    base: "#f3f1eb",
    draw: stripes("#f3f1eb", 64, [[0, 3, "#24345a"]]),
  },
  {
    id: "stripe-bengal",
    name: "Bengal Blue",
    category: "stripes",
    tileFraction: 0.22,
    base: "#7d9cc8",
    draw: stripes("#f7f7f4", 64, [[0, 32, "#6f8fc0"]]),
  },
  {
    id: "stripe-candy",
    name: "Candy Pink",
    category: "stripes",
    tileFraction: 0.18,
    base: "#e1a3b3",
    draw: stripes("#fbf8f6", 64, [[0, 22, "#d98ca0"]]),
  },
  {
    id: "stripe-pencil",
    name: "Charcoal Pencil",
    category: "stripes",
    tileFraction: 0.2,
    base: "#3a3b3e",
    draw: stripes("#36383c", 64, [[0, 2, "#a9abb0"]]),
  },
  {
    id: "stripe-regatta",
    name: "Regatta",
    category: "stripes",
    tileFraction: 0.4,
    base: "#efe8da",
    draw: stripes("#efe8da", 128, [
      [0, 30, "#1f2f52"],
      [42, 6, "#8c2b33"],
      [56, 6, "#c79a3b"],
    ]),
  },

  {
    id: "check-maroon",
    name: "Maroon Checks",
    category: "checks",
    tileFraction: 0.22,
    base: "#8f4a52",
    draw: gingham("#f6f1ea", "#6b1f2a", 8, 0.55),
  },
  {
    id: "check-navy-gingham",
    name: "Navy Gingham",
    category: "checks",
    tileFraction: 0.18,
    base: "#5d6f93",
    draw: gingham("#f7f7f4", "#1f3560", 16, 0.5),
  },
  {
    id: "check-buffalo",
    name: "Buffalo Check",
    category: "checks",
    tileFraction: 0.45,
    base: "#a8262b",
    draw: gingham("#a8262b", "#121212", 4, 0.62),
  },
  {
    id: "check-tattersall",
    name: "Tattersall",
    category: "checks",
    tileFraction: 0.25,
    base: "#f2ecdf",
    draw: gridLines("#f4efe4", 64, [
      [0, 3, "#a23b3b"],
      [32, 3, "#24385b"],
    ]),
  },
  {
    id: "check-windowpane",
    name: "Windowpane",
    category: "checks",
    tileFraction: 0.45,
    base: "#dfe3e7",
    draw: gridLines("#e3e6e9", 128, [
      [0, 4, "#3d4f6b"],
      [8, 1.5, "#3d4f6b"],
    ]),
  },
  {
    id: "plaid-madras",
    name: "Madras Plaid",
    category: "checks",
    tileFraction: 0.5,
    base: "#c8473a",
    draw: tartan([
      ["#c8473a", 40],
      ["#f2c14e", 12],
      ["#2e5e8c", 30],
      ["#f7f3e8", 6],
      ["#3e8e7e", 36],
      ["#c8473a", 10],
      ["#1f3555", 24],
      ["#f2c14e", 6],
      ["#e07a5f", 40],
      ["#2e5e8c", 52],
    ]),
  },
  {
    id: "plaid-highland",
    name: "Highland Tartan",
    category: "checks",
    tileFraction: 0.55,
    base: "#1c3b2a",
    draw: tartan([
      ["#1c3b2a", 60],
      ["#0f1a2e", 40],
      ["#1c3b2a", 8],
      ["#0b0b0b", 50],
      ["#1c3b2a", 8],
      ["#0f1a2e", 40],
      ["#d9b44a", 4],
      ["#1c3b2a", 46],
    ]),
  },

  {
    id: "geo-polka",
    name: "Polka Dot",
    category: "geometric",
    tileFraction: 0.3,
    base: "#1e2b45",
    draw: (ctx, S) => {
      fill(ctx, S, "#1e2b45");
      for (let j = 0; j < 8; j++) {
        for (let i = 0; i < 8; i++) {
          tiled(ctx, S, 32 + i * 64 + (j % 2) * 32, 32 + j * 64, 10, (c) => {
            c.fillStyle = "#f3efe6";
            c.beginPath();
            c.arc(0, 0, 7, 0, TAU);
            c.fill();
          });
        }
      }
    },
  },
  {
    id: "geo-argyle",
    name: "Argyle",
    category: "geometric",
    tileFraction: 0.35,
    base: "#3b4c63",
    draw: (ctx, S) => {
      const d = S / 4;
      const diamond = (cx: number, cy: number, color: string) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(cx, cy - d / 2);
        ctx.lineTo(cx + d / 2, cy);
        ctx.lineTo(cx, cy + d / 2);
        ctx.lineTo(cx - d / 2, cy);
        ctx.closePath();
        ctx.fill();
      };
      for (let j = -1; j <= 4; j++) {
        for (let i = -1; i <= 4; i++) {
          diamond(i * d, j * d, "#3b4c63");
          diamond(i * d + d / 2, j * d + d / 2, (i + j) % 2 === 0 ? "#7a2e3a" : "#58687e");
        }
      }
      ctx.strokeStyle = "#e9dcc0";
      ctx.lineWidth = 2;
      // Dash period divides the diagonal so dashes continue across tile edges.
      const dash = (S * Math.SQRT2) / 120;
      ctx.setLineDash([dash, dash]);
      ctx.beginPath();
      for (let k = -S; k <= 2 * S; k += d) {
        ctx.moveTo(k, 0);
        ctx.lineTo(k + S, S);
        ctx.moveTo(k, 0);
        ctx.lineTo(k - S, S);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    },
  },
  {
    id: "geo-chevron",
    name: "Chevron",
    category: "geometric",
    tileFraction: 0.3,
    base: "#d9cdb8",
    draw: (ctx, S) => {
      fill(ctx, S, "#e8decb");
      ctx.lineJoin = "miter";
      ctx.lineWidth = 20;
      for (let b = -1; b <= 8; b++) {
        ctx.strokeStyle = b % 2 === 0 ? "#2c3e5c" : "#b5835a";
        ctx.beginPath();
        for (let i = -2; i <= 18; i++) ctx.lineTo(i * 32, b * 64 + (i % 2 === 0 ? 0 : 28));
        ctx.stroke();
      }
    },
  },
  {
    id: "geo-herringbone",
    name: "Herringbone",
    category: "geometric",
    tileFraction: 0.18,
    base: "#5a5d63",
    draw: (ctx, S) => {
      fill(ctx, S, "#55585e");
      ctx.strokeStyle = "#8e9197";
      ctx.lineWidth = 5;
      for (let c = 0; c < 16; c++) {
        const dir = c % 2 === 0 ? 1 : -1;
        ctx.beginPath();
        for (let y = -32; y < S + 32; y += 16) {
          ctx.moveTo(c * 32 + 2, y);
          ctx.lineTo(c * 32 + 30, y + dir * 14);
        }
        ctx.stroke();
      }
    },
  },
  {
    id: "geo-squares",
    name: "Mod Squares",
    category: "geometric",
    tileFraction: 0.3,
    base: "#efe9dd",
    draw: (ctx, S) => {
      fill(ctx, S, "#efe9dd");
      for (let j = 0; j < 8; j++) {
        for (let i = 0; i < 8; i++) {
          const x = i * 64;
          const y = j * 64;
          ctx.strokeStyle = (i + j) % 2 ? "#2b3d5b" : "#b4693e";
          ctx.lineWidth = 4;
          ctx.strokeRect(x + 12, y + 12, 40, 40);
          ctx.fillStyle = (i + j) % 2 ? "#b4693e" : "#2b3d5b";
          ctx.fillRect(x + 26, y + 26, 12, 12);
        }
      }
    },
  },

  {
    id: "floral-ditsy",
    name: "Ditsy Floral",
    category: "floral",
    tileFraction: 0.3,
    base: "#1f2b44",
    draw: (ctx, S) => {
      fill(ctx, S, "#1f2b44");
      const colors = ["#f3ece0", "#e8a3b0", "#f0c96a"];
      for (const p of scatter(S, 6, 11, 0.6)) {
        tiled(ctx, S, p.x, p.y, 40, (c) => {
          c.rotate(p.r * TAU);
          c.save();
          c.translate(14, 6);
          c.rotate(1.9);
          leaf(c, 22, 9, "#7f9b78");
          c.restore();
          c.save();
          c.translate(-12, 10);
          c.rotate(-2.2);
          leaf(c, 18, 8, "#6c8a66");
          c.restore();
          petalFlower(c, 16, 5, colors[Math.floor(p.k * colors.length)] ?? "#f3ece0", "#e2b54b", 0.8);
        });
        tiled(ctx, S, p.x + 40, p.y - 34, 6, (c) => {
          c.fillStyle = "#f3ece0";
          c.beginPath();
          c.arc(0, 0, 2.5, 0, TAU);
          c.fill();
        });
      }
    },
  },
  {
    id: "floral-tropical",
    name: "Tropical Hibiscus",
    category: "floral",
    tileFraction: 0.65,
    base: "#0f4c4a",
    draw: (ctx, S) => {
      fill(ctx, S, "#0f4c4a");
      const pts = scatter(S, 3, 7, 0.45);
      for (const p of pts) {
        tiled(ctx, S, p.x, p.y, 150, (c) => {
          c.rotate(p.r * TAU);
          for (let i = 0; i < 3; i++) {
            c.save();
            c.rotate(-0.9 + i * 0.9);
            c.translate(0, -10);
            leaf(c, 120, 38, i === 1 ? "#3e9461" : "#2f7d4f", "#1f5e3a");
            c.restore();
          }
        });
      }
      for (const p of pts) {
        tiled(ctx, S, p.x + 20, p.y + 20, 80, (c) => {
          c.rotate(p.k * TAU);
          hibiscus(c, 58, p.k > 0.5 ? "#e2574c" : "#ef8a5b", "#8e1f2f", "#f6d36b");
        });
        tiled(ctx, S, p.x - 70, p.y + 75, 30, (c) => {
          c.rotate(p.r * 4);
          petalFlower(c, 18, 5, "#f4e6c8", "#e2574c", 0.9);
        });
      }
    },
  },
  {
    id: "floral-rose",
    name: "Rose Garden",
    category: "floral",
    tileFraction: 0.4,
    base: "#f5efe6",
    draw: (ctx, S) => {
      fill(ctx, S, "#f5efe6");
      for (const p of scatter(S, 4, 23, 0.5)) {
        tiled(ctx, S, p.x, p.y, 70, (c) => {
          c.rotate(p.r * TAU);
          c.save();
          c.translate(26, 10);
          c.rotate(2);
          leaf(c, 40, 14, "#8da58a", "#6e8a6b");
          c.restore();
          c.save();
          c.translate(-24, 14);
          c.rotate(-2.1);
          leaf(c, 36, 13, "#9cb398", "#6e8a6b");
          c.restore();
          rose(c, 30, p.k > 0.5 ? "#d9899b" : "#e7b3bc", p.k > 0.5 ? "#b05a70" : "#c98592");
        });
      }
    },
  },
  {
    id: "floral-meadow",
    name: "Liberty Meadow",
    category: "floral",
    tileFraction: 0.25,
    base: "#f3ede0",
    draw: (ctx, S) => {
      fill(ctx, S, "#f3ede0");
      const colors = ["#c8553d", "#f2a541", "#5b7db1", "#8e5572", "#2e7d6b"];
      for (const p of scatter(S, 10, 5, 0.8)) {
        tiled(ctx, S, p.x, p.y, 20, (c) => {
          c.rotate(p.r * TAU);
          c.save();
          c.translate(8, 6);
          c.rotate(2.3);
          leaf(c, 11, 4.5, "#6f8f5e");
          c.restore();
          petalFlower(c, 10, 5 + Math.floor(p.k * 2), colors[Math.floor(p.k * colors.length)] ?? "#c8553d", "#f3ede0", 0.85);
        });
      }
    },
  },

  {
    id: "festive-paisley",
    name: "Royal Paisley",
    category: "festive",
    tileFraction: 0.38,
    base: "#5e1622",
    draw: (ctx, S) => {
      fill(ctx, S, "#5e1622");
      const n = 4;
      const cell = S / n;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const x = (i + 0.5) * cell + (j % 2) * (cell / 2);
          const y = (j + 0.5) * cell;
          tiled(ctx, S, x, y, 70, (c) => {
            c.rotate((j % 2 ? -1 : 1) * 0.5);
            paisley(c, 34, "#d4a84b", "#5e1622", "#e7c77a");
          });
          tiled(ctx, S, x + cell / 2, y + cell / 2, 6, (c) => {
            c.fillStyle = "#d4a84b";
            c.beginPath();
            c.arc(0, 0, 3, 0, TAU);
            c.fill();
          });
        }
      }
    },
  },
  {
    id: "festive-bandhani",
    name: "Bandhani",
    category: "festive",
    tileFraction: 0.3,
    base: "#b3202a",
    draw: (ctx, S) => {
      fill(ctx, S, "#b3202a");
      for (let j = 0; j < 8; j++) {
        for (let i = 0; i < 8; i++) {
          const big = (i + j) % 2 === 0;
          tiled(ctx, S, 32 + i * 64, 32 + j * 64 + (i % 2) * 32, 24, (c) => {
            const ring = big ? 12 : 8;
            const count = big ? 10 : 7;
            c.fillStyle = "#f6efe2";
            for (let k = 0; k < count; k++) {
              const a = (k * TAU) / count;
              c.beginPath();
              c.arc(Math.cos(a) * ring, Math.sin(a) * ring, big ? 2.6 : 2.2, 0, TAU);
              c.fill();
            }
            c.fillStyle = "#f2c14e";
            c.beginPath();
            c.arc(0, 0, big ? 3.5 : 2.5, 0, TAU);
            c.fill();
          });
        }
      }
    },
  },
  {
    id: "festive-buti",
    name: "Indigo Block Print",
    category: "festive",
    tileFraction: 0.3,
    base: "#22335c",
    draw: (ctx, S) => {
      fill(ctx, S, "#22335c");
      const n = 6;
      const cell = S / n;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          tiled(ctx, S, (i + 0.5) * cell, (j + 0.5) * cell + (i % 2) * (cell / 2), 40, (c) => {
            petalFlower(c, 22, 4, "#ede7da", "#22335c", 0.75);
            c.fillStyle = "#ede7da";
            for (let k = 0; k < 4; k++) {
              const a = (k * TAU) / 4 + Math.PI / 4;
              c.beginPath();
              c.arc(Math.cos(a) * 18, Math.sin(a) * 18, 3, 0, TAU);
              c.fill();
            }
            c.fillStyle = "#c9a35a";
            c.beginPath();
            c.arc(0, 0, 3.5, 0, TAU);
            c.fill();
          });
        }
      }
    },
  },
  {
    id: "festive-mandala",
    name: "Gold Mandala",
    category: "festive",
    tileFraction: 0.5,
    base: "#17402f",
    draw: (ctx, S) => {
      fill(ctx, S, "#17402f");
      for (const [x, y, r] of [
        [128, 128, 92],
        [384, 384, 92],
        [384, 128, 40],
        [128, 384, 40],
      ] as const) {
        tiled(ctx, S, x, y, r * 1.2, (c) => mandala(c, r, "#cfa44a", "#17402f"));
      }
    },
  },
  {
    id: "festive-ikat",
    name: "Ikat",
    category: "festive",
    tileFraction: 0.45,
    base: "#efe6d4",
    draw: (ctx, S) => {
      fill(ctx, S, "#efe6d4");
      const rand = rng(41);
      const diamond = (cx: number, cy: number, hw: number, hh: number, color: string) => {
        ctx.fillStyle = color;
        for (let dy = -hh; dy <= hh; dy += 3) {
          const half = hw * (1 - Math.abs(dy) / hh);
          const jl = (rand() - 0.5) * 12;
          const jr = (rand() - 0.5) * 12;
          tiled(ctx, S, cx, cy + dy, hw + 12, (c) => c.fillRect(-half + jl, 0, 2 * half - jl + jr, 2.4));
        }
      };
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 2; i++) {
          const cx = 128 + i * 256 + (j % 2) * 128;
          const cy = 64 + j * 128;
          diamond(cx, cy, 70, 60, "#2b3f6b");
          diamond(cx, cy, 34, 30, "#b5543c");
          diamond(cx, cy, 10, 10, "#efe6d4");
        }
      }
    },
  },
  {
    id: "festive-zari",
    name: "Zari Brocade",
    category: "festive",
    tileFraction: 0.32,
    base: "#3b1e4a",
    draw: (ctx, S) => {
      fill(ctx, S, "#3b1e4a");
      ctx.strokeStyle = "#cfa95a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = -S; k <= 2 * S; k += 128) {
        for (const off of [-3, 3]) {
          ctx.moveTo(k + off, 0);
          ctx.lineTo(k + off + S, S);
          ctx.moveTo(k + off, 0);
          ctx.lineTo(k + off - S, S);
        }
      }
      ctx.stroke();
      for (let y = 0; y < S; y += 64) {
        for (let x = 0; x < S; x += 64) {
          const node = (x / 64 + y / 64) % 2 === 0;
          tiled(ctx, S, x, y, 20, (c) => {
            if (node) {
              petalFlower(c, 13, 4, "#e3c27a", "#3b1e4a", 0.7);
            } else {
              c.fillStyle = "#cfa95a";
              c.beginPath();
              c.arc(0, 0, 3, 0, TAU);
              c.fill();
            }
          });
        }
      }
    },
  },

  {
    id: "motif-sprig",
    name: "Leaf Sprig",
    category: "motifs",
    tileFraction: 0.25,
    base: "#cfd7c2",
    draw: (ctx, S) => {
      fill(ctx, S, "#d3dac6");
      for (const p of scatter(S, 6, 3, 0.2, true)) {
        tiled(ctx, S, p.x, p.y, 30, (c) => {
          c.rotate(p.k > 0.5 ? 0.5 : -0.5);
          c.strokeStyle = "#3f5a3c";
          c.lineWidth = 1.6;
          c.beginPath();
          c.moveTo(0, 14);
          c.lineTo(0, -14);
          c.stroke();
          for (const [y, side] of [
            [6, 1],
            [0, -1],
            [-6, 1],
            [-12, -1],
          ] as const) {
            c.save();
            c.translate(0, y);
            c.rotate(side * 0.9);
            leaf(c, 11, 4.5, "#3f5a3c");
            c.restore();
          }
        });
      }
    },
  },
  {
    id: "motif-foulard",
    name: "Foulard",
    category: "motifs",
    tileFraction: 0.2,
    base: "#1d2742",
    draw: (ctx, S) => {
      fill(ctx, S, "#1d2742");
      for (let j = 0; j < 8; j++) {
        for (let i = 0; i < 8; i++) {
          tiled(ctx, S, 32 + i * 64, 32 + j * 64 + (i % 2) * 32, 16, (c) => {
            c.fillStyle = "#c9a35a";
            c.beginPath();
            c.moveTo(0, -10);
            c.lineTo(10, 0);
            c.lineTo(0, 10);
            c.lineTo(-10, 0);
            c.closePath();
            c.fill();
            c.fillStyle = "#9a2f3a";
            c.beginPath();
            c.arc(0, 0, 3.5, 0, TAU);
            c.fill();
          });
        }
      }
    },
  },
  {
    id: "motif-stars",
    name: "Tiny Stars",
    category: "motifs",
    tileFraction: 0.22,
    base: "#161616",
    draw: (ctx, S) => {
      fill(ctx, S, "#161616");
      for (const p of scatter(S, 9, 17, 0.5)) {
        tiled(ctx, S, p.x, p.y, 10, (c) => {
          c.rotate(p.r * TAU);
          star(c, 6, "#f1efe9");
        });
      }
    },
  },
  {
    id: "motif-swallows",
    name: "Swallows",
    category: "motifs",
    tileFraction: 0.28,
    base: "#bcd3e7",
    draw: (ctx, S) => {
      fill(ctx, S, "#bcd3e7");
      for (const p of scatter(S, 8, 29, 0.35, true)) {
        tiled(ctx, S, p.x, p.y, 16, (c) => {
          c.rotate((p.r - 0.5) * 0.8);
          c.scale(12, 12);
          c.fillStyle = "#1f2f52";
          c.beginPath();
          c.moveTo(-1, 0);
          c.quadraticCurveTo(-0.5, -0.65, 0, -0.05);
          c.quadraticCurveTo(0.5, -0.65, 1, 0);
          c.quadraticCurveTo(0.5, -0.25, 0, 0.18);
          c.quadraticCurveTo(-0.5, -0.25, -1, 0);
          c.fill();
        });
      }
    },
  },
];

export const CUSTOM_COLOR_ID = "custom-color";

export function customColorPattern(color: string): PatternDef {
  return { id: CUSTOM_COLOR_ID, name: "Custom colour", category: "solids", tileFraction: 0.5, base: color, draw: (ctx, S) => fill(ctx, S, color) };
}

/** Looks up a pattern by id across built-ins, the custom colour and uploaded prints. */
export function resolvePattern(id: string, customColor: string, customPatterns: PatternDef[]): PatternDef {
  if (id === CUSTOM_COLOR_ID) return customColorPattern(customColor);
  return PATTERNS.find((p) => p.id === id) ?? customPatterns.find((p) => p.id === id) ?? PATTERNS[0]!;
}

const tileCache = new Map<string, HTMLCanvasElement>();

/** Returns the full-size tile for a pattern, generating it on first use. */
export function getTile(def: PatternDef): HTMLCanvasElement {
  if (def.canvas) return def.canvas;
  const key = def.id === CUSTOM_COLOR_ID ? `${def.id}:${def.base}` : def.id;
  const cached = tileCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  const size = def.category === "solids" ? 4 : TILE;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx && def.draw) def.draw(ctx, size);
  if (def.id !== CUSTOM_COLOR_ID) tileCache.set(key, canvas);
  return canvas;
}

export function tileKey(def: PatternDef): string {
  return def.id === CUSTOM_COLOR_ID ? `${def.id}:${def.base}` : def.id;
}

/** Draws a crisp small swatch straight from the vector description. */
export function drawSwatch(def: PatternDef, canvas: HTMLCanvasElement, px: number): void {
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if (def.canvas) {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(def.canvas, 0, 0, px, px);
    return;
  }
  ctx.save();
  ctx.scale(px / TILE, px / TILE);
  def.draw?.(ctx, TILE);
  ctx.restore();
}

/** Pre-generates tiles during idle time so the first tap on any swatch is instant too. */
export function warmTiles(defs: PatternDef[]): () => void {
  let cancelled = false;
  const queue = defs.filter((d) => !d.canvas);
  type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  const schedule = (fn: () => void) => {
    const w = window as IdleWindow;
    if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 500 });
    else setTimeout(fn, 32);
  };
  const step = () => {
    if (cancelled) return;
    const def = queue.shift();
    if (!def) return;
    getTile(def);
    schedule(step);
  };
  schedule(step);
  return () => {
    cancelled = true;
  };
}

export interface CustomTileOptions {
  removeBackground: boolean;
  baseColor: string;
  seamless: boolean;
}

/**
 * Turns an uploaded print into a repeatable tile. Background removal keys out
 * the dominant border colour (good for motifs photographed on plain paper or
 * cloth), letting the chosen base colour show through.
 */
export function makeCustomTile(img: CanvasImageSource, iw: number, ih: number, opts: CustomTileOptions): HTMLCanvasElement {
  const S = TILE;
  const cell = opts.seamless ? S / 2 : S;
  const src = document.createElement("canvas");
  src.width = cell;
  src.height = cell;
  const sctx = src.getContext("2d", { willReadFrequently: true });
  if (!sctx) throw new Error("Canvas unavailable");
  const side = Math.min(iw, ih);
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(img, (iw - side) / 2, (ih - side) / 2, side, side, 0, 0, cell, cell);

  if (opts.removeBackground) {
    const data = sctx.getImageData(0, 0, cell, cell);
    const px = data.data;
    const border: number[][] = [];
    for (let i = 0; i < cell; i++) {
      for (const [x, y] of [
        [i, 0],
        [i, cell - 1],
        [0, i],
        [cell - 1, i],
      ]) {
        const o = (y * cell + x) * 4;
        border.push([px[o], px[o + 1], px[o + 2]]);
      }
    }
    const median = [0, 1, 2].map((c) => {
      const v = border.map((p) => p[c]).sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)];
    });
    const bgLab = new Float32Array(3);
    rgbToLab(median[0], median[1], median[2], bgLab, 0);
    const lab = new Float32Array(3);
    for (let i = 0; i < cell * cell; i++) {
      rgbToLab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2], lab, 0);
      const d = Math.hypot(lab[0] - bgLab[0], lab[1] - bgLab[1], lab[2] - bgLab[2]);
      const t = Math.min(Math.max((d - 8) / 14, 0), 1);
      px[i * 4 + 3] = Math.round(px[i * 4 + 3] * t * t * (3 - 2 * t));
    }
    sctx.putImageData(data, 0, 0);
  }

  const out = document.createElement("canvas");
  out.width = S;
  out.height = S;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  fill(ctx, S, opts.baseColor);
  if (opts.seamless) {
    // Mirror into quadrants so every edge meets its own reflection.
    for (const [sx, sy] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      ctx.save();
      ctx.translate(sx === 1 ? 0 : S, sy === 1 ? 0 : S);
      ctx.scale(sx, sy);
      ctx.drawImage(src, 0, 0);
      ctx.restore();
    }
  } else {
    ctx.drawImage(src, 0, 0);
  }
  src.width = 0;
  src.height = 0;
  return out;
}
