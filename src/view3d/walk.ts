import { getDeckLayout, type DeckBox } from '../derive/decks';
import { floorOpeningHoles, getFloorOpeningLayout } from '../derive/floorOpenings';
import { getLevelElevations } from '../derive/levels';
import { getFootprints } from '../derive/footprint';
import { levelCentroid, outwardSide } from '../derive/meshes';
import { isOpeningVisible, isVisible } from '../derive/phase';
import { getFaces, slabOutlines } from '../derive/rooms';
import { groundAt } from '../derive/site';
import { getStaircaseLayout, heightAt } from '../derive/staircase';
import { flightSteps, floorToFloor, stairsBase, stairsFrame, stairsHoleOutline, stairsOutline, stairsPoint } from '../derive/stairs';
import { add, dist, dot, pointInPolygon, polygonSignedArea, projectPointToSegment, scale, sub } from '../model/geometry';
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

// ---------------------------------------------------------------------------------------------
// Walking on what is there (DESIGN.md "3D", walk mode): the feet stand on the highest surface
// within a step of them (floors less their holes, treads and landings, deck boards, the ground
// outside), climb a step up to STEP_UP, fall to what is below, and are stopped by what stands in
// the way between a step and the waist (stair sides, guards, rails, deck edges). Walls stay
// walk-through, as in the orbit view's cutaway: the walk is for looking, not a collision game.

/** The highest step the walker climbs, inches. */
export const STEP_UP = 9;
/** What the walker bumps into: anything between a step up and this over the feet, inches. */
export const BODY_HEIGHT = 48;
/** How close the walker comes to a rail or guard, inches. */
export const BODY_RADIUS = 6;
/** The longest piece a move is cut into, so a fast step does not pass through a rail, inches. */
const SUBSTEP = 2;
/** A lone flight's railing over its nosings, inches (DESIGN.md "Stair railings"). */
const DECK_RAIL_HEIGHT = 36;
/** How fast the eye follows the feet up and down (per second, as a fraction of the gap). */
export const EYE_EASE = 12;

type Height = (p: Vec2) => number;

interface Shape {
  poly: Vec2[];
  holes?: Vec2[][];
  /** Bounding box, for a quick miss. */
  box: [number, number, number, number];
}

/** A surface to stand on: its top (absolute) over its outline. */
export interface WalkSurface extends Shape {
  top: Height;
}

/** Something in the way: from bottom to top (absolute) over its outline, kept `pad` away from. */
export interface WalkObstacle extends Shape {
  bottom: Height;
  top: Height;
  pad: number;
}

export interface WalkWorld {
  surfaces: WalkSurface[];
  obstacles: WalkObstacle[];
  /** The ground's height outside the house (null inside it). */
  ground: (p: Vec2) => number | null;
}

const shape = (poly: Vec2[], holes?: Vec2[][]): Shape => {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return { poly, ...(holes?.length ? { holes } : {}), box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
};
const flat = (z: number): Height => () => z;

function inShape(s: Shape, p: Vec2, pad = 0): boolean {
  const [x0, y0, x1, y1] = s.box;
  if (p.x < x0 - pad || p.x > x1 + pad || p.y < y0 - pad || p.y > y1 + pad) return false;
  if (pointInPolygon(p, s.poly)) return !s.holes?.some((h) => pointInPolygon(p, h));
  if (pad <= 0) return false;
  return s.poly.some((q, i) => projectPointToSegment(p, q, s.poly[(i + 1) % s.poly.length]).distance <= pad);
}

const worldCache = new WeakMap<Plan, Map<string, WalkWorld>>();

/** The surfaces and obstacles of the levels one walks on, in a view (memoized per plan). */
export function walkWorld(plan: Plan, viewMode: ViewMode, levels: readonly Id[]): WalkWorld {
  let byKey = worldCache.get(plan);
  if (!byKey) worldCache.set(plan, (byKey = new Map()));
  const key = `${viewMode}|${levels.join(',')}`;
  const hit = byKey.get(key);
  if (hit) return hit;
  const elev = getLevelElevations(plan);
  const surfaces: WalkSurface[] = [];
  const obstacles: WalkObstacle[] = [];
  const box = (b: DeckBox, z: number, pad = 0): WalkObstacle => ({ ...shape(b.poly, b.holes), bottom: flat(z + b.bottom), top: flat(z + b.top), pad });
  const footprints: Vec2[][] = [];
  for (const id of plan.levelOrder) {
    const level = plan.levels[id];
    if (level) footprints.push(...slabOutlines(getFaces(level, viewMode), true));
  }
  for (const id of levels) {
    const level = plan.levels[id];
    const z = elev[id]?.floorTop;
    if (!level || z === undefined) continue;
    // The floor, less its openings and the holes the flights below cut in it.
    const i = plan.levelOrder.indexOf(id);
    const below = plan.levels[plan.levelOrder[i - 1]];
    const holes = floorOpeningHoles(plan, id, viewMode);
    if (below) {
      const ftf = floorToFloor(plan, below.id);
      for (const s of Object.values(below.stairs)) {
        if (!s.cutsFloorAbove || !isVisible(s.phase, viewMode)) continue;
        const hole = stairsHoleOutline(s, ftf, below.wallHeight);
        if (hole) holes.push(hole);
      }
    }
    for (const poly of slabOutlines(getFaces(level, viewMode), true)) surfaces.push({ ...shape(poly, holes), top: flat(z) });
    // Stairs: a staircase's solids as they are drawn; a flight on its own, tread by tread.
    const ftf = floorToFloor(plan, id);
    const seen = new Set<Id>();
    for (const sc of Object.values(level.staircases ?? {})) {
      const layout = getStaircaseLayout(plan, id, sc.id, viewMode);
      if (!layout) continue;
      for (const m of layout.members) seen.add(m);
      for (const sol of layout.solids) {
        const top = (p: Vec2) => z + heightAt(sol.zt, p);
        if (sol.group === 'stair') surfaces.push({ ...shape(sol.poly), top });
        obstacles.push({ ...shape(sol.poly), bottom: (p) => z + heightAt(sol.zb, p), top, pad: sol.group === 'rail' ? BODY_RADIUS : 0 });
      }
    }
    for (const s of Object.values(level.stairs)) {
      if (seen.has(s.id) || !isVisible(s.phase, viewMode) || s.width <= 0 || s.run <= 0) continue;
      const { risers, rise } = flightSteps(s, ftf);
      const base = z + stairsBase(s);
      const f = stairsFrame(s);
      const tread = s.run / risers;
      const along = (p: Vec2) => dot(sub(p, f.origin), f.u);
      const top = (p: Vec2) => base + Math.min(risers, Math.floor(Math.max(0, along(p)) / tread) + 1) * rise;
      const outline = stairsOutline(s);
      surfaces.push({ ...shape(outline), top });
      obstacles.push({ ...shape(outline), bottom: flat(s.open ? base : z), top, pad: 0 });
      for (const [side, sgn] of [['left', -1], ['right', 1]] as const) {
        if (!s.railings?.[side]) continue;
        const h = (sgn * s.width) / 2;
        const rail = [stairsPoint(f, 0, h - sgn), stairsPoint(f, s.run, h - sgn), stairsPoint(f, s.run, h), stairsPoint(f, 0, h)];
        obstacles.push({ ...shape(rail), bottom: top, top: (p) => top(p) + DECK_RAIL_HEIGHT, pad: BODY_RADIUS });
      }
    }
    // Decks: their boards to stand on; their edges, railings and posts in the way.
    for (const d of Object.values(level.decks ?? {})) {
      if (!isVisible(d.phase, viewMode)) continue;
      const layout = getDeckLayout(plan, id, d.id, viewMode);
      if (!layout) continue;
      surfaces.push({ ...shape(layout.boards.poly, layout.boards.holes), top: flat(z + layout.boards.top) });
      obstacles.push(box(layout.boards, z));
      for (const r of layout.railing) obstacles.push(box(r, z, BODY_RADIUS));
    }
    // The guards round floor openings.
    for (const o of Object.values(level.floorOpenings ?? {})) {
      if (!isVisible(o.phase, viewMode)) continue;
      const layout = getFloorOpeningLayout(plan, id, o.id, viewMode);
      for (const r of [...(layout?.railing ?? []), ...(layout?.rail ?? [])]) obstacles.push(box(r, z, BODY_RADIUS));
    }
  }
  const world: WalkWorld = {
    surfaces,
    obstacles,
    ground: (p) => (footprints.some((f) => pointInPolygon(p, f)) ? null : groundAt(plan, p)),
  };
  byKey.set(key, world);
  return world;
}

/** The surface the feet stand on at p: the highest within STEP_UP over `feet`, or null (none). */
export function surfaceAt(world: WalkWorld, p: Vec2, feet: number): number | null {
  let best: number | null = null;
  const reach = feet + STEP_UP + 1e-6;
  const g = world.ground(p);
  if (g !== null && g <= reach) best = g;
  for (const s of world.surfaces) {
    if (!inShape(s, p)) continue;
    const t = s.top(p);
    if (t <= reach && (best === null || t > best)) best = t;
  }
  return best;
}

/** Whether something stands in the way at p for feet at `feet` (between a step up and the waist). */
export function blockedAt(world: WalkWorld, p: Vec2, feet: number): boolean {
  const lo = feet + STEP_UP + 1e-6;
  const hi = feet + BODY_HEIGHT;
  return world.obstacles.some((o) => inShape(o, p, o.pad) && o.top(p) > lo && o.bottom(p) < hi);
}

export interface WalkState {
  at: Vec2;
  /** The feet's elevation (absolute). */
  feet: number;
}

/**
 * One move from `from` toward `to`, in pieces of SUBSTEP: each piece goes where it is not blocked
 * and there is something to stand on, sliding along x or y alone when the straight way is
 * blocked; the feet go up a step or down to what is below.
 */
export function walkMove(world: WalkWorld, from: WalkState, to: Vec2): WalkState {
  let at = from.at;
  let feet = from.feet;
  const total = dist(at, to);
  const n = Math.max(1, Math.ceil(total / SUBSTEP));
  const step = scale(sub(to, at), 1 / n);
  const tryTo = (p: Vec2): boolean => {
    if (blockedAt(world, p, feet)) return false;
    const s = surfaceAt(world, p, feet);
    if (s === null) return false;
    at = p;
    feet = s;
    return true;
  };
  for (let k = 0; k < n; k++) {
    if (tryTo(add(at, step))) continue;
    if (step.x && tryTo(add(at, { x: step.x, y: 0 }))) continue;
    if (step.y && tryTo(add(at, { x: 0, y: step.y }))) continue;
    break;
  }
  return { at, feet };
}

/** The level the feet are on: the highest walkable level whose floor is not above them. */
export function levelAtFeet(plan: Plan, levels: readonly Id[], feet: number): Id | undefined {
  const elev = getLevelElevations(plan);
  let best: Id | undefined;
  for (const id of levels) {
    const z = elev[id]?.floorTop;
    if (z !== undefined && z <= feet + 1) best = id;
  }
  return best ?? levels[0];
}
