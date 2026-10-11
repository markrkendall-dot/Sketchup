import { create, useStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import { dist } from '../model/geometry';
import { coreInterval, draftFootprints } from '../derive/openings';
import { clampOpeningOffset } from '../model/openings';
import {
  clampOpenings,
  createEmptyPlan,
  findNodeNear,
  MERGE_EPS,
  newId,
  normalizeLevel,
  wallLength,
} from '../model/plan';
import type { Id, Level, Opening, Phase, Plan, PlanSettings, Room, Stairs, Vec2, Wall, WallKind } from '../model/types';
import { normalizeDegrees } from '../derive/stairs';

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
export type LevelPatch = Partial<Pick<Level, 'name' | 'wallHeight' | 'floorThickness'>>;
/** Which end of a wall stays put when its length is edited. */
export type LengthAnchor = 'start' | 'end';

export interface EntitySelection {
  nodes: Id[];
  walls: Id[];
  openings?: Id[];
  rooms?: Id[];
  stairs?: Id[];
}

export interface PlanState {
  plan: Plan;
  setPlan: (plan: Plan) => void;
  renamePlan: (name: string) => void;
  addWall: (levelId: Id, a: Vec2 | Id, b: Vec2 | Id, opts: AddWallOptions) => AddWallResult | null;
  moveNode: (levelId: Id, nodeId: Id, pos: Vec2, opts?: { normalize?: boolean }) => void;
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
  /** Patch stairs; invalid sizes are rejected, the direction is normalized to [0, 360). */
  updateStairs: (levelId: Id, id: Id, patch: StairsPatch) => void;
  deleteStairs: (levelId: Id, ids: Id[]) => void;
  /** Set the phase of walls, openings and stairs together (e.g. "Mark demolish"). */
  setPhase: (levelId: Id, sel: { walls: Id[]; openings: Id[]; stairs?: Id[] }, phase: Phase) => void;
  /**
   * Copy the nodes and walls (not openings) of one level into another, merged with whatever is
   * there, in one undo step. Returns the number of walls copied.
   */
  copyWallsFromLevel: (fromId: Id, toId: Id) => number;
  updateSettings: (patch: Partial<PlanSettings>) => void;
  renameLevel: (levelId: Id, name: string) => void;
  updateLevel: (levelId: Id, patch: LevelPatch) => void;
  setBaseFloorElevation: (elevation: number) => void;
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
): void {
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

const validStairs = (s: Omit<Stairs, 'id'>): boolean =>
  s.width > 0 &&
  s.run > 0 &&
  Number.isFinite(s.width) &&
  Number.isFinite(s.run) &&
  Number.isFinite(s.direction) &&
  Number.isFinite(s.origin.x) &&
  Number.isFinite(s.origin.y);

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
    immer((set) => {
      // `fn` returns false when it rejected the edit without changing anything, so the plan
      // keeps its identity and no empty undo step is recorded.
      const editLevel = (levelId: Id, fn: (level: Level, plan: Plan) => void | boolean) =>
        set((s) => {
          const level = s.plan.levels[levelId];
          if (!level) return;
          if (fn(level, s.plan) === false) return;
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
          editLevel(levelId, (level) => {
            const resolveRef = (ref: Vec2 | Id): { id: Id; existing: boolean } | null => {
              if (typeof ref === 'string') return level.nodes[ref] ? { id: ref, existing: true } : null;
              const near = findNodeNear(level, ref);
              if (near) return { id: near, existing: true };
              const id = newId();
              level.nodes[id] = { id, x: ref.x, y: ref.y };
              return { id, existing: false };
            };
            const a = resolveRef(aRef);
            const b = resolveRef(bRef);
            if (!a || !b || a.id === b.id) {
              // Do not leave a node created for a rejected wall behind.
              for (const r of [a, b]) if (r && !r.existing) delete level.nodes[r.id];
              return false;
            }
            const wall: Wall = {
              id: newId(),
              a: a.id,
              b: b.id,
              thickness: opts.thickness,
              kind: opts.kind,
              phase: opts.phase,
            };
            level.walls[wall.id] = wall;
            const remap = normalizeLevel(level);
            const finalA = remap.get(a.id) ?? a.id;
            const finalB = remap.get(b.id) ?? b.id;
            result = {
              a: finalA,
              b: finalB,
              wallIds: wallsAlong(level, finalA, finalB),
              bWasExisting: b.existing,
            };
          });
          return result;
        },

        moveNode: (levelId, nodeId, pos, opts) =>
          editLevel(levelId, (level) => {
            if (!level.nodes[nodeId]) return false;
            moveNodesInPlace(level, { [nodeId]: pos });
            if (opts?.normalize !== false) normalizeLevel(level, new Set([nodeId]));
          }),

        moveNodes: (levelId, positions, opts) =>
          editLevel(levelId, (level) => {
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
          editLevel(levelId, (level) => {
            deleteInPlace(level, sel.nodes, sel.walls, sel.openings, sel.rooms, sel.stairs);
            // Removing walls changes the corner joins of their neighbours.
            if (sel.nodes.length || sel.walls.length) clampOpenings(level);
          }),

        updateWall: (levelId, id, patch) =>
          editLevel(levelId, (level) => {
            const w = level.walls[id];
            if (!w) return false;
            Object.assign(w, patch);
            if (patch.a !== undefined || patch.b !== undefined) normalizeLevel(level);
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
                  if (key === 'heightOverride') delete w.heightOverride;
                } else if (w[key] !== value) (w as unknown as Record<string, unknown>)[key] = value;
              }
            }
            // Thickness and phase change the corner joins, so the core intervals of neighbours.
            if (patch.thickness !== undefined || patch.phase !== undefined) clampOpenings(level);
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
            for (const [key, value] of Object.entries(patch) as [keyof Opening, unknown][]) {
              if (value === undefined) {
                if (key === 'swing') delete o.swing;
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
            if (!validStairs(next)) return false;
            if (patch.origin) st.origin = { x: patch.origin.x, y: patch.origin.y };
            if (patch.direction !== undefined) st.direction = normalizeDegrees(patch.direction);
            if (patch.width !== undefined) st.width = patch.width;
            if (patch.run !== undefined) st.run = patch.run;
            if (patch.phase !== undefined) st.phase = patch.phase;
            if (patch.cutsFloorAbove !== undefined) st.cutsFloorAbove = patch.cutsFloorAbove;
          }),

        deleteStairs: (levelId, ids) =>
          editLevel(levelId, (level) => {
            if (!ids.some((id) => level.stairs[id])) return false;
            for (const id of ids) delete level.stairs[id];
          }),

        setPhase: (levelId, sel, phase) =>
          editLevel(levelId, (level) => {
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
          let count = 0;
          set((s) => {
            const from = s.plan.levels[fromId];
            const to = s.plan.levels[toId];
            if (!from || !to || from === to) return;
            const nodeMap = new Map<Id, Id>();
            for (const n of Object.values(from.nodes)) {
              const id = newId();
              nodeMap.set(n.id, id);
              to.nodes[id] = { id, x: n.x, y: n.y };
            }
            for (const w of Object.values(from.walls)) {
              const a = nodeMap.get(w.a);
              const b = nodeMap.get(w.b);
              if (!a || !b) continue;
              const copy: Wall = { ...w, id: newId(), a, b };
              // Height overrides belong to the source level's storey.
              delete copy.heightOverride;
              to.walls[copy.id] = copy;
              count++;
            }
            normalizeLevel(to);
            touch(s.plan);
          });
          return count;
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
            Object.assign(level, patch);
          }),

        setBaseFloorElevation: (elevation) =>
          set((s) => {
            if (!Number.isFinite(elevation)) return;
            s.plan.baseFloorElevation = elevation;
            touch(s.plan);
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

export const undo = () => temporalStore().undo();
export const redo = () => temporalStore().redo();
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
