import { Mesh, type BufferGeometry, type MeshStandardMaterial } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildColumnGeometry,
  buildColumnParts,
  buildFarGroundGeometry,
  buildTerrainGeometry,
  clearMeshCache,
  FAR_GROUND_HALF,
  getFarGroundGeometry,
  getLevelMeshes,
  getSiteMeshes,
  getTerrainGeometry,
  triangleCount,
} from '../derive/meshes';
import {
  CHIMNEY_CAP,
  chimneyPartBoxes,
  columnDefaults,
  columnOutline,
  columnPeak,
  FLUE_CAP,
  FLUE_SIDES,
  hasChimneyCap,
  hasFlueCap,
  defaultGradeElevation,
  fallbackElevation,
  highestRidge,
  lowestRoofUnderside,
  planTerrain,
  pointInColumn,
  siteBounds,
  sunPosition,
  terrainBounds,
  terrainCut,
  terrainFor,
  terrainGrid,
  terrainHeightAt,
  delaunay,
  TERRAIN_MARGIN,
  TERRAIN_MAX_CELLS,
  TERRAIN_STEP,
  TERRAIN_UNDER_SLAB,
  type TerrainGrid,
} from '../derive/site';
import { getFaces, slabOutlines } from '../derive/rooms';
import example from '../../docs/examples/146-mick-road.json';
import { dispatchKey, dispatchPointer, enterSiteMode, setViewMode, switchLevel, switchTool, type ToolPointerEvent } from '../editor2d/tools';
import { COLUMN_KIND_NAME, hitSite, nextColumnKind } from '../editor2d/tools/siteTools';
import { buildExportScene, disposeExportScene, type ExportLevelVisibility } from '../io/export3d';
import { CHIMNEY_CAP_COLOR, COLUMN_COLOR } from '../model/finish';
import { createEmptyPlan, defaultLevelId, defaultSite, migrate } from '../model/plan';
import type { Column, Plan, Roof, Site, Vec2 } from '../model/types';
import { clearHistory, redo, undo, usePlanStore } from '../store/planStore';
import { EMPTY_SELECTION, selectionSize, useUiStore } from '../store/uiStore';
import { bindingFor } from '../ui/keymap';
import { planBox } from '../view3d/bounds';
import { chimneyPartMaterial, columnMaterial, openingMaterial } from '../view3d/materials';
import { BRICK_COURSE, BRICK_LENGTH, brickFaces, brickHeight, brickTextures, MORTAR_JOINT, PX_PER_INCH, RELIEF, TEXTURE_PX } from '../view3d/textures';
import { active3dLevel, visible3dLevels } from '../view3d/visibility';

const store = () => usePlanStore.getState();
const plan = (): Plan => store().plan;
const ui = () => useUiStore.getState();

const gp = (x: number, y: number, elevation: number) => ({ id: `g${x},${y}`, at: { x, y }, elevation });
const siteWith = (...points: ReturnType<typeof gp>[]): Site => ({
  northAngle: 0,
  gradePoints: Object.fromEntries(points.map((p) => [p.id, p])),
  columns: {},
  surfaces: {},
  fences: {},
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

  it('is linear over the Delaunay triangles of three or more points, and level beyond their hull', () => {
    const site = siteWith(gp(0, 0, 0), gp(100, 0, 100), gp(0, 100, 0), gp(100, 100, 100));
    // A plane through the four points: the height is x.
    for (const [x, y] of [[50, 50], [10, 90], [75, 20], [99, 1]]) expect(terrainHeightAt(site, { x, y }, 0)).toBeCloseTo(x, 9);
    // Beyond the hull: the height of the nearest point of its edge.
    expect(terrainHeightAt(site, { x: 50, y: -400 }, 0)).toBeCloseTo(50, 9);
    expect(terrainHeightAt(site, { x: 900, y: 50 }, 0)).toBeCloseTo(100, 9);
    expect(terrainHeightAt(site, { x: -900, y: 900 }, 0)).toBeCloseTo(0, 9);
  });

  it('is level between points at one height, however low the points around them', () => {
    // A terrace at -6 with a lawn at -100 just past it: the terrace stays at -6 all over.
    const site = siteWith(gp(0, 0, -6), gp(200, 0, -6), gp(200, 100, -6), gp(0, 100, -6), gp(0, 116, -100), gp(200, 116, -100), gp(100, 300, -100));
    for (let x = 0; x <= 200; x += 20) for (let y = 0; y <= 100; y += 20) expect(terrainHeightAt(site, { x, y }, 0)).toBeCloseTo(-6, 9);
    // Never outside the range of the points' elevations.
    for (let x = -300; x <= 500; x += 37) for (let y = -300; y <= 600; y += 41) {
      const h = terrainHeightAt(site, { x, y }, 0);
      expect(h).toBeGreaterThanOrEqual(-100 - 1e-9);
      expect(h).toBeLessThanOrEqual(-6 + 1e-9);
    }
  });

  it('delaunay triangulates the points once each, skipping one within 1" of another', () => {
    const t = delaunay([gp(0, 0, 0), gp(100, 0, 0), gp(0, 100, 0), gp(100, 100, 0), gp(50, 40, 3), gp(50.5, 40.5, 9)].map((g) => g));
    expect(t.pts.length).toBe(5);
    // Four triangles round the inner point, all counter-clockwise; the hull is the square's four sides.
    expect(t.tris.length).toBe(4);
    for (const [a, b, c] of t.tris) expect((t.pts[b].x - t.pts[a].x) * (t.pts[c].y - t.pts[a].y) - (t.pts[c].x - t.pts[a].x) * (t.pts[b].y - t.pts[a].y)).toBeGreaterThan(0);
    expect(t.hull.length).toBe(4);
  });

  it('with points in a line, weights by inverse square distance', () => {
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

  it('is a 24" grid over the bounds plus 100 feet, rounded out to whole cells', () => {
    const g = terrainGrid(defaultSite(), bounds, -104);
    expect(g.step).toBe(TERRAIN_STEP);
    expect(g.bounds).toEqual(terrainBounds(bounds));
    expect(g.bounds).toEqual({ minX: -1200, minY: -1200, maxX: 1536, maxY: 1512 });
    expect(g.cellsX).toBe(114);
    expect(g.cellsY).toBe(113);
    expect(g.positions.length).toBe(115 * 114 * 3);
    expect(g.indices.length).toBe(114 * 113 * 6);
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
    // The grid's own vertices (the skirt's follow them) have upward normals.
    const geometry = buildTerrainGeometry(g);
    const n = geometry.getAttribute('normal');
    for (let i = 0; i < g.positions.length / 3; i++) expect(n.getY(i)).toBeGreaterThan(0.9);
    geometry.dispose();
  });

  it('hangs a skirt from the boundary to the lowest edge vertex minus 12", facing out, with its own vertices', () => {
    const site = siteWith(gp(0, 0, -4), gp(300, 0, -4), gp(0, 300, -76), gp(300, 300, -76));
    const g = terrainGrid(site, bounds, -104);
    const nx = g.cellsX + 1;
    const ny = g.cellsY + 1;
    let low = Infinity;
    for (let v = 0; v < nx * ny; v++) {
      if (v % nx === 0 || v % nx === nx - 1 || v < nx || v >= nx * (ny - 1)) low = Math.min(low, g.positions[v * 3 + 1]);
    }
    expect(g.skirtElevation).toBeCloseTo(low - 12, 4);

    const geometry = buildTerrainGeometry(g);
    const pos = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const normal = geometry.getAttribute('normal');
    const index = geometry.getIndex()!;
    const gridCount = g.positions.length / 3;
    // Each side: a copy of its boundary vertices and a bottom row (the corners twice, one per side).
    const ring = 2 * nx + 2 * ny;
    expect(pos.count).toBe(gridCount + 2 * ring);
    expect(index.count).toBe(g.indices.length + 4 * (g.cellsX + g.cellsY) * 3);
    // The grid is unchanged and its UVs are plan inches.
    for (let v = 0; v < gridCount; v += 97) {
      expect(pos.getY(v)).toBe(g.positions[v * 3 + 1]);
      expect(uv.getX(v)).toBe(g.positions[v * 3]);
      expect(uv.getY(v)).toBe(g.positions[v * 3 + 2]);
    }
    // Skirt vertices: on the boundary, either a copy of a boundary vertex or at the skirt elevation.
    const { minX, minY, maxX, maxY } = g.bounds;
    let bottoms = 0;
    for (let v = gridCount; v < pos.count; v++) {
      const x = pos.getX(v);
      const z = pos.getZ(v);
      expect([minX, maxX].includes(x) || [minY, maxY].includes(z)).toBe(true);
      const y = pos.getY(v);
      if (Math.abs(y - g.skirtElevation) < 1e-3) bottoms++;
      else expect(y).toBeCloseTo(terrainHeightAt(site, { x, y: z }, -104), 3);
      // Flat normals, out of the side the vertex is on (a corner is on two; each copy has one).
      expect(normal.getY(v)).toBeCloseTo(0, 6);
      const outs = [
        [x === minX, -1, 0],
        [x === maxX, 1, 0],
        [z === minY, 0, -1],
        [z === maxY, 0, 1],
      ] as const;
      const facing = Math.max(...outs.filter(([on]) => on).map(([, ox, oz]) => normal.getX(v) * ox + normal.getZ(v) * oz));
      expect(facing).toBeGreaterThan(0.99);
    }
    expect(bottoms).toBe(ring);
    // Every skirt triangle faces away from the grid's centre.
    const cx = (minX + maxX) / 2;
    const cz = (minY + maxY) / 2;
    for (let t = g.indices.length; t < index.count; t += 3) {
      const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)].map((k) => [pos.getX(k), pos.getY(k), pos.getZ(k)]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      expect(n[0] * (a[0] - cx) + n[2] * (a[2] - cz)).toBeGreaterThan(0);
    }
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

describe('far ground', () => {
  it('is a collar from the terrain edge, at its heights and normals, to a 24000" square at the skirt elevation, facing up', () => {
    const site = siteWith(gp(0, 0, -4), gp(300, 300, -76));
    const g = terrainGrid(site, { minX: 0, minY: 0, maxX: 318, maxY: 306 }, -104);
    const terrain = buildTerrainGeometry(g);
    const terrainNormals = terrain.getAttribute('normal');
    const geometry = buildFarGroundGeometry(g, terrainNormals.array);
    const pos = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const index = geometry.getIndex()!;
    const { minX, minY, maxX, maxY } = g.bounds;
    const cx = (minX + maxX) / 2;
    const cz = (minY + maxY) / 2;
    expect(FAR_GROUND_HALF).toBe(12000);
    let area = 0;
    for (let t = 0; t < index.count; t += 3) {
      const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)].map((k) => [pos.getX(k), pos.getY(k), pos.getZ(k)]);
      // Facing up: the Y component of (b - a) x (c - a).
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      expect(ny).toBeGreaterThan(0);
      area += ny / 2;
      // No triangle reaches into the terrain's area (the house is cut out of the ground there).
      const mx = (a[0] + b[0] + c[0]) / 3;
      const mz = (a[2] + b[2] + c[2]) / 3;
      expect(mx > minX && mx < maxX && mz > minY && mz < maxY).toBe(false);
    }
    // The square minus the terrain's rectangle, covered once.
    expect(area).toBeCloseTo(24000 * 24000 - (maxX - minX) * (maxY - minY), -1);
    let inner = 0;
    let outer = 0;
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v);
      const z = pos.getZ(v);
      expect(uv.getX(v)).toBe(x);
      expect(uv.getY(v)).toBe(z);
      if (Math.abs(Math.abs(x - cx) - 12000) < 1e-6 || Math.abs(Math.abs(z - cz) - 12000) < 1e-6) {
        // On the square: at the skirt elevation, normal up.
        outer++;
        expect(pos.getY(v)).toBeCloseTo(g.skirtElevation, 4);
        expect(normal.getY(v)).toBe(1);
      } else {
        // On the terrain's boundary: the terrain vertex there, with its normal.
        inner++;
        expect([minX, maxX].includes(x) || [minY, maxY].includes(z)).toBe(true);
        const i = Math.round((x - minX) / g.step);
        const j = Math.round((z - minY) / g.step);
        const k = j * (g.cellsX + 1) + i;
        expect(pos.getY(v)).toBe(g.positions[k * 3 + 1]);
        expect(normal.getY(v)).toBe(terrainNormals.getY(k));
        expect(normal.getX(v)).toBe(terrainNormals.getX(k));
      }
    }
    expect(inner).toBe(2 * (g.cellsX + 1) + 2 * (g.cellsY + 1));
    expect(outer).toBe(inner);
    terrain.dispose();
    geometry.dispose();
  });

  it('keeps its geometry while the terrain geometry stays', () => {
    house();
    store().addGradePoint({ at: { x: 0, y: 0 }, elevation: -4 });
    const f1 = getFarGroundGeometry(plan());
    let disposed = 0;
    f1.addEventListener('dispose', () => disposed++);
    store().addColumn({ at: { x: 100, y: 100 }, kind: 'post', width: 6, depth: 6, rotation: 0, base: 0, top: 96, phase: 'existing' });
    expect(getFarGroundGeometry(plan())).toBe(f1);
    // A second grade point lowers the far edge: a new frame, the old one disposed.
    store().addGradePoint({ at: { x: 300, y: 300 }, elevation: -76 });
    expect(getFarGroundGeometry(plan())).not.toBe(f1);
    expect(disposed).toBe(1);
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
      surfaces: {},
      fences: {},
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

  it('in site mode "only active and below" counts from the first floor, the level the site view shows (REVIEW-2 A4)', () => {
    const order = plan().levelOrder;
    const base = { hidden3dLevels: [], only3dActiveAndBelow: true, activeLevelId: order[0] };
    expect(visible3dLevels(order, base)).toEqual([order[0]]);
    expect(visible3dLevels(order, { ...base, siteMode: true })).toEqual([order[0], order[1]]);
    expect(active3dLevel(order, { activeLevelId: order[0], siteMode: true })).toBe(order[1]);
    expect(active3dLevel(order, { activeLevelId: order[0], siteMode: false })).toBe(order[0]);
    // Without the option every checked level shows; a single-level plan uses that level.
    expect(visible3dLevels(order, { ...base, only3dActiveAndBelow: false, siteMode: true })).toEqual(order);
    expect(active3dLevel([order[0]], { activeLevelId: order[0], siteMode: true })).toBe(order[0]);
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

describe('chimney colour, cap and spark arrestor (realism batch D)', () => {
  const chimney = (over: Partial<Column> = {}): Column => ({
    id: 'c1',
    at: { x: 159, y: -10 },
    width: 24,
    depth: 20,
    rotation: 0,
    base: -16,
    top: 335,
    kind: 'chimney',
    phase: 'existing',
    ...over,
  });
  function box(g: BufferGeometry) {
    g.computeBoundingBox();
    const b = g.boundingBox!;
    return { min: b.min.toArray(), max: b.max.toArray() };
  }
  const expectBox = (g: BufferGeometry, min: number[], max: number[]) => {
    const b = box(g);
    b.min.forEach((v, i) => expect(v, `min ${i}`).toBeCloseTo(min[i], 9));
    b.max.forEach((v, i) => expect(v, `max ${i}`).toBeCloseTo(max[i], 9));
  };
  /** The triangles of a non-indexed geometry with their flat normals and UVs. */
  function triangles(g: BufferGeometry) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    const out: { p: number[][]; n: number[]; uv: number[][] }[] = [];
    for (let i = 0; i < p.count; i += 3) {
      const idx = [i, i + 1, i + 2];
      out.push({ p: idx.map((k) => [p.getX(k), p.getY(k), p.getZ(k)]), n: [n.getX(i), n.getY(i), n.getZ(i)], uv: idx.map((k) => [uv.getX(k), uv.getY(k)]) });
    }
    return out;
  }
  /** Signed volume: positive when every face points out of the solid. */
  const volume = (g: BufferGeometry) =>
    triangles(g).reduce((v, { p: [a, b, c] }) => v + (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6, 0);

  it('without a cap: no parts and the full shaft; a post ignores the cap', () => {
    for (const c of [chimney(), chimney({ cap: false }), chimney({ kind: 'post', cap: true })]) {
      expect(buildColumnParts(c)).toEqual([]);
      expect(chimneyPartBoxes(c)).toEqual([]);
      expectBox(buildColumnGeometry(c), [147, -16, -20], [171, 335, 0]);
      expect(columnPeak(c)).toBe(335);
    }
    expect(hasChimneyCap(chimney({ cap: true }))).toBe(true);
    expect(hasChimneyCap({ kind: 'post', cap: true })).toBe(false);
  });

  it('with a cap: the shaft stops under a 4" concrete cap 2" proud all round; a 12" wire box 1" in stands on it', () => {
    const c = chimney({ cap: true });
    expect(CHIMNEY_CAP).toEqual({ thickness: 4, proud: 2, arrestor: 12, inset: 1 });
    expect(columnPeak(c)).toBe(347);
    const shaft = buildColumnGeometry(c);
    expectBox(shaft, [147, -16, -20], [171, 331, 0]);
    expect(volume(shaft)).toBeCloseTo(24 * 20 * 347, 3);
    const parts = buildColumnParts(c);
    expect(parts.map((p) => p.part)).toEqual(['cap', 'arrestor']);
    const [cap, arrestor] = parts.map((p) => p.geometry);
    // The cap: a closed box, every face pointing out.
    expectBox(cap, [145, 331, -22], [173, 335, 2]);
    expect(triangleCount(cap)).toBe(12);
    expect(volume(cap)).toBeCloseTo(28 * 24 * 4, 6);
    // The arrestor: open at the bottom (it stands over the flue), its faces pointing out.
    expectBox(arrestor, [148, 335, -19], [170, 347, -1]);
    expect(triangleCount(arrestor)).toBe(10);
    for (const t of triangles(arrestor)) {
      const centre = [0, 1, 2].map((k) => (t.p[0][k] + t.p[1][k] + t.p[2][k]) / 3);
      const out = [centre[0] - 159, centre[1] - 341, centre[2] + 10];
      expect(t.n[0] * out[0] + t.n[1] * out[1] + t.n[2] * out[2]).toBeGreaterThan(0);
      expect(t.n[1]).toBeGreaterThan(-0.5); // no bottom face
    }
    // No two faces lie on each other facing the same way (z-fighting): the shaft's top meets the
    // cap's bottom and the cap's top the arrestor's open bottom.
    const ups = (g: BufferGeometry, y: number) => triangles(g).filter((t) => t.n[1] > 0.5 && t.p.every((q) => Math.abs(q[1] - y) < 1e-6)).length;
    expect(ups(shaft, 331)).toBe(2);
    expect(ups(cap, 331)).toBe(0);
    expect(ups(cap, 335)).toBe(2);
    expect(ups(arrestor, 335)).toBe(0);
    // A chimney shorter than its cap is all cap.
    expectBox(buildColumnParts(chimney({ cap: true, base: 333 }))[0].geometry, [145, 333, -22], [173, 335, 2]);
    expect(triangleCount(buildColumnGeometry(chimney({ cap: true, base: 333 })))).toBe(0);
  });

  it('the parts turn with the column', () => {
    const [cap, arrestor] = buildColumnParts(chimney({ cap: true, rotation: 90 })).map((p) => p.geometry);
    const b = box(cap);
    expect(b.max[0] - b.min[0]).toBeCloseTo(24, 9);
    expect(b.max[2] - b.min[2]).toBeCloseTo(28, 9);
    const a = box(arrestor);
    expect(a.max[0] - a.min[0]).toBeCloseTo(18, 9);
    expect(a.max[2] - a.min[2]).toBeCloseTo(22, 9);
  });

  it('addBoxUVs: (x, plan y) on the top and bottom; along the face and the height on each side, in inches', () => {
    const g = buildColumnGeometry(chimney());
    const ranges = new Map<string, { u: number[]; v: number[] }>();
    for (const t of triangles(g)) {
      if (Math.abs(t.n[1]) > 0.5) {
        t.p.forEach((q, k) => {
          expect(t.uv[k][0]).toBeCloseTo(q[0], 4);
          expect(t.uv[k][1]).toBeCloseTo(q[2], 4);
        });
        continue;
      }
      // u runs along the face's tangent (-nz, nx), v is the height.
      t.p.forEach((q, k) => {
        expect(t.uv[k][0]).toBeCloseTo(q[0] * -t.n[2] + q[2] * t.n[0], 4);
        expect(t.uv[k][1]).toBeCloseTo(q[1], 4);
      });
      const key = t.n.map((c) => Math.round(c)).join(',');
      const r = ranges.get(key) ?? { u: [], v: [] };
      r.u.push(...t.uv.map((w) => w[0]));
      r.v.push(...t.uv.map((w) => w[1]));
      ranges.set(key, r);
    }
    const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    // North and south faces are 24" across, east and west 20"; each runs from the base to the top.
    expect([...ranges.keys()].sort()).toEqual(['-1,0,0', '0,0,-1', '0,0,1', '1,0,0']);
    expect(span(ranges.get('0,0,-1')!.u)).toBeCloseTo(24, 4);
    expect(span(ranges.get('0,0,1')!.u)).toBeCloseTo(24, 4);
    expect(span(ranges.get('1,0,0')!.u)).toBeCloseTo(20, 4);
    expect(span(ranges.get('-1,0,0')!.u)).toBeCloseTo(20, 4);
    for (const r of ranges.values()) {
      expect(Math.min(...r.v)).toBeCloseTo(-16, 4);
      expect(Math.max(...r.v)).toBeCloseTo(335, 4);
    }
    // The north face's u is plan x, so the brick bond does not stretch across it.
    expect(Math.min(...ranges.get('0,0,-1')!.u)).toBeCloseTo(147, 4);
    for (const p of buildColumnParts(chimney({ cap: true }))) expect(p.geometry.getAttribute('uv').count).toBe(p.geometry.getAttribute('position').count);
  });

  it('getSiteMeshes: parts only on a capped chimney, the colour after its default; replaced parts are disposed', () => {
    const capped = store().addColumn({ ...chimney({ cap: true, color: '#5A3A35' }), id: undefined })!;
    const plain = store().addColumn({ ...chimney({ at: { x: 400, y: -10 } }), id: undefined })!;
    const post = store().addColumn({ ...chimney({ kind: 'post', at: { x: 500, y: -10 }, width: 6, depth: 6, top: 96, cap: true }), id: undefined })!;
    const meshes = getSiteMeshes(plan(), 'all').columns;
    const of = (id: string) => meshes.find((m) => m.id === id)!;
    expect(of(capped).color).toBe('#5a3a35');
    expect(of(capped).parts!.map((p) => p.part)).toEqual(['cap', 'arrestor']);
    expect(of(plain).color).toBe(COLUMN_COLOR.chimney);
    expect('parts' in of(plain)).toBe(false);
    expect(of(post).color).toBe(COLUMN_COLOR.post);
    expect('parts' in of(post)).toBe(false);
    let disposed = 0;
    for (const p of of(capped).parts!) p.geometry.addEventListener('dispose', () => disposed++);
    of(capped).geometry.addEventListener('dispose', () => disposed++);
    store().updateColumn(capped, { cap: undefined });
    const after = getSiteMeshes(plan(), 'all').columns.find((m) => m.id === capped)!;
    expect(disposed).toBe(3);
    expect('parts' in after).toBe(false);
    expectBox(after.geometry, [147, -16, -20], [171, 335, 0]);
  });

  it('materials: by kind, phase and colour; a chimney records its flat colour; the cap is concrete, the arrestor the window screen', () => {
    const brown = columnMaterial('chimney', 'existing', '#5a3a35');
    expect(columnMaterial('chimney', 'existing', '#5a3a35')).toBe(brown);
    expect(columnMaterial('chimney', 'existing')).not.toBe(brown);
    expect(columnMaterial('chimney', 'existing')).toBe(columnMaterial('chimney', 'existing', COLUMN_COLOR.chimney));
    expect(columnMaterial('post', 'existing', '#5a3a35')).not.toBe(brown);
    // No canvas in node: no brick texture, the flat colour shows and is recorded for the export.
    expect(brown.map).toBeNull();
    expect(brown.color.getHexString()).toBe('5a3a35');
    expect(brown.userData.flatColor).toBe('#5a3a35');
    expect(brickTextures('#5a3a35')).toBeNull();
    const fresh = columnMaterial('chimney', 'new', '#5a3a35');
    expect(fresh).not.toBe(brown);
    expect(fresh.color.g).toBeGreaterThan(brown.color.g);
    expect(fresh.userData.flatColor).toBe(`#${fresh.color.getHexString()}`);
    const demo = columnMaterial('chimney', 'demo', '#5a3a35');
    expect(demo.transparent).toBe(true);
    expect(demo.color.getHexString()).toBe('e0413a');
    const cap = chimneyPartMaterial('cap', 'existing');
    expect(`#${cap.color.getHexString()}`).toBe(CHIMNEY_CAP_COLOR);
    expect(CHIMNEY_CAP_COLOR).toBe('#b8b4ac');
    expect(chimneyPartMaterial('cap', 'demo').transparent).toBe(true);
    const arrestor = chimneyPartMaterial('arrestor', 'existing');
    expect(arrestor).toBe(openingMaterial('screen', 'existing'));
    expect(arrestor.transparent).toBe(true);
    expect(arrestor.depthWrite).toBe(false);
  });

  it('export: the shaft column_<kind>_<phase> (plus _<hex> when coloured), the cap and arrestor as more Chimney meshes', () => {
    const { first } = house();
    store().addGradePoint({ at: { x: 0, y: 0 }, elevation: -4 });
    store().addColumn({ ...chimney({ cap: true, color: '#5a3a35' }), id: undefined });
    store().addColumn({ ...chimney({ at: { x: 60, y: -10 }, phase: 'demo', cap: true, color: '#5a3a35' }), id: undefined });
    store().addColumn({ ...chimney({ at: { x: 260, y: -10 } }), id: undefined });
    const root = buildExportScene(plan(), 'all', { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: first });
    const site = root.children.find((c) => c.name === 'Site')!;
    const meshes = site.children as Mesh[];
    expect(meshes.map((m) => m.name).sort()).toEqual(['Chimney', 'Chimney', 'Chimney', 'Chimney', 'Chimney', 'Chimney', 'Chimney', 'Terrain']);
    const mats = meshes.map((m) => (m.material as MeshStandardMaterial).name);
    expect(mats).toEqual([
      'terrain',
      'column_chimney_existing_5a3a35',
      'chimney_cap_existing',
      'chimney_arrestor_existing',
      'column_chimney_demo',
      'chimney_cap_demo',
      'chimney_arrestor_demo',
      'column_chimney_existing',
    ]);
    const byMat = (n: string) => meshes.find((m) => (m.material as MeshStandardMaterial).name === n)!;
    expect((byMat('column_chimney_existing_5a3a35').material as MeshStandardMaterial).color.getHexString()).toBe('5a3a35');
    expect((byMat('chimney_cap_existing').material as MeshStandardMaterial).color.getHexString()).toBe('b8b4ac');
    expect((byMat('chimney_arrestor_existing').material as MeshStandardMaterial).transparent).toBe(true);
    expect(byMat('chimney_arrestor_existing').renderOrder).toBe(1);
    expect(byMat('column_chimney_demo').renderOrder).toBe(1);
    for (const m of meshes) {
      expect((m.material as MeshStandardMaterial).map).toBeNull();
      expect((m.material as MeshStandardMaterial).normalMap).toBeNull();
    }
    disposeExportScene(root);
  });

  it('Fit 3D (planBox) reaches the spark arrestor 12" above a capped chimney and the cap 2" past its faces', () => {
    house();
    const id = store().addColumn({ ...chimney({ at: { x: 400, y: -60 }, base: -300, top: 500 }), id: undefined })!;
    const plainBox = planBox(plan());
    expect(plainBox.max[1]).toBe(500);
    expect(plainBox.max[0]).toBeCloseTo(412, 6);
    store().updateColumn(id, { cap: true });
    const capped = planBox(plan());
    expect(capped.max[1]).toBe(512);
    expect(capped.max[0]).toBeCloseTo(414, 6);
    expect(capped.min[2]).toBeCloseTo(-72, 6);
    expect(capped.min[1]).toBe(-300);
  });

  it('store: the colour is lower-cased, refused unless #rrggbb; colour and cap clear with undefined, one undo step each', () => {
    const id = store().addColumn({ ...chimney(), id: undefined })!;
    expect(store().addColumn({ ...chimney({ color: 'brown' }), id: undefined })).toBeNull();
    clearHistory();
    store().updateColumn(id, { color: '#5A3A35', cap: true });
    expect(plan().site.columns[id]).toMatchObject({ color: '#5a3a35', cap: true });
    const before = plan();
    store().updateColumn(id, { color: 'red' });
    store().updateColumn(id, { color: '#5a3a35' }); // unchanged
    expect(plan()).toBe(before);
    store().updateColumn(id, { color: undefined });
    store().updateColumn(id, { cap: undefined });
    expect('color' in plan().site.columns[id]).toBe(false);
    expect('cap' in plan().site.columns[id]).toBe(false);
    undo();
    expect(plan().site.columns[id].cap).toBe(true);
    undo();
    expect(plan().site.columns[id].color).toBe('#5a3a35');
  });

  it('brick: 18 courses of 6 bricks a tile in running bond, 2 2/3" x 8" with 3/8" joints, the mortar raked', () => {
    const faces = brickFaces();
    expect(BRICK_COURSE).toBeCloseTo(8 / 3, 12);
    expect(BRICK_LENGTH).toBe(8);
    expect(faces).toHaveLength(18 * 6);
    for (const f of faces) {
      expect(f.x1 - f.x0).toBeCloseTo(8 - MORTAR_JOINT, 9);
      expect(f.y1 - f.y0).toBeCloseTo(8 / 3 - MORTAR_JOINT, 9);
    }
    // Every other course is shifted half a brick; the 18 courses fill the 48" tile exactly.
    expect(faces[0].x0).toBeCloseTo(MORTAR_JOINT / 2, 9);
    expect(faces[6].x0).toBeCloseTo(4 + MORTAR_JOINT / 2, 9);
    expect(faces[faces.length - 1].y1).toBeCloseTo(48 - MORTAR_JOINT / 2, 9);
    const h = brickHeight();
    expect(h).toHaveLength(TEXTURE_PX * TEXTURE_PX);
    // Mid-brick is the face; a bed joint between two courses is raked back.
    const at = (x: number, y: number) => h[(TEXTURE_PX - 1 - Math.floor(y * PX_PER_INCH)) * TEXTURE_PX + Math.floor(x * PX_PER_INCH)];
    expect(at(2, 4 / 3)).toBe(0);
    expect(at(2, 8 / 3)).toBeCloseTo(-RELIEF.mortar, 9);
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

/** Height of the terrain surface over plan point p (the triangle containing it), or null outside. */
function surfaceAt(grid: TerrainGrid, p: Vec2): number | null {
  const P = (k: number) => ({ x: grid.positions[k * 3], y: grid.positions[k * 3 + 2], h: grid.positions[k * 3 + 1] });
  for (let t = 0; t < grid.indices.length; t += 3) {
    const [a, b, c] = [P(grid.indices[t]), P(grid.indices[t + 1]), P(grid.indices[t + 2])];
    const det = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(det) < 1e-12) continue;
    const w1 = ((p.x - a.x) * (c.y - a.y) - (p.y - a.y) * (c.x - a.x)) / det;
    const w2 = ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / det;
    if (w1 < -1e-9 || w2 < -1e-9 || w1 + w2 > 1 + 1e-9) continue;
    return a.h + (b.h - a.h) * w1 + (c.h - a.h) * w2;
  }
  return null;
}

/** Plan area covered by the triangles, and whether each faces up (+Y). */
function coverage(grid: TerrainGrid): { area: number; allUp: boolean } {
  let area = 0;
  let allUp = true;
  const at = (k: number): Vec2 => ({ x: grid.positions[k * 3], y: grid.positions[k * 3 + 2] });
  for (let t = 0; t < grid.indices.length; t += 3) {
    const [a, b, c] = [at(grid.indices[t]), at(grid.indices[t + 1]), at(grid.indices[t + 2])];
    const cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    // Upward in three coordinates is a negative cross product on the y-down plan.
    if (cr > 1e-9) allUp = false;
    area += Math.abs(cr) / 2;
  }
  return { area, allUp };
}

describe('the ground under the house (REVIEW-2 A3)', () => {
  /** A 20' x 15' basement box (8" walls) at an odd offset, so the outline crosses the grid cells. */
  function basementPlan(): { basement: string; first: string } {
    store().setPlan(createEmptyPlan('Basement test'));
    clearHistory();
    const [basement, first] = plan().levelOrder;
    const o = { kind: 'exterior' as const, thickness: 8, phase: 'existing' as const };
    const pts = [
      { x: 10, y: 13 },
      { x: 250, y: 13 },
      { x: 250, y: 193 },
      { x: 10, y: 193 },
    ];
    for (let i = 0; i < 4; i++) store().addWall(basement, pts[i], pts[(i + 1) % 4], o);
    return { basement, first };
  }
  const footprint = [rect(6, 9, 254, 197)];
  const bounds = { minX: 6, minY: 9, maxX: 254, maxY: 197 };

  it('vertices inside the footprint get floorUnder; outside they keep the grade surface', () => {
    const site = siteWith(gp(-200, -200, -10), gp(500, 400, -90));
    const plain = terrainGrid(site, bounds, -104);
    const cut = terrainGrid(site, bounds, -104, footprint, -106);
    const nx = plain.cellsX + 1;
    const n = nx * (plain.cellsY + 1);
    let lowered = 0;
    for (let v = 0; v < n; v++) {
      const x = plain.positions[v * 3];
      const y = plain.positions[v * 3 + 2];
      expect(cut.positions[v * 3]).toBe(x);
      expect(cut.positions[v * 3 + 2]).toBe(y);
      const inside = x > 6 && x < 254 && y > 9 && y < 197;
      if (inside) lowered++;
      expect(cut.positions[v * 3 + 1]).toBe(inside ? -106 : plain.positions[v * 3 + 1]);
    }
    expect(lowered).toBeGreaterThan(50);
    // A point inside returns the lowered height, a point outside the plain surface.
    expect(surfaceAt(cut, { x: 130, y: 100 })).toBeCloseTo(-106, 4);
    expect(surfaceAt(cut, { x: 400, y: 300 })).toBeCloseTo(surfaceAt(plain, { x: 400, y: 300 })!, 4);
    // Same extent and cells; every triangle faces up and together they cover the grid once.
    expect([cut.bounds, cut.cellsX, cut.cellsY, cut.step]).toEqual([plain.bounds, plain.cellsX, plain.cellsY, plain.step]);
    const area = (plain.bounds.maxX - plain.bounds.minX) * (plain.bounds.maxY - plain.bounds.minY);
    expect(coverage(cut).allUp).toBe(true);
    expect(coverage(cut).area).toBeCloseTo(area, 3);
  });

  it('the ground meets the outside face at grade and drops straight down there (no slope across a cell)', () => {
    const site = siteWith(gp(-200, -200, -10), gp(500, 400, -30));
    const plain = terrainGrid(site, bounds, -104);
    const cut = terrainGrid(site, bounds, -104, footprint, -106);
    // Just outside the north face (y 9) and just inside it.
    for (const x of [20, 77.7, 130, 241]) {
      expect(surfaceAt(cut, { x, y: 8.9 })).toBeCloseTo(surfaceAt(plain, { x, y: 8.9 })!, 3);
      expect(surfaceAt(cut, { x, y: 9.1 })).toBeCloseTo(-106, 6);
    }
    // No triangle mixes ground and under-house heights.
    for (let t = 0; t < cut.indices.length; t += 3) {
      const hs = [0, 1, 2].map((k) => cut.positions[cut.indices[t + k] * 3 + 1]);
      const under = hs.map((h) => h === -106);
      expect(under.every((u) => u === under[0])).toBe(true);
    }
  });

  it('no grade points: flat everywhere except the footprint', () => {
    const cut = terrainGrid({ gradePoints: {} }, bounds, -104, footprint, -106);
    const hs = new Set<number>();
    for (let v = 0; v < cut.positions.length / 3; v++) hs.add(cut.positions[v * 3 + 1]);
    expect([...hs].sort((p, q) => p - q)).toEqual([-106, -104]);
    expect(surfaceAt(cut, { x: 130, y: 100 })).toBe(-106);
    expect(surfaceAt(cut, { x: -100, y: 100 })).toBe(-104);
    expect(surfaceAt(cut, { x: 253.9, y: 100 })).toBeCloseTo(-106, 9);
    expect(surfaceAt(cut, { x: 254.1, y: 100 })).toBeCloseTo(-104, 9);
  });

  it('the plan terrain cuts the lowest level out at its slab bottom minus 2", following its walls', () => {
    const { basement, first } = basementPlan();
    store().addGradePoint({ at: { x: -50, y: -50 }, elevation: -10 });
    store().addGradePoint({ at: { x: 400, y: 300 }, elevation: -60 });
    const cut = terrainCut(plan(), 'all')!;
    expect(cut.floorUnder).toBe(fallbackElevation(plan()) - TERRAIN_UNDER_SLAB);
    expect(cut.floorUnder).toBe(-106);
    expect(cut.footprints()).toEqual(slabOutlines(getFaces(plan().levels[basement], 'all'), true));
    const g1 = planTerrain(plan());
    expect(surfaceAt(g1, { x: 130, y: 100 })).toBeCloseTo(-106, 6);
    expect(surfaceAt(g1, { x: 300, y: 100 })).toBeCloseTo(terrainHeightAt(plan().site, { x: 300, y: 100 }, -104), 0);
    // An edit on another level, a column or a basement room label keep the grid.
    store().addWall(first, { x: 0, y: 0 }, { x: 100, y: 0 }, { kind: 'exterior', thickness: 6.5, phase: 'existing' });
    store().addColumn({ at: { x: 100, y: 100 }, kind: 'post', width: 6, depth: 6, rotation: 0, base: 0, top: 96, phase: 'existing' });
    store().addRoom(basement, { name: 'Basement', anchor: { x: 100, y: 100 } });
    expect(planTerrain(plan())).toBe(g1);
    // A basement wall edit rebuilds it: demolishing the basement walls leaves the existing view
    // cut but not the proposed one.
    const walls = Object.keys(plan().levels[basement].walls);
    store().setPhase(basement, { walls, openings: [] }, 'demo');
    const g2 = planTerrain(plan(), 'existing');
    expect(g2).not.toBe(g1);
    expect(surfaceAt(g2, { x: 130, y: 100 })).toBeCloseTo(-106, 6);
    expect(planTerrain(plan(), 'proposed')).not.toBe(g2);
    expect(surfaceAt(planTerrain(plan(), 'proposed'), { x: 130, y: 100 })).toBeGreaterThan(-60);
    // The geometry follows: same object while the grid is the same.
    const geo = getTerrainGeometry(plan(), 'all');
    store().setNorthAngle(15);
    expect(getTerrainGeometry(plan(), 'all')).toBe(geo);
  });

  it("the example's basement is empty of ground: every grid point inside its footprint is under the slab", () => {
    const ex = migrate(example);
    const grid = planTerrain(ex, 'all');
    const lowest = ex.levels[ex.levelOrder[0]];
    const outlines = slabOutlines(getFaces(lowest, 'all'), true);
    expect(outlines.length).toBeGreaterThan(0);
    const under = fallbackElevation(ex) - 2;
    expect(under).toBe(-106);
    let inside = 0;
    // The grid's own vertices (the split cells' extra vertices on the outline follow).
    for (let v = 0; v < (grid.cellsX + 1) * (grid.cellsY + 1); v++) {
      const p = { x: grid.positions[v * 3], y: grid.positions[v * 3 + 2] };
      if (!outlines.some((o) => pointInPolygonStrict(p, o))) continue;
      inside++;
      expect(grid.positions[v * 3 + 1]).toBe(under);
    }
    expect(inside).toBeGreaterThan(100);
    // The basement floor is 4" above the ground under it all over the interior.
    expect(surfaceAt(grid, { x: 160, y: 160 })).toBeCloseTo(-106, 6);
  });
});

function pointInPolygonStrict(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

describe('flues: round stainless chimney pipes', () => {
  const flue = (over: Partial<Column> = {}): Column => ({
    id: 'f1',
    at: { x: 19, y: 280 },
    width: 8,
    depth: 8,
    rotation: 0,
    base: 33,
    top: 320,
    kind: 'flue',
    phase: 'new',
    ...over,
  });
  const bbox = (g: BufferGeometry) => {
    g.computeBoundingBox();
    return g.boundingBox!;
  };

  it('is a round pipe of diameter `width` (depth ignored), shading smooth, picked inside its circle', () => {
    const c = flue({ depth: 30, rotation: 45 });
    const outline = columnOutline(c);
    expect(outline).toHaveLength(FLUE_SIDES);
    for (const p of outline) expect(Math.hypot(p.x - 19, p.y - 280)).toBeCloseTo(4, 9);
    const g = buildColumnGeometry(c);
    const b = bbox(g);
    expect([b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z]).toEqual([15, 23, 33, 320, 276, 284]);
    // Side normals point straight out from the axis.
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(nor.getY(i)) > 0.5) continue;
      const r = Math.hypot(pos.getX(i) - 19, pos.getZ(i) - 280);
      expect(nor.getX(i)).toBeCloseTo((pos.getX(i) - 19) / r, 5);
    }
    expect(pointInColumn(c, { x: 19 + 3.9, y: 280 })).toBe(true);
    expect(pointInColumn(c, { x: 19 + 3, y: 280 + 3 })).toBe(false);
  });

  it('has a rain cap with `cap`: a disc twice its width on a stem, 3" over its top', () => {
    expect(hasFlueCap(flue())).toBe(false);
    expect(chimneyPartBoxes(flue())).toEqual([]);
    const c = flue({ cap: true });
    expect(hasFlueCap(c)).toBe(true);
    expect(hasChimneyCap(c)).toBe(false);
    const parts = chimneyPartBoxes(c);
    expect(parts.map((p) => [p.part, p.bottom, p.top])).toEqual([
      ['stem', 320, 323],
      ['hood', 323, 324.5],
    ]);
    for (const p of parts[1].outline) expect(Math.hypot(p.x - 19, p.y - 280)).toBeCloseTo(8 * FLUE_CAP.spread / 2, 9);
    expect(columnPeak(c)).toBe(324.5);
    // The pipe itself runs to its top (no concrete cap to stop under).
    expect(bbox(buildColumnGeometry(c)).max.y).toBe(320);
    expect(buildColumnParts(c).map((p) => p.part)).toEqual(['stem', 'hood']);
  });

  it('defaults to 8" from a stove top 30" over the first floor to 24" above the highest ridge; a file keeps the kind', () => {
    const d = columnDefaults(plan(), 'flue', { x: 0, y: 0 });
    // Empty plan: the first floor top is 8, the Second Floor ceiling 212 (no roofs).
    expect(d).toMatchObject({ width: 8, depth: 8, rotation: 0, base: 8 + 30, top: 212 + 24 });
    const id = store().addColumn({ at: { x: 0, y: 0 }, kind: 'flue', phase: 'new', ...d, cap: true })!;
    const loaded = migrate(JSON.parse(JSON.stringify(plan())));
    expect(loaded.site.columns[id]).toMatchObject({ kind: 'flue', cap: true });
  });

  it('is metal in 3D, a stainless rain cap, a circle on the plan, and a Flue in the export', () => {
    const m = columnMaterial('flue', 'existing');
    expect(m.metalness).toBeGreaterThan(0.5);
    expect(m.flatShading).toBe(false);
    expect(m.color.getHexString()).toBe(COLUMN_COLOR.flue.slice(1));
    expect(chimneyPartMaterial('hood', 'existing')).toBe(m);
    const d = columnDefaults(plan(), 'flue', { x: 0, y: 0 });
    store().addColumn({ at: { x: 0, y: 0 }, kind: 'flue', phase: 'existing', ...d, cap: true });
    const root = buildExportScene(plan(), 'all', { activeLevelId: defaultLevelId(plan()), only3dActiveAndBelow: false, hidden3dLevels: [] });
    const flues: string[] = [];
    root.traverse((o) => {
      if (o.name === 'Flue' && o instanceof Mesh) flues.push((o.material as MeshStandardMaterial).name);
    });
    expect(flues).toEqual(['column_flue_existing', 'flue_stem_existing', 'flue_hood_existing']);
    disposeExportScene(root);
  });
});

describe('piers: fieldstone', () => {
  it('defaults to 16" x 16" from the ground to the first floor; a file keeps the kind', () => {
    // Empty plan: the first floor top is 8.
    const d = columnDefaults(plan(), 'pier', { x: 0, y: 0 });
    expect(d).toMatchObject({ width: 16, depth: 16, rotation: 0, top: 8 });
    expect(d.base).toBe(columnDefaults(plan(), 'post', { x: 0, y: 0 }).base);
    // Ground above the first floor: 24" of pier over it.
    store().addGradePoint({ at: { x: 0, y: 0 }, elevation: 40 });
    expect(columnDefaults(plan(), 'pier', { x: 0, y: 0 })).toMatchObject({ base: 40, top: 64 });
    // A low wide stoop is a pier too.
    const id = store().addColumn({ at: { x: 0, y: 0 }, kind: 'pier', phase: 'new', width: 60, depth: 36, rotation: 0, base: 0, top: 14 })!;
    const loaded = migrate(JSON.parse(JSON.stringify(plan())));
    expect(loaded.site.columns[id]).toMatchObject({ kind: 'pier', width: 60, depth: 36 });
  });

  it('is fieldstone in 3D (the flat colour without a canvas), a box with UVs, and a Pier in the export', () => {
    const m = columnMaterial('pier', 'existing');
    expect(m.color.getHexString()).toBe(COLUMN_COLOR.pier.slice(1));
    expect(m.userData.flatColor).toBe(COLUMN_COLOR.pier);
    expect(columnMaterial('pier', 'existing')).toBe(m);
    expect(columnMaterial('pier', 'new')).not.toBe(m);
    const c: Column = { id: 'p1', at: { x: 0, y: 0 }, width: 16, depth: 16, rotation: 0, base: 0, top: 8, kind: 'pier', phase: 'existing' };
    expect(buildColumnGeometry(c).getAttribute('uv')).toBeDefined();
    expect(buildColumnParts({ ...c, cap: true })).toEqual([]);
    store().addColumn(c);
    const root = buildExportScene(plan(), 'all', { activeLevelId: defaultLevelId(plan()), only3dActiveAndBelow: false, hidden3dLevels: [] });
    const piers: string[] = [];
    root.traverse((o) => {
      if (o.name === 'Pier' && o instanceof Mesh) piers.push((o.material as MeshStandardMaterial).name);
    });
    expect(piers).toEqual(['column_pier_existing']);
    disposeExportScene(root);
  });

  it('comes after the flue in the column tool, then back to the chimney', () => {
    expect(nextColumnKind('flue')).toBe('pier');
    expect(nextColumnKind('pier')).toBe('chimney');
    expect(COLUMN_KIND_NAME.pier).toBe('Pier');
  });
});
