import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchKey, dispatchPointer, switchTool, type ToolPointerEvent } from '../editor2d/tools';
import { createEmptyPlan, defaultLevelId, migrate, MIGRATIONS, SCHEMA_VERSION } from '../model/plan';
import { staircaseProblem, staircaseStyleOf, STAIR_STYLE_DEFAULTS } from '../model/stairStyle';
import type { Id, Level } from '../model/types';
import { clearHistory, undo, usePlanStore, type NewStairs } from '../store/planStore';
import { EMPTY_SELECTION, useUiStore } from '../store/uiStore';

const store = () => usePlanStore.getState();
const ui = () => useUiStore.getState();
let lid: Id;
const level = (): Level => store().plan.levels[lid];
const ptr = (x: number, y: number, over: Partial<ToolPointerEvent> = {}): ToolPointerEvent => ({ world: { x, y }, screen: { x, y }, button: 0, shiftKey: false, altKey: false, modKey: false, ...over });
const press = (key: string) => dispatchKey({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent);

const R = 108 / 15;
const piece = (over: Partial<NewStairs>): NewStairs => ({ origin: { x: 0, y: 0 }, direction: 0, width: 42, run: 84, phase: 'new', cutsFloorAbove: false, ...over });
/** A flight of 8 east from x 40 (y 0..42) to a 1-riser landing at x 124..166, and a second flight east beyond it. */
let flight = '';
let landing = '';
let other = '';
beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
  lid = defaultLevelId(store().plan);
  ui().setActiveLevel(lid);
  ui().setViewMode('all');
  ui().setViewport({ tx: 0, ty: 0, k: 1 });
  switchTool('select');
  flight = store().addStairs(lid, piece({ origin: { x: 40, y: 21 }, rise: 8 * R, risers: 8 }))!;
  landing = store().addStairs(lid, piece({ origin: { x: 124, y: 21 }, run: 42, base: 8 * R, rise: R, risers: 1 }))!;
  other = store().addStairs(lid, piece({ origin: { x: 300, y: 21 }, rise: 8 * R, risers: 8 }))!;
});
afterEach(() => ui().setOpenStaircase(null));

describe('staircase style', () => {
  it('fills the defaults and checks each field', () => {
    expect(staircaseStyleOf(undefined)).toEqual(STAIR_STYLE_DEFAULTS);
    expect(staircaseStyleOf({ nosing: 1.25, handrail: 'board' })).toMatchObject({ nosing: 1.25, handrail: 'board', newel: 'box' });
    expect(staircaseProblem({ treadColor: '#B5835A', underside: 'framed' })).toBeNull();
    expect(staircaseProblem({ treadColor: 'oak' })).toMatch(/hex/);
    expect(staircaseProblem({ nosing: 3 })).toMatch(/nosing must be from 0" to 1.5"/);
    expect(staircaseProblem({ underside: 'floating' as never })).toMatch(/underside/);
  });
});

describe('staircase store actions', () => {
  it('groups pieces in one undo step, styles them, and ungroups', () => {
    const id = store().groupStairs(lid, [flight, landing], { name: 'Main', treadColor: '#B5835A' })!;
    expect(level().staircases[id]).toEqual({ id, name: 'Main', treadColor: '#b5835a' });
    expect([level().stairs[flight].staircaseId, level().stairs[landing].staircaseId, level().stairs[other].staircaseId]).toEqual([id, id, undefined]);
    undo();
    expect(level().staircases).toEqual({});
    expect(level().stairs[flight].staircaseId).toBeUndefined();
    store().groupStairs(lid, [flight, landing], { id });
    store().updateStaircase(lid, id, { underside: 'framed', nosing: 1.25 });
    expect(level().staircases[id]).toMatchObject({ underside: 'framed', nosing: 1.25 });
    const before = store().plan;
    store().updateStaircase(lid, id, { nosing: 9 }); // refused
    store().updateStaircase(lid, id, { nosing: 1.25 }); // unchanged
    expect(store().plan).toBe(before);
    store().updateStaircase(lid, id, { nosing: undefined });
    expect('nosing' in level().staircases[id]).toBe(false);
    store().ungroupStaircase(lid, id);
    expect(level().staircases).toEqual({});
    expect(level().stairs[landing].staircaseId).toBeUndefined();
  });

  it('refuses no pieces or a bad style; moving a piece to a new staircase drops the empty old one', () => {
    expect(store().groupStairs(lid, ['nope'])).toBeNull();
    expect(store().groupStairs(lid, [flight], { riserColor: 'white' })).toBeNull();
    const a = store().groupStairs(lid, [flight])!;
    const b = store().groupStairs(lid, [flight, landing])!;
    expect(Object.keys(level().staircases)).toEqual([b]);
    expect(a).not.toBe(b);
  });

  it('deletes a staircase with its pieces, phases its pieces, and drops it when its last piece goes', () => {
    const id = store().groupStairs(lid, [flight, landing])!;
    store().setPhase(lid, { walls: [], openings: [], staircases: [id] }, 'demo');
    expect([level().stairs[flight].phase, level().stairs[landing].phase, level().stairs[other].phase]).toEqual(['demo', 'demo', 'new']);
    store().deleteEntities(lid, { nodes: [], walls: [], staircases: [id] });
    expect(Object.keys(level().stairs)).toEqual([other]);
    expect(level().staircases).toEqual({});
    const s2 = store().groupStairs(lid, [other])!;
    store().deleteStairs(lid, [other]);
    expect(level().staircases[s2]).toBeUndefined();
  });

  it('moves pieces in one undo step, and a new piece naming no staircase forgets it', () => {
    store().moveStairs(lid, { [flight]: { x: 50, y: 21 }, [landing]: { x: 134, y: 21 } });
    expect([level().stairs[flight].origin.x, level().stairs[landing].origin.x]).toEqual([50, 134]);
    undo();
    expect([level().stairs[flight].origin.x, level().stairs[landing].origin.x]).toEqual([40, 124]);
    const id = store().addStairs(lid, piece({ origin: { x: 500, y: 21 }, staircaseId: 'gone' }))!;
    expect(level().stairs[id].staircaseId).toBeUndefined();
  });
});

describe('staircases in the file', () => {
  it('schema 6 adds staircases to every level; a v5 file gains empty records', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(6);
    const v5 = JSON.parse(JSON.stringify({ ...createEmptyPlan(), schemaVersion: 5 }));
    for (const l of Object.values(v5.levels) as Record<string, unknown>[]) delete l.staircases;
    expect(MIGRATIONS[5](v5).schemaVersion).toBe(6);
    const loaded = migrate(v5);
    for (const id of loaded.levelOrder) expect(loaded.levels[id].staircases).toEqual({});
  });

  it('keeps a good staircase, drops a bad field with a warning, forgets dangling ids, drops an empty one, and round-trips', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    store().groupStairs(lid, [flight, landing], { id: 'sc1', name: 'Main', underside: 'framed' });
    const doc = JSON.parse(JSON.stringify(store().plan));
    const l = doc.levels[lid];
    l.staircases.sc1.nosing = 'deep';
    l.staircases.sc1.treadColor = '#AABBCC';
    l.staircases.empty = { id: 'empty' };
    l.stairs[other].staircaseId = 'missing';
    const loaded = migrate(doc);
    const ll = loaded.levels[lid];
    expect(ll.staircases).toEqual({ sc1: { id: 'sc1', name: 'Main', underside: 'framed', treadColor: '#aabbcc' } });
    expect(ll.stairs[other].staircaseId).toBeUndefined();
    expect(ll.stairs[flight].staircaseId).toBe('sc1');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/staircase sc1: the nosing/));
    expect(JSON.stringify(migrate(JSON.parse(JSON.stringify(loaded))))).toBe(JSON.stringify(loaded));
    warn.mockRestore();
  });
});

describe('selecting a staircase on the plan', () => {
  let id = '';
  beforeEach(() => {
    id = store().groupStairs(lid, [flight, landing])!;
    clearHistory();
  });

  it('a click on a piece selects the staircase; a loose flight selects itself', () => {
    dispatchPointer('down', ptr(60, 21));
    dispatchPointer('up', ptr(60, 21));
    expect(ui().selection).toEqual({ ...EMPTY_SELECTION, staircases: [id] });
    dispatchPointer('down', ptr(320, 21));
    dispatchPointer('up', ptr(320, 21));
    expect(ui().selection).toEqual({ ...EMPTY_SELECTION, stairs: [other] });
  });

  it('a double-click opens it: the piece alone, then Esc goes back to the staircase', () => {
    dispatchPointer('down', ptr(140, 21));
    dispatchPointer('up', ptr(140, 21));
    dispatchPointer('dblclick', ptr(140, 21));
    expect(ui().openStaircaseId).toBe(id);
    expect(ui().selection).toEqual({ ...EMPTY_SELECTION, stairs: [landing] });
    // While open, a click on another of its pieces picks that piece.
    dispatchPointer('down', ptr(60, 21));
    dispatchPointer('up', ptr(60, 21));
    expect(ui().selection).toEqual({ ...EMPTY_SELECTION, stairs: [flight] });
    press('Escape');
    expect(ui().openStaircaseId).toBeNull();
    expect(ui().selection).toEqual({ ...EMPTY_SELECTION, staircases: [id] });
  });

  it('a drag moves every piece in one undo step', () => {
    dispatchPointer('down', ptr(60, 21));
    dispatchPointer('move', ptr(70, 31));
    dispatchPointer('move', ptr(80, 41));
    dispatchPointer('up', ptr(80, 41));
    expect([level().stairs[flight].origin, level().stairs[landing].origin, level().stairs[other].origin]).toEqual([
      { x: 60, y: 41 },
      { x: 144, y: 41 },
      { x: 300, y: 21 },
    ]);
    undo();
    expect([level().stairs[flight].origin, level().stairs[landing].origin]).toEqual([
      { x: 40, y: 21 },
      { x: 124, y: 21 },
    ]);
  });
});
