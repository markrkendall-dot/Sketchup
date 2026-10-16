import { NoColorSpace, SRGBColorSpace, type CanvasTexture } from 'three';
import { CANE_COLOR, FABRICS, LINEN_COLOR, WOODS, type WoodSpec } from '../model/furniture';
import type { FabricId, WoodId } from '../model/types';
import {
  blendPixels,
  hexToRgb,
  interiorHeight,
  NAIL_HEAD,
  NEW_WORK_BLEND,
  NEW_WORK_GREEN,
  normalFromHeight,
  PX_PER_INCH,
  seeded,
  TEXTURE_PX,
  tileCanvas,
  tileTexture,
  TILE_INCHES,
  widePineBoards,
  widePineNails,
  type SidingTextures,
  type TextureVariant,
} from './textures';

// Pixel-built textures (DESIGN.md "Furniture", "Interior finishes"): wood grains (the Nordic natural
// pine of the floors and the stair treads, and the furniture woods) and fabrics (buffalo check, point
// blanket, plaid, Navajo and braided rugs, linen, cane, book spines). Each is computed straight into
// an RGBA buffer over one 48" tile (TEXTURE_PX square, v up like the canvas layouts in textures.ts),
// with a height field for its relief where it has one. The generators are pure and seamless across
// the tile's edges (every noise is periodic in the tile), so tests can measure them in node; only
// `woodTextures` and `fabricTextures` need a canvas.

export interface Pixels {
  rgba: Uint8ClampedArray;
  /** Inches, canvas order (row 0 at the top), or null for no relief. */
  height: Float32Array | null;
}

const N = TEXTURE_PX;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number): number => t * t * (3 - 2 * t);
const frac = (v: number): number => v - Math.floor(v);

/** A hash of a lattice point to [0, 1). */
function hash(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Value noise on a lattice that repeats every `px` cells across and `py` down, at (x, y) in cells:
 * smooth, in [0, 1), and seamless across the period, so a tile built of it repeats without a seam.
 */
export function periodicNoise(x: number, y: number, px: number, py: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  // The lattice corners wrapped into the period (hot: written out, no closure).
  const x0 = ((ix % px) + px) % px;
  const x1 = (((ix + 1) % px) + px) % px;
  const y0 = ((iy % py) + py) % py;
  const y1 = (((iy + 1) % py) + py) % py;
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal noise: `octaves` of periodicNoise, each twice as fine, over a period of `px` x `py` cells at the coarsest. */
export function fbm(x: number, y: number, px: number, py: number, seed: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const k = 1 << o;
    sum += amp * periodicNoise(x * k, y * k, px * k, py * k, seed + o * 31);
    norm += amp;
    amp /= 2;
  }
  return sum / norm;
}

/** Inches across the tile of pixel column x, and up it of pixel row y (row 0 at the top). */
const inchX = (x: number): number => (x + 0.5) / PX_PER_INCH;
const inchY = (y: number): number => (N - y - 0.5) / PX_PER_INCH;

/**
 * How far red may stand above blue in a pine pixel: the pale cool look of pine under a water-white
 * finish (MK, 15 Oct 2026: pine that does not turn yellow). The floor's own colour (#d8d0c2) has 22.
 */
export const PINE_MAX_WARMTH = 34;

/** Pull a pixel's warmth (red minus blue) down to `cap`, moving red and blue toward each other. */
export function clampWarmth(rgb: [number, number, number], cap: number): [number, number, number] {
  const over = rgb[0] - rgb[2] - cap;
  if (over <= 0) return rgb;
  return [rgb[0] - over / 2, rgb[1], rgb[2] + over / 2];
}

interface GrainLook {
  /** Latewood lines: how dark, how many per inch of ring value, how sharp. */
  late: number;
  ringFreq: number;
  /** The board-to-board tone spread. */
  tone: number;
  /** Long streaks along the grain (hickory's heart and sap, a log's drawknife). */
  streak: number;
  /** Knots per board (most), their darkness. */
  knots: number;
  knotDark: number;
  /** Fine fibre noise along the grain. */
  fibre: number;
  /** Red-minus-blue cap, or null for none. */
  warmthCap: number | null;
}

const LOOKS: Record<WoodSpec['grain'], GrainLook> = {
  pine: { late: 0.17, ringFreq: 0.8, tone: 0.045, streak: 0.02, knots: 1.2, knotDark: 0.55, fibre: 0.035, warmthCap: PINE_MAX_WARMTH },
  hickory: { late: 0.18, ringFreq: 1.6, tone: 0.1, streak: 0.12, knots: 0.15, knotDark: 0.6, fibre: 0.04, warmthCap: null },
  oak: { late: 0.22, ringFreq: 1.3, tone: 0.06, streak: 0.04, knots: 0, knotDark: 0.7, fibre: 0.06, warmthCap: null },
  log: { late: 0.05, ringFreq: 0.3, tone: 0.05, streak: 0.09, knots: 0.6, knotDark: 0.5, fibre: 0.05, warmthCap: null },
  bark: { late: 0, ringFreq: 0, tone: 0.08, streak: 0.35, knots: 0, knotDark: 0.5, fibre: 0.12, warmthCap: null },
  paint: { late: 0.015, ringFreq: 1.1, tone: 0.01, streak: 0.02, knots: 0, knotDark: 1, fibre: 0.012, warmthCap: null },
};

interface Board {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  seed: number;
  tone: number;
  centre: number;
  knots: { x: number; y: number; r: number }[];
}

/**
 * Wood over one tile, grain along u (canvas x). `floor`: the wide pine floor's boards (textures.ts
 * widePineBoards: 6" rows, a joint or two each, cut nails at the joists) with dark joints; else
 * `plank` stock: 8" boards the tile's length with no joints (furniture, stair treads). Each board
 * has its own tone, a flat-sawn ring figure (cathedrals) warped by noise, latewood lines, fine
 * fibres and a few knots that bend the rings round them; pine is held under PINE_MAX_WARMTH.
 */
export function woodPixels(grain: WoodSpec['grain'], color: string, layout: 'floor' | 'plank' = 'plank', seed = 7): Pixels {
  const look = LOOKS[grain];
  const rand = seeded(seed * 977 + (layout === 'floor' ? 1 : 2));
  const rows = layout === 'floor' ? widePineBoards() : Array.from({ length: 6 }, (_, k) => ({ x0: rand() * TILE_INCHES, y0: k * 8, x1: 0, y1: (k + 1) * 8 })).map((b) => ({ ...b, x1: b.x0 + TILE_INCHES }));
  const boards: Board[] = rows.map((b, i) => {
    const knots: Board['knots'] = [];
    let n = 0;
    const want = look.knots * (b.x1 - b.x0) / TILE_INCHES;
    while (n < 3 && rand() < want - n * 0.6) n++;
    for (let k = 0; k < n; k++) knots.push({ x: b.x0 + 3 + rand() * (b.x1 - b.x0 - 6), y: b.y0 + 1.2 + rand() * (b.y1 - b.y0 - 2.4), r: 0.18 + rand() * 0.3 });
    return { ...b, seed: seed * 101 + i * 7, tone: 1 + (rand() * 2 - 1) * look.tone, centre: b.y0 + (b.y1 - b.y0) * (0.2 + rand() * 0.6) + (rand() < 0.5 ? -1 : 1) * (b.y1 - b.y0) * rand(), knots };
  });
  // Rows by their lower edge, for the lookup.
  const rowStarts = [...new Set(boards.map((b) => b.y0))].sort((a, b) => a - b);
  const [r0, g0, b0] = hexToRgb(color);
  const rgba = new Uint8ClampedArray(N * N * 4);
  const height = layout === 'floor' ? (interiorHeight('floor-pine') ?? new Float32Array(N * N)) : null;
  const period = TILE_INCHES;
  for (let py = 0; py < N; py++) {
    const Y = inchY(py);
    let row = rowStarts[0];
    for (const r of rowStarts) if (r <= Y) row = r;
    const inRow = boards.filter((b) => b.y0 === row);
    for (let px = 0; px < N; px++) {
      const X = inchX(px);
      const bd = inRow.find((b) => (X >= b.x0 && X < b.x1) || (X + period >= b.x0 && X + period < b.x1)) ?? inRow[0];
      const bx = X >= bd.x0 ? X : X + period;
      const across = Y - bd.centre;
      // The ring value: a flat-sawn board shows nested cathedrals (the rings cut at a slant), warped.
      const warp = fbm(bx / 6, Y / 1.5, period / 6, period / 1.5, bd.seed, 3) - 0.5;
      // The arches: the ring value falls along the board, so each latewood line bends back on itself.
      let ring = Math.sqrt(across * across + 0.05) * look.ringFreq * 2 - Math.cos((bx / period) * Math.PI * 2 + bd.seed) * 2 + warp * 1.8;
      let knotDark = 0;
      for (const k of bd.knots) {
        const dx = (bx - k.x) / 2.2;
        const dy = Y - k.y;
        const d = Math.sqrt(dx * dx * 0.2 + dy * dy);
        if (d < 2.5) ring += (2.5 - d) * 1.2;
        const dc = Math.hypot((bx - k.x) * 0.8, Y - k.y);
        if (dc < k.r) knotDark = Math.max(knotDark, 1 - dc / k.r / 1.6);
        else if (dc < k.r * 1.35) knotDark = Math.max(knotDark, 0.6);
      }
      const f = frac(ring);
      const lateLine = look.late * Math.pow(clamp01((f - 0.72) / 0.28), 1.6);
      const fibre = (periodicNoise(bx * 0.6, Y * 22, period * 0.6, period * 22, bd.seed + 3) - 0.5) * look.fibre * 2;
      const streak = (fbm(bx / 14, Y * 1.4, period / 14, period * 1.4, bd.seed + 5, 2) - 0.5) * look.streak * 2;
      let k = bd.tone * (1 - lateLine + fibre + streak);
      if (grain === 'bark') {
        // Bark: deep fissures along the log, ridges between.
        const fiss = periodicNoise(bx / 9, Y * 1.1, period / 9, period * 1.1, bd.seed + 9);
        k *= 0.65 + 0.55 * Math.pow(fiss, 1.5);
      }
      // Latewood a little browner than the earlywood: green held down with blue, so the warmth cap
      // (which trades red for blue) never leaves an olive cast.
      let rgb: [number, number, number] = [r0 * k, g0 * k * (1 - lateLine * 0.25), b0 * k * (1 - lateLine * 0.45)];
      if (knotDark > 0) {
        const t = knotDark;
        const kd = look.knotDark;
        rgb = [rgb[0] * (1 - t + t * kd * 0.95), rgb[1] * (1 - t + t * kd * 0.9), rgb[2] * (1 - t + t * kd * 0.9)];
      }
      if (look.warmthCap !== null) rgb = clampWarmth(rgb, look.warmthCap);
      const i = (py * N + px) * 4;
      rgba[i] = rgb[0];
      rgba[i + 1] = rgb[1];
      rgba[i + 2] = rgb[2];
      rgba[i + 3] = 255;
      if (height) height[py * N + px] += lateLine * 0.02;
    }
  }
  if (layout === 'floor') {
    // Dark joints along each row and at each board's end, and the grey heads of the cut nails.
    const darken = (x: number, y: number, t: number) => {
      const i = ((((y % N) + N) % N) * N + (((x % N) + N) % N)) * 4;
      rgba[i] *= t;
      rgba[i + 1] *= t;
      rgba[i + 2] *= t;
    };
    const col = (x: number) => Math.round(x * PX_PER_INCH);
    const rowPx = (y: number) => N - Math.round(y * PX_PER_INCH);
    for (const b of boards) {
      for (let x = 0; x < N; x++) darken(x, rowPx(b.y1), 0.62);
      for (let y = rowPx(b.y1); y < rowPx(b.y0); y++) darken(col(b.x0), y, 0.62);
    }
    const s = Math.max(2, Math.round(NAIL_HEAD * PX_PER_INCH));
    for (const n of widePineNails()) {
      for (let dy = 0; dy < s; dy++) {
        for (let dx = 0; dx < s; dx++) {
          const i = ((((rowPx(n.y) - (s >> 1) + dy) % N) + N) % N) * N + ((((col(n.x) - (s >> 1) + dx) % N) + N) % N);
          rgba[i * 4] = 92;
          rgba[i * 4 + 1] = 90;
          rgba[i * 4 + 2] = 88;
        }
      }
    }
  }
  return { rgba, height };
}

// ---------------------------------------------------------------------------------------------
// Fabrics

/** The buffalo check's square, inches (3", the classic red and black). */
export const BUFFALO_CHECK = 3;
/** A point blanket's band set repeats once per tile (48"). */
const POINT_BANDS: [number, number, number][] = [
  // [colour index into FABRICS.pointBlanket.colors, start, width] in inches along u.
  [1, 6, 2.5],
  [2, 8.5, 1.5],
  [3, 10, 1.5],
  [4, 11.5, 2.5],
];

/** Something a texture can be woven of: a catalogue fabric, or the linen, cane and book spines the pieces use. */
export type FabricTexture = FabricId | 'linen' | 'cane' | 'books';

const mixRgb = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * A fabric over one tile (DESIGN.md "Furniture"), with a fine weave over every pattern: a buffalo
 * check of BUFFALO_CHECK squares; a point blanket's cream with green, red, yellow and indigo bands
 * across u; a twill tartan; plain canvas, cream wool and linen; leather's mottle and creases; a
 * Navajo weave of bands and stepped diamonds; a braided rag rug's rows of twisted strands; a chair
 * seat's woven cane; a shelf of book spines.
 */
export function fabricPixels(id: FabricTexture): Pixels {
  const rgba = new Uint8ClampedArray(N * N * 4);
  const height = id === 'cane' || id === 'braided' || id === 'navajo' ? new Float32Array(N * N) : null;
  const spec = id === 'linen' || id === 'cane' || id === 'books' ? null : FABRICS[id];
  const cols = (spec?.colors ?? [id === 'cane' ? CANE_COLOR : LINEN_COLOR]).map(hexToRgb);
  const P = TILE_INCHES;
  const bookRand = seeded(211);
  const spines: { y0: number; y1: number; c: [number, number, number]; band: number }[] = [];
  if (id === 'books') {
    const palette = ['#6b2a24', '#2e4a3a', '#2b3550', '#8a6a3a', '#5a4a3a', '#7d3b2b', '#3e3a36', '#a08c62'].map(hexToRgb);
    for (let y = 0; y < P; ) {
      const w = 0.8 + bookRand() * 1.4;
      spines.push({ y0: y, y1: Math.min(P, y + w), c: palette[Math.floor(bookRand() * palette.length)], band: 6 + bookRand() * 3 });
      y += w;
    }
  }
  const plaidSett: [number, number][] = [
    [0, 3],
    [1, 0.75],
    [0, 0.75],
    [2, 0.25],
    [0, 0.75],
    [3, 2.5],
    [1, 0.5],
    [3, 2.5],
  ];
  const settLen = plaidSett.reduce((a, [, w]) => a + w, 0);
  const settAt = (v: number) => {
    let t = frac(v / settLen) * settLen;
    for (const [c, w] of plaidSett) {
      if (t < w) return c;
      t -= w;
    }
    return 0;
  };
  for (let py = 0; py < N; py++) {
    const Y = inchY(py);
    for (let px = 0; px < N; px++) {
      const X = inchX(px);
      // The weave: threads over and under, a few percent either way.
      const weave = ((px + py) & 1 ? 1.02 : 0.98) * (1 + (periodicNoise(X * 3, Y * 0.4, P * 3, P * 0.4, 5) - 0.5) * 0.05);
      let rgb: [number, number, number];
      let h = 0;
      switch (spec?.pattern ?? id) {
        case 'check': {
          const i = Math.floor(X / BUFFALO_CHECK) & 1;
          const j = Math.floor(Y / BUFFALO_CHECK) & 1;
          rgb = i && j ? [...cols[1]] as [number, number, number] : i || j ? mixRgb(cols[0], cols[1], 0.5) : [...cols[0]] as [number, number, number];
          break;
        }
        case 'point': {
          rgb = [...cols[0]] as [number, number, number];
          const u = frac(X / P) * P;
          for (const [c, start, w] of POINT_BANDS) if (u >= start && u < start + w) rgb = [...cols[c]] as [number, number, number];
          break;
        }
        case 'plaid': {
          const warp = cols[settAt(X)];
          const weft = cols[settAt(Y)];
          // Twill: warp over two, under two, stepping each row.
          rgb = ((px >> 1) + (py >> 1)) & 1 ? [...warp] as [number, number, number] : [...weft] as [number, number, number];
          rgb = mixRgb(rgb, mixRgb(warp, weft, 0.5), 0.35);
          break;
        }
        case 'leather': {
          const m = fbm(X / 4, Y / 4, P / 4, P / 4, 13, 4);
          const crease = Math.abs(periodicNoise(X / 2.5, Y / 2.5, P / 2.5, P / 2.5, 17) - 0.5) < 0.02 ? 0.85 : 1;
          rgb = cols[0].map((c) => c * (0.85 + m * 0.3) * crease) as [number, number, number];
          break;
        }
        case 'navajo': {
          // Bands across u near each end of the tile's length, stepped diamonds between, in 1" steps.
          const u = frac(X / P) * P;
          const cx = Math.floor(u);
          const cy = Math.floor(frac(Y / P) * P);
          const band = u < 2 || u >= 46 ? 2 : u < 3 || u >= 45 ? 1 : u < 4 || u >= 44 ? 0 : -1;
          if (band >= 0) rgb = [...cols[band === 2 ? 2 : band === 1 ? 1 : 3]] as [number, number, number];
          else {
            const dm = Math.abs(cx - 24) + Math.abs(((cy % 24) + 24) % 24 - 12);
            const ring = Math.floor(dm / 2) % 4;
            rgb = [...cols[[1, 0, 2, 0][ring]]] as [number, number, number];
            if (dm > 18) rgb = [...cols[3]] as [number, number, number];
          }
          h = 0.02 * (((px >> 2) + (py >> 2)) & 1);
          break;
        }
        case 'braided': {
          // Rows 1.2" wide along u, each strand a twist of diagonal lights and darks.
          const rowH = P / 40;
          const r = Math.floor(Y / rowH);
          const t = frac(Y / rowH);
          const c = cols[r % cols.length];
          const twist = frac((X + (t < 0.5 ? t : 1 - t) * 1.4) / 0.9);
          const shadeK = 0.78 + 0.3 * Math.sin(Math.PI * t) * (0.7 + 0.3 * Math.sin(twist * Math.PI * 2));
          rgb = c.map((v) => v * shadeK) as [number, number, number];
          h = 0.15 * Math.sin(Math.PI * t);
          break;
        }
        case 'cane': {
          // Six-way woven cane: strands across, along and both diagonals, round holes between.
          const g = 0.6;
          const gx = frac(X / g) * g;
          const gy = frac(Y / g) * g;
          const w = 0.07;
          const strand = gx < w || gy < w || Math.abs(gx - gy) < w || Math.abs(gx + gy - g) < w;
          rgb = strand ? cols[0].map((v) => v * (1.02 + (periodicNoise(X * 4, Y * 4, P * 4, P * 4, 3) - 0.5) * 0.15)) as [number, number, number] : cols[0].map((v) => v * 0.32) as [number, number, number];
          h = strand ? 0.05 : -0.05;
          break;
        }
        case 'books': {
          const sp = spines.find((s) => Y >= s.y0 && Y < s.y1) ?? spines[0];
          const edge = Y - sp.y0 < 0.06 || sp.y1 - Y < 0.06 ? 0.55 : 1;
          const u = frac(X / 12) * 12;
          const gold = Math.abs(u - sp.band) < 0.12 || Math.abs(u - sp.band - 0.5) < 0.08;
          rgb = gold ? [196, 160, 88] : (sp.c.map((v) => v * edge) as [number, number, number]);
          break;
        }
        default:
          // Canvas, cream wool, linen: plain, with slubs.
          rgb = cols[0].map((v) => v * (1 + (periodicNoise(X * 1.5, Y * 0.2, P * 1.5, P * 0.2, 9) - 0.5) * 0.06)) as [number, number, number];
      }
      const i = (py * N + px) * 4;
      rgba[i] = rgb[0] * weave;
      rgba[i + 1] = rgb[1] * weave;
      rgba[i + 2] = rgb[2] * weave;
      rgba[i + 3] = 255;
      if (height) height[py * N + px] = h;
    }
  }
  return { rgba, height };
}

/**
 * Painted wallboard: the colour with an eggshell roller's stipple (a percent or two either way) and
 * the faintest relief, so a painted wall is not a dead flat colour in the light.
 */
export function paintPixels(color: string): Pixels {
  const [r, g, b] = hexToRgb(color);
  const { shade, height } = paintField();
  const rgba = new Uint8ClampedArray(N * N * 4);
  for (let j = 0; j < N * N; j++) {
    const k = shade[j];
    const i = j * 4;
    rgba[i] = r * k;
    rgba[i + 1] = g * k;
    rgba[i + 2] = b * k;
    rgba[i + 3] = 255;
  }
  return { rgba, height };
}

let paintFieldCache: { shade: Float64Array; height: Float32Array } | null = null;

/** The paint's stipple and roll, which do not depend on its colour: worked out once and shared. */
function paintField(): { shade: Float64Array; height: Float32Array } {
  if (paintFieldCache) return paintFieldCache;
  const shade = new Float64Array(N * N);
  const height = new Float32Array(N * N);
  const P = TILE_INCHES;
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const X = inchX(px);
      const Y = inchY(py);
      const stipple = periodicNoise(X * 6, Y * 6, P * 6, P * 6, 41) - 0.5;
      const roll = fbm(X / 9, Y / 2, P / 9, P / 2, 43, 2) - 0.5;
      shade[py * N + px] = 1 + stipple * 0.025 + roll * 0.02;
      height[py * N + px] = stipple * 0.006;
    }
  }
  paintFieldCache = { shade, height };
  return paintFieldCache;
}

// ---------------------------------------------------------------------------------------------
// Textures (need a canvas)

const pixelCache = new Map<string, SidingTextures | null>();
/** Each key's pixels, generated once for both variants. */
const generated = new Map<string, Pixels>();
/** Normal maps by key (or by a shared relief key, as for paint), one for both variants. */
const pixelNormals = new Map<string, CanvasTexture | null>();

/**
 * Textures from a pixel generator, made once per key and variant: the colour map (the `new` variant
 * blended toward NEW_WORK_GREEN like every other texture) and the normal map of its height field.
 * The pixels are generated once per key, and the normal map is made once per key (or per
 * `reliefKey`, for generators whose relief does not depend on the key) and shared by both variants.
 * Null wherever there is no DOM canvas (node, tests).
 */
export function texturesFromPixels(
  key: string,
  make: () => Pixels,
  variant: TextureVariant = 'plain',
  strength: number = PX_PER_INCH,
  reliefKey: string = key,
): SidingTextures | null {
  if (typeof document === 'undefined') return null;
  const k = `${key}|${variant}`;
  const hit = pixelCache.get(k);
  if (hit !== undefined) return hit;
  const tile = tileCanvas();
  if (!tile) {
    pixelCache.set(k, null);
    return null;
  }
  let px = generated.get(key);
  if (!px) {
    px = make();
    generated.set(key, px);
  }
  const img = tile.ctx.createImageData(TEXTURE_PX, TEXTURE_PX);
  img.data.set(px.rgba);
  if (variant === 'new') blendPixels(img.data, hexToRgb(NEW_WORK_GREEN), NEW_WORK_BLEND);
  tile.ctx.putImageData(img, 0, 0);
  const nk = `${reliefKey}|${strength}`;
  let normalMap = pixelNormals.get(nk);
  if (normalMap === undefined) {
    normalMap = null;
    if (px.height) {
      const n = tileCanvas();
      if (n) {
        const nimg = n.ctx.createImageData(TEXTURE_PX, TEXTURE_PX);
        normalFromHeight(px.height, TEXTURE_PX, strength, nimg.data);
        n.ctx.putImageData(nimg, 0, 0);
        normalMap = tileTexture(n.canvas, NoColorSpace);
      }
    }
    pixelNormals.set(nk, normalMap);
  }
  const out = { map: tileTexture(tile.canvas, SRGBColorSpace), normalMap };
  pixelCache.set(k, out);
  return out;
}

/** The textures of a catalogue wood, or of plank stock in a colour (the stair treads). */
export function woodTextures(wood: WoodId | { grain: WoodSpec['grain']; color: string }, variant: TextureVariant = 'plain'): SidingTextures | null {
  const w = typeof wood === 'string' ? WOODS[wood] : wood;
  return texturesFromPixels(`wood|${w.grain}|${w.color}`, () => woodPixels(w.grain, w.color, 'plank'), variant);
}

/** The textures of the wide pine floor in a colour (Nordic natural: pale, cool, knots and nails). */
export function pineFloorTextures(color: string, variant: TextureVariant = 'plain'): SidingTextures | null {
  return texturesFromPixels(`floor-pine|${color}`, () => woodPixels('pine', color, 'floor'), variant);
}

export function fabricTextures(id: FabricTexture, variant: TextureVariant = 'plain'): SidingTextures | null {
  return texturesFromPixels(`fabric|${id}`, () => fabricPixels(id), variant);
}

export function paintTextures(color: string, variant: TextureVariant = 'plain'): SidingTextures | null {
  return texturesFromPixels(`paint|${color}`, () => paintPixels(color), variant, PX_PER_INCH, 'paint');
}
