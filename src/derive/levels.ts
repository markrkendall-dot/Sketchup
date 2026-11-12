import { stackFloorTops } from '../model/plan';
import { structuresOf } from '../model/structures';
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
 * Elevations per level of every structure (DESIGN.md elevation rule), within each structure's
 * stack: floorTop[0] = its baseFloorElevation, floorTop[i] = floorTop[i-1] + wallHeight[i-1] +
 * floorThickness[i]. Elevations are absolute: a structure's placement moves it in plan only.
 */
export function getLevelElevations(plan: Plan): Record<Id, LevelElevation> {
  const out: Record<Id, LevelElevation> = {};
  for (const s of structuresOf(plan)) {
    const tops = stackFloorTops(s, plan.levels);
    s.levelOrder.forEach((id, i) => {
      const level = plan.levels[id];
      out[id] = {
        floorTop: tops[i],
        ceiling: tops[i] + level.wallHeight,
        slabBottom: tops[i] - level.floorThickness,
      };
    });
  }
  return out;
}
