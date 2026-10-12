import { CanvasTexture, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace, type ColorSpace } from 'three';
import type { WallFinish } from '../model/types';

// Procedural siding textures (DESIGN.md "Exterior appearance"). One 512 x 512 canvas stands for
// 48" x 48" of wall, so a texel is 3/32". Wall geometry carries UVs in inches (meshes.ts
// addWallUVs) and the texture repeats every 48", so courses run level and continuous across wall
// pieces and openings. Every finish with relief (laps, shingle butts and keyways, V-grooves,
// mortar joints) also has a height field in inches, turned into a normal map. The layouts, the
// height fields and the normal-map rule are pure (testable in node); only drawing needs a canvas,
// and `sidingTextures` returns null where there is no `document` (node, tests).

/** Pixels per side of a texture tile. */
export const TEXTURE_PX = 512;
/** Inches of wall one tile covers. */
export const TILE_INCHES = 48;
export const PX_PER_INCH = TEXTURE_PX / TILE_INCHES;

/** Course height (exposure) of clapboard, inches: 6 courses per tile. */
export const CLAPBOARD_COURSE = 8;
/**
 * Shingle courses: 5" does not divide the 48" tile, so a tile holds 10 courses of 4.8" (the tile
 * has to repeat seamlessly).
 */
export const SHINGLE_COURSES = 10;
/** The gap between two shingles of a course, inches. */
export const SHINGLE_KEYWAY = 0.1875;
export const BOARD_WIDTH = 8;
/** Half the width of the V-groove between two boards, inches. */
export const GROOVE_HALF = 0.25;
/** Concrete block: 8" x 16" nominal (each module includes its share of a 3/8" joint), running bond. */
export const BLOCK_HEIGHT = 8;
export const BLOCK_LENGTH = 16;
export const MORTAR_JOINT = 0.375;
/** Wire spacing of a screen, in pixels (3/16"): 1 px wires every 2 px. */
export const SCREEN_MESH_PX = 2;

/** Relief in inches: a clapboard's lap step, a shingle's butt, a keyway, a V-groove, a raked mortar joint. */
export const RELIEF = { lap: 0.6, butt: 0.4, keyway: 0.3, groove: 0.2, mortar: 0.25 } as const;
/** How far the normal maps bend the light (MeshStandardMaterial.normalScale). */
export const NORMAL_SCALE = 0.6;
/**
 * Darkness of the pixel rows under a lap (a clapboard's lap, a shingle's butt): the course above
 * shades the top of the one below, darkest for the first 3 px (about 1/4") and fading after.
 */
export const LAP_SHADOW = [0.55, 0.42, 0.3, 0.2, 0.12, 0.06] as const;
export const BUTT_SHADOW = [0.62, 0.5, 0.36, 0.22, 0.12, 0.05] as const;
/** The block above shades the top of a raked bed joint. */
export const JOINT_SHADOW = [0.35, 0.18] as const;
/** Darkness of the columns across a V-groove, left to right: the side away from the light is darker. */
export const GROOVE_SHADOW = [0.1, 0.4, 0.5, 0.25, 0.08] as const;

/**
 * Boundaries of horizontal courses in a tile, from the bottom (0) to the top: 48" at 8" gives
 * [0, 8, ..., 48], 6 courses.
 */
export function courseBoundaries(tile: number, course: number): number[] {
  const n = Math.max(1, Math.round(tile / course));
  return Array.from({ length: n + 1 }, (_, i) => (i * tile) / n);
}

/** Deterministic pseudo-random numbers in [0, 1) (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Vertical joint positions of one shingle course across the tile: widths of 4" to 8" that sum to
 * exactly `tile`, starting at a course-dependent offset so the joints stagger. Returns the joint
 * positions in [0, tile), ascending (the first is the tile's left edge, 0).
 */
export function shingleJoints(course: number, tile = TILE_INCHES, rand: () => number = seeded(course * 7919 + 13)): number[] {
  const widths: number[] = [];
  let left = tile;
  while (left > 8) {
    // Leave at least 4" for the rest.
    const max = Math.min(8, left - 4);
    const w = 4 + rand() * (max - 4);
    widths.push(w);
    left -= w;
  }
  widths.push(left);
  // A rotation by a course-dependent amount staggers the joints from course to course.
  const shift = rand() * tile;
  const joints = [];
  let x = 0;
  for (const w of widths) {
    joints.push((x + shift) % tile);
    x += w;
  }
  return joints.sort((p, q) => p - q);
}

/** Brightness factor of a course or board: a few percent either way. */
export const brightness = (rand: () => number): number => 0.94 + rand() * 0.12;

/** One shingle of a course: its edges (x1 may pass the tile's right edge: it wraps) and its looks. */
export interface Shingle {
  x0: number;
  x1: number;
  /** Brightness factor (brightness()). */
  shade: number;
  /** Warm (+) or cool (-) shift, -1 to 1. */
  warmth: number;
  /** How far its butt stands proud of its neighbours, inches. */
  lift: number;
}

export interface ShingleCourse {
  y0: number;
  y1: number;
  shingles: Shingle[];
}

/** The shingle courses of a tile, bottom to top: staggered joints (shingleJoints) and each shingle's looks. */
export function shingleCourses(): ShingleCourse[] {
  const b = courseBoundaries(TILE_INCHES, TILE_INCHES / SHINGLE_COURSES);
  const out: ShingleCourse[] = [];
  for (let k = 0; k + 1 < b.length; k++) {
    const rand = seeded(k * 131 + 5);
    const joints = shingleJoints(k, TILE_INCHES, rand);
    const shingles = joints.map((x0, j) => ({
      x0,
      x1: j + 1 < joints.length ? joints[j + 1] : TILE_INCHES + joints[0],
      shade: brightness(rand),
      warmth: rand() * 2 - 1,
      lift: rand() * 0.06,
    }));
    out.push({ y0: b[k], y1: b[k + 1], shingles });
  }
  return out;
}

/** A rectangle in tile inches, y measured up from the tile's bottom. */
export interface TileRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The faces of the concrete blocks in a tile: 6 courses of 3 blocks, every other course shifted by
 * half a block (running bond), each face inset by half a mortar joint all round. Mortar is the rest.
 */
export function blockFaces(): TileRect[] {
  const m = MORTAR_JOINT / 2;
  const out: TileRect[] = [];
  const courses = Math.round(TILE_INCHES / BLOCK_HEIGHT);
  const perCourse = Math.round(TILE_INCHES / BLOCK_LENGTH);
  for (let k = 0; k < courses; k++) {
    const shift = (k % 2) * (BLOCK_LENGTH / 2);
    for (let j = 0; j < perCourse; j++) {
      const x = shift + j * BLOCK_LENGTH;
      out.push({ x0: x + m, y0: k * BLOCK_HEIGHT + m, x1: x + BLOCK_LENGTH - m, y1: (k + 1) * BLOCK_HEIGHT - m });
    }
  }
  return out;
}

const wrap = (i: number, n: number): number => ((i % n) + n) % n;
/** Canvas column of a position across the tile, and canvas row of a height up it (rows grow downward). */
const colOf = (x: number): number => Math.round(x * PX_PER_INCH);
const rowOf = (y: number): number => TEXTURE_PX - Math.round(y * PX_PER_INCH);

/**
 * Set (or with `add`, raise) the height of the pixels of a rectangle in tile inches, wrapping round
 * the tile's edges: the same pixels rect() paints, so relief and colour line up. `h` gets the pixel
 * centre's fraction across (0 at x0) and up (0 at y0) the rectangle.
 */
function heightRect(f: Float32Array, r: TileRect, h: (fx: number, fy: number) => number, add = false): void {
  const c0 = colOf(r.x0);
  const c1 = colOf(r.x1);
  const top = rowOf(r.y1);
  const bottom = rowOf(r.y0);
  for (let row = top; row < bottom; row++) {
    const fy = (bottom - row - 0.5) / (bottom - top);
    const base = wrap(row, TEXTURE_PX) * TEXTURE_PX;
    for (let c = c0; c < c1; c++) {
      const i = base + wrap(c, TEXTURE_PX);
      const v = h((c - c0 + 0.5) / (c1 - c0), fy);
      f[i] = add ? f[i] + v : v;
    }
  }
}

/**
 * The relief of a finish over one tile, in inches (row-major in canvas order: row 0 is the tile's
 * top), or null for a finish without relief (plain, screen). Clapboard: each board tapers from its
 * butt to nothing under the board above, a RELIEF.lap step at every lap. Shingle: the same taper
 * per course (RELIEF.butt), each shingle a little proud or shy of its neighbours, a keyway between
 * shingles. Board: a V-groove at each joint. Block: flat faces, raked mortar joints.
 */
export function sidingHeight(finish: WallFinish): Float32Array | null {
  const f = new Float32Array(TEXTURE_PX * TEXTURE_PX);
  if (finish === 'clapboard') {
    const b = courseBoundaries(TILE_INCHES, CLAPBOARD_COURSE);
    for (let k = 0; k + 1 < b.length; k++) heightRect(f, { x0: 0, y0: b[k], x1: TILE_INCHES, y1: b[k + 1] }, (_, fy) => RELIEF.lap * (1 - fy));
  } else if (finish === 'shingle') {
    const courses = shingleCourses();
    for (const c of courses) {
      for (const s of c.shingles) heightRect(f, { x0: s.x0, y0: c.y0, x1: s.x1, y1: c.y1 }, (_, fy) => RELIEF.butt * (1 - fy) + s.lift);
    }
    // Keyways after every face of the course, so a wrapped shingle does not cover its neighbour's.
    for (const c of courses) {
      for (const s of c.shingles) heightRect(f, { x0: s.x0 - SHINGLE_KEYWAY / 2, y0: c.y0, x1: s.x0 + SHINGLE_KEYWAY / 2, y1: c.y1 }, () => -RELIEF.keyway, true);
    }
  } else if (finish === 'board') {
    for (const x of courseBoundaries(TILE_INCHES, BOARD_WIDTH).slice(0, -1)) {
      heightRect(f, { x0: x - GROOVE_HALF, y0: 0, x1: x + GROOVE_HALF, y1: TILE_INCHES }, (fx) => -RELIEF.groove * (1 - Math.abs(2 * fx - 1)));
    }
  } else if (finish === 'block') {
    f.fill(-RELIEF.mortar);
    for (const r of blockFaces()) heightRect(f, r, () => 0);
  } else return null;
  return f;
}

/**
 * A tangent-space normal map from a height field (row-major, canvas order, `size` x `size`), as
 * RGBA bytes. Sobel derivatives sample modulo the tile, so its seam has no line; `strength` turns
 * height units per pixel into slope (PX_PER_INCH for heights in inches gives the true slope).
 * Canvas y grows downward while the texture's v grows upward (flipY), so the normal is
 * (-k dh/dx, +k dh/dy, 1) normalized, stored as (n + 1) / 2: R = 0.5 - 0.5 k dh/dx and
 * G = 0.5 + 0.5 k dh/dy for gentle slopes. A step down the canvas (a lap's butt, higher above
 * lower) faces down: G below 128. Flat is (128, 128, 255).
 */
export function normalFromHeight(height: ArrayLike<number>, size: number, strength: number, out: Uint8ClampedArray = new Uint8ClampedArray(size * size * 4)): Uint8ClampedArray {
  for (let y = 0; y < size; y++) {
    const up = wrap(y - 1, size) * size;
    const mid = y * size;
    const down = wrap(y + 1, size) * size;
    for (let x = 0; x < size; x++) {
      const l = wrap(x - 1, size);
      const r = wrap(x + 1, size);
      const dx = (height[up + r] + 2 * height[mid + r] + height[down + r] - height[up + l] - 2 * height[mid + l] - height[down + l]) / 8;
      const dy = (height[down + l] + 2 * height[down + x] + height[down + r] - height[up + l] - 2 * height[up + x] - height[up + r]) / 8;
      const nx = -strength * dx;
      const ny = strength * dy;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (mid + x) * 4;
      out[i] = Math.round((nx * inv + 1) * 127.5);
      out[i + 1] = Math.round((ny * inv + 1) * 127.5);
      out[i + 2] = Math.round((inv + 1) * 127.5);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** The new-work green the `new` variant of a texture is blended toward (DESIGN.md "Exterior appearance"). */
export const NEW_WORK_GREEN = '#a9dcb7';
/** How far the `new` variant moves each pixel toward NEW_WORK_GREEN. */
export const NEW_WORK_BLEND = 0.5;

/** A plain texture, or the new-work variant blended toward green (REVIEW-2 C4). */
export type TextureVariant = 'plain' | 'new';

/** `#rrggbb` as [r, g, b] in 0..255. */
export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * Blend RGBA pixels (canvas ImageData order) toward `target` by `t` in place: each channel becomes
 * c + (target - c) * t, rounded; alpha is kept (a screen's see-through mesh stays see-through). The
 * `new` variant of a siding texture is the drawn texture through this, so new work reads as the
 * finish washed with light green instead of the dark stain multiplied by green (which went black).
 */
export function blendPixels(data: Uint8ClampedArray | number[], target: readonly [number, number, number], t: number): void {
  for (let i = 0; i + 3 < data.length; i += 4) {
    data[i] = Math.round(data[i] + (target[0] - data[i]) * t);
    data[i + 1] = Math.round(data[i + 1] + (target[1] - data[i + 1]) * t);
    data[i + 2] = Math.round(data[i + 2] + (target[2] - data[i + 2]) * t);
  }
}

/** A flat colour blended toward the new-work green the same way (the new variant of a colour). */
export function newWorkColor(hex: string): string {
  const px = [...hexToRgb(hex), 255];
  blendPixels(px, hexToRgb(NEW_WORK_GREEN), NEW_WORK_BLEND);
  return `#${((px[0] << 16) | (px[1] << 8) | px[2]).toString(16).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------------------------
// Drawing (needs a canvas)

type Ctx = CanvasRenderingContext2D;

/** How far a shingle's warmth moves red up and blue down (or the reverse). */
const WARMTH = 0.05;

const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

/** A colour scaled by `f` in sRGB (so a few percent reads as a few percent), warmed or cooled. */
function shade(color: string, f: number, warmth = 0): string {
  const [r, g, b] = hexToRgb(color);
  return `rgb(${byte(r * f * (1 + WARMTH * warmth))}, ${byte(g * f)}, ${byte(b * f * (1 - WARMTH * warmth))})`;
}

/** The mortar between blocks: the block colour lifted toward a pale grey. */
function mortarColor(color: string): string {
  const [r, g, b] = hexToRgb(color);
  const t = 0.45;
  return `rgb(${byte(r + (206 - r) * t)}, ${byte(g + (202 - g) * t)}, ${byte(b + (194 - b) * t)})`;
}

/** fillRect with the current fill style, wrapping round the tile's edges. */
function pixelRect(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  if (w <= 0 || h <= 0) return;
  const xs = x < 0 || x + w > TEXTURE_PX ? [x, x - TEXTURE_PX, x + TEXTURE_PX] : [x];
  const ys = y < 0 || y + h > TEXTURE_PX ? [y, y - TEXTURE_PX, y + TEXTURE_PX] : [y];
  for (const px of xs) for (const py of ys) ctx.fillRect(px, py, w, h);
}

/** Fill a rectangle given in tile inches, with y measured up from the tile's bottom; it wraps round the tile. */
function rect(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, fill: string): void {
  // Canvas y grows downward; the texture's v = 0 is the canvas bottom (flipY).
  ctx.fillStyle = fill;
  pixelRect(ctx, colOf(x0), rowOf(y1), colOf(x1) - colOf(x0), rowOf(y0) - rowOf(y1));
}

/** Darken the pixel rows just under the line at height y, by `profile` row by row (a lap's shadow). */
function lapShadow(ctx: Ctx, y: number, profile: readonly number[]): void {
  const row0 = rowOf(y);
  profile.forEach((a, i) => {
    ctx.fillStyle = `rgba(0, 0, 0, ${a})`;
    ctx.fillRect(0, wrap(row0 + i, TEXTURE_PX), TEXTURE_PX, 1);
  });
}

/**
 * Faint wood grain: `n` 1 px streaks along x or y at random places in a rectangle (tile inches),
 * most a little darker than the wood, some a little lighter.
 */
function grain(ctx: Ctx, rand: () => number, along: 'x' | 'y', r: TileRect, n: number): void {
  for (let i = 0; i < n; i++) {
    const dark = rand() < 0.7;
    const a = dark ? 0.04 + rand() * 0.07 : 0.02 + rand() * 0.035;
    ctx.fillStyle = dark ? `rgba(0, 0, 0, ${a.toFixed(3)})` : `rgba(255, 255, 255, ${a.toFixed(3)})`;
    if (along === 'x') {
      const len = (0.15 + rand() * 0.6) * (r.x1 - r.x0);
      const x = r.x0 + rand() * (r.x1 - r.x0 - len);
      const y = r.y0 + rand() * (r.y1 - r.y0);
      pixelRect(ctx, colOf(x), rowOf(y), Math.max(1, Math.round(len * PX_PER_INCH)), 1);
    } else {
      const len = (0.3 + rand() * 0.7) * (r.y1 - r.y0);
      const y = r.y0 + rand() * (r.y1 - r.y0 - len);
      const x = r.x0 + rand() * (r.x1 - r.x0);
      pixelRect(ctx, colOf(x), rowOf(y + len), 1, Math.max(1, Math.round(len * PX_PER_INCH)));
    }
  }
}

/** Concrete's pores and sand: `n` dots of 1 or 2 px, darker or lighter, in a rectangle. */
function speckle(ctx: Ctx, rand: () => number, r: TileRect, n: number): void {
  for (let i = 0; i < n; i++) {
    const dark = rand() < 0.6;
    const a = dark ? 0.08 + rand() * 0.14 : 0.05 + rand() * 0.1;
    ctx.fillStyle = dark ? `rgba(0, 0, 0, ${a.toFixed(3)})` : `rgba(255, 255, 255, ${a.toFixed(3)})`;
    const s = rand() < 0.2 ? 2 : 1;
    pixelRect(ctx, colOf(r.x0 + rand() * (r.x1 - r.x0)), rowOf(r.y0 + rand() * (r.y1 - r.y0)), s, s);
  }
}

function drawClapboard(ctx: Ctx, color: string): void {
  const rand = seeded(11);
  const b = courseBoundaries(TILE_INCHES, CLAPBOARD_COURSE);
  for (let k = 0; k + 1 < b.length; k++) {
    const course = { x0: 0, y0: b[k], x1: TILE_INCHES, y1: b[k + 1] };
    rect(ctx, course.x0, course.y0, course.x1, course.y1, shade(color, brightness(rand)));
    grain(ctx, rand, 'x', course, 46);
  }
  // Each lap shades the top of the board below it.
  for (let k = 1; k < b.length; k++) lapShadow(ctx, b[k], LAP_SHADOW);
}

function drawShingle(ctx: Ctx, color: string): void {
  const rand = seeded(23);
  const courses = shingleCourses();
  for (const c of courses) {
    for (const s of c.shingles) {
      rect(ctx, s.x0, c.y0, s.x1, c.y1, shade(color, s.shade, s.warmth));
      grain(ctx, rand, 'y', { x0: s.x0, y0: c.y0, x1: s.x1, y1: c.y1 }, Math.round((s.x1 - s.x0) * 1.5));
    }
    // The keyway at each shingle's left edge: a dark gap down to the course underneath, a little
    // lighter than the butt's shadow so the courses lead and the shingles do not read as brick.
    ctx.fillStyle = shade(color, 0.58);
    for (const s of c.shingles) {
      const c0 = colOf(s.x0 - SHINGLE_KEYWAY / 2);
      pixelRect(ctx, c0, rowOf(c.y1), Math.max(1, colOf(s.x0 + SHINGLE_KEYWAY / 2) - c0), rowOf(c.y0) - rowOf(c.y1));
    }
  }
  // Each course's butts shade the top of the course below.
  for (const c of courses) lapShadow(ctx, c.y1, BUTT_SHADOW);
}

function drawBoard(ctx: Ctx, color: string): void {
  const rand = seeded(29);
  const b = courseBoundaries(TILE_INCHES, BOARD_WIDTH);
  for (let k = 0; k + 1 < b.length; k++) {
    rect(ctx, b[k], 0, b[k + 1], TILE_INCHES, shade(color, brightness(rand)));
    grain(ctx, rand, 'y', { x0: b[k], y0: 0, x1: b[k + 1], y1: TILE_INCHES }, 40);
  }
  // A V-groove at every joint.
  for (let k = 0; k + 1 < b.length; k++) {
    const c = colOf(b[k]) - Math.floor(GROOVE_SHADOW.length / 2);
    GROOVE_SHADOW.forEach((a, i) => {
      ctx.fillStyle = `rgba(0, 0, 0, ${a})`;
      pixelRect(ctx, c + i, 0, 1, TEXTURE_PX);
    });
  }
}

function drawBlock(ctx: Ctx, color: string): void {
  const rand = seeded(47);
  const tile = { x0: 0, y0: 0, x1: TILE_INCHES, y1: TILE_INCHES };
  // Mortar everywhere, lighter than the blocks; then each block's face over it.
  ctx.fillStyle = mortarColor(color);
  ctx.fillRect(0, 0, TEXTURE_PX, TEXTURE_PX);
  speckle(ctx, rand, tile, 900);
  for (const f of blockFaces()) {
    rect(ctx, f.x0, f.y0, f.x1, f.y1, shade(color, brightness(rand)));
    speckle(ctx, rand, f, 110);
  }
  // A raked bed joint sits in the shadow of the block above it.
  for (let y = BLOCK_HEIGHT; y <= TILE_INCHES; y += BLOCK_HEIGHT) lapShadow(ctx, y + MORTAR_JOINT / 2, JOINT_SHADOW);
}

function drawScreen(ctx: Ctx): void {
  ctx.clearRect(0, 0, TEXTURE_PX, TEXTURE_PX);
  // Translucent dark grey, with 1 px wires every 2 px each way over it.
  ctx.fillStyle = 'rgba(52, 56, 56, 0.55)';
  ctx.fillRect(0, 0, TEXTURE_PX, TEXTURE_PX);
  ctx.fillStyle = 'rgba(28, 30, 30, 0.5)';
  for (let p = 0; p < TEXTURE_PX; p += SCREEN_MESH_PX) {
    ctx.fillRect(p, 0, 1, TEXTURE_PX);
    ctx.fillRect(0, p, TEXTURE_PX, 1);
  }
}

/** A tile texture over a canvas: repeating, one repeat per 48" of inch UVs, mipmapped. */
function tileTexture(canvas: HTMLCanvasElement, colorSpace: ColorSpace): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = colorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  // UVs are in inches: one repeat covers one 48" tile.
  tex.repeat.set(1 / TILE_INCHES, 1 / TILE_INCHES);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function tileCanvas(): { canvas: HTMLCanvasElement; ctx: Ctx } | null {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_PX;
  canvas.height = TEXTURE_PX;
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

const normalCache = new Map<WallFinish, CanvasTexture | null>();

/** The normal map of a finish (the relief does not depend on the colour), made once. */
function normalTexture(finish: WallFinish): CanvasTexture | null {
  const hit = normalCache.get(finish);
  if (hit !== undefined) return hit;
  const height = sidingHeight(finish);
  const tile = height ? tileCanvas() : null;
  let tex: CanvasTexture | null = null;
  if (height && tile) {
    const img = tile.ctx.createImageData(TEXTURE_PX, TEXTURE_PX);
    normalFromHeight(height, TEXTURE_PX, PX_PER_INCH, img.data);
    tile.ctx.putImageData(img, 0, 0);
    // Directions, not colours: no colour space conversion.
    tex = tileTexture(tile.canvas, NoColorSpace);
  }
  normalCache.set(finish, tex);
  return tex;
}

/** A finish's colour texture and (for finishes with relief) its normal map, which share the tile's wrap and repeat. */
export interface SidingTextures {
  map: CanvasTexture;
  normalMap: CanvasTexture | null;
}

const cache = new Map<string, SidingTextures | null>();

/**
 * The siding textures for a finish and colour, generated once and cached together. The `new`
 * variant is the same drawing blended 50% toward NEW_WORK_GREEN per pixel (the relief is the
 * same). Null for `plain` (a flat colour needs no texture) and wherever there is no DOM canvas
 * (node).
 */
export function sidingTextures(finish: WallFinish, color: string, variant: TextureVariant = 'plain'): SidingTextures | null {
  if (finish === 'plain' || typeof document === 'undefined') return null;
  const key = `${finish}|${color}|${variant}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const tile = tileCanvas();
  if (!tile) {
    cache.set(key, null);
    return null;
  }
  const { canvas, ctx } = tile;
  if (finish === 'clapboard') drawClapboard(ctx, color);
  else if (finish === 'shingle') drawShingle(ctx, color);
  else if (finish === 'board') drawBoard(ctx, color);
  else if (finish === 'block') drawBlock(ctx, color);
  else drawScreen(ctx);
  if (variant === 'new') {
    const img = ctx.getImageData(0, 0, TEXTURE_PX, TEXTURE_PX);
    blendPixels(img.data, hexToRgb(NEW_WORK_GREEN), NEW_WORK_BLEND);
    ctx.putImageData(img, 0, 0);
  }
  const out = { map: tileTexture(canvas, SRGBColorSpace), normalMap: normalTexture(finish) };
  cache.set(key, out);
  return out;
}

/** The colour texture alone (sidingTextures' map), or null. */
export const sidingTexture = (finish: WallFinish, color: string, variant: TextureVariant = 'plain'): CanvasTexture | null =>
  sidingTextures(finish, color, variant)?.map ?? null;
