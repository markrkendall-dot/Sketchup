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
 * columns, and the terrain's height over the house area (never its 100' margin). An empty plan
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

type Xyz = [number, number, number];

/** A directional light's orthographic shadow camera fitted round a box (Scene3D's sun). */
export interface ShadowFit {
  /** The light's target: the box centre. */
  target: Xyz;
  /** The light: twice the box's radius from the centre, toward the sun. */
  position: Xyz;
  /** Half the side of the square frustum, across the light's axis. */
  half: number;
  /** Depth range of the frustum, measured from the light. */
  near: number;
  far: number;
}

/**
 * Fit the sun's shadow camera round a box: target at the box centre, the light 2r out along the
 * sun direction (r the radius of the box's bounding sphere), a square frustum 1.1r either side of
 * the axis. Everything that casts a shadow is inside the sphere, so from r/2 deep; to the far side
 * of the sphere plus how far down the sun's ray a shadow can fall past it (twice the radius over
 * the sine of the sun's elevation, which is clamped so a low sun stays finite), so the house's
 * shadow on ground lower than the box is kept.
 */
export function sunShadowFit(box: Box3d, sun: readonly [number, number, number]): ShadowFit {
  const target: Xyz = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
  const r = Math.max(1, 0.5 * Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]));
  const len = Math.hypot(sun[0], sun[1], sun[2]) || 1;
  const dir: Xyz = [sun[0] / len, sun[1] / len, sun[2] / len];
  const half = 1.1 * r;
  return {
    target,
    position: [target[0] + dir[0] * 2 * r, target[1] + dir[1] * 2 * r, target[2] + dir[2] * 2 * r],
    half,
    near: r / 2,
    far: 2 * r + half + (2 * r) / Math.max(0.25, dir[1]),
  };
}
