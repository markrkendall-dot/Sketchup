import { beforeEach, describe, expect, it } from 'vitest';
import {
  flightSteps,
  floorToFloor,
  headroomHoleStart,
  stairsBase,
  stairsHeightProblem,
  stairsRise,
  hitStairs,
  normalizeDegrees,
  orthoDirection,
  stairsHoleOutline,
  stairsHoleStart,
  stairsOutline,
  stairsSymbol,
  STAIRS_HEADROOM,
  stairSteps,
} from '../derive/stairs';
import { polygonSignedArea } from '../model/geometry';
import { createEmptyPlan, defaultLevelId, migrate } from '../model/plan';
import example from '../../docs/examples/146-mick-road.json';
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

  it('holds width to 24"-96" and run to 3\'-30\'', () => {
    for (const bad of [{ width: 23 }, { width: 97 }, { width: 500 }, { run: 35 }, { run: 361 }, { run: 600 }]) {
      expect(store().addStairs(levelId(), flight(bad))).toBeNull();
    }
    expect(Object.keys(level().stairs)).toHaveLength(0);
    const lo = store().addStairs(levelId(), flight({ width: 24, run: 36 }));
    const hi = store().addStairs(levelId(), flight({ width: 96, run: 360, origin: { x: 500, y: 0 } }));
    expect(lo && hi).toBeTruthy();
    const plan = store().plan;
    for (const bad of [{ width: 500 }, { width: 10 }, { run: 600 }, { run: 12 }]) {
      store().updateStairs(levelId(), lo!, bad);
      expect(store().plan).toBe(plan);
    }
    store().updateStairs(levelId(), lo!, { width: 48, run: 200 });
    expect(level().stairs[lo!]).toMatchObject({ width: 48, run: 200 });
  });

  it('an older flight outside the limits can still change phase', () => {
    const id = store().addStairs(levelId(), flight())!;
    usePlanStore.setState((s) => {
      s.plan.levels[levelId()].stairs[id].width = 120;
    });
    store().updateStairs(levelId(), id, { phase: 'demo' });
    expect(level().stairs[id]).toMatchObject({ width: 120, phase: 'demo' });
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

describe('the opening a flight cuts in the floor above (REVIEW-2 A2)', () => {
  it("the example stair: 108\" floor to floor, 101\" run from x 31, the opening starts 26\" up, past the 30\" closet", () => {
    const plan = migrate(example);
    const first = plan.levels[plan.levelOrder[1]];
    const st = Object.values(first.stairs)[0];
    const ftf = floorToFloor(plan, first.id);
    expect(ftf).toBe(108);
    expect(STAIRS_HEADROOM).toBe(80);
    expect(stairsHoleStart(st, ftf)).toBeCloseTo((101 * 28) / 108, 9);
    expect(Math.round(stairsHoleStart(st, ftf))).toBe(26);
    const hole = stairsHoleOutline(st, ftf)!;
    // Climbing east from x 31 (its bottom riser about 2' in from the west wall): the opening runs from
    // x 57.2 to 132, the whole 33" width.
    const xs = hole.map((p) => p.x);
    const ys = hole.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(31 + (101 * 28) / 108, 9);
    expect(Math.min(...xs)).toBeGreaterThan(7 + 30); // past the closet (x 7 to 37 inside)
    expect(Math.max(...xs)).toBe(132);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(33);
    expect(polygonSignedArea(hole)).toBeCloseTo(polygonSignedArea(stairsOutline(st)) * (1 - 28 / 108), 6);
  });

  it('holeStart overrides the headroom rule; headroom moves it', () => {
    const s = flight({ run: 120 });
    expect(stairsHoleStart(s, 108)).toBeCloseTo((120 * 28) / 108, 9);
    expect(stairsHoleStart({ ...s, holeStart: 50 }, 108)).toBe(50);
    expect(stairsHoleStart({ ...s, holeStart: 0 }, 108)).toBe(0);
    expect(stairsHoleOutline({ ...s, holeStart: 0 }, 108)).toEqual(stairsOutline(s));
    expect(stairsHoleStart({ ...s, headroom: 84 }, 108)).toBeCloseTo((120 * 24) / 108, 9);
    expect(headroomHoleStart({ ...s, headroom: 84 }, 108)).toBeCloseTo((120 * 24) / 108, 9);
    // Up the screen from y 200: the opening is the top part, y 80 to 200 - 50.
    const ys = stairsHoleOutline({ ...s, holeStart: 50 }, 108)!.map((p) => p.y);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([80, 150]);
  });

  it('an opening shorter than an inch is not cut; a flight lower than the headroom is open all the way', () => {
    // The opening is run * headroom / floorToFloor long by the rule.
    expect(stairsHoleOutline(flight({ headroom: 0.5 }), 108)).toBeNull();
    expect(stairsHoleOutline(flight({ holeStart: 119.5 }), 108)).toBeNull();
    expect(stairsHoleOutline(flight({ holeStart: 200 }), 108)).toBeNull();
    expect(stairsHoleOutline(flight({ holeStart: 118.5 }), 108)).not.toBeNull();
    // 72" floor to floor is less than the 80" headroom: short of headroom from the first step.
    expect(stairsHoleStart(flight(), 72)).toBe(0);
    expect(stairsHoleOutline(flight(), 72)).toEqual(stairsOutline(flight()));
  });

  it('store and migrate: headroom and holeStart are optional, validated, and clear with undefined', () => {
    const id = store().addStairs(levelId(), flight({ headroom: 84, holeStart: 30 }))!;
    expect(level().stairs[id]).toMatchObject({ headroom: 84, holeStart: 30 });
    expect(store().addStairs(levelId(), flight({ headroom: 0 }))).toBeNull();
    expect(store().addStairs(levelId(), flight({ holeStart: -1 }))).toBeNull();
    const before = store().plan;
    store().updateStairs(levelId(), id, { holeStart: Number.NaN });
    expect(store().plan).toBe(before);
    store().updateStairs(levelId(), id, { holeStart: undefined });
    expect('holeStart' in level().stairs[id]).toBe(false);
    expect(level().stairs[id].headroom).toBe(84);
    undo();
    expect(level().stairs[id].holeStart).toBe(30);
    // A flight added without them stores neither key.
    const plain = store().addStairs(levelId(), flight())!;
    expect(Object.keys(level().stairs[plain])).not.toContain('headroom');
    // Migrate keeps valid values, drops broken ones and leaves absent ones absent.
    const json = JSON.parse(JSON.stringify(store().plan));
    const lv = json.levels[levelId()];
    lv.stairs[plain].headroom = -5;
    lv.stairs[plain].holeStart = 'x';
    const loaded = migrate(json).levels[levelId()].stairs;
    expect(loaded[id]).toEqual(level().stairs[id]);
    expect(loaded[plain]).toEqual(level().stairs[plain]);
    expect(JSON.stringify(migrate(JSON.parse(JSON.stringify(store().plan))))).toBe(JSON.stringify(store().plan));
  });
});

describe('short flights and landings: base, rise and risers', () => {
  it('a 22" flight climbing 14" has 2 risers of 7" and cuts no opening', () => {
    const s = flight({ run: 22, rise: 14 });
    expect(stairSteps(14)).toEqual({ risers: 2, rise: 7 });
    expect(stairsBase(s)).toBe(0);
    expect(stairsRise(s, 108)).toBe(14);
    expect(flightSteps(s, 108)).toEqual({ risers: 2, rise: 7 });
    // Its top (14") is far below 108 - 80 = 28": the floor above clears it all the way.
    expect(headroomHoleStart(s, 108)).toBe(22);
    expect(stairsHoleStart(s, 108)).toBe(22);
    expect(stairsHoleOutline(s, 108)).toBeNull();
    // Drawn with its own two steps: one tread line and the UP arrow.
    const sym = stairsSymbol(s, flightSteps(s, 108).risers);
    expect(sym.treads).toHaveLength(1);
    expect(sym.landing).toBe(false);
  });

  it('a landing is one riser: no tread lines, no arrow, no opening', () => {
    const s = flight({ run: 36, rise: 14, risers: 1, cutsFloorAbove: false });
    expect(flightSteps(s, 108)).toEqual({ risers: 1, rise: 14 });
    const sym = stairsSymbol(s, flightSteps(s, 108).risers);
    expect(sym.treads).toHaveLength(0);
    expect(sym.landing).toBe(true);
    expect(stairsHoleOutline(s, 108)).toBeNull();
  });

  it('a flight from a 14" landing climbing 94" over 126": 13 risers, the opening from where the treads reach 28"', () => {
    const s = flight({ run: 126, base: 14, rise: 94 });
    const steps = flightSteps(s, 108);
    expect(steps.risers).toBe(13);
    expect(steps.rise).toBeCloseTo(94 / 13, 12);
    const d0 = stairsHoleStart(s, 108);
    expect(14 + (94 * d0) / 126).toBeCloseTo(108 - 80, 9);
    expect(d0).toBeCloseTo(18.766, 3);
    expect(Math.round(d0 * 10) / 10).toBe(18.8);
    // Up the screen from y 200: the opening runs from 200 - d0 to the top at y 74.
    const ys = stairsHoleOutline(s, 108)!.map((p) => p.y);
    expect(Math.min(...ys)).toBe(74);
    expect(Math.max(...ys)).toBeCloseTo(200 - d0, 9);
    // The risers override wins over the 7.5" rule; an unusable one is ignored.
    expect(stairSteps(94, 12)).toEqual({ risers: 12, rise: 94 / 12 });
    expect(stairSteps(94, 0).risers).toBe(13);
    expect(stairSteps(94, 2.5).risers).toBe(13);
    // Rise defaults to the rest of the way up from the base.
    expect(stairsRise(flight({ base: 14 }), 108)).toBe(94);
  });

  it('the example stair has none of the new fields and keeps its steps and opening', () => {
    const plan = migrate(example);
    const first = plan.levels[plan.levelOrder[1]];
    const st = Object.values(first.stairs)[0];
    for (const k of ['base', 'rise', 'risers']) expect(k in st).toBe(false);
    const ftf = floorToFloor(plan, first.id);
    expect(flightSteps(st, ftf)).toEqual(stairSteps(ftf));
    expect(flightSteps(st, ftf).risers).toBe(14);
    expect(headroomHoleStart(st, ftf)).toBe((101 * (108 - 80)) / 108);
  });

  it('store: heights are validated against floor to floor, clear with undefined, one undo step each', () => {
    expect(floorToFloor(store().plan, levelId())).toBe(108);
    // The top of the flight may be at most 1" above the floor above.
    expect(store().addStairs(levelId(), flight({ base: 14, rise: 96 }))).toBeNull();
    expect(store().addStairs(levelId(), flight({ base: 109 }))).toBeNull();
    expect(store().addStairs(levelId(), flight({ base: 108 }))).toBeNull();
    expect(store().addStairs(levelId(), flight({ base: -1 }))).toBeNull();
    expect(store().addStairs(levelId(), flight({ rise: 0 }))).toBeNull();
    expect(store().addStairs(levelId(), flight({ rise: Number.NaN }))).toBeNull();
    expect(store().addStairs(levelId(), flight({ risers: 0 }))).toBeNull();
    expect(store().addStairs(levelId(), flight({ risers: 2.5 }))).toBeNull();
    expect(stairsHeightProblem({ base: 14, rise: 96 }, 108)).toBe('the top of the flight must not be above the floor above');
    expect(stairsHeightProblem({ base: 14, rise: 95 }, 108)).toBeNull();
    expect(Object.keys(level().stairs)).toHaveLength(0);
    const id = store().addStairs(levelId(), flight({ run: 126, base: 14, rise: 95, risers: 13 }))!;
    expect(level().stairs[id]).toMatchObject({ base: 14, rise: 95, risers: 13 });
    const plain = store().addStairs(levelId(), flight({ origin: { x: 400, y: 200 } }))!;
    for (const k of ['base', 'rise', 'risers']) expect(k in level().stairs[plain]).toBe(false);
    // A rejected edit leaves the plan untouched (no undo step).
    const before = store().plan;
    store().updateStairs(levelId(), id, { rise: 100 });
    store().updateStairs(levelId(), id, { risers: 0 });
    store().updateStairs(levelId(), id, { base: -2 });
    expect(store().plan).toBe(before);
    store().updateStairs(levelId(), id, { rise: 94 });
    expect(level().stairs[id].rise).toBe(94);
    store().updateStairs(levelId(), id, { risers: undefined, base: undefined });
    expect('risers' in level().stairs[id]).toBe(false);
    expect('base' in level().stairs[id]).toBe(false);
    undo();
    expect(level().stairs[id]).toMatchObject({ base: 14, rise: 94, risers: 13 });
    undo();
    expect(level().stairs[id].rise).toBe(95);
    // Clearing the climb is checked too: from a base of 14" the rest of the way up is fine.
    store().updateStairs(levelId(), id, { rise: undefined });
    expect(stairsRise(level().stairs[id], 108)).toBe(94);
  });
});
