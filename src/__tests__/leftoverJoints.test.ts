import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyPlan, defaultLevelId, mergeLeftoverJoints } from '../model/plan';
import type { Level, Plan } from '../model/types';
import { clearHistory, undo, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';

const store = () => usePlanStore.getState();
const plan = (): Plan => store().plan;
const ui = () => useUiStore.getState();
let L = '';
const level = (): Level => plan().levels[L];
const wallsAt = (x: number, y: number) => Object.values(level().walls).filter((w) => [w.a, w.b].some((id) => level().nodes[id].x === x && level().nodes[id].y === y));

beforeEach(() => {
  store().setPlan(createEmptyPlan('T', 'single'));
  L = defaultLevelId(plan());
  ui().setActiveLevel(L);
  clearHistory();
});

/** A 240" wall along y = 0 with a stem teeing into it at x = 100; returns the stem's id. */
function tee(): string {
  store().addWall(L, { x: 0, y: 0 }, { x: 240, y: 0 }, { thickness: 6, kind: 'exterior', phase: 'existing' });
  store().addWall(L, { x: 100, y: 0 }, { x: 100, y: 120 }, { thickness: 4.5, kind: 'interior', phase: 'existing' });
  expect(Object.keys(level().walls)).toHaveLength(3);
  return wallsAt(100, 120)[0].id;
}

describe('leftover wall joints', () => {
  it('deleting the stem of a T joins the two pieces back into one wall; openings keep their places; one undo', () => {
    const stem = tee();
    const [left, right] = wallsAt(100, 0).filter((w) => w.id !== stem).sort((p, q) => level().nodes[p.a].x + level().nodes[p.b].x - (level().nodes[q.a].x + level().nodes[q.b].x));
    store().addOpening(L, { wallId: left.id, type: 'window', offset: 50, width: 30, height: 40, sill: 36, phase: 'existing' });
    const doorId = store().addOpening(L, { wallId: right.id, type: 'door', offset: 70, width: 36, height: 80, sill: 0, phase: 'existing', swing: { hinge: 'a', side: 'left' } })!;
    // Where the openings are on the site, before.
    const centre = (id: string) => {
      const o = level().openings[id];
      const w = level().walls[o.wallId];
      const a = level().nodes[w.a];
      const b = level().nodes[w.b];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      return { x: a.x + ((b.x - a.x) * o.offset) / len, y: a.y + ((b.y - a.y) * o.offset) / len };
    };
    const ids = Object.keys(level().openings);
    const before = Object.fromEntries(ids.map((id) => [id, centre(id)]));
    const beforePlan = plan();
    store().deleteEntities(L, { nodes: [], walls: [stem] });
    expect(Object.keys(level().walls)).toHaveLength(1);
    expect(Object.keys(level().nodes)).toHaveLength(2);
    for (const id of ids) {
      expect(centre(id).x).toBeCloseTo(before[id].x, 9);
      expect(centre(id).y).toBeCloseTo(before[id].y, 9);
    }
    const merged = Object.values(level().walls)[0];
    expect(level().openings[doorId].wallId).toBe(merged.id);
    undo();
    expect(plan()).toBe(beforePlan);
  });

  it('turns a door round with a piece that ran the other way', () => {
    const lv: Level = structuredClone(level());
    lv.nodes = { p: { id: 'p', x: 0, y: 0 }, n: { id: 'n', x: 100, y: 0 }, q: { id: 'q', x: 240, y: 0 } };
    const base = { thickness: 6, kind: 'exterior' as const, phase: 'existing' as const };
    lv.walls = { w1: { id: 'w1', a: 'p', b: 'n', ...base }, w2: { id: 'w2', a: 'q', b: 'n', ...base } };
    // On w2 (q -> n), 30" from q: 110" from p on the merged wall.
    lv.openings = { d: { id: 'd', wallId: 'w2', type: 'door', offset: 30, width: 36, height: 80, sill: 0, phase: 'existing', swing: { hinge: 'a', side: 'left' } } };
    expect(mergeLeftoverJoints(lv, ['n'])).toEqual(['n']);
    expect(lv.walls.w1).toMatchObject({ a: 'p', b: 'q' });
    expect(lv.openings.d).toMatchObject({ wallId: 'w1', offset: 210, swing: { hinge: 'b', side: 'right' } });
    // w1 running away from the corner: the merged wall starts at the other far end.
    const lv2: Level = structuredClone(level());
    lv2.nodes = { p: { id: 'p', x: 0, y: 0 }, n: { id: 'n', x: 100, y: 0 }, q: { id: 'q', x: 240, y: 0 } };
    lv2.walls = { w1: { id: 'w1', a: 'n', b: 'p', ...base }, w2: { id: 'w2', a: 'n', b: 'q', ...base } };
    lv2.openings = { x: { id: 'x', wallId: 'w1', type: 'window', offset: 40, width: 20, height: 30, sill: 30, phase: 'existing' }, y: { id: 'y', wallId: 'w2', type: 'window', offset: 40, width: 20, height: 30, sill: 30, phase: 'existing' } };
    mergeLeftoverJoints(lv2, ['n']);
    expect(lv2.walls.w1).toMatchObject({ a: 'q', b: 'p' });
    // x was 40" from n toward p: 140 + 40 from q. y was 40" from n toward q: 100 from q.
    expect(lv2.openings.x.offset).toBe(180);
    expect(lv2.openings.y.offset).toBe(100);
  });

  it('leaves the corner when the pieces differ in any property, bend, or another wall meets it', () => {
    const stem = tee();
    const pieces = wallsAt(100, 0).filter((w) => w.id !== stem);
    store().updateWalls(L, [pieces[0].id], { finish: 'shingle' });
    store().deleteEntities(L, { nodes: [], walls: [stem] });
    expect(Object.keys(level().walls)).toHaveLength(2);
    // A bend.
    const lv: Level = structuredClone(level());
    lv.nodes = { p: { id: 'p', x: 0, y: 0 }, n: { id: 'n', x: 100, y: 0 }, q: { id: 'q', x: 200, y: 10 } };
    const base = { thickness: 6, kind: 'exterior' as const, phase: 'existing' as const };
    lv.walls = { w1: { id: 'w1', a: 'p', b: 'n', ...base }, w2: { id: 'w2', a: 'n', b: 'q', ...base } };
    lv.openings = {};
    expect(mergeLeftoverJoints(lv, ['n'])).toEqual([]);
    // Different phase or option tags.
    lv.nodes.q = { id: 'q', x: 200, y: 0 };
    lv.walls.w2 = { ...lv.walls.w2, phase: 'new' };
    expect(mergeLeftoverJoints(lv, ['n'])).toEqual([]);
    lv.walls.w2 = { ...lv.walls.w2, phase: 'existing', optionIds: ['b'] };
    expect(mergeLeftoverJoints(lv, ['n'])).toEqual([]);
    // A third wall of any phase (a demolished one) at the corner.
    lv.walls.w2 = { id: 'w2', a: 'n', b: 'q', ...base };
    lv.nodes.r = { id: 'r', x: 100, y: 80 };
    lv.walls.w3 = { id: 'w3', a: 'n', b: 'r', ...base, phase: 'demo' };
    expect(mergeLeftoverJoints(lv, ['n'])).toEqual([]);
    delete lv.walls.w3;
    expect(mergeLeftoverJoints(lv, ['n'])).toEqual(['n']);
  });

  it('deleting the option that built the stem joins the pieces too', () => {
    tee();
    const b = store().addOption('B')!;
    ui().setActiveOption(b);
    store().addWall(L, { x: 180, y: 0 }, { x: 180, y: 120 }, { thickness: 4.5, kind: 'interior', phase: 'new' });
    expect(Object.keys(level().walls)).toHaveLength(5);
    store().deleteOption(b);
    expect(Object.keys(level().walls)).toHaveLength(3);
    expect(wallsAt(180, 0)).toHaveLength(0);
  });
});
