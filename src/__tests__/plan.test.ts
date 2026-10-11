import { beforeEach, describe, expect, it } from 'vitest';
import { getFootprints } from '../derive/footprint';
import { getGraph } from '../derive/graph';
import { adjustTypedLength } from '../editor2d/tools/wallTool';
import { createEmptyPlan, defaultLevelId, floorTops, migrate, SCHEMA_VERSION } from '../model/plan';
import type { Level, Opening } from '../model/types';
import {
  clearHistory,
  pauseHistory,
  redo,
  resumeHistory,
  undo,
  usePlanStore,
} from '../store/planStore';

const opts = { kind: 'exterior', thickness: 6.5, phase: 'existing' } as const;
const store = () => usePlanStore.getState();
const level = (): Level => {
  const plan = store().plan;
  return plan.levels[defaultLevelId(plan)];
};
const levelId = () => defaultLevelId(store().plan);

beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
});

describe('createEmptyPlan', () => {
  it('has three levels with the documented defaults', () => {
    const plan = createEmptyPlan();
    expect(plan.schemaVersion).toBe(SCHEMA_VERSION);
    expect(plan.levelOrder.map((id) => plan.levels[id].name)).toEqual([
      'Basement',
      'First Floor',
      'Second Floor',
    ]);
    const [b, f, s] = plan.levelOrder.map((id) => plan.levels[id]);
    expect([b.wallHeight, b.floorThickness]).toEqual([96, 4]);
    expect([f.wallHeight, f.floorThickness]).toEqual([96, 12]);
    expect([s.wallHeight, s.floorThickness]).toEqual([96, 12]);
    expect(plan.baseFloorElevation).toBe(-100);
    expect(plan.settings).toEqual({
      snapGrid: 1,
      displayGrid: 12,
      precisionDenominator: 16,
      defaultExteriorThickness: 6.5,
      defaultInteriorThickness: 4.5,
      orthoLock: true,
      measureTo: 'center',
    });
    expect(defaultLevelId(plan)).toBe(plan.levelOrder[1]);
    expect(floorTops(plan)).toEqual([-100, 8, 116]);
  });
});

describe('migrate', () => {
  it('round-trips a plan through JSON', () => {
    const plan = createEmptyPlan('House');
    expect(migrate(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
  });
  it('throws readable errors', () => {
    expect(() => migrate(null)).toThrow(/expected a JSON object/);
    expect(() => migrate({})).toThrow(/missing schemaVersion/);
    expect(() => migrate({ schemaVersion: 2 })).toThrow(/unsupported schemaVersion 2/);
    expect(() => migrate({ schemaVersion: 1, levelOrder: [] })).toThrow(/levelOrder/);
    expect(() => migrate({ schemaVersion: 1, levelOrder: ['x'], levels: {} })).toThrow(/level x/);
    expect(() =>
      migrate({
        schemaVersion: 1,
        levelOrder: ['L'],
        levels: { L: { nodes: {}, walls: { w: { a: 'n1', b: 'n2', thickness: 4 } } } },
      }),
    ).toThrow(/missing node/);
  });
  it('fills missing optional records and settings', () => {
    const plan = migrate({
      schemaVersion: 1,
      levelOrder: ['L'],
      levels: { L: { name: 'Main', nodes: {}, walls: {} } },
      settings: { snapGrid: 0.5 },
    });
    expect(plan.levels.L.openings).toEqual({});
    expect(plan.settings.snapGrid).toBe(0.5);
    expect(plan.settings.defaultExteriorThickness).toBe(6.5);
  });
});

describe('planStore', () => {
  it('addWall creates nodes and reuses nodes within MERGE_EPS', () => {
    const r1 = store().addWall(levelId(), { x: 0, y: 0 }, { x: 120, y: 0 }, opts)!;
    const r2 = store().addWall(levelId(), { x: 120.3, y: 0.2 }, { x: 120, y: 96 }, opts)!;
    expect(r2.a).toBe(r1.b);
    expect(Object.keys(level().nodes)).toHaveLength(3);
    expect(Object.keys(level().walls)).toHaveLength(2);
    const r3 = store().addWall(levelId(), r2.b, r1.a, opts)!;
    expect(r3.bWasExisting).toBe(true);
    expect(Object.keys(level().nodes)).toHaveLength(3);
  });

  it('does not create duplicate walls between the same nodes', () => {
    const r1 = store().addWall(levelId(), { x: 0, y: 0 }, { x: 120, y: 0 }, opts)!;
    store().addWall(levelId(), r1.b, r1.a, opts);
    expect(Object.keys(level().walls)).toHaveLength(1);
  });

  it('splits a wall when a new wall starts on it (T junction)', () => {
    store().addWall(levelId(), { x: 0, y: 0 }, { x: 200, y: 0 }, opts);
    const r = store().addWall(levelId(), { x: 80, y: 0 }, { x: 80, y: 100 }, opts)!;
    expect(Object.keys(level().walls)).toHaveLength(3);
    expect(getGraph(level()).degree(r.a)).toBe(3);
  });

  it('every mutating action sets modifiedAt', async () => {
    const before = store().plan.modifiedAt;
    await new Promise((res) => setTimeout(res, 5));
    store().updateSettings({ orthoLock: false });
    expect(store().plan.modifiedAt).not.toBe(before);
  });

  it('deleteWalls removes orphaned nodes and openings on those walls', () => {
    const r1 = store().addWall(levelId(), { x: 0, y: 0 }, { x: 120, y: 0 }, opts)!;
    store().addWall(levelId(), r1.b, { x: 120, y: 120 }, opts);
    const wallId = r1.wallIds[0];
    usePlanStore.setState((s) => {
      const op: Opening = {
        id: 'o1',
        wallId,
        type: 'door',
        offset: 60,
        width: 32,
        height: 80,
        sill: 0,
        phase: 'existing',
      };
      s.plan.levels[levelId()].openings.o1 = op;
    });
    store().deleteWalls(levelId(), [wallId]);
    expect(Object.keys(level().walls)).toHaveLength(1);
    expect(Object.keys(level().nodes)).toHaveLength(2);
    expect(level().openings).toEqual({});
  });

  it('deleteNodes removes incident walls', () => {
    const r1 = store().addWall(levelId(), { x: 0, y: 0 }, { x: 120, y: 0 }, opts)!;
    store().addWall(levelId(), r1.b, { x: 120, y: 120 }, opts);
    store().deleteNodes(levelId(), [r1.b]);
    expect(level().walls).toEqual({});
    expect(level().nodes).toEqual({});
  });

  it('moveNode merges onto a node it lands on', () => {
    const r1 = store().addWall(levelId(), { x: 0, y: 0 }, { x: 120, y: 0 }, opts)!;
    const r2 = store().addWall(levelId(), { x: 0, y: 50 }, { x: 120, y: 50 }, opts)!;
    store().moveNode(levelId(), r2.b, { x: 120.2, y: 0 });
    expect(Object.keys(level().nodes)).toHaveLength(3);
    expect(level().nodes[r1.b]).toBeDefined();
    expect(level().nodes[r2.b]).toBeUndefined();
  });

  it('undo/redo whole actions; a paused drag is one step', () => {
    const r = store().addWall(levelId(), { x: 0, y: 0 }, { x: 120, y: 0 }, opts)!;
    store().addWall(levelId(), r.b, { x: 120, y: 100 }, opts);
    // Drag: first set tracked, the rest untracked.
    store().moveNodes(levelId(), { [r.b]: { x: 130, y: 0 } }, { normalize: false });
    pauseHistory();
    store().moveNodes(levelId(), { [r.b]: { x: 140, y: 0 } }, { normalize: false });
    store().moveNodes(levelId(), { [r.b]: { x: 150, y: 0 } }, { normalize: false });
    store().normalize(levelId(), [r.b]);
    resumeHistory();
    expect(level().nodes[r.b].x).toBe(150);
    undo();
    expect(level().nodes[r.b].x).toBe(120);
    undo();
    expect(Object.keys(level().walls)).toHaveLength(1);
    undo();
    expect(Object.keys(level().walls)).toHaveLength(0);
    redo();
    redo();
    redo();
    expect(level().nodes[r.b].x).toBe(150);
  });
});

describe('derive memoization', () => {
  it('getFootprints keeps identity for unchanged walls', () => {
    const r1 = store().addWall(levelId(), { x: 0, y: 0 }, { x: 120, y: 0 }, opts)!;
    const r2 = store().addWall(levelId(), { x: 0, y: 100 }, { x: 120, y: 100 }, opts)!;
    const f1 = getFootprints(level(), 'all');
    expect(getFootprints(level(), 'all')).toBe(f1);
    const fp = f1.get(r1.wallIds[0])!;
    expect(fp.quad).toEqual([
      { x: 0, y: -3.25 },
      { x: 120, y: -3.25 },
      { x: 120, y: 3.25 },
      { x: 0, y: 3.25 },
    ]);
    expect([fp.s0, fp.s1]).toEqual([0, 120]);

    store().moveNode(levelId(), r2.b, { x: 130, y: 100 });
    const f2 = getFootprints(level(), 'all');
    expect(f2).not.toBe(f1);
    expect(f2.get(r1.wallIds[0])).toBe(fp);
    expect(f2.get(r2.wallIds[0])).not.toBe(f1.get(r2.wallIds[0]));

    // A plan change that does not touch walls returns the previous map itself.
    store().renameLevel(levelId(), 'Main');
    expect(getFootprints(level(), 'all')).toBe(f2);
  });

  it('getGraph survives node moves', () => {
    const r = store().addWall(levelId(), { x: 0, y: 0 }, { x: 120, y: 0 }, opts)!;
    const g = getGraph(level());
    expect(g.degree(r.a)).toBe(1);
    store().moveNode(levelId(), r.b, { x: 100, y: 0 });
    expect(getGraph(level())).toBe(g);
  });
});

describe('wall tool measureTo adjustment', () => {
  const right = { x: 1, y: 0 };
  const down = { x: 0, y: 1 };
  it('center leaves the length alone', () => {
    expect(adjustTypedLength(360, 'center', 6.5, right, null)).toBe(360);
  });
  it('inside adds and outside subtracts one thickness at square corners', () => {
    expect(adjustTypedLength(360, 'inside', 6.5, down, right)).toBe(366.5);
    expect(adjustTypedLength(360, 'outside', 6.5, down, right)).toBe(353.5);
    expect(adjustTypedLength(360, 'outside', 6.5, right, null)).toBe(353.5);
  });
  it('uses the thickness of the wall it starts from plus half its own (M3 rule)', () => {
    // Previous wall 4.5" interior, new wall 6.5": inside adds 2.25 + 3.25, outside subtracts it.
    expect(adjustTypedLength(120, 'inside', 6.5, down, right, 4.5)).toBe(125.5);
    expect(adjustTypedLength(120, 'outside', 6.5, down, right, 4.5)).toBe(114.5);
    expect(adjustTypedLength(-120, 'inside', 6.5, down, right, 4.5)).toBe(-125.5);
  });
  it('no adjustment when continuing straight or at an angle', () => {
    expect(adjustTypedLength(360, 'inside', 6.5, right, right)).toBe(360);
    expect(adjustTypedLength(360, 'inside', 6.5, right, { x: Math.SQRT1_2, y: Math.SQRT1_2 })).toBe(360);
  });
});
