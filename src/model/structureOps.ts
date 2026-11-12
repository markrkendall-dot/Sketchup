// Adding, deleting and placing structures (DESIGN.md "Structures"). Each function edits a plan in
// place (the store passes an immer draft).
import { boundsOf, type Bounds } from './geometry';
import { createStructure, newId, templateLevels } from './plan';
import { normalizeDegrees, STRUCTURE_KIND_LABEL, structuresOf, toSite } from './structures';
import type { Id, Level, Phase, Plan, Roof, Structure, StructureKind, Vec2 } from './types';

/** What a new structure starts with: its levels' template and, for a garage or shed, a starter box. */
export interface StructurePreset {
  /** Plan template its levels come from (model/plan.ts createEmptyPlan). */
  template: 'single' | 'twoStorey' | 'basementTwoStorey' | 'outbuilding';
  /** Name of its (single) level, when not the template's. */
  levelName?: string;
  /** A rectangle of exterior walls (width along x, depth along y) with a door in its front (+y) wall and a gable roof. */
  box?: { width: number; depth: number; door: { type: 'door' | 'passage'; width: number; height: number } };
}

/**
 * The presets: a garage is one 84" storey on a 4" slab (the outbuilding template) with a 24' x 24'
 * box, a 16' x 6'8" opening for the car door (a passage: there is no overhead door type) and a gable
 * roof; a shed is the same storey with a 10' x 12' box and a 36" door; a house is one storey on a
 * slab (the single template), and other is the outbuilding storey with nothing on it.
 */
export const STRUCTURE_PRESETS: Record<StructureKind, StructurePreset> = {
  house: { template: 'single' },
  garage: { template: 'outbuilding', levelName: 'Garage', box: { width: 288, depth: 288, door: { type: 'passage', width: 192, height: 80 } } },
  shed: { template: 'outbuilding', levelName: 'Shed', box: { width: 144, depth: 120, door: { type: 'door', width: 36, height: 80 } } },
  other: { template: 'outbuilding' },
};

/** The gap left between a new structure and the others (10'). */
export const STRUCTURE_GAP = 120;

/** A structure's extent on the site: its levels' nodes and roof and deck outlines, placed. Null when it is empty. */
export function structureSiteBounds(plan: Pick<Plan, 'levels'>, s: Structure): Bounds | null {
  const pts: Vec2[] = [];
  for (const id of s.levelOrder) {
    const level = plan.levels[id];
    if (!level) continue;
    for (const n of Object.values(level.nodes)) pts.push(toSite(s, n));
    for (const r of Object.values(level.roofs)) for (const p of r.outline) pts.push(toSite(s, p));
    for (const d of Object.values(level.decks)) for (const p of d.outline) pts.push(toSite(s, p));
  }
  return boundsOf(pts);
}

/** Where a new structure goes by default: STRUCTURE_GAP to the right of everything built, level with its top. */
export function clearOrigin(plan: Pick<Plan, 'levels' | 'structures' | 'structureOrder'>): Vec2 {
  const boxes = structuresOf(plan)
    .map((s) => structureSiteBounds(plan, s))
    .filter((b): b is Bounds => !!b);
  if (boxes.length === 0) return { x: 0, y: 0 };
  const maxX = Math.max(...boxes.map((b) => b.maxX));
  const minY = Math.min(...boxes.map((b) => b.minY));
  return { x: Math.round(maxX + STRUCTURE_GAP), y: Math.round(minY) };
}

/** A rectangle of exterior walls with its door and a gable roof on the walls' outside faces (STRUCTURE_PRESETS). */
function addBox(level: Level, box: NonNullable<StructurePreset['box']>, thickness: number, phase: Phase): void {
  const { width: w, depth: d } = box;
  const corners: Vec2[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: d },
    { x: 0, y: d },
  ];
  const nodes = corners.map((p) => ({ id: newId(), x: p.x, y: p.y }));
  for (const n of nodes) level.nodes[n.id] = n;
  const walls = nodes.map((n, i) => ({ id: newId(), a: n.id, b: nodes[(i + 1) % 4].id, thickness, kind: 'exterior' as const, phase }));
  for (const wall of walls) level.walls[wall.id] = wall;
  // The front wall runs (w, d) -> (0, d); its middle is half its length from a.
  const front = walls[2];
  const door = { id: newId(), wallId: front.id, type: box.door.type, offset: w / 2, width: box.door.width, height: Math.min(box.door.height, level.wallHeight), sill: 0, phase };
  level.openings[door.id] = door;
  const h = thickness / 2;
  const roof: Roof = {
    id: newId(),
    shape: 'gable',
    outline: [
      { x: -h, y: -h },
      { x: w + h, y: -h },
      { x: w + h, y: d + h },
      { x: -h, y: d + h },
    ],
    // Ridge across the door: the gable end faces the front.
    ridgeAngle: 90,
    pitch: 6,
    overhang: 12,
    bearingOffset: 0,
    thickness: 6,
    fascia: 6,
    phase,
    finish: 'shingle',
  };
  level.roofs[roof.id] = roof;
}

export interface NewStructure {
  kind: StructureKind;
  name?: string;
  /** Default: clear of the others (clearOrigin). */
  origin?: Vec2;
  rotation?: number;
  /** Default true: a garage or shed gets its starter box. */
  starter?: boolean;
  /** The starter box's phase (default existing). */
  phase?: Phase;
}

/**
 * Add a structure with its preset's levels (and starter box), placed clear of the others unless an
 * origin is given. Returns it, with its levels in plan.levels.
 */
export function addStructureTo(plan: Plan, input: NewStructure): Structure {
  const preset = STRUCTURE_PRESETS[input.kind];
  const { levels, base } = templateLevels(preset.template);
  if (preset.levelName && levels.length === 1) levels[0].name = preset.levelName;
  if (preset.box && input.starter !== false) addBox(levels[0], preset.box, plan.settings.defaultExteriorThickness, input.phase ?? 'existing');
  const name = input.name?.trim() || freshStructureName(plan, STRUCTURE_KIND_LABEL[input.kind]);
  const origin = input.origin ?? clearOrigin(plan);
  const s = createStructure(name, input.kind, levels, base, { origin, rotation: normalizeDegrees(input.rotation ?? 0) });
  for (const l of levels) plan.levels[l.id] = l;
  plan.structures[s.id] = s;
  plan.structureOrder.push(s.id);
  return s;
}

/** A structure name not used yet: `base`, else `base 2`, `base 3`... */
export function freshStructureName(plan: Pick<Plan, 'structures' | 'structureOrder'>, base: string): string {
  const used = new Set(structuresOf(plan).map((s) => s.name.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/** Delete a structure and its levels. Refused (false) for the last structure or one not in the plan. */
export function deleteStructureFrom(plan: Plan, id: Id): boolean {
  const s = plan.structures[id];
  if (!s || plan.structureOrder.length < 2) return false;
  for (const lid of s.levelOrder) delete plan.levels[lid];
  delete plan.structures[id];
  plan.structureOrder.splice(plan.structureOrder.indexOf(id), 1);
  return true;
}

export type StructurePatch = Partial<Pick<Structure, 'name' | 'kind' | 'origin' | 'rotation' | 'baseFloorElevation'>>;

/** Why a structure patch is refused, or null. */
export function structurePatchProblem(patch: StructurePatch): string | null {
  if (patch.name !== undefined && !patch.name.trim()) return 'A structure needs a name';
  if (patch.origin && !(Number.isFinite(patch.origin.x) && Number.isFinite(patch.origin.y))) return 'The position must be a number';
  if (patch.rotation !== undefined && !Number.isFinite(patch.rotation)) return 'The rotation must be a number';
  if (patch.baseFloorElevation !== undefined && !Number.isFinite(patch.baseFloorElevation)) return 'The floor elevation must be a number';
  return null;
}

/** How much is in a structure (for the delete confirmation): every element on its levels. */
export function structureContentCount(plan: Plan, id: Id, count: (plan: Plan, levelId: Id) => number): number {
  const s = plan.structures[id];
  return s ? s.levelOrder.reduce((n, lid) => n + count(plan, lid), 0) : 0;
}

