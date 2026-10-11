import { beforeEach, describe, expect, it } from 'vitest';
import example from '../../docs/examples/146-mick-road.json';
import { faceOfRoom, getFaces, roomDimensions } from '../derive/rooms';
import { dispatchKey } from '../editor2d/tools';
import { createEmptyPlan, defaultLevelId, migrate, WALL_OVERLAP_MESSAGE } from '../model/plan';
import { nudgeShifts, ODD_CORNER_MESSAGE, OFFSET_COLLAPSE_MESSAGE, planWallOffset } from '../model/offset';
import type { Id, Level, Vec2 } from '../model/types';
import { clearHistory, undo, usePlanStore } from '../store/planStore';
import { EMPTY_SELECTION, useUiStore } from '../store/uiStore';
import { runWallMove, wallSideNames } from '../ui/wallMove';

const store = () => usePlanStore.getState();
const ui = () => useUiStore.getState();
const ext = { kind: 'exterior', thickness: 6, phase: 'existing' } as const;
const int = { kind: 'interior', thickness: 4, phase: 'existing' } as const;

let lid: Id;
const level = (): Level => store().plan.levels[lid];
const wallAt = (a: Vec2, b: Vec2): Id => {
  const l = level();
  const hit = Object.values(l.walls).find((w) => {
    const p = l.nodes[w.a];
    const q = l.nodes[w.b];
    const same = (u: Vec2, v: Vec2) => Math.abs(u.x - v.x) < 1e-6 && Math.abs(u.y - v.y) < 1e-6;
    return (same(p, a) && same(q, b)) || (same(p, b) && same(q, a));
  });
  if (!hit) throw new Error(`no wall ${JSON.stringify([a, b])}`);
  return hit.id;
};
const roomSize = (name: string) => {
  const l = level();
  const room = Object.values(l.rooms).find((r) => r.name.startsWith(name))!;
  return roomDimensions(faceOfRoom(getFaces(l, 'all'), room.id)!.netPolygon).rect!;
};

/** A 240 x 180 box (6" exterior) split by a 4" partition at x = 120, rooms named West and East. */
function boxWithPartition(): void {
  const pts = [
    { x: 0, y: 0 },
    { x: 240, y: 0 },
    { x: 240, y: 180 },
    { x: 0, y: 180 },
  ];
  pts.forEach((p, i) => store().addWall(lid, p, pts[(i + 1) % 4], ext));
  store().addWall(lid, { x: 120, y: 0 }, { x: 120, y: 180 }, int);
  store().addRoom(lid, { name: 'West', anchor: { x: 60, y: 90 } });
  store().addRoom(lid, { name: 'East', anchor: { x: 180, y: 90 } });
}

beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
  lid = defaultLevelId(store().plan);
  ui().setActiveLevel(lid);
  ui().setViewMode('all');
  ui().setViewport({ tx: 0, ty: 0, k: 1 });
});

describe('offsetWalls: a partition (REVIEW-2 B1)', () => {
  it('moves the Kitchen/Living partition 6" toward Living: both rooms change by exactly 6"', () => {
    store().setPlan(migrate(example));
    clearHistory();
    lid = store().plan.levelOrder[1];
    const kitchen = roomSize('Kitchen');
    const living = roomSize('Living');
    expect([kitchen.width, living.width]).toEqual([138, 161]);
    const partition = 'f-w16';
    // The partition runs up the screen (a at the south wall): its left side is the Living.
    expect(wallSideNames(level(), getFaces(level(), 'all'), level().walls[partition]).left).toBe('Living');
    const before = usePlanStore.temporal.getState().pastStates.length;
    expect(store().offsetWalls(lid, [partition], 6, 'left')).toBeNull();
    expect(usePlanStore.temporal.getState().pastStates.length).toBe(before + 1);
    expect(roomSize('Kitchen')).toEqual({ width: 144, depth: kitchen.depth });
    expect(roomSize('Living')).toEqual({ width: 155, depth: living.depth });
    // The collinear piece past the Stair moved with it; the south wall and the Stair wall stayed straight.
    const l = level();
    const xs = Object.values(l.walls)
      .filter((w) => l.nodes[w.a].x === l.nodes[w.b].x && l.nodes[w.a].x > 150 && l.nodes[w.a].x < 180)
      .map((w) => l.nodes[w.a].x);
    expect(new Set(xs)).toEqual(new Set([164.5]));
    // Every wall is still straight along x or y (the south wall and the Stair wall stretched, not bent).
    expect(Object.values(l.walls).every((w) => l.nodes[w.a].x === l.nodes[w.b].x || l.nodes[w.a].y === l.nodes[w.b].y)).toBe(true);
    undo();
    expect(roomSize('Kitchen').width).toBe(138);
  });

  it('reports the new net sizes of the rooms either side in the status bar', () => {
    store().setPlan(migrate(example));
    lid = store().plan.levelOrder[1];
    ui().setActiveLevel(lid);
    const problem = runWallMove(lid, 'f-w16', () => store().offsetWalls(lid, ['f-w16'], 6, 'left'), 'Moved the wall 6" toward Living');
    expect(problem).toBeNull();
    expect(ui().draft.message).toBe(`Moved the wall 6" toward Living. Now Living 12'-11" x 14'-0", Kitchen (17'2" adjusted: re-measure) 12'-0" x 17'-2".`);
  });

  it('moves a partition in a box and keeps openings at their offset from the a end', () => {
    boxWithPartition();
    const id = wallAt({ x: 120, y: 0 }, { x: 120, y: 180 });
    const wall = level().walls[id];
    store().addOpening(lid, { wallId: id, type: 'passage', offset: 60, width: 30, height: 80, sill: 0, phase: 'existing' });
    const side = level().nodes[wall.a].y === 0 ? 'right' : 'left'; // toward West (-x)
    expect(store().offsetWalls(lid, [id], 10, side)).toBeNull();
    // Faces: exterior at 3 and 237, the partition's at 118 and 122; it moves 10" west.
    expect(roomSize('West').width).toBe(105);
    expect(roomSize('East').width).toBe(125);
    expect(Object.values(level().openings)[0].offset).toBe(60);
  });
});

describe('offsetWalls: an exterior wall', () => {
  it('keeps the adjacent exterior walls straight and the corners square; the partition stretches', () => {
    boxWithPartition();
    const south = wallAt({ x: 0, y: 180 }, { x: 120, y: 180 });
    const w = level().walls[south];
    // Toward +y (outside): the side whose normal points down the screen.
    const a = level().nodes[w.a];
    const side = a.x < level().nodes[w.b].x ? 'right' : 'left';
    const west = level().walls[wallAt({ x: 0, y: 0 }, { x: 0, y: 180 })];
    store().addOpening(lid, { wallId: west.id, type: 'window', offset: 60, width: 30, height: 40, sill: 30, phase: 'existing' });
    const windowY = () => {
      const l = level();
      const o = Object.values(l.openings)[0];
      const wl = l.walls[o.wallId];
      const p = l.nodes[wl.a];
      const q = l.nodes[wl.b];
      return p.y + ((q.y - p.y) / Math.abs(q.y - p.y)) * o.offset;
    };
    const y0 = windowY();
    expect(store().offsetWalls(lid, [south], 12, side)).toBeNull();
    const l = level();
    // The whole south line moved (both halves), straight and square.
    const southYs = new Set(Object.values(l.walls).flatMap((x) => [l.nodes[x.a], l.nodes[x.b]]).filter((p) => p.y > 100).map((p) => p.y));
    expect(southYs).toEqual(new Set([192]));
    for (const x of Object.values(l.walls)) {
      const p = l.nodes[x.a];
      const q = l.nodes[x.b];
      expect(p.x === q.x || p.y === q.y).toBe(true);
    }
    expect(roomSize('West')).toEqual({ width: 115, depth: 186 });
    expect(roomSize('East')).toEqual({ width: 115, depth: 186 });
    // The west wall's window stays where it was on the plan (its distance from the fixed end).
    expect(windowY()).toBe(y0);
  });

  it('moves two walls meeting at a corner to the crossing of their new lines', () => {
    boxWithPartition();
    const east = wallAt({ x: 240, y: 0 }, { x: 240, y: 180 });
    const north = [wallAt({ x: 0, y: 0 }, { x: 120, y: 0 }), wallAt({ x: 120, y: 0 }, { x: 240, y: 0 })];
    const plan = planWallOffset(level(), new Map([
      [east, { x: 10, y: 0 }],
      [north[1], { x: 0, y: -5 }],
    ]));
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    const corner = Object.entries(plan.positions).find(([id]) => level().nodes[id].x === 240 && level().nodes[id].y === 0)!;
    expect(corner[1]).toEqual({ x: 250, y: -5 });
  });
});

describe('offsetWalls: refusals', () => {
  it('refuses a corner whose other walls disagree (odd angles)', () => {
    store().addWall(lid, { x: 0, y: 0 }, { x: 100, y: 0 }, ext);
    store().addWall(lid, { x: 100, y: 0 }, { x: 100, y: 100 }, ext);
    store().addWall(lid, { x: 100, y: 0 }, { x: 170, y: 70 }, ext);
    const before = store().plan;
    expect(store().offsetWalls(lid, [wallAt({ x: 0, y: 0 }, { x: 100, y: 0 })], 10, 'right')).toBe(ODD_CORNER_MESSAGE);
    expect(store().plan).toBe(before);
  });

  it('refuses a move that lays the wall on top of another (batch A guard)', () => {
    store().addWall(lid, { x: 0, y: 0 }, { x: 100, y: 0 }, ext);
    store().addWall(lid, { x: 0, y: 20 }, { x: 100, y: 20 }, ext);
    const before = store().plan;
    // a->b is +x, so its right side is +y (down the screen), toward the other wall.
    expect(store().offsetWalls(lid, [wallAt({ x: 0, y: 0 }, { x: 100, y: 0 })], 20, 'right')).toBe(WALL_OVERLAP_MESSAGE);
    expect(store().plan).toBe(before);
    expect(store().offsetWalls(lid, [wallAt({ x: 0, y: 0 }, { x: 100, y: 0 })], 19, 'right')).toBeNull();
  });

  it('refuses a move past the end of a wall it slides along', () => {
    boxWithPartition();
    const id = wallAt({ x: 120, y: 0 }, { x: 120, y: 180 });
    const toEast = level().nodes[level().walls[id].a].y === 0 ? 'left' : 'right';
    const before = store().plan;
    expect(store().offsetWalls(lid, [id], 130, toEast)).toBe(OFFSET_COLLAPSE_MESSAGE);
    expect(store().plan).toBe(before);
  });

  it('rejects a distance that is not positive', () => {
    boxWithPartition();
    expect(store().offsetWalls(lid, [wallAt({ x: 120, y: 0 }, { x: 120, y: 180 })], 0, 'left')).toBe('Must be greater than 0.');
  });
});

describe('Shift+arrows nudge the selected walls', () => {
  const press = (key: string, shiftKey = true) => dispatchKey({ key, shiftKey, ctrlKey: false, metaKey: false, altKey: false } as KeyboardEvent);

  it('moves a selected wall 1" the way the arrow points, one undo step per press', () => {
    boxWithPartition();
    ui().setTool('select');
    const id = wallAt({ x: 120, y: 0 }, { x: 120, y: 180 });
    ui().setSelection({ ...EMPTY_SELECTION, walls: [id] });
    expect(press('ArrowRight')).toBe(true);
    expect(roomSize('West').width).toBe(116);
    expect(ui().draft.message).toMatch(/^Moved the wall 1" east\. Now /);
    press('ArrowLeft');
    press('ArrowLeft');
    expect(roomSize('West').width).toBe(114);
    undo();
    expect(roomSize('West').width).toBe(115);
    // An arrow along the wall does nothing and says so.
    const plan = store().plan;
    expect(press('ArrowUp')).toBe(true);
    expect(store().plan).toBe(plan);
    expect(ui().draft.message).toMatch(/runs north-south/);
    // Without Shift, or with no wall selected, the arrows are not taken.
    expect(press('ArrowRight', false)).toBe(false);
    ui().clearSelection();
    expect(press('ArrowRight')).toBe(false);
  });

  it('nudgeShifts maps the arrow to each wall side by dot product', () => {
    boxWithPartition();
    const v = wallAt({ x: 120, y: 0 }, { x: 120, y: 180 });
    const h = wallAt({ x: 0, y: 0 }, { x: 120, y: 0 });
    const s = nudgeShifts(level(), [v, h], { x: 0, y: 1 }, 1);
    expect([...s.keys()]).toEqual([h]);
    expect(s.get(h)).toEqual({ x: 0, y: 1 });
  });
});
