import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildFloorFinishGeometry, clearMeshCache, FLOOR_FINISH_LIFT, getLevelMeshes, subtractConvex, triangleCount } from '../derive/meshes';
import { facesBesideWall, faceOfRoom, getFaces, wallSideFaces } from '../derive/rooms';
import { buildExportScene, disposeExportScene } from '../io/export3d';
import { floorLookOf, ROOM_WALL_COLOR, roomWallLookOf, wainscotOf } from '../model/finish';
import { polygonSignedArea } from '../model/geometry';
import { createEmptyPlan, migrate } from '../model/plan';
import type { Id, Vec2 } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';
import { CHECK_INCHES, checkTone, FLOOR_BOARD, floorBoards, interiorHeight, interiorTextures, PARQUET_BLOCK, PARQUET_SLATS, parquetSlats, TILE_INCHES, tileGrid } from '../view3d/textures';
import { floorFinishMaterial, interiorFlatColor, roomWallMaterial } from '../view3d/materials';

// Interior finishes (DESIGN.md "Interior finishes"): a room dresses the long faces of the walls on
// its side and its floor; nothing else changes.

const store = () => usePlanStore.getState();
const level = (id: Id) => store().plan.levels[id];

beforeEach(() => {
  clearMeshCache();
  store().setPlan(createEmptyPlan());
  clearHistory();
});

/**
 * A 20' x 15' box of 7" exterior walls on the First Floor (centerlines 0..240 x 0..180), split by a
 * 5" partition at x 120 into West and East rooms; West has a window in its south wall.
 */
function boxRooms(): { lid: Id; west: Id; east: Id } {
  const lid = store().plan.levelOrder[1];
  const c: Vec2[] = [
    { x: 0, y: 0 },
    { x: 240, y: 0 },
    { x: 240, y: 180 },
    { x: 0, y: 180 },
  ];
  c.forEach((p, i) => store().addWall(lid, p, c[(i + 1) % 4], { kind: 'exterior', thickness: 7, phase: 'existing' }));
  store().addWall(lid, { x: 120, y: 0 }, { x: 120, y: 180 }, { kind: 'interior', thickness: 5, phase: 'existing' });
  const l = level(lid);
  const south = Object.values(l.walls).find((w) => l.nodes[w.a].y === 180 && l.nodes[w.b].y === 180 && Math.min(l.nodes[w.a].x, l.nodes[w.b].x) < 60)!;
  expect(store().addOpening(lid, { wallId: south.id, type: 'window', offset: 60, width: 36, height: 40, sill: 30, phase: 'existing' })).not.toBeNull();
  const west = store().addRoom(lid, { name: 'West', anchor: { x: 60, y: 90 } })!;
  const east = store().addRoom(lid, { name: 'East', anchor: { x: 180, y: 90 } })!;
  return { lid, west, east };
}

/** Every edge shared by exactly two triangles running opposite ways (vertices rounded to 1e-4). */
function closedEdges(g: BufferGeometry): boolean {
  const pos = g.getAttribute('position');
  const key = (i: number) => [pos.getX(i), pos.getY(i), pos.getZ(i)].map((v) => Math.round(v * 1e4)).join(',');
  const count = new Map<string, number>();
  for (let t = 0; t < pos.count; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = key(t + k);
      const b = key(t + ((k + 1) % 3));
      if (a !== b) count.set(`${a}>${b}`, (count.get(`${a}>${b}`) ?? 0) + 1);
    }
  }
  for (const [k, n] of count) {
    const [a, b] = k.split('>');
    if (count.get(`${b}>${a}`) !== n) return false;
  }
  return true;
}

/** The y range of a geometry's vertices. */
function yRange(g: BufferGeometry): [number, number] {
  const pos = g.getAttribute('position');
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    lo = Math.min(lo, pos.getY(i));
    hi = Math.max(hi, pos.getY(i));
  }
  return [lo, hi];
}

/** Area of a geometry's triangles seen from above. */
function planArea(g: BufferGeometry): number {
  const pos = g.getAttribute('position');
  let s = 0;
  for (let i = 0; i < pos.count; i += 3) {
    const ax = pos.getX(i);
    const az = pos.getZ(i);
    s += Math.abs((pos.getX(i + 1) - ax) * (pos.getZ(i + 2) - az) - (pos.getX(i + 2) - ax) * (pos.getZ(i + 1) - az)) / 2;
  }
  return s;
}

describe('the model: room finishes', () => {
  it('resolves the looks with their defaults, and none when nothing is set', () => {
    expect(roomWallLookOf({})).toBeNull();
    expect(roomWallLookOf({ wallColor: '#112233' })).toEqual({ finish: 'paint', color: '#112233' });
    expect(roomWallLookOf({ wallFinish: 'pine' })).toEqual({ finish: 'pine', color: ROOM_WALL_COLOR.pine });
    expect(floorLookOf({})).toBeNull();
    expect(floorLookOf({ floorColor: '#445566' })).toEqual({ finish: 'plain', color: '#445566' });
    expect(wainscotOf({ wainscot: { height: 40, finish: 'pine' } }, 96)).toEqual({ height: 40, finish: 'pine', color: ROOM_WALL_COLOR.pine });
    // A wainscot as high as the ceiling or higher is no wainscot.
    expect(wainscotOf({ wainscot: { height: 96, finish: 'pine' } }, 96)).toBeNull();
  });

  it('loads valid finishes byte for byte and drops malformed ones one by one', () => {
    const { lid, west } = boxRooms();
    store().updateRoom(lid, west, { wallFinish: 'check', wallColor: '#2E3F6B', wainscot: { height: 40, finish: 'pine', color: '#C4884E' }, floorFinish: 'tile', floorColor: '#CBBD9C' });
    const r = level(lid).rooms[west];
    // The store keeps colours lower-case.
    expect(r).toMatchObject({ wallFinish: 'check', wallColor: '#2e3f6b', wainscot: { height: 40, finish: 'pine', color: '#c4884e' }, floorFinish: 'tile', floorColor: '#cbbd9c' });
    const text = JSON.stringify(store().plan);
    expect(JSON.stringify(migrate(JSON.parse(text)))).toBe(text);
    const broken = JSON.parse(text);
    Object.assign(broken.levels[lid].rooms[west], { wallFinish: 'wallpaper', wallColor: 'blue', floorFinish: 'carpet', floorColor: '#12345' });
    broken.levels[lid].rooms[west].wainscot = { height: -3, finish: 'pine' };
    const loaded = migrate(broken).levels[lid].rooms[west];
    for (const k of ['wallFinish', 'wallColor', 'wainscot', 'floorFinish', 'floorColor']) expect(k in loaded, k).toBe(false);
    // A wainscot with a bad colour keeps its height and finish.
    const badColor = JSON.parse(text);
    badColor.levels[lid].rooms[west].wainscot.color = 'pine';
    expect(migrate(badColor).levels[lid].rooms[west].wainscot).toEqual({ height: 40, finish: 'pine' });
  });

  it('updateRoom sets and clears each finish, and a finish-only patch with the same name still applies', () => {
    const { lid, west } = boxRooms();
    store().updateRoom(lid, west, { name: 'West', floorFinish: 'boards' });
    expect(level(lid).rooms[west].floorFinish).toBe('boards');
    store().updateRoom(lid, west, { floorFinish: undefined });
    expect('floorFinish' in level(lid).rooms[west]).toBe(false);
    // A rename to the same name with nothing else is no edit at all.
    const before = store().plan;
    store().updateRoom(lid, west, { name: 'West' });
    expect(store().plan).toBe(before);
  });
});

describe('wallSideFaces', () => {
  it('agrees with facesBesideWall for every wall', () => {
    const { lid } = boxRooms();
    const l = level(lid);
    const set = getFaces(l, 'all');
    const all = wallSideFaces(set, l.walls);
    for (const w of Object.values(l.walls)) {
      const one = facesBesideWall(set, w);
      expect(all.get(w.id)?.left ?? null).toBe(one.left);
      expect(all.get(w.id)?.right ?? null).toBe(one.right);
    }
  });
});

describe('wall faces dressed by a room', () => {
  it('splits nothing when no room sets a finish', () => {
    const { lid } = boxRooms();
    const m = getLevelMeshes(store().plan, lid, 'all');
    expect(m.walls.every((w) => w.faces === undefined)).toBe(true);
    expect(m.floorFinishes).toEqual([]);
  });

  it("splits off the faces on the room's side, which keep the wall watertight with the core", () => {
    const { lid, west } = boxRooms();
    const plain = getLevelMeshes(store().plan, lid, 'all');
    const plainCount = new Map(plain.walls.map((w) => [w.id, triangleCount(w.geometry)]));
    store().updateRoom(lid, west, { wallFinish: 'check', wallColor: '#2e3f6b' });
    const l = level(lid);
    const set = getFaces(l, 'all');
    const westFace = faceOfRoom(set, west)!;
    const m = getLevelMeshes(store().plan, lid, 'all');
    const dressed = m.walls.filter((w) => w.faces);
    // The three exterior walls round West and the partition.
    expect(dressed.length).toBe(4);
    for (const w of dressed) {
      const wall = l.walls[w.id];
      const sides = facesBesideWall(set, wall);
      for (const f of w.faces!) {
        expect(f).toMatchObject({ roomId: west, band: 'upper', finish: 'check', color: '#2e3f6b' });
        expect(sides[f.side]).toBe(westFace);
      }
      expect(w.faces!.length).toBe(1);
      // Nothing lost or added: the core and the face are the same triangles as the whole wall.
      expect(triangleCount(w.geometry) + w.faces!.reduce((s, f) => s + triangleCount(f.geometry), 0)).toBe(plainCount.get(w.id));
    }
    // The level's walls, cores and faces together, are as closed as they were whole.
    const whole = mergeGeometries(plain.walls.map((w) => w.geometry))!;
    const split = mergeGeometries(m.walls.flatMap((w) => [w.geometry, ...(w.faces ?? []).map((f) => f.geometry)]))!;
    expect(closedEdges(whole)).toBe(true);
    expect(closedEdges(split)).toBe(true);
    whole.dispose();
    split.dispose();
    // East's walls stay whole.
    expect(m.walls.filter((w) => !w.faces).length).toBe(plain.walls.length - 4);
  });

  it('cuts a wainscot at its height, below it the wainscot finish, above it the walls', () => {
    const { lid, west } = boxRooms();
    store().updateRoom(lid, west, { wainscot: { height: 40, finish: 'pine' } });
    const m = getLevelMeshes(store().plan, lid, 'all');
    const parts = m.walls.flatMap((w) => w.faces ?? []);
    const low = parts.filter((p) => p.band === 'wainscot');
    const high = parts.filter((p) => p.band === 'upper');
    expect(low.length).toBe(4);
    for (const p of low) {
      expect(yRange(p.geometry)[1]).toBeLessThanOrEqual(40 + 1e-6);
      expect(p).toMatchObject({ finish: 'pine', color: ROOM_WALL_COLOR.pine });
    }
    // No wall finish: the upper faces are painted the default interior colour.
    for (const p of high) {
      expect(yRange(p.geometry)[0]).toBeGreaterThanOrEqual(40 - 1e-6);
      expect(p.finish).toBe('paint');
    }
  });

  it('a colour edit keeps the geometry; a wainscot height edit rebuilds it', () => {
    const { lid, west } = boxRooms();
    store().updateRoom(lid, west, { wallFinish: 'pine', wainscot: { height: 40, finish: 'boards' } });
    const first = getLevelMeshes(store().plan, lid, 'all').walls.find((w) => w.faces)!;
    store().updateRoom(lid, west, { wallColor: '#aa8866' });
    const recoloured = getLevelMeshes(store().plan, lid, 'all').walls.find((w) => w.id === first.id)!;
    expect(recoloured.faces![0].geometry).toBe(first.faces![0].geometry);
    expect(recoloured.faces!.find((f) => f.band === 'upper')!.color).toBe('#aa8866');
    store().updateRoom(lid, west, { wainscot: { height: 32, finish: 'boards' } });
    const recut = getLevelMeshes(store().plan, lid, 'all').walls.find((w) => w.id === first.id)!;
    expect(recut.faces![0].geometry).not.toBe(first.faces![0].geometry);
  });

  it('never dresses a demolished wall', () => {
    const { lid, west } = boxRooms();
    store().updateRoom(lid, west, { wallFinish: 'pine' });
    const l = level(lid);
    const partition = Object.values(l.walls).find((w) => w.kind === 'interior')!;
    store().setPhase(lid, { walls: [partition.id], openings: [] }, 'demo');
    const m = getLevelMeshes(store().plan, lid, 'existing');
    expect(m.walls.find((w) => w.id === partition.id)!.faces).toBeUndefined();
  });
});

describe('floor finishes', () => {
  it("cover the room's net area just over the slab, facing up", () => {
    const { lid, west } = boxRooms();
    store().updateRoom(lid, west, { floorFinish: 'parquet' });
    const m = getLevelMeshes(store().plan, lid, 'all');
    expect(m.floorFinishes.length).toBe(1);
    const f = m.floorFinishes[0];
    expect(f).toMatchObject({ roomId: west, phase: 'existing', finish: 'parquet' });
    const face = faceOfRoom(getFaces(level(lid), 'all'), west)!;
    expect(planArea(f.geometry)).toBeCloseTo(face.netArea, 3);
    expect(yRange(f.geometry)).toEqual([FLOOR_FINISH_LIFT, FLOOR_FINISH_LIFT]);
    const n = f.geometry.getAttribute('normal');
    for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBe(1);
    // Every triangle faces up (counter-clockwise seen from above).
    const pos = f.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) {
      const cross = (pos.getX(i + 1) - pos.getX(i)) * (pos.getZ(i + 2) - pos.getZ(i)) - (pos.getX(i + 2) - pos.getX(i)) * (pos.getZ(i + 1) - pos.getZ(i));
      expect(cross).toBeLessThan(0);
    }
  });

  it('leave out the stair holes through the slab', () => {
    const net = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    // One hole against a wall face (the usual case) and one in the middle.
    const holes = [
      [{ x: 0, y: 10 }, { x: 36, y: 10 }, { x: 36, y: 50 }, { x: 0, y: 50 }],
      [{ x: 60, y: 30 }, { x: 80, y: 30 }, { x: 80, y: 40 }, { x: 60, y: 40 }],
    ];
    const g = buildFloorFinishGeometry(net, holes)!;
    expect(planArea(g)).toBeCloseTo(8000 - 36 * 40 - 20 * 10, 6);
    g.dispose();
  });

  it('subtractConvex keeps exactly the part outside the hole, whichever way it winds', () => {
    const sq = (x0: number, y0: number, s: number): Vec2[] => [
      { x: x0, y: y0 },
      { x: x0 + s, y: y0 },
      { x: x0 + s, y: y0 + s },
      { x: x0, y: y0 + s },
    ];
    for (const hole of [sq(2, 2, 4), [...sq(2, 2, 4)].reverse()]) {
      const pieces = subtractConvex(sq(0, 0, 10), hole);
      expect(pieces.reduce((s, p) => s + Math.abs(polygonSignedArea(p)), 0)).toBeCloseTo(100 - 16, 9);
    }
    // A hole that misses leaves the polygon whole; one that covers it leaves nothing.
    expect(subtractConvex(sq(0, 0, 10), sq(20, 20, 2)).reduce((s, p) => s + Math.abs(polygonSignedArea(p)), 0)).toBeCloseTo(100, 9);
    expect(subtractConvex(sq(0, 0, 10), sq(-1, -1, 12))).toEqual([]);
  });
});

describe('textures and materials', () => {
  it('lays out the patterns on the 48" tile', () => {
    expect(TILE_INCHES / CHECK_INCHES).toBe(48);
    expect([checkTone(0, 0), checkTone(1, 0), checkTone(0, 1), checkTone(1, 1)]).toEqual([0, 1, 1, 2]);
    // Floor boards: each row adds up to the tile, no board shorter than 16".
    const boards = floorBoards();
    for (let y = 0; y < TILE_INCHES; y += FLOOR_BOARD) {
      const row = boards.filter((b) => b.y0 === y);
      expect(row.reduce((s, b) => s + b.x1 - b.x0, 0)).toBeCloseTo(TILE_INCHES, 9);
      for (const b of row) expect(b.x1 - b.x0).toBeGreaterThanOrEqual(16 - 1e-9);
    }
    expect(tileGrid().length).toBe(16);
    const slats = parquetSlats();
    expect(slats.length).toBe((TILE_INCHES / PARQUET_BLOCK) ** 2 * PARQUET_SLATS);
    expect(slats.filter((s) => s.along === 'x').length).toBe(slats.length / 2);
    expect(interiorHeight('wall-check')).toBeNull();
    expect(interiorHeight('floor-tile')).not.toBeNull();
  });

  it('has no textures in node: the materials show their flat colours', () => {
    expect(interiorTextures('wall-pine', '#c4884e')).toBeNull();
    const m = roomWallMaterial('existing', 'pine', '#c4884e');
    expect(m.map).toBeNull();
    expect(m.userData.flatColor).toBe('#c4884e');
    expect(roomWallMaterial('existing', 'pine', '#c4884e')).toBe(m);
    // A check reads as its colour lightened by the ground; a floor sits in front of the slab.
    expect(interiorFlatColor('existing', 'check', '#2e3f6b')).not.toBe('#2e3f6b');
    expect(floorFinishMaterial('existing', 'tile', '#cbbd9c').polygonOffset).toBe(true);
    // New work is washed green.
    expect(interiorFlatColor('new', 'paint', '#ffffff')).not.toBe('#ffffff');
  });
});

describe('export', () => {
  it('exports the dressed faces and the floor finish as their own meshes and materials', () => {
    const { lid, west } = boxRooms();
    store().updateRoom(lid, west, { wallFinish: 'pine', wainscot: { height: 40, finish: 'boards' }, floorFinish: 'tile' });
    const root = buildExportScene(store().plan, 'all', { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: lid });
    const names: string[] = [];
    const materials = new Set<string>();
    root.traverse((o) => {
      names.push(o.name);
      const m = (o as { material?: { name: string } }).material;
      if (m) materials.add(m.name);
    });
    expect(names).toContain('Floor finish (West)');
    expect(names.some((n) => /^Wall \d+ finish \(West\)$/.test(n))).toBe(true);
    expect(names.some((n) => /^Wall \d+ finish \(West, wainscot\)$/.test(n))).toBe(true);
    expect(materials.has(`interior_pine_${ROOM_WALL_COLOR.pine.slice(1)}`)).toBe(true);
    expect([...materials].some((n) => n.startsWith('floor_tile_'))).toBe(true);
    disposeExportScene(root);
  });
});

