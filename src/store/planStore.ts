import { create, useStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import { createEmptyPlan, findNodeNear, newId, normalizeLevel } from '../model/plan';
import type { Id, Level, Phase, Plan, PlanSettings, Vec2, Wall, WallKind } from '../model/types';

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
  /** Delete nodes (with their walls) and walls in a single undo step. */
  deleteEntities: (levelId: Id, sel: { nodes: Id[]; walls: Id[] }) => void;
  updateWall: (levelId: Id, id: Id, patch: WallPatch) => void;
  updateSettings: (patch: Partial<PlanSettings>) => void;
  renameLevel: (levelId: Id, name: string) => void;
}

const touch = (plan: Plan) => {
  plan.modifiedAt = new Date().toISOString();
};

function deleteInPlace(level: Level, nodeIds: Id[], wallIds: Id[]): void {
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
      const editLevel = (levelId: Id, fn: (level: Level, plan: Plan) => void) =>
        set((s) => {
          const level = s.plan.levels[levelId];
          if (!level) return;
          fn(level, s.plan);
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
            if (!a || !b || a.id === b.id) return;
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
            const n = level.nodes[nodeId];
            if (!n) return;
            n.x = pos.x;
            n.y = pos.y;
            if (opts?.normalize !== false) normalizeLevel(level, new Set([nodeId]));
          }),

        moveNodes: (levelId, positions, opts) =>
          editLevel(levelId, (level) => {
            for (const [id, p] of Object.entries(positions)) {
              const n = level.nodes[id];
              if (!n) continue;
              n.x = p.x;
              n.y = p.y;
            }
            if (opts?.normalize !== false) normalizeLevel(level, new Set(Object.keys(positions)));
          }),

        normalize: (levelId, moved) =>
          editLevel(levelId, (level) => {
            normalizeLevel(level, moved ? new Set(moved) : undefined);
          }),

        deleteWalls: (levelId, ids) => editLevel(levelId, (level) => deleteInPlace(level, [], ids)),

        deleteNodes: (levelId, ids) => editLevel(levelId, (level) => deleteInPlace(level, ids, [])),

        deleteEntities: (levelId, sel) =>
          editLevel(levelId, (level) => deleteInPlace(level, sel.nodes, sel.walls)),

        updateWall: (levelId, id, patch) =>
          editLevel(levelId, (level) => {
            const w = level.walls[id];
            if (!w) return;
            Object.assign(w, patch);
            if (patch.a !== undefined || patch.b !== undefined) normalizeLevel(level);
          }),

        updateSettings: (patch) =>
          set((s) => {
            Object.assign(s.plan.settings, patch);
            touch(s.plan);
          }),

        renameLevel: (levelId, name) =>
          editLevel(levelId, (level) => {
            level.name = name;
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
