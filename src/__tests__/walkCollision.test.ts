import { describe, expect, it } from 'vitest';
import { getFootprints } from '../derive/footprint';
import { getLevelElevations } from '../derive/levels';
import { add, dot, scale, sub } from '../model/geometry';
import { createEmptyPlan, defaultLevelId, migrate } from '../model/plan';
import type { Fixture, Plan, Vec2, ViewMode } from '../model/types';
import { blockedAt, fixtureObstacles, surfaceAt, walkMove, walkWorld, type WalkState, type WalkWorld } from '../view3d/walk';
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
    // A closet's opening with machines standing in it (the laundry's washer and dryer) is not walked through.
    const fixtures = { surfaces: [], obstacles: fixtureObstacles(plan, lid, view, z), ground: () => null };
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
          if ([-24, -12, 0, 12, 20].some((d) => blockedAt(fixtures, add(add(c, scale(fp.normal, sgn * d)), scale(fp.dir, d === 20 ? skew : 0)), z))) continue;
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

describe('cabinets and appliances in the way (walk.ts fixtureObstacles)', () => {
  const setup = () => {
    const plan = createEmptyPlan('Kitchen', 'single');
    const lid = defaultLevelId(plan);
    const level = plan.levels[lid];
    const z = getLevelElevations(plan)[lid].floorTop;
    const fx = (id: string, f: Partial<Fixture>) => {
      level.fixtures[id] = { id, kind: 'base', origin: { x: 0, y: 0 }, direction: 90, width: 30, depth: 24, height: 34.5, elevation: 0, phase: 'existing', ...f } as Fixture;
    };
    return { plan, lid, z, fx };
  };

  it('a base cabinet stops the walker, a wall cabinet over the waist and a piece of furniture do not', () => {
    const { plan, lid, z, fx } = setup();
    fx('base', {});
    fx('upper', { kind: 'wall', origin: { x: 100, y: 0 }, depth: 12, height: 30, elevation: 54 });
    fx('chest', { kind: 'furniture', piece: 'chest', origin: { x: 200, y: 0 } });
    const world = { surfaces: [], obstacles: fixtureObstacles(plan, lid, 'existing', z), ground: () => null };
    expect(world.obstacles).toHaveLength(2);
    expect(blockedAt(world, { x: 0, y: 12 }, z)).toBe(true);
    // Just clear of its front (24" deep, kept 2" from).
    expect(blockedAt(world, { x: 0, y: 25 }, z)).toBe(true);
    expect(blockedAt(world, { x: 0, y: 27 }, z)).toBe(false);
    expect(blockedAt(world, { x: 100, y: 6 }, z)).toBe(false);
    expect(blockedAt(world, { x: 200, y: 6 }, z)).toBe(false);
  });

  it('follows the view: a new cabinet is not there in Existing, a demolished one is open in All', () => {
    const { plan, lid, z, fx } = setup();
    fx('new', { phase: 'new' });
    fx('demo', { phase: 'demo', origin: { x: 100, y: 0 } });
    const ids = (view: ViewMode) => fixtureObstacles(plan, lid, view, z).length;
    expect(ids('existing')).toBe(1);
    expect(ids('proposed')).toBe(1);
    expect(ids('all')).toBe(1);
    const all = { surfaces: [], obstacles: fixtureObstacles(plan, lid, 'all', z), ground: () => null };
    expect(blockedAt(all, { x: 0, y: 12 }, z)).toBe(true);
    expect(blockedAt(all, { x: 100, y: 12 }, z)).toBe(false);
  });
});
