import { beforeEach, describe, expect, it } from 'vitest';
import { polylabel, pointToPolygonDistance } from '../derive/polylabel';
import { computeFaceGeometry, getFaces, insetPolygon, roomDimensions } from '../derive/rooms';
import { polygonSignedArea } from '../model/geometry';
import { createEmptyPlan, createLevel, defaultLevelId } from '../model/plan';
import type { Level, Phase, Vec2 } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';

const store = () => usePlanStore.getState();
const levelId = () => defaultLevelId(store().plan);
const level = (): Level => store().plan.levels[levelId()];
const ext = { kind: 'exterior', thickness: 6.5, phase: 'existing' } as const;

/** Closed loop of walls through the points. */
function loop(points: Vec2[], opts: { thickness?: number; phase?: Phase } = {}): void {
  const o = { ...ext, ...opts };
  points.forEach((p, i) => store().addWall(levelId(), p, points[(i + 1) % points.length], o));
}

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
});

describe('winding convention (pinned first)', () => {
  it('one rectangle: one interior face with positive area, outer face negative', () => {
    // Built by hand so nothing but the tracer is involved.
    const l = createLevel('t', 96, 12);
    const pts = rect(0, 0, 120, 96);
    pts.forEach((p, i) => (l.nodes[`n${i}`] = { id: `n${i}`, ...p }));
    pts.forEach((_, i) => {
      l.walls[`w${i}`] = { id: `w${i}`, a: `n${i}`, b: `n${(i + 1) % 4}`, thickness: 6, kind: 'exterior', phase: 'existing' };
    });
    const geo = computeFaceGeometry(l, 'all');
    expect(geo.faces).toHaveLength(1);
    const f = geo.faces[0];
    // Exact: 120 x 96 centerline rectangle.
    expect(polygonSignedArea(f.polygon)).toBe(11520);
    expect(f.grossArea).toBe(11520);
    // Clockwise on screen (y down): top edge left to right first after the top-left corner.
    const i0 = f.nodeIds.indexOf('n0');
    expect(f.nodeIds[(i0 + 1) % 4]).toBe('n1');
    // The outer face is the same loop reversed, reported as a positive polygon.
    expect(geo.outerFaces).toHaveLength(1);
    expect(polygonSignedArea(geo.outerFaces[0])).toBe(11520);
    expect(f.netArea).toBe((120 - 6) * (96 - 6));
    // Reversing every wall gives the same result.
    for (const w of Object.values(l.walls)) [w.a, w.b] = [w.b, w.a];
    const geo2 = computeFaceGeometry(l, 'all');
    expect(geo2.faces).toHaveLength(1);
    expect(geo2.faces[0].grossArea).toBe(11520);
    expect(geo2.faces[0].id).toBe(f.id);
  });
});

describe('faces', () => {
  it('rectangle -> one face with positive net area and no open ends', () => {
    loop(rect(0, 0, 360, 480));
    const set = getFaces(level(), 'all');
    expect(set.faces).toHaveLength(1);
    expect(set.faces[0].netArea).toBeGreaterThan(0);
    expect(set.faces[0].netArea).toBeCloseTo((360 - 6.5) * (480 - 6.5), 6);
    expect(set.openEnds).toEqual([]);
  });

  it('two adjacent rooms -> two faces', () => {
    loop(rect(0, 0, 360, 480));
    store().addWall(levelId(), { x: 0, y: 240 }, { x: 360, y: 240 }, { ...ext, kind: 'interior', thickness: 4.5 });
    const set = getFaces(level(), 'all');
    expect(set.faces).toHaveLength(2);
    for (const f of set.faces) {
      expect(f.grossArea).toBeCloseTo(360 * 240);
      // 6.5" outside walls on three sides, the 4.5" divider on one.
      expect(f.netArea).toBeCloseTo((360 - 6.5) * (240 - 3.25 - 2.25), 6);
    }
    expect(set.outerFaces).toHaveLength(1);
    expect(polygonSignedArea(set.outerFaces[0])).toBeCloseTo(360 * 480);
  });

  it('a dangling interior wall is ignored (spike removed) and reported as an open end', () => {
    loop(rect(0, 0, 360, 480));
    const r = store().addWall(levelId(), { x: 0, y: 240 }, { x: 120, y: 240 }, { ...ext, thickness: 4.5 })!;
    const set = getFaces(level(), 'all');
    expect(set.faces).toHaveLength(1);
    const f = set.faces[0];
    expect(f.grossArea).toBeCloseTo(360 * 480);
    expect(f.nodeIds).not.toContain(r.b);
    expect(f.nodeIds).toHaveLength(5); // four corners plus the T node on the left wall
    expect(f.netArea).toBeCloseTo((360 - 6.5) * (480 - 6.5), 6);
    expect(set.openEnds).toEqual([r.b]);
  });

  it("10' x 12' centerline room with 4.5\" walls nets about 111.9 sq ft", () => {
    loop(rect(0, 0, 120, 144), { thickness: 4.5 });
    const [f] = getFaces(level(), 'all').faces;
    // (120 - 4.5) * (144 - 4.5) = 115.5 * 139.5 sq in.
    expect(f.netArea / 144).toBeCloseTo(111.89, 2);
    expect(f.grossArea / 144).toBe(120);
  });

  it('faces under one square foot are dropped; open chains have no faces', () => {
    loop(rect(0, 0, 10, 10));
    store().addWall(levelId(), { x: 100, y: 0 }, { x: 200, y: 0 }, ext);
    store().addWall(levelId(), { x: 200, y: 0 }, { x: 200, y: 100 }, ext);
    const set = getFaces(level(), 'all');
    expect(set.faces).toHaveLength(0);
    expect(set.openEnds).toHaveLength(2);
  });

  it('an L-shaped room insets correctly at the reflex corner', () => {
    loop([
      { x: 0, y: 0 },
      { x: 240, y: 0 },
      { x: 240, y: 120 },
      { x: 120, y: 120 },
      { x: 120, y: 240 },
      { x: 0, y: 240 },
    ]);
    const [f] = getFaces(level(), 'all').faces;
    expect(f.grossArea).toBe(240 * 240 - 120 * 120);
    const h = 3.25;
    const expected = (240 - 2 * h) * (120 - 2 * h) + (120 - 2 * h) * (120);
    expect(f.netArea).toBeCloseTo(expected, 6);
  });

  it('falls back to the centerline polygon when the inset collapses', () => {
    // A sliver room 20" wide with 24" walls cannot be inset.
    loop(rect(0, 0, 240, 20), { thickness: 24 });
    const [f] = getFaces(level(), 'all').faces;
    expect(f.netPolygon).toBe(f.polygon);
    expect(f.netArea).toBe(f.grossArea);
  });

  it('insetPolygon handles a thickness step along a straight run', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ];
    const out = insetPolygon(poly, [2, 4, 2, 2, 2]);
    expect(out).toContainEqual({ x: 100, y: 2 });
    expect(out).toContainEqual({ x: 100, y: 4 });
    expect(polygonSignedArea(out)).toBeCloseTo(196 * 96 - 98 * 2, 6);
  });
});

describe('rooms and view modes', () => {
  it('room anchors label the face they are in; the rest are orphans', () => {
    loop(rect(0, 0, 360, 480));
    store().addWall(levelId(), { x: 0, y: 240 }, { x: 360, y: 240 }, ext);
    const k = store().addRoom(levelId(), { name: 'Kitchen', anchor: { x: 100, y: 100 } })!;
    const lv = store().addRoom(levelId(), { name: 'Living', anchor: { x: 100, y: 400 } })!;
    const out = store().addRoom(levelId(), { name: 'Porch', anchor: { x: 500, y: 100 } })!;
    const dup = store().addRoom(levelId(), { name: 'Pantry', anchor: { x: 200, y: 50 } })!;
    const set = getFaces(level(), 'all');
    const top = set.faces.find((f) => f.polygon.every((p) => p.y <= 240))!;
    const bottom = set.faces.find((f) => f.polygon.every((p) => p.y >= 240))!;
    expect(top.roomId).toBe(k);
    expect(bottom.roomId).toBe(lv);
    expect(set.orphanRoomIds.sort()).toEqual([out, dup].sort());
    // A room's anchor inside the net polygon is where its label goes (REVIEW-2 C1).
    expect(top.labelPoint).toEqual({ x: 100, y: 100 });
    expect(bottom.labelPoint).toEqual({ x: 100, y: 400 });
  });

  it('memoized: unrelated edits keep the FaceSet, room edits keep the traced geometry', () => {
    loop(rect(0, 0, 360, 480));
    const s1 = getFaces(level(), 'all');
    expect(getFaces(level(), 'all')).toBe(s1);
    store().renameLevel(levelId(), 'Main');
    expect(getFaces(level(), 'all')).toBe(s1);
    store().addRoom(levelId(), { name: 'Hall', anchor: { x: 10, y: 10 } });
    const s2 = getFaces(level(), 'all');
    expect(s2).not.toBe(s1);
    expect(s2.faces[0].roomId).toBeDefined();
    expect(s2.outerFaces).toBe(s1.outerFaces);
  });

  it('a demo wall dividing a room: 2 faces in existing, 1 in proposed', () => {
    loop(rect(0, 0, 360, 480));
    store().addWall(levelId(), { x: 0, y: 240 }, { x: 360, y: 240 }, { ...ext, phase: 'demo' });
    expect(getFaces(level(), 'existing').faces).toHaveLength(2);
    expect(getFaces(level(), 'all').faces).toHaveLength(2);
    const proposed = getFaces(level(), 'proposed');
    expect(proposed.faces).toHaveLength(1);
    // The T nodes stay in the graph but the face is the whole rectangle.
    expect(proposed.faces[0].grossArea).toBeCloseTo(360 * 480);
    expect(proposed.openEnds).toEqual([]);
    // A room anchored in either half labels its half in existing and the whole room in proposed.
    const r = store().addRoom(levelId(), { name: 'Great room', anchor: { x: 100, y: 100 } })!;
    expect(getFaces(level(), 'proposed').faces[0].roomId).toBe(r);
    expect(getFaces(level(), 'existing').faces.filter((f) => f.roomId === r)).toHaveLength(1);
  });

  it('new walls only count in the proposed view', () => {
    loop(rect(0, 0, 360, 480), { phase: 'new' });
    expect(getFaces(level(), 'existing').faces).toHaveLength(0);
    expect(getFaces(level(), 'proposed').faces).toHaveLength(1);
  });
});

describe('room store actions', () => {
  it('addRoom / updateRoom / deleteRooms, each one undo step; blank names rejected', () => {
    const id = store().addRoom(levelId(), { name: '  Den ', anchor: { x: 1, y: 2 } })!;
    expect(level().rooms[id]).toEqual({ id, name: 'Den', anchor: { x: 1, y: 2 } });
    expect(store().addRoom(levelId(), { name: '   ', anchor: { x: 0, y: 0 } })).toBeNull();
    const past = usePlanStore.temporal.getState().pastStates.length;
    store().updateRoom(levelId(), id, { name: '' });
    store().updateRoom(levelId(), id, { name: 'Den' });
    expect(usePlanStore.temporal.getState().pastStates.length).toBe(past);
    store().updateRoom(levelId(), id, { name: 'Study', anchor: { x: 5, y: 6 } });
    expect(level().rooms[id]).toMatchObject({ name: 'Study', anchor: { x: 5, y: 6 } });
    store().deleteEntities(levelId(), { nodes: [], walls: [], rooms: [id] });
    expect(level().rooms).toEqual({});
    usePlanStore.temporal.getState().undo();
    expect(level().rooms[id].name).toBe('Study');
    store().deleteRooms(levelId(), [id]);
    expect(level().rooms).toEqual({});
  });
});

describe('roomDimensions (face to face)', () => {
  it('a 32\' x 26\' house of 6.5" walls measures 31\'-5 1/2" x 25\'-5 1/2" inside', () => {
    loop(rect(0, 0, 384, 312));
    const face = getFaces(level(), 'all').faces[0];
    const d = roomDimensions(face.netPolygon);
    expect(d.edges).toHaveLength(4);
    expect(d.rect!.width).toBeCloseTo(384 - 6.5);
    expect(d.rect!.depth).toBeCloseTo(312 - 6.5);
    // Clockwise on screen from the top-left corner: top, right, bottom, left.
    expect(d.corners[0].x).toBeCloseTo(3.25);
    expect(d.corners[0].y).toBeCloseTo(3.25);
    expect(d.edges.map((e) => Math.round(e * 100) / 100)).toEqual([377.5, 305.5, 377.5, 305.5]);
  });

  it('merges a side broken by a T junction and reports width x depth for a tall room', () => {
    loop(rect(0, 0, 120, 240));
    // A wall teeing into the right side from outside splits that side at y = 100.
    store().addWall(levelId(), { x: 120, y: 100 }, { x: 200, y: 100 }, ext);
    const face = getFaces(level(), 'all').faces.find((f) => f.grossArea > 120 * 200)!;
    expect(face.nodeIds.length).toBe(5);
    const d = roomDimensions(face.netPolygon);
    expect(d.edges).toHaveLength(4);
    expect(d.rect!.width).toBeCloseTo(113.5);
    expect(d.rect!.depth).toBeCloseTo(233.5);
  });

  it('lists every side of an L-shaped room and has no rect', () => {
    loop([
      { x: 0, y: 0 },
      { x: 240, y: 0 },
      { x: 240, y: 120 },
      { x: 120, y: 120 },
      { x: 120, y: 240 },
      { x: 0, y: 240 },
    ]);
    const d = roomDimensions(getFaces(level(), 'all').faces[0].netPolygon);
    expect(d.rect).toBeNull();
    expect(d.edges.map((e) => Math.round(e * 100) / 100)).toEqual([233.5, 113.5, 120, 120, 113.5, 233.5]);
  });

  it('handles degenerate input', () => {
    expect(roomDimensions([]).edges).toEqual([]);
    expect(roomDimensions([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]).edges).toEqual([]);
  });
});

describe('label placement (REVIEW-2 C1)', () => {
  // An L: a 360 x 240 arm along the top and a 120 x 240 arm down the left, centerlines.
  const L: Vec2[] = [
    { x: 0, y: 0 },
    { x: 360, y: 0 },
    { x: 360, y: 240 },
    { x: 120, y: 240 },
    { x: 120, y: 480 },
    { x: 0, y: 480 },
  ];

  it('polylabel: a rectangle gives its centre, an L a point deep in its fatter arm', () => {
    const r = polylabel(rect(0, 0, 200, 100));
    expect(r.point.x).toBeCloseTo(100, 6);
    expect(r.point.y).toBeCloseTo(50, 6);
    expect(r.distance).toBeCloseTo(50, 6);
    const l = polylabel(L);
    // The top arm is 240 deep, the left one 120 wide: the pole is in the top arm, 120 from its edges.
    expect(l.point.y).toBeLessThan(240);
    expect(l.distance).toBeGreaterThan(119 - 1);
    expect(pointToPolygonDistance(l.point, L)).toBeCloseTo(l.distance, 6);
    expect(pointToPolygonDistance({ x: 500, y: 0 }, L)).toBeLessThan(0);
  });

  it('an L-shaped room without an anchor inside labels its fatter arm, at least 20" from every edge', () => {
    loop(L);
    const set = getFaces(level(), 'all');
    expect(set.faces).toHaveLength(1);
    const f = set.faces[0];
    // The centroid of this L is near the concave corner; the label is well inside the top arm.
    expect(f.labelPoint.y).toBeLessThan(240 - 3.25);
    expect(f.labelPoint.x).toBeGreaterThan(120);
    expect(pointToPolygonDistance(f.labelPoint, f.netPolygon)).toBeGreaterThanOrEqual(20);
  });

  it('a rectangle room is labelled at its centre; an anchor inside the face wins', () => {
    loop(rect(0, 0, 360, 240));
    const f = getFaces(level(), 'all').faces[0];
    expect(f.labelPoint.x).toBeCloseTo(180, 6);
    expect(f.labelPoint.y).toBeCloseTo(120, 6);
    const id = store().addRoom(levelId(), { name: 'Den', anchor: { x: 40, y: 200 } })!;
    const g = getFaces(level(), 'all').faces[0];
    expect(g.roomId).toBe(id);
    expect(g.labelPoint).toEqual({ x: 40, y: 200 });
    // An anchor inside the wall (in the face's centerline polygon, not its net one): the pole.
    store().updateRoom(levelId(), id, { anchor: { x: 1, y: 120 } });
    const h = getFaces(level(), 'all').faces[0];
    expect(h.roomId).toBe(id);
    expect(h.labelPoint.x).toBeCloseTo(180, 6);
  });
});
