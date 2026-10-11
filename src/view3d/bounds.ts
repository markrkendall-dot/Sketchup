import { getLevelElevations } from '../derive/levels';
import type { Id, Plan } from '../model/types';

export interface Box3d {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Bounding box of the given levels in three coordinates (x, Y up, plan y): the nodes in plan, from
 * the lowest slab bottom to the highest ceiling. An empty plan gives a 20' box at the origin.
 */
export function planBox(plan: Plan, levelIds: readonly Id[] = plan.levelOrder): Box3d {
  const elev = getLevelElevations(plan);
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const id of levelIds) {
    const level = plan.levels[id];
    const e = elev[id];
    if (!level || !e) continue;
    minY = Math.min(minY, e.slabBottom);
    maxY = Math.max(maxY, e.ceiling);
    for (const n of Object.values(level.nodes)) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minZ = Math.min(minZ, n.y);
      maxZ = Math.max(maxZ, n.y);
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minZ = 0;
    maxX = 240;
    maxZ = 240;
  }
  if (!Number.isFinite(minY)) {
    minY = 0;
    maxY = 96;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}
