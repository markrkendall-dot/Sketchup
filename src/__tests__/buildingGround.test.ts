import { beforeEach, describe, expect, it } from 'vitest';
import { terrainHeightAt } from '../derive/site';
import { createEmptyPlan } from '../model/plan';
import { newStructureCentre } from '../model/structureOps';
import { clearHistory, undo, usePlanStore } from '../store/planStore';

const store = () => usePlanStore.getState();
const plan = () => store().plan;

beforeEach(() => {
  store().setPlan(createEmptyPlan('Ground', 'single'));
  clearHistory();
});

describe("a new building's floor on the terrain", () => {
  it('without grade points keeps the template floor (0 on a slab)', () => {
    const id = store().addStructure({ kind: 'garage', origin: { x: 500, y: 0 } });
    expect(plan().structures[id].baseFloorElevation).toBe(0);
  });

  it('with grade points sits on the ground at the middle of its box, at the default place too', () => {
    // Ground falling 1" per 10" to the east: 0 at x 0, -100 at x 1000.
    for (const [x, y] of [
      [0, -500],
      [0, 500],
      [1000, -500],
      [1000, 500],
    ])
      store().addGradePoint({ at: { x, y }, elevation: -x / 10 });
    const id = store().addStructure({ kind: 'garage', origin: { x: 500, y: 0 } });
    const centre = newStructureCentre({ kind: 'garage' }, { x: 500, y: 0 });
    expect(centre).toEqual({ x: 644, y: 144 });
    expect(plan().structures[id].baseFloorElevation).toBe(Math.round(terrainHeightAt(plan().site, centre, 0)));
    expect(plan().structures[id].baseFloorElevation).toBe(-64);
    // The default place (clear of the others) reads the ground there.
    const shed = store().addStructure({ kind: 'shed' });
    const s = plan().structures[shed];
    expect(s.baseFloorElevation).toBe(Math.round(terrainHeightAt(plan().site, newStructureCentre({ kind: 'shed' }, s.origin), 0)));
    expect(s.baseFloorElevation).toBeLessThan(-64);
    // One undo step still.
    undo();
    expect(plan().structures[shed]).toBeUndefined();
  });

  it('a given floor elevation wins', () => {
    store().addGradePoint({ at: { x: 0, y: 0 }, elevation: -30 });
    const id = store().addStructure({ kind: 'shed', origin: { x: 300, y: 0 }, baseFloorElevation: 12 });
    expect(plan().structures[id].baseFloorElevation).toBe(12);
    const other = store().addStructure({ kind: 'other', origin: { x: 600, y: 0 } });
    expect(plan().structures[other].baseFloorElevation).toBe(-30);
  });
});
