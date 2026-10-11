import { Mesh, type BufferGeometry, type MeshStandardMaterial } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearMeshCache, buildColumnGeometry, buildTerrainGeometry, getLevelMeshes, getSiteMeshes, getTerrainGeometry } from '../derive/meshes';
import {
  columnDefaults,
  columnOutline,
  defaultGradeElevation,
  fallbackElevation,
  highestRidge,
  lowestRoofUnderside,
  planTerrain,
  pointInColumn,
  siteBounds,
  sunPosition,
  terrainBounds,
  terrainFor,
  terrainGrid,
  terrainHeightAt,
  TERRAIN_MARGIN,
  TERRAIN_MAX_CELLS,
  TERRAIN_STEP,
} from '../derive/site';
import { dispatchKey, dispatchPointer, enterSiteMode, setViewMode, switchLevel, switchTool, type ToolPointerEvent } from '../editor2d/tools';
import { hitSite } from '../editor2d/tools/siteTools';
import { buildExportScene, disposeExportScene, type ExportLevelVisibility } from '../io/export3d';
import { createEmptyPlan, defaultLevelId, defaultSite, migrate } from '../model/plan';
import type { Column, Plan, Roof, Site, Vec2 } from '../model/types';
import { clearHistory, redo, undo, usePlanStore } from '../store/planStore';
import { EMPTY_SELECTION, selectionSize, useUiStore } from '../store/uiStore';
import { bindingFor } from '../ui/keymap';
import { planBox } from '../view3d/bounds';
import { visible3dLevels } from '../view3d/visibility';

const store = () => usePlanStore.getState();
const plan = (): Plan => store().plan;
const ui = () => useUiStore.getState();

const gp = (x: number, y: number, elevation: number) => ({ id: `g${x},${y}`, at: { x, y }, elevation });
const siteWith = (...points: ReturnType<typeof gp>[]): Site => ({
  northAngle: 0,
  gradePoints: Object.fromEntries(points.map((p) => [p.id, p])),
  columns: {},
});

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** The 26.5' x 25.5' block on First Floor (floor top 8, 96" walls) with a gable roof along x. */
function house() {
  store().setPlan(createEmptyPlan('Site test'));
  clearHistory();
  const first = defaultLevelId(plan());
  const A = { x: 0, y: 0 };
  const B = { x: 311.5, y: 0 };
  const C = { x: 311.5, y: 299.5 };
  const D = { x: 0, y: 299.5 };
  const opts = { kind: 'exterior' as const, thickness: 6.5, phase: 'existing' as const };
  store().addWall(first, A, B, opts);
  store().addWall(first, B, C, opts);
  store().addWall(first, C, D, opts);
  store().addWall(first, D, A, opts);
  const roof: Omit<Roof, 'id'> = {
    shape: 'gable',
    outline: rect(-3.25, -3.25, 314.75, 302.75),
    ridgeAngle: 0,
    pitch: 8,
    overhang: 24,
    bearingOffset: 0,
    thickness: 8,
    fascia: 6,
    phase: 'existing',
    finish: 'metal',
  };
  const roofId = store().addRoof(first, roof)!;
  clearHistory();
  return { first, roofId, basement: plan().levelOrder[0], roof };
}

const GABLE_RIDGE_ABS = 8 + 96 + 153 * (8 / 12); // underside at the ridge, absolute: 206

beforeEach(() => {
  clearMeshCache();
  store().setPlan(createEmptyPlan());
  clearHistory();
  ui().setActiveLevel(defaultLevelId(plan()));
  ui().setTool('select');
  ui().setViewMode('all');
});

describe('terrainHeightAt', () => {
  it('is exact at each grade point and within 1 inch of it', () => {
    const site = siteWith(gp(0, 0, -4), gp(300, 0, -4), gp(0, 300, -76), gp(300, 300, -76));
    for (const g of Object.values(site.gradePoints)) {
      expect(terrainHeightAt(site, g.at, 0)).toBe(g.elevation);
      expect(terrainHeightAt(site, { x: g.at.x + 0.6, y: g.at.y - 0.7 }, 0)).toBe(g.elevation);
    }
    expect(terrainHeightAt(site, { x: 0, y: 1.5 }, 0)).not.toBe(-4);
  });

  it('is flat at the fallback without grade points, and flat with a single one', () => {
    expect(terrainHeightAt(defaultSite(), { x: 12, y: 34 }, -104)).toBe(-104);
    const one = siteWith(gp(50, 50, -30));
    expect(terrainHeightAt(one, { x: -400, y: 900 }, -104)).toBeCloseTo(-30, 9);
  });

  it('weights by inverse square distance', () => {
    const site = siteWith(gp(0, 0, 0), gp(100, 0, 100));
    // Midway: equal weights.
    expect(terrainHeightAt(site, { x: 50, y: 0 }, 0)).toBeCloseTo(50, 9);
    // A quarter of the way: weights 1/25^2 and 1/75^2, so 0.9 of the pull is the near point's.
    expect(terrainHeightAt(site, { x: 25, y: 0 }, 0)).toBeCloseTo(10, 9);
    // Symmetric about the line through the points.
    expect(terrainHeightAt(site, { x: 50, y: 40 }, 0)).toBeCloseTo(terrainHeightAt(site, { x: 50, y: -40 }, 0), 9);
  });
});

describe('terrainGrid', () => {
  const bounds = { minX: 0, minY: 0, maxX: 318, maxY: 306 };

  it('is a 24" grid over the bounds plus 40 feet, rounded out to whole cells', () => {
    const g = terrainGrid(defaultSite(), bounds, -104);
    expect(g.step).toBe(TERRAIN_STEP);
    expect(g.bounds).toEqual(terrainBounds(bounds));
    expect(g.bounds).toEqual({ minX: -480, minY: -480, maxX: 816, maxY: 792 });
    expect(g.cellsX).toBe(54);
    expect(g.cellsY).toBe(53);
    expect(g.positions.length).toBe(55 * 54 * 3);
    expect(g.indices.length).toBe(54 * 53 * 6);
    // Covers the plan with the full margin.
    expect(g.bounds.minX).toBeLessThanOrEqual(bounds.minX - TERRAIN_MARGIN);
    expect(g.bounds.maxY).toBeGreaterThanOrEqual(bounds.maxY + TERRAIN_MARGIN);
    // Flat at the fallback without grade points.
    for (let i = 1; i < g.positions.length; i += 3) expect(g.positions[i]).toBe(-104);
  });

  it('puts a vertex exactly on a grade point that falls on the grid', () => {
    const site = siteWith(gp(0, 0, -4), gp(312, 288, -76));
    const g = terrainGrid(site, bounds, -104);
    const at = (x: number, y: number) => {
      const i = Math.round((x - g.bounds.minX) / g.step);
      const j = Math.round((y - g.bounds.minY) / g.step);
      return g.positions[(j * (g.cellsX + 1) + i) * 3 + 1];
    };
    expect(at(0, 0)).toBe(-4);
    expect(at(312, 288)).toBe(-76);
  });

  it('every triangle faces up and the vertex normals point up', () => {
    const site = siteWith(gp(0, 0, -4), gp(300, 0, -4), gp(0, 300, -76), gp(300, 300, -76));
    const g = terrainGrid(site, bounds, -104);
    const p = g.positions;
    let area = 0;
    for (let t = 0; t < g.indices.length; t += 3) {
      const [a, b, c] = [g.indices[t], g.indices[t + 1], g.indices[t + 2]].map((i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const ny = u[2] * v[0] - u[0] * v[2];
      expect(ny).toBeGreaterThan(0);
      area += ny / 2;
    }
    // The plan-view area is the whole grid.
    expect(area).toBeCloseTo((g.bounds.maxX - g.bounds.minX) * (g.bounds.maxY - g.bounds.minY), 3);
    const geometry = buildTerrainGeometry(g);
    const n = geometry.getAttribute('normal');
    for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBeGreaterThan(0.9);
    geometry.dispose();
  });

  it('caps the grid at 200 x 200 cells by coarsening the step', () => {
    const huge = { minX: 0, minY: 0, maxX: 30000, maxY: 20000 };
    const g = terrainGrid(defaultSite(), huge, 0);
    expect(g.cellsX).toBeLessThanOrEqual(TERRAIN_MAX_CELLS);
    expect(g.cellsY).toBeLessThanOrEqual(TERRAIN_MAX_CELLS);
    expect(g.step).toBeGreaterThan(TERRAIN_STEP);
    expect(g.bounds.minX).toBeLessThanOrEqual(-TERRAIN_MARGIN);
    expect(g.bounds.maxX).toBeGreaterThanOrEqual(30000 + TERRAIN_MARGIN);
    expect(g.positions.length).toBe((g.cellsX + 1) * (g.cellsY + 1) * 3);
    // Just under the cap keeps the standard step.
    const edge = { minX: 0, minY: 0, maxX: 24 * (TERRAIN_MAX_CELLS - 2) - 2 * TERRAIN_MARGIN, maxY: 100 };
    expect(terrainGrid(defaultSite(), edge, 0).step).toBe(TERRAIN_STEP);
  });
});

describe('terrain memo and geometry', () => {
  it('terrainFor returns the same grid while the grade points, bounds and fallback are the same', () => {
    const site = siteWith(gp(0, 0, -4));
    const b = { minX: 0, minY: 0, maxX: 318, maxY: 306 };
    const g1 = terrainFor(site, b, -104);
    expect(terrainFor(site, b, -104)).toBe(g1);
    // A site object with the same grade points record (a column edit) hits the memo.
    const edited: Site = { ...site, columns: { x: {} as Column } };
    expect(terrainFor(edited, b, -104)).toBe(g1);
    // A wall moving about inside the same cells does not change the grid.
    expect(terrainFor(site, { ...b, maxX: 322 }, -104)).toBe(g1);
    // New fallback, bounds past a cell, or other grade points do.
    expect(terrainFor(site, b, -100)).not.toBe(g1);
    expect(terrainFor(siteWith(gp(0, 0, -4)), b, -100)).not.toBe(g1);
    expect(terrainFor(site, { ...b, maxX: 400 }, -100)).not.toBe(terrainFor(site, b, -100));
  });

  it('the fallback is the bottom of the lowest slab; bounds cover nodes, roofs, columns and grade points', () => {
    const { first } = house();
    expect(fallbackElevation(plan())).toBe(-104);
    store().updateLevel(plan().levelOrder[0], { floorThickness: 8 });
    expect(fallbackElevation(plan())).toBe(-108);
    expect(siteBounds(plan())).toEqual({ minX: -3.25, minY: -3.25, maxX: 314.75, maxY: 302.75 });
    store().addGradePoint({ at: { x: -50, y: 400 }, elevation: 0 });
    store().addColumn({ at: { x: 500, y: -20 }, kind: 'post', width: 6, depth: 6, rotation: 0, base: 0, top: 96, phase: 'existing' });
    expect(siteBounds(plan())).toEqual({ minX: -50, minY: -23, maxX: 503, maxY: 400 });
    expect(first).toBeTruthy();
  });

  it('rebuilds the geometry only for grade points, the fallback or the plan bounds (not for walls inside, columns, north)', () => {
    const { first } = house();
    store().addGradePoint({ at: { x: 0, y: 0 }, elevation: -4 });
    const g1 = getTerrainGeometry(plan());
    let disposed = 0;
    g1.addEventListener('dispose', () => disposed++);
    // 2D edits that touch neither: a wall inside the bounds, a column, the north angle.
    store().addWall(first, { x: 100, y: 0 }, { x: 100, y: 100 }, { kind: 'interior', thickness: 4.5, phase: 'existing' });
    store().addColumn({ at: { x: 100, y: 100 }, kind: 'post', width: 6, depth: 6, rotation: 0, base: 0, top: 96, phase: 'existing' });
    store().setNorthAngle(30);
    expect(getTerrainGeometry(plan())).toBe(g1);
    expect(disposed).toBe(0);
    // A grade point does.
    store().addGradePoint({ at: { x: 300, y: 300 }, elevation: -76 });
    const g2 = getTerrainGeometry(plan());
    expect(g2).not.toBe(g1);
    expect(disposed).toBe(1);
    // Growing the plan well past the margin cells does too.
    store().addWall(first, { x: 0, y: 0 }, { x: -600, y: 0 }, { kind: 'exterior', thickness: 6.5, phase: 'existing' });
    expect(getTerrainGeometry(plan())).not.toBe(g2);
  });

  it('plan terrain interpolates the corner grade points of the house', () => {
    house();
    for (const [x, y, e] of [
      [-3.25, -3.25, -4],
      [314.75, -3.25, -4],
      [-3.25, 302.75, -76],
      [314.75, 302.75, -76],
    ]) {
      store().addGradePoint({ at: { x, y }, elevation: e });
    }
    const grid = planTerrain(plan());
    // Nowhere over the house does the ground rise above the first floor slab's underside (-4).
    for (let x = 0; x <= 311.5; x += 31.15) for (let y = 0; y <= 299.5; y += 29.95) {
      expect(terrainHeightAt(plan().site, { x, y }, grid.bounds.minX)).toBeLessThanOrEqual(-4 + 1e-9);
    }
  });
});

describe('sun', () => {
  it('stands south-west in plan terms and turns with the north angle', () => {
    const [x0, y0, z0] = sunPosition(0);
    expect(x0).toBeLessThan(0); // west
    expect(z0).toBeGreaterThan(0); // south (plan y grows down the screen)
    expect(y0).toBe(1600);
    // North turned a quarter clockwise (north is to the right): south is left, west is up.
    const [x1, , z1] = sunPosition(90);
    expect(x1).toBeCloseTo(-z0, 9);
    expect(z1).toBeCloseTo(x0, 9);
    expect(Math.hypot(x1, z1)).toBeCloseTo(Math.hypot(x0, z0), 9);
    // A half turn puts the sun north-east of the plan.
    const [x2, , z2] = sunPosition(180);
    expect(x2).toBeCloseTo(-x0, 9);
    expect(z2).toBeCloseTo(-z0, 9);
  });
});

describe('columns', () => {
  const col = (over: Partial<Column> = {}): Column => ({
    id: 'c1',
    at: { x: 100, y: 50 },
    width: 24,
    depth: 40,
    rotation: 0,
    base: -20,
    top: 260,
    kind: 'chimney',
    phase: 'existing',
    ...over,
  });

  function dims(g: BufferGeometry) {
    g.computeBoundingBox();
    const b = g.boundingBox!;
    return { w: b.max.x - b.min.x, h: b.max.y - b.min.y, d: b.max.z - b.min.z, min: b.min.clone(), max: b.max.clone() };
  }

  function volume(g: BufferGeometry): number {
    const p = g.getAttribute('position');
    let v = 0;
    for (let i = 0; i < p.count; i += 3) {
      const a = [p.getX(i), p.getY(i), p.getZ(i)];
      const b = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)];
      const c = [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)];
      v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    return v;
  }

  it('is a closed box from base to top at the column position', () => {
    const g = buildColumnGeometry(col());
    const d = dims(g);
    expect(d.w).toBeCloseTo(24, 9);
    expect(d.d).toBeCloseTo(40, 9);
    expect(d.h).toBeCloseTo(280, 9);
    expect(d.min.y).toBeCloseTo(-20, 9);
    expect(d.max.y).toBeCloseTo(260, 9);
    expect((d.min.x + d.max.x) / 2).toBeCloseTo(100, 9);
    expect((d.min.z + d.max.z) / 2).toBeCloseTo(50, 9);
    expect(volume(g)).toBeCloseTo(24 * 40 * 280, 4); // positive: faces point out
    // 12 triangles: two per face.
    expect(g.getAttribute('position').count / 3).toBe(12);
  });

  it('turns about its centre', () => {
    const g = buildColumnGeometry(col({ rotation: 90 }));
    const d = dims(g);
    expect(d.w).toBeCloseTo(40, 9);
    expect(d.d).toBeCloseTo(24, 9);
    expect(volume(g)).toBeCloseTo(24 * 40 * 280, 4);
    const diamond = columnOutline(col({ width: 20, depth: 20, rotation: 45, at: { x: 0, y: 0 } }));
    expect(Math.max(...diamond.map((p) => p.x))).toBeCloseTo(Math.hypot(10, 10), 9);
    expect(pointInColumn(col({ rotation: 90 }), { x: 100 + 19, y: 50 + 11 })).toBe(true);
    expect(pointInColumn(col({ rotation: 90 }), { x: 100 + 11, y: 50 + 19 })).toBe(false);
    expect(pointInColumn(col(), { x: 100 + 13, y: 50 }, 2)).toBe(true);
  });

  it('chimney defaults: 24" x 40" from 12" below the ground to 48" above the ridge', () => {
    house();
    store().addGradePoint({ at: { x: 0, y: 0 }, elevation: -4 });
    store().addGradePoint({ at: { x: 311.5, y: 0 }, elevation: -4 });
    expect(highestRidge(plan())).toBeCloseTo(GABLE_RIDGE_ABS + 8, 9); // top of the slab at the ridge
    const d = columnDefaults(plan(), 'chimney', { x: 0, y: 0 });
    expect(d).toMatchObject({ width: 24, depth: 40, rotation: 0, base: -4 - 12 });
    expect(d.top).toBeCloseTo(GABLE_RIDGE_ABS + 8 + 48, 9);
  });

  it('chimney without roofs reaches 48" above the top level ceiling', () => {
    const d = columnDefaults(plan(), 'chimney', { x: 0, y: 0 });
    const top = plan().levelOrder.map((id) => id).pop()!;
    // Empty plan: flat ground at the basement slab bottom (-104); Second Floor ceiling 8 + 96 + 12 + 96 = 212.
    expect(d.base).toBe(-104 - 12);
    expect(d.top).toBe(212 + 48);
    expect(top).toBeTruthy();
  });

  it('post defaults: 6" x 6" from the ground to the lowest roof underside over it, else the first floor ceiling', () => {
    const { first, roof } = house();
    store().addGradePoint({ at: { x: 150, y: 150 }, elevation: -30 });
    const mid = { x: 155, y: 149.75 };
    const d = columnDefaults(plan(), 'post', mid);
    expect(d).toMatchObject({ width: 6, depth: 6, rotation: 0, base: -30 });
    expect(d.top).toBeCloseTo(GABLE_RIDGE_ABS, 9);
    expect(lowestRoofUnderside(plan(), mid)).toBeCloseTo(GABLE_RIDGE_ABS, 9);
    // Outside every roof: the first floor ceiling (8 + 96).
    expect(columnDefaults(plan(), 'post', { x: 900, y: 900 }).top).toBe(104);
    expect(lowestRoofUnderside(plan(), { x: 900, y: 900 })).toBeNull();
    // A demolished flat roof is lower; an existing post goes under it, a new one ignores it.
    store().addRoof(first, { ...roof, shape: 'flat', phase: 'demo' });
    expect(columnDefaults(plan(), 'post', mid, 'existing').top).toBeCloseTo(8 + 96, 9);
    expect(columnDefaults(plan(), 'post', mid, 'new').top).toBeCloseTo(GABLE_RIDGE_ABS, 9);
  });

  it('the default grade point elevation is the first floor top', () => {
    expect(defaultGradeElevation(plan())).toBe(8);
  });

  it('hitSite picks grade points before columns, and skips columns hidden by the view mode', () => {
    const site: Site = {
      northAngle: 0,
      gradePoints: { 'g100,50': gp(100, 50, 0) },
      columns: { a: col({ id: 'a', phase: 'demo' }), b: col({ id: 'b', at: { x: 300, y: 300 }, phase: 'new' }) },
    };
    expect(hitSite(site, { x: 104, y: 50 }, 1)).toEqual({ kind: 'gradePoint', id: 'g100,50' });
    expect(hitSite(site, { x: 100, y: 62 }, 1)).toEqual({ kind: 'column', id: 'a' }); // inside 24 x 40
    expect(hitSite(site, { x: 100, y: 62 }, 1, 'proposed')).toBeNull(); // the demolished chimney is hidden
    expect(hitSite(site, { x: 300, y: 300 }, 1, 'existing')).toBeNull(); // the new one too
    expect(hitSite(site, { x: 300, y: 300 }, 1, 'proposed')).toEqual({ kind: 'column', id: 'b' });
    expect(hitSite(site, { x: 600, y: 600 }, 1)).toBeNull();
  });
});

describe('store actions', () => {
  const column = (over: Partial<Column> = {}) => ({ at: { x: 10, y: 20 }, kind: 'post' as const, width: 6, depth: 6, rotation: 0, base: 0, top: 96, phase: 'existing' as const, ...over });

  it('grade points: add, update, delete, each one undo step', () => {
    const id = store().addGradePoint({ at: { x: 5, y: 6 }, elevation: -12 })!;
    expect(plan().site.gradePoints[id]).toEqual({ id, at: { x: 5, y: 6 }, elevation: -12 });
    store().updateGradePoint(id, { elevation: -30 });
    store().updateGradePoint(id, { at: { x: 50, y: 60 } });
    expect(plan().site.gradePoints[id]).toMatchObject({ at: { x: 50, y: 60 }, elevation: -30 });
    const before = plan();
    store().updateGradePoint(id, { elevation: -30 }); // no change: no new plan, no history entry
    expect(plan()).toBe(before);
    expect(store().addGradePoint({ at: { x: NaN, y: 0 }, elevation: 0 })).toBeNull();
    expect(store().addGradePoint({ at: { x: 0, y: 0 }, elevation: Infinity })).toBeNull();
    store().deleteGradePoints([id]);
    expect(plan().site.gradePoints).toEqual({});
    undo();
    expect(plan().site.gradePoints[id].elevation).toBe(-30);
    undo();
    undo();
    expect(plan().site.gradePoints[id].at).toEqual({ x: 5, y: 6 });
    undo();
    expect(plan().site.gradePoints).toEqual({});
    redo();
    expect(Object.keys(plan().site.gradePoints)).toEqual([id]);
  });

  it('columns: add with validation, update, delete, undo', () => {
    const id = store().addColumn(column({ rotation: 450 }))!;
    expect(plan().site.columns[id].rotation).toBe(90);
    expect(store().addColumn(column({ width: 0 }))).toBeNull();
    expect(store().addColumn(column({ depth: -1 }))).toBeNull();
    expect(store().addColumn(column({ top: 0, base: 0 }))).toBeNull();
    expect(store().addColumn(column({ base: 10, top: 5 }))).toBeNull();
    expect(Object.keys(plan().site.columns)).toEqual([id]);
    store().updateColumn(id, { top: 120, kind: 'chimney' });
    expect(plan().site.columns[id]).toMatchObject({ top: 120, kind: 'chimney' });
    const before = plan();
    store().updateColumn(id, { top: -5 }); // below the base: rejected
    store().updateColumn(id, { width: 0 });
    store().updateColumn(id, { top: 120 }); // unchanged
    expect(plan()).toBe(before);
    store().updateColumn(id, { rotation: -90 });
    expect(plan().site.columns[id].rotation).toBe(270);
    store().deleteColumns([id]);
    expect(plan().site.columns).toEqual({});
    undo();
    expect(plan().site.columns[id].rotation).toBe(270);
    undo();
    undo();
    expect(plan().site.columns[id]).toMatchObject({ top: 96, kind: 'post' });
  });

  it('setNorthAngle normalizes and is undoable; moveSiteItems is one step', () => {
    store().setNorthAngle(-30);
    expect(plan().site.northAngle).toBe(330);
    store().setNorthAngle(NaN);
    expect(plan().site.northAngle).toBe(330);
    undo();
    expect(plan().site.northAngle).toBe(0);
    const g = store().addGradePoint({ at: { x: 0, y: 0 }, elevation: 0 })!;
    const c = store().addColumn(column())!;
    clearHistory();
    store().moveSiteItems({ [g]: { x: 10, y: 10 } }, { [c]: { x: 30, y: 40 } });
    expect(plan().site.gradePoints[g].at).toEqual({ x: 10, y: 10 });
    expect(plan().site.columns[c].at).toEqual({ x: 30, y: 40 });
    undo();
    expect(plan().site.gradePoints[g].at).toEqual({ x: 0, y: 0 });
    expect(plan().site.columns[c].at).toEqual({ x: 10, y: 20 });
  });

  it('setPhase covers columns; deleteEntities removes site items in one step; clearGradePoints', () => {
    const { first } = house();
    const c1 = store().addColumn(column())!;
    const c2 = store().addColumn(column({ at: { x: 40, y: 20 } }))!;
    const g1 = store().addGradePoint({ at: { x: 0, y: 0 }, elevation: 0 })!;
    store().addGradePoint({ at: { x: 9, y: 9 }, elevation: 3 });
    clearHistory();
    store().setPhase(first, { walls: [], openings: [], columns: [c1] }, 'demo');
    expect(plan().site.columns[c1].phase).toBe('demo');
    expect(plan().site.columns[c2].phase).toBe('existing');
    undo();
    expect(plan().site.columns[c1].phase).toBe('existing');
    clearHistory();
    store().deleteEntities(first, { nodes: [], walls: [], columns: [c1, c2], gradePoints: [g1] });
    expect(plan().site.columns).toEqual({});
    expect(Object.keys(plan().site.gradePoints)).toHaveLength(1);
    undo();
    expect(Object.keys(plan().site.columns)).toHaveLength(2);
    expect(Object.keys(plan().site.gradePoints)).toHaveLength(2);
    store().clearGradePoints();
    expect(plan().site.gradePoints).toEqual({});
    const before = plan();
    store().clearGradePoints();
    expect(plan()).toBe(before);
  });

  it('a plan with a site survives migrate() byte for byte', () => {
    house();
    store().addGradePoint({ at: { x: 1, y: 2 }, elevation: -4 });
    store().addColumn(column({ kind: 'chimney', width: 24, depth: 40 }));
    store().setNorthAngle(15);
    const json = JSON.stringify(plan());
    expect(JSON.stringify(migrate(JSON.parse(json)))).toBe(json);
  });
});

describe('view mode applies to roofs and columns', () => {
  it('getLevelMeshes drops roofs hidden in the view mode', () => {
    const { first, roofId, roof } = house();
    const shed = store().addRoof(first, { ...roof, shape: 'shed', phase: 'new', outline: rect(0, 300, 100, 400) })!;
    store().updateRoof(first, roofId, { phase: 'demo' });
    const ids = (vm: 'existing' | 'proposed' | 'all') => getLevelMeshes(plan(), first, vm).roofs.map((r) => r.id).sort();
    expect(ids('existing')).toEqual([roofId]);
    expect(ids('proposed')).toEqual([shed]);
    expect(ids('all')).toEqual([roofId, shed].sort());
  });

  it('getSiteMeshes shows the columns the view mode shows, and keeps geometry while a column is unchanged', () => {
    const base = { kind: 'post' as const, width: 6, depth: 6, rotation: 0, base: 0, top: 96 };
    const old = store().addColumn({ ...base, at: { x: 0, y: 0 }, phase: 'demo' })!;
    const keep = store().addColumn({ ...base, at: { x: 50, y: 0 }, phase: 'existing' })!;
    const fresh = store().addColumn({ ...base, at: { x: 100, y: 0 }, phase: 'new', kind: 'chimney' })!;
    const ids = (vm: 'existing' | 'proposed' | 'all') => getSiteMeshes(plan(), vm).columns.map((c) => c.id).sort();
    expect(ids('existing')).toEqual([old, keep].sort());
    expect(ids('proposed')).toEqual([keep, fresh].sort());
    expect(ids('all')).toHaveLength(3);
    const all1 = getSiteMeshes(plan(), 'all');
    expect(getSiteMeshes(plan(), 'all')).toBe(all1);
    const g = all1.columns.find((c) => c.id === keep)!.geometry;
    let disposed = 0;
    const gOld = all1.columns.find((c) => c.id === old)!.geometry;
    gOld.addEventListener('dispose', () => disposed++);
    store().updateColumn(old, { top: 120 });
    const all2 = getSiteMeshes(plan(), 'all');
    expect(all2.columns.find((c) => c.id === keep)!.geometry).toBe(g); // untouched columns keep their geometry
    expect(all2.columns.find((c) => c.id === old)!.geometry).not.toBe(gOld);
    expect(disposed).toBe(1);
    store().deleteColumns([fresh]);
    expect(getSiteMeshes(plan(), 'all').columns).toHaveLength(2);
  });

  it('Fit 3D bounds include the columns and the ground over the house, not the margin', () => {
    house();
    const flat = planBox(plan());
    store().addColumn({ at: { x: 400, y: -60 }, kind: 'chimney', width: 24, depth: 40, rotation: 0, base: -300, top: 500, phase: 'existing' });
    const withColumn = planBox(plan());
    expect(withColumn.max[0]).toBeCloseTo(412, 6);
    expect(withColumn.min[2]).toBeCloseTo(-80, 6);
    expect(withColumn.min[1]).toBe(-300);
    expect(withColumn.max[1]).toBe(500);
    expect(withColumn.min[0]).toBe(flat.min[0]);
    // Grade points lower the ground over the house area: the box reaches it, nothing like the margin.
    store().deleteColumns(Object.keys(plan().site.columns));
    store().addGradePoint({ at: { x: 0, y: 0 }, elevation: -200 });
    const lowered = planBox(plan());
    expect(lowered.min[1]).toBeLessThan(flat.min[1]);
    expect(lowered.min[0]).toBe(flat.min[0]);
    expect(lowered.max[2]).toBe(flat.max[2]);
  });

  it('site mode shows every level in 3D even with "only active and below"', () => {
    const order = plan().levelOrder;
    const base = { hidden3dLevels: [], only3dActiveAndBelow: true, activeLevelId: order[0] };
    expect(visible3dLevels(order, base)).toEqual([order[0]]);
    expect(visible3dLevels(order, { ...base, siteMode: true })).toEqual(order);
  });
});

describe('export', () => {
  const vis = (activeLevelId: string): ExportLevelVisibility => ({ hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId });
  const names = (g: { children: { name: string }[] }) => g.children.map((c) => c.name);

  it('exports a Site group with Terrain, Chimney and Post meshes and named materials', () => {
    const { first } = house();
    store().addGradePoint({ at: { x: 0, y: 0 }, elevation: -4 });
    store().addColumn({ at: { x: 10, y: 10 }, kind: 'chimney', width: 24, depth: 40, rotation: 0, base: -16, top: 262, phase: 'existing' });
    store().addColumn({ at: { x: 200, y: 400 }, kind: 'post', width: 6, depth: 6, rotation: 0, base: -4, top: 100, phase: 'demo' });
    const root = buildExportScene(plan(), 'all', vis(first));
    const site = root.children.find((c) => c.name === 'Site')!;
    expect(site).toBeDefined();
    expect(site.position.y).toBe(0);
    expect(names(site).sort()).toEqual(['Chimney', 'Post', 'Terrain']);
    const mat = (n: string) => ((site.children.find((c) => c.name === n) as Mesh).material as MeshStandardMaterial).name;
    expect(mat('Terrain')).toBe('terrain');
    expect(mat('Chimney')).toBe('column_chimney_existing');
    expect(mat('Post')).toBe('column_post_demo');
    // Levels first, Site last.
    expect(names(root)[names(root).length - 1]).toBe('Site');
    disposeExportScene(root);
  });

  it('follows the view mode: the Proposed export has no demolished post, the Existing one no new column', () => {
    const { first } = house();
    store().addColumn({ at: { x: 10, y: 10 }, kind: 'post', width: 6, depth: 6, rotation: 0, base: 0, top: 96, phase: 'demo' });
    store().addColumn({ at: { x: 50, y: 10 }, kind: 'post', width: 6, depth: 6, rotation: 0, base: 0, top: 96, phase: 'new' });
    const count = (vm: 'existing' | 'proposed' | 'all') => {
      const root = buildExportScene(plan(), vm, vis(first));
      const n = root.children.find((c) => c.name === 'Site')?.children.filter((c) => c.name === 'Post').length ?? 0;
      disposeExportScene(root);
      return n;
    };
    expect(count('existing')).toBe(1);
    expect(count('proposed')).toBe(1);
    expect(count('all')).toBe(2);
  });

  it('has no Site group and no Terrain for a plan with an empty site', () => {
    const { first } = house();
    const root = buildExportScene(plan(), 'all', vis(first));
    expect(names(root)).not.toContain('Site');
    disposeExportScene(root);
    store().addColumn({ at: { x: 10, y: 10 }, kind: 'post', width: 6, depth: 6, rotation: 0, base: 0, top: 96, phase: 'existing' });
    const withColumn = buildExportScene(plan(), 'all', vis(first));
    expect(names(withColumn.children.find((c) => c.name === 'Site')!)).toEqual(['Post']); // flat ground is not exported
    disposeExportScene(withColumn);
  });
});

describe('site mode and the site tools', () => {
  const ptr = (x: number, y: number, over: Partial<ToolPointerEvent> = {}): ToolPointerEvent => ({
    world: { x, y },
    screen: { x, y },
    button: 0,
    shiftKey: false,
    altKey: false,
    modKey: false,
    ...over,
  });
  const press = (key: string) => dispatchKey({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent);
  const type = (text: string) => {
    for (const ch of text) press(ch);
  };

  it('the Site tab opens site mode on the lowest level; any level leaves it', () => {
    const [lowest, , top] = plan().levelOrder;
    ui().setActiveLevel(top);
    enterSiteMode();
    expect(ui().siteMode).toBe(true);
    expect(ui().activeLevelId).toBe(lowest);
    expect(selectionSize(ui().selection)).toBe(0);
    switchLevel(lowest); // the lowest level's own tab leaves it too
    expect(ui().siteMode).toBe(false);
    expect(ui().activeLevelId).toBe(lowest);
    enterSiteMode();
    switchLevel(top);
    expect(ui().siteMode).toBe(false);
    expect(ui().activeLevelId).toBe(top);
  });

  it('E and C are keyboard bindings that only act in site mode', () => {
    const key = (k: string) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }) as KeyboardEvent;
    const e = bindingFor(key('e'));
    const c = bindingFor(key('c'));
    expect(e?.group).toBe('Tools');
    expect(c?.group).toBe('Tools');
    expect(e!.run!(key('e'))).toBe(false); // outside site mode the key does nothing (the browser keeps it)
    expect(ui().activeTool).toBe('select');
    enterSiteMode();
    e!.run!(key('e'));
    expect(ui().activeTool).toBe('gradePoint');
    c!.run!(key('c'));
    expect(ui().activeTool).toBe('column');
    bindingFor(key('w'))!.run!(key('w'));
    expect(ui().activeTool).toBe('column'); // refused: the hint is in the status bar
    expect(ui().draft.message).toBe('Choose a level to draw walls');
  });

  it('level tools are off in site mode with a status hint; site tools are off outside it', () => {
    enterSiteMode();
    for (const t of ['wall', 'room', 'door', 'window', 'passage', 'stairs', 'roof', 'underlay'] as const) {
      ui().patchDraft({ message: null });
      switchTool(t);
      expect(ui().activeTool).toBe('select');
      expect(ui().draft.message).toBe('Choose a level to draw walls');
    }
    switchTool('gradePoint');
    expect(ui().activeTool).toBe('gradePoint');
    switchTool('column');
    expect(ui().activeTool).toBe('column');
    switchLevel(plan().levelOrder[1]);
    expect(ui().activeTool).toBe('select'); // the site tool does not follow us out
    switchTool('gradePoint');
    expect(ui().activeTool).toBe('select');
    switchTool('wall');
    expect(ui().activeTool).toBe('wall');
  });

  it('grade point tool: click, type a signed elevation, Enter; Enter alone uses the first floor top', () => {
    enterSiteMode();
    switchTool('gradePoint');
    dispatchPointer('down', ptr(120, 80));
    expect(ui().draft.gradePending).toEqual({ x: 120, y: 80 });
    type("-6'4");
    expect(ui().draft.lengthBuffer).toBe("-6'4");
    press('Enter');
    const pts = Object.values(plan().site.gradePoints);
    expect(pts).toHaveLength(1);
    expect(pts[0].elevation).toBe(-76);
    expect(pts[0].at).toEqual({ x: 120, y: 80 });
    expect(ui().selection.gradePoints).toEqual([pts[0].id]);
    expect(ui().draft.gradePending).toBeNull();
    dispatchPointer('down', ptr(300, 80));
    press('Enter');
    expect(Object.values(plan().site.gradePoints).map((g) => g.elevation).sort((a, b) => a - b)).toEqual([-76, 8]);
    // A typo keeps the buffer and the spot; Esc clears it, then the spot.
    dispatchPointer('down', ptr(50, 50));
    type('1x');
    press('Enter');
    expect(ui().draft.error).toBe(true);
    expect(Object.keys(plan().site.gradePoints)).toHaveLength(2);
    press('Escape');
    expect(ui().draft.lengthBuffer).toBe('');
    expect(ui().draft.gradePending).not.toBeNull();
    press('Escape');
    expect(ui().draft.gradePending).toBeNull();
    undo();
    expect(Object.keys(plan().site.gradePoints)).toHaveLength(1);
  });

  it('column tool: a chimney by default, Tab switches to a post before the click; the Draw as phase applies', () => {
    house();
    store().addGradePoint({ at: { x: 100, y: 100 }, elevation: -30 });
    ui().setActiveLevel(defaultLevelId(plan()));
    enterSiteMode();
    switchTool('column');
    dispatchPointer('move', ptr(100, 100));
    expect(ui().draft.columnPreview).toMatchObject({ kind: 'chimney', width: 24, depth: 40 });
    dispatchPointer('down', ptr(100, 100));
    let cols = Object.values(plan().site.columns);
    expect(cols).toHaveLength(1);
    expect(cols[0]).toMatchObject({ kind: 'chimney', width: 24, depth: 40, phase: 'existing' });
    expect(cols[0].base).toBeCloseTo(-30 - 12, 9);
    expect(cols[0].top).toBeCloseTo(GABLE_RIDGE_ABS + 8 + 48, 9);
    expect(ui().selection.columns).toEqual([cols[0].id]);
    press('Tab');
    expect(ui().draft.columnKind).toBe('post');
    ui().setDrawPhase('new');
    dispatchPointer('down', ptr(200, 100));
    cols = Object.values(plan().site.columns);
    const post = cols.find((c) => c.kind === 'post')!;
    expect(post).toMatchObject({ width: 6, depth: 6, phase: 'new' });
    expect(post.top).toBeGreaterThan(post.base);
  });

  it('select tool in site mode picks, drags (one undo step) and deletes grade points and columns', () => {
    const g = store().addGradePoint({ at: { x: 100, y: 100 }, elevation: 0 })!;
    const c = store().addColumn({ at: { x: 300, y: 100 }, kind: 'post', width: 20, depth: 20, rotation: 0, base: 0, top: 96, phase: 'existing' })!;
    clearHistory();
    enterSiteMode();
    dispatchPointer('down', ptr(102, 101));
    dispatchPointer('up', ptr(102, 101));
    expect(ui().selection.gradePoints).toEqual([g]);
    // Drag the grade point.
    dispatchPointer('down', ptr(100, 100));
    for (const x of [110, 130, 150, 160]) dispatchPointer('move', ptr(x, 100));
    dispatchPointer('up', ptr(160, 100));
    expect(plan().site.gradePoints[g].at).toEqual({ x: 160, y: 100 });
    undo();
    expect(plan().site.gradePoints[g].at).toEqual({ x: 100, y: 100 });
    // Shift-click adds the column; Delete removes both in one step.
    dispatchPointer('down', ptr(300, 100, { shiftKey: true }));
    dispatchPointer('up', ptr(300, 100, { shiftKey: true }));
    expect(ui().selection).toMatchObject({ gradePoints: [g], columns: [c] });
    press('Delete');
    expect(plan().site.gradePoints).toEqual({});
    expect(plan().site.columns).toEqual({});
    expect(selectionSize(ui().selection)).toBe(0);
    undo();
    expect(Object.keys(plan().site.columns)).toEqual([c]);
    expect(Object.keys(plan().site.gradePoints)).toEqual([g]);
    // A box around the column selects it.
    ui().setSelection(EMPTY_SELECTION);
    dispatchPointer('down', ptr(250, 50));
    dispatchPointer('move', ptr(350, 150));
    dispatchPointer('up', ptr(350, 150));
    expect(ui().selection).toMatchObject({ gradePoints: [], columns: [c] });
  });

  it('a column hidden by the view mode drops out of the selection', () => {
    const c = store().addColumn({ at: { x: 300, y: 100 }, kind: 'post', width: 20, depth: 20, rotation: 0, base: 0, top: 96, phase: 'new' })!;
    enterSiteMode();
    ui().setSelection({ ...EMPTY_SELECTION, columns: [c] });
    setViewMode('existing');
    expect(ui().selection.columns).toEqual([]);
  });
});
