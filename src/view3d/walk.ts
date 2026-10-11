import { getLevelElevations } from '../derive/levels';
import { getFootprints } from '../derive/footprint';
import { getFaces } from '../derive/rooms';
import { pointInPolygon, polygonSignedArea } from '../model/geometry';
import type { Id, Plan, Vec2, ViewMode } from '../model/types';
import { planBox } from './bounds';
import { active3dLevel, visible3dLevels } from './visibility';

// First-person walkthrough (DESIGN.md "3D"): pure helpers for view3d/FirstPerson.tsx.

/** Eye above the floor top, inches. */
export const EYE_HEIGHT = 66;
/** Walking speed, inches per second (about 5 ft/s); Shift runs at RUN_FACTOR times that. */
export const WALK_SPEED = 60;
export const RUN_FACTOR = 2;
/** Longest frame step, so a stalled tab does not teleport the walker. */
export const MAX_STEP_SECONDS = 0.25;

type LevelVisibility = Parameters<typeof visible3dLevels>[1];

/** The levels one can walk on: those the 3D view shows, bottom to top (all levels if none is). */
export function walkLevels(plan: Plan, ui: LevelVisibility): Id[] {
  const shown = visible3dLevels(plan.levelOrder, ui);
  return shown.length ? shown : [...plan.levelOrder];
}

/** The level walking starts on: the active one when it is shown, else the lowest shown. */
export function startLevel(levels: readonly Id[], activeLevelId: Id): Id | undefined {
  return levels.includes(activeLevelId) ? activeLevelId : levels[0];
}

/**
 * The level walking starts on for the current UI: the active level (in site mode the first floor,
 * the level the site view shows; active3dLevel) when the 3D view shows it, else the lowest shown.
 */
export function walkStartLevel(plan: Plan, ui: LevelVisibility): Id | undefined {
  return startLevel(walkLevels(plan, ui), active3dLevel(plan.levelOrder, ui));
}

/** The next level below (-1) or above (+1) in `levels`, or null at the bottom / top. */
export function stepLevel(levels: readonly Id[], current: Id, dir: -1 | 1): Id | null {
  const i = levels.indexOf(current);
  if (i < 0) return levels[0] ?? null;
  return levels[i + dir] ?? null;
}

/** Eye elevation on a level: its floor top plus EYE_HEIGHT. */
export function eyeElevation(plan: Plan, levelId: Id): number {
  return (getLevelElevations(plan)[levelId]?.floorTop ?? 0) + EYE_HEIGHT;
}

/**
 * Where walking starts on a level, in plan coordinates: the centre of the level's outer face (the
 * bounding box of the largest closed outline). When that point is inside a wall (a divider across
 * the middle of the house), the middle of the largest room is used instead. A level without a
 * closed outline starts at the centre of the shown levels' bounding box.
 */
export function walkStart(plan: Plan, levelId: Id, viewMode: ViewMode, levels: readonly Id[]): Vec2 {
  const level = plan.levels[levelId];
  if (level) {
    const faces = getFaces(level, viewMode);
    let outer: Vec2[] | null = null;
    for (const f of faces.outerFaces) {
      if (!outer || Math.abs(polygonSignedArea(f)) > Math.abs(polygonSignedArea(outer))) outer = f;
    }
    if (outer) {
      const xs = outer.map((p) => p.x);
      const ys = outer.map((p) => p.y);
      const c = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
      const inWall = [...getFootprints(level, viewMode).values()].some((fp) => pointInPolygon(c, fp.poly));
      if (!inWall) return c;
      const largest = [...faces.faces].sort((p, q) => q.grossArea - p.grossArea)[0];
      if (largest) return largest.labelPoint;
      return c;
    }
  }
  const box = planBox(plan, levels);
  return { x: (box.min[0] + box.max[0]) / 2, y: (box.min[2] + box.max[2]) / 2 };
}

/**
 * Horizontal displacement (three x, z) for a step of `distance` with the camera turned by `yaw`
 * (rotation about +Y; 0 looks along -Z). forward / right are -1, 0 or 1; diagonals are normalized
 * so they are not faster.
 */
export function walkStep(yaw: number, forward: number, right: number, distance: number): [number, number] {
  const len = Math.hypot(forward, right);
  if (len === 0 || distance === 0) return [0, 0];
  const f = (forward / len) * distance;
  const r = (right / len) * distance;
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  // forward = (-sin yaw, 0, -cos yaw), right = (cos yaw, 0, -sin yaw)
  return [-s * f + c * r, -c * f - s * r];
}
