import { beforeEach, describe, expect, it } from 'vitest';
import { getLevelElevations } from '../derive/levels';
import { siteGhostLevelId } from '../derive/site';
import { floorToFloor } from '../derive/stairs';
import { levelContentCount } from '../model/levelOps';
import { createEmptyPlan, defaultLevelId, groundLevelId, migrate, neighbourLevelId, PLAN_TEMPLATES, type PlanTemplate } from '../model/plan';
import type { Plan, Post, Vec2 } from '../model/types';
import { clearHistory, redo, undo, usePlanStore } from '../store/planStore';
import { forgetGoneLevels, useUiStore } from '../store/uiStore';
import { firstStructure } from '../model/structures';

const store = () => usePlanStore.getState();
const plan = () => store().plan;
const order = () => firstStructure(plan()).levelOrder;
const tops = () => {
  const e = getLevelElevations(plan());
  return Object.fromEntries(order().map((id) => [id, e[id].floorTop]));
};
const ext = { kind: 'exterior', thickness: 6.5, phase: 'existing' } as const;
function box(levelId: string, x0: number, y0: number, x1: number, y1: number): void {
  const p: Vec2[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  store().addWalls(
    levelId,
    p.map((a, i) => ({ a, b: p[(i + 1) % 4] })),
    ext,
  );
}
const roundTrip = (p: Plan) => migrate(JSON.parse(JSON.stringify(p)));

function start(template?: PlanTemplate): void {
  store().setPlan(createEmptyPlan('Test', template));
  clearHistory();
}

describe('templates', () => {
  it('keeps the default plan as it was: a basement and two floors', () => {
    const p = createEmptyPlan();
    expect(firstStructure(p).levelOrder.map((id) => [p.levels[id].name, p.levels[id].wallHeight, p.levels[id].floorThickness])).toEqual([
      ['Basement', 96, 4],
      ['First Floor', 96, 12],
      ['Second Floor', 96, 12],
    ]);
    expect(firstStructure(p).baseFloorElevation).toBe(-100);
    expect(defaultLevelId(p)).toBe(firstStructure(p).levelOrder[1]);
  });

  it.each(PLAN_TEMPLATES.map((t) => t.id))('%s survives validation unchanged and opens on its ground floor', (t) => {
    const p = createEmptyPlan('T', t);
    expect(roundTrip(p)).toEqual(p);
    const ground = t === 'basementTwoStorey' ? firstStructure(p).levelOrder[1] : firstStructure(p).levelOrder[0];
    expect(defaultLevelId(p)).toBe(ground);
    expect(siteGhostLevelId(firstStructure(p))).toBe(ground);
    expect(getLevelElevations(p)[ground].floorTop).toBeGreaterThanOrEqual(0);
  });

  it('has the levels each template names', () => {
    const count = (t: PlanTemplate) => firstStructure(createEmptyPlan('T', t)).levelOrder.length;
    expect([count('single'), count('twoStorey'), count('basementTwoStorey'), count('outbuilding')]).toEqual([1, 2, 3, 1]);
    const shed = createEmptyPlan('T', 'outbuilding');
    const level = shed.levels[firstStructure(shed).levelOrder[0]];
    expect(level.wallHeight).toBeLessThan(96);
    expect(level.floorThickness).toBe(4);
    expect(firstStructure(shed).baseFloorElevation).toBe(0);
  });

  it('groundLevelId without a base elevation keeps the old rule (the level above the lowest)', () => {
    expect(groundLevelId({ levelOrder: ['a', 'b'] })).toBe('b');
    expect(groundLevelId({ levelOrder: ['a'] })).toBe('a');
  });
});

describe('addLevel', () => {
  beforeEach(() => start('single'));

  it('adds above the top with the wall height below it and a framed floor over a slab', () => {
    const [g] = order();
    const r = store().addLevel('top')!;
    expect(order()).toEqual([g, r.id]);
    const added = plan().levels[r.id];
    expect(added.wallHeight).toBe(96);
    expect(added.floorThickness).toBe(12);
    expect(tops()[r.id]).toBe(0 + 96 + 12);
    expect(roundTrip(plan())).toEqual(plan());
  });

  it('adds below the bottom without moving any existing level', () => {
    start('basementTwoStorey');
    const before = tops();
    const [b] = order();
    const r = store().addLevel('bottom')!;
    expect(order()[0]).toBe(r.id);
    expect(order().slice(1)).toEqual(Object.keys(before));
    for (const [id, top] of Object.entries(before)) expect(tops()[id]).toBe(top);
    const added = plan().levels[r.id];
    expect(added.wallHeight).toBe(plan().levels[b].wallHeight);
    expect(added.floorThickness).toBe(plan().levels[b].floorThickness);
    expect(firstStructure(plan()).baseFloorElevation).toBe(-100 - 96 - 4);
    // The new level's ceiling is the bottom of the old lowest level's floor.
    expect(getLevelElevations(plan())[r.id].ceiling).toBe(getLevelElevations(plan())[b].slabBottom);
  });

  it('adds just above or below a level and the levels over it rise', () => {
    start('twoStorey');
    const [f, s] = order();
    const sTop = tops()[s];
    const mid = store().addLevel({ above: f })!;
    expect(order()).toEqual([f, mid.id, s]);
    expect(tops()[s]).toBe(sTop + 96 + 12);
    const under = store().addLevel({ below: s })!;
    expect(order()).toEqual([f, mid.id, under.id, s]);
    expect(store().addLevel({ above: 'nope' })).toBeNull();
    expect(new Set(order().map((id) => plan().levels[id].name)).size).toBe(4);
  });

  it('is one undo step each', () => {
    const [g] = order();
    store().addLevel('top');
    store().addLevel('bottom');
    expect(order()).toHaveLength(3);
    undo();
    expect(order()).toHaveLength(2);
    expect(firstStructure(plan()).baseFloorElevation).toBe(0);
    undo();
    expect(order()).toEqual([g]);
    redo();
    expect(order()).toHaveLength(2);
  });

  it('strips what only the lowest level may have from the level that stops being lowest', () => {
    const [g] = order();
    const stairsId = store().addStairs(g, { origin: { x: 0, y: 0 }, direction: 270, width: 36, run: 60, base: -20, phase: 'new', cutsFloorAbove: false, open: true })!;
    const post: Omit<Post, 'id'> = { kind: 'post', at: { x: 50, y: 50 }, width: 5.5, depth: 5.5, rotation: 0, phase: 'new', footing: { width: 24, thickness: 12 } };
    const postId = store().addMember(g, post)!;
    expect(stairsId && postId).toBeTruthy();
    const r = store().addLevel('bottom')!;
    const level = plan().levels[g];
    expect(level.stairs[stairsId].base).toBeUndefined();
    expect((level.members[postId] as Post).footing).toBeUndefined();
    expect(r.adjusted).toHaveLength(2);
    // Saved and read back, nothing more is lost.
    expect(roundTrip(plan())).toEqual(plan());
    undo();
    expect(plan().levels[g].stairs[stairsId].base).toBe(-20);
  });
});

describe('deleteLevel', () => {
  beforeEach(() => start());

  it('refuses the last level', () => {
    start('single');
    const before = plan();
    expect(store().deleteLevel(order()[0])).toBeNull();
    expect(plan()).toBe(before);
  });

  it('deletes everything on it, keeps the others valid and undoes in one step', () => {
    const [b, f, s] = order();
    box(f, 0, 0, 240, 240);
    box(s, 0, 0, 240, 240);
    // A flight on the basement climbs to the First Floor; a floor opening in the Second Floor.
    const st = store().addStairs(b, { origin: { x: 60, y: 200 }, direction: 270, width: 36, run: 120, rise: 108, phase: 'existing', cutsFloorAbove: true })!;
    store().addFloorOpening(s, { outline: [{ x: 40, y: 40 }, { x: 100, y: 40 }, { x: 100, y: 100 }, { x: 40, y: 100 }], phase: 'new' });
    expect(levelContentCount(plan(), f)).toBeGreaterThan(0);
    const sTop = tops()[s];
    const r = store().deleteLevel(f)!;
    expect(r.id).toBe(f);
    expect(order()).toEqual([b, s]);
    expect(plan().levels[f]).toBeUndefined();
    // The Second Floor comes down by the First Floor's storey.
    expect(tops()[s]).toBe(sTop - 96 - 12);
    // The basement flight now climbs to the Second Floor, whose floor is as thick: still fits.
    expect(floorToFloor(plan(), b)).toBe(96 + 12);
    expect(plan().levels[b].stairs[st].rise).toBe(108);
    expect(roundTrip(plan())).toEqual(plan());
    undo();
    expect(order()).toEqual([b, f, s]);
    expect(Object.keys(plan().levels[f].walls).length).toBe(4);
  });

  it('keeps the levels above in place when the lowest is deleted', () => {
    const [b, f, s] = order();
    const before = tops();
    store().deleteLevel(b);
    expect(order()).toEqual([f, s]);
    expect(tops()[f]).toBe(before[f]);
    expect(tops()[s]).toBe(before[s]);
    expect(firstStructure(plan()).baseFloorElevation).toBe(before[f]);
  });

  it('drops a set climb that no longer fits under the floor above', () => {
    const [b, f, s] = order();
    store().updateLevel(s, { floorThickness: 4 });
    // 96 + 12 to the First Floor's top: a flight climbing 106 fits; to the thinner Second Floor's it does not.
    const st = store().addStairs(b, { origin: { x: 60, y: 200 }, direction: 270, width: 36, run: 120, rise: 106, phase: 'existing', cutsFloorAbove: false })!;
    const r = store().deleteLevel(f)!;
    expect(plan().levels[b].stairs[st].rise).toBeUndefined();
    expect(r.adjusted[0]).toMatch(/flight/);
  });
});

describe('moveLevel', () => {
  beforeEach(() => start());

  it('swaps a level with its neighbour, keeps the base elevation and undoes', () => {
    const [b, f, s] = order();
    expect(store().moveLevel(s, 'up')).toBeNull();
    expect(store().moveLevel(b, 'down')).toBeNull();
    store().moveLevel(f, 'up');
    expect(order()).toEqual([b, s, f]);
    expect(firstStructure(plan()).baseFloorElevation).toBe(-100);
    store().moveLevel(f, 'down');
    store().moveLevel(f, 'down');
    expect(order()).toEqual([f, b, s]);
    expect(tops()[f]).toBe(-100);
    undo();
    undo();
    undo();
    expect(order()).toEqual([b, f, s]);
  });

  it('strips lowest-only parts when the lowest level moves up', () => {
    const [b, f] = order();
    const st = store().addStairs(b, { origin: { x: 0, y: 0 }, direction: 270, width: 36, run: 60, base: -30, phase: 'new', cutsFloorAbove: false, open: true })!;
    store().moveLevel(b, 'up');
    expect(order()[0]).toBe(f);
    expect(plan().levels[b].stairs[st].base).toBeUndefined();
    expect(roundTrip(plan())).toEqual(plan());
  });
});

describe('the UI after a level is gone', () => {
  it('picks the nearest level below, else above', () => {
    start();
    const [b, f, s] = order();
    const prev = order();
    store().deleteLevel(f);
    expect(neighbourLevelId(prev, plan(), f)).toBe(b);
    store().addLevel('top');
    const prev2 = order();
    store().deleteLevel(b);
    expect(neighbourLevelId(prev2, plan(), b)).toBe(s);
    expect(neighbourLevelId(prev2, plan(), 'unknown')).toBeUndefined();
  });

  it('forgets 3D checkboxes and a walk on levels that are gone', () => {
    start();
    const [b, f] = order();
    useUiStore.setState({ hidden3dLevels: [b, f], walkLevelId: f, cameraMode: 'walk' });
    store().deleteLevel(f);
    forgetGoneLevels(plan());
    expect(useUiStore.getState().hidden3dLevels).toEqual([b]);
    expect(useUiStore.getState().walkLevelId).toBeNull();
    expect(useUiStore.getState().cameraMode).toBe('orbit');
  });
});
