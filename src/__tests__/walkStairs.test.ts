import { describe, expect, it } from 'vitest';
import example from '../../docs/examples/146-mick-road.json';
import { getLevelElevations } from '../derive/levels';
import { migrate } from '../model/plan';
import type { Plan, Vec2 } from '../model/types';
import { levelAtFeet, surfaceAt, walkMove, walkWorld, type WalkState } from '../view3d/walk';

const plan: Plan = migrate(example);
const [, f, s] = plan.levelOrder;
const elev = getLevelElevations(plan);
const levels = plan.levelOrder;
const world = walkWorld(plan, 'proposed', levels);

/** Walk through the waypoints, 3" a frame (as at walking speed), from a start on the floor of `lid`. */
function walk(start: Vec2, lid: string, ...points: Vec2[]): WalkState {
  let st: WalkState = { at: start, feet: surfaceAt(world, start, elev[lid].floorTop)! };
  for (const p of points) {
    for (let k = 0; k < 400 && Math.hypot(p.x - st.at.x, p.y - st.at.y) > 0.01; k++) {
      const d = Math.hypot(p.x - st.at.x, p.y - st.at.y);
      const t = Math.min(1, 3 / d);
      const next = walkMove(world, st, { x: st.at.x + (p.x - st.at.x) * t, y: st.at.y + (p.y - st.at.y) * t });
      if (next.at.x === st.at.x && next.at.y === st.at.y) break;
      st = next;
    }
  }
  return st;
}

describe('walking the grand stair', () => {
  it('climbs from the stair hall to the Second Floor: the platform, flight 1, the landing, flight 2', () => {
    const end = walk({ x: 25, y: 75 }, f, { x: 25, y: 28 }, { x: 148, y: 28 }, { x: 148, y: 110 });
    expect(end.at).toEqual({ x: 148, y: 110 });
    expect(end.feet).toBeCloseTo(elev[s].floorTop, 6);
    expect(levelAtFeet(plan, levels, end.feet)).toBe(s);
  });

  it('stops at the side of flight 1; stays on the floor under the framed landing', () => {
    const side = walk({ x: 85, y: 75 }, f, { x: 85, y: 20 });
    expect(side.at.y).toBeGreaterThan(49);
    expect(side.feet).toBe(elev[f].floorTop);
    const closet = walk({ x: 150, y: 30 }, f, { x: 155, y: 60 });
    expect(closet.feet).toBe(elev[f].floorTop);
    expect(levelAtFeet(plan, levels, closet.feet)).toBe(f);
  });

  it('the balcony guard keeps the walker on the Second Floor', () => {
    const end = walk({ x: 60, y: 115 }, s, { x: 60, y: 40 });
    expect(end.at.y).toBeGreaterThan(91);
    expect(end.feet).toBe(elev[s].floorTop);
  });
});
