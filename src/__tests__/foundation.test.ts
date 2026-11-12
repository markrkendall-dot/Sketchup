import { beforeEach, describe, expect, it } from 'vitest';
import { FOOTING_DEPTH, FOUNDATION_BURY, foundationLayout, foundationRegion } from '../derive/foundation';
import { getLevelElevations } from '../derive/levels';
import { clearMeshCache, getFoundationMeshes } from '../derive/meshes';
import { planTerrain } from '../derive/site';
import { buildExportScene, disposeExportScene } from '../io/export3d';
import { polygonSignedArea } from '../model/geometry';
import { createEmptyPlan, migrate } from '../model/plan';
import type { Id, Plan, Vec2 } from '../model/types';
import { clearHistory, undo, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';

const store = () => usePlanStore.getState();
const plan = () => store().plan;
const ext = (phase: 'existing' | 'new' = 'existing') => ({ kind: 'exterior', thickness: 8, phase }) as const;
const ring = (lid: Id, pts: Vec2[], phase: 'existing' | 'new' = 'existing', closed = true) => {
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) expect(store().addWall(lid, pts[i], pts[(i + 1) % pts.length], ext(phase))).not.toBeNull();
};
const levels = () => plan().structures[plan().structureOrder[0]].levelOrder;
const area = (pieces: Vec2[][]) => pieces.reduce((s, p) => s + Math.abs(polygonSignedArea(p)), 0);

/** A basement 300 x 240 (centerlines) under a First Floor of the same block plus a new wing 150 x 200 east of it, over nothing. */
function house(): { basement: Id; first: Id } {
  const [basement, first] = levels();
  const block = [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
    { x: 300, y: 240 },
    { x: 0, y: 240 },
  ];
  ring(basement, block);
  ring(first, block);
  ring(first, [{ x: 300, y: 20 }, { x: 450, y: 20 }, { x: 450, y: 220 }, { x: 300, y: 220 }], 'new', false);
  return { basement, first };
}

beforeEach(() => {
  store().setPlan(createEmptyPlan('Foundation', 'basementTwoStorey'));
  clearHistory();
  clearMeshCache();
  useUiStore.getState().setViewMode('proposed');
});

describe('the region a foundation goes under', () => {
  it('is the part of the floor over no floor of the level below: the wing, out to its walls\' outside faces', () => {
    const { first } = house();
    const { pieces } = foundationRegion(plan(), first, 'proposed');
    // 304..454 x 16..224 (the wing's outside faces, from the block's outside face).
    expect(area(pieces)).toBeCloseTo(150 * 208, 0);
    // In Existing the wing is not there: nothing.
    expect(foundationRegion(plan(), first, 'existing').pieces).toHaveLength(0);
  });
});

describe('a stem wall foundation', () => {
  it('runs round the wing but not against the basement, down to its depth on a footing; the ground is cut under the wing', () => {
    const { first } = house();
    expect(getFoundationMeshes(plan(), first, 'proposed')).toHaveLength(0);
    store().updateLevel(first, { foundation: { kind: 'stem', wallThickness: 8, depth: 40, material: 'block' } });
    const lay = foundationLayout(plan(), first, 'proposed', () => -200)!;
    expect(lay.kind).toBe('stem');
    const walls = lay.solids.filter((s) => s.top === -plan().levels[first].floorThickness);
    // Three sides (north, east, south), none along x 304 where the basement is.
    expect(walls).toHaveLength(3);
    for (const w of walls) expect(w.poly.every((p) => p.x > 303.9)).toBe(true);
    const along = walls.reduce((s, w) => s + Math.abs(polygonSignedArea(w.poly)), 0) / 8;
    expect(along).toBeGreaterThan(150 * 2 + 208 - 3 * 8 - 1);
    expect(along).toBeLessThan(150 * 2 + 208 + 1);
    // Ground far below: the walls go down into it; a footing under each.
    expect(Math.min(...walls.map((w) => w.bottom))).toBeCloseTo(-200 - FOUNDATION_BURY, 6);
    const footings = lay.solids.filter((s) => !walls.includes(s));
    expect(footings).toHaveLength(3);
    for (const f of footings) expect(f.top - f.bottom).toBeCloseTo(FOOTING_DEPTH, 6);
    // Ground at the floor: the stated depth.
    const high = foundationLayout(plan(), first, 'proposed', () => 0)!;
    expect(Math.min(...high.solids.map((s) => s.top))).toBeCloseTo(-40, 6);
    // The meshes: new work, one geometry.
    const meshes = getFoundationMeshes(plan(), first, 'all');
    expect(meshes.map((m) => m.phase)).toEqual(['new']);
    expect(meshes[0].material).toBe('block');
    // The ground under the wing is cut to just under the floor framing.
    const grid = planTerrain(plan(), 'proposed');
    const elev = getLevelElevations(plan())[first];
    let found = false;
    for (let i = 0; i < grid.positions.length; i += 3) {
      const [x, y, z] = [grid.positions[i], grid.positions[i + 1], grid.positions[i + 2]];
      if (x > 330 && x < 430 && z > 40 && z < 200) {
        found = true;
        expect(y).toBeCloseTo(elev.slabBottom - 2, 6);
      }
    }
    expect(found).toBe(true);
    // The export carries it.
    const root = buildExportScene(plan(), 'proposed', { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: first });
    let named = false;
    root.traverse((o) => {
      if (o.name.startsWith('Foundation')) named = true;
    });
    disposeExportScene(root);
    expect(named).toBe(true);
  });

  it('a slab on grade fills the region under the floor; none takes the field away; it is saved and undone', () => {
    const { first } = house();
    store().updateLevel(first, { foundation: { kind: 'slab', thickness: 6 } });
    const lay = foundationLayout(plan(), first, 'proposed', () => 0)!;
    expect(lay.kind).toBe('slab');
    const top = -plan().levels[first].floorThickness;
    for (const s of lay.solids) {
      expect(s.top).toBe(top);
      expect(s.bottom).toBeCloseTo(Math.min(top - 6, -FOUNDATION_BURY), 6);
    }
    expect(area(lay.solids.map((s) => s.poly))).toBeCloseTo(150 * 208, 0);
    const saved = migrate(JSON.parse(JSON.stringify(plan())) as Plan);
    expect(saved.levels[first].foundation).toEqual({ kind: 'slab', thickness: 6 });
    // Bad sizes are refused.
    store().updateLevel(first, { foundation: { kind: 'slab', thickness: -1 } });
    expect(plan().levels[first].foundation).toEqual({ kind: 'slab', thickness: 6 });
    store().updateLevel(first, { foundation: { kind: 'none' } });
    expect('foundation' in plan().levels[first]).toBe(false);
    undo();
    expect(plan().levels[first].foundation?.kind).toBe('slab');
  });

  it('under the lowest level, the whole floor', () => {
    const [basement] = levels();
    ring(basement, [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ]);
    store().updateLevel(basement, { foundation: { kind: 'stem' } });
    const lay = foundationLayout(plan(), basement, 'proposed', () => 0)!;
    // Four sides, joined into one closed run of mitred walls.
    expect(lay.solids.filter((s) => s.top === -plan().levels[basement].floorThickness)).toHaveLength(4);
  });
});
