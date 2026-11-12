import { beforeEach, describe, expect, it } from 'vitest';
import { roomCanFollowRoof, slopedCeilingPieces, ceilingHeightAt } from '../derive/ceilings';
import { CEILING_DROP, capProfile, clearMeshCache, getLevelMeshes } from '../derive/meshes';
import { getLevelRoofs } from '../derive/roofJoin';
import { CEILING_COLOR } from '../model/finish';
import { createEmptyPlan, migrate } from '../model/plan';
import { firstStructure } from '../model/structures';
import type { Id, Vec2 } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';

// Ceilings that follow the roof (DESIGN.md "Ceilings").

const store = () => usePlanStore.getState();
const level = (id: Id) => store().plan.levels[id];

beforeEach(() => {
  clearMeshCache();
  store().setPlan(createEmptyPlan());
  clearHistory();
});

/**
 * A 20' x 15' box of 7" exterior walls on the First Floor (centerlines 0..240 x 0..180) split by a 5"
 * partition at x 120, under a 6:12 gable over the outside faces with its ridge along x (y 90).
 */
function gableBox(): { lid: Id; west: Id; east: Id; wallHeight: number } {
  const lid = firstStructure(store().plan).levelOrder[1];
  const c: Vec2[] = [
    { x: 0, y: 0 },
    { x: 240, y: 0 },
    { x: 240, y: 180 },
    { x: 0, y: 180 },
  ];
  c.forEach((p, i) => store().addWall(lid, p, c[(i + 1) % 4], { kind: 'exterior', thickness: 7, phase: 'existing' }));
  store().addWall(lid, { x: 120, y: 0 }, { x: 120, y: 180 }, { kind: 'interior', thickness: 5, phase: 'existing' });
  const out = [
    { x: -3.5, y: -3.5 },
    { x: 243.5, y: -3.5 },
    { x: 243.5, y: 183.5 },
    { x: -3.5, y: 183.5 },
  ];
  expect(store().addRoof(lid, { shape: 'gable', outline: out, ridgeAngle: 0, pitch: 6, overhang: 12, bearingOffset: 0, thickness: 8, fascia: 6, phase: 'existing', finish: 'metal' })).not.toBeNull();
  const west = store().addRoom(lid, { name: 'West', anchor: { x: 60, y: 90 } })!;
  const east = store().addRoom(lid, { name: 'East', anchor: { x: 180, y: 90 } })!;
  return { lid, west, east, wallHeight: level(lid).wallHeight };
}

/** Heights of a geometry's vertices. */
const heights = (g: { getAttribute(n: string): { count: number; getY(i: number): number } }) => {
  const pos = g.getAttribute('position');
  return Array.from({ length: pos.count }, (_, i) => pos.getY(i));
};

describe('a ceiling that follows the roof', () => {
  it('is offered only with a roof over the room, and stored only as "roof" with a positive flat top', () => {
    const { lid, west } = gableBox();
    expect(roomCanFollowRoof(store().plan, lid, west, 'existing')).toBe(true);
    const roofId = Object.keys(level(lid).roofs)[0];
    store().deleteRoofs(lid, [roofId]);
    expect(roomCanFollowRoof(store().plan, lid, west, 'existing')).toBe(false);
    store().updateRoom(lid, west, { ceilingFlatTop: 100 });
    expect(level(lid).rooms[west].ceilingFlatTop).toBeUndefined();
    store().updateRoom(lid, west, { ceilingShape: 'roof' });
    store().updateRoom(lid, west, { ceilingFlatTop: -3 });
    expect(level(lid).rooms[west].ceilingFlatTop).toBeUndefined();
    store().updateRoom(lid, west, { ceilingFlatTop: 110 });
    expect(level(lid).rooms[west]).toMatchObject({ ceilingShape: 'roof', ceilingFlatTop: 110 });
    store().updateRoom(lid, west, { ceilingShape: undefined });
    expect(level(lid).rooms[west].ceilingShape).toBeUndefined();
    expect(level(lid).rooms[west].ceilingFlatTop).toBeUndefined();
  });

  it('goes up the slopes to the ridge, painted by default; flat elsewhere as before', () => {
    const { lid, west, east, wallHeight } = gableBox();
    // Before: under a roof with no finish set, no ceiling.
    expect(getLevelMeshes(store().plan, lid, 'existing').ceilings).toHaveLength(0);
    store().updateRoom(lid, west, { ceilingShape: 'roof' });
    const m = getLevelMeshes(store().plan, lid, 'existing');
    expect(m.ceilings.map((c) => [c.roomId, c.finish, c.color])).toEqual([[west, 'paint', CEILING_COLOR.paint]]);
    const hs = heights(m.ceilings[0].geometry);
    // Parallel to the roof's underside, the rise across the 7" eave wall (3 1/2") below it: under the
    // ridge the plate (96") + 93.5" x 6/12 - 3 1/2"; at the inside faces of the eave walls (y 3.5
    // and 176.5) the plate itself, meeting the walls' tops.
    expect(Math.max(...hs)).toBeCloseTo(wallHeight + 93.5 / 2 - 3.5 - CEILING_DROP, 4);
    expect(Math.min(...hs)).toBeCloseTo(wallHeight - CEILING_DROP, 4);
    // Every face looks down.
    const nor = m.ceilings[0].geometry.getAttribute('normal');
    for (let i = 0; i < nor.count; i++) expect(nor.getY(i)).toBeLessThan(0);
    // The east room's ceiling, set flat with a finish, is unchanged.
    store().updateRoom(lid, east, { ceilingFinish: 'boards' });
    const e = getLevelMeshes(store().plan, lid, 'existing').ceilings.find((c) => c.roomId === east)!;
    expect(new Set(heights(e.geometry).map((h) => h.toFixed(4)))).toEqual(new Set([(wallHeight - CEILING_DROP).toFixed(4)]));
  });

  it('with a flat top: flat where the roof is higher (a collar tie)', () => {
    const { lid, west, wallHeight } = gableBox();
    store().updateRoom(lid, west, { ceilingShape: 'roof', ceilingFlatTop: wallHeight + 30 });
    const g = getLevelMeshes(store().plan, lid, 'existing').ceilings[0].geometry;
    const hs = heights(g);
    expect(Math.max(...hs)).toBeCloseTo(wallHeight + 30 - CEILING_DROP, 4);
    expect(hs.filter((h) => Math.abs(h - (wallHeight + 30 - CEILING_DROP)) < 1e-3).length).toBeGreaterThan(3);
  });

  it('the partition beside it rises to the roof (to the flat top when set), and the room dresses its face up there', () => {
    const { lid, west, wallHeight } = gableBox();
    const partition = Object.values(level(lid).walls).find((w) => w.kind === 'interior')!;
    const top = () => Math.max(...heights(getLevelMeshes(store().plan, lid, 'existing').walls.find((w) => w.id === partition.id)!.geometry));
    expect(top()).toBeCloseTo(wallHeight, 6);
    store().updateRoom(lid, west, { ceilingShape: 'roof', wallFinish: 'boards' });
    expect(top()).toBeGreaterThan(wallHeight + 40);
    const faces = getLevelMeshes(store().plan, lid, 'existing').walls.find((w) => w.id === partition.id)!.faces!;
    expect(Math.max(...faces.flatMap((f) => heights(f.geometry)))).toBeGreaterThan(wallHeight + 40);
    store().updateRoom(lid, west, { ceilingFlatTop: wallHeight + 30 });
    expect(top()).toBeCloseTo(wallHeight + 30, 6);
  });

  it('under joined roofs: each part on the roof drawn over it', () => {
    const { lid, west } = gableBox();
    const roofs = getLevelRoofs(store().plan, lid, 'existing').own;
    const pieces = slopedCeilingPieces(
      [{ x: 3.5, y: 3.5 }, { x: 117.5, y: 3.5 }, { x: 117.5, y: 176.5 }, { x: 3.5, y: 176.5 }],
      roofs,
      96,
    )!;
    expect(ceilingHeightAt(pieces, { x: 60, y: 90 })).toBeCloseTo(96 + 93.5 / 2, 6);
    expect(ceilingHeightAt(pieces, { x: 60, y: 20 })).toBeCloseTo(96 + 23.5 / 2, 6);
    // No roof over it: null (the ceiling stays flat).
    expect(slopedCeilingPieces([{ x: 1000, y: 0 }, { x: 1100, y: 0 }, { x: 1100, y: 100 }, { x: 1000, y: 100 }], roofs, 96)).toBeNull();
    // With a wing drawn into the roof (joined), the room under the valley follows both roofs.
    const wing = [{ x: 60, y: 90 }, { x: 180, y: 90 }, { x: 180, y: 400 }, { x: 60, y: 400 }];
    expect(store().addRoof(lid, { shape: 'gable', outline: wing, ridgeAngle: 90, pitch: 6, overhang: 12, bearingOffset: 0, thickness: 8, fascia: 6, phase: 'existing', finish: 'metal' })).not.toBeNull();
    store().updateRoom(lid, west, { ceilingShape: 'roof' });
    const joined = getLevelRoofs(store().plan, lid, 'existing').own;
    expect(joined.some((r) => r.join)).toBe(true);
    const net = [{ x: 3.5, y: 3.5 }, { x: 117.5, y: 3.5 }, { x: 117.5, y: 176.5 }, { x: 3.5, y: 176.5 }];
    const two = slopedCeilingPieces(net, joined, 96)!;
    // Over (110, 170) the wing's west slope is higher than the main's south slope: it is the ceiling there.
    const mainUnder = 96 + (183.5 - 170) / 2;
    const wingUnder = 96 + (110 - 60) / 2;
    expect(ceilingHeightAt(two, { x: 110, y: 170 })).toBeCloseTo(Math.max(mainUnder, wingUnder), 6);
    expect(getLevelMeshes(store().plan, lid, 'existing').ceilings.find((c) => c.roomId === west)).toBeDefined();
  });

  it('a profile capped at a height gains a station where it crosses', () => {
    expect(capProfile({ s: [0, 100], h: [96, 146] }, 120)).toEqual({ s: [0, 48, 100], h: [96, 120, 120] });
  });

  it('loads: an unknown shape and a flat top without the shape are dropped', () => {
    const doc = JSON.parse(JSON.stringify(createEmptyPlan()));
    const lid = doc.structures[doc.structureOrder[0]].levelOrder[1];
    doc.levels[lid].rooms = {
      a: { id: 'a', name: 'A', anchor: { x: 0, y: 0 }, ceilingShape: 'roof', ceilingFlatTop: 120 },
      b: { id: 'b', name: 'B', anchor: { x: 0, y: 0 }, ceilingShape: 'dome', ceilingFlatTop: 120 },
      c: { id: 'c', name: 'C', anchor: { x: 0, y: 0 }, ceilingShape: 'roof', ceilingFlatTop: -1 },
    };
    const out = migrate(doc).levels[lid].rooms;
    expect(out.a).toMatchObject({ ceilingShape: 'roof', ceilingFlatTop: 120 });
    expect(out.b.ceilingShape).toBeUndefined();
    expect(out.b.ceilingFlatTop).toBeUndefined();
    expect(out.c.ceilingShape).toBe('roof');
    expect(out.c.ceilingFlatTop).toBeUndefined();
  });
});
