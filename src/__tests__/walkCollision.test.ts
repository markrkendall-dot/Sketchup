import { describe, expect, it } from 'vitest';
import { getFootprints } from '../derive/footprint';
import { getLevelElevations } from '../derive/levels';
import { add, dot, scale, sub } from '../model/geometry';
import { migrate } from '../model/plan';
import type { Plan, Vec2, ViewMode } from '../model/types';
import { blockedAt, surfaceAt, walkMove, walkWorld, type WalkState, type WalkWorld } from '../view3d/walk';
import starter from '../../docs/examples/146-mick-road.json';
import rebuild from '../../docs/examples/146-mick-road-rebuild.json';

/** Walk toward `to` in 2" moves (as the frame loop does), at most `n` of them. */
function walkTo(world: WalkWorld, from: WalkState, to: Vec2, n = 80): WalkState {
  let st = from;
  for (let i = 0; i < n; i++) {
    const d = sub(to, st.at);
    const len = Math.hypot(d.x, d.y);
    if (len < 0.5) break;
    st = walkMove(world, st, add(st.at, scale(d, Math.min(2, len) / len)));
  }
  return st;
}

/**
 * Scripted walks through every door and passage of every level of a plan, both ways, straight and
 * from 8" to one side: each ends past the wall. Returns how many walks were made.
 */
function walkThroughDoors(plan: Plan, view: ViewMode): number {
  const s = plan.structures[plan.structureOrder[0]];
  const world = walkWorld(plan, view, s.levelOrder, true);
  let walks = 0;
  for (const lid of s.levelOrder) {
    const level = plan.levels[lid];
    const z = getLevelElevations(plan)[lid].floorTop;
    const fps = getFootprints(level, view);
    for (const o of Object.values(level.openings)) {
      const w = level.walls[o.wallId];
      const fp = fps.get(o.wallId);
      if (o.type === 'window' || !fp) continue;
      if ((view === 'existing' && (o.phase === 'new' || w.phase === 'new')) || (view === 'proposed' && (o.phase === 'demo' || w.phase === 'demo'))) continue;
      const c = add(fp.a, scale(fp.dir, o.offset));
      for (const sgn of [1, -1]) {
        for (const skew of [0, 8]) {
          const from = add(add(c, scale(fp.normal, sgn * 20)), scale(fp.dir, skew));
          const feet = surfaceAt(world, from, z);
          if (feet === null) continue;
          const end = walkTo(world, { at: from, feet }, add(c, scale(fp.normal, -sgn * 24)));
          walks++;
          expect(dot(sub(end.at, c), fp.normal) * sgn, `${view} ${level.name} ${o.type} ${o.id} from side ${sgn}, ${skew}" off`).toBeLessThan(-6);
        }
      }
    }
  }
  return walks;
}

describe('walk-mode collision', () => {
  it('walks through every door and passage of the starter and the rebuild, both ways, in Existing and Proposed', () => {
    for (const doc of [starter, rebuild]) {
      const plan = migrate(doc as never);
      for (const view of ['existing', 'proposed'] as const) expect(walkThroughDoors(plan, view)).toBeGreaterThan(20);
    }
  });

  it('stops at a wall and cannot leave through an exterior wall but by a door; collision off walks through', () => {
    const plan = migrate(starter as never);
    const s = plan.structures[plan.structureOrder[0]];
    const first = s.levelOrder[1];
    const level = plan.levels[first];
    const fps = getFootprints(level, 'proposed');
    const z = getLevelElevations(plan)[first].floorTop;
    // The longest exterior wall without a door: walk square at it from 30" inside.
    const doored = new Set(Object.values(level.openings).filter((o) => o.type !== 'window').map((o) => o.wallId));
    const wall = Object.values(level.walls)
      .filter((w) => w.kind === 'exterior' && fps.has(w.id) && !doored.has(w.id) && w.phase !== 'demo')
      .sort((p, q) => fps.get(q.id)!.length - fps.get(p.id)!.length)[0];
    const fp = fps.get(wall.id)!;
    const mid = add(fp.a, scale(fp.dir, fp.length / 2));
    const on = walkWorld(plan, 'proposed', s.levelOrder, true);
    const off = walkWorld(plan, 'proposed', s.levelOrder, false);
    // Whichever side has the floor: the inside.
    const side = surfaceAt(on, add(mid, scale(fp.normal, 30)), z) === z ? 1 : -1;
    const from = { at: add(mid, scale(fp.normal, side * 30)), feet: z };
    const target = add(mid, scale(fp.normal, -side * 40));
    const stopped = walkTo(on, from, target);
    const past = dot(sub(stopped.at, mid), fp.normal) * side;
    expect(past).toBeGreaterThan(fp.length > 0 ? wall.thickness / 2 : 0);
    expect(blockedAt(on, add(mid, scale(fp.normal, 0)), z)).toBe(true);
    // With collision off the walk goes through.
    const through = walkTo(off, from, target);
    expect(dot(sub(through.at, mid), fp.normal) * side).toBeLessThan(-wall.thickness);
  });
});
