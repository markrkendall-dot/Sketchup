import { getLevelElevations } from '../derive/levels';
import { roofBearing, roofExtremes, roofOutlineWithOverhang } from '../derive/roofs';
import { columnOutline, fallbackElevation, terrainHeightAt } from '../derive/site';
import type { Id, Plan } from '../model/types';

export interface Box3d {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Bounding box of the given levels in three coordinates (x, Y up, plan y): the nodes and roof
 * overhangs in plan, from the lowest slab bottom to the highest ceiling or roof top, the site's
 * columns, and the terrain's height over the house area (never its 40' margin). An empty plan
 * gives a 20' box at the origin.
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
    for (const roof of Object.values(level.roofs ?? {})) {
      for (const p of roofOutlineWithOverhang(roof)) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.y);
        maxZ = Math.max(maxZ, p.y);
      }
      maxY = Math.max(maxY, e.floorTop + roofExtremes(roof, roofBearing(level.wallHeight, roof)).ridge + roof.thickness);
    }
  }
  for (const c of Object.values(plan.site.columns)) {
    for (const p of columnOutline(c)) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.y);
      maxZ = Math.max(maxZ, p.y);
    }
    minY = Math.min(minY, c.base);
    maxY = Math.max(maxY, c.top);
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
  // The ground over the house area, sampled on a coarse grid (terrain, not its margin).
  if (Object.keys(plan.site.gradePoints).length) {
    const fallback = fallbackElevation(plan);
    const N = 6;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const h = terrainHeightAt(plan.site, { x: minX + ((maxX - minX) * i) / N, y: minZ + ((maxZ - minZ) * j) / N }, fallback);
        minY = Math.min(minY, h);
        maxY = Math.max(maxY, h);
      }
    }
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}
