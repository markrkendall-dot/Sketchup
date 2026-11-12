// Adding, deleting and moving levels (DESIGN.md "Levels"). Each function edits a plan in place (the
// store passes an immer draft) and keeps what depends on a level's place in the stack valid.
import { floorToFloor, stairsHeightProblem } from '../derive/stairs';
import { createLevel, stackFloorTops } from './plan';
import { structureOf, structuresOf } from './structures';
import type { Id, Plan, Structure } from './types';

/** Where a new level goes: above the top, below the bottom, or just above or below a level. */
export type LevelPosition = 'top' | 'bottom' | { above: Id } | { below: Id };

/** A framed floor's thickness, for a level put over the lowest one (whose own floor is a slab). */
export const FRAMED_FLOOR = 12;

/** What a level edit did: the level it added or affected, and what it had to change to stay valid. */
export interface LevelEdit {
  id: Id;
  adjusted: string[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Keep what depends on a level's place in the stack valid (the rules migrate applies on load):
 * - only the lowest level's flights may start below its floor, so a flight elsewhere with a
 *   negative base starts at its floor;
 * - only a post on the lowest level stands on a footing, so posts elsewhere lose theirs;
 * - a flight whose set climb no longer fits under the floor above (the floor-to-floor height
 *   changed) climbs to the floor above again (its `rise` is dropped, then its `base`).
 * Returns a sentence per kind of change, naming the level.
 */
export function fitLevelsToOrder(plan: Plan): string[] {
  const out: string[] = [];
  for (const s of structuresOf(plan)) fitStack(plan, s, out);
  return out;
}

function fitStack(plan: Plan, structure: Structure, out: string[]): void {
  structure.levelOrder.forEach((levelId, i) => {
    const level = plan.levels[levelId];
    if (!level) return;
    const lowest = i === 0;
    const ftf = floorToFloor(plan, levelId);
    let flights = 0;
    let footings = 0;
    for (const s of Object.values(level.stairs)) {
      let changed = false;
      if (!lowest && s.base !== undefined && s.base < 0) {
        delete s.base;
        changed = true;
      }
      if (stairsHeightProblem(s, ftf, lowest) && s.rise !== undefined) {
        delete s.rise;
        changed = true;
      }
      if (stairsHeightProblem(s, ftf, lowest) && s.base !== undefined) {
        delete s.base;
        changed = true;
      }
      if (changed) flights++;
    }
    if (!lowest) {
      for (const m of Object.values(level.members)) {
        if (m.kind === 'post' && m.footing) {
          delete m.footing;
          footings++;
        }
      }
    }
    if (flights) out.push(`${plural(flights, 'flight', 'flights')} on ${level.name} now ${flights === 1 ? 'climbs' : 'climb'} from its floor to the floor above`);
    if (footings) out.push(`${plural(footings, 'post', 'posts')} on ${level.name} lost ${footings === 1 ? 'its footing' : 'their footings'} (only the lowest level's posts have one)`);
  });
}

/** A level name not used yet in the structure: `base`, else `base 2`, `base 3`... */
function freshName(plan: Plan, structure: Structure, base: string): string {
  const used = new Set(structure.levelOrder.map((id) => plan.levels[id]?.name.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/**
 * Add an empty level to a structure's stack (`structureId`; the main structure when omitted, or the
 * structure of the level the position names). Its wall height is the neighbour's (the level under it, or over it when it
 * goes at the bottom); its floor thickness is the floor that was there: the level over it keeps
 * its own, so the new one takes the floor of the level above it, else (on top) the level below's,
 * or FRAMED_FLOOR when that is the lowest level's slab. At the bottom it takes the old lowest
 * level's slab, and baseFloorElevation drops by the new level's wall height plus the old lowest's
 * floor thickness, so every existing level keeps its elevation. Elsewhere the levels above it rise.
 * Null when the position names a level that is not in the plan.
 */
export function addLevelTo(plan: Plan, position: LevelPosition, name?: string, structureId?: Id): LevelEdit | null {
  const named = typeof position === 'object' ? ('above' in position ? position.above : position.below) : undefined;
  const structure = named !== undefined ? structureOf(plan, named) : plan.structures[structureId ?? plan.structureOrder[0]];
  if (!structure || (structureId !== undefined && structure.id !== structureId)) return null;
  const order = structure.levelOrder;
  let at: number; // index the new level takes
  if (position === 'top') at = order.length;
  else if (position === 'bottom') at = 0;
  else if ('above' in position) {
    const i = order.indexOf(position.above);
    if (i < 0) return null;
    at = i + 1;
  } else {
    const i = order.indexOf(position.below);
    if (i < 0) return null;
    at = i;
  }
  const below = plan.levels[order[at - 1]];
  const above = plan.levels[order[at]];
  const neighbour = below ?? above;
  const wallHeight = neighbour?.wallHeight ?? 96;
  let floorThickness: number;
  if (at === 0) floorThickness = above?.floorThickness ?? 4;
  else if (above) floorThickness = above.floorThickness;
  else floorThickness = at - 1 === 0 ? FRAMED_FLOOR : below.floorThickness;
  const fallback = at === 0 ? 'Basement' : at === order.length ? `Level ${order.length + 1}` : 'New Level';
  const level = createLevel(name?.trim() || freshName(plan, structure, fallback), wallHeight, floorThickness);
  if (at === 0 && above) structure.baseFloorElevation -= level.wallHeight + above.floorThickness;
  plan.levels[level.id] = level;
  order.splice(at, 0, level.id);
  return { id: level.id, adjusted: fitLevelsToOrder(plan) };
}

/**
 * Delete a level and everything on it. Refused (null) for the last remaining level of its structure
 * or one not in the plan. Deleting the lowest level keeps the others where they were (the structure's baseFloorElevation becomes
 * the next level's floor top); deleting another brings the levels above it down. The result's id
 * is the deleted level's.
 */
export function deleteLevelFrom(plan: Plan, levelId: Id): LevelEdit | null {
  const structure = structureOf(plan, levelId);
  if (!structure) return null;
  const i = structure.levelOrder.indexOf(levelId);
  if (structure.levelOrder.length < 2) return null;
  if (i === 0) structure.baseFloorElevation = stackFloorTops(structure, plan.levels)[1];
  structure.levelOrder.splice(i, 1);
  delete plan.levels[levelId];
  return { id: levelId, adjusted: fitLevelsToOrder(plan) };
}

/**
 * Move a level one place up or down its structure's stack (swap it with its neighbour). baseFloorElevation
 * stays: it is the floor top of whichever level is lowest. Null when there is nowhere to move.
 */
export function moveLevelIn(plan: Plan, levelId: Id, direction: 'up' | 'down'): LevelEdit | null {
  const order = structureOf(plan, levelId)?.levelOrder;
  if (!order) return null;
  const i = order.indexOf(levelId);
  const j = direction === 'up' ? i + 1 : i - 1;
  if (j < 0 || j >= order.length) return null;
  [order[i], order[j]] = [order[j], order[i]];
  return { id: levelId, adjusted: fitLevelsToOrder(plan) };
}

/** How much is on a level (for the delete confirmation): every kind of element counted together. */
export function levelContentCount(plan: Plan, levelId: Id): number {
  const l = plan.levels[levelId];
  if (!l) return 0;
  const kinds = [l.walls, l.openings, l.rooms, l.stairs, l.roofs, l.fixtures, l.decks, l.floorOpenings, l.joistZones, l.members];
  return kinds.reduce((n, r) => n + Object.keys(r).length, 0) + (l.underlay ? 1 : 0);
}
