import { produce } from 'immer';
import type { BufferGeometry } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { computeFootprints } from '../derive/footprint';
import {
  buildFloorGeometry,
  buildStairsGeometry,
  buildWallGeometry,
  clearMeshCache,
  mergeAll,
  getLevelMeshes,
  prism,
  slabOutlines,
  triangleCount,
  wallSpans,
} from '../derive/meshes';
import { getFaces } from '../derive/rooms';
import { floorToFloor, stairsOutline, stairSteps } from '../derive/stairs';
import { clipHalfPlane, halfPlaneCrossings, polygonSignedArea } from '../model/geometry';
import { createEmptyPlan, createLevel } from '../model/plan';
import type { Level, Opening, Phase, Plan, Stairs, Vec2, Wall } from '../model/types';

type V3 = [number, number, number];

/** Triangles of a non-indexed geometry. */
function triangles(g: BufferGeometry): [V3, V3, V3][] {
  const p = g.getAttribute('position');
  const out: [V3, V3, V3][] = [];
  for (let i = 0; i < p.count; i += 3) {
    const v = (k: number): V3 => [p.getX(i + k), p.getY(i + k), p.getZ(i + k)];
    out.push([v(0), v(1), v(2)]);
  }
  return out;
}

const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const centroid3 = (t: [V3, V3, V3]): V3 => [0, 1, 2].map((k) => (t[0][k] + t[1][k] + t[2][k]) / 3) as V3;
const faceNormal = (t: [V3, V3, V3]) => cross3(sub3(t[1], t[0]), sub3(t[2], t[0]));

/** Number of triangles a ray from o along d crosses (Moller-Trumbore); odd means o is inside. */
function rayHits(g: BufferGeometry, o: V3, d: V3): number {
  let n = 0;
  for (const [a, b, c] of triangles(g)) {
    const e1 = sub3(b, a);
    const e2 = sub3(c, a);
    const p = cross3(d, e2);
    const det = dot3(e1, p);
    if (Math.abs(det) < 1e-12) continue;
    const t0 = sub3(o, a);
    const u = dot3(t0, p) / det;
    if (u < 0 || u > 1) continue;
    const q = cross3(t0, e1);
    const v = dot3(d, q) / det;
    if (v < 0 || u + v > 1) continue;
    if (dot3(e2, q) / det > 1e-9) n++;
  }
  return n;
}
/** Inside test with a slightly skewed ray so it never grazes an edge. */
const inside = (g: BufferGeometry, p: V3) => rayHits(g, p, [0.0123, 0.0071, 1]) % 2 === 1;

/** Signed volume (divergence theorem); positive when every face points out. */
function volume(g: BufferGeometry): number {
  let v = 0;
  for (const [a, b, c] of triangles(g)) v += dot3(a, cross3(b, c)) / 6;
  return v;
}

/**
 * True when every edge of the mesh is shared by exactly two triangles in opposite directions
 * (a closed, consistently wound surface). Vertices are matched after rounding to 1e-4.
 */
function closedEdges(g: BufferGeometry): boolean {
  const key = (v: V3) => v.map((c) => Math.round(c * 1e4)).join(',');
  const count = new Map<string, number>();
  for (const t of triangles(g)) {
    for (let i = 0; i < 3; i++) {
      const a = key(t[i]);
      const b = key(t[(i + 1) % 3]);
      if (a === b) continue;
      count.set(`${a}>${b}`, (count.get(`${a}>${b}`) ?? 0) + 1);
    }
  }
  const bad: string[] = [];
  for (const [k, n] of count) {
    const [a, b] = k.split('>');
    if (count.get(`${b}>${a}`) !== n) bad.push(k);
  }
  return bad.length === 0;
}

/** Area of the faces whose normal points up (+Y). */
function upArea(g: BufferGeometry): number {
  let s = 0;
  for (const t of triangles(g)) {
    const n = faceNormal(t);
    if (n[1] > 1e-9 && Math.abs(n[0]) < 1e-9 && Math.abs(n[2]) < 1e-9) s += n[1] / 2;
  }
  return s;
}

function bbox(g: BufferGeometry) {
  g.computeBoundingBox();
  const b = g.boundingBox!;
  return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
}

function build(nodes: Record<string, Vec2>, walls: [string, string, number?, Phase?][]): Level {
  const l = createLevel('t', 96, 12);
  for (const [id, p] of Object.entries(nodes)) l.nodes[id] = { id, x: p.x, y: p.y };
  walls.forEach(([a, b, t = 6.5, phase = 'existing'], i) => {
    const w: Wall = { id: `w${i}`, a, b, thickness: t, kind: 'exterior', phase };
    l.walls[w.id] = w;
  });
  return l;
}

const opening = (wallId: string, o: Partial<Opening>): Opening => ({
  id: o.id ?? 'o1',
  wallId,
  type: 'window',
  offset: 60,
  width: 36,
  height: 48,
  sill: 36,
  phase: 'existing',
  ...o,
});

beforeEach(() => clearMeshCache());

describe('prism', () => {
  const square: Vec2[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  for (const [name, poly] of [
    ['clockwise on screen', square],
    ['counter-clockwise on screen', [...square].reverse()],
  ] as const) {
    it(`unit square (${name}): 12 triangles, every face normal points away from the centroid`, () => {
      const g = prism(poly, 0, 1);
      expect(triangleCount(g)).toBe(12);
      const c: V3 = [0.5, 0.5, 0.5];
      for (const t of triangles(g)) {
        const n = faceNormal(t);
        expect(Math.hypot(...n)).toBeGreaterThan(0);
        expect(dot3(n, sub3(centroid3(t), c))).toBeGreaterThan(0);
      }
      expect(volume(g)).toBeCloseTo(1, 9);
      // The stored normals agree with the winding.
      const nrm = g.getAttribute('normal');
      triangles(g).forEach((t, i) => {
        const n = faceNormal(t);
        const len = Math.hypot(...n);
        expect(nrm.getX(i * 3) * len).toBeCloseTo(n[0], 6);
        expect(nrm.getY(i * 3) * len).toBeCloseTo(n[1], 6);
        expect(nrm.getZ(i * 3) * len).toBeCloseTo(n[2], 6);
      });
    });
  }

  it('maps plan (x, y) to three (x, Y, y)', () => {
    const g = prism([{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 50 }], 5, 7);
    expect(bbox(g)).toEqual({ min: [10, 5, 20], max: [30, 7, 50] });
  });

  it('a non-convex polygon with a hole is closed and outward facing', () => {
    const L: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 40, y: 40 },
      { x: 40, y: 100 },
      { x: 0, y: 100 },
    ];
    const hole: Vec2[] = [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 10, y: 20 },
    ];
    for (const h of [hole, [...hole].reverse()]) {
      const g = prism([...L].reverse(), 0, 10, [h]);
      const area = 100 * 40 + 40 * 60 - 100;
      expect(volume(g)).toBeCloseTo(area * 10, 6);
      expect(upArea(g)).toBeCloseTo(area, 6);
      expect(inside(g, [15, 5, 15])).toBe(false);
      expect(inside(g, [30, 5, 30])).toBe(true);
      expect(inside(g, [70, 5, 70])).toBe(false);
    }
  });

  it('degenerate input gives an empty geometry', () => {
    expect(triangleCount(prism([{ x: 0, y: 0 }, { x: 1, y: 0 }], 0, 1))).toBe(0);
    expect(triangleCount(prism([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], 1, 1))).toBe(0);
  });
});

describe('half-plane clipping', () => {
  const quad: Vec2[] = [
    { x: 0, y: -3 },
    { x: 120, y: -3 },
    { x: 120, y: 3 },
    { x: 0, y: 3 },
  ];
  it('clips a quad at x <= 42', () => {
    const p = clipHalfPlane(quad, { x: 1, y: 0 }, 42);
    expect(Math.abs(polygonSignedArea(p))).toBeCloseTo(42 * 6, 9);
    expect(halfPlaneCrossings(quad, { x: 1, y: 0 }, 42)).toBe(2);
  });
  it('counts crossings of a non-convex outline', () => {
    const comb: Vec2[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 6, y: 10 },
      { x: 6, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(halfPlaneCrossings(comb, { x: 0, y: 1 }, 7)).toBe(4);
    expect(halfPlaneCrossings(comb, { x: 0, y: 1 }, 2)).toBe(2);
  });
});

describe('walls with openings', () => {
  // A free-standing 10' wall along +x: square caps at both ends.
  const level = build({ p: { x: 0, y: 0 }, q: { x: 120, y: 0 } }, [['p', 'q']]);
  const wall = level.walls.w0;
  const fp = computeFootprints(level, 'all').get('w0')!;
  const win = opening('w0', {});

  it('a window cuts the wall into start, under-sill, header and end pieces', () => {
    const spans = wallSpans(fp, wall, [win], 96);
    expect(spans.map((s) => s.solid)).toEqual([[[0, 96]], [[0, 36], [84, 96]], [[0, 96]]]);
    const g = buildWallGeometry(fp, wall, [win], 96);
    // Bands 0-36-84-96. Start and end pieces: 3 bands x (2 long sides + end cap) + the jamb face
    // between sill and head + bottom and top caps: 9 quads + 2 caps = 12 x 2 = 24 triangles each.
    // Under-sill and header: 2 long sides + bottom and top = 8 each. Faces between pieces and bands
    // are internal and not emitted.
    expect(triangleCount(g)).toBe(24 + 8 + 8 + 24);
    expect(bbox(g)).toEqual({ min: [0, 0, -3.25], max: [120, 96, 3.25] });
    expect(volume(g)).toBeCloseTo((120 * 96 - 36 * 48) * 6.5, 3);
  });

  it('the opening is empty, below the sill and above the head are solid', () => {
    const g = buildWallGeometry(fp, wall, [win], 96);
    const m = 1e-3;
    for (const t of triangles(g)) {
      const [x, y] = centroid3(t);
      expect(x > 42 + m && x < 78 - m && y > 36 + m && y < 84 - m).toBe(false);
    }
    expect(inside(g, [60, 60, 0])).toBe(false);
    expect(inside(g, [60, 18, 0])).toBe(true);
    expect(inside(g, [60, 90, 0])).toBe(true);
    expect(inside(g, [20, 60, 0])).toBe(true);
    expect(inside(g, [100, 60, 0])).toBe(true);
  });

  it('a demolished opening in the proposed view leaves a solid wall, like no opening', () => {
    const plain = buildWallGeometry(fp, wall, [], 96, 'proposed');
    const demo = buildWallGeometry(fp, wall, [opening('w0', { phase: 'demo' })], 96, 'proposed');
    expect(triangleCount(plain)).toBe(12);
    expect(triangleCount(demo)).toBe(triangleCount(plain));
    expect(inside(demo, [60, 60, 0])).toBe(true);
    // ...and is cut in the existing view.
    expect(inside(buildWallGeometry(fp, wall, [opening('w0', { phase: 'demo' })], 96, 'existing'), [60, 60, 0])).toBe(false);
  });

  it('a new opening is not cut in the existing view', () => {
    const g = buildWallGeometry(fp, wall, [opening('w0', { phase: 'new' })], 96, 'existing');
    expect(triangleCount(g)).toBe(12);
    expect(inside(buildWallGeometry(fp, wall, [opening('w0', { phase: 'new' })], 96, 'proposed'), [60, 60, 0])).toBe(false);
  });

  it('a window taller than the wall loses its header piece', () => {
    const g = buildWallGeometry(fp, wall, [opening('w0', { sill: 60, height: 60 })], 96);
    // Start/end: band 0-60 (bottom, 3 sides) + band 60-96 (top, 3 sides, jamb) = 18; sill piece 8.
    expect(triangleCount(g)).toBe(18 + 8 + 18);
    expect(volume(g)).toBeCloseTo((120 * 96 - 36 * 36) * 6.5, 3);
    expect(inside(g, [60, 90, 0])).toBe(false);
  });
});

describe('a door at the end of a wall near an L corner', () => {
  // w0 runs +x to the corner at (120, 0), w1 runs +y from it. The door on w1 is pushed to the
  // corner: the store clamps it to the inside face of w0 (s0 = 3.25).
  const level = build({ p: { x: 0, y: 0 }, q: { x: 120, y: 0 }, r: { x: 120, y: 120 } }, [
    ['p', 'q'],
    ['q', 'r'],
  ]);
  const fps = computeFootprints(level, 'all');
  const f0 = fps.get('w0')!;
  const f1 = fps.get('w1')!;
  const door = opening('w1', { type: 'door', offset: 0, width: 36, height: 80, sill: 0, swing: { hinge: 'a', side: 'left' } });
  // As getLevelMeshes builds them: level-wide bands, each wall knows its neighbour's height.
  const ctx = { bands: [0, 80, 96] };
  const g0 = buildWallGeometry(f0, level.walls.w0, [], 96, 'all', { ...ctx, endHeights: { a: 0, b: 96 } });
  const g1 = buildWallGeometry(f1, level.walls.w1, [door], 96, 'all', { ...ctx, endHeights: { a: 96, b: 0 } });

  /** Both walls as one mesh: each alone is open at the mitre (the join face is internal). */
  const both = mergeAll([g0.clone(), g1.clone()]);

  it('cuts start wedge, header and end pieces; no under-sill piece', () => {
    expect(f1.s0).toBe(3.25);
    // Start wedge (the triangle of the mitre): band 0-80 bottom + outer face + jamb = 5, band 80-96
    // top + outer face = 3. Header: 8. End piece: band 0-80 bottom, 2 long, open cap, jamb = 10;
    // band 80-96 top, 2 long, cap = 8.
    expect(triangleCount(g1)).toBe(8 + 8 + 18);
    // The mitre face is internal: no triangle lies on the diagonal from the outer to the inner corner.
    for (const t of triangles(g1)) {
      const onDiag = t.every(([x, , z]) => Math.abs(x - 120 - (z === undefined ? 0 : -z)) < 1e-4);
      expect(onDiag).toBe(false);
    }
  });

  it('the start piece keeps the mitred corner: both walls share the corner points', () => {
    const pts = (g: BufferGeometry) => {
      const p = g.getAttribute('position');
      const s = new Set<string>();
      for (let i = 0; i < p.count; i++) s.add(`${p.getX(i)},${p.getZ(i)}`);
      return s;
    };
    for (const corner of ['123.25,-3.25', '116.75,3.25']) {
      expect(pts(g0).has(corner)).toBe(true);
      expect(pts(g1).has(corner)).toBe(true);
    }
    expect(bbox(g1).max[0]).toBe(123.25);
    expect(bbox(g1).min[2]).toBe(-3.25);
  });

  it('the door hole starts at the inside face of the corner', () => {
    // Along w1, s = z. Between the node and the inside face of w0: solid at door height.
    expect(inside(both, [120, 40, 1])).toBe(true);
    expect(inside(both, [120, 40, 5])).toBe(false);
    expect(inside(both, [120, 40, 38])).toBe(false);
    expect(inside(both, [120, 40, 41])).toBe(true);
    expect(inside(both, [120, 90, 20])).toBe(true);
    // The corner itself (in the outer mitre wedge) is solid at full height.
    expect(inside(both, [122, 50, -2])).toBe(true);
    expect(inside(both, [100, 50, 0])).toBe(true);
  });

  it('the two walls together are watertight: their volume is the solid', () => {
    const area = Math.abs(polygonSignedArea(f0.poly)) + Math.abs(polygonSignedArea(f1.poly));
    expect(volume(both)).toBeCloseTo(area * 96 - 36 * 80 * 6.5, 3);
    expect(closedEdges(both)).toBe(true);
  });
});

/** A plan whose First Floor is a closed 20' x 20' box; the basement may have stairs. */
function boxPlan(stairs?: Partial<Stairs>): { plan: Plan; basement: Level; first: Level } {
  const plan = createEmptyPlan();
  const [b, f] = plan.levelOrder;
  const first = plan.levels[f];
  const nodes = { a: { x: 0, y: 0 }, b: { x: 240, y: 0 }, c: { x: 240, y: 240 }, d: { x: 0, y: 240 } };
  for (const [id, p] of Object.entries(nodes)) first.nodes[id] = { id, ...p };
  (['ab', 'bc', 'cd', 'da'] as const).forEach((pair, i) => {
    first.walls[`w${i}`] = { id: `w${i}`, a: pair[0], b: pair[1], thickness: 6.5, kind: 'exterior', phase: 'existing' };
  });
  if (stairs) {
    const s: Stairs = { id: 's1', origin: { x: 60, y: 200 }, direction: 270, width: 36, run: 120, phase: 'existing', cutsFloorAbove: true, ...stairs };
    plan.levels[b].stairs[s.id] = s;
  }
  return { plan, basement: plan.levels[b], first };
}

describe('floor slabs', () => {
  it('the slab reaches the exterior wall faces and has the stair hole', () => {
    const { first } = boxPlan();
    const faces = getFaces(first, 'all');
    const outline = slabOutlines(faces)[0];
    expect(Math.abs(polygonSignedArea(outline))).toBeCloseTo(246.5 * 246.5, 6);
    const hole = stairsOutline({ origin: { x: 60, y: 200 }, direction: 270, width: 36, run: 120 });
    const plain = buildFloorGeometry(faces, [], 12)!;
    const holed = buildFloorGeometry(faces, [hole], 12)!;
    expect(upArea(plain)).toBeCloseTo(246.5 * 246.5, 3);
    expect(upArea(holed)).toBeCloseTo(246.5 * 246.5 - 36 * 120, 3);
    expect(volume(holed)).toBeCloseTo((246.5 * 246.5 - 36 * 120) * 12, 1);
    expect(holed.getAttribute('position').count).toBeGreaterThan(plain.getAttribute('position').count);
    expect(bbox(holed)).toEqual({ min: [-3.25, -12, -3.25], max: [243.25, 0, 243.25] });
    // Inside the hole is open; beside it is slab.
    expect(inside(holed, [60, -6, 140])).toBe(false);
    expect(inside(holed, [120, -6, 140])).toBe(true);
  });

  it('a hole that does not fit inside the slab is ignored', () => {
    const { first } = boxPlan();
    const faces = getFaces(first, 'all');
    const out = stairsOutline({ origin: { x: 230, y: 100 }, direction: 0, width: 36, run: 120 });
    expect(upArea(buildFloorGeometry(faces, [out], 12)!)).toBeCloseTo(246.5 * 246.5, 3);
  });

  it('no closed outer face, no slab', () => {
    const level = build({ p: { x: 0, y: 0 }, q: { x: 120, y: 0 }, r: { x: 120, y: 120 } }, [
      ['p', 'q'],
      ['q', 'r'],
    ]);
    expect(buildFloorGeometry(getFaces(level, 'all'), [], 12)).toBeNull();
  });

  it('stairs below with cutsFloorAbove cut the slab of the level above', () => {
    const { plan, first } = boxPlan({});
    const withHole = getLevelMeshes(plan, first.id, 'all').floor!;
    expect(upArea(withHole)).toBeCloseTo(246.5 * 246.5 - 36 * 120, 3);
    const noCut = boxPlan({ cutsFloorAbove: false });
    expect(upArea(getLevelMeshes(noCut.plan, noCut.first.id, 'all').floor!)).toBeCloseTo(246.5 * 246.5, 3);
    // New stairs do not cut the existing floor.
    const newStairs = boxPlan({ phase: 'new' });
    expect(upArea(getLevelMeshes(newStairs.plan, newStairs.first.id, 'existing').floor!)).toBeCloseTo(246.5 * 246.5, 3);
  });
});

describe('stairs', () => {
  it('one step per riser, the top flush with the floor above', () => {
    const { plan, basement } = boxPlan({});
    const ftf = floorToFloor(plan, basement.id);
    expect(ftf).toBe(96 + 12);
    const { risers, rise } = stairSteps(ftf);
    expect(risers).toBe(14);
    const s = basement.stairs.s1;
    const g = buildStairsGeometry(s, rise, risers);
    // One stepped profile (2n + 2 points) extruded across: 2n + 2 side quads plus the two profile
    // caps (earcut drops degenerate triangles along the collinear inner corners).
    expect(triangleCount(g)).toBeGreaterThan(2 * (2 * risers + 2));
    expect(triangleCount(g)).toBeLessThanOrEqual(2 * (2 * risers) + 2 * (2 * risers + 2));
    const d = 120 / risers;
    expect(volume(g)).toBeCloseTo((36 * d * rise * risers * (risers + 1)) / 2, 1); // float32 positions
    for (const t of triangles(g)) {
      const n = faceNormal(t);
      const c = centroid3(t);
      // Side profiles face across the flight (x here), treads up, risers toward the bottom (+z).
      if (Math.abs(n[0]) > 1e-9) expect(Math.sign(n[0])).toBe(Math.sign(c[0] - 60));
      if (Math.abs(n[1]) > 1e-9 && Math.abs(n[0]) < 1e-9 && c[1] > 1e-6) expect(n[1]).toBeGreaterThan(0);
    }
    const b = bbox(g);
    expect(b.min[0]).toBeCloseTo(42, 9);
    expect(b.max[0]).toBeCloseTo(78, 9);
    expect(b.min[2]).toBeCloseTo(80, 9);
    expect(b.max[2]).toBeCloseTo(200, 9);
    expect(b.max[1]).toBeCloseTo(108, 9);
    // Low at the origin end, high at the far end.
    expect(inside(g, [60, rise / 2, 199])).toBe(true);
    expect(inside(g, [60, rise * 3, 199])).toBe(false);
    expect(inside(g, [60, 100, 81])).toBe(true);
    const meshes = getLevelMeshes(plan, basement.id, 'all');
    expect(meshes.stairs).toHaveLength(1);
    expect(triangleCount(meshes.stairs[0].geometry)).toBe(triangleCount(g));
  });
});

describe('a level of walls is one watertight solid', () => {
  it('box with a T divider, a window and a door: all walls together are closed, no internal faces', () => {
    const { plan, first } = boxPlan();
    first.nodes.m = { id: 'm', x: 0, y: 120 };
    first.nodes.n = { id: 'n', x: 240, y: 120 };
    // Split the side walls at the divider like normalize() does, then add the divider.
    first.walls.w1 = { ...first.walls.w1, b: 'n' };
    first.walls.w1b = { ...first.walls.w1, id: 'w1b', a: 'n', b: 'c' };
    first.walls.w3 = { ...first.walls.w3, b: 'm' };
    first.walls.w3b = { ...first.walls.w3, id: 'w3b', a: 'm', b: 'a' };
    first.walls.div = { id: 'div', a: 'm', b: 'n', thickness: 4.5, kind: 'interior', phase: 'existing' };
    first.openings.win = opening('w0', { id: 'win', offset: 100 });
    first.openings.door = opening('w2', { id: 'door', type: 'door', offset: 60, height: 80, sill: 0 });
    const m = getLevelMeshes(plan, first.id, 'all');
    expect(m.walls).toHaveLength(7);
    const all = mergeAll(m.walls.map((w) => w.geometry.clone()));
    expect(closedEdges(all)).toBe(true);
    const fps = computeFootprints(first, 'all');
    const area = [...fps.values()].reduce((sum, f) => sum + Math.abs(polygonSignedArea(f.poly)), 0);
    expect(volume(all)).toBeCloseTo(area * 96 - 36 * 48 * 6.5 - 36 * 80 * 6.5, 0);
    // No face lies inside a wall: every triangle centroid is on the outer surface of the union.
    for (const t of triangles(all)) {
      const c = centroid3(t);
      const n = faceNormal(t);
      const len = Math.hypot(...n);
      const out: V3 = [c[0] + (n[0] / len) * 0.05, c[1] + (n[1] / len) * 0.05, c[2] + (n[2] / len) * 0.05];
      expect(inside(all, out)).toBe(false);
    }
  });
});

describe('joins between walls of different heights', () => {
  it('the taller wall shows its mitre face above the shorter one; together they are closed', () => {
    const level = build({ p: { x: 0, y: 0 }, q: { x: 120, y: 0 }, r: { x: 120, y: 120 } }, [
      ['p', 'q'],
      ['q', 'r'],
    ]);
    level.walls.w1.heightOverride = 120;
    const plan = createEmptyPlan();
    const id = plan.levelOrder[1];
    plan.levels[id] = { ...level, id };
    const m = getLevelMeshes(plan, id, 'all');
    const both = mergeAll(m.walls.map((w) => w.geometry.clone()));
    expect(closedEdges(both)).toBe(true);
    const fps = computeFootprints(level, 'all');
    const vol = Math.abs(polygonSignedArea(fps.get('w0')!.poly)) * 96 + Math.abs(polygonSignedArea(fps.get('w1')!.poly)) * 120;
    expect(volume(both)).toBeCloseTo(vol, 2);
  });
});

describe('joins with a demolished (translucent) wall', () => {
  it('an opaque wall keeps its join face where a translucent wall meets it', () => {
    const level = build({ p: { x: 0, y: 0 }, q: { x: 120, y: 0 }, r: { x: 120, y: 120 } }, [
      ['p', 'q'],
      ['q', 'r', 6.5, 'demo'],
    ]);
    const plan = createEmptyPlan();
    const id = plan.levelOrder[1];
    plan.levels[id] = { ...level, id };
    const m = getLevelMeshes(plan, id, 'all');
    const g0 = m.walls.find((w) => w.id === 'w0')!.geometry;
    // w0 alone is closed: its mitre face is emitted.
    expect(closedEdges(g0)).toBe(true);
    // The translucent wall is closed too (its own mitre face shows through it).
    expect(closedEdges(m.walls.find((w) => w.id === 'w1')!.geometry)).toBe(true);
  });

  it('a through wall keeps the face under a translucent butt wall', () => {
    const { plan, first } = boxPlan();
    first.nodes.m = { id: 'm', x: 0, y: 120 };
    first.nodes.n = { id: 'n', x: 240, y: 120 };
    first.walls.w1 = { ...first.walls.w1, b: 'n' };
    first.walls.w1b = { ...first.walls.w1, id: 'w1b', a: 'n', b: 'c' };
    first.walls.w3 = { ...first.walls.w3, b: 'm' };
    first.walls.w3b = { ...first.walls.w3, id: 'w3b', a: 'm', b: 'a' };
    first.walls.div = { id: 'div', a: 'm', b: 'n', thickness: 4.5, kind: 'interior', phase: 'demo' };
    const m = getLevelMeshes(plan, first.id, 'all');
    const opaque = mergeAll(m.walls.filter((w) => w.phase !== 'demo').map((w) => w.geometry.clone()));
    // The opaque walls alone are a closed shell: nothing is missing behind the translucent divider.
    expect(closedEdges(opaque)).toBe(true);
    expect(closedEdges(m.walls.find((w) => w.id === 'div')!.geometry)).toBe(true);
  });
});

describe('getLevelMeshes memoization', () => {
  /** First Floor box plus a free-standing wall far away. */
  function plan2() {
    const { plan, first } = boxPlan();
    first.nodes.x = { id: 'x', x: 600, y: 0 };
    first.nodes.y = { id: 'y', x: 720, y: 0 };
    first.walls.free = { id: 'free', a: 'x', b: 'y', thickness: 4.5, kind: 'interior', phase: 'existing' };
    first.openings.o1 = opening('w0', {});
    return { plan, id: first.id };
  }

  it('returns the same object while nothing changed', () => {
    const { plan, id } = plan2();
    const m1 = getLevelMeshes(plan, id, 'all');
    expect(getLevelMeshes(plan, id, 'all')).toBe(m1);
    expect(m1.walls).toHaveLength(5);
    expect(m1.floor).toBeDefined();
  });

  it('moving one wall rebuilds only that wall', () => {
    const { plan, id } = plan2();
    const m1 = getLevelMeshes(plan, id, 'all');
    const geo = (m: typeof m1, wid: string) => m.walls.find((w) => w.id === wid)!.geometry;
    const before = Object.fromEntries(m1.walls.map((w) => [w.id, w.geometry]));
    const moved = produce(plan, (d) => {
      d.levels[id].nodes.y.x = 760;
    });
    const m2 = getLevelMeshes(moved, id, 'all');
    expect(m2).not.toBe(m1);
    expect(geo(m2, 'free')).not.toBe(before.free);
    expect(bbox(geo(m2, 'free')).max[0]).toBe(760);
    for (const wid of ['w0', 'w1', 'w2', 'w3']) expect(geo(m2, wid)).toBe(before[wid]);
    // The floor did not change either.
    expect(m2.floor).toBe(m1.floor);
  });

  it('moving a box corner rebuilds the walls whose outline changed and the slab', () => {
    const { plan, id } = plan2();
    const m1 = getLevelMeshes(plan, id, 'all');
    const moved = produce(plan, (d) => {
      d.levels[id].nodes.c.x = 260; // c joins w1 (b-c) and w2 (c-d)
    });
    const m2 = getLevelMeshes(moved, id, 'all');
    const same = (wid: string) => m2.walls.find((w) => w.id === wid)!.geometry === m1.walls.find((w) => w.id === wid)!.geometry;
    expect(same('free')).toBe(true);
    expect(same('w1')).toBe(false);
    expect(same('w2')).toBe(false);
    expect(m2.floor).not.toBe(m1.floor);
  });

  it('view modes have their own meshes; a demolished wall has none in the proposed view', () => {
    const { plan, id } = plan2();
    const demo = produce(plan, (d) => {
      d.levels[id].walls.free.phase = 'demo';
    });
    expect(getLevelMeshes(demo, id, 'all').walls.map((w) => w.id)).toContain('free');
    expect(getLevelMeshes(demo, id, 'proposed').walls.map((w) => w.id)).not.toContain('free');
    expect(getLevelMeshes(demo, id, 'existing').walls.find((w) => w.id === 'free')?.phase).toBe('demo');
  });

  it('a window wall has more triangles than a plain wall', () => {
    const { plan, id } = plan2();
    const m = getLevelMeshes(plan, id, 'all');
    const tri = (wid: string) => triangleCount(m.walls.find((w) => w.id === wid)!.geometry);
    expect(tri('w0')).toBeGreaterThan(tri('w1'));
  });
});

