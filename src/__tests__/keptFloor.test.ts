import { beforeEach, describe, expect, it } from 'vitest';
import { clearMeshCache, getLevelMeshes, triangleCount } from '../derive/meshes';
import { getFaces } from '../derive/rooms';
import { openRooms } from '../derive/openRooms';
import { createEmptyPlan, defaultLevelId } from '../model/plan';
import type { Phase, Vec2 } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';

const store = () => usePlanStore.getState();
const plan = () => store().plan;
const lid = () => defaultLevelId(plan());
const wall = (a: Vec2, b: Vec2, phase: Phase = 'existing') => store().addWall(lid(), a, b, { kind: 'exterior', thickness: 6, phase });
const wallAt = (x: number, y: number) =>
  Object.values(plan().levels[lid()].walls).find((w) => {
    const l = plan().levels[lid()];
    const a = l.nodes[w.a];
    const b = l.nodes[w.b];
    return Math.min(a.x, b.x) <= x && x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= y && y <= Math.max(a.y, b.y);
  })!;

beforeEach(() => {
  store().setPlan(createEmptyPlan('Kept floor', 'single'));
  clearHistory();
  clearMeshCache();
  const c = [
    { x: 0, y: 0 },
    { x: 240, y: 0 },
    { x: 240, y: 180 },
    { x: 0, y: 180 },
  ];
  c.forEach((p, i) => wall(p, c[(i + 1) % 4]));
  const room = store().addRoom(lid(), { name: 'Living', anchor: { x: 120, y: 90 } })!;
  store().updateRoom(lid(), room, { floorFinish: 'boards', proposedFloor: { finish: 'tile' } });
});

describe('a floor opened by demolition', () => {
  it('keeps the existing slab and the room floor (its proposed finish) in Proposed when an exterior wall is taken out', () => {
    const before = getLevelMeshes(plan(), lid(), 'proposed');
    expect(before.floor).toBeDefined();
    expect(before.keptFloor).toBeUndefined();
    store().setPhase(lid(), { walls: [wallAt(240, 90).id], openings: [] }, 'demo');
    // The view finds no closed outline any more.
    expect(getFaces(plan().levels[lid()], 'proposed').outerFaces).toHaveLength(0);
    const after = getLevelMeshes(plan(), lid(), 'proposed');
    expect(after.floor).toBeUndefined();
    expect(after.keptFloor && triangleCount(after.keptFloor)).toBeGreaterThan(0);
    expect(after.floorFinishes.map((f) => f.finish)).toEqual(['tile']);
    // Existing and All are as they were: the wall closes the room there.
    expect(getLevelMeshes(plan(), lid(), 'existing').keptFloor).toBeUndefined();
    expect(getLevelMeshes(plan(), lid(), 'all').keptFloor).toBeUndefined();
  });

  it('a new addition that closes the room again takes over: nothing is kept twice', () => {
    store().setPhase(lid(), { walls: [wallAt(240, 90).id], openings: [] }, 'demo');
    wall({ x: 240, y: 0 }, { x: 360, y: 0 }, 'new');
    wall({ x: 360, y: 0 }, { x: 360, y: 180 }, 'new');
    wall({ x: 360, y: 180 }, { x: 240, y: 180 }, 'new');
    const m = getLevelMeshes(plan(), lid(), 'proposed');
    expect(m.keptFloor).toBeUndefined();
    expect(m.floorFinishes.map((f) => f.finish)).toEqual(['tile']);
  });

  it('keeps the room: its label point, the area of the floor it keeps, and its ceiling', () => {
    const room = Object.keys(plan().levels[lid()].rooms)[0];
    store().updateRoom(lid(), room, { ceilingFinish: 'boards' });
    expect(getLevelMeshes(plan(), lid(), 'proposed').ceilings.map((c) => c.roomId)).toEqual([room]);
    expect(openRooms(plan().levels[lid()], 'proposed')).toEqual([]);
    store().setPhase(lid(), { walls: [wallAt(240, 90).id], openings: [] }, 'demo');
    const level = plan().levels[lid()];
    // An orphan in the view's faces, but open: the floor inside the old wall faces, 234" x 174".
    expect(getFaces(level, 'proposed').orphanRoomIds).toEqual([room]);
    const [open] = openRooms(level, 'proposed');
    expect(open.roomId).toBe(room);
    expect(open.area).toBeCloseTo(234 * 174, 6);
    expect(open.labelPoint).toEqual({ x: 120, y: 90 });
    // Not in Existing, where the wall still closes it.
    expect(openRooms(level, 'existing')).toEqual([]);
    const m = getLevelMeshes(plan(), lid(), 'proposed');
    expect(m.ceilings.map((c) => [c.roomId, c.finish])).toEqual([[room, 'boards']]);
    expect(triangleCount(m.ceilings[0].geometry)).toBeGreaterThan(0);
    // Closed again by a new addition: a room of the view again, nothing open.
    wall({ x: 240, y: 0 }, { x: 360, y: 0 }, 'new');
    wall({ x: 360, y: 0 }, { x: 360, y: 180 }, 'new');
    wall({ x: 360, y: 180 }, { x: 240, y: 180 }, 'new');
    expect(openRooms(plan().levels[lid()], 'proposed')).toEqual([]);
  });
});
