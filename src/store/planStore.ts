import { create, useStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import { dist } from '../model/geometry';
import { coreInterval, draftFootprints } from '../derive/openings';
import { clampOpeningHeight, clampOpeningOffset, openingFitsHeight, wallHeightOf } from '../model/openings';
import {
  clampOpenings,
  columnProblem,
  createEmptyPlan,
  roofProblem,
  findNodeNear,
  MERGE_EPS,
  movesCreateOverlap,
  newId,
  normalizeLevel,
  WALL_OVERLAP_MESSAGE,
  wallLength,
  wallOverlapping,
} from '../model/plan';
import { planWallOffset, wallShift, type WallSide } from '../model/offset';
import type { Column, GradePoint, Id, Level, Opening, Phase, Plan, PlanSettings, Roof, Room, Site, Stairs, Underlay, Vec2, Wall, WallKind } from '../model/types';
import { normalizeDegrees, stairsRunOk, stairsWidthOk } from '../derive/stairs';
import { useUiStore } from './uiStore';
import { isValidUnderlay, normalizeRotation } from '../model/underlay';

export interface AddWallOptions {
  kind: WallKind;
  thickness: number;
  phase: Phase;
}

export interface AddWallResult {
  /** Final node ids of the wall's ends after normalization (may be existing nodes). */
  a: Id;
  b: Id;
  /** Ids of the walls now covering the new segment (more than one if it was split). */
  wallIds: Id[];
  /** True when `b` was an existing node rather than a newly created one. */
  bWasExisting: boolean;
}

export type WallPatch = Partial<Omit<Wall, 'id'>>;
export type OpeningPatch = Partial<Omit<Opening, 'id'>>;
export type NewOpening = Omit<Opening, 'id'> & { id?: Id };
export type RoomPatch = Partial<Omit<Room, 'id'>>;
export type NewRoom = Omit<Room, 'id'> & { id?: Id };
export type StairsPatch = Partial<Omit<Stairs, 'id'>>;
export type NewStairs = Omit<Stairs, 'id'> & { id?: Id };
export type RoofPatch = Partial<Omit<Roof, 'id'>>;
export type NewRoof = Omit<Roof, 'id'> & { id?: Id };
export type GradePointPatch = Partial<Omit<GradePoint, 'id'>>;
export type NewGradePoint = Omit<GradePoint, 'id'> & { id?: Id };
export type ColumnPatch = Partial<Omit<Column, 'id'>>;
export type NewColumn = Omit<Column, 'id'> & { id?: Id };
export type UnderlayPatch = Partial<Underlay>;
export type LevelPatch = Partial<Pick<Level, 'name' | 'wallHeight' | 'floorThickness'>>;
/** Which end of a wall stays put when its length is edited. */
export type LengthAnchor = 'start' | 'end';

export interface EntitySelection {
  nodes: Id[];
  walls: Id[];
  openings?: Id[];
  rooms?: Id[];
  stairs?: Id[];
  roofs?: Id[];
  /** Site elements (plan.site); the level id the action is given only scopes the other kinds. */
  gradePoints?: Id[];
  columns?: Id[];
}

export interface PlanState {
  plan: Plan;
  setPlan: (plan: Plan) => void;
  renamePlan: (name: string) => void;
  /**
   * Add a wall between two points or nodes and normalize the level. Null when it is degenerate or
   * would lie on top of a wall already there (then the draft message says so).
   */
  addWall: (levelId: Id, a: Vec2 | Id, b: Vec2 | Id, opts: AddWallOptions) => AddWallResult | null;
  /**
   * Add several walls in one undo step, all or nothing: null (and no change) when any of them is
   * degenerate or would lie on top of a wall already there (the draft message then says so).
   */
  addWalls: (levelId: Id, segments: readonly { a: Vec2 | Id; b: Vec2 | Id }[], opts: AddWallOptions) => AddWallResult[] | null;
  /**
   * Move walls sideways by `distance` to one side of each wall (relative to its a->b direction),
   * dragging their neighbours along (model/offset.ts), in one undo step. Returns null when done,
   * else why not (nothing changes).
   */
  offsetWalls: (levelId: Id, ids: readonly Id[], distance: number, side: WallSide) => string | null;
  /** Like offsetWalls with a shift vector per wall (perpendicular to it). Null when done, else why not. */
  shiftWalls: (levelId: Id, shifts: Record<Id, Vec2>) => string | null;
  moveNode: (levelId: Id, nodeId: Id, pos: Vec2, opts?: { normalize?: boolean }) => void;
  /** Move nodes; a move that would lay a wall on top of another wall is refused (nothing changes). */
  moveNodes: (levelId: Id, positions: Record<Id, Vec2>, opts?: { normalize?: boolean }) => void;
  /** Run normalize() on a level; used at the end of an untracked drag. */
  normalize: (levelId: Id, moved?: Id[]) => void;
  deleteWalls: (levelId: Id, ids: Id[]) => void;
  deleteNodes: (levelId: Id, ids: Id[]) => void;
  /** Delete nodes (with their walls), walls (with their openings) and openings in one undo step. */
  deleteEntities: (levelId: Id, sel: EntitySelection) => void;
  updateWall: (levelId: Id, id: Id, patch: WallPatch) => void;
  /** Patch several walls at once (phase, thickness, heightOverride...). Not for a/b. */
  updateWalls: (levelId: Id, ids: Id[], patch: Omit<WallPatch, 'a' | 'b'>) => void;
  /**
   * Change wall kind. A wall whose thickness is still the default for its old kind gets the
   * default for the new kind; a customized thickness is kept.
   */
  setWallKind: (levelId: Id, ids: Id[], kind: WallKind) => void;
  /**
   * Set a wall's centerline length by moving one end along the wall direction: node b when
   * anchor is 'start' (default), node a when 'end'. Openings keep their distance from the fixed
   * end, then are clamped. Returns false when the length is not usable.
   */
  setWallLength: (levelId: Id, wallId: Id, length: number, anchor?: LengthAnchor) => boolean;
  /** Validate, clamp the offset, and add. Returns the new id, or null if it does not fit. */
  addOpening: (levelId: Id, opening: NewOpening) => Id | null;
  /** Patch an opening; the offset is re-clamped to its wall. */
  updateOpening: (levelId: Id, id: Id, patch: OpeningPatch) => void;
  deleteOpenings: (levelId: Id, ids: Id[]) => void;
  /** Add a room label; returns its id, or null when the name is blank or the anchor is not finite. */
  addRoom: (levelId: Id, room: NewRoom) => Id | null;
  /** Rename or move a room. A blank name or non-finite anchor is ignored. */
  updateRoom: (levelId: Id, id: Id, patch: RoomPatch) => void;
  deleteRooms: (levelId: Id, ids: Id[]) => void;
  /** Add stairs; returns the id, or null when the size or position is not usable. */
  addStairs: (levelId: Id, stairs: NewStairs) => Id | null;
  /**
   * Patch stairs; invalid sizes are rejected, the direction is normalized to [0, 360). `headroom`
   * and `holeStart` take undefined to clear them.
   */
  updateStairs: (levelId: Id, id: Id, patch: StairsPatch) => void;
  deleteStairs: (levelId: Id, ids: Id[]) => void;
  /** Add a roof; returns the id, or null when its outline or sizes are not usable. */
  addRoof: (levelId: Id, roof: NewRoof) => Id | null;
  /** Patch a roof; an unusable outline or size is rejected, the ridge angle is normalized to [0, 360). */
  updateRoof: (levelId: Id, id: Id, patch: RoofPatch) => void;
  deleteRoofs: (levelId: Id, ids: Id[]) => void;
  /** Add a grade point (a spot elevation of the ground); returns the id, or null for a non-finite value. */
  addGradePoint: (point: NewGradePoint) => Id | null;
  /** Move a grade point or change its elevation. */
  updateGradePoint: (id: Id, patch: GradePointPatch) => void;
  deleteGradePoints: (ids: Id[]) => void;
  /** Add a post or chimney; returns the id, or null when its size or heights are not usable. */
  addColumn: (column: NewColumn) => Id | null;
  /** Patch a column; an unusable size or height (top not above base) is rejected, the rotation is normalized to [0, 360). */
  updateColumn: (id: Id, patch: ColumnPatch) => void;
  deleteColumns: (ids: Id[]) => void;
  /** Move grade points and columns to new positions in one set (a drag of the site selection). */
  moveSiteItems: (points: Record<Id, Vec2>, columns: Record<Id, Vec2>) => void;
  /** Turn the plan relative to true north (normalized to [0, 360)). */
  setNorthAngle: (degrees: number) => void;
  /** Delete every grade point (the terrain goes flat again) in one undo step. */
  clearGradePoints: () => void;
  /** Set the phase of walls, openings, stairs, roofs and columns together (e.g. "Mark demolish"). */
  setPhase: (levelId: Id, sel: { walls: Id[]; openings: Id[]; stairs?: Id[]; roofs?: Id[]; columns?: Id[] }, phase: Phase) => void;
  /**
   * Copy the nodes and walls (not openings) of one level into another, merged with whatever is
   * there, in one undo step. Walls that would lie on top of a wall already on the target level
   * are skipped. Returns how many walls were copied and how many were skipped.
   */
  copyWallsFromLevel: (fromId: Id, toId: Id) => { copied: number; skipped: number };
  updateSettings: (patch: Partial<PlanSettings>) => void;
  renameLevel: (levelId: Id, name: string) => void;
  updateLevel: (levelId: Id, patch: LevelPatch) => void;
  setBaseFloorElevation: (elevation: number) => void;
  /** Put an image under a level, replacing any there, or remove it (undefined). One undo step. */
  setUnderlay: (levelId: Id, underlay: Underlay | undefined) => void;
  /**
   * Patch the level's underlay (placement, opacity, lock). Invalid values are rejected; the
   * rotation is normalized to [0, 360). No-op without an underlay. One undo step.
   */
  updateUnderlay: (levelId: Id, patch: UnderlayPatch) => void;
}

const touch = (plan: Plan) => {
  plan.modifiedAt = new Date().toISOString();
};

/**
 * Move nodes in place. For a wall whose a end moves while its b end stays, openings keep their
 * distance from b (offsets are measured from a), so a door does not slide when the far corner
 * is dragged or a length is edited from the other end. Offsets are clamped later by normalize.
 */
function moveNodesInPlace(level: Level, positions: Record<Id, Vec2>): void {
  const moved = new Set(Object.keys(positions).filter((id) => level.nodes[id]));
  const before = new Map<Id, number>();
  for (const w of Object.values(level.walls)) {
    if (moved.has(w.a) && !moved.has(w.b)) before.set(w.id, wallLength(level, w));
  }
  for (const id of moved) {
    const n = level.nodes[id];
    const p = positions[id];
    n.x = p.x;
    n.y = p.y;
  }
  if (before.size === 0) return;
  for (const o of Object.values(level.openings)) {
    const old = before.get(o.wallId);
    if (old === undefined) continue;
    const delta = wallLength(level, level.walls[o.wallId]) - old;
    if (delta !== 0) o.offset += delta;
  }
}

function deleteInPlace(
  level: Level,
  nodeIds: Id[],
  wallIds: Id[],
  openingIds: Id[] = [],
  roomIds: Id[] = [],
  stairsIds: Id[] = [],
  roofIds: Id[] = [],
): void {
  for (const id of roofIds) delete level.roofs[id];
  for (const id of openingIds) delete level.openings[id];
  for (const id of roomIds) delete level.rooms[id];
  for (const id of stairsIds) delete level.stairs[id];
  const walls = new Set(wallIds);
  const nodes = new Set(nodeIds);
  for (const w of Object.values(level.walls)) if (nodes.has(w.a) || nodes.has(w.b)) walls.add(w.id);
  for (const id of walls) delete level.walls[id];
  for (const o of Object.values(level.openings)) if (walls.has(o.wallId)) delete level.openings[o.id];
  for (const id of nodes) delete level.nodes[id];
  const used = new Set<Id>();
  for (const w of Object.values(level.walls)) {
    used.add(w.a);
    used.add(w.b);
  }
  for (const id of Object.keys(level.nodes)) if (!used.has(id)) delete level.nodes[id];
}

/** Pull the openings of the given walls (all walls when omitted) under their wall height. */
function clampOpeningHeights(level: Level, wallIds?: Set<Id>): void {
  for (const o of Object.values(level.openings)) {
    const w = level.walls[o.wallId];
    if (!w || (wallIds && !wallIds.has(w.id))) continue;
    const H = wallHeightOf(level, w);
    if (openingFitsHeight(o, H)) continue;
    clampOpeningHeight(o, H);
  }
}

/**
 * Stairs the editor can draw. On an edit only the sizes being changed are held to the size limits,
 * so an older file's odd flight can still change phase or move.
 */
const validStairs = (s: Omit<Stairs, 'id'>, limits: { width: boolean; run: boolean } = { width: true, run: true }): boolean =>
  (!limits.width || stairsWidthOk(s.width)) &&
  (!limits.run || stairsRunOk(s.run)) &&
  s.width > 0 &&
  s.run > 0 &&
  Number.isFinite(s.width) &&
  Number.isFinite(s.run) &&
  Number.isFinite(s.direction) &&
  Number.isFinite(s.origin.x) &&
  Number.isFinite(s.origin.y) &&
  (s.headroom === undefined || (Number.isFinite(s.headroom) && s.headroom > 0)) &&
  (s.holeStart === undefined || (Number.isFinite(s.holeStart) && s.holeStart >= 0));

/** A roof's stored form: outline points copied, ridge angle in [0, 360). */
function cleanRoof(r: Roof): Roof {
  return { ...r, outline: r.outline.map((p) => ({ x: p.x, y: p.y })), ridgeAngle: normalizeDegrees(r.ridgeAngle) };
}

const isPoint = (p: Vec2 | undefined): p is Vec2 => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** A column's stored form: position copied, rotation in [0, 360). */
function cleanColumn(c: Column): Column {
  return { ...c, at: { x: c.at.x, y: c.at.y }, rotation: Number.isFinite(c.rotation) ? normalizeDegrees(c.rotation) : c.rotation };
}

/**
 * Add one wall to a (draft) level and normalize it: the body of `addWall`. Null when the segment
 * is degenerate, 'overlap' when it would lie on top of a wall already there (nothing changed).
 */
function addWallInPlace(level: Level, aRef: Vec2 | Id, bRef: Vec2 | Id, opts: AddWallOptions): AddWallResult | 'overlap' | null {
  // Where each end lands: a node id, an existing node within MERGE_EPS, or a new point.
  const locate = (ref: Vec2 | Id): { id: Id | null; at: Vec2 } | null => {
    if (typeof ref === 'string') return level.nodes[ref] ? { id: ref, at: level.nodes[ref] } : null;
    const near = findNodeNear(level, ref);
    return near ? { id: near, at: level.nodes[near] } : { id: null, at: ref };
  };
  const la = locate(aRef);
  const lb = locate(bRef);
  if (!la || !lb || (la.id !== null && la.id === lb.id) || dist(la.at, lb.at) <= MERGE_EPS) return null;
  // A wall on top of a wall already there (any phase) would replace a piece of it when the level
  // is normalized: refuse it instead (docs/REVIEW-2.md A1).
  if (wallOverlapping(level, la.at, lb.at)) return 'overlap';
  const place = (l: { id: Id | null; at: Vec2 }): { id: Id; existing: boolean } => {
    if (l.id) return { id: l.id, existing: true };
    const id = newId();
    level.nodes[id] = { id, x: l.at.x, y: l.at.y };
    return { id, existing: false };
  };
  const a = place(la);
  const b = place(lb);
  const wall: Wall = { id: newId(), a: a.id, b: b.id, thickness: opts.thickness, kind: opts.kind, phase: opts.phase };
  level.walls[wall.id] = wall;
  const remap = normalizeLevel(level);
  const finalA = remap.get(a.id) ?? a.id;
  const finalB = remap.get(b.id) ?? b.id;
  return { a: finalA, b: finalB, wallIds: wallsAlong(level, finalA, finalB), bWasExisting: b.existing };
}

/** Walls lying along the straight path a..b, following the graph after splits. */
function wallsAlong(level: Level, a: Id, b: Id): Id[] {
  const A = level.nodes[a];
  const B = level.nodes[b];
  if (!A || !B) return [];
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len2 = dx * dx + dy * dy;
  const onPath = (id: Id) => {
    const n = level.nodes[id];
    const t = ((n.x - A.x) * dx + (n.y - A.y) * dy) / len2;
    const px = A.x + dx * t - n.x;
    const py = A.y + dy * t - n.y;
    return t > -1e-6 && t < 1 + 1e-6 && px * px + py * py < 1;
  };
  return Object.values(level.walls)
    .filter((w) => onPath(w.a) && onPath(w.b))
    .map((w) => w.id);
}

export const usePlanStore = create<PlanState>()(
  temporal(
    immer((set, get) => {
      // `fn` returns false when it rejected the edit without changing anything, so the plan
      // keeps its identity and no empty undo step is recorded.
      const editLevel = (levelId: Id, fn: (level: Level, plan: Plan) => void | boolean) =>
        set((s) => {
          const level = s.plan.levels[levelId];
          if (!level) return;
          if (fn(level, s.plan) === false) return;
          touch(s.plan);
        });

      // Same for the site (plan.site: grade points, columns, north angle).
      const editSite = (fn: (site: Site, plan: Plan) => void | boolean) =>
        set((s) => {
          if (fn(s.plan.site, s.plan) === false) return;
          touch(s.plan);
        });

      return {
        plan: createEmptyPlan(),

        setPlan: (plan) => set({ plan }),

        renamePlan: (name) =>
          set((s) => {
            s.plan.name = name;
            touch(s.plan);
          }),

        addWall: (levelId, aRef, bRef, opts) => {
          let result: AddWallResult | null = null;
          let overlap = false;
          editLevel(levelId, (level) => {
            const r = addWallInPlace(level, aRef, bRef, opts);
            if (r === 'overlap') overlap = true;
            if (r === null || r === 'overlap') return false;
            result = r;
          });
          if (overlap) useUiStore.getState().patchDraft({ message: WALL_OVERLAP_MESSAGE, error: true });
          return result;
        },

        addWalls: (levelId, segments, opts) => {
          const current = get().plan.levels[levelId];
          if (!current || segments.length === 0) return null;
          // Dry run on a copy first: the walls go in together or not at all (one undo step).
          const trial = structuredClone(current) as Level;
          for (const s of segments) {
            const r = addWallInPlace(trial, s.a, s.b, opts);
            if (r === null || r === 'overlap') {
              if (r === 'overlap') useUiStore.getState().patchDraft({ message: WALL_OVERLAP_MESSAGE, error: true });
              return null;
            }
          }
          const results: AddWallResult[] = [];
          editLevel(levelId, (level) => {
            for (const s of segments) {
              const r = addWallInPlace(level, s.a, s.b, opts);
              if (r && r !== 'overlap') results.push(r);
            }
          });
          return results;
        },

        offsetWalls: (levelId, ids, distance, side) => {
          const level = get().plan.levels[levelId];
          if (!level) return 'No such level.';
          if (!Number.isFinite(distance) || !(distance > 0)) return 'Must be greater than 0.';
          const shifts = new Map<Id, Vec2>();
          for (const id of ids) if (level.walls[id]) shifts.set(id, wallShift(level, id, distance, side));
          return get().shiftWalls(levelId, Object.fromEntries(shifts));
        },

        shiftWalls: (levelId, shiftsIn) => {
          let problem: string | null = null;
          editLevel(levelId, (level) => {
            const shifts = new Map(Object.entries(shiftsIn).filter(([, s]) => isPoint(s) && Math.hypot(s.x, s.y) > 1e-9));
            if (shifts.size === 0) return false;
            const planned = planWallOffset(level, shifts);
            if ('error' in planned) {
              problem = planned.error;
              return false;
            }
            if (Object.keys(planned.positions).length === 0) return false;
            if (movesCreateOverlap(level, planned.positions)) {
              problem = WALL_OVERLAP_MESSAGE;
              return false;
            }
            // Openings on the moved walls keep their offset from the a end; on a neighbour whose a
            // end slides they keep their distance from its fixed b end (moveNodesInPlace). Clamped
            // by normalize.
            moveNodesInPlace(level, planned.positions);
            normalizeLevel(level, new Set(Object.keys(planned.positions)));
          });
          return problem;
        },

        moveNode: (levelId, nodeId, pos, opts) =>
          editLevel(levelId, (level) => {
            if (!level.nodes[nodeId]) return false;
            if (movesCreateOverlap(level, { [nodeId]: pos })) return false;
            moveNodesInPlace(level, { [nodeId]: pos });
            if (opts?.normalize !== false) normalizeLevel(level, new Set([nodeId]));
          }),

        moveNodes: (levelId, positions, opts) =>
          editLevel(levelId, (level) => {
            // A step that would lay a wall on top of another is refused: the nodes stay put.
            if (movesCreateOverlap(level, positions)) return false;
            moveNodesInPlace(level, positions);
            if (opts?.normalize !== false) normalizeLevel(level, new Set(Object.keys(positions)));
          }),

        normalize: (levelId, moved) =>
          editLevel(levelId, (level) => {
            normalizeLevel(level, moved ? new Set(moved) : undefined);
          }),

        deleteWalls: (levelId, ids) =>
          editLevel(levelId, (level) => {
            deleteInPlace(level, [], ids);
            clampOpenings(level);
          }),

        deleteNodes: (levelId, ids) =>
          editLevel(levelId, (level) => {
            deleteInPlace(level, ids, []);
            clampOpenings(level);
          }),

        deleteEntities: (levelId, sel) =>
          editLevel(levelId, (level, plan) => {
            deleteInPlace(level, sel.nodes, sel.walls, sel.openings, sel.rooms, sel.stairs, sel.roofs);
            for (const id of sel.gradePoints ?? []) delete plan.site.gradePoints[id];
            for (const id of sel.columns ?? []) delete plan.site.columns[id];
            // Removing walls changes the corner joins of their neighbours.
            if (sel.nodes.length || sel.walls.length) clampOpenings(level);
          }),

        updateWall: (levelId, id, patch) =>
          editLevel(levelId, (level) => {
            const w = level.walls[id];
            if (!w) return false;
            Object.assign(w, patch);
            if (patch.a !== undefined || patch.b !== undefined) normalizeLevel(level);
            if ('heightOverride' in patch) clampOpeningHeights(level, new Set([id]));
          }),

        updateWalls: (levelId, ids, patch) =>
          editLevel(levelId, (level) => {
            if (patch.thickness !== undefined && !(patch.thickness > 0)) return false;
            for (const id of ids) {
              const w = level.walls[id];
              if (!w) continue;
              for (const [key, value] of Object.entries(patch) as [keyof Wall, unknown][]) {
                // undefined clears an optional field; required fields are never removed.
                if (value === undefined) {
                  if (key === 'heightOverride' || key === 'finish' || key === 'color') delete w[key];
                } else if (w[key] !== value) (w as unknown as Record<string, unknown>)[key] = value;
              }
            }
            // Thickness and phase change the corner joins, so the core intervals of neighbours.
            if (patch.thickness !== undefined || patch.phase !== undefined) clampOpenings(level);
            // A lower wall takes its openings down with it.
            if ('heightOverride' in patch) clampOpeningHeights(level, new Set(ids));
          }),

        setWallKind: (levelId, ids, kind) =>
          set((s) => {
            const level = s.plan.levels[levelId];
            if (!level) return;
            const st = s.plan.settings;
            const def = (k: WallKind) =>
              k === 'exterior' ? st.defaultExteriorThickness : st.defaultInteriorThickness;
            for (const id of ids) {
              const w = level.walls[id];
              if (!w || w.kind === kind) continue;
              if (Math.abs(w.thickness - def(w.kind)) < 1e-9) w.thickness = def(kind);
              w.kind = kind;
            }
            clampOpenings(level);
            touch(s.plan);
          }),

        setWallLength: (levelId, wallId, length, anchor = 'start') => {
          let ok = false;
          editLevel(levelId, (level) => {
            const w = level.walls[wallId];
            if (!w || !(length > MERGE_EPS) || !Number.isFinite(length)) return false;
            const a = level.nodes[w.a];
            const b = level.nodes[w.b];
            const len = dist(a, b);
            if (len < 1e-9) return false;
            const ux = (b.x - a.x) / len;
            const uy = (b.y - a.y) / len;
            const [movedId, pos] =
              anchor === 'start'
                ? [w.b, { x: a.x + ux * length, y: a.y + uy * length }]
                : [w.a, { x: b.x - ux * length, y: b.y - uy * length }];
            if (movesCreateOverlap(level, { [movedId]: pos })) return false;
            moveNodesInPlace(level, { [movedId]: pos });
            normalizeLevel(level, new Set([movedId]));
            ok = true;
          });
          return ok;
        },

        addOpening: (levelId, input) => {
          let id: Id | null = null;
          editLevel(levelId, (level) => {
            const wall = level.walls[input.wallId];
            if (!wall) return false;
            if (!(input.width > 0) || !(input.height > 0) || !(input.sill >= 0)) return false;
            if (!Number.isFinite(input.offset)) return false;
            if (!openingFitsHeight(input, wallHeightOf(level, wall))) return false;
            const [s0, s1] = coreInterval(level, wall.id, input.phase, draftFootprints(level))!;
            if (s1 - s0 < input.width) return false;
            const opening: Opening = {
              ...input,
              id: input.id ?? newId(),
              offset: clampOpeningOffset(input.offset, input.width, s0, s1),
            };
            if (opening.type !== 'door') delete opening.swing;
            level.openings[opening.id] = opening;
            id = opening.id;
          });
          return id;
        },

        updateOpening: (levelId, id, patch) =>
          editLevel(levelId, (level) => {
            const o = level.openings[id];
            if (!o) return false;
            if (patch.width !== undefined && !(patch.width > 0)) return false;
            if (patch.height !== undefined && !(patch.height > 0)) return false;
            if (patch.sill !== undefined && !(patch.sill >= 0)) return false;
            if (patch.offset !== undefined && !Number.isFinite(patch.offset)) return false;
            if (patch.wallId !== undefined && !level.walls[patch.wallId]) return false;
            if (patch.height !== undefined || patch.sill !== undefined || patch.wallId !== undefined) {
              const target = level.walls[patch.wallId ?? o.wallId];
              const next = { height: patch.height ?? o.height, sill: patch.sill ?? o.sill };
              if (target && !openingFitsHeight(next, wallHeightOf(level, target))) return false;
            }
            for (const [key, value] of Object.entries(patch) as [keyof Opening, unknown][]) {
              if (value === undefined) {
                if (key === 'swing' || key === 'lites' || key === 'shutters' || key === 'trim') delete o[key];
              } else (o as unknown as Record<string, unknown>)[key] = value;
            }
            if (o.type !== 'door' && o.swing) delete o.swing;
            clampOpenings(level, o.wallId);
          }),

        deleteOpenings: (levelId, ids) =>
          editLevel(levelId, (level) => {
            for (const id of ids) delete level.openings[id];
          }),

        addRoom: (levelId, input) => {
          let id: Id | null = null;
          editLevel(levelId, (level) => {
            const name = input.name.trim();
            if (!name || !Number.isFinite(input.anchor.x) || !Number.isFinite(input.anchor.y)) return false;
            const room: Room = { ...input, id: input.id ?? newId(), name, anchor: { x: input.anchor.x, y: input.anchor.y } };
            level.rooms[room.id] = room;
            id = room.id;
          });
          return id;
        },

        updateRoom: (levelId, id, patch) =>
          editLevel(levelId, (level) => {
            const r = level.rooms[id];
            if (!r) return false;
            if (patch.name !== undefined) {
              const name = patch.name.trim();
              if (!name) return false;
              if (name === r.name && patch.anchor === undefined && patch.ceilingOverride === undefined) return false;
              r.name = name;
            }
            if (patch.anchor !== undefined) {
              if (!Number.isFinite(patch.anchor.x) || !Number.isFinite(patch.anchor.y)) return false;
              r.anchor = { x: patch.anchor.x, y: patch.anchor.y };
            }
            if ('ceilingOverride' in patch) {
              if (patch.ceilingOverride === undefined) delete r.ceilingOverride;
              else r.ceilingOverride = patch.ceilingOverride;
            }
          }),

        deleteRooms: (levelId, ids) =>
          editLevel(levelId, (level) => {
            if (!ids.some((id) => level.rooms[id])) return false;
            for (const id of ids) delete level.rooms[id];
          }),

        addStairs: (levelId, input) => {
          let id: Id | null = null;
          editLevel(levelId, (level) => {
            if (!validStairs(input)) return false;
            const stairs: Stairs = {
              ...input,
              id: input.id ?? newId(),
              origin: { x: input.origin.x, y: input.origin.y },
              direction: normalizeDegrees(input.direction),
            };
            if (stairs.headroom === undefined) delete stairs.headroom;
            if (stairs.holeStart === undefined) delete stairs.holeStart;
            level.stairs[stairs.id] = stairs;
            id = stairs.id;
          });
          return id;
        },

        updateStairs: (levelId, id, patch) =>
          editLevel(levelId, (level) => {
            const st = level.stairs[id];
            if (!st) return false;
            const next = { ...st, ...patch };
            if (!validStairs(next, { width: patch.width !== undefined, run: patch.run !== undefined })) return false;
            if (patch.origin) st.origin = { x: patch.origin.x, y: patch.origin.y };
            if (patch.direction !== undefined) st.direction = normalizeDegrees(patch.direction);
            if (patch.width !== undefined) st.width = patch.width;
            if (patch.run !== undefined) st.run = patch.run;
            if (patch.phase !== undefined) st.phase = patch.phase;
            if (patch.cutsFloorAbove !== undefined) st.cutsFloorAbove = patch.cutsFloorAbove;
            // Optional fields: undefined clears them (back to the headroom rule / 80").
            for (const k of ['headroom', 'holeStart'] as const) {
              if (!(k in patch)) continue;
              const v = patch[k];
              if (v === undefined) {
                if (k in st) delete st[k];
              } else if (st[k] !== v) st[k] = v;
            }
          }),

        deleteStairs: (levelId, ids) =>
          editLevel(levelId, (level) => {
            if (!ids.some((id) => level.stairs[id])) return false;
            for (const id of ids) delete level.stairs[id];
          }),

        addRoof: (levelId, input) => {
          let id: Id | null = null;
          editLevel(levelId, (level) => {
            const roof = cleanRoof({ ...input, id: input.id ?? newId() });
            if (roofProblem(roof)) return false;
            level.roofs[roof.id] = roof;
            id = roof.id;
          });
          return id;
        },

        updateRoof: (levelId, id, patch) =>
          editLevel(levelId, (level) => {
            const r = level.roofs[id];
            if (!r) return false;
            const next = cleanRoof({ ...r, ...patch, id });
            if (roofProblem(next)) return false;
            const keys = Object.keys(patch) as (keyof RoofPatch)[];
            const same = (k: keyof RoofPatch) =>
              k === 'outline'
                ? next.outline.length === r.outline.length && next.outline.every((p, i) => p.x === r.outline[i].x && p.y === r.outline[i].y)
                : next[k] === r[k];
            if (keys.every(same)) return false;
            for (const k of keys) {
              if (same(k)) continue;
              if (next[k] === undefined) delete r[k]; // an optional field (colour) cleared
              else (r as unknown as Record<string, unknown>)[k] = next[k];
            }
          }),

        deleteRoofs: (levelId, ids) =>
          editLevel(levelId, (level) => {
            if (!ids.some((id) => level.roofs[id])) return false;
            for (const id of ids) delete level.roofs[id];
          }),

        addGradePoint: (input) => {
          let id: Id | null = null;
          editSite((site) => {
            if (!isPoint(input.at) || !Number.isFinite(input.elevation)) return false;
            const gp: GradePoint = { id: input.id ?? newId(), at: { x: input.at.x, y: input.at.y }, elevation: input.elevation };
            site.gradePoints[gp.id] = gp;
            id = gp.id;
          });
          return id;
        },

        updateGradePoint: (id, patch) =>
          editSite((site) => {
            const g = site.gradePoints[id];
            if (!g) return false;
            if (patch.at && !isPoint(patch.at)) return false;
            if (patch.elevation !== undefined && !Number.isFinite(patch.elevation)) return false;
            const moved = !!patch.at && (patch.at.x !== g.at.x || patch.at.y !== g.at.y);
            const raised = patch.elevation !== undefined && patch.elevation !== g.elevation;
            if (!moved && !raised) return false;
            if (moved) g.at = { x: patch.at!.x, y: patch.at!.y };
            if (raised) g.elevation = patch.elevation!;
          }),

        deleteGradePoints: (ids) =>
          editSite((site) => {
            if (!ids.some((id) => site.gradePoints[id])) return false;
            for (const id of ids) delete site.gradePoints[id];
          }),

        clearGradePoints: () =>
          editSite((site) => {
            if (Object.keys(site.gradePoints).length === 0) return false;
            site.gradePoints = {};
          }),

        addColumn: (input) => {
          let id: Id | null = null;
          editSite((site) => {
            const col = cleanColumn({ ...input, id: input.id ?? newId() });
            if (columnProblem(col)) return false;
            site.columns[col.id] = col;
            id = col.id;
          });
          return id;
        },

        updateColumn: (id, patch) =>
          editSite((site) => {
            const c = site.columns[id];
            if (!c) return false;
            const next = cleanColumn({ ...c, ...patch, id });
            if (columnProblem(next)) return false;
            const keys = Object.keys(patch) as (keyof ColumnPatch)[];
            const same = (k: keyof ColumnPatch) => (k === 'at' ? next.at.x === c.at.x && next.at.y === c.at.y : next[k] === c[k]);
            if (keys.every(same)) return false;
            for (const k of keys) if (!same(k)) (c as unknown as Record<string, unknown>)[k] = next[k];
          }),

        deleteColumns: (ids) =>
          editSite((site) => {
            if (!ids.some((id) => site.columns[id])) return false;
            for (const id of ids) delete site.columns[id];
          }),

        moveSiteItems: (points, columns) =>
          editSite((site) => {
            let changed = false;
            for (const [id, p] of Object.entries(points)) {
              const g = site.gradePoints[id];
              if (!g || !isPoint(p) || (g.at.x === p.x && g.at.y === p.y)) continue;
              g.at = { x: p.x, y: p.y };
              changed = true;
            }
            for (const [id, p] of Object.entries(columns)) {
              const c = site.columns[id];
              if (!c || !isPoint(p) || (c.at.x === p.x && c.at.y === p.y)) continue;
              c.at = { x: p.x, y: p.y };
              changed = true;
            }
            if (!changed) return false;
          }),

        setNorthAngle: (degrees) =>
          editSite((site) => {
            if (!Number.isFinite(degrees)) return false;
            const next = normalizeDegrees(degrees);
            if (next === site.northAngle) return false;
            site.northAngle = next;
          }),

        setPhase: (levelId, sel, phase) =>
          editLevel(levelId, (level, plan) => {
            for (const id of sel.columns ?? []) {
              const c = plan.site.columns[id];
              if (c && c.phase !== phase) c.phase = phase;
            }
            for (const id of sel.roofs ?? []) {
              const r = level.roofs[id];
              if (r && r.phase !== phase) r.phase = phase;
            }
            for (const id of sel.stairs ?? []) {
              const st = level.stairs[id];
              if (st && st.phase !== phase) st.phase = phase;
            }
            for (const id of sel.walls) {
              const w = level.walls[id];
              if (w && w.phase !== phase) w.phase = phase;
            }
            for (const id of sel.openings) {
              const o = level.openings[id];
              if (o && o.phase !== phase) o.phase = phase;
            }
            clampOpenings(level);
          }),

        copyWallsFromLevel: (fromId, toId) => {
          const out = { copied: 0, skipped: 0 };
          set((s) => {
            const from = s.plan.levels[fromId];
            const to = s.plan.levels[toId];
            if (!from || !to || from === to) return;
            // Walls that would lie on top of a wall already on the target level are skipped (the
            // duplicate drop would otherwise replace pieces of the target's walls).
            const targetWalls = new Set(Object.keys(to.walls));
            const nodeMap = new Map<Id, Id>();
            const nodeFor = (id: Id): Id | null => {
              const n = from.nodes[id];
              if (!n) return null;
              let mapped = nodeMap.get(id);
              if (!mapped) {
                mapped = newId();
                nodeMap.set(id, mapped);
                to.nodes[mapped] = { id: mapped, x: n.x, y: n.y };
              }
              return mapped;
            };
            for (const w of Object.values(from.walls)) {
              const pa = from.nodes[w.a];
              const pb = from.nodes[w.b];
              if (!pa || !pb) continue;
              if (wallOverlapping(to, pa, pb, (t) => !targetWalls.has(t.id))) {
                out.skipped++;
                continue;
              }
              const a = nodeFor(w.a);
              const b = nodeFor(w.b);
              if (!a || !b) continue;
              const copy: Wall = { ...w, id: newId(), a, b };
              // Height overrides belong to the source level's storey.
              delete copy.heightOverride;
              to.walls[copy.id] = copy;
              out.copied++;
            }
            if (out.copied === 0) return;
            normalizeLevel(to);
            touch(s.plan);
          });
          return out;
        },

        updateSettings: (patch) =>
          set((s) => {
            Object.assign(s.plan.settings, patch);
            touch(s.plan);
          }),

        renameLevel: (levelId, name) =>
          editLevel(levelId, (level) => {
            level.name = name;
          }),

        updateLevel: (levelId, patch) =>
          editLevel(levelId, (level) => {
            if (patch.wallHeight !== undefined && !(patch.wallHeight > 0)) return false;
            if (patch.floorThickness !== undefined && !(patch.floorThickness >= 0)) return false;
            if (patch.name !== undefined && !patch.name.trim()) return false;
            const lowered = patch.wallHeight !== undefined && patch.wallHeight < level.wallHeight;
            Object.assign(level, patch);
            if (lowered) clampOpeningHeights(level);
          }),

        setBaseFloorElevation: (elevation) =>
          set((s) => {
            if (!Number.isFinite(elevation)) return;
            s.plan.baseFloorElevation = elevation;
            touch(s.plan);
          }),

        setUnderlay: (levelId, underlay) =>
          editLevel(levelId, (level) => {
            if (!underlay) {
              if (!level.underlay) return false;
              delete level.underlay;
              return;
            }
            const next: Underlay = {
              ...underlay,
              origin: { x: underlay.origin.x, y: underlay.origin.y },
              rotation: normalizeRotation(underlay.rotation),
            };
            if (!isValidUnderlay(next)) return false;
            level.underlay = next;
          }),

        updateUnderlay: (levelId, patch) =>
          editLevel(levelId, (level) => {
            const u = level.underlay;
            if (!u) return false;
            const next: Underlay = { ...u, ...patch };
            if (patch.origin) next.origin = { x: patch.origin.x, y: patch.origin.y };
            if (patch.rotation !== undefined) next.rotation = normalizeRotation(patch.rotation);
            if (!isValidUnderlay(next)) return false;
            const keys = Object.keys(patch) as (keyof Underlay)[];
            const changed = keys.some((k) =>
              k === 'origin' ? next.origin.x !== u.origin.x || next.origin.y !== u.origin.y : next[k] !== u[k],
            );
            if (!changed) return false;
            for (const k of keys) (u as unknown as Record<string, unknown>)[k] = next[k];
          }),
      };
    }),
    {
      partialize: (s) => ({ plan: s.plan }),
      limit: 200,
      equality: (past, current) => past.plan === current.plan,
    },
  ),
);

// ---------------------------------------------------------------------------------------------
// Undo / redo helpers

const temporalStore = () => usePlanStore.temporal.getState();

type HistoryListener = (kind: 'undo' | 'redo') => void;
const historyListeners = new Set<HistoryListener>();

/** Be told after every undo or redo made through undo() / redo(). Returns an unsubscribe function. */
export function onHistoryStep(fn: HistoryListener): () => void {
  historyListeners.add(fn);
  return () => void historyListeners.delete(fn);
}

let historyNoticeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Undo or redo, then make a change on another level visible: when the step changed a level that
 * is not the active one, switch to it and say so in the status bar.
 */
function stepHistory(kind: 'undo' | 'redo'): void {
  const before = getPlan();
  if (kind === 'undo') temporalStore().undo();
  else temporalStore().redo();
  const after = getPlan();
  if (after !== before) {
    const ui = useUiStore.getState();
    const changed = after.levelOrder.filter((id) => before.levels[id] !== after.levels[id]);
    if (changed.length > 0 && !changed.includes(ui.activeLevelId)) {
      const id = changed[0];
      ui.setActiveLevel(id);
      const text = `${kind === 'undo' ? 'Undid' : 'Redid'} a change on ${after.levels[id].name}`;
      useUiStore.getState().setNotice({ text, error: false });
      if (historyNoticeTimer) clearTimeout(historyNoticeTimer);
      historyNoticeTimer = setTimeout(() => {
        historyNoticeTimer = null;
        if (useUiStore.getState().notice?.text === text) useUiStore.getState().setNotice(null);
      }, 4000);
    }
  }
  for (const fn of historyListeners) fn(kind);
}

export const undo = () => stepHistory('undo');
export const redo = () => stepHistory('redo');
export const clearHistory = () => temporalStore().clear();
/** Drag grouping: call after the first (tracked) set of a drag. */
export const pauseHistory = () => temporalStore().pause();
/** Drag grouping: call on pointerup so the next edit is tracked again. */
export const resumeHistory = () => temporalStore().resume();

/** Subscribe to undo/redo availability. */
export function useTemporal(): { canUndo: boolean; canRedo: boolean } {
  const canUndo = useStore(usePlanStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(usePlanStore.temporal, (s) => s.futureStates.length > 0);
  return { canUndo, canRedo };
}

/** Non-reactive accessors for tools and event handlers. */
export const getPlan = (): Plan => usePlanStore.getState().plan;
export const getLevel = (levelId: Id): Level | undefined => getPlan().levels[levelId];
