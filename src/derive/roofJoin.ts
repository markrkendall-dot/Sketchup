import { stackFloorTops } from '../model/plan';
import { structureOf } from '../model/structures';
import type { Id, Plan, Roof, ViewMode } from '../model/types';
import { isVisible, phasesCoexist } from './phase';
import { joinRoof, roofBearing, roofOutlineWithOverhang, type JoinOther, type JoinRegion, type RoofOnLevel } from './roofs';

// Roofs that meet (DESIGN.md "Roofs that meet"): each roof of a building trimmed against the other
// roofs of the same building shown in the view mode, on any of its levels (roofs.ts joinRoof). The
// plan is the option view plan (optionView.ts viewPlanOf), so a roof of another option, or one
// demolished in Proposed, trims nothing. A demolished roof and a new one never stand together, so
// they never trim each other (in the All view both show, untrimmed by each other). Roofs of
// different buildings never trim each other.

/** A building's roofs on one level, joined, and every roof of the building, heights in that level's frame. */
export interface LevelRoofs {
  /** The level's roofs shown in the view mode, each with its join (null: drawn whole). */
  own: RoofOnLevel[];
  /** Every roof of the building shown in the view mode, this level's own among them. */
  building: RoofOnLevel[];
}

interface Placed {
  roof: Roof;
  levelId: Id;
  /** Absolute floor top of its level and its bearing above that floor. */
  floor: number;
  bearing: number;
  order: number;
}

interface JoinEntry {
  others: readonly Placed[];
  floor: number;
  bearing: number;
  join: JoinRegion[] | null;
}

const joinCache = new WeakMap<Roof, JoinEntry>();

/** Two grown outlines' boxes overlap (with a small pad). */
function boxesOverlap(p: Roof, q: Roof): boolean {
  const box = (r: Roof) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const v of roofOutlineWithOverhang(r)) {
      x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y);
    }
    return { x0, y0, x1, y1 };
  };
  const a = box(p);
  const b = box(q);
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** The building's roofs shown in the view, placed. */
function placedRoofs(plan: Plan, levelId: Id, viewMode: ViewMode): Placed[] {
  const s = structureOf(plan, levelId);
  const ids = s ? s.levelOrder : [levelId];
  const tops = s ? stackFloorTops(s, plan.levels) : [0];
  const out: Placed[] = [];
  ids.forEach((id, i) => {
    const level = plan.levels[id];
    if (!level) return;
    for (const roof of Object.values(level.roofs ?? {})) {
      if (!isVisible(roof.phase, viewMode)) continue;
      out.push({ roof, levelId: id, floor: tops[i] ?? 0, bearing: roofBearing(level.wallHeight, roof), order: out.length });
    }
  });
  return out;
}

/** A roof joined to the others it can meet (memoized on the roof object and what it meets). */
function joinOf(me: Placed, all: readonly Placed[]): JoinRegion[] | null {
  const others = all.filter((o) => o !== me && phasesCoexist(me.roof.phase, o.roof.phase) && boxesOverlap(me.roof, o.roof));
  const hit = joinCache.get(me.roof);
  if (
    hit &&
    hit.floor === me.floor &&
    hit.bearing === me.bearing &&
    hit.others.length === others.length &&
    hit.others.every((o, i) => o.roof === others[i].roof && o.floor === others[i].floor && o.bearing === others[i].bearing && o.order < me.order === others[i].order < me.order)
  ) {
    return hit.join;
  }
  const rel: JoinOther[] = others.map((o) => ({ roof: o.roof, bearing: o.floor + o.bearing - me.floor, wins: o.order < me.order }));
  const join = joinRoof(me.roof, me.bearing, rel);
  joinCache.set(me.roof, { others, floor: me.floor, bearing: me.bearing, join });
  return join;
}

/**
 * The level's roofs shown in the view mode, each joined to the roofs of its building it meets, and
 * every roof of the building in the level's frame (for the walls, roofs.ts wallRoofProfile caps).
 */
export function getLevelRoofs(plan: Plan, levelId: Id, viewMode: ViewMode): LevelRoofs {
  const all = placedRoofs(plan, levelId, viewMode);
  const here = all.find((p) => p.levelId === levelId)?.floor ?? floorOf(plan, levelId);
  const building: RoofOnLevel[] = all.map((p) => ({ roof: p.roof, bearing: p.floor + p.bearing - here, join: joinOf(p, all) }));
  const own = building.filter((_, i) => all[i].levelId === levelId);
  return { own, building };
}

function floorOf(plan: Plan, levelId: Id): number {
  const s = structureOf(plan, levelId);
  if (!s) return 0;
  return stackFloorTops(s, plan.levels)[s.levelOrder.indexOf(levelId)] ?? 0;
}

/** The joins of one level's roofs by roof id (for the 2D plan's valley lines). */
export function getLevelRoofJoins(plan: Plan, levelId: Id, viewMode: ViewMode): Map<Id, readonly JoinRegion[] | null> {
  const out = new Map<Id, readonly JoinRegion[] | null>();
  for (const r of getLevelRoofs(plan, levelId, viewMode).own) out.set(r.roof.id, r.join ?? null);
  return out;
}
