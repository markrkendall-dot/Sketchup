import { beforeEach, describe, expect, it } from 'vitest';
import {
  floorToFloor,
  hitStairs,
  normalizeDegrees,
  orthoDirection,
  stairsOutline,
  stairsSymbol,
  stairSteps,
} from '../derive/stairs';
import { polygonSignedArea } from '../model/geometry';
import { createEmptyPlan, defaultLevelId, migrate } from '../model/plan';
import type { Stairs } from '../model/types';
import { clearHistory, undo, usePlanStore } from '../store/planStore';

const store = () => usePlanStore.getState();
const levelId = () => defaultLevelId(store().plan);
const level = () => store().plan.levels[levelId()];

const flight = (s: Partial<Stairs> = {}): Omit<Stairs, 'id'> => ({
  origin: { x: 100, y: 200 },
  direction: 270,
  width: 36,
  run: 120,
  phase: 'existing',
  cutsFloorAbove: true,
  ...s,
});

beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
});

describe('stairs geometry', () => {
  it('outline: origin is the middle of the bottom edge, the run goes along the direction', () => {
    const o = stairsOutline(flight());
    // Up the screen (-y): bottom edge at y = 200, top edge at y = 80, x from 82 to 118.
    expect(o).toEqual([
      { x: 82, y: 200 },
      { x: 82, y: 80 },
      { x: 118, y: 80 },
      { x: 118, y: 200 },
    ]);
    expect(Math.abs(polygonSignedArea(o))).toBe(36 * 120);
  });

  it('exact axis directions, any angle normalized', () => {
    expect(stairsOutline(flight({ direction: 0 }))[1]).toEqual({ x: 220, y: 182 });
    expect(stairsOutline(flight({ direction: 90 }))[1]).toEqual({ x: 118, y: 320 });
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(450)).toBe(90);
  });

  it('risers from floor-to-floor height at about 7.5"', () => {
    const plan = createEmptyPlan();
    const [b, f, s] = plan.levelOrder;
    expect(floorToFloor(plan, b)).toBe(96 + 12);
    expect(floorToFloor(plan, f)).toBe(96 + 12);
    // Top level: its own floor thickness stands in for the missing floor above.
    expect(floorToFloor(plan, s)).toBe(96 + 12);
    expect(stairSteps(108)).toEqual({ risers: 14, rise: 108 / 14 });
    expect(stairSteps(96).risers).toBe(13);
    expect(stairSteps(3).risers).toBe(1);
  });

  it('symbol: tread lines between steps, an arrow pointing up the flight', () => {
    const sym = stairsSymbol(flight(), 14);
    expect(sym.treads).toHaveLength(13);
    const [from, to] = sym.shaft;
    expect(to.y).toBeLessThan(from.y);
    expect(sym.head[1]).toEqual(to);
  });

  it('hit test and mouse heading', () => {
    expect(hitStairs(flight(), { x: 100, y: 150 })).toBe(true);
    expect(hitStairs(flight(), { x: 100, y: 210 })).toBe(false);
    expect(hitStairs(flight(), { x: 100, y: 202 }, 3)).toBe(true);
    expect(orthoDirection({ x: 5, y: 1 })).toBe(0);
    expect(orthoDirection({ x: -5, y: 1 })).toBe(180);
    expect(orthoDirection({ x: 1, y: 6 })).toBe(90);
    expect(orthoDirection({ x: 1, y: -6 })).toBe(270);
  });
});

describe('stairs store actions', () => {
  it('add, update, delete, each one undo step', () => {
    const id = store().addStairs(levelId(), flight({ direction: -90 }))!;
    expect(id).toBeTruthy();
    expect(level().stairs[id].direction).toBe(270);
    store().updateStairs(levelId(), id, { width: 42, cutsFloorAbove: false });
    expect(level().stairs[id]).toMatchObject({ width: 42, cutsFloorAbove: false });
    store().deleteStairs(levelId(), [id]);
    expect(level().stairs[id]).toBeUndefined();
    undo();
    expect(level().stairs[id].width).toBe(42);
    undo();
    expect(level().stairs[id].width).toBe(36);
    undo();
    expect(level().stairs[id]).toBeUndefined();
  });

  it('rejects unusable sizes without an undo step', () => {
    expect(store().addStairs(levelId(), flight({ width: 0 }))).toBeNull();
    expect(store().addStairs(levelId(), flight({ origin: { x: NaN, y: 0 } }))).toBeNull();
    const id = store().addStairs(levelId(), flight())!;
    const plan = store().plan;
    store().updateStairs(levelId(), id, { run: -5 });
    expect(store().plan).toBe(plan);
  });

  it('deleteEntities and setPhase include stairs; other stairs keep their identity', () => {
    const a = store().addStairs(levelId(), flight())!;
    const b = store().addStairs(levelId(), flight({ origin: { x: 300, y: 200 } }))!;
    const before = level().stairs[b];
    store().setPhase(levelId(), { walls: [], openings: [], stairs: [a] }, 'demo');
    expect(level().stairs[a].phase).toBe('demo');
    expect(level().stairs[b]).toBe(before);
    store().deleteEntities(levelId(), { nodes: [], walls: [], stairs: [a] });
    expect(Object.keys(level().stairs)).toEqual([b]);
  });

  it('migrate keeps valid stairs and drops broken ones', () => {
    const id = store().addStairs(levelId(), flight())!;
    const json = JSON.parse(JSON.stringify(store().plan));
    const lv = json.levels[levelId()];
    lv.stairs.bad = { id: 'bad', origin: { x: 'a' }, width: 36, run: 120 };
    lv.stairs.old = { id: 'old', origin: { x: 1, y: 2 }, width: 30, run: 100 };
    const plan = migrate(json);
    const stairs = plan.levels[levelId()].stairs;
    expect(stairs[id]).toEqual(level().stairs[id]);
    expect(stairs.bad).toBeUndefined();
    expect(stairs.old).toEqual({ id: 'old', origin: { x: 1, y: 2 }, direction: 0, width: 30, run: 100, phase: 'existing', cutsFloorAbove: true });
  });
});
