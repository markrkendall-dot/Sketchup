import { add, dot, scale, sub } from '../model/geometry';
import type { Degrees, Id, Plan, Stairs, Vec2 } from '../model/types';

// Stairs (DESIGN.md "Plan document"). `origin` is the middle of the bottom edge of the flight (where
// you step on), `direction` the plan angle of travel going up (0 = +x, 90 = +y, i.e. down the
// screen), `run` the horizontal length of the flight and `width` its width, centered on origin.
// By default the flight climbs from this level's floor top to the next level's floor top; `base`
// lifts its bottom (a flight that starts on a landing) and `rise` shortens its climb (a flight up to
// a landing), and `risers` overrides the step count (a landing is one riser, one deep tread).

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
  /** Number of risers over the flight's climb; the flight's run is split into this many steps. */
  risers: number;
  rise: number;
}

/** Most risers a flight may have (a 30' run at 3.6" a tread). */
export const MAX_STAIRS_RISERS = 100;
/** A usable riser count: a whole number from 1 to MAX_STAIRS_RISERS. */
export const stairsRisersOk = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= MAX_STAIRS_RISERS;

/**
 * Steps of a climb of `totalRise`: `risers` when given (and usable), else round(totalRise / 7.5"),
 * at least 1; each step rises totalRise / risers.
 */
export function stairSteps(totalRise: number, risers?: number): StairSteps {
  const n = risers !== undefined && stairsRisersOk(risers) ? risers : Math.max(1, Math.round(totalRise / TARGET_RISE));
  return { risers: n, rise: totalRise / n };
}

/** Height of the bottom of the flight above the floor top (0 unless it starts on a landing). */
export const stairsBase = (s: Pick<Stairs, 'base'>): number => s.base ?? 0;

/** Height the flight climbs: `rise` when set, else from its base to the floor above. */
export const stairsRise = (s: Pick<Stairs, 'base' | 'rise'>, floorToFloor: number): number => s.rise ?? floorToFloor - stairsBase(s);

/** The flight's own steps: its climb (stairsRise) split by its `risers` override or the 7.5" rule. */
export const flightSteps = (s: Pick<Stairs, 'base' | 'rise' | 'risers'>, floorToFloor: number): StairSteps =>
  stairSteps(stairsRise(s, floorToFloor), s.risers);

/** How far below the lowest level's floor a flight may start (outdoor steps down a slope). */
export const MAX_STAIRS_BELOW = 600;

/**
 * Why the height fields of a flight cannot be used on a level `floorToFloor` high, or null: the
 * base must not be negative (on the `lowest` level it may be, down to MAX_STAIRS_BELOW: outdoor
 * steps that go on down a slope), the climb must be positive, the top (base + climb) at most an inch
 * above the floor above, and risers a whole number from 1 to MAX_STAIRS_RISERS. Lower case, like
 * columnProblem; the panel capitalizes it.
 */
export function stairsHeightProblem(s: Pick<Stairs, 'base' | 'rise' | 'risers'>, floorToFloor: number, lowest = false): string | null {
  if (s.base !== undefined && !Number.isFinite(s.base)) return 'the bottom of the flight must be a number';
  if (s.base !== undefined && s.base < 0 && !lowest) return 'the bottom of the flight must not be below the floor (only the lowest level\'s outdoor steps may go below it)';
  if (s.base !== undefined && s.base < -MAX_STAIRS_BELOW) return `the bottom of the flight must not be more than ${MAX_STAIRS_BELOW}" below the floor`;
  if (s.rise !== undefined && !(Number.isFinite(s.rise) && s.rise > 0)) return 'the climb must be greater than 0';
  if (s.risers !== undefined && !stairsRisersOk(s.risers)) return `risers must be a whole number from 1 to ${MAX_STAIRS_RISERS}`;
  const rise = stairsRise(s, floorToFloor);
  if (!(rise > 0)) return 'the flight must start below the floor above';
  if (stairsBase(s) + rise > floorToFloor + 1) return 'the top of the flight must not be above the floor above';
  return null;
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

/** Default clear height over the treads that the floor opening above keeps (6'8"). */
export const STAIRS_HEADROOM = 80;
/** A floor opening shorter than this along the run is not cut. */
const MIN_HOLE = 1;

type HoleFields = 'run' | 'headroom' | 'base' | 'rise';

/**
 * Where the floor opening starts along the run by the headroom rule, ignoring any override: the
 * treads are at base + rise * d / run at distance d up the run, so headroom to the floor above drops
 * below `headroom` at d0 = run * (floorToFloor - headroom - base) / rise, clamped to [0, run]: 0
 * when even the bottom step is short of headroom, the whole run (no opening) when the top of the
 * flight is lower than floorToFloor - headroom (a short flight up to a landing, the landing itself).
 */
export function headroomHoleStart(s: Pick<Stairs, HoleFields>, floorToFloor: number): number {
  const rise = stairsRise(s, floorToFloor);
  if (!(rise > 0)) return 0;
  const d0 = (s.run * (floorToFloor - (s.headroom ?? STAIRS_HEADROOM) - stairsBase(s))) / rise;
  return Math.min(s.run, Math.max(0, d0));
}

/** Where the floor opening starts along the run: `holeStart` when set, else the headroom rule. */
export function stairsHoleStart(s: Pick<Stairs, HoleFields | 'holeStart'>, floorToFloor: number): number {
  return Math.max(0, s.holeStart ?? headroomHoleStart(s, floorToFloor));
}

/**
 * The opening the flight cuts in the floor above: the part of its footprint from the hole start
 * (stairsHoleStart) to the top, as bottom-left, top-left, top-right, bottom-right like
 * stairsOutline. Null when that is less than an inch long (a short flight with headroom to spare
 * all the way up cuts nothing). Ignores cutsFloorAbove; the caller checks it.
 */
export function stairsHoleOutline(
  s: Pick<Stairs, 'origin' | 'direction' | 'width' | HoleFields | 'holeStart'>,
  floorToFloor: number,
): Vec2[] | null {
  const d0 = stairsHoleStart(s, floorToFloor);
  if (d0 >= s.run - MIN_HOLE) return null;
  const f = stairsFrame(s);
  const h = s.width / 2;
  return [stairsPoint(f, d0, -h), stairsPoint(f, s.run, -h), stairsPoint(f, s.run, h), stairsPoint(f, d0, h)];
}

type Seg = [Vec2, Vec2];

export interface StairsSymbol {
  outline: Vec2[];
  /** Nosing lines between steps. */
  treads: Seg[];
  /** One riser: a landing, drawn as its outline only (no treads, no UP arrow or label). */
  landing: boolean;
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
    landing: risers <= 1,
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
