import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRoofGeometry, buildRoofParts, clearMeshCache, triangleCount } from '../derive/meshes';
import {
  distanceToBoundary,
  planesHeightAt,
  RAFTER_SETBACK,
  RAFTER_WIDTH,
  RIDGE_CAP_THICKNESS,
  RIDGE_CAP_WIDTH,
  ROOF_DEFAULTS,
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
import { pointInPolygon, polygonSignedArea, projectPointToSegment } from '../model/geometry';
import { boardColorOf, DEFAULT_RAFTER, DEFAULT_WEATHERING, rafterOf, roofEaveOf, TRIM_COLOR, weatheringOf } from '../model/finish';
import { createEmptyPlan, defaultLevelId, migrate, SCHEMA_VERSION } from '../model/plan';
import { clearHistory, undo, usePlanStore } from '../store/planStore';
import { EMPTY_SELECTION } from '../store/uiStore';
import { hitRoofHandle, hitTest } from '../editor2d/tools/selectTool';
import type { Roof, Vec2 } from '../model/types';
import { defaultRidgeAngle } from '../editor2d/tools/roofTool';
import { fasciaMaterial, rafterMaterial, roofMaterial } from '../view3d/materials';
import {
  METAL_RIBS,
  normalFromHeight,
  quantizeWeathering,
  RIB_DEPTH,
  ribHeight,
  ROOF_PX_ACROSS,
  ROOF_PX_DOWN,
  ROOF_SHINGLE_BUTT,
  roofHeight,
  roofShingleCourses,
  roofTexture,
  rustStreaks,
  TEXTURE_PX,
} from '../view3d/textures';

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

/** Plan and height extents of each solid (a rafter tail): x, Y up, plan y as z. */
function extents(solids: number[][]) {
  return solids.map((pos) => {
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      xs.push(pos[i]);
      ys.push(pos[i + 1]);
      zs.push(pos[i + 2]);
    }
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), minZ: Math.min(...zs), maxZ: Math.max(...zs), midX: (Math.min(...xs) + Math.max(...xs)) / 2 };
  });
}

describe('open eaves: rafter tails', () => {
  // 270" along the ridge (x) by 200" across it, 24" overhang: each eave is 318" long.
  const open = (over: Partial<Roof> = {}) => roof({ outline: rect(0, 0, 270, 200), eave: 'open', ...over });

  it('a 318" eave gets 13 tails 24" apart, the first centred 12" from the corner; no fascia along the eaves', () => {
    const solid = roofSolid(open(), B);
    expect(solid.rafters).toHaveLength(26);
    const tails = extents(solid.rafters);
    // The north eave runs west to east (the overhang outline is clockwise on screen): measured from its west corner.
    const north = tails.filter((t) => t.maxZ <= 1e-9).sort((a, b) => a.midX - b.midX);
    expect(north).toHaveLength(13);
    north.forEach((t, i) => expect(t.midX).toBeCloseTo(-24 + 12 + 24 * i, 9));
    // The south eave runs east to west: its first tail is 12" from the south-east corner.
    const south = tails.filter((t) => t.minZ >= 200 - 1e-9).sort((a, b) => b.midX - a.midX);
    expect(south).toHaveLength(13);
    south.forEach((t, i) => expect(t.midX).toBeCloseTo(270 + 24 - 12 - 24 * i, 9));
    for (const t of [...north, ...south]) {
      // 1.5" wide, from 1" inside the roof's edge back to the outline (the walls' outside faces).
      expect(t.maxX - t.minX).toBeCloseTo(RAFTER_WIDTH, 9);
      expect(t.maxZ - t.minZ).toBeCloseTo(24 - RAFTER_SETBACK, 9);
    }
    expect(Math.min(...north.map((t) => t.minZ))).toBeCloseTo(-24 + RAFTER_SETBACK, 9);
    expect(Math.max(...south.map((t) => t.maxZ))).toBeCloseTo(224 - RAFTER_SETBACK, 9);
    for (const pos of solid.rafters) {
      expect(closed(pos)).toBe(true);
      expect(volume(pos)).toBeGreaterThan(0);
    }
    // No board along the eaves: only the four rake boards (two per gable end) remain.
    expect(solid.boards).toHaveLength(4);
    for (const b of extents(solid.boards)) expect(b.maxZ - b.minZ).toBeGreaterThan(100);
  });

  it('a tail has its top on the roof underside and its bottom 5.5" lower', () => {
    const r = open();
    const { rafters } = roofSolid(r, B);
    for (const pos of rafters) {
      let tops = 0;
      let bottoms = 0;
      for (let i = 0; i < pos.length; i += 3) {
        const under = roofHeightAt(r, B, { x: pos[i], y: pos[i + 2] })!;
        if (Math.abs(pos[i + 1] - under) < 1e-9) tops++;
        else if (Math.abs(pos[i + 1] - (under - DEFAULT_RAFTER.depth)) < 1e-9) bottoms++;
      }
      expect(tops + bottoms).toBe(pos.length / 3);
      expect(tops).toBeGreaterThan(0);
      expect(bottoms).toBeGreaterThan(0);
    }
    // A deeper rafter at a closer spacing.
    const r2 = open({ rafter: { depth: 7.25, spacing: 16 } });
    const t2 = extents(roofSolid(r2, B).rafters);
    expect(t2).toHaveLength(2 * (Math.floor((318 - 8) / 16) + 1));
    const t = t2[0];
    const top = roofHeightAt(r2, B, { x: t.midX, y: -12 })!;
    expect(t.maxY - t.minY).toBeGreaterThan(7.25);
    expect(t.minY).toBeLessThan(top - 7.25 + 1e-9);
  });

  it('only where the roof descends toward a level edge: none on a flat roof, none on a shed\'s high edge', () => {
    const flat = roofSolid(open({ shape: 'flat' }), B);
    expect(flat.rafters).toHaveLength(0);
    expect(flat.boards).toHaveLength(4);
    // A shed sloping down to the north (-y): tails along the north eave only; the high south edge
    // keeps its fascia board and the two sides their rake boards.
    const shed = roofSolid(open({ shape: 'shed', ridgeAngle: 270, pitch: 3 }), B);
    expect(shed.rafters).toHaveLength(13);
    for (const t of extents(shed.rafters)) expect(t.maxZ).toBeLessThanOrEqual(1e-9);
    expect(shed.boards).toHaveLength(3);
    const high = extents(shed.boards).filter((b) => b.minZ > 200);
    expect(high).toHaveLength(1);
    // The default eaves keep their fascia boards and have no tails.
    const plain = roofSolid(roof({ outline: rect(0, 0, 270, 200) }), B);
    expect(plain.rafters).toHaveLength(0);
    expect(plain.boards).toHaveLength(6);
    // No tails without an overhang to hang them in.
    expect(roofSolid(open({ overhang: 1 }), B).rafters).toHaveLength(0);
  });

  it('on a hip roof every tail stays under its own slope: the ones near a corner are cut at the hip', () => {
    const r = roof({ shape: 'hip', eave: 'open' });
    const solid = roofSolid(r, B);
    // Every edge of a hip roof is an eave: tails all round and no boards.
    expect(solid.boards).toHaveLength(0);
    const perEdge = (len: number) => Math.floor((len - 12) / 24) + 1;
    expect(solid.rafters).toHaveLength(2 * perEdge(W + 48) + 2 * perEdge(D + 48));
    const planes = roofPlanes(r, B);
    let cut = 0;
    for (const pos of solid.rafters) {
      expect(closed(pos)).toBe(true);
      for (let i = 0; i < pos.length; i += 3) {
        // A tail running past a hip would have its top above the neighbouring slope's underside.
        expect(pos[i + 1]).toBeLessThanOrEqual(planesHeightAt(planes, { x: pos[i], y: pos[i + 2] }) + 1e-9);
      }
    }
    for (const t of extents(solid.rafters)) if (Math.min(t.maxX - t.minX, t.maxZ - t.minZ) < RAFTER_WIDTH + 1e-9 && Math.max(t.maxX - t.minX, t.maxZ - t.minZ) < 23 - 1e-6) cut++;
    // At least the tail nearest each end of each eave is cut short by its hip.
    expect(cut).toBeGreaterThanOrEqual(8);
  });

  it('the slab is the same whatever the eaves; the default roof keeps today\'s look', () => {
    const plain = roofSolid(roof(), B);
    const open2 = roofSolid(roof({ eave: 'open', boardColor: '#5a3a35', weathering: 0.8, rafter: { depth: 5.5, spacing: 16 } }), B);
    expect(open2.slab).toEqual(plain.slab);
    expect(roofEaveOf({})).toBe('fascia');
    expect(rafterOf({})).toEqual({ depth: 5.5, spacing: 24 });
    expect(boardColorOf({})).toBe(TRIM_COLOR);
    expect(weatheringOf({})).toBe(DEFAULT_WEATHERING);
    expect(DEFAULT_WEATHERING).toBe(0.35);
    // The roof tool's defaults add none of the new fields.
    for (const k of ['eave', 'rafter', 'boardColor', 'weathering']) expect(k in ROOF_DEFAULTS).toBe(false);
  });
});

describe('ridge cap', () => {
  /** Plan area of the faces that point up. */
  const upArea = (pos: number[]) =>
    tris(pos).reduce((s, [a, b, c]) => {
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      return ny > 1e-9 ? s + ny / 2 : s;
    }, 0);

  it('a metal gable: a 6" strip each side of the ridge for its whole length, 2.5" thick on the roof\'s top surface', () => {
    const r = roof();
    const { ridge } = roofSolid(r, B);
    expect(ridge.length).toBeGreaterThan(0);
    expect(closed(ridge)).toBe(true);
    expect(volume(ridge)).toBeGreaterThan(0);
    // Two strips of RIDGE_CAP_WIDTH along the ridge line, which runs over the overhang (W + 48).
    const [line] = roofRidgeLines(r);
    const length = Math.hypot(line[1].x - line[0].x, line[1].y - line[0].y);
    expect(length).toBeCloseTo(W + 48, 9);
    expect(upArea(ridge) / (2 * RIDGE_CAP_WIDTH)).toBeCloseTo(length, 6);
    const e = extents([ridge])[0];
    expect(e.maxX - e.minX).toBeCloseTo(length, 9);
    expect(e.minZ).toBeCloseTo(D / 2 - RIDGE_CAP_WIDTH, 9);
    expect(e.maxZ).toBeCloseTo(D / 2 + RIDGE_CAP_WIDTH, 9);
    // Bottom on the slab's top (underside + thickness), top 2.5" above it, following both slopes.
    for (let i = 0; i < ridge.length; i += 3) {
      const surface = roofHeightAt(r, B, { x: ridge[i], y: ridge[i + 2] })! + r.thickness;
      const above = ridge[i + 1] - surface;
      expect(Math.min(Math.abs(above), Math.abs(above - RIDGE_CAP_THICKNESS))).toBeLessThan(1e-9);
    }
    expect(e.maxY).toBeCloseTo(B + (D / 2) * (8 / 12) + r.thickness + RIDGE_CAP_THICKNESS, 9);
  });

  it('a metal hip: along the ridge and the four hips, mitred where they meet, one closed surface inside the outline', () => {
    const r = roof({ shape: 'hip' });
    const { ridge } = roofSolid(r, B);
    expect(closed(ridge)).toBe(true);
    expect(volume(ridge)).toBeGreaterThan(0);
    const lines = roofRidgeLines(r);
    expect(lines).toHaveLength(5);
    const over = roofOutlineWithOverhang(r);
    const total = lines.reduce((s, [p, q]) => s + Math.hypot(q.x - p.x, q.y - p.y), 0);
    for (let i = 0; i < ridge.length; i += 3) {
      const p = { x: ridge[i], y: ridge[i + 2] };
      expect(pointInPolygon(p, over) || distanceToBoundary(p, over) < 1e-6).toBe(true);
      expect(Math.min(...lines.map(([a, b]) => projectPointToSegment(p, a, b).distance))).toBeLessThanOrEqual(RIDGE_CAP_WIDTH + 1e-6);
    }
    // Mitred, neither overlapping nor leaving gaps: two strips' width along every line, less W^2 tan(22.5)
    // at each of the four hip-ridge corners (135 degrees inside), W^2 at each hip end's apex (90
    // degrees) and W^2 / 2 at each of the eight ends cut along the eave at 45 degrees.
    const loss = 4 * Math.tan(Math.PI / 8) + 2 * 1 + 8 * 0.5;
    expect((2 * RIDGE_CAP_WIDTH * total - upArea(ridge)) / RIDGE_CAP_WIDTH ** 2).toBeCloseTo(loss, 6);
  });

  it('no cap on a shingle roof, a shed or a flat roof; buildRoofGeometry and the slab leave it out', () => {
    expect(roofSolid(roof({ finish: 'shingle' }), B).ridge).toHaveLength(0);
    expect(roofSolid(roof({ shape: 'shed', ridgeAngle: 270, pitch: 3 }), B).ridge).toHaveLength(0);
    expect(roofSolid(roof({ shape: 'flat' }), B).ridge).toHaveLength(0);
    // The default metal gable: 20 slab triangles and 6 boards in one geometry, as before.
    expect(triangleCount(buildRoofGeometry(roof(), B))).toBe(20 + 6 * 12);
  });

  it('buildRoofParts merges the cap into the slab; boards and rafter tails are their own geometries', () => {
    const r = roof({ eave: 'open', outline: rect(0, 0, 270, 200) });
    const solid = roofSolid(r, B);
    const parts = buildRoofParts(r, B);
    expect(triangleCount(parts.slab)).toBe((solid.slab.length + solid.ridge.length) / 9);
    expect(triangleCount(parts.fascia!)).toBe(solid.boards.flat().length / 9);
    expect(triangleCount(parts.rafters!)).toBe(26 * 12);
    expect(parts.slab.getAttribute('uv').count).toBe(parts.slab.getAttribute('position').count);
    const shingle = buildRoofParts(roof({ finish: 'shingle' }), B);
    expect(shingle.rafters).toBeNull();
    expect(triangleCount(shingle.slab)).toBe(20);
  });
});

describe('roof UVs', () => {
  it('in tiles: a 24" wide gable spans one tile across, and 48" of slope per tile down it', () => {
    // 24" along the ridge, 96" across it, 12:12, no overhang: each slope is 48" in plan, 48 sqrt 2 along it.
    const r = roof({ outline: rect(0, 0, 24, 96), pitch: 12, overhang: 0, finish: 'shingle' });
    const g = buildRoofParts(r, B).slab;
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    const range = (pick: (i: number) => boolean, k: 0 | 1) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        if (!pick(i)) continue;
        const v = k === 0 ? uv.getX(i) : uv.getY(i);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      return hi - lo;
    };
    const northTop = (i: number) => nor.getY(i) > 0.5 && nor.getZ(i) < 0;
    const southTop = (i: number) => nor.getY(i) > 0.5 && nor.getZ(i) > 0;
    for (const top of [northTop, southTop]) {
      expect(range(top, 0)).toBeCloseTo(1, 6);
      expect(range(top, 1)).toBeCloseTo(Math.SQRT2, 6);
    }
    // The eave's edge face: 24" along it, `thickness` tall.
    const eaveFace = (i: number) => Math.abs(nor.getY(i)) < 0.5 && nor.getZ(i) < -0.99;
    expect(range(eaveFace, 0)).toBeCloseTo(1, 6);
    expect(range(eaveFace, 1)).toBeCloseTo(r.thickness / 48, 6);
    // Every face is mapped without stretch: 24" per unit of u, 48" per unit of v, along the surface.
    for (let i = 0; i < pos.count; i += 3) {
      for (const [a, b] of [[i, i + 1], [i + 1, i + 2], [i + 2, i]]) {
        const d3 = Math.hypot(pos.getX(b) - pos.getX(a), pos.getY(b) - pos.getY(a), pos.getZ(b) - pos.getZ(a));
        const d2 = Math.hypot((uv.getX(b) - uv.getX(a)) * 24, (uv.getY(b) - uv.getY(a)) * 48);
        expect(d2).toBeCloseTo(d3, 3);
      }
    }
  });

  it('down the slope on every plane of a hip roof, and along the frame on a flat roof', () => {
    for (const r of [roof({ shape: 'hip' }), roof({ shape: 'flat' }), roof({ ridgeAngle: 30 })]) {
      const g = buildRoofParts(r, B).slab;
      const pos = g.getAttribute('position');
      const uv = g.getAttribute('uv');
      for (let i = 0; i < pos.count; i += 3) {
        for (const [a, b] of [[i, i + 1], [i + 1, i + 2]]) {
          const d3 = Math.hypot(pos.getX(b) - pos.getX(a), pos.getY(b) - pos.getY(a), pos.getZ(b) - pos.getZ(a));
          const d2 = Math.hypot((uv.getX(b) - uv.getX(a)) * 24, (uv.getY(b) - uv.getY(a)) * 48);
          expect(d2, r.shape).toBeCloseTo(d3, 3);
        }
      }
    }
  });
});

describe('roof textures and materials', () => {
  it('corrugated metal: 9 ribs across a 24" tile, 1/2" deep, the same all the way down; the tile repeats seamlessly', () => {
    const row = Array.from({ length: TEXTURE_PX }, (_, c) => ribHeight(c));
    const crests = row.filter((h, c) => h > row[(c + TEXTURE_PX - 1) % TEXTURE_PX] && h >= row[(c + 1) % TEXTURE_PX]);
    expect(crests).toHaveLength(METAL_RIBS);
    expect(Math.max(...row)).toBeCloseTo(RIB_DEPTH, 3);
    expect(Math.min(...row)).toBeCloseTo(0, 3);
    // Across the tile's edge the profile continues: column -1 is column 511.
    expect(ribHeight(-1)).toBeCloseTo(ribHeight(TEXTURE_PX - 1), 9);
    expect(TEXTURE_PX / ROOF_PX_ACROSS / METAL_RIBS).toBeCloseTo(24 / 9, 9);
    const h = roofHeight('metal');
    for (const r of [0, 100, TEXTURE_PX - 1]) expect(Array.from(h.subarray(r * TEXTURE_PX, (r + 1) * TEXTURE_PX))).toEqual(Array.from(h.subarray(0, TEXTURE_PX)));
    // Its normal map tilts across the ribs only (G flat, R either side of 128).
    const n = normalFromHeight(h, TEXTURE_PX, ROOF_PX_ACROSS, undefined, ROOF_PX_DOWN);
    const rs = new Set<number>();
    for (let i = 0; i < TEXTURE_PX * 4; i += 4) {
      expect(n[i + 1]).toBe(128);
      rs.add(n[i]);
    }
    expect(Math.min(...rs)).toBeLessThan(110);
    expect(Math.max(...rs)).toBeGreaterThan(146);
  });

  it('rust streaks: the same layout at every weathering, opacity in proportion to it; none at 0', () => {
    const none = rustStreaks(0);
    const half = rustStreaks(0.5);
    const full = rustStreaks(1);
    expect(none.length).toBeGreaterThan(10);
    expect(none.every((s) => s.alpha === 0)).toBe(true);
    full.forEach((s, i) => {
      expect({ ...half[i], alpha: 0 }).toEqual({ ...s, alpha: 0 });
      expect(s.alpha).toBeCloseTo(2 * half[i].alpha, 9);
      expect(s.alpha).toBeGreaterThan(0);
      expect(s.alpha).toBeLessThanOrEqual(1);
      expect(s.x).toBeGreaterThanOrEqual(-0.5);
      expect(s.x).toBeLessThanOrEqual(24.5);
    });
    // Fasteners rust in every third crest, two rows a tile.
    expect(full.filter((s) => s.spot)).toHaveLength(6);
    expect(quantizeWeathering(0.33)).toBe(0.35);
    expect(quantizeWeathering(0.62)).toBe(0.6);
    expect(quantizeWeathering(1.4)).toBe(1);
    expect(quantizeWeathering(-1)).toBe(0);
    expect(quantizeWeathering(NaN)).toBe(0);
  });

  it('asphalt shingles: 10 courses of 4.8" down the tile, 12" tabs, alternate courses offset half a tab; each butt a step', () => {
    const courses = roofShingleCourses();
    expect(courses).toHaveLength(10);
    courses.forEach((c, k) => {
      expect(c.s1 - c.s0).toBeCloseTo(4.8, 9);
      expect(c.slots).toEqual(k % 2 ? [6, 18] : [0, 12]);
    });
    const h = roofHeight('shingle');
    // Down the canvas (uphill) across a butt the height jumps up from nothing to the butt's thickness.
    const col = Math.round(3 * ROOF_PX_ACROSS);
    const buttRow = TEXTURE_PX - Math.round(courses[4].s1 * ROOF_PX_DOWN);
    expect(h[(buttRow - 1) * TEXTURE_PX + col]).toBeLessThan(0.02);
    expect(h[buttRow * TEXTURE_PX + col]).toBeGreaterThan(ROOF_SHINGLE_BUTT - 0.02);
  });

  it('no canvas in node: roofTexture is null and the material shows the flat colour', () => {
    expect(roofTexture('metal', '#8a8378', 0.6)).toBeNull();
    const m = roofMaterial('metal', 'existing', '#8a8378', 0.6);
    expect(m.map).toBeNull();
    expect(m.color.getHexString()).toBe('8a8378');
  });

  it('roof materials are shared per finish, phase, colour and weathering to the nearest 0.05; metal has a slight sheen', () => {
    const m = roofMaterial('metal', 'existing', '#8a8378', 0.6);
    expect(roofMaterial('metal', 'existing', '#8a8378', 0.61)).toBe(m);
    expect(roofMaterial('metal', 'existing', '#8a8378', 0.7)).not.toBe(m);
    expect(roofMaterial('metal', 'existing', '#6e4b3c', 0.6)).not.toBe(m);
    expect(roofMaterial('metal', 'new', '#8a8378', 0.6)).not.toBe(m);
    expect(m.metalness).toBeCloseTo(0.35, 9);
    expect(m.roughness).toBeCloseTo(0.55, 9);
    // Weathering means nothing to shingles, nor to a new roof (it is not rusty yet).
    expect(roofMaterial('shingle', 'existing', '#4a4a4a', 0.1)).toBe(roofMaterial('shingle', 'existing', '#4a4a4a', 0.9));
    expect(roofMaterial('metal', 'new', '#8a8378', 0.1)).toBe(roofMaterial('metal', 'new', '#8a8378', 0.9));
    // The default weathering.
    expect(roofMaterial('metal', 'existing', '#8a8378')).toBe(roofMaterial('metal', 'existing', '#8a8378', DEFAULT_WEATHERING));
    // Demolished: translucent red; new: pulled toward green.
    const demo = roofMaterial('metal', 'demo', '#8a8378', 0.6);
    expect(demo.transparent).toBe(true);
    expect(demo.color.getHexString()).toBe('e0413a');
    const fresh = roofMaterial('metal', 'new', '#8a8378', 0.6).color;
    expect(fresh.g).toBeGreaterThan(fresh.r);
  });

  it('fascia, rake boards and rafter tails take the board colour, tan by default', () => {
    expect(fasciaMaterial('existing').color.getHexString()).toBe(TRIM_COLOR.slice(1));
    const brown = fasciaMaterial('existing', '#5a3a35');
    expect(brown.color.getHexString()).toBe('5a3a35');
    expect(fasciaMaterial('existing', '#5a3a35')).toBe(brown);
    expect(brown).not.toBe(fasciaMaterial('existing'));
    expect(rafterMaterial('existing', '#5a3a35').color.getHexString()).toBe('5a3a35');
    expect(rafterMaterial('existing').color.getHexString()).toBe(TRIM_COLOR.slice(1));
    expect(rafterMaterial('demo', '#5a3a35').color.getHexString()).toBe('e0413a');
    expect(rafterMaterial('new', '#5a3a35').color.getHexString()).not.toBe('5a3a35');
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
  it('migrates a v1 file to the current schema with empty roofs and a default site', () => {
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
    expect(plan.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(3);
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

  /** A v2 file with one roof carrying `extra` fields. */
  const roofFile = (extra: Record<string, unknown>) => ({
    schemaVersion: 2,
    id: 'p',
    name: 'Eaves',
    levelOrder: ['l1'],
    levels: { l1: { id: 'l1', name: 'First', wallHeight: 96, floorThickness: 12, nodes: {}, walls: {}, openings: {}, rooms: {}, stairs: {}, roofs: { r1: { ...roof(), ...extra } } } },
    baseFloorElevation: 0,
    settings: {},
    site: { northAngle: 0, gradePoints: {}, columns: {} },
    modifiedAt: '2025-01-01T00:00:00.000Z',
  });
  const good = { eave: 'open', rafter: { depth: 5.5, spacing: 24 }, boardColor: '#5a3a35', weathering: 0.6 };

  it('keeps the eave, rafter, board colour and weathering fields after the colour, and round-trips them byte for byte', () => {
    const plan = migrate(roofFile({ color: '#8a8378', ...good }));
    const r = plan.levels.l1.roofs.r1;
    expect(r).toMatchObject({ color: '#8a8378', ...good });
    expect(Object.keys(r).slice(-5)).toEqual(['color', 'eave', 'rafter', 'boardColor', 'weathering']);
    const text = JSON.stringify(plan, null, 2);
    expect(JSON.stringify(migrate(JSON.parse(text)), null, 2)).toBe(text);
    // The board colour is lower-cased, a rafter is rebuilt from depth and spacing only.
    const loose = migrate(roofFile({ boardColor: '#5A3A35', rafter: { spacing: 16, depth: 3.5, extra: 1 } })).levels.l1.roofs.r1;
    expect(loose.boardColor).toBe('#5a3a35');
    expect(loose.rafter).toEqual({ depth: 3.5, spacing: 16 });
    expect(Object.keys(loose.rafter!)).toEqual(['depth', 'spacing']);
    expect(migrate(roofFile({ eave: 'fascia', weathering: 0 })).levels.l1.roofs.r1).toMatchObject({ eave: 'fascia', weathering: 0 });
  });

  it('drops each malformed eave field alone, keeping the roof and the other fields', () => {
    const bad: [keyof typeof good, unknown][] = [
      ['eave', 'closed'],
      ['eave', 1],
      ['rafter', { depth: 0, spacing: 24 }],
      ['rafter', { depth: 5.5 }],
      ['rafter', { depth: 5.5, spacing: -24 }],
      ['rafter', { depth: Infinity, spacing: 24 }],
      ['rafter', '2x6'],
      ['boardColor', 'brown'],
      ['boardColor', '#5a3a3'],
      ['weathering', 1.5],
      ['weathering', -0.1],
      ['weathering', '0.5'],
      ['weathering', NaN],
    ];
    for (const [k, v] of bad) {
      const r = migrate(roofFile({ ...good, [k]: v })).levels.l1.roofs.r1;
      expect(k in r, `${k}: ${String(v)}`).toBe(false);
      for (const other of Object.keys(good) as (keyof typeof good)[]) if (other !== k) expect(r[other]).toEqual(good[other]);
    }
    // A file without them loads without them.
    const plain = migrate(roofFile({})).levels.l1.roofs.r1;
    for (const k of Object.keys(good)) expect(k in plain).toBe(false);
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

  it('updateRoof sets the eaves, rafter, board colour and weathering, refuses bad values and clears them with undefined', () => {
    const lid = defaultLevelId(store().plan);
    const id = store().addRoof(lid, input)!;
    const r = () => store().plan.levels[lid].roofs[id];
    expect(Object.keys(r())).not.toContain('eave');
    store().updateRoof(lid, id, { eave: 'open', rafter: { depth: 3.5, spacing: 16 }, boardColor: '#5A3A35', weathering: 0.6 });
    expect(r()).toMatchObject({ eave: 'open', rafter: { depth: 3.5, spacing: 16 }, boardColor: '#5a3a35', weathering: 0.6 });
    // The same rafter as a new object is no change.
    const before = store().plan;
    store().updateRoof(lid, id, { rafter: { depth: 3.5, spacing: 16 } });
    expect(store().plan).toBe(before);
    const refused: Partial<Roof>[] = [{ weathering: 1.2 }, { weathering: -1 }, { rafter: { depth: 0, spacing: 24 } }, { rafter: { depth: 5.5, spacing: NaN } }, { eave: 'closed' as Roof['eave'] }, { boardColor: 'brown' }, { color: 'grey' }];
    for (const patch of refused) {
      store().updateRoof(lid, id, patch);
      expect(store().plan, JSON.stringify(patch)).toBe(before);
    }
    expect(store().addRoof(lid, { ...input, weathering: 3 })).toBeNull();
    store().updateRoof(lid, id, { eave: undefined, rafter: undefined, boardColor: undefined, weathering: undefined });
    for (const k of ['eave', 'rafter', 'boardColor', 'weathering']) expect(k in r()).toBe(false);
    undo();
    expect(r()).toMatchObject({ eave: 'open', weathering: 0.6 });
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
