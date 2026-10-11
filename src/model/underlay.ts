// Image underlay math (DESIGN.md `Underlay`). Pure functions shared by the store, the underlay
// tool, the overlay and the tests.
//
// An underlay maps image pixel p (x right, y down, (0,0) at the top-left corner) to the plan as
//   plan = origin + R(rotation) * (p * scale)
// which is exactly the SVG transform `translate(origin) rotate(rotation) scale(scale)`. Rotation is
// in degrees, clockwise on the y-down screen, like SVG `rotate()`.

import type { Degrees, Underlay, Vec2 } from './types';

/** Width the provisional placement gives an imported image, so it is visible: 40'. */
export const PROVISIONAL_WIDTH = 480;
export const DEFAULT_UNDERLAY_OPACITY = 0.6;
/** Calibration points closer than this many image pixels are rejected. */
export const MIN_CALIBRATION_PX = 2;

/** Normalize an angle to [0, 360). */
export function normalizeRotation(deg: Degrees): Degrees {
  const r = deg % 360;
  const out = r < 0 ? r + 360 : r;
  // Avoid -0 and values a hair under 360 from float noise.
  return out >= 360 - 1e-9 || Math.abs(out) < 1e-9 ? 0 : out;
}

const rad = (deg: Degrees) => (deg * Math.PI) / 180;

function rotate(v: Vec2, deg: Degrees): Vec2 {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

type Placement = Pick<Underlay, 'origin' | 'scale' | 'rotation'>;

/** Image pixel -> plan inches. */
export function imageToPlan(u: Placement, p: Vec2): Vec2 {
  const r = rotate({ x: p.x * u.scale, y: p.y * u.scale }, u.rotation);
  return { x: u.origin.x + r.x, y: u.origin.y + r.y };
}

/** Plan inches -> image pixel. */
export function planToImage(u: Placement, p: Vec2): Vec2 {
  const r = rotate({ x: p.x - u.origin.x, y: p.y - u.origin.y }, -u.rotation);
  return { x: r.x / u.scale, y: r.y / u.scale };
}

/** Plan positions of the image corners: top-left, top-right, bottom-right, bottom-left. */
export function underlayCorners(u: Underlay): Vec2[] {
  const w = u.pixelWidth;
  const h = u.pixelHeight;
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ].map((p) => imageToPlan(u, p));
}

/** Plan position of the image centre. */
export const underlayCenter = (u: Underlay): Vec2 => imageToPlan(u, { x: u.pixelWidth / 2, y: u.pixelHeight / 2 });

/** True when plan point p lies on the image. */
export function hitUnderlay(u: Underlay, p: Vec2): boolean {
  const q = planToImage(u, p);
  return q.x >= 0 && q.y >= 0 && q.x <= u.pixelWidth && q.y <= u.pixelHeight;
}

/** Distance in image pixels between two plan points. */
export function pixelDistance(u: Placement, p1: Vec2, p2: Vec2): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y) / u.scale;
}

/** Origin that keeps image pixel `px` at plan point `at` under the given scale and rotation. */
function originKeeping(px: Vec2, at: Vec2, scale: number, rotation: Degrees): Vec2 {
  const r = rotate({ x: px.x * scale, y: px.y * scale }, rotation);
  return { x: at.x - r.x, y: at.y - r.y };
}

/**
 * Scale by two points: p1 and p2 are plan points clicked on the image, `realDistance` (inches) is
 * how far apart they really are. Returns the new scale and the origin that keeps the image pixel
 * under p1 at p1. Null when the points are (nearly) the same pixel or the distance is not usable.
 */
export function calibrateScale(u: Placement, p1: Vec2, p2: Vec2, realDistance: number): Placement | null {
  if (!(realDistance > 0) || !Number.isFinite(realDistance)) return null;
  const px = pixelDistance(u, p1, p2);
  if (!(px >= MIN_CALIBRATION_PX)) return null;
  const scale = realDistance / px;
  const i1 = planToImage(u, p1);
  return { scale, rotation: u.rotation, origin: originKeeping(i1, p1, scale, u.rotation) };
}

/**
 * The axis-aligned direction (0, 90, 180 or 270 degrees) nearest to the line p1 -> p2, and the
 * signed turn that gets there (in (-45, 45]).
 */
export function nearestAxis(p1: Vec2, p2: Vec2): { target: Degrees; turn: Degrees } {
  const angle = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
  const target = normalizeRotation(Math.round(angle / 90) * 90);
  let turn = target - angle;
  turn = ((((turn + 180) % 360) + 360) % 360) - 180;
  return { target, turn };
}

/**
 * Rotate by two points: turn the image about p1 so the line p1 -> p2 becomes horizontal or
 * vertical, whichever is closer. Returns the new rotation and origin, or null when the points are
 * (nearly) the same pixel.
 */
export function calibrateRotation(u: Placement, p1: Vec2, p2: Vec2): Placement | null {
  if (!(pixelDistance(u, p1, p2) >= MIN_CALIBRATION_PX)) return null;
  const { turn } = nearestAxis(p1, p2);
  return rotateAbout(u, u.rotation + turn, p1);
}

/** New rotation, turning about plan point `pivot` (which stays fixed). */
export function rotateAbout(u: Placement, rotation: Degrees, pivot: Vec2): Placement {
  const r = normalizeRotation(rotation);
  return { scale: u.scale, rotation: r, origin: originKeeping(planToImage(u, pivot), pivot, u.scale, r) };
}

/** New scale, keeping plan point `pivot` fixed. */
export function scaleAbout(u: Placement, scale: number, pivot: Vec2): Placement {
  return { scale, rotation: u.rotation, origin: originKeeping(planToImage(u, pivot), pivot, scale, u.rotation) };
}

/**
 * First placement of an imported image: centred on `center`, about 40' wide so it is visible at
 * a typical zoom, unrotated, 60% opaque and unlocked, ready to be calibrated.
 */
export function placeUnderlay(image: string, pixelWidth: number, pixelHeight: number, center: Vec2): Underlay {
  const scale = PROVISIONAL_WIDTH / pixelWidth;
  return {
    image,
    pixelWidth,
    pixelHeight,
    origin: { x: center.x - (pixelWidth * scale) / 2, y: center.y - (pixelHeight * scale) / 2 },
    scale,
    rotation: 0,
    opacity: DEFAULT_UNDERLAY_OPACITY,
    locked: false,
  };
}

/**
 * Swap in a new image, keeping its plan width, centre, rotation, opacity and lock (a better scan of
 * the same drawing lines up again; anything else needs calibrating anyway).
 */
export function replaceUnderlayImage(u: Underlay, image: string, pixelWidth: number, pixelHeight: number): Underlay {
  const scale = (u.scale * u.pixelWidth) / pixelWidth;
  const center = underlayCenter(u);
  const next = { ...u, image, pixelWidth, pixelHeight, scale };
  return { ...next, origin: originKeeping({ x: pixelWidth / 2, y: pixelHeight / 2 }, center, scale, u.rotation) };
}

/** Structural check used by the store and migrate(). */
export function isValidUnderlay(u: Underlay): boolean {
  const fin = Number.isFinite;
  return (
    typeof u.image === 'string' &&
    u.image.startsWith('data:image/') &&
    u.pixelWidth > 0 &&
    u.pixelHeight > 0 &&
    fin(u.pixelWidth) &&
    fin(u.pixelHeight) &&
    u.scale > 0 &&
    fin(u.scale) &&
    fin(u.origin.x) &&
    fin(u.origin.y) &&
    fin(u.rotation) &&
    u.opacity >= 0 &&
    u.opacity <= 1 &&
    typeof u.locked === 'boolean'
  );
}

/** Fit (w, h) inside a max x max square, keeping the aspect ratio; never upscales. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  const f = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * f)), height: Math.max(1, Math.round(h * f)) };
}

/** "1 px = 0.200 in": the scale with enough digits to compare calibrations. */
export function formatPxScale(scale: number): string {
  const digits = scale >= 10 ? 1 : scale >= 1 ? 2 : 3;
  return `1 px = ${scale.toFixed(digits)} in`;
}
