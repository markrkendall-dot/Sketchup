import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRoofGeometry, clearMeshCache, triangleCount } from '../derive/meshes';
import {
  distanceToBoundary,
  roofExtremes,
  roofHeightAt,
  roofOutlineWithOverhang,
  roofPlanes,
  roofRegions,
  roofRidgeLines,
  roofSolid,
  slopedPrismPositions,
  triangulate,
  wallRoofProfile,
} from '../derive/roofs';
import { polygonSignedArea } from '../model/geometry';
import { createEmptyPlan, defaultLevelId, migrate, SCHEMA_VERSION } from '../model/plan';
import { clearHistory, undo, usePlanStore } from '../store/planStore';
import { EMPTY_SELECTION } from '../store/uiStore';
import { hitRoofHandle, hitTest } from '../editor2d/tools/selectTool';
import type { Roof, Vec2 } from '../model/types';
import { defaultRidgeAngle } from '../editor2d/tools/roofTool';

type V3 = [number, number, number];

function tris(pos: number[]): [V3, V3, V3][] {
  const out: [V3, V3, V3][] = [];
  for (let i = 0; i < pos.length; i += 9) {
    out.push([
      [pos[i], pos[i + 1], pos[i + 2]],
      [pos[i + 3], pos[i + 4], pos[i + 5]],
      [pos[i + 6], pos[i + 7], pos[i + 8]],
    ]);
  }
  return out;
}

/** Every edge shared by exactly two triangles in opposite directions (vertices rounded to 1e-4). */
function closed(pos: number[]): boolean {
  const key = (v: V3) => v.map((c) => Math.round(c * 1e4)).join(',');
  const count = new Map<string, number>();
  for (const t of tris(pos)) {
    for (let i = 0; i < 3; i++) {
      const a = key(t[i]);
      const b = key(t[(i + 1) % 3]);
      if (a === b) continue;
      count.set(`${a}>${b}`, (count.get(`${a}>${b}`) ?? 0) + 1);
    }
  }
  for (const [k, n] of count) {
    const [a, b] = k.split('>');
    if (count.get(`${b}>${a}`) !== n || n !== 1) return false;
  }
  return count.size > 0;
}

/** Signed volume (positive when every face points out). */
function volume(pos: number[]): number {
  let v = 0;
  for (const [a, b, c] of tris(pos)) {
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** The main block: 26.5' x 25.5' outside faces. */
const W = 26.5 * 12;
const D = 25.5 * 12;
const B = 96;
const roof = (over: Partial<Roof> = {}): Roof => ({
  id: 'r1',
  shape: 'gable',
  outline: rect(0, 0, W, D),
  ridgeAngle: 0,
  pitch: 8,
  overhang: 24,
  bearingOffset: 0,
  thickness: 8,
  fascia: 6,
  phase: 'existing',
  finish: 'metal',
  ...over,
});

beforeEach(() => clearMeshCache());

describe('gable roof planes', () => {
  it('ridge height of a 26.5\' x 25.5\' block with the ridge along x at 8:12', () => {
    const r = roof();
    const ridge = B + ((25.5 * 12) / 2) * (8 / 12);
    expect(roofHeightAt(r, B, { x: W / 2, y: D / 2 })).toBeCloseTo(ridge, 9);
    expect(roofHeightAt(r, B, { x: 10, y: D / 2 })).toBeCloseTo(ridge, 9);
    expect(roofExtremes(r, B).ridge).toBeCloseTo(ridge, 9);
    expect(roofExtremes(r, B).eave).toBeCloseTo(B - 24 * (8 / 12), 9);
    expect(roofPlanes(r, B)).toHaveLength(2);
  });

  it('the underside is at the bearing height on the eave line and lower by overhang * pitch / 12 at the overhang edge', () => {
    const r = roof();
    expect(roofHeightAt(r, B, { x: W / 2, y: 0 })).toBeCloseTo(B, 9);
    expect(roofHeightAt(r, B, { x: W / 2, y: D })).toBeCloseTo(B, 9);
    expect(roofHeightAt(r, B, { x: W / 2, y: -24 })).toBeCloseTo(B - (24 * 8) / 12, 9);
    expect(roofHeightAt(r, B, { x: W / 2, y: D + 24 })).toBeCloseTo(B - (24 * 8) / 12, 9);
    // Outside the overhang: no roof.
    expect(roofHeightAt(r, B, { x: W / 2, y: -25 })).toBeNull();
    expect(roofHeightAt(r, B, { x: W + 25, y: D / 2 })).toBeNull();
    // The rake overhang continues the slope.
    expect(roofHeightAt(r, B, { x: -24, y: 0 })).toBeCloseTo(B, 9);
  });

  it('a ridge angle of 90 swaps which edges are eaves', () => {
    const r = roof({ ridgeAngle: 90 });
    expect(roofHeightAt(r, B, { x: 0, y: D / 2 })).toBeCloseTo(B, 9);
    expect(roofHeightAt(r, B, { x: W, y: D / 2 })).toBeCloseTo(B, 9);
    expect(roofHeightAt(r, B, { x: W / 2, y: 0 })).toBeCloseTo(B + (W / 2) * (8 / 12), 9);
    expect(roofHeightAt(r, B, { x: -24, y: D / 2 })).toBeCloseTo(B - 16, 9);
    const ridge = roofRidgeLines(r);
    expect(ridge).toHaveLength(1);
    for (const p of ridge[0]) expect(p.x).toBeCloseTo(W / 2, 9);
  });

  it('the ridge line runs over the overhang, along x through the middle', () => {
    const lines = roofRidgeLines(roof());
    expect(lines).toHaveLength(1);
    const xs = lines[0].map((p) => p.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-24, 9);
    expect(xs[1]).toBeCloseTo(W + 24, 9);
    for (const p of lines[0]) expect(p.y).toBeCloseTo(D / 2, 9);
  });

  it('defaults the ridge along the longer side of the outline', () => {
    expect(defaultRidgeAngle(rect(0, 0, W, D))).toBe(0);
    expect(defaultRidgeAngle(rect(0, 0, 144, 168))).toBe(90);
  });
});

describe('shed, hip and flat roofs', () => {
  it('a shed slopes down in the ridgeAngle direction', () => {
    // A porch 12' x 8' sloping down to the north (-y, up the screen), 3:12.
    const porch = roof({ shape: 'shed', outline: rect(0, 0, 144, 96), ridgeAngle: 270, pitch: 3 });
    expect(roofHeightAt(porch, B, { x: 72, y: 0 })).toBeCloseTo(B, 9);
    expect(roofHeightAt(porch, B, { x: 72, y: 96 })).toBeCloseTo(B + 96 * 0.25, 9);
    expect(roofHeightAt(porch, B, { x: 72, y: -24 })).toBeCloseTo(B - 6, 9);
    expect(roofHeightAt(porch, B, { x: 72, y: 50 })!).toBeGreaterThan(roofHeightAt(porch, B, { x: 72, y: 40 })!);
    // ridgeAngle 0: down toward +x.
    const east = roof({ shape: 'shed', ridgeAngle: 0 });
    expect(roofHeightAt(east, B, { x: W, y: 10 })).toBeCloseTo(B, 9);
    expect(roofHeightAt(east, B, { x: 0, y: 10 })).toBeCloseTo(B + W * (8 / 12), 9);
    expect(roofRidgeLines(porch)).toHaveLength(0);
    expect(roofExtremes(porch, B).ridge).toBeCloseTo(B + 24, 9);
  });

  it('a hip roof rises from all four eaves; hips run from the corners at 45 degrees', () => {
    const k = 8 / 12;
    const r = roof({ shape: 'hip' });
    expect(roofHeightAt(r, B, { x: 0, y: 0 })).toBeCloseTo(B, 9);
    expect(roofHeightAt(r, B, { x: W, y: D })).toBeCloseTo(B, 9);
    expect(roofHeightAt(r, B, { x: -24, y: -24 })).toBeCloseTo(B - 24 * k, 9);
    expect(roofHeightAt(r, B, { x: 50, y: 50 })).toBeCloseTo(B + 50 * k, 9);
    expect(roofHeightAt(r, B, { x: 100, y: D / 2 })).toBeCloseTo(B + 100 * k, 9);
    expect(roofHeightAt(r, B, { x: W / 2, y: D / 2 })).toBeCloseTo(B + (D / 2) * k, 9);
    // One ridge and four hips.
    const lines = roofRidgeLines(r);
    expect(lines).toHaveLength(5);
    const ridge = lines.find(([p, q]) => Math.abs(p.y - q.y) < 1e-6)!;
    expect(Math.abs(ridge[0].x - ridge[1].x)).toBeCloseTo(W - D, 6);
    // A non-rectangular outline is roofed over its bounding rectangle.
    const ell = roof({ shape: 'hip', outline: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 200 }, { x: 0, y: 200 }] });
    expect(roofHeightAt(ell, B, { x: 150, y: 150 })).toBeCloseTo(B + 50 * k, 9);
  });

  it('a flat roof is level at the bearing height', () => {
    const r = roof({ shape: 'flat' });
    expect(roofHeightAt(r, B, { x: 30, y: 40 })).toBe(B);
    expect(roofHeightAt(r, B, { x: -20, y: D + 20 })).toBe(B);
    expect(roofRegions(r, B)).toHaveLength(1);
    expect(roofRidgeLines(r)).toHaveLength(0);
    // A bearing offset lifts it.
    expect(roofHeightAt(roof({ shape: 'flat', bearingOffset: 12 }), B + 12, { x: 1, y: 1 })).toBe(B + 12);
  });
});

describe('the overhang outline', () => {
  it('grows a rotated rectangle by the overhang on every side, for a rotated ridge too', () => {
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const rot = (p: Vec2) => ({ x: 500 + p.x * c - p.y * s, y: 300 + p.x * s + p.y * c });
    const base = rect(0, 0, 200, 120).map(rot);
    for (const r of [roof({ outline: base, ridgeAngle: 30 }), roof({ outline: [...base].reverse(), ridgeAngle: 30 })]) {
      const grown = roofOutlineWithOverhang(r);
      expect(grown).toHaveLength(4);
      expect(Math.abs(polygonSignedArea(grown))).toBeCloseTo(248 * 168, 6);
      // Every grown corner is 24" out from both edges at its base corner.
      for (const p of grown) expect(distanceToBoundary(p, base)).toBeCloseTo(24 * Math.SQRT2, 6);
      // The eaves (along the rotated ridge) are at the bearing height, the overhang below.
      expect(roofHeightAt(r, B, rot({ x: 100, y: 0 }))).toBeCloseTo(B, 6);
      expect(roofHeightAt(r, B, rot({ x: 100, y: 120 }))).toBeCloseTo(B, 6);
      expect(roofHeightAt(r, B, rot({ x: 100, y: -24 }))).toBeCloseTo(B - 16, 6);
      expect(roofHeightAt(r, B, rot({ x: -24, y: 60 }))).toBeCloseTo(B + 60 * (8 / 12), 6);
      expect(roofHeightAt(r, B, rot({ x: 100, y: -25 }))).toBeNull();
    }
  });

  it('no overhang: the outline itself', () => {
    const r = roof({ overhang: 0 });
    expect(Math.abs(polygonSignedArea(roofOutlineWithOverhang(r)))).toBeCloseTo(W * D, 6);
  });
});

describe('roof solid', () => {
  it('a gable: the slab and every board are closed; the triangle count is small', () => {
    const r = roof();
    const solid = roofSolid(r, B);
    expect(closed(solid.slab)).toBe(true);
    // Two planes: top and bottom of each half (2 triangles each), 3 side quads per half.
    expect(solid.slab.length / 9).toBe(20);
    expect(volume(solid.slab)).toBeCloseTo((W + 48) * (D + 48) * 8, 0);
    // Two fascia boards (eaves) and four rake boards (two per gable end).
    expect(solid.boards).toHaveLength(6);
    for (const b of solid.boards) {
      expect(closed(b)).toBe(true);
      expect(b.length / 9).toBe(12);
      expect(volume(b)).toBeGreaterThan(0);
    }
    const g = buildRoofGeometry(r, B);
    expect(triangleCount(g)).toBe(20 + 6 * 12);
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const ridge = B + (D / 2) * (8 / 12);
    expect(bb.max.y).toBeCloseTo(ridge + 8, 3);
    expect(bb.min.y).toBeCloseTo(B - 16, 3);
    // Plan (x, y) maps to three (x, Y, y); the boards stand 1.5" proud of the overhang edge.
    expect(bb.min.x).toBeCloseTo(-24 - 1.5, 3);
    expect(bb.max.z).toBeCloseTo(D + 24 + 1.5, 3);
  });

  it('hip, shed, flat and an L-shaped gable are closed too', () => {
    const ell: Vec2[] = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 150 }, { x: 150, y: 150 }, { x: 150, y: 300 }, { x: 0, y: 300 }];
    for (const r of [roof({ shape: 'hip' }), roof({ shape: 'shed', ridgeAngle: 270, pitch: 3 }), roof({ shape: 'flat' }), roof({ outline: ell }), roof({ shape: 'hip', outline: rect(0, 0, 200, 200) })]) {
      const solid = roofSolid(r, B);
      expect(closed(solid.slab), r.shape).toBe(true);
      expect(volume(solid.slab)).toBeGreaterThan(0);
      expect(solid.boards.length).toBeGreaterThan(0);
      for (const b of solid.boards) expect(closed(b), r.shape).toBe(true);
    }
  });

  it('every face points out of the slab', () => {
    const solid = roofSolid(roof(), B);
    const c: V3 = [W / 2, B + 40, D / 2];
    for (const [a, b, d] of tris(solid.slab)) {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const m = [(a[0] + b[0] + d[0]) / 3 - c[0], (a[1] + b[1] + d[1]) / 3 - c[1], (a[2] + b[2] + d[2]) / 3 - c[2]];
      // The slab is thin and convex in plan per half: faces point away from a point between them,
      // except the undersides, which point down.
      if (n[1] < -1e-9) continue;
      expect(n[0] * m[0] + n[1] * m[1] + n[2] * m[2]).toBeGreaterThan(0);
    }
  });
});

describe('sloped prisms and triangulation', () => {
  it('triangulates a non-convex polygon with a collinear point, keeping it as a corner', () => {
    const poly: Vec2[] = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 }];
    const t = triangulate(poly);
    expect(t).toHaveLength(poly.length - 2);
    const area = t.reduce((s, [i, j, k]) => s + polygonSignedArea([poly[i], poly[j], poly[k]]), 0);
    expect(area).toBeCloseTo(polygonSignedArea(poly), 9);
    expect(t.some((tri) => tri.includes(1))).toBe(true);
  });

  it('a wedge (zero height at one end) is closed and leaves out the zero-height faces', () => {
    const pos = slopedPrismPositions(rect(0, 0, 100, 10), () => 0, (p) => p.x / 10);
    expect(closed(pos)).toBe(true);
    expect(volume(pos)).toBeCloseTo(100 * 10 * 5, 6);
  });
});

describe('wall top profiles', () => {
  const line = (a: Vec2, b: Vec2, t = 6.5) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const normal = { x: dir.y, y: -dir.x };
    const h = t / 2;
    const poly = [
      { x: a.x + normal.x * h - dir.x * h, y: a.y + normal.y * h - dir.y * h },
      { x: b.x + normal.x * h + dir.x * h, y: b.y + normal.y * h + dir.y * h },
      { x: b.x - normal.x * h + dir.x * h, y: b.y - normal.y * h + dir.y * h },
      { x: a.x - normal.x * h - dir.x * h, y: a.y - normal.y * h - dir.y * h },
    ];
    return { a, dir, normal, thickness: t, length: len, poly };
  };
  // Walls on the centerlines of the 26.5' x 25.5' block (outside faces at 0..W, 0..D).
  const h = 3.25;
  const r = roof();

  it('a gable end rises to the ridge with one peak; an eave wall stays at the plate', () => {
    const gable = wallRoofProfile(line({ x: W - h, y: h }, { x: W - h, y: D - h }), B, [{ roof: r, bearing: B }])!;
    expect(gable.s).toHaveLength(3);
    expect(gable.h[0]).toBeCloseTo(B, 9);
    expect(gable.h[2]).toBeCloseTo(B, 9);
    expect(gable.h[1]).toBeCloseTo(B + (D / 2) * (8 / 12), 9);
    expect(gable.s[1]).toBeCloseTo(D / 2 - h, 9);
    expect(wallRoofProfile(line({ x: h, y: h }, { x: W - h, y: h }), B, [{ roof: r, bearing: B }])).toBeNull();
  });

  it('a wall outside the roof outline, or with no roofs, is not raised', () => {
    expect(wallRoofProfile(line({ x: -100, y: 0 }, { x: -100, y: 200 }), B, [{ roof: r, bearing: B }])).toBeNull();
    expect(wallRoofProfile(line({ x: W - h, y: h }, { x: W - h, y: D - h }), B, [])).toBeNull();
  });

  it('the walls under a shed: the low eave stays, the sides slope, the high wall rises level', () => {
    const shed = roof({ shape: 'shed', outline: rect(0, 0, 144, 96), ridgeAngle: 270, pitch: 3 });
    const on = [{ roof: shed, bearing: B }];
    expect(wallRoofProfile(line({ x: h, y: h }, { x: 144 - h, y: h }), B, on)).toBeNull();
    const high = wallRoofProfile(line({ x: h, y: 96 - h }, { x: 144 - h, y: 96 - h }), B, on)!;
    expect(high.s).toHaveLength(2);
    expect(high.h[0]).toBeCloseTo(B + 24, 9);
    expect(high.h[1]).toBeCloseTo(B + 24, 9);
    const sideWall = wallRoofProfile(line({ x: 144 - h, y: h }, { x: 144 - h, y: 96 - h }), B, on)!;
    expect(sideWall.h[0]).toBeCloseTo(B, 9);
    expect(sideWall.h[sideWall.h.length - 1]).toBeCloseTo(B + 24, 9);
  });
});

describe('loading roofs', () => {
  it('migrates a v1 file to v2 with empty roofs and a default site', () => {
    const v1 = {
      schemaVersion: 1,
      id: 'p',
      name: 'Old',
      levelOrder: ['l1'],
      levels: { l1: { id: 'l1', name: 'First', wallHeight: 96, floorThickness: 12, nodes: {}, walls: {}, openings: {}, rooms: {}, stairs: {} } },
      baseFloorElevation: 0,
      settings: {},
      modifiedAt: '2025-01-01T00:00:00.000Z',
    };
    const plan = migrate(v1);
    expect(plan.schemaVersion).toBe(2);
    expect(SCHEMA_VERSION).toBe(2);
    expect(plan.levels.l1.roofs).toEqual({});
    expect(plan.site).toEqual({ northAngle: 0, gradePoints: {}, columns: {} });
  });

  it('keeps a valid roof field by field and drops broken ones with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = { ...roof(), extra: 1 };
    const file = {
      schemaVersion: 2,
      id: 'p',
      name: 'Roofs',
      levelOrder: ['l1'],
      levels: {
        l1: {
          id: 'l1',
          name: 'First',
          wallHeight: 96,
          floorThickness: 12,
          nodes: {},
          walls: {},
          openings: {},
          rooms: {},
          stairs: {},
          roofs: {
            r1: good,
            bad1: { ...roof(), shape: 'dome' },
            bad2: { ...roof(), outline: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
            bad3: { ...roof(), pitch: -2 },
            bad4: 'nope',
            r5: { ...roof(), phase: 'bogus', finish: 'thatch' },
          },
        },
      },
      baseFloorElevation: 0,
      settings: {},
      site: { northAngle: 15, gradePoints: { g: { id: 'g', at: { x: 1, y: 2 }, elevation: -10 }, bad: { at: 3 } }, columns: {} },
      modifiedAt: '2025-01-01T00:00:00.000Z',
    };
    const plan = migrate(file);
    expect(Object.keys(plan.levels.l1.roofs)).toEqual(['r1', 'r5']);
    expect(plan.levels.l1.roofs.r1).toEqual(roof());
    expect(plan.levels.l1.roofs.r5).toMatchObject({ phase: 'existing', finish: 'metal' });
    expect(warn).toHaveBeenCalledTimes(4);
    expect(String(warn.mock.calls[0][0])).toMatch(/dropped roof bad1/);
    expect(plan.site.northAngle).toBe(15);
    expect(Object.keys(plan.site.gradePoints)).toEqual(['g']);
    warn.mockRestore();
  });
});

describe('roof store actions and picking', () => {
  const store = () => usePlanStore.getState();
  beforeEach(() => {
    store().setPlan(createEmptyPlan());
    clearHistory();
  });
  const { id: _id, ...input } = roof();
  void _id;

  it('adds, patches (one undo step each), phases and deletes roofs', () => {
    const lid = defaultLevelId(store().plan);
    const id = store().addRoof(lid, { ...input, ridgeAngle: -90 })!;
    expect(id).toBeTruthy();
    expect(store().plan.levels[lid].roofs[id].ridgeAngle).toBe(270);
    expect(store().addRoof(lid, { ...input, outline: input.outline.slice(0, 2) })).toBeNull();
    expect(store().addRoof(lid, { ...input, pitch: -1 })).toBeNull();
    const before = store().plan;
    store().updateRoof(lid, id, { pitch: -3 });
    expect(store().plan).toBe(before);
    store().updateRoof(lid, id, { pitch: 8 }); // unchanged: no new state
    expect(store().plan).toBe(before);
    store().updateRoof(lid, id, { shape: 'hip', overhang: 12 });
    expect(store().plan.levels[lid].roofs[id]).toMatchObject({ shape: 'hip', overhang: 12 });
    undo();
    expect(store().plan.levels[lid].roofs[id]).toMatchObject({ shape: 'gable', overhang: 24 });
    store().setPhase(lid, { walls: [], openings: [], roofs: [id] }, 'demo');
    expect(store().plan.levels[lid].roofs[id].phase).toBe('demo');
    store().deleteEntities(lid, { ...EMPTY_SELECTION, roofs: [id] });
    expect(store().plan.levels[lid].roofs).toEqual({});
  });

  it('the select tool picks a roof inside its overhang when nothing else is hit, and a selected roof\'s corners', () => {
    const lid = defaultLevelId(store().plan);
    store().addWall(lid, { x: 3.25, y: 3.25 }, { x: W - 3.25, y: 3.25 }, { kind: 'exterior', thickness: 6.5, phase: 'existing' });
    const id = store().addRoof(lid, input)!;
    const level = store().plan.levels[lid];
    expect(hitTest(level, { x: W / 2, y: D / 2 }, 1)).toEqual({ kind: 'roof', id });
    expect(hitTest(level, { x: W / 2, y: -20 }, 1)).toEqual({ kind: 'roof', id });
    expect(hitTest(level, { x: W / 2, y: -30 }, 1)).toBeNull();
    expect(hitTest(level, { x: W / 2, y: 4 }, 1)?.kind).toBe('wall');
    // A demolished roof is not picked in the proposed view.
    store().setPhase(lid, { walls: [], openings: [], roofs: [id] }, 'demo');
    expect(hitTest(store().plan.levels[lid], { x: W / 2, y: D / 2 }, 1, 'proposed')).toBeNull();
    expect(hitRoofHandle(store().plan.levels[lid], [id], { x: W + 3, y: D - 2 }, 1)).toEqual({ id, index: 2 });
    expect(hitRoofHandle(store().plan.levels[lid], [id], { x: W / 2, y: D }, 1)).toBeNull();
  });
});
