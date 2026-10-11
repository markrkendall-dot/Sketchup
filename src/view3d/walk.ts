import { getLevelElevations } from '../derive/levels';
import { getFootprints } from '../derive/footprint';
import { levelCentroid, outwardSide } from '../derive/meshes';
import { isOpeningVisible } from '../derive/phase';
import { getFaces } from '../derive/rooms';
import { add, pointInPolygon, polygonSignedArea, scale } from '../model/geometry';
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

/** How far inside the wall's centerline a walk through the entry door starts, inches. */
export const ENTRY_INSET = 24;

/** Where walking starts and the way the eye looks (a unit vector in plan coordinates). */
export interface WalkPose {
  at: Vec2;
  dir: Vec2;
}

const EAST: Vec2 = { x: 1, y: 0 };

/**
 * Just inside the level's entry door (REVIEW-2 C5): the first door, visible in the view mode, in an
 * exterior wall; ENTRY_INSET inside the wall's centerline at the door's centre, looking into the
 * house. The outside is the side with no closed room beside the wall when the other has one
 * (facesBesideWall), else the side away from the middle of the level's nodes (meshes.ts
 * outwardSide, the side the door fills face). Null when the level has no such door.
 */
export function entryDoorPose(plan: Plan, levelId: Id, viewMode: ViewMode): WalkPose | null {
  const level = plan.levels[levelId];
  if (!level) return null;
  const fps = getFootprints(level, viewMode);
  const faces = getFaces(level, viewMode);
  const centroid = levelCentroid(level);
  for (const o of Object.values(level.openings)) {
    if (o.type !== 'door') continue;
    const wall = level.walls[o.wallId];
    if (!wall || wall.kind !== 'exterior' || !isOpeningVisible(o, wall, viewMode)) continue;
    const fp = fps.get(wall.id);
    if (!fp) continue;
    const side = outwardSide(fp, wall, faces, centroid);
    const dir = scale(fp.normal, -side);
    const centre = add(fp.a, scale(fp.dir, o.offset));
    return { at: add(centre, scale(dir, ENTRY_INSET)), dir };
  }
  return null;
}

/**
 * Where walking starts on a level, in plan coordinates, and which way the eye looks:
 * 1. the point picked with "Walk from here" in the 2D view (`walkFrom`), when it is on this level,
 *    looking east;
 * 2. just inside the level's entry door, looking in (entryDoorPose);
 * 3. the centre of the level's outer face (the bounding box of the largest closed outline), or the
 *    middle of the largest room when that centre is inside a wall (a divider across the middle of
 *    the house), looking east;
 * 4. on a level without a closed outline, the centre of the shown levels' bounding box.
 */
export function walkStart(
  plan: Plan,
  levelId: Id,
  viewMode: ViewMode,
  levels: readonly Id[],
  walkFrom?: { levelId: Id; point: Vec2 } | null,
): WalkPose {
  if (walkFrom && walkFrom.levelId === levelId && plan.levels[levelId]) return { at: { ...walkFrom.point }, dir: EAST };
  const door = entryDoorPose(plan, levelId, viewMode);
  if (door) return door;
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
      if (!inWall) return { at: c, dir: EAST };
      const largest = [...faces.faces].sort((p, q) => q.grossArea - p.grossArea)[0];
      return { at: largest ? largest.labelPoint : c, dir: EAST };
    }
  }
  const box = planBox(plan, levels);
  return { at: { x: (box.min[0] + box.max[0]) / 2, y: (box.min[2] + box.max[2]) / 2 }, dir: EAST };
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
