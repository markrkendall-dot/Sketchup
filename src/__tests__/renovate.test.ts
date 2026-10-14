import { beforeEach, describe, expect, it } from 'vitest';
import { getFaces } from '../derive/rooms';
import { createEmptyPlan, defaultLevelId } from '../model/plan';
import { CUT_IN_OPENING_MESSAGE, DEMO_MOVE_MESSAGE, existingViewSignature, planRenovation } from '../model/renovate';
import type { Id, Level, Vec2, Wall } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';
import { WALL_OVERLAP_MESSAGE } from '../model/plan';

const store = () => usePlanStore.getState();
let lid: Id;
const level = (): Level => store().plan.levels[lid];
const ext = { kind: 'exterior' as const, thickness: 6, phase: 'existing' as const };
const int = { kind: 'interior' as const, thickness: 4, phase: 'existing' as const };
const wallAt = (lv: Level, a: Vec2, b: Vec2): Wall | undefined =>
  Object.values(lv.walls).find((w) => {
    const p = lv.nodes[w.a];
    const q = lv.nodes[w.b];
    return (p.x === a.x && p.y === a.y && q.x === b.x && q.y === b.y) || (p.x === b.x && p.y === b.y && q.x === a.x && q.y === a.y);
  });
const shift = (id: Id, v: Vec2) => new Map([[id, v]]);

// A 20' box of 6" exterior walls with an interior wall from the north wall down x 120 to y 100, then
// east along y 100 to the east wall (an L: two walls meeting at the corner (120, 100)).
let down: Id;
let across: Id;
beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
  lid = defaultLevelId(store().plan);
  const c = [
    { x: 0, y: 0 },
    { x: 240, y: 0 },
    { x: 240, y: 240 },
    { x: 0, y: 240 },
  ];
  for (let i = 0; i < 4; i++) store().addWall(lid, c[i], c[(i + 1) % 4], ext);
  store().addWall(lid, { x: 120, y: 0 }, { x: 120, y: 100 }, int);
  store().addWall(lid, { x: 120, y: 100 }, { x: 240, y: 100 }, int);
  down = wallAt(level(), { x: 120, y: 0 }, { x: 120, y: 100 })!.id;
  across = wallAt(level(), { x: 120, y: 100 }, { x: 240, y: 100 })!.id;
});

describe('planRenovation', () => {
  it('moving a wall into the wall it meets: the old one demolished, a new one built, the met wall cut back with its piece demolished', () => {
    const r = planRenovation(level(), shift(down, { x: 12, y: 0 }));
    if ('error' in r) throw new Error(r.error);
    const lv = r.level;
    expect(lv.walls[down].phase).toBe('demo');
    const built = wallAt(lv, { x: 132, y: 0 }, { x: 132, y: 100 })!;
    expect(built).toMatchObject({ phase: 'new', kind: 'interior', thickness: 4 });
    expect(r.walls).toEqual([built.id]);
    expect(wallAt(lv, { x: 120, y: 100 }, { x: 132, y: 100 })!.phase).toBe('demo');
    expect(wallAt(lv, { x: 132, y: 100 }, { x: 240, y: 100 })!.phase).toBe('existing');
    // The house as it stands looks the same; in the proposed view the rooms close.
    expect(existingViewSignature(lv)).toBe(existingViewSignature(level()));
    for (const vm of ['existing', 'proposed'] as const) expect(getFaces(lv, vm).openEnds).toEqual([]);
  });

  it('moving away from it: a new piece carries the met wall out to the new corner', () => {
    const r = planRenovation(level(), shift(down, { x: -12, y: 0 }));
    if ('error' in r) throw new Error(r.error);
    expect(wallAt(r.level, { x: 108, y: 0 }, { x: 108, y: 100 })!.phase).toBe('new');
    expect(wallAt(r.level, { x: 108, y: 100 }, { x: 120, y: 100 })).toMatchObject({ phase: 'new', kind: 'interior', thickness: 4 });
    expect(wallAt(r.level, { x: 120, y: 100 }, { x: 240, y: 100 })!.phase).toBe('existing');
    for (const vm of ['existing', 'proposed'] as const) expect(getFaces(r.level, vm).openEnds).toEqual([]);
  });

  it('a wall meeting a through wall in a T just meets it further along', () => {
    // `across` meets the east wall (x 240, running through y 100) in a T: move it 20" south.
    const r = planRenovation(level(), shift(across, { x: 0, y: 20 }));
    if ('error' in r) throw new Error(r.error);
    expect(wallAt(r.level, { x: 120, y: 120 }, { x: 240, y: 120 })!.phase).toBe('new');
    // The down wall is extended to the new corner.
    expect(wallAt(r.level, { x: 120, y: 100 }, { x: 120, y: 120 })!.phase).toBe('new');
    expect(existingViewSignature(r.level)).toBe(existingViewSignature(level()));
  });

  it('copies the moved wall\'s openings onto the new wall and demolishes the old ones', () => {
    store().addOpening(lid, { wallId: down, type: 'door', offset: 50, width: 30, height: 80, sill: 0, phase: 'existing' });
    const r = planRenovation(level(), shift(down, { x: 12, y: 0 }));
    if ('error' in r) throw new Error(r.error);
    const ops = Object.values(r.level.openings);
    expect(ops.map((o) => [o.phase, r.level.walls[o.wallId].phase]).sort()).toEqual([
      ['demo', 'demo'],
      ['new', 'new'],
    ]);
  });

  it('refuses a cut through a door, a demolished wall, and a wall laid on another', () => {
    store().addOpening(lid, { wallId: across, type: 'door', offset: 12, width: 30, height: 80, sill: 0, phase: 'existing' });
    expect(planRenovation(level(), shift(down, { x: 12, y: 0 }))).toEqual({ error: CUT_IN_OPENING_MESSAGE });
    store().setPhase(lid, { walls: [down], openings: [] }, 'demo');
    expect(planRenovation(level(), shift(down, { x: -12, y: 0 }))).toEqual({ error: DEMO_MOVE_MESSAGE });
    store().setPhase(lid, { walls: [down], openings: [] }, 'existing');
    // Onto the east wall.
    expect(planRenovation(level(), shift(across, { x: 0, y: -100 }))).toMatchObject({ error: expect.any(String) });
    // Onto a wall standing in its way (y 150, x 150..200).
    store().addWall(lid, { x: 150, y: 150 }, { x: 200, y: 150 }, int);
    expect(planRenovation(level(), shift(across, { x: 0, y: 50 }))).toEqual({ error: WALL_OVERLAP_MESSAGE });
  });

  it('just moves a new wall', () => {
    store().setPhase(lid, { walls: [down], openings: [] }, 'new');
    const r = planRenovation(level(), shift(down, { x: -12, y: 0 }));
    if ('error' in r) throw new Error(r.error);
    expect(Object.values(r.level.walls).filter((w) => w.phase === 'demo')).toEqual([]);
    expect(r.level.walls[down]).toBeDefined();
  });
});
