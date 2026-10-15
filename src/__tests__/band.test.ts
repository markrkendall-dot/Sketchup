import type { BufferGeometry } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearMeshCache, getLevelMeshes } from '../derive/meshes';
import { buildExportScene, disposeExportScene } from '../io/export3d';
import { wallBandOf } from '../model/finish';
import { createEmptyPlan, migrate } from '../model/plan';
import type { Id, Wall } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';

// An exterior band (Wall.band): the outside face of a wall below a height in its own finish.

const store = () => usePlanStore.getState();

beforeEach(() => {
  clearMeshCache();
  store().setPlan(createEmptyPlan());
  clearHistory();
});

/** A 20' x 15' box of 7" shingled walls on the First Floor; returns the level and the south wall (y = 180). */
function house(): { lid: Id; south: Id; east: Id } {
  const lid = store().plan.levelOrder[1];
  const c = [
    { x: 0, y: 0 },
    { x: 240, y: 0 },
    { x: 240, y: 180 },
    { x: 0, y: 180 },
  ];
  c.forEach((p, i) => store().addWall(lid, p, c[(i + 1) % 4], { kind: 'exterior', thickness: 7, phase: 'existing' }));
  const l = store().plan.levels[lid];
  const walls = Object.values(l.walls);
  const south = walls.find((w) => l.nodes[w.a].y === 180 && l.nodes[w.b].y === 180)!;
  const east = walls.find((w) => l.nodes[w.a].x === 240 && l.nodes[w.b].x === 240)!;
  return { lid, south: south.id, east: east.id };
}

const STONE = { finish: 'stone', color: '#8E8579', height: 36 } as const;
const wallOf = (lid: Id, id: Id): Wall => store().plan.levels[lid].walls[id];
const meshOf = (lid: Id, id: Id) => getLevelMeshes(store().plan, lid, 'existing').walls.find((w) => w.id === id)!;

/** Triangles of a geometry: their three vertices (x, y, z) and their normal. */
function triangles(g: BufferGeometry): { v: [number, number, number][]; n: [number, number, number] }[] {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const out = [];
  for (let i = 0; i + 2 < p.count; i += 3) {
    const v = [0, 1, 2].map((k) => [p.getX(i + k), p.getY(i + k), p.getZ(i + k)] as [number, number, number]);
    out.push({ v, n: [n.getX(i), n.getY(i), n.getZ(i)] as [number, number, number] });
  }
  return out;
}

describe('the band in the model', () => {
  it('updateWalls sets a band (colour lower-cased) in one undo step, clears it with undefined, and refuses a height not above 0', () => {
    const { lid, south, east } = house();
    const before = store().plan;
    store().updateWalls(lid, [south, east], { band: STONE });
    for (const id of [south, east]) expect(wallOf(lid, id).band).toEqual({ finish: 'stone', color: '#8e8579', height: 36 });
    // A copy per wall.
    expect(wallOf(lid, south).band).not.toBe(wallOf(lid, east).band);
    usePlanStore.temporal.getState().undo();
    expect(store().plan).toBe(before);
    store().updateWalls(lid, [south], { band: { finish: 'halflog', height: 30 } });
    expect(wallOf(lid, south).band).toEqual({ finish: 'halflog', height: 30 });
    const kept = store().plan;
    store().updateWalls(lid, [south], { band: { finish: 'stone', height: 0 } });
    expect(store().plan).toBe(kept);
    store().updateWalls(lid, [south], { band: undefined });
    expect('band' in wallOf(lid, south)).toBe(false);
  });

  it('wallBandOf: the colour defaults to the wall\'s; none at or above the wall\'s top', () => {
    const w: Pick<Wall, 'kind' | 'color' | 'band'> = { kind: 'exterior', band: { finish: 'stone', height: 36 } };
    expect(wallBandOf(w, 96)).toEqual({ finish: 'stone', color: '#5a3a35', height: 36 });
    expect(wallBandOf({ ...w, color: '#112233' }, 96)?.color).toBe('#112233');
    expect(wallBandOf(w, 36)).toBeNull();
    expect(wallBandOf({ kind: 'exterior' }, 96)).toBeNull();
  });

  it('loads byte for byte, and drops a malformed band (a bad colour alone loses the colour)', () => {
    const { lid, south } = house();
    store().updateWalls(lid, [south], { band: STONE });
    const text = JSON.stringify(store().plan);
    expect(JSON.stringify(migrate(JSON.parse(text)))).toBe(text);
    const load = (band: unknown) => {
      const doc = JSON.parse(text);
      doc.levels[lid].walls[south].band = band;
      return migrate(doc).levels[lid].walls[south].band;
    };
    expect(load({ finish: 'halflog', height: 30 })).toEqual({ finish: 'halflog', height: 30 });
    expect(load({ finish: 'riverstone', height: 36 })).toEqual({ finish: 'riverstone', height: 36 });
    expect(load({ finish: 'stone', color: 'grey', height: 30 })).toEqual({ finish: 'stone', height: 30 });
    expect(load({ finish: 'vinyl', height: 30 })).toBeUndefined();
    expect(load({ finish: 'screen', height: 30 })).toBeUndefined();
    expect(load({ finish: 'stone', height: 0 })).toBeUndefined();
    expect(load({ finish: 'stone' })).toBeUndefined();
    expect(load('stone')).toBeUndefined();
  });
});

describe('the band in 3D', () => {
  it('splits the outside face below the height into a mesh of its own, in the band\'s finish and colour', () => {
    const { lid, south } = house();
    const plain = meshOf(lid, south);
    expect('band' in plain).toBe(false);
    const plainCount = plain.geometry.getAttribute('position').count;
    store().updateWalls(lid, [south], { band: STONE });
    const w = meshOf(lid, south);
    expect(w.finish).toBe('shingle');
    expect(w.band).toMatchObject({ side: 'left', finish: 'stone', color: '#8e8579' });
    // The band: on the outside face (y = 183.5 in plan, z in 3D), facing out, all below 36".
    const band = triangles(w.band!.geometry);
    expect(band.length).toBeGreaterThan(0);
    for (const t of band) {
      expect(t.n[2]).toBeGreaterThan(0.99);
      for (const [, y, z] of t.v) {
        expect(z).toBeCloseTo(183.5, 3);
        expect(y).toBeLessThanOrEqual(36 + 1e-6);
      }
    }
    // The core keeps the outside face above 36" only, and the inside face whole.
    const core = triangles(w.geometry);
    const outside = core.filter((t) => t.n[2] > 0.99 && t.v.every(([, , z]) => Math.abs(z - 183.5) < 1e-3));
    expect(outside.length).toBeGreaterThan(0);
    for (const t of outside) expect(Math.min(...t.v.map(([, y]) => y))).toBeGreaterThanOrEqual(36 - 1e-6);
    expect(core.some((t) => t.n[2] < -0.99 && t.v.some(([, y]) => y < 36))).toBe(true);
    // Nothing lost: the band and the core hold more vertices than the uncut wall (the cut adds a row).
    expect(w.geometry.getAttribute('position').count + w.band!.geometry.getAttribute('position').count).toBeGreaterThan(plainCount);
  });

  it('a river-stone band without a colour: its own mesh, the wall\'s colour passed to the stones\' texture', () => {
    const { lid, south } = house();
    store().updateWalls(lid, [south], { band: { finish: 'riverstone', height: 36 } });
    expect(wallOf(lid, south).band).toEqual({ finish: 'riverstone', height: 36 });
    const w = meshOf(lid, south);
    expect(w.finish).toBe('shingle');
    expect(w.band).toMatchObject({ side: 'left', finish: 'riverstone', color: '#5a3a35' });
    for (const t of triangles(w.band!.geometry)) for (const [, y] of t.v) expect(y).toBeLessThanOrEqual(36 + 1e-6);
  });

  it('cuts every wall of the level at the band height, so neighbours stay watertight; without a band nothing changes', () => {
    const { lid, south, east } = house();
    const at36 = (g: BufferGeometry) => {
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) - 36) < 1e-6) return true;
      return false;
    };
    expect(at36(meshOf(lid, east).geometry)).toBe(false);
    store().updateWalls(lid, [south], { band: STONE });
    expect(at36(meshOf(lid, east).geometry)).toBe(true);
    expect('band' in meshOf(lid, east)).toBe(false);
    store().updateWalls(lid, [south], { band: undefined });
    expect(at36(meshOf(lid, east).geometry)).toBe(false);
    expect('band' in meshOf(lid, south)).toBe(false);
  });

  it('goes on the side away from a room; a room dressing both sides wins; never on a demolished or screen wall', () => {
    const { lid } = house();
    // A divider at x = 120 with a room either side.
    store().addWall(lid, { x: 120, y: 0 }, { x: 120, y: 180 }, { kind: 'interior', thickness: 4.5, phase: 'existing' });
    const west = store().addRoom(lid, { name: 'West', anchor: { x: 60, y: 90 } })!;
    const east = store().addRoom(lid, { name: 'East', anchor: { x: 180, y: 90 } })!;
    const l = store().plan.levels[lid];
    const divider = Object.values(l.walls).find((w) => l.nodes[w.a].x === 120 && l.nodes[w.b].x === 120)!.id;
    const southWalls = Object.values(l.walls).filter((w) => l.nodes[w.a].y === 180 && l.nodes[w.b].y === 180).map((w) => w.id);
    expect(southWalls.length).toBeGreaterThan(0);
    store().updateWalls(lid, [...southWalls, divider], { band: STONE });
    // A room dressing the inside: the room's face inside, the band outside.
    store().updateRoom(lid, west, { wallFinish: 'pine' });
    for (const id of southWalls) {
      const w = meshOf(lid, id);
      expect(w.band?.side).toBe('left');
      for (const f of w.faces ?? []) expect(f.side).not.toBe(w.band!.side);
    }
    // The divider has a dressed room on one side only (West): the band goes on the other.
    const d = meshOf(lid, divider);
    expect(d.band).toBeDefined();
    expect(d.faces?.map((f) => f.side)).not.toContain(d.band!.side);
    // Both sides dressed: no band.
    store().updateRoom(lid, east, { wallFinish: 'paint' });
    expect('band' in meshOf(lid, divider)).toBe(false);
    // Demolished or screen: no band.
    store().updateWalls(lid, [southWalls[0]], { finish: 'screen' });
    expect('band' in meshOf(lid, southWalls[0])).toBe(false);
    store().updateWalls(lid, [southWalls[0]], { finish: undefined, phase: 'demo' });
    expect(getLevelMeshes(store().plan, lid, 'all').walls.find((w) => w.id === southWalls[0])?.band).toBeUndefined();
  });

  it('exports the band as its own mesh, with the usual wall material name', () => {
    const { lid, south } = house();
    store().updateWalls(lid, [south], { band: STONE });
    const root = buildExportScene(store().plan, 'existing', { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: lid });
    const bands: { name: string; material: string }[] = [];
    root.traverse((o) => {
      const m = (o as { material?: { name: string } }).material;
      if (m && o.name.endsWith('lower band')) bands.push({ name: o.name, material: m.name });
    });
    expect(bands).toHaveLength(1);
    expect(bands[0].name).toMatch(/^Wall \d+ lower band$/);
    expect(bands[0].material).toBe('wall_existing_exterior_stone_8e8579');
    disposeExportScene(root);
  });
});
