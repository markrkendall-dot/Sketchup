import { CanvasTexture, Color, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import type { WallFinish } from '../model/types';

// Procedural siding textures (DESIGN.md "Exterior appearance"). One 256 x 256 canvas stands for
// 48" x 48" of wall, so a texel is 3/16". Wall geometry carries UVs in inches (meshes.ts
// addWallUVs) and the texture repeats every 48", so courses run level and continuous across wall
// pieces and openings. The layout maths below is pure (testable in node); only drawing needs a
// canvas, and `sidingTexture` returns null where there is no `document` (node, tests).

/** Pixels per side of a texture tile. */
export const TEXTURE_PX = 256;
/** Inches of wall one tile covers. */
export const TILE_INCHES = 48;
export const PX_PER_INCH = TEXTURE_PX / TILE_INCHES;

/** Course height of clapboard, inches. */
export const CLAPBOARD_COURSE = 6;
/**
 * Shingle courses: 5" does not divide the 48" tile, so a tile holds 10 courses of 4.8" (the tile
 * has to repeat seamlessly).
 */
export const SHINGLE_COURSES = 10;
export const BOARD_WIDTH = 8;
/** Mesh spacing of a screen, in pixels (1.5"). */
export const SCREEN_MESH_PX = 8;

/**
 * Boundaries of horizontal courses in a tile, from the bottom (0) to the top: 48" at 6" gives
 * [0, 6, ..., 48], 8 courses.
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

const cache = new Map<string, CanvasTexture | null>();

function shade(color: string, f: number): string {
  const c = new Color(color);
  c.r = Math.min(1, c.r * f);
  c.g = Math.min(1, c.g * f);
  c.b = Math.min(1, c.b * f);
  return `#${c.getHexString()}`;
}

type Ctx = CanvasRenderingContext2D;

/** Fill a rectangle given in tile inches, with y measured up from the tile's bottom. */
function rect(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, fill: string): void {
  const px0 = Math.round(x0 * PX_PER_INCH);
  const px1 = Math.round(x1 * PX_PER_INCH);
  // Canvas y grows downward; the texture's v = 0 is the canvas bottom (flipY).
  const py0 = TEXTURE_PX - Math.round(y1 * PX_PER_INCH);
  const py1 = TEXTURE_PX - Math.round(y0 * PX_PER_INCH);
  ctx.fillStyle = fill;
  ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
}

function drawClapboard(ctx: Ctx, color: string): void {
  const rand = seeded(11);
  const b = courseBoundaries(TILE_INCHES, CLAPBOARD_COURSE);
  for (let k = 0; k + 1 < b.length; k++) {
    rect(ctx, 0, b[k], TILE_INCHES, b[k + 1], shade(color, brightness(rand)));
    // 1 px shadow line under the board above's lap: the bottom row of the course.
    const row = TEXTURE_PX - Math.round(b[k] * PX_PER_INCH) - 1;
    ctx.fillStyle = shade(color, 0.55);
    ctx.fillRect(0, row, TEXTURE_PX, 1);
  }
}

function drawShingle(ctx: Ctx, color: string): void {
  const b = courseBoundaries(TILE_INCHES, TILE_INCHES / SHINGLE_COURSES);
  for (let k = 0; k + 1 < b.length; k++) {
    const rand = seeded(k * 131 + 5);
    const joints = shingleJoints(k, TILE_INCHES, rand);
    for (let j = 0; j < joints.length; j++) {
      const x0 = joints[j];
      const x1 = j + 1 < joints.length ? joints[j + 1] : TILE_INCHES + joints[0];
      // The last shingle wraps round the tile edge: draw it in two parts.
      const parts: [number, number][] = x1 > TILE_INCHES ? [[x0, TILE_INCHES], [0, x1 - TILE_INCHES]] : [[x0, x1]];
      const fill = shade(color, brightness(rand));
      parts.forEach(([p, q], i) => {
        rect(ctx, p, b[k], q, b[k + 1], fill);
        if (i > 0) return; // the wrapped part continues the same shingle: no joint at the tile edge
        // Vertical joint: 1 px, darker, at the left of the shingle.
        const col = Math.round(p * PX_PER_INCH) % TEXTURE_PX;
        ctx.fillStyle = shade(color, 0.6);
        ctx.fillRect(col, TEXTURE_PX - Math.round(b[k + 1] * PX_PER_INCH), 1, Math.round(b[k + 1] * PX_PER_INCH) - Math.round(b[k] * PX_PER_INCH));
      });
    }
    const row = TEXTURE_PX - Math.round(b[k] * PX_PER_INCH) - 1;
    ctx.fillStyle = shade(color, 0.55);
    ctx.fillRect(0, row, TEXTURE_PX, 1);
  }
}

function drawBoard(ctx: Ctx, color: string): void {
  const rand = seeded(29);
  const b = courseBoundaries(TILE_INCHES, BOARD_WIDTH);
  for (let k = 0; k + 1 < b.length; k++) {
    rect(ctx, b[k], 0, b[k + 1], TILE_INCHES, shade(color, brightness(rand)));
    ctx.fillStyle = shade(color, 0.55);
    ctx.fillRect(Math.round(b[k] * PX_PER_INCH), 0, 1, TEXTURE_PX);
  }
}

function drawScreen(ctx: Ctx): void {
  ctx.clearRect(0, 0, TEXTURE_PX, TEXTURE_PX);
  ctx.fillStyle = 'rgba(110, 120, 115, 0.55)';
  ctx.fillRect(0, 0, TEXTURE_PX, TEXTURE_PX);
  ctx.fillStyle = '#3a3d3c';
  for (let p = 0; p < TEXTURE_PX; p += SCREEN_MESH_PX) {
    ctx.fillRect(p, 0, 1, TEXTURE_PX);
    ctx.fillRect(0, p, TEXTURE_PX, 1);
  }
}

/**
 * The siding texture for a finish and colour, generated once and cached. The `new` variant is the
 * same drawing blended 50% toward NEW_WORK_GREEN per pixel. Null for `plain` (a flat colour needs
 * no texture) and wherever there is no DOM canvas (node).
 */
export function sidingTexture(finish: WallFinish, color: string, variant: TextureVariant = 'plain'): CanvasTexture | null {
  if (finish === 'plain' || typeof document === 'undefined') return null;
  const key = `${finish}|${color}|${variant}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_PX;
  canvas.height = TEXTURE_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    cache.set(key, null);
    return null;
  }
  if (finish === 'clapboard') drawClapboard(ctx, color);
  else if (finish === 'shingle') drawShingle(ctx, color);
  else if (finish === 'board') drawBoard(ctx, color);
  else drawScreen(ctx);
  if (variant === 'new') {
    const img = ctx.getImageData(0, 0, TEXTURE_PX, TEXTURE_PX);
    blendPixels(img.data, hexToRgb(NEW_WORK_GREEN), NEW_WORK_BLEND);
    ctx.putImageData(img, 0, 0);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  // UVs are in inches: one repeat covers one 48" tile.
  tex.repeat.set(1 / TILE_INCHES, 1 / TILE_INCHES);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}
