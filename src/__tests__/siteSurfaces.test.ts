import { Mesh, type MeshStandardMaterial } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFenceGeometry, clearMeshCache, getFenceMeshes, getSurfaceMeshes, triangleCount } from '../derive/meshes';
import {
  drapeSurface,
  FENCE_DEFAULTS,
  fenceLayout,
  fenceLength,
  fencePostPoints,
  fenceRailFractions,
  siteBounds,
  SURFACE_LIFT,
  surfaceArea,
  terrainGrid,
  terrainHeightAt,
  type TerrainGrid,
} from '../derive/site';
import { dispatchKey, dispatchPointer, enterSiteMode, switchTool, type ToolPointerEvent } from '../editor2d/tools';
import { FENCE_PICK_PX, hitSite, nextSurfaceMaterial } from '../editor2d/tools/siteTools';
import { buildExportScene, disposeExportScene } from '../io/export3d';
import { FENCE_COLOR, fenceColorOf, SURFACE_COLOR, surfaceColorOf } from '../model/finish';
import { polygonSignedArea } from '../model/geometry';
import { createEmptyPlan, defaultLevelId, fenceProblem, migrate, MIGRATIONS, SCHEMA_VERSION, surfaceProblem } from '../model/plan';
import type { Fence, Plan, Site, SiteSurface, Vec2 } from '../model/types';
import { clearHistory, undo, usePlanStore } from '../store/planStore';
import { EMPTY_SELECTION, selectionSize, useUiStore } from '../store/uiStore';
import { bindingFor } from '../ui/keymap';

const store = () => usePlanStore.getState();
const plan = (): Plan => store().plan;
const ui = () => useUiStore.getState();

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const surface = (over: Partial<SiteSurface> = {}): Omit<SiteSurface, 'id'> => ({ outline: rect(0, 0, 120, 60), material: 'gravel', phase: 'existing', ...over });
const fence = (over: Partial<Fence> = {}): Omit<Fence, 'id'> => ({
  points: [
    { x: 0, y: 0 },
    { x: 250, y: 0 },
  ],
  height: 42,
  rails: 2,
  postSpacing: 120,
  phase: 'existing',
  ...over,
});
const gp = (x: number, y: number, elevation: number) => ({ id: `g${x},${y}`, at: { x, y }, elevation });

beforeEach(() => {
  clearMeshCache();
  store().setPlan(createEmptyPlan());
  clearHistory();
  ui().setActiveLevel(defaultLevelId(plan()));
  ui().setTool('select');
  ui().setViewMode('all');
});

describe('schema 8: surfaces and fences in the file', () => {
  it('MIGRATIONS[7] adds empty surfaces and fences to the site', () => {
    expect(SCHEMA_VERSION).toBe(8);
    const v7 = JSON.parse(JSON.stringify({ ...createEmptyPlan(), schemaVersion: 7 }));
    delete v7.site.surfaces;
    delete v7.site.fences;
    const up = MIGRATIONS[7](v7);
    expect(up.schemaVersion).toBe(8);
    expect((up.site as Site).surfaces).toEqual({});
    expect((up.site as Site).fences).toEqual({});
    const loaded = migrate(v7);
    expect(loaded.schemaVersion).toBe(8);
    expect(loaded.site.surfaces).toEqual({});
    expect(loaded.site.fences).toEqual({});
  });

  it('round-trips surfaces and fences byte for byte', () => {
    const p = JSON.parse(JSON.stringify(createEmptyPlan('Drive')));
    p.site.surfaces.s = { id: 's', outline: rect(0, 0, 100, 50), material: 'asphalt', phase: 'new', color: '#333333' };
    p.site.fences.f = { id: 'f', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }], height: 48, rails: 3, postSpacing: 96, phase: 'demo' };
    const text = JSON.stringify(p, null, 2);
    expect(JSON.stringify(migrate(JSON.parse(text)), null, 2)).toBe(text);
  });

  it('drops broken surfaces and fences with a warning, lower-cases colours and drops a bad one alone', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = JSON.parse(JSON.stringify(createEmptyPlan('Broken')));
    p.site.surfaces = {
      ok: { id: 'ok', outline: rect(0, 0, 10, 10), material: 'concrete', color: '#ABCDEF' },
      two: { id: 'two', outline: [{ x: 0, y: 0 }, { x: 10, y: 0 }], material: 'gravel', phase: 'existing' },
      bow: { id: 'bow', outline: [{ x: 0, y: 0 }, { x: 30, y: 10 }, { x: 30, y: 0 }, { x: 0, y: 20 }], material: 'gravel', phase: 'existing' },
      mud: { id: 'mud', outline: rect(0, 0, 10, 10), material: 'mud', phase: 'existing' },
      tint: { id: 'tint', outline: rect(0, 0, 10, 10), material: 'stone', phase: 'existing', color: 'grey' },
      junk: 7,
    };
    p.site.fences = {
      ok: { id: 'ok', points: [{ x: 0, y: 0 }, { x: 50, y: 0 }], height: 42, rails: 2, postSpacing: 120, color: '#8B8478' },
      one: { id: 'one', points: [{ x: 0, y: 0 }], height: 42, rails: 2, postSpacing: 120, phase: 'existing' },
      flat: { id: 'flat', points: [{ x: 0, y: 0 }, { x: 50, y: 0 }], height: 0, rails: 2, postSpacing: 120, phase: 'existing' },
      many: { id: 'many', points: [{ x: 0, y: 0 }, { x: 50, y: 0 }], height: 42, rails: 5, postSpacing: 120, phase: 'existing' },
      tight: { id: 'tight', points: [{ x: 0, y: 0 }, { x: 50, y: 0 }], height: 42, rails: 2, postSpacing: 12, phase: 'existing' },
    };
    const site = migrate(p).site;
    expect(Object.keys(site.surfaces)).toEqual(['ok', 'tint']);
    expect(site.surfaces.ok).toMatchObject({ phase: 'existing', color: '#abcdef' });
    expect('color' in site.surfaces.tint).toBe(false);
    expect(Object.keys(site.fences)).toEqual(['ok']);
    expect(site.fences.ok).toMatchObject({ phase: 'existing', color: '#8b8478' });
    expect(warn).toHaveBeenCalledTimes(4 + 4);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/dropped surface bow: the outline crosses itself/);
    warn.mockRestore();
  });
});

describe('validators', () => {
  it('surfaceProblem: 3 points or more, not crossing itself, with area, a known material, a hex colour', () => {
    expect(surfaceProblem(surface())).toBeNull();
    expect(surfaceProblem(surface({ outline: rect(0, 0, 10, 10).slice(0, 2) }))).toMatch(/at least 3/);
    expect(surfaceProblem(surface({ outline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] }))).toMatch(/no area/);
    expect(surfaceProblem(surface({ outline: [{ x: 0, y: 0 }, { x: 30, y: 10 }, { x: 30, y: 0 }, { x: 0, y: 20 }] }))).toMatch(/crosses itself/);
    expect(surfaceProblem(surface({ material: 'mud' as SiteSurface['material'] }))).toMatch(/material/);
    expect(surfaceProblem(surface({ color: 'grey' }))).toMatch(/colour/);
    expect(surfaceProblem(surface({ color: '#a39a88' }))).toBeNull();
  });

  it('fenceProblem: 2 points or more, a positive height, 1 to 4 whole rails, posts at least 24" apart', () => {
    expect(fenceProblem(fence())).toBeNull();
    expect(fenceProblem(fence({ points: [{ x: 0, y: 0 }] }))).toMatch(/2 points/);
    expect(fenceProblem(fence({ points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }] }))).toMatch(/on top of each other/);
    expect(fenceProblem(fence({ height: 0 }))).toMatch(/height/);
    for (const rails of [0, 5, 1.5, NaN]) expect(fenceProblem(fence({ rails })), String(rails)).toMatch(/rails/);
    expect(fenceProblem(fence({ rails: 4 }))).toBeNull();
    expect(fenceProblem(fence({ postSpacing: 23 }))).toMatch(/spacing/);
    expect(fenceProblem(fence({ postSpacing: 24 }))).toBeNull();
    expect(fenceProblem(fence({ color: '#12345' }))).toMatch(/colour/);
  });
});

describe('store actions', () => {
  it('surfaces: add with validation, update, delete, each one undo step; a no-op leaves the plan alone', () => {
    expect(store().addSurface(surface({ outline: rect(0, 0, 10, 10).slice(0, 2) }))).toBeNull();
    expect(store().addSurface(surface({ color: 'grey' }))).toBeNull();
    const id = store().addSurface(surface({ color: '#A39A88' }))!;
    expect(plan().site.surfaces[id]).toEqual({ id, ...surface(), color: '#a39a88' });
    const before = plan();
    store().updateSurface(id, { material: 'gravel', outline: rect(0, 0, 120, 60) });
    store().updateSurface(id, { material: 'mud' as SiteSurface['material'] });
    store().updateSurface('nope', { material: 'asphalt' });
    expect(plan()).toBe(before);
    store().updateSurface(id, { material: 'asphalt' });
    store().updateSurface(id, { color: undefined });
    expect(plan().site.surfaces[id].material).toBe('asphalt');
    expect('color' in plan().site.surfaces[id]).toBe(false);
    store().deleteSurfaces([id]);
    expect(plan().site.surfaces[id]).toBeUndefined();
    const deleted = plan();
    store().deleteSurfaces([id]);
    expect(plan()).toBe(deleted);
    undo();
    expect(plan().site.surfaces[id].material).toBe('asphalt');
    undo();
    expect(plan().site.surfaces[id].color).toBe('#a39a88');
    undo();
    expect(plan().site.surfaces[id].material).toBe('gravel');
    undo();
    expect(plan().site.surfaces[id]).toBeUndefined();
  });

  it('fences: add with validation, update, delete, each one undo step; a no-op leaves the plan alone', () => {
    expect(store().addFence(fence({ rails: 7 }))).toBeNull();
    const id = store().addFence(fence())!;
    expect(plan().site.fences[id]).toEqual({ id, ...fence() });
    const before = plan();
    store().updateFence(id, { height: 42, points: fence().points });
    store().updateFence(id, { postSpacing: 10 });
    expect(plan()).toBe(before);
    store().updateFence(id, { height: 48, rails: 3, color: '#6B5A48' });
    expect(plan().site.fences[id]).toMatchObject({ height: 48, rails: 3, color: '#6b5a48' });
    store().updateFence(id, { color: undefined });
    expect('color' in plan().site.fences[id]).toBe(false);
    store().deleteFences([id]);
    expect(plan().site.fences[id]).toBeUndefined();
    undo();
    undo();
    expect(plan().site.fences[id].color).toBe('#6b5a48');
    undo();
    expect(plan().site.fences[id]).toEqual({ id, ...fence() });
  });

  it('moveSiteItems moves surfaces and fences with the rest in one step; deleteEntities and setPhase take them', () => {
    const level = defaultLevelId(plan());
    const s = store().addSurface(surface())!;
    const f = store().addFence(fence())!;
    const g = store().addGradePoint({ at: { x: 0, y: 0 }, elevation: 0 })!;
    clearHistory();
    const shifted = (pts: Vec2[]) => pts.map((p) => ({ x: p.x + 10, y: p.y + 5 }));
    store().moveSiteItems({ [g]: { x: 10, y: 5 } }, {}, { surfaces: { [s]: shifted(surface().outline) }, fences: { [f]: shifted(fence().points) } });
    expect(plan().site.surfaces[s].outline[0]).toEqual({ x: 10, y: 5 });
    expect(plan().site.fences[f].points[1]).toEqual({ x: 260, y: 5 });
    // A shape with another number of points, or the same points, changes nothing.
    const moved = plan();
    store().moveSiteItems({}, {}, { surfaces: { [s]: rect(0, 0, 1, 1).slice(0, 3) }, fences: { [f]: shifted(fence().points) } });
    expect(plan()).toBe(moved);
    undo();
    expect(plan().site.surfaces[s].outline[0]).toEqual({ x: 0, y: 0 });
    expect(plan().site.gradePoints[g].at).toEqual({ x: 0, y: 0 });
    store().setPhase(level, { walls: [], openings: [], surfaces: [s], fences: [f] }, 'demo');
    expect([plan().site.surfaces[s].phase, plan().site.fences[f].phase]).toEqual(['demo', 'demo']);
    store().deleteEntities(level, { nodes: [], walls: [], surfaces: [s], fences: [f] });
    expect(plan().site.surfaces).toEqual({});
    expect(plan().site.fences).toEqual({});
    undo();
    expect(Object.keys(plan().site.surfaces)).toEqual([s]);
  });

  it('the selection carries surfaces and fences', () => {
    expect(EMPTY_SELECTION.surfaces).toEqual([]);
    expect(EMPTY_SELECTION.fences).toEqual([]);
    expect(selectionSize({ ...EMPTY_SELECTION, surfaces: ['a'], fences: ['b', 'c'] })).toBe(3);
  });
});

describe('fence layout', () => {
  it('a post at every point and as few more as keep each gap within the spacing, evenly spread', () => {
    const posts = fencePostPoints(fence({ points: [{ x: 0, y: 0 }, { x: 250, y: 0 }, { x: 250, y: 100 }] }));
    expect(posts.map((p) => [Math.round(p.x * 100) / 100, p.y])).toEqual([
      [0, 0],
      [83.33, 0],
      [166.67, 0],
      [250, 0],
      [250, 100],
    ]);
    for (let i = 1; i < posts.length; i++) expect(Math.hypot(posts[i].x - posts[i - 1].x, posts[i].y - posts[i - 1].y)).toBeLessThanOrEqual(120 + 1e-9);
    // An exact multiple of the spacing needs no extra post.
    expect(fencePostPoints(fence({ points: [{ x: 0, y: 0 }, { x: 240, y: 0 }] }))).toHaveLength(3);
    // A run back to the first point shares its post.
    const loop = fence({ points: [...rect(0, 0, 100, 100), { x: 0, y: 0 }] });
    expect(fencePostPoints(loop)).toHaveLength(4);
    expect(fenceLength(loop)).toBe(400);
  });

  it('posts stand 6" into the ground up to the height over it; rails follow the slope between 30% and 85%', () => {
    expect(fenceRailFractions(1)).toEqual([FENCE_DEFAULTS.railHigh]);
    expect(fenceRailFractions(2).map((t) => Math.round(t * 1000) / 1000)).toEqual([0.3, 0.85]);
    expect(fenceRailFractions(3).map((t) => Math.round(t * 1000) / 1000)).toEqual([0.3, 0.575, 0.85]);
    const ground = (p: Vec2) => 0.1 * p.x - 20;
    const layout = fenceLayout(fence({ points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], height: 40, rails: 2, postSpacing: 100 }), ground);
    expect(layout.posts.map((p) => [p.at.x, p.ground, p.bottom, p.top])).toEqual([
      [0, -20, -26, 20],
      [100, -10, -16, 30],
      [200, 0, -6, 40],
    ]);
    expect(layout.rails).toHaveLength(4);
    const [low, high] = layout.rails;
    expect(low.a).toEqual({ x: 0, y: 0, z: -20 + 12 });
    expect(low.b).toEqual({ x: 100, y: 0, z: -10 + 12 });
    expect(high.a.z).toBeCloseTo(-20 + 34);
    expect(high.b.z).toBeCloseTo(-10 + 34);
    // A closed fence joins its last post to the first.
    const loop = fenceLayout(fence({ points: [...rect(0, 0, 100, 100), { x: 0, y: 0 }], rails: 1 }), () => 0);
    expect(loop.posts).toHaveLength(4);
    expect(loop.rails).toHaveLength(4);
  });

  it('builds round logs from 6" under the ground to the top of the posts', () => {
    const { body, ends } = buildFenceGeometry(fenceLayout(fence(), () => 10));
    expect(triangleCount(body)).toBeGreaterThan(0);
    expect(triangleCount(ends)).toBeGreaterThan(0);
    body.computeBoundingBox();
    const box = body.boundingBox!;
    expect(box.min.y).toBeCloseTo(10 - FENCE_DEFAULTS.belowGrade, 5);
    expect(box.max.y).toBeCloseTo(10 + 42, 5);
    // The posts' 6" diameter along z, the 250" run along x.
    expect(box.max.z - box.min.z).toBeCloseTo(FENCE_DEFAULTS.post, 1);
    expect(box.max.x - box.min.x).toBeCloseTo(250 + FENCE_DEFAULTS.post, 1);
  });
});

describe('surface draping', () => {
  // A sloped, folded TIN: four corners at different heights (not one plane) and one in the middle.
  const site: Pick<Site, 'gradePoints'> = {
    gradePoints: Object.fromEntries([gp(0, 0, 0), gp(400, 0, -40), gp(400, 300, -10), gp(0, 300, 30), gp(170, 140, 25)].map((g) => [g.id, g])),
  };
  const grid: TerrainGrid = terrainGrid(site, { minX: 0, minY: 0, maxX: 400, maxY: 300 }, 0);
  const outline: Vec2[] = [
    { x: 37, y: 21 },
    { x: 311, y: 58 },
    { x: 280, y: 190 },
    { x: 190, y: 120 },
    { x: 60, y: 240 },
  ];

  /** The grid surface's height at p: the grid triangle under it, linear. */
  const gridHeight = (p: Vec2): number => {
    const { positions: q, indices: idx } = grid;
    for (let t = 0; t < idx.length / 3; t++) {
      const v = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]].map((i) => ({ x: q[i * 3], y: q[i * 3 + 2], z: q[i * 3 + 1] }));
      if (Math.max(...v.map((c) => c.x)) < p.x - 1e-6 || Math.min(...v.map((c) => c.x)) > p.x + 1e-6) continue;
      if (Math.max(...v.map((c) => c.y)) < p.y - 1e-6 || Math.min(...v.map((c) => c.y)) > p.y + 1e-6) continue;
      const d = (v[1].y - v[2].y) * (v[0].x - v[2].x) + (v[2].x - v[1].x) * (v[0].y - v[2].y);
      const a = ((v[1].y - v[2].y) * (p.x - v[2].x) + (v[2].x - v[1].x) * (p.y - v[2].y)) / d;
      const b = ((v[2].y - v[0].y) * (p.x - v[2].x) + (v[0].x - v[2].x) * (p.y - v[2].y)) / d;
      const c = 1 - a - b;
      if (a >= -1e-6 && b >= -1e-6 && c >= -1e-6) return a * v[0].z + b * v[1].z + c * v[2].z;
    }
    throw new Error(`no grid triangle under ${p.x}, ${p.y}`);
  };

  it('lies on the terrain plus the lift at every vertex, faces up, and keeps the outline area', () => {
    const pos = drapeSurface(outline, grid);
    expect(pos.length % 9).toBe(0);
    let area = 0;
    for (let t = 0; t < pos.length / 9; t++) {
      const v = [0, 1, 2].map((k) => ({ x: pos[t * 9 + k * 3], y: pos[t * 9 + k * 3 + 2], z: pos[t * 9 + k * 3 + 1] }));
      for (const c of v) expect(c.z - SURFACE_LIFT).toBeCloseTo(gridHeight(c), 3);
      // Up in three coordinates: (b - a) x (c - a) has a positive Y.
      const ny = (v[1].y - v[0].y) * (v[2].x - v[0].x) - (v[1].x - v[0].x) * (v[2].y - v[0].y);
      expect(ny).toBeGreaterThan(0);
      area += Math.abs(polygonSignedArea(v));
    }
    expect(area / Math.abs(polygonSignedArea(outline))).toBeCloseTo(1, 4);
    // The grid follows the TIN closely here (24" cells over 100"-plus triangles).
    expect(pos[1] - SURFACE_LIFT).toBeCloseTo(terrainHeightAt(site, { x: pos[0], y: pos[2] }, 0), 0);
  });

  it('is the same either way round, and nothing for a degenerate outline', () => {
    const area = (pos: Float32Array) => {
      let a = 0;
      for (let t = 0; t < pos.length / 9; t++) a += Math.abs(polygonSignedArea([0, 1, 2].map((k) => ({ x: pos[t * 9 + k * 3], y: pos[t * 9 + k * 3 + 2] }))));
      return a;
    };
    expect(area(drapeSurface([...outline].reverse(), grid))).toBeCloseTo(area(drapeSurface(outline, grid)), 3);
    expect(drapeSurface([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], grid)).toHaveLength(0);
  });

  it('getSurfaceMeshes drapes the visible surfaces, memoized on the surfaces and the terrain; colour and material by default', () => {
    store().addGradePoint({ at: { x: 0, y: 0 }, elevation: -20 });
    store().addGradePoint({ at: { x: 300, y: 0 }, elevation: 10 });
    store().addGradePoint({ at: { x: 0, y: 300 }, elevation: 0 });
    const a = store().addSurface(surface())!;
    const b = store().addSurface(surface({ outline: rect(200, 200, 260, 260), material: 'asphalt', phase: 'new', color: '#202020' }))!;
    const first = getSurfaceMeshes(plan(), 'all');
    expect(first.map((m) => [m.id, m.material, m.color, m.phase])).toEqual([
      [a, 'gravel', SURFACE_COLOR.gravel, 'existing'],
      [b, 'asphalt', '#202020', 'new'],
    ]);
    expect(getSurfaceMeshes(plan(), 'existing').map((m) => m.id)).toEqual([a]);
    expect(getSurfaceMeshes(plan(), 'proposed').map((m) => m.phase)).toEqual(['existing', 'existing']);
    store().setNorthAngle(30); // nothing a surface depends on
    expect(getSurfaceMeshes(plan(), 'all')).toBe(first);
    store().updateSurface(b, { color: '#303030' });
    const next = getSurfaceMeshes(plan(), 'all');
    expect(next).not.toBe(first);
    expect(next[0].geometry).toBe(first[0].geometry);
    expect(next[1].geometry).not.toBe(first[1].geometry);
    store().addGradePoint({ at: { x: 300, y: 300 }, elevation: 40 });
    expect(getSurfaceMeshes(plan(), 'all')[0].geometry).not.toBe(first[0].geometry);
    expect(surfaceColorOf({ material: 'stone' })).toBe('#8a8378');
  });

  it('getFenceMeshes stands the visible fences on the ground, memoized on the fences and the grade points', () => {
    const f = store().addFence(fence())!;
    const first = getFenceMeshes(plan(), 'all');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ id: f, color: FENCE_COLOR, phase: 'existing' });
    store().addSurface(surface());
    expect(getFenceMeshes(plan(), 'all')).toBe(first);
    store().addGradePoint({ at: { x: 0, y: 0 }, elevation: -30 });
    const raised = getFenceMeshes(plan(), 'all');
    expect(raised[0].body).not.toBe(first[0].body);
    raised[0].body.computeBoundingBox();
    expect(raised[0].body.boundingBox!.min.y).toBeCloseTo(-30 - FENCE_DEFAULTS.belowGrade, 4);
    expect(fenceColorOf({ color: '#111111' })).toBe('#111111');
  });
});

describe('siteBounds and picking', () => {
  it('siteBounds takes in the surfaces and fences', () => {
    store().addSurface(surface({ outline: rect(-900, -50, -800, 50) }));
    store().addFence(fence({ points: [{ x: 0, y: 0 }, { x: 0, y: 1500 }] }));
    const b = siteBounds(plan());
    expect(b.minX).toBe(-900);
    expect(b.maxY).toBe(1500);
  });

  it('hitSite: grade points, columns, then fences near their line, then surfaces (the smallest on top), by view mode', () => {
    const site: Site = {
      northAngle: 0,
      gradePoints: { g: gp(500, 500, 0) },
      columns: { c: { id: 'c', at: { x: 50, y: 30 }, width: 6, depth: 6, rotation: 0, base: 0, top: 96, kind: 'post', phase: 'existing' } },
      surfaces: {
        drive: { id: 'drive', ...surface({ outline: rect(0, 0, 400, 200) }) },
        pad: { id: 'pad', ...surface({ outline: rect(100, 100, 160, 160), material: 'concrete', phase: 'new' }) },
      },
      fences: { f: { id: 'f', ...fence({ points: [{ x: 0, y: 60 }, { x: 300, y: 60 }] }) } },
    };
    expect(hitSite(site, { x: 50, y: 30 }, 1)).toEqual({ kind: 'column', id: 'c' });
    expect(hitSite(site, { x: 200, y: 60 + FENCE_PICK_PX - 1 }, 1)).toEqual({ kind: 'fence', id: 'f' });
    expect(hitSite(site, { x: 200, y: 60 + FENCE_PICK_PX + 1 }, 1)).toEqual({ kind: 'surface', id: 'drive' });
    expect(hitSite(site, { x: 130, y: 130 }, 1)).toEqual({ kind: 'surface', id: 'pad' });
    expect(hitSite(site, { x: 130, y: 130 }, 1, 'existing')).toEqual({ kind: 'surface', id: 'drive' });
    expect(hitSite(site, { x: 600, y: 300 }, 1)).toBeNull();
    // Zoomed out the fence's pick band is wider in plan inches.
    expect(hitSite(site, { x: 200, y: 60 + 2 * FENCE_PICK_PX - 1 }, 0.5)).toEqual({ kind: 'fence', id: 'f' });
  });
});

describe('the surface and fence tools', () => {
  const ptr = (x: number, y: number): ToolPointerEvent => ({ world: { x, y }, screen: { x, y }, button: 0, shiftKey: false, altKey: false, modKey: false });
  const press = (key: string) => dispatchKey({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent);
  const click = (x: number, y: number) => {
    dispatchPointer('move', ptr(x, y));
    dispatchPointer('down', ptr(x, y));
    dispatchPointer('up', ptr(x, y));
  };

  it('A and Q only act in site mode', () => {
    const key = (k: string) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }) as KeyboardEvent;
    expect(bindingFor(key('a'))!.run!(key('a'))).toBe(false);
    expect(bindingFor(key('q'))!.run!(key('q'))).toBe(false);
    enterSiteMode();
    bindingFor(key('a'))!.run!(key('a'));
    expect(ui().activeTool).toBe('surface');
    bindingFor(key('q'))!.run!(key('q'));
    expect(ui().activeTool).toBe('fence');
  });

  it('the surface tool closes an outline into a surface; Tab steps the material first', () => {
    enterSiteMode();
    switchTool('surface');
    expect(nextSurfaceMaterial('gravel')).toBe('asphalt');
    expect(nextSurfaceMaterial('stone')).toBe('gravel');
    press('Tab');
    expect(ui().draft.surfaceMaterial).toBe('asphalt');
    click(-500, -500);
    click(-300, -500);
    click(-300, -400);
    press('Enter');
    const all = Object.values(plan().site.surfaces);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ material: 'asphalt', phase: ui().drawPhase });
    expect(surfaceArea(all[0])).toBe(200 * 100 / 2);
    expect(ui().selection.surfaces).toEqual([all[0].id]);
  });

  it('the fence tool draws an open polyline: Backspace drops the last point, Enter finishes, Esc cancels', () => {
    enterSiteMode();
    switchTool('fence');
    click(-500, -500);
    click(-500, -200);
    click(-400, -100);
    press('Backspace');
    expect(ui().draft.outlinePoints).toHaveLength(2);
    press('Enter');
    const all = Object.values(plan().site.fences);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ points: [{ x: -500, y: -500 }, { x: -500, y: -200 }], height: 42, rails: 2, postSpacing: 120 });
    click(-600, -600);
    press('Escape');
    expect(ui().draft.outlinePoints).toEqual([]);
    expect(Object.keys(plan().site.fences)).toHaveLength(1);
  });

  it('the site select tool drags a whole surface, box-selects fences wholly inside, and Delete removes them', () => {
    const s = store().addSurface(surface({ outline: rect(-600, -600, -500, -550) }))!;
    const f = store().addFence(fence({ points: [{ x: -700, y: -700 }, { x: -650, y: -700 }] }))!;
    enterSiteMode();
    switchTool('select');
    dispatchPointer('down', ptr(-550, -575));
    expect(ui().selection.surfaces).toEqual([s]);
    dispatchPointer('move', ptr(-540, -575));
    dispatchPointer('up', ptr(-540, -575));
    expect(plan().site.surfaces[s].outline[0]).toEqual({ x: -590, y: -600 });
    dispatchPointer('down', ptr(-720, -720));
    dispatchPointer('move', ptr(-640, -680));
    dispatchPointer('up', ptr(-640, -680));
    expect(ui().selection.fences).toEqual([f]);
    expect(ui().selection.surfaces).toEqual([]);
    press('Delete');
    expect(plan().site.fences).toEqual({});
    expect(Object.keys(plan().site.surfaces)).toEqual([s]);
  });
});

describe('export', () => {
  it('writes Surface and Fence meshes in the Site group with their material names', () => {
    store().addSurface(surface());
    store().addSurface(surface({ outline: rect(200, 0, 260, 60), material: 'asphalt', phase: 'new', color: '#202020' }));
    store().addFence(fence({ color: '#6b5a48' }));
    store().addFence(fence({ points: [{ x: 0, y: 100 }, { x: 100, y: 100 }], phase: 'demo' }));
    const root = buildExportScene(plan(), 'all', { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: defaultLevelId(plan()) });
    const site = root.children.find((c) => c.name === 'Site')!;
    const mats = (name: string) => site.children.filter((c) => c.name === name).map((c) => ((c as Mesh).material as MeshStandardMaterial).name);
    expect(mats('Surface')).toEqual(['surface_gravel_existing', 'surface_asphalt_new_202020']);
    expect(mats('Fence')).toEqual(['fence_existing_6b5a48', 'fence_end_existing_6b5a48', 'fence_demo', 'fence_end_demo']);
    // Without grade points there is no Terrain, but the surfaces still lie on the flat ground.
    expect(site.children.some((c) => c.name === 'Terrain')).toBe(false);
    disposeExportScene(root);
  });
});
