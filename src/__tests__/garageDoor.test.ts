import { describe, expect, it } from 'vitest';
import { openingSymbol, type WallGeom } from '../derive/openings';
import { openingFill, overheadSections } from '../derive/openings3d';
import { getLevelMeshes } from '../derive/meshes';
import { isOverheadDoor, isSlidingDoor, isSwingDoor, leafColorOf, OVERHEAD_DOOR_COLOR, OVERHEAD_DOOR_SIZES } from '../model/finish';
import { createEmptyPlan, migrate } from '../model/plan';
import { addStructureTo } from '../model/structureOps';
import type { Plan } from '../model/types';
import { wallObstacles } from '../view3d/walk';

const g: WallGeom = { a: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, normal: { x: 0, y: -1 }, thickness: 6, length: 300, s0: 0, s1: 300 };

describe('overhead garage doors', () => {
  it('is a door style: no swing, not sliding, white by default, 9\' x 7\' and 16\' x 7\'', () => {
    const o = { type: 'door' as const, sliding: true, overhead: true };
    expect(isOverheadDoor(o)).toBe(true);
    expect(isSlidingDoor(o)).toBe(false);
    expect(isSwingDoor(o)).toBe(false);
    expect(isOverheadDoor({ type: 'window', overhead: true })).toBe(false);
    expect(leafColorOf({ type: 'door', overhead: true })).toBe(OVERHEAD_DOOR_COLOR);
    expect(leafColorOf({ type: 'door', overhead: true, leafColor: '#112233' })).toBe('#112233');
    expect(OVERHEAD_DOOR_SIZES.single).toEqual({ width: 108, height: 84 });
    expect(OVERHEAD_DOOR_SIZES.double).toEqual({ width: 192, height: 84 });
  });

  it('draws a closed panel across the hole on the plan, without a leaf or a swing arc', () => {
    const sym = openingSymbol(g, { type: 'door', offset: 150, width: 192, swing: { hinge: 'a', side: 'left' }, overhead: true });
    expect(sym.arcs).toEqual([]);
    expect(sym.leaves).toEqual([]);
    expect(sym.lines).toHaveLength(2);
    for (const [a, b] of sym.lines) {
      expect(Math.abs(b.x - a.x)).toBeCloseTo(192, 6);
      expect(Math.abs(a.y)).toBeLessThan(3);
    }
  });

  it('is sectional panels in 3D: about 21" sections, recessed panels in rows', () => {
    expect(overheadSections(0, 82.5)).toHaveLength(4);
    const boxes = openingFill({ type: 'door', j0: 0, j1: 192, bottom: 0, top: 84, thickness: 6, overhead: true });
    expect(boxes.some((b) => b.kind === 'glass' || b.kind === 'muntin')).toBe(false);
    const panels = boxes.filter((b) => b.kind === 'panel' && b.s1 - b.s0 < 100);
    // 8 panels across a 16' door (about 24" each), in each of 4 sections.
    expect(panels).toHaveLength(32);
    // Grooves between the sections: 3, the full width.
    expect(boxes.filter((b) => b.kind === 'panel' && b.s1 - b.s0 > 100)).toHaveLength(3);
    // Everything stays in the hole and the wall.
    for (const b of boxes.filter((x) => x.part === 'leaf')) {
      expect(b.s0).toBeGreaterThanOrEqual(0);
      expect(b.s1).toBeLessThanOrEqual(192);
      expect(b.y1).toBeLessThanOrEqual(84);
      expect(Math.abs(b.d0)).toBeLessThanOrEqual(3);
    }
  });

  it('is kept by migrate on a door only, and only as true', () => {
    const plan = createEmptyPlan('G', 'outbuilding');
    const s = addStructureTo(plan, { kind: 'garage', origin: { x: 0, y: 0 } });
    const level = plan.levels[s.levelOrder[0]];
    const door = Object.values(level.openings)[0];
    const doc = JSON.parse(JSON.stringify(plan));
    const lv = doc.levels[level.id];
    lv.openings.w = { ...door, id: 'w', type: 'window', overhead: true, sill: 12, height: 24, offset: 40, width: 24 };
    lv.openings.f = { ...door, id: 'f', overhead: false, offset: 40, width: 24 };
    const back = migrate(doc).levels[level.id].openings;
    expect(back[door.id].overhead).toBe(true);
    expect(back.w.overhead).toBeUndefined();
    expect(back.f.overhead).toBeUndefined();
  });

  it('the garage preset has one in front, in an 8\' wall, drawn in 3D and walked through like any door', () => {
    const plan: Plan = createEmptyPlan('G', 'outbuilding');
    const s = addStructureTo(plan, { kind: 'garage', origin: { x: 0, y: 0 } });
    const level = plan.levels[s.levelOrder[0]];
    const door = Object.values(level.openings)[0];
    expect(door).toMatchObject({ type: 'door', overhead: true, width: 192, height: 84 });
    expect(level.wallHeight).toBe(96);
    const meshes = getLevelMeshes(plan, level.id, 'proposed');
    const fill = meshes.openings.find((m) => m.id === door.id);
    expect(fill?.type).toBe('door');
    expect(fill?.leafColor).toBe(OVERHEAD_DOOR_COLOR);
    // The wall in front is open across the door for the walker.
    const front = level.walls[door.wallId];
    const obstacles = wallObstacles(plan, level.id, 'proposed', 0);
    const nodeA = level.nodes[front.a];
    const nodeB = level.nodes[front.b];
    const mid = { x: (nodeA.x + nodeB.x) / 2, y: (nodeA.y + nodeB.y) / 2 };
    const blocked = obstacles.some((o) => {
      const xs = o.poly.map((p) => p.x);
      const ys = o.poly.map((p) => p.y);
      return mid.x >= Math.min(...xs) && mid.x <= Math.max(...xs) && mid.y >= Math.min(...ys) - 1 && mid.y <= Math.max(...ys) + 1;
    });
    expect(blocked).toBe(false);
  });
});
