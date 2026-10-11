import { add, dot, scale, sub } from '../model/geometry';
import type { Degrees, Id, Plan, Stairs, Vec2 } from '../model/types';

// Stairs (DESIGN.md "Plan document"). `origin` is the middle of the bottom edge of the flight (where
// you step on), `direction` the plan angle of travel going up (0 = +x, 90 = +y, i.e. down the
// screen), `run` the horizontal length of the flight and `width` its width, centered on origin.
// The flight climbs from this level's floor top to the next level's floor top.

export const STAIRS_DEFAULTS = { width: 36, run: 120 } as const;
/** Sizes the store accepts: width 24" to 96", run 3' to 30'. */
export const STAIRS_LIMITS = { minWidth: 24, maxWidth: 96, minRun: 36, maxRun: 360 } as const;
export const stairsWidthOk = (w: number): boolean => w >= STAIRS_LIMITS.minWidth && w <= STAIRS_LIMITS.maxWidth;
export const stairsRunOk = (r: number): boolean => r >= STAIRS_LIMITS.minRun && r <= STAIRS_LIMITS.maxRun;
/** Riser height the step count aims for. */
export const TARGET_RISE = 7.5;

/** Floor top of this level to floor top of the next one (or this level's own floor thickness on top). */
export function floorToFloor(plan: Plan, levelId: Id): number {
  const i = plan.levelOrder.indexOf(levelId);
  const level = plan.levels[levelId];
  if (!level) return 0;
  const above = i >= 0 ? plan.levels[plan.levelOrder[i + 1]] : undefined;
  return level.wallHeight + (above ? above.floorThickness : level.floorThickness);
}

export interface StairSteps {
  /** Number of risers, floor to floor; the flight's run is split into this many steps. */
  risers: number;
  rise: number;
}

export function stairSteps(totalRise: number): StairSteps {
  const risers = Math.max(1, Math.round(totalRise / TARGET_RISE));
  return { risers, rise: totalRise / risers };
}

/** Normalize to [0, 360). */
export const normalizeDegrees = (d: Degrees): Degrees => ((d % 360) + 360) % 360;

/** Unit vector of a plan angle; exact for multiples of 90 degrees. */
export function directionVector(deg: Degrees): Vec2 {
  const d = normalizeDegrees(deg);
  if (d === 0) return { x: 1, y: 0 };
  if (d === 90) return { x: 0, y: 1 };
  if (d === 180) return { x: -1, y: 0 };
  if (d === 270) return { x: 0, y: -1 };
  const r = (d * Math.PI) / 180;
  return { x: Math.cos(r), y: Math.sin(r) };
}

export interface StairsFrame {
  origin: Vec2;
  /** Unit direction of travel (up). */
  u: Vec2;
  /** Unit lateral direction, to the right of travel on screen. */
  v: Vec2;
}

export function stairsFrame(s: Pick<Stairs, 'origin' | 'direction'>): StairsFrame {
  const u = directionVector(s.direction);
  return { origin: s.origin, u, v: { x: -u.y, y: u.x } };
}

/** Point at distance `along` up the flight and `side` to its right. */
export const stairsPoint = (f: StairsFrame, along: number, side: number): Vec2 =>
  add(add(f.origin, scale(f.u, along)), scale(f.v, side));

/** Footprint rectangle: bottom-left, top-left, top-right, bottom-right (relative to travel). */
export function stairsOutline(s: Pick<Stairs, 'origin' | 'direction' | 'width' | 'run'>): Vec2[] {
  const f = stairsFrame(s);
  const h = s.width / 2;
  return [stairsPoint(f, 0, -h), stairsPoint(f, s.run, -h), stairsPoint(f, s.run, h), stairsPoint(f, 0, h)];
}

type Seg = [Vec2, Vec2];

export interface StairsSymbol {
  outline: Vec2[];
  /** Nosing lines between steps. */
  treads: Seg[];
  /** The UP arrow: shaft and head. */
  shaft: Seg;
  head: [Vec2, Vec2, Vec2];
  /** Where the "UP" label goes, and its upright text angle in degrees. */
  label: Vec2;
  labelAngle: number;
}

export function stairsSymbol(s: Pick<Stairs, 'origin' | 'direction' | 'width' | 'run'>, risers: number): StairsSymbol {
  const f = stairsFrame(s);
  const h = s.width / 2;
  const treads: Seg[] = [];
  for (let i = 1; i < risers; i++) {
    const t = (s.run * i) / risers;
    treads.push([stairsPoint(f, t, -h), stairsPoint(f, t, h)]);
  }
  const headLen = Math.min(s.width * 0.35, s.run * 0.2, 12);
  const tip = stairsPoint(f, s.run - Math.min(6, s.run * 0.08), 0);
  const base = sub(tip, scale(f.u, headLen));
  const shaft: Seg = [stairsPoint(f, Math.min(s.run * 0.12, 10), 0), tip];
  const head: [Vec2, Vec2, Vec2] = [add(base, scale(f.v, -headLen * 0.55)), tip, add(base, scale(f.v, headLen * 0.55))];
  let labelAngle = (Math.atan2(f.u.y, f.u.x) * 180) / Math.PI;
  if (labelAngle > 90 || labelAngle <= -90) labelAngle += 180;
  return {
    outline: stairsOutline(s),
    treads,
    shaft,
    head,
    label: stairsPoint(f, s.run * 0.3, -Math.min(h * 0.55, 10)),
    labelAngle,
  };
}

/** True when p lies on the stairs' footprint, grown by `pad`. */
export function hitStairs(s: Pick<Stairs, 'origin' | 'direction' | 'width' | 'run'>, p: Vec2, pad = 0): boolean {
  const f = stairsFrame(s);
  const rel = sub(p, f.origin);
  const along = dot(rel, f.u);
  const side = dot(rel, f.v);
  return along >= -pad && along <= s.run + pad && Math.abs(side) <= s.width / 2 + pad;
}

/** The axis direction (0, 90, 180, 270) closest to a movement vector. */
export function orthoDirection(delta: Vec2): Degrees {
  if (Math.abs(delta.x) >= Math.abs(delta.y)) return delta.x >= 0 ? 0 : 180;
  return delta.y >= 0 ? 90 : 270;
}
