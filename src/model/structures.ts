// Structures (DESIGN.md "Structures"): the buildings on one site, each with its own stack of levels
// in its own coordinates. Lookups between a level and its structure, and the transform between a
// structure's coordinates and the site's. Pure: no derive or store imports.
import type { Degrees, Id, Plan, Structure, StructureKind, Vec2 } from './types';

export const STRUCTURE_KINDS: readonly StructureKind[] = ['house', 'garage', 'shed', 'other'];

export const STRUCTURE_KIND_LABEL: Record<StructureKind, string> = {
  house: 'House',
  garage: 'Garage',
  shed: 'Shed',
  other: 'Outbuilding',
};

export const isStructureKind = (v: unknown): v is StructureKind => typeof v === 'string' && (STRUCTURE_KINDS as readonly string[]).includes(v);

type StructurePlan = Pick<Plan, 'structures' | 'structureOrder'>;

/** The plan's structures in order (the first is the main building). */
export function structuresOf(plan: StructurePlan): Structure[] {
  return plan.structureOrder.map((id) => plan.structures[id]).filter((s): s is Structure => !!s);
}

/** The main building: the first structure. Every valid plan has one. */
export function firstStructure(plan: StructurePlan): Structure {
  return plan.structures[plan.structureOrder[0]];
}

/** The structure whose stack holds the level, if any. */
export function structureOf(plan: StructurePlan, levelId: Id): Structure | undefined {
  for (const id of plan.structureOrder) {
    const s = plan.structures[id];
    if (s && s.levelOrder.includes(levelId)) return s;
  }
  return undefined;
}

const NO_IDS: readonly Id[] = [];

/** The stack (levelOrder, bottom to top) the level is in; empty for a level in no structure. */
export function stackOf(plan: StructurePlan, levelId: Id): readonly Id[] {
  return structureOf(plan, levelId)?.levelOrder ?? NO_IDS;
}

/** The level under this one in its structure. */
export function levelBelowId(plan: StructurePlan, levelId: Id): Id | undefined {
  const order = stackOf(plan, levelId);
  const i = order.indexOf(levelId);
  return i > 0 ? order[i - 1] : undefined;
}

/** The level over this one in its structure. */
export function levelAboveId(plan: StructurePlan, levelId: Id): Id | undefined {
  const order = stackOf(plan, levelId);
  const i = order.indexOf(levelId);
  return i >= 0 ? order[i + 1] : undefined;
}

/** True for the lowest level of its structure (the one whose flights may start below its floor). */
export function isLowestLevel(plan: StructurePlan, levelId: Id): boolean {
  return stackOf(plan, levelId)[0] === levelId;
}

const allMemo = new WeakMap<object, Id[]>();

/**
 * Every level of the plan: each structure's stack, bottom to top, in structure order. The same
 * array while the list is unchanged (compared by content, so an in-place edit is never missed).
 */
export function allLevelIds(plan: StructurePlan): Id[] {
  const ids = structuresOf(plan).flatMap((s) => s.levelOrder);
  const hit = allMemo.get(plan.structures);
  if (hit && hit.length === ids.length && hit.every((id, i) => id === ids[i])) return hit;
  allMemo.set(plan.structures, ids);
  return ids;
}

/** A transform between a structure's coordinates and the site's. */
export type Placement = Pick<Structure, 'origin' | 'rotation'>;

export const IDENTITY_PLACEMENT: Placement = { origin: { x: 0, y: 0 }, rotation: 0 };

const turn = (p: Vec2, deg: Degrees): Vec2 => {
  if (deg === 0) return { x: p.x, y: p.y };
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

/** A point in the structure's coordinates, on the site: turned by rotation (clockwise on the plan), then moved to origin. */
export function toSite(s: Placement, p: Vec2): Vec2 {
  const q = turn(p, s.rotation);
  return { x: q.x + s.origin.x, y: q.y + s.origin.y };
}

/** A site point in the structure's coordinates (toSite's inverse). */
export function toLocal(s: Placement, p: Vec2): Vec2 {
  return turn({ x: p.x - s.origin.x, y: p.y - s.origin.y }, -s.rotation);
}

/** A point in `from`'s coordinates in `to`'s (the ghost of another structure on the one being edited). */
export function between(from: Placement, to: Placement, p: Vec2): Vec2 {
  return toLocal(to, toSite(from, p));
}

export const isIdentity = (s: Placement): boolean => s.origin.x === 0 && s.origin.y === 0 && s.rotation % 360 === 0;

/** The SVG transform that draws `from`'s coordinates in `to`'s (identity: undefined). */
export function svgTransform(from: Placement, to: Placement = IDENTITY_PLACEMENT): string | undefined {
  if (from === to) return undefined;
  // to^-1 * from: rotate(-to.rotation) translate(-to.origin) translate(from.origin) rotate(from.rotation)
  const parts: string[] = [];
  if (to.rotation % 360 !== 0) parts.push(`rotate(${-to.rotation})`);
  const dx = from.origin.x - to.origin.x;
  const dy = from.origin.y - to.origin.y;
  if (dx !== 0 || dy !== 0) parts.push(`translate(${dx} ${dy})`);
  if (from.rotation % 360 !== 0) parts.push(`rotate(${from.rotation})`);
  return parts.length ? parts.join(' ') : undefined;
}

/** Normalize an angle to [0, 360). */
export function normalizeDegrees(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r === 0 ? 0 : r;
}
