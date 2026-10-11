import { floorTops } from '../model/plan';
import type { Id, Plan } from '../model/types';

export interface LevelElevation {
  /** Top of this level's floor. */
  floorTop: number;
  /** floorTop + wallHeight: underside of the floor above. */
  ceiling: number;
  /** floorTop - floorThickness: bottom of the slab/framing under this level. */
  slabBottom: number;
}

/**
 * Elevations per level (DESIGN.md elevation rule): floorTop[0] = baseFloorElevation,
 * floorTop[i] = floorTop[i-1] + wallHeight[i-1] + floorThickness[i].
 */
export function getLevelElevations(plan: Plan): Record<Id, LevelElevation> {
  const tops = floorTops(plan);
  const out: Record<Id, LevelElevation> = {};
  plan.levelOrder.forEach((id, i) => {
    const level = plan.levels[id];
    out[id] = {
      floorTop: tops[i],
      ceiling: tops[i] + level.wallHeight,
      slabBottom: tops[i] - level.floorThickness,
    };
  });
  return out;
}
