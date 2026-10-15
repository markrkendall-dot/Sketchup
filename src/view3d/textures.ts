import { CanvasTexture, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace, type ColorSpace } from 'three';
import { CHECK_GROUND, DEFAULT_WEATHERING, ROOF_TILE } from '../model/finish';
import type { RoofFinish, Vec2, WallFinish } from '../model/types';

// Procedural siding textures (DESIGN.md "Exterior appearance"). One 512 x 512 canvas stands for
// 48" x 48" of wall, so a texel is 3/32". Wall geometry carries UVs in inches (meshes.ts
// addWallUVs) and the texture repeats every 48", so courses run level and continuous across wall
// pieces and openings. Every finish with relief (laps, shingle butts and keyways, V-grooves,
// mortar joints, fieldstone, river-stone and half-log crowns) also has a height field in inches, turned into a normal map. The layouts, the
// height fields and the normal-map rule are pure (testable in node); only drawing needs a canvas,
// and `sidingTextures` returns null where there is no `document` (node, tests). A chimney's brick
// (`brickTextures`) uses the same tile. Roof textures (corrugated metal, asphalt shingle) follow at
// the end, on a 24" x 48" tile (`roofTexture`).

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
/** Modular brick (a chimney's shaft): a course every 2 2/3" (three to 8"), 8" long, joints included. */
export const BRICK_COURSE = 8 / 3;
export const BRICK_LENGTH = 8;
/**
 * Fieldstone: 6 courses to the tile (8" on average), stones 6" to 14" long, at least 3/4" of mortar
 * between them.
 */
export const STONE_COURSES = 6;
export const STONE_WIDTH = { min: 6, max: 14 } as const;
export const STONE_JOINT = 0.75;
/**
 * The tones fieldstone is mixed toward, STONE_TONE_MIX of the way from the wall's colour: grey,
 * blue-grey, tan and brown.
 */
export const STONE_TONES = ['#8c8c88', '#7d838a', '#9a8468', '#6f5a48'] as const;
export const STONE_TONE_MIX = 0.35;
/**
 * River stone (a dry-stacked knee wall): rough courses 3" to 6" high, stones 4" to 10" long in them,
 * at least 3/8" of dark, deep joint between them.
 */
export const RIVERSTONE_HEIGHT = { min: 3, max: 6 } as const;
export const RIVERSTONE_WIDTH = { min: 4, max: 10 } as const;
export const RIVERSTONE_JOINT = 0.375;
/** Up to this much more gap on each side of a river stone, so the joints vary. */
export const RIVERSTONE_JITTER = 0.25;
/**
 * The natural tones of river stone: grey, tan, blue-grey and rust. A stone is its tone with the
 * wall's colour mixed in by RIVERSTONE_TINT, so the stones keep their own colours.
 */
export const RIVERSTONE_TONES = ['#8d8b86', '#a3957d', '#79828a', '#8c6a55'] as const;
export const RIVERSTONE_TINT = 0.15;
/** The shadowed gaps of a dry stack: near black. */
export const RIVERSTONE_GAP = '#1f1c1a';
/** Half-log siding: 8" courses (6 per tile), a 3/4" chink line between logs. */
export const HALFLOG_COURSE = 8;
export const CHINK = 0.75;
/** Wire spacing of a screen, in pixels (3/16"): 1 px wires every 2 px. */
export const SCREEN_MESH_PX = 2;

/**
 * Relief in inches: a clapboard's lap step, a shingle's butt, a keyway, a V-groove, a raked mortar
 * joint, a fieldstone's crown, a river stone's dome and the depth of the gaps between them, a half
 * log's crown.
 */
export const RELIEF = { lap: 0.6, butt: 0.4, keyway: 0.3, groove: 0.2, mortar: 0.25, stone: 0.6, river: 1, gap: 0.6, log: 1.2 } as const;
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
 * Vertical joint positions of one shingle course across the tile: widths of `min` to `max` (4" to
 * 8" for cedar shingles) that sum to exactly `tile`, starting at a course-dependent offset so the
 * joints stagger. Returns the joint positions in [0, tile), ascending (the first is the tile's left
 * edge, 0).
 */
export function shingleJoints(course: number, tile = TILE_INCHES, rand: () => number = seeded(course * 7919 + 13), min = 4, max = 8): number[] {
  const widths: number[] = [];
  let left = tile;
  while (left > max) {
    // Leave at least `min` for the rest.
    const top = Math.min(max, left - min);
    const w = min + rand() * (top - min);
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

/** Painted engineered shakes: 7 courses to the tile (a 6 6/7" exposure), shakes 6" to 12" wide. */
export const SHAKE_COURSES = 7;
export const SHAKE_WIDTH = { min: 6, max: 12 } as const;

/**
 * The shake courses of a tile, bottom to top: staggered joints like shingles but wider and more
 * even, and painted, so each shake is within a couple of percent of the colour, with no warmth and
 * no lift (engineered panels lie flat).
 */
export function shakeCourses(): ShingleCourse[] {
  const b = courseBoundaries(TILE_INCHES, TILE_INCHES / SHAKE_COURSES);
  const out: ShingleCourse[] = [];
  for (let k = 0; k + 1 < b.length; k++) {
    const rand = seeded(k * 197 + 11);
    const joints = shingleJoints(k, TILE_INCHES, rand, SHAKE_WIDTH.min, SHAKE_WIDTH.max);
    const shingles = joints.map((x0, j) => ({
      x0,
      x1: j + 1 < joints.length ? joints[j + 1] : TILE_INCHES + joints[0],
      shade: 0.98 + rand() * 0.04,
      warmth: 0,
      lift: 0,
    }));
    out.push({ y0: b[k], y1: b[k + 1], shingles });
  }
  return out;
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
 * The faces of the units of a running bond over a tile: courses `height` apart, units `length` long
 * (each with its share of a MORTAR_JOINT), every other course shifted by half a unit, each face inset
 * by half a joint all round; the last unit of a shifted course wraps round the tile's edge. Mortar is
 * the rest.
 */
function runningBond(height: number, length: number): TileRect[] {
  const m = MORTAR_JOINT / 2;
  const out: TileRect[] = [];
  const courses = Math.round(TILE_INCHES / height);
  const perCourse = Math.round(TILE_INCHES / length);
  for (let k = 0; k < courses; k++) {
    const shift = (k % 2) * (length / 2);
    for (let j = 0; j < perCourse; j++) {
      const x = shift + j * length;
      out.push({ x0: x + m, y0: k * height + m, x1: x + length - m, y1: (k + 1) * height - m });
    }
  }
  return out;
}

/** The face of each half log in a tile: 6 courses of 8", less a CHINK line centred on each course line. */
export const halflogFaces = (): TileRect[] =>
  courseBoundaries(TILE_INCHES, HALFLOG_COURSE)
    .slice(0, -1)
    .map((y) => ({ x0: 0, y0: y + CHINK / 2, x1: TILE_INCHES, y1: y + HALFLOG_COURSE - CHINK / 2 }));

/** The faces of the concrete blocks in a tile: 6 courses of 3 blocks in running bond. */
export const blockFaces = (): TileRect[] => runningBond(BLOCK_HEIGHT, BLOCK_LENGTH);

/** The faces of the bricks in a tile (a chimney): 18 courses of 6 bricks in running bond. */
export const brickFaces = (): TileRect[] => runningBond(BRICK_COURSE, BRICK_LENGTH);

/** One fieldstone: its box in tile inches (x1 may pass the tile's right edge: it wraps) and its looks. */
export interface Stone extends TileRect {
  /** Superellipse exponent of its outline: 2 an ellipse, higher squarer. */
  p: number;
  /** Index into STONE_TONES. */
  tone: number;
  /** Brightness factor, 0.8 to 1.15. */
  shade: number;
}

/**
 * The fieldstones of a tile: STONE_COURSES courses, each cut into stones STONE_WIDTH long that sum
 * to the tile and stagger from course to course (shingleJoints); each stone inset by half a joint
 * all round and by up to 1 1/4" more top and bottom, so the courses wander, with its own roundness,
 * tone and brightness. Seeded, so the same every time.
 */
export function stoneFaces(): Stone[] {
  const rand = seeded(61);
  const m = STONE_JOINT / 2;
  const course = TILE_INCHES / STONE_COURSES;
  const out: Stone[] = [];
  for (let k = 0; k < STONE_COURSES; k++) {
    const joints = shingleJoints(k, TILE_INCHES, rand, STONE_WIDTH.min, STONE_WIDTH.max);
    joints.forEach((x, j) => {
      const next = j + 1 < joints.length ? joints[j + 1] : joints[0] + TILE_INCHES;
      out.push({
        x0: x + m,
        x1: next - m,
        y0: k * course + m + rand() * 1.25,
        y1: (k + 1) * course - m - rand() * 1.25,
        p: 2.2 + rand() * 1.3,
        tone: Math.floor(rand() * STONE_TONES.length),
        shade: 0.8 + rand() * 0.35,
      });
    });
  }
  return out;
}

/**
 * The river stones of a tile: rough courses RIVERSTONE_HEIGHT high that sum to the tile, each cut
 * into stones RIVERSTONE_WIDTH long that sum to it (both by shingleJoints, so they stagger and
 * wrap); each stone inset by half a joint all round and by up to 1/4" more on each side, so the
 * gaps vary, its outline a rounded box (squarer than an ellipse, so the stones sit close as in a
 * stack), with its own tone and brightness. Seeded, so the same every
 * time.
 */
export function riverstoneFaces(): Stone[] {
  const rand = seeded(83);
  const m = RIVERSTONE_JOINT / 2;
  const rows = shingleJoints(0, TILE_INCHES, rand, RIVERSTONE_HEIGHT.min, RIVERSTONE_HEIGHT.max);
  const out: Stone[] = [];
  rows.forEach((y, k) => {
    const top = k + 1 < rows.length ? rows[k + 1] : rows[0] + TILE_INCHES;
    const joints = shingleJoints(k, TILE_INCHES, rand, RIVERSTONE_WIDTH.min, RIVERSTONE_WIDTH.max);
    joints.forEach((x, j) => {
      const next = j + 1 < joints.length ? joints[j + 1] : joints[0] + TILE_INCHES;
      out.push({
        x0: x + m + rand() * RIVERSTONE_JITTER,
        x1: next - m - rand() * RIVERSTONE_JITTER,
        y0: y + m + rand() * RIVERSTONE_JITTER,
        y1: top - m - rand() * RIVERSTONE_JITTER,
        p: 2.6 + rand() * 1.0,
        tone: Math.floor(rand() * RIVERSTONE_TONES.length),
        shade: 0.78 + rand() * 0.4,
      });
    });
  });
  return out;
}

/** How far a point of a stone's box (fractions across and up, 0 to 1) is from its middle: under 1 inside the stone. */
export const stoneDistance = (s: Pick<Stone, 'p'>, fx: number, fy: number): number => (Math.abs(2 * fx - 1) ** s.p + Math.abs(2 * fy - 1) ** s.p) ** (1 / s.p);

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
 * shingles. Board: a V-groove at each joint. Block: flat faces, raked mortar joints. Stone: each
 * stone a dome RELIEF.stone high in raked mortar. River stone: each stone a round dome RELIEF.river
 * high, the gaps RELIEF.gap deep. Half-log: each log a round crown RELIEF.log high,
 * a raked chink line between logs.
 */
export function sidingHeight(finish: WallFinish): Float32Array | null {
  const f = new Float32Array(TEXTURE_PX * TEXTURE_PX);
  if (finish === 'clapboard') {
    const b = courseBoundaries(TILE_INCHES, CLAPBOARD_COURSE);
    for (let k = 0; k + 1 < b.length; k++) heightRect(f, { x0: 0, y0: b[k], x1: TILE_INCHES, y1: b[k + 1] }, (_, fy) => RELIEF.lap * (1 - fy));
  } else if (finish === 'shingle' || finish === 'shake') {
    const courses = finish === 'shake' ? shakeCourses() : shingleCourses();
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
  } else if (finish === 'stone') {
    f.fill(-RELIEF.mortar);
    for (const s of stoneFaces()) {
      heightRect(f, s, (fx, fy) => {
        const d = stoneDistance(s, fx, fy);
        return d < 1 ? RELIEF.stone * Math.sqrt(1 - d ** 4) : -RELIEF.mortar;
      });
    }
  } else if (finish === 'riverstone') {
    f.fill(-RELIEF.gap);
    for (const s of riverstoneFaces()) {
      heightRect(f, s, (fx, fy) => {
        const d = stoneDistance(s, fx, fy);
        return d < 1 ? RELIEF.river * Math.sqrt(1 - d * d) - RELIEF.gap * (1 - Math.sqrt(1 - d * d)) ** 4 : -RELIEF.gap;
      });
    }
  } else if (finish === 'halflog') {
    f.fill(-RELIEF.mortar);
    for (const r of halflogFaces()) heightRect(f, r, (_, fy) => RELIEF.log * Math.sqrt(1 - (2 * fy - 1) ** 2));
  } else return null;
  return f;
}

/**
 * The relief of a chimney's brick over one tile, inches in canvas order like sidingHeight: flat
 * faces, mortar joints raked RELIEF.mortar deep.
 */
export function brickHeight(): Float32Array {
  const f = new Float32Array(TEXTURE_PX * TEXTURE_PX);
  f.fill(-RELIEF.mortar);
  for (const r of brickFaces()) heightRect(f, r, () => 0);
  return f;
}

/**
 * A tangent-space normal map from a height field (row-major, canvas order, `size` x `size`), as
 * RGBA bytes. Sobel derivatives sample modulo the tile, so its seam has no line; `strength` turns
 * height units per pixel into slope (PX_PER_INCH for heights in inches gives the true slope).
 * Canvas y grows downward while the texture's v grows upward (flipY), so the normal is
 * (-k dh/dx, +k dh/dy, 1) normalized, stored as (n + 1) / 2: R = 0.5 - 0.5 k dh/dx and
 * G = 0.5 + 0.5 k dh/dy for gentle slopes. A step down the canvas (a lap's butt, higher above
 * lower) faces down: G below 128. Flat is (128, 128, 255). `strengthY` is the strength down the
 * canvas when a texel is not square (a roof tile stands for 24" across and 48" down).
 */
export function normalFromHeight(
  height: ArrayLike<number>,
  size: number,
  strength: number,
  out: Uint8ClampedArray = new Uint8ClampedArray(size * size * 4),
  strengthY: number = strength,
): Uint8ClampedArray {
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
      const ny = strengthY * dy;
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

/** How far mortar is lifted from the unit's colour toward a pale grey: well clear of a block, a little for a stained brick. */
const BLOCK_MORTAR = 0.45;
const BRICK_MORTAR = 0.18;

/** The mortar between blocks or bricks: their colour lifted toward a pale grey by `t`. */
function mortarColor(color: string, t: number): string {
  const [r, g, b] = hexToRgb(color);
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

/** Painted shakes: an even painted tone, a faint texture, dark keyways, a shadow under each butt. */
function drawShake(ctx: Ctx, color: string): void {
  const rand = seeded(31);
  const courses = shakeCourses();
  for (const c of courses) {
    for (const s of c.shingles) {
      rect(ctx, s.x0, c.y0, s.x1, c.y1, shade(color, s.shade));
      // Embossed grain, faint under the paint.
      grain(ctx, rand, 'y', { x0: s.x0, y0: c.y0, x1: s.x1, y1: c.y1 }, Math.round((s.x1 - s.x0) * 0.6));
    }
    ctx.fillStyle = shade(color, 0.6);
    for (const s of c.shingles) {
      const c0 = colOf(s.x0 - SHINGLE_KEYWAY / 2);
      pixelRect(ctx, c0, rowOf(c.y1), Math.max(1, colOf(s.x0 + SHINGLE_KEYWAY / 2) - c0), rowOf(c.y0) - rowOf(c.y1));
    }
  }
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
  ctx.fillStyle = mortarColor(color, BLOCK_MORTAR);
  ctx.fillRect(0, 0, TEXTURE_PX, TEXTURE_PX);
  speckle(ctx, rand, tile, 900);
  for (const f of blockFaces()) {
    rect(ctx, f.x0, f.y0, f.x1, f.y1, shade(color, brightness(rand)));
    speckle(ctx, rand, f, 110);
  }
  // A raked bed joint sits in the shadow of the block above it.
  for (let y = BLOCK_HEIGHT; y <= TILE_INCHES; y += BLOCK_HEIGHT) lapShadow(ctx, y + MORTAR_JOINT / 2, JOINT_SHADOW);
}

/**
 * Fieldstone in mortar: the mortar lighter than the stone, speckled; each stone (stoneFaces) its own
 * mix of the colour and one of STONE_TONES, painted pixel by pixel through the same outline as its
 * relief (stoneDistance), darker toward its rim so it reads as rounded, with a little speckle.
 */
function drawStone(ctx: Ctx, color: string): void {
  const rand = seeded(67);
  const tile = { x0: 0, y0: 0, x1: TILE_INCHES, y1: TILE_INCHES };
  ctx.fillStyle = mortarColor(color, BLOCK_MORTAR);
  ctx.fillRect(0, 0, TEXTURE_PX, TEXTURE_PX);
  speckle(ctx, rand, tile, 1200);
  const stones = stoneFaces();
  const img = ctx.getImageData(0, 0, TEXTURE_PX, TEXTURE_PX);
  for (const s of stones) {
    const [r, g, b] = hexToRgb(mix(color, STONE_TONES[s.tone], STONE_TONE_MIX));
    const c0 = colOf(s.x0);
    const c1 = colOf(s.x1);
    const top = rowOf(s.y1);
    const bottom = rowOf(s.y0);
    for (let row = top; row < bottom; row++) {
      const fy = (bottom - row - 0.5) / (bottom - top);
      for (let c = c0; c < c1; c++) {
        const d = stoneDistance(s, (c - c0 + 0.5) / (c1 - c0), fy);
        if (d >= 1) continue;
        const k = s.shade * (0.72 + 0.28 * Math.sqrt(1 - d * d));
        const i = (wrap(row, TEXTURE_PX) * TEXTURE_PX + wrap(c, TEXTURE_PX)) * 4;
        img.data[i] = byte(r * k);
        img.data[i + 1] = byte(g * k);
        img.data[i + 2] = byte(b * k);
        img.data[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  for (const s of stones) speckle(ctx, rand, { x0: s.x0 + 1, y0: s.y0 + 1, x1: s.x1 - 1, y1: s.y1 - 1 }, Math.round((s.x1 - s.x0) * (s.y1 - s.y0) * 0.6));
}

/**
 * Dry-stacked river stone: near-black gaps (RIVERSTONE_GAP); each stone (riverstoneFaces) one of
 * RIVERSTONE_TONES with a little of the colour, painted pixel by pixel through the same outline as
 * its relief, lit from above (lighter toward its top, darker toward its foot) and darker toward its
 * rim so it reads as a smooth, water-worn dome, with a little speckle.
 */
function drawRiverstone(ctx: Ctx, color: string): void {
  const rand = seeded(89);
  ctx.fillStyle = mix(RIVERSTONE_GAP, color, 0.1);
  ctx.fillRect(0, 0, TEXTURE_PX, TEXTURE_PX);
  const stones = riverstoneFaces();
  const img = ctx.getImageData(0, 0, TEXTURE_PX, TEXTURE_PX);
  for (const s of stones) {
    const [r, g, b] = hexToRgb(mix(RIVERSTONE_TONES[s.tone], color, RIVERSTONE_TINT));
    const c0 = colOf(s.x0);
    const c1 = colOf(s.x1);
    const top = rowOf(s.y1);
    const bottom = rowOf(s.y0);
    for (let row = top; row < bottom; row++) {
      const fy = (bottom - row - 0.5) / (bottom - top);
      for (let c = c0; c < c1; c++) {
        const d = stoneDistance(s, (c - c0 + 0.5) / (c1 - c0), fy);
        if (d >= 1) continue;
        const k = s.shade * (0.55 + 0.45 * Math.sqrt(1 - d * d)) * (0.9 + 0.2 * fy);
        const i = (wrap(row, TEXTURE_PX) * TEXTURE_PX + wrap(c, TEXTURE_PX)) * 4;
        img.data[i] = byte(r * k);
        img.data[i + 1] = byte(g * k);
        img.data[i + 2] = byte(b * k);
        img.data[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  for (const s of stones) speckle(ctx, rand, { x0: s.x0 + 1, y0: s.y0 + 1, x1: s.x1 - 1, y1: s.y1 - 1 }, Math.round((s.x1 - s.x0) * (s.y1 - s.y0) * 0.8));
}

/**
 * Bark-on half logs: each course a few percent lighter or darker, shaded row by row toward its top
 * and bottom (the round of the log), heavy streaks of bark along it and speckle; a dark chink line
 * between logs, in the shadow of the log above.
 */
function drawHalflog(ctx: Ctx, color: string): void {
  const rand = seeded(71);
  ctx.fillStyle = shade(color, 0.3);
  ctx.fillRect(0, 0, TEXTURE_PX, TEXTURE_PX);
  for (const r of halflogFaces()) {
    const base = brightness(rand);
    const top = rowOf(r.y1);
    const bottom = rowOf(r.y0);
    for (let row = top; row < bottom; row++) {
      const fy = (bottom - row - 0.5) / (bottom - top);
      ctx.fillStyle = shade(color, base * (0.62 + 0.38 * Math.sqrt(1 - (2 * fy - 1) ** 2)));
      pixelRect(ctx, 0, row, TEXTURE_PX, 1);
    }
    grain(ctx, rand, 'x', r, 420);
    speckle(ctx, rand, r, 900);
  }
  for (const r of halflogFaces()) lapShadow(ctx, r.y0, JOINT_SHADOW);
}

function drawBrick(ctx: Ctx, color: string): void {
  const rand = seeded(53);
  const tile = { x0: 0, y0: 0, x1: TILE_INCHES, y1: TILE_INCHES };
  // Mortar a little lighter than the brick (a stained chimney is near one colour), then each brick a
  // few percent lighter or darker, a little warmer or cooler, with a few pores.
  ctx.fillStyle = mortarColor(color, BRICK_MORTAR);
  ctx.fillRect(0, 0, TEXTURE_PX, TEXTURE_PX);
  speckle(ctx, rand, tile, 700);
  for (const f of brickFaces()) {
    rect(ctx, f.x0, f.y0, f.x1, f.y1, shade(color, brightness(rand), rand() * 2 - 1));
    speckle(ctx, rand, f, 24);
  }
  // A raked bed joint sits in the shadow of the brick above it.
  const courses = Math.round(TILE_INCHES / BRICK_COURSE);
  for (let k = 1; k <= courses; k++) lapShadow(ctx, k * BRICK_COURSE + MORTAR_JOINT / 2, JOINT_SHADOW);
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

/**
 * A tile texture over a canvas: repeating, mipmapped. `repeat` 1/48 for siding (UVs in inches, one
 * repeat per 48" tile); roof UVs are in tiles already (meshes.ts addRoofUVs), so roofs use 1.
 */
export function tileTexture(canvas: HTMLCanvasElement, colorSpace: ColorSpace, repeat = 1 / TILE_INCHES): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = colorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function tileCanvas(): { canvas: HTMLCanvasElement; ctx: Ctx } | null {
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
  else if (finish === 'shake') drawShake(ctx, color);
  else if (finish === 'board') drawBoard(ctx, color);
  else if (finish === 'block') drawBlock(ctx, color);
  else if (finish === 'stone') drawStone(ctx, color);
  else if (finish === 'riverstone') drawRiverstone(ctx, color);
  else if (finish === 'halflog') drawHalflog(ctx, color);
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

/** The brick's normal map (the relief does not depend on the colour): undefined until made, null without a canvas. */
let brickNormal: CanvasTexture | null | undefined;
const brickCache = new Map<string, SidingTextures | null>();

/**
 * A chimney's brick (DESIGN.md "Exterior appearance"): 2 2/3" x 8" running bond in `color`, the
 * mortar a little lighter, on the siding's tile (512 px for 48", `repeat` 1/48: the column's UVs are
 * in inches, meshes.ts addBoxUVs), with the normal map of the raked joints. Made once per colour,
 * the normal map once. Null wherever there is no DOM canvas (node), where the material shows the
 * flat colour.
 */
export function brickTextures(color: string): SidingTextures | null {
  if (typeof document === 'undefined') return null;
  const hit = brickCache.get(color);
  if (hit !== undefined) return hit;
  const tile = tileCanvas();
  if (!tile) {
    brickCache.set(color, null);
    return null;
  }
  drawBrick(tile.ctx, color);
  if (brickNormal === undefined) {
    const n = tileCanvas();
    brickNormal = null;
    if (n) {
      const img = n.ctx.createImageData(TEXTURE_PX, TEXTURE_PX);
      normalFromHeight(brickHeight(), TEXTURE_PX, PX_PER_INCH, img.data);
      n.ctx.putImageData(img, 0, 0);
      // Directions, not colours: no colour space conversion.
      brickNormal = tileTexture(n.canvas, NoColorSpace);
    }
  }
  const out = { map: tileTexture(tile.canvas, SRGBColorSpace), normalMap: brickNormal };
  brickCache.set(color, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Interior finishes (DESIGN.md "Interior finishes"): the walls and floors rooms dress, on the
// siding's 48" tile (UVs in inches: a wall face's like the siding's, a floor's along the room's
// longer side). Paint and a plain floor are flat colours and need none.

/** A check wallpaper's squares, inches: 48 to the tile. */
export const CHECK_INCHES = 1;
/** Knotty pine boards, inches wide: 8 to the tile. */
export const PINE_BOARD = 6;
/** Floor boards, inches wide: 16 rows to the tile, running along u. */
export const FLOOR_BOARD = 3;
/** Wide pine floor boards, inches wide: 8 rows to the tile, face-nailed into joists every 16". */
export const WIDE_PINE_BOARD = 6;
export const JOIST_SPACING = 16;
/** A cut nail's square head, inches, and its distance in from a board's edge and end. */
export const NAIL_HEAD = 0.2;
export const NAIL_INSET = 1;
/** Floor tiles, inches square (16 to the tile), and the grout between them. */
export const FLOOR_TILE = 12;
export const GROUT = 0.125;
/** Parquet: 6" blocks of 4 slats, each block turned a quarter to its neighbours (basket weave). */
export const PARQUET_BLOCK = 6;
export const PARQUET_SLATS = 4;

/**
 * The tone of a check's square in column i and row j: 0 the ground, 1 a stripe (the colour at half
 * strength), 2 where two stripes cross (the full colour). Gingham.
 */
export const checkTone = (i: number, j: number): 0 | 1 | 2 => ((i & 1) + (j & 1)) as 0 | 1 | 2;

/**
 * Floor boards over a tile: rows FLOOR_BOARD wide along x, each cut into boards of 16" to 48" that
 * add up to the tile, the joints staggered from row to row (a board's x1 may pass the tile's right
 * edge: it wraps).
 */
export function floorBoards(rand: () => number = seeded(61), width: number = FLOOR_BOARD, wide = false): TileRect[] {
  const out: TileRect[] = [];
  const rows = Math.round(TILE_INCHES / width);
  for (let k = 0; k < rows; k++) {
    const shift = rand() * TILE_INCHES;
    // Wide pine: one board the tile's length in most rows (a single joint), else two.
    if (wide) {
      const cut = rand() < 0.6 ? [TILE_INCHES] : [20 + rand() * 8];
      if (cut[0] < TILE_INCHES) cut.push(TILE_INCHES - cut[0]);
      let x = 0;
      for (const len of cut) {
        out.push({ x0: shift + x, y0: k * width, x1: shift + x + len, y1: (k + 1) * width });
        x += len;
      }
      continue;
    }
    let x = 0;
    while (TILE_INCHES - x > 0) {
      const left = TILE_INCHES - x;
      const len = left <= 32 ? left : 16 + rand() * (Math.min(48, left - 16) - 16);
      out.push({ x0: shift + x, y0: k * width, x1: shift + x + len, y1: (k + 1) * width });
      x += len;
    }
  }
  return out;
}

/** Wide pine floor boards over a tile: WIDE_PINE_BOARD rows, mostly one board to the tile's length. */
export const widePineBoards = (): TileRect[] => floorBoards(seeded(89), WIDE_PINE_BOARD, true);

/**
 * The square heads of the cut nails in a tile of wide pine (inches, centres): two across each board
 * at every joist line (every JOIST_SPACING along x) and two at each end of a board, NAIL_INSET in
 * from its edges and end. Wrapped into the tile.
 */
export function widePineNails(): Vec2[] {
  const out: Vec2[] = [];
  const w = (v: number) => ((v % TILE_INCHES) + TILE_INCHES) % TILE_INCHES;
  for (const b of widePineBoards()) {
    const ys = [b.y0 + NAIL_INSET, b.y1 - NAIL_INSET];
    const xs = [b.x0 + NAIL_INSET, b.x1 - NAIL_INSET];
    for (let j = Math.ceil((b.x0 + 2 * NAIL_INSET) / JOIST_SPACING) * JOIST_SPACING; j < b.x1 - 2 * NAIL_INSET; j += JOIST_SPACING) xs.push(j);
    for (const x of xs) for (const y of ys) out.push({ x: w(x), y: w(y) });
  }
  return out;
}

/** The faces of the floor tiles in a tile, each inset by half the grout all round. */
export function tileGrid(): TileRect[] {
  const g = GROUT / 2;
  const n = Math.round(TILE_INCHES / FLOOR_TILE);
  const out: TileRect[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push({ x0: i * FLOOR_TILE + g, y0: j * FLOOR_TILE + g, x1: (i + 1) * FLOOR_TILE - g, y1: (j + 1) * FLOOR_TILE - g });
  return out;
}

/** The parquet's slats over a tile: in each block, PARQUET_SLATS of them along x or along y, alternating like a chequerboard. */
export function parquetSlats(): (TileRect & { along: 'x' | 'y' })[] {
  const n = Math.round(TILE_INCHES / PARQUET_BLOCK);
  const w = PARQUET_BLOCK / PARQUET_SLATS;
  const out: (TileRect & { along: 'x' | 'y' })[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i * PARQUET_BLOCK;
      const y = j * PARQUET_BLOCK;
      const along = (i + j) % 2 === 0 ? 'x' : 'y';
      for (let k = 0; k < PARQUET_SLATS; k++) {
        out.push(along === 'x' ? { x0: x, y0: y + k * w, x1: x + PARQUET_BLOCK, y1: y + (k + 1) * w, along } : { x0: x + k * w, y0: y, x1: x + (k + 1) * w, y1: y + PARQUET_BLOCK, along });
      }
    }
  }
  return out;
}

/** Interior finishes with a texture: a room's walls (painted boards, knotty pine, check) and floors (boards, tile, parquet). */
export type InteriorTexture = 'wall-boards' | 'wall-pine' | 'wall-check' | 'floor-boards' | 'floor-tile' | 'floor-parquet' | 'floor-pine' | 'floor-carpet';

/**
 * The relief of an interior finish over one tile, inches in canvas order like sidingHeight, or
 * null for one without (a check). Painted boards are the siding's board; pine the same V-groove
 * every 6"; floor boards a shallow groove along each row and at each board's end; tile recessed
 * grout; parquet a fine joint round each slat.
 */
export function interiorHeight(kind: InteriorTexture): Float32Array | null {
  if (kind === 'wall-boards') return sidingHeight('board');
  const f = new Float32Array(TEXTURE_PX * TEXTURE_PX);
  if (kind === 'wall-pine') {
    for (const x of courseBoundaries(TILE_INCHES, PINE_BOARD).slice(0, -1)) {
      heightRect(f, { x0: x - GROOVE_HALF, y0: 0, x1: x + GROOVE_HALF, y1: TILE_INCHES }, (fx) => -RELIEF.groove * (1 - Math.abs(2 * fx - 1)));
    }
  } else if (kind === 'floor-boards') {
    f.fill(-RELIEF.groove / 2);
    for (const b of floorBoards()) heightRect(f, { x0: b.x0 + 0.06, y0: b.y0 + 0.06, x1: b.x1 - 0.06, y1: b.y1 - 0.06 }, () => 0);
  } else if (kind === 'floor-pine') {
    f.fill(-RELIEF.groove / 2);
    for (const b of widePineBoards()) heightRect(f, { x0: b.x0 + 0.06, y0: b.y0 + 0.06, x1: b.x1 - 0.06, y1: b.y1 - 0.06 }, () => 0);
  } else if (kind === 'floor-tile') {
    f.fill(-RELIEF.mortar / 2);
    for (const t of tileGrid()) heightRect(f, t, () => 0);
  } else if (kind === 'floor-parquet') {
    f.fill(-RELIEF.groove / 2);
    for (const sl of parquetSlats()) heightRect(f, { x0: sl.x0 + 0.05, y0: sl.y0 + 0.05, x1: sl.x1 - 0.05, y1: sl.y1 - 0.05 }, () => 0);
  } else return null;
  return f;
}

/** `a` blended toward `b` by t, as `#rrggbb`. */
function mix(a: string, b: string, t: number): string {
  const p = hexToRgb(a);
  const q = hexToRgb(b);
  return `#${p.map((v, i) => byte(v + (q[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

function drawCheck(ctx: Ctx, color: string): void {
  const n = Math.round(TILE_INCHES / CHECK_INCHES);
  const tones = [CHECK_GROUND, mix(CHECK_GROUND, color, 0.5), color];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) rect(ctx, i * CHECK_INCHES, j * CHECK_INCHES, (i + 1) * CHECK_INCHES, (j + 1) * CHECK_INCHES, tones[checkTone(i, j)]);
  }
  // The paper's faint texture.
  speckle(ctx, seeded(67), { x0: 0, y0: 0, x1: TILE_INCHES, y1: TILE_INCHES }, 1500);
}

/** Vertical boards with knots: each board a little lighter or darker, grain along it, a few dark knots, a V-groove at each joint. */
function drawPine(ctx: Ctx, color: string): void {
  const rand = seeded(71);
  const b = courseBoundaries(TILE_INCHES, PINE_BOARD);
  for (let k = 0; k + 1 < b.length; k++) {
    const board = { x0: b[k], y0: 0, x1: b[k + 1], y1: TILE_INCHES };
    rect(ctx, board.x0, board.y0, board.x1, board.y1, shade(color, brightness(rand), rand() * 2 - 1));
    grain(ctx, rand, 'y', board, 70);
    const knots = Math.floor(rand() * 3);
    for (let i = 0; i < knots; i++) {
      const r = (0.3 + rand() * 0.5) * PX_PER_INCH;
      const cx = colOf(board.x0 + 1 + rand() * (PINE_BOARD - 2));
      const cy = rowOf(rand() * TILE_INCHES);
      ctx.fillStyle = shade(color, 0.55);
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade(color, 0.35);
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.45, r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (let k = 0; k + 1 < b.length; k++) {
    const c = colOf(b[k]) - Math.floor(GROOVE_SHADOW.length / 2);
    GROOVE_SHADOW.forEach((a, i) => {
      ctx.fillStyle = `rgba(0, 0, 0, ${a})`;
      pixelRect(ctx, c + i, 0, 1, TEXTURE_PX);
    });
  }
}

/** Painted floor boards along x, joints dark at each board's end and along each row. */
function drawFloorBoards(ctx: Ctx, color: string): void {
  const rand = seeded(73);
  for (const bd of floorBoards()) {
    rect(ctx, bd.x0, bd.y0, bd.x1, bd.y1, shade(color, 0.96 + rand() * 0.08));
    grain(ctx, rand, 'x', bd, 10);
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  for (const bd of floorBoards()) {
    pixelRect(ctx, 0, rowOf(bd.y1), TEXTURE_PX, 1);
    pixelRect(ctx, colOf(bd.x0), rowOf(bd.y1), 1, rowOf(bd.y0) - rowOf(bd.y1));
  }
}

/**
 * Wide whitewashed pine: 6" boards a shade apart along x, fine grain and a few small grey knots,
 * dark joints, and the old square heads of the cut nails, two across each board at every joist and
 * at its ends.
 */
function drawWidePine(ctx: Ctx, color: string): void {
  const rand = seeded(97);
  const boards = widePineBoards();
  for (const bd of boards) {
    rect(ctx, bd.x0, bd.y0, bd.x1, bd.y1, shade(color, 0.95 + rand() * 0.08));
    grain(ctx, rand, 'x', bd, 40);
    const knots = rand() < 0.4 ? 1 : 0;
    for (let i = 0; i < knots; i++) {
      const r = (0.2 + rand() * 0.25) * PX_PER_INCH;
      ctx.fillStyle = shade(color, 0.72);
      ctx.beginPath();
      ctx.ellipse(colOf(bd.x0 + 2 + rand() * (bd.x1 - bd.x0 - 4)), rowOf(bd.y0 + 1.5 + rand() * (WIDE_PINE_BOARD - 3)), r * 1.6, r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  for (const bd of boards) {
    pixelRect(ctx, 0, rowOf(bd.y1), TEXTURE_PX, 1);
    pixelRect(ctx, colOf(bd.x0), rowOf(bd.y1), 1, rowOf(bd.y0) - rowOf(bd.y1));
  }
  const s = Math.max(2, Math.round(NAIL_HEAD * PX_PER_INCH));
  ctx.fillStyle = 'rgba(40, 34, 30, 0.85)';
  for (const n of widePineNails()) pixelRect(ctx, colOf(n.x) - Math.floor(s / 2), rowOf(n.y) - Math.floor(s / 2), s, s);
}

/** Carpet: the colour with a soft mottle and a dense speckle of loop tips, lighter and darker. */
function drawCarpet(ctx: Ctx, color: string): void {
  const rand = seeded(101);
  rect(ctx, 0, 0, TILE_INCHES, TILE_INCHES, color);
  for (let i = 0; i < 40; i++) {
    const x = rand() * TILE_INCHES;
    const y = rand() * TILE_INCHES;
    const r = 3 + rand() * 6;
    ctx.fillStyle = rand() < 0.5 ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.03)';
    ctx.beginPath();
    ctx.arc(colOf(x), rowOf(y), r * PX_PER_INCH, 0, Math.PI * 2);
    ctx.fill();
  }
  speckle(ctx, rand, { x0: 0, y0: 0, x1: TILE_INCHES, y1: TILE_INCHES }, 40000);
}

/** Square tiles a shade apart, with pale grout and a mottle like vinyl. */
function drawTile(ctx: Ctx, color: string): void {
  const rand = seeded(79);
  ctx.fillStyle = mix(color, '#9a958c', 0.35);
  ctx.fillRect(0, 0, TEXTURE_PX, TEXTURE_PX);
  for (const t of tileGrid()) {
    rect(ctx, t.x0, t.y0, t.x1, t.y1, shade(color, 0.97 + rand() * 0.06));
    speckle(ctx, rand, t, 260);
  }
}

/** Basket-weave parquet: each slat a shade, grain along it, a dark line round it. */
function drawParquet(ctx: Ctx, color: string): void {
  const rand = seeded(83);
  for (const sl of parquetSlats()) {
    rect(ctx, sl.x0, sl.y0, sl.x1, sl.y1, shade(color, brightness(rand), rand() * 2 - 1));
    grain(ctx, rand, sl.along, sl, 6);
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  for (const sl of parquetSlats()) {
    pixelRect(ctx, colOf(sl.x0), rowOf(sl.y1), colOf(sl.x1) - colOf(sl.x0), 1);
    pixelRect(ctx, colOf(sl.x0), rowOf(sl.y1), 1, rowOf(sl.y0) - rowOf(sl.y1));
  }
}

const interiorNormals = new Map<InteriorTexture, CanvasTexture | null>();
const interiorCache = new Map<string, SidingTextures | null>();

/**
 * The textures of an interior finish and colour (DESIGN.md "Interior finishes"), made once and
 * cached like sidingTextures: the drawing, its `new` variant blended toward NEW_WORK_GREEN, and the
 * normal map of the relief (boards, pine, floor boards, tile). Null wherever there is no DOM canvas.
 */
export function interiorTextures(kind: InteriorTexture, color: string, variant: TextureVariant = 'plain'): SidingTextures | null {
  if (typeof document === 'undefined') return null;
  const key = `${kind}|${color}|${variant}`;
  const hit = interiorCache.get(key);
  if (hit !== undefined) return hit;
  const tile = tileCanvas();
  if (!tile) {
    interiorCache.set(key, null);
    return null;
  }
  const { canvas, ctx } = tile;
  if (kind === 'wall-boards') drawBoard(ctx, color);
  else if (kind === 'wall-pine') drawPine(ctx, color);
  else if (kind === 'wall-check') drawCheck(ctx, color);
  else if (kind === 'floor-boards') drawFloorBoards(ctx, color);
  else if (kind === 'floor-tile') drawTile(ctx, color);
  else if (kind === 'floor-pine') drawWidePine(ctx, color);
  else if (kind === 'floor-carpet') drawCarpet(ctx, color);
  else drawParquet(ctx, color);
  if (variant === 'new') {
    const img = ctx.getImageData(0, 0, TEXTURE_PX, TEXTURE_PX);
    blendPixels(img.data, hexToRgb(NEW_WORK_GREEN), NEW_WORK_BLEND);
    ctx.putImageData(img, 0, 0);
  }
  let normalMap = interiorNormals.get(kind);
  if (normalMap === undefined) {
    const height = interiorHeight(kind);
    const n = height ? tileCanvas() : null;
    normalMap = null;
    if (height && n) {
      const img = n.ctx.createImageData(TEXTURE_PX, TEXTURE_PX);
      normalFromHeight(height, TEXTURE_PX, PX_PER_INCH, img.data);
      n.ctx.putImageData(img, 0, 0);
      normalMap = tileTexture(n.canvas, NoColorSpace);
    }
    interiorNormals.set(kind, normalMap);
  }
  const out = { map: tileTexture(canvas, SRGBColorSpace), normalMap };
  interiorCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Roof textures. A roof tile is TEXTURE_PX square and stands for ROOF_TILE: 24" across the slope
// (canvas x) by 48" down it. Roof UVs are in tiles (meshes.ts addRoofUVs) with v growing downhill,
// and flipY puts v = 1 at the canvas top, so up the canvas is down the slope; the roof textures
// repeat once per unit of UV (repeat 1, not the siding's 1/48). Layouts below are in tile inches:
// x across, s down the slope from the tile's uphill edge.

/** Pixels per inch of a roof tile, across the slope and down it (a texel is 3/64" by 3/32"). */
export const ROOF_PX_ACROSS = TEXTURE_PX / ROOF_TILE.across;
export const ROOF_PX_DOWN = TEXTURE_PX / ROOF_TILE.down;
/** Corrugated metal: 9 ribs across a 24" tile (a 2 2/3" pitch), 1/2" from trough to crest. */
export const METAL_RIBS = 9;
export const RIB_DEPTH = 0.5;
/**
 * Asphalt shingles: 10 courses down a 48" tile (a 4.8" exposure, the nearest to 5" that repeats with
 * the tile), 12" tabs with 1/4" slots, every other course shifted half a tab. The butt stands 0.15"
 * proud of the course below.
 */
export const ROOF_SHINGLE_COURSES = 10;
export const SHINGLE_TAB = 12;
export const SHINGLE_SLOT = 0.25;
export const ROOF_SHINGLE_BUTT = 0.15;
/** The shadow just downhill of a shingle's butt: how far down the slope it reaches (inches) and its darkness at the butt. */
export const ROOF_BUTT_SHADOW = { depth: 0.4, alpha: 0.55 } as const;

/** Weathering to the nearest 0.05 in 0..1, so a slider does not make a texture for every step. */
export const quantizeWeathering = (w: number): number => Math.round(Math.min(1, Math.max(0, Number.isFinite(w) ? w : 0)) * 20) / 20;

/**
 * Height of the corrugation at a canvas column, inches above the troughs: a cosine wave, METAL_RIBS
 * per tile so it repeats seamlessly. Troughs at x = k * 24" / 9, crests half way between.
 */
export function ribHeight(col: number): number {
  return (RIB_DEPTH / 2) * (1 - Math.cos((2 * Math.PI * METAL_RIBS * (col + 0.5)) / TEXTURE_PX));
}

/** Across-the-tile positions of crest k and trough k, inches. */
const crestX = (k: number): number => ((k + 0.5) * ROOF_TILE.across) / METAL_RIBS;
const troughX = (k: number): number => (k * ROOF_TILE.across) / METAL_RIBS;

/** A rust streak on a metal roof tile, in tile inches; it runs downhill from its source and wraps round the tile. */
export interface RustStreak {
  /** Across the tile (0 to 24). */
  x: number;
  /** Its source, down the slope from the tile's uphill edge (0 to 48). */
  s: number;
  length: number;
  width: number;
  /** Opacity at the source, fading to nothing at the end: the weathering times a base of 0.15 to 0.9. */
  alpha: number;
  /** 0 dark brown to 1 orange. */
  tone: number;
  /** A fastener's rust spot at the source. */
  spot: boolean;
}

/**
 * The rust streaks of a metal roof tile: from the fasteners (two rows a tile, 24" apart down the
 * slope, in every third crest), along every rib where the water runs (in the trough or over the
 * crest), and a few broad stains over several ribs. The layout is the same at every weathering
 * (seeded); only the opacity scales with it.
 */
export function rustStreaks(weathering: number): RustStreak[] {
  const w = quantizeWeathering(weathering);
  const rand = seeded(97);
  const out: RustStreak[] = [];
  for (const [row, s] of [12, 36].entries()) {
    for (let k = row; k < METAL_RIBS; k += 3) {
      const base = 0.55 + rand() * 0.35;
      out.push({ x: crestX(k), s: s + (rand() - 0.5) * 0.5, length: 4 + rand() * 16, width: 0.35 + rand() * 0.4, alpha: w * base, tone: rand(), spot: true });
    }
  }
  for (let k = 0; k < METAL_RIBS; k++) {
    for (let j = 0; j < 3; j++) {
      const x = (rand() < 0.4 ? crestX(k) : troughX(k)) + (rand() - 0.5) * 0.5;
      const base = 0.3 + rand() * 0.5;
      out.push({ x, s: rand() * ROOF_TILE.down, length: 6 + rand() * 36, width: 0.25 + rand() * 0.8, alpha: w * base, tone: rand(), spot: false });
    }
  }
  for (let i = 0; i < 6; i++) {
    const base = 0.15 + rand() * 0.2;
    out.push({ x: rand() * ROOF_TILE.across, s: rand() * ROOF_TILE.down, length: 16 + rand() * 32, width: 2 + rand() * 5, alpha: w * base, tone: rand(), spot: false });
  }
  return out;
}

/** One course of asphalt shingles across a roof tile: its span down the slope, its slots and its tabs' brightness. */
export interface RoofShingleCourse {
  /** Uphill and downhill edges (the butt is at s1). */
  s0: number;
  s1: number;
  /** Slot centres across the tile, ascending. */
  slots: number[];
  /** Brightness factor of the tab right of each slot (brightness()). */
  shades: number[];
}

/** The courses of an asphalt shingle roof tile, uphill to downhill. */
export function roofShingleCourses(): RoofShingleCourse[] {
  const b = courseBoundaries(ROOF_TILE.down, ROOF_TILE.down / ROOF_SHINGLE_COURSES);
  const rand = seeded(61);
  const out: RoofShingleCourse[] = [];
  for (let k = 0; k + 1 < b.length; k++) {
    const slots: number[] = [];
    for (let x = (k % 2) * (SHINGLE_TAB / 2); x < ROOF_TILE.across; x += SHINGLE_TAB) slots.push(x);
    out.push({ s0: b[k], s1: b[k + 1], slots, shades: slots.map(() => brightness(rand)) });
  }
  return out;
}

/** A distance across the roof tile folded into -12..12. */
const wrapAcross = (dx: number): number => dx - ROOF_TILE.across * Math.round(dx / ROOF_TILE.across);

/**
 * The relief of a roof finish over one tile, inches, row-major in canvas order (row 0 is the
 * tile's downhill edge). Metal: the corrugation (ribHeight), the same down every column. Shingle:
 * each course rises from nothing at its uphill edge to ROOF_SHINGLE_BUTT at its butt, its slots
 * sunk to the course underneath.
 */
export function roofHeight(finish: RoofFinish): Float32Array {
  if (finish === 'seam') return seamHeight();
  const f = new Float32Array(TEXTURE_PX * TEXTURE_PX);
  if (finish === 'metal') {
    for (let col = 0; col < TEXTURE_PX; col++) {
      const h = ribHeight(col);
      for (let row = 0; row < TEXTURE_PX; row++) f[row * TEXTURE_PX + col] = h;
    }
    return f;
  }
  const courses = roofShingleCourses();
  for (let row = 0; row < TEXTURE_PX; row++) {
    const s = (TEXTURE_PX - row - 0.5) / ROOF_PX_DOWN;
    const c = courses.find((k) => s < k.s1) ?? courses[courses.length - 1];
    const ramp = (ROOF_SHINGLE_BUTT * (s - c.s0)) / (c.s1 - c.s0);
    for (let col = 0; col < TEXTURE_PX; col++) {
      const x = (col + 0.5) / ROOF_PX_ACROSS;
      const inSlot = c.slots.some((sx) => Math.abs(wrapAcross(x - sx)) < SHINGLE_SLOT / 2);
      f[row * TEXTURE_PX + col] = inSlot ? -ROOF_SHINGLE_BUTT / 2 : ramp;
    }
  }
  return f;
}

/** Draw in roof tile inches: x across, s down the slope from the tile's uphill edge (the canvas bottom). */
function roofSpace(ctx: Ctx): void {
  ctx.setTransform(ROOF_PX_ACROSS, 0, 0, -ROOF_PX_DOWN, 0, TEXTURE_PX);
}

/** Call `draw` for the tile, and again shifted a tile for each edge the box x0..x1, s0..s1 crosses. */
function wrapped(x0: number, x1: number, s0: number, s1: number, draw: (dx: number, ds: number) => void): void {
  const xs = [0, ...(x0 < 0 ? [ROOF_TILE.across] : []), ...(x1 > ROOF_TILE.across ? [-ROOF_TILE.across] : [])];
  const ss = [0, ...(s0 < 0 ? [ROOF_TILE.down] : []), ...(s1 > ROOF_TILE.down ? [-ROOF_TILE.down] : [])];
  for (const dx of xs) for (const ds of ss) draw(dx, ds);
}

/** Rust between dark brown (tone 0) and orange (tone 1), as r, g, b. */
function rustRgb(tone: number): [number, number, number] {
  return [Math.round(100 + 80 * tone), Math.round(50 + 45 * tone), Math.round(25 + 18 * tone)];
}

function drawMetal(ctx: Ctx, color: string, weathering: number): void {
  const rand = seeded(83);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, TEXTURE_PX, TEXTURE_PX);
  roofSpace(ctx);
  // Each rib of the sheet a little lighter or darker, and faint streaks down the slope where the
  // galvanizing has dulled unevenly (long and narrow, so the tile's repeat does not show as spots).
  for (let k = 0; k < METAL_RIBS; k++) {
    const f = brightness(rand);
    ctx.fillStyle = f > 1 ? `rgba(255, 255, 255, ${((f - 1) * 0.8).toFixed(3)})` : `rgba(0, 0, 0, ${((1 - f) * 0.8).toFixed(3)})`;
    ctx.fillRect(troughX(k), 0, ROOF_TILE.across / METAL_RIBS, ROOF_TILE.down);
  }
  for (let i = 0; i < 240; i++) {
    const x = rand() * ROOF_TILE.across;
    const s = rand() * ROOF_TILE.down;
    const len = 2 + rand() * 14;
    const wid = 0.05 + rand() * 0.25;
    const dark = rand() < 0.6;
    const a = 0.03 + rand() * 0.06;
    ctx.fillStyle = dark ? `rgba(0, 0, 0, ${a.toFixed(3)})` : `rgba(255, 255, 255, ${a.toFixed(3)})`;
    wrapped(x, x + wid, s, s + len, (dx, ds) => ctx.fillRect(x + dx, s + ds, wid, len));
  }
  // Rust: each streak fades downhill from its source, with a fainter edge either side; a fastener has a spot.
  for (const st of rustStreaks(weathering)) {
    if (st.alpha <= 0) continue;
    const [r, g, b] = rustRgb(st.tone);
    const half = st.width / 2;
    wrapped(st.x - half, st.x + half, st.s - 0.5, st.s + st.length, (dx, ds) => {
      for (const [k, a] of [[1, 0.5], [0.55, 0.5]] as const) {
        const grad = ctx.createLinearGradient(0, st.s + ds, 0, st.s + ds + st.length);
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${(st.alpha * a).toFixed(3)})`);
        grad.addColorStop(0.35, `rgba(${r}, ${g}, ${b}, ${(st.alpha * a * 0.6).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(st.x + dx - half * k, st.s + ds, st.width * k, st.length);
      }
      if (st.spot) {
        const spot = ctx.createRadialGradient(st.x + dx, st.s + ds, 0, st.x + dx, st.s + ds, 0.45);
        spot.addColorStop(0, `rgba(${r - 30}, ${g - 20}, ${b - 10}, ${Math.min(1, st.alpha * 1.4).toFixed(3)})`);
        spot.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = spot;
        ctx.fillRect(st.x + dx - 0.45, st.s + ds - 0.45, 0.9, 0.9);
      }
    });
  }
  // Each rib: the crests catch the light and the troughs hold shade (the normal map adds the slope).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let col = 0; col < TEXTURE_PX; col++) {
    const f = (2 * ribHeight(col)) / RIB_DEPTH - 1;
    ctx.fillStyle = f > 0 ? `rgba(255, 255, 255, ${(0.1 * f).toFixed(3)})` : `rgba(0, 0, 0, ${(-0.16 * f).toFixed(3)})`;
    ctx.fillRect(col, 0, 1, TEXTURE_PX);
  }
}

function drawRoofShingle(ctx: Ctx, color: string): void {
  const rand = seeded(67);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, TEXTURE_PX, TEXTURE_PX);
  roofSpace(ctx);
  const courses = roofShingleCourses();
  for (const c of courses) {
    // Tabs a few percent lighter or darker; each slot a dark gap down to the course underneath.
    c.slots.forEach((sx, j) => {
      const x1 = j + 1 < c.slots.length ? c.slots[j + 1] : c.slots[0] + ROOF_TILE.across;
      wrapped(sx, x1, c.s0, c.s1, (dx, ds) => {
        ctx.fillStyle = shade(color, c.shades[j]);
        ctx.fillRect(sx + dx, c.s0 + ds, x1 - sx, c.s1 - c.s0);
      });
    });
    ctx.fillStyle = shade(color, 0.45);
    for (const sx of c.slots) {
      wrapped(sx - SHINGLE_SLOT / 2, sx + SHINGLE_SLOT / 2, c.s0, c.s1, (dx, ds) => ctx.fillRect(sx + dx - SHINGLE_SLOT / 2, c.s0 + ds, SHINGLE_SLOT, c.s1 - c.s0));
    }
  }
  // The butt of each course shades the top of the course below it (downhill).
  for (const c of courses) {
    wrapped(0, ROOF_TILE.across, c.s1, c.s1 + ROOF_BUTT_SHADOW.depth, (dx, ds) => {
      const g = ctx.createLinearGradient(0, c.s1 + ds, 0, c.s1 + ds + ROOF_BUTT_SHADOW.depth);
      g.addColorStop(0, `rgba(0, 0, 0, ${ROOF_BUTT_SHADOW.alpha})`);
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(dx, c.s1 + ds, ROOF_TILE.across, ROOF_BUTT_SHADOW.depth);
    });
  }
  // Granules: specks a little lighter or darker than the shingle.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = 0; i < 9000; i++) {
    const dark = rand() < 0.55;
    const a = 0.08 + rand() * 0.16;
    ctx.fillStyle = dark ? `rgba(0, 0, 0, ${a.toFixed(3)})` : `rgba(255, 255, 255, ${a.toFixed(3)})`;
    ctx.fillRect(Math.floor(rand() * TEXTURE_PX), Math.floor(rand() * TEXTURE_PX), 1, 1);
  }
}

// Standing seam: flat pans between raised seams every SEAM_SPACING across the slope. The texture is
// SEAM_TILE (48") square, so it covers two of the roof's 24" UV tiles across (repeat 0.5 across, 1
// down) and the seams land every 16" on the roof.

export const SEAM_SPACING = 16;
export const SEAM_TILE = 48;
/** How far a seam stands above the pan, and its width at the top (the taper either side is extra). */
export const SEAM_HEIGHT = 1;
export const SEAM_WIDTH = 0.75;
/** Pixels per inch of the seam texture, both ways. */
export const SEAM_PX = TEXTURE_PX / SEAM_TILE;

/** The seams' positions across the texture, inches: 0, 16 and 32. */
export const seamPositions = (): number[] => Array.from({ length: Math.round(SEAM_TILE / SEAM_SPACING) }, (_, i) => i * SEAM_SPACING);

/** Distance across the texture from x to the nearest seam, inches (the texture wraps). */
function seamDistance(x: number): number {
  const d = (((x % SEAM_SPACING) + SEAM_SPACING) % SEAM_SPACING);
  return Math.min(d, SEAM_SPACING - d);
}

/**
 * The relief of a standing-seam roof, inches in canvas order (every row the same): each seam
 * SEAM_HEIGHT tall and SEAM_WIDTH across its top, sloping to the pan over 1/4" either side, and two
 * faint pencil ribs in each pan.
 */
export function seamHeight(): Float32Array {
  const f = new Float32Array(TEXTURE_PX * TEXTURE_PX);
  for (let col = 0; col < TEXTURE_PX; col++) {
    const x = (col + 0.5) / SEAM_PX;
    const d = seamDistance(x);
    const half = SEAM_WIDTH / 2;
    let h = d <= half ? SEAM_HEIGHT : d <= half + 0.25 ? SEAM_HEIGHT * (1 - (d - half) / 0.25) : 0;
    for (const rib of [SEAM_SPACING / 3, (2 * SEAM_SPACING) / 3]) {
      const r = Math.abs((((x - rib) % SEAM_SPACING) + SEAM_SPACING) % SEAM_SPACING);
      const dr = Math.min(r, SEAM_SPACING - r);
      if (dr < 0.2) h = Math.max(h, 0.05 * (1 - dr / 0.2));
    }
    for (let row = 0; row < TEXTURE_PX; row++) f[row * TEXTURE_PX + col] = h;
  }
  return f;
}

/** Standing seam: each pan a shade apart, faint streaks down the slope, the seams lit on one side and shaded on the other. */
function drawSeam(ctx: Ctx, color: string): void {
  const rand = seeded(97);
  const pans = seamPositions();
  for (const x0 of pans) {
    ctx.fillStyle = shade(color, 0.97 + rand() * 0.06);
    ctx.fillRect(Math.round(x0 * SEAM_PX), 0, Math.round(SEAM_SPACING * SEAM_PX), TEXTURE_PX);
  }
  // Faint streaks down the slope (the coating's roll marks).
  for (let k = 0; k < 160; k++) {
    const dark = rand() < 0.5;
    ctx.fillStyle = dark ? `rgba(0, 0, 0, ${(0.02 + rand() * 0.03).toFixed(3)})` : `rgba(255, 255, 255, ${(0.015 + rand() * 0.025).toFixed(3)})`;
    ctx.fillRect(Math.floor(rand() * TEXTURE_PX), 0, 1, TEXTURE_PX);
  }
  for (const x of pans) {
    const c = Math.round(x * SEAM_PX);
    const w = Math.max(2, Math.round(SEAM_WIDTH * SEAM_PX));
    // The seam's top, a little lighter; a highlight on its lit side and a shadow on the other.
    ctx.fillStyle = shade(color, 1.12);
    pixelRect(ctx, c - Math.floor(w / 2), 0, w, TEXTURE_PX);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    pixelRect(ctx, c - Math.floor(w / 2) - 1, 0, 1, TEXTURE_PX);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    pixelRect(ctx, c + Math.ceil(w / 2), 0, 2, TEXTURE_PX);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    pixelRect(ctx, c + Math.ceil(w / 2) + 2, 0, 3, TEXTURE_PX);
  }
}

/** A seam texture repeats once per 48" across the slope: half a roof UV tile's repeat across. */
function seamRepeat(tex: CanvasTexture): CanvasTexture {
  tex.repeat.set(ROOF_TILE.across / SEAM_TILE, 1);
  return tex;
}

const roofNormalCache = new Map<RoofFinish, CanvasTexture | null>();

/** The normal map of a roof finish (the relief does not depend on the colour), made once. */
function roofNormalTexture(finish: RoofFinish): CanvasTexture | null {
  const hit = roofNormalCache.get(finish);
  if (hit !== undefined) return hit;
  const tile = tileCanvas();
  let tex: CanvasTexture | null = null;
  if (tile) {
    const img = tile.ctx.createImageData(TEXTURE_PX, TEXTURE_PX);
    if (finish === 'seam') normalFromHeight(roofHeight(finish), TEXTURE_PX, SEAM_PX, img.data, SEAM_PX);
    else normalFromHeight(roofHeight(finish), TEXTURE_PX, ROOF_PX_ACROSS, img.data, ROOF_PX_DOWN);
    tile.ctx.putImageData(img, 0, 0);
    // Directions, not colours: no colour space conversion.
    tex = tileTexture(tile.canvas, NoColorSpace, 1);
    if (finish === 'seam') seamRepeat(tex);
  }
  roofNormalCache.set(finish, tex);
  return tex;
}

const roofCache = new Map<string, SidingTextures | null>();

/**
 * A roof's colour texture and normal map, made once per finish, colour and weathering (to the
 * nearest 0.05; a shingle roof ignores it) and cached together. Metal: corrugated sheet in the
 * colour, faintly mottled, with rust streaks whose opacity scales with the weathering, the crests
 * shaded light and the troughs dark; its normal map is the rib profile. Shingle: courses of tabs
 * with slots, a shadow under each butt, granules; its normal map has the butts and slots. Null
 * wherever there is no DOM canvas (node), where the materials use the flat colour.
 */
export function roofTexture(finish: RoofFinish, color: string, weathering: number = DEFAULT_WEATHERING): SidingTextures | null {
  if (typeof document === 'undefined') return null;
  const w = finish === 'metal' ? quantizeWeathering(weathering) : 0;
  const key = `${finish}|${color}|${w}`;
  const hit = roofCache.get(key);
  if (hit !== undefined) return hit;
  const tile = tileCanvas();
  if (!tile) {
    roofCache.set(key, null);
    return null;
  }
  if (finish === 'metal') drawMetal(tile.ctx, color, w);
  else if (finish === 'seam') drawSeam(tile.ctx, color);
  else drawRoofShingle(tile.ctx, color);
  const map = tileTexture(tile.canvas, SRGBColorSpace, 1);
  if (finish === 'seam') seamRepeat(map);
  const out = { map, normalMap: roofNormalTexture(finish) };
  roofCache.set(key, out);
  return out;
}
