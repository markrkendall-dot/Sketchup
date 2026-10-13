import { beforeEach, describe, expect, it } from 'vitest';
import { getOpeningsByWall, openingSymbol, wallPieces, type WallGeom } from '../derive/openings';
import { clampOpeningOffset } from '../model/openings';
import { createEmptyPlan, defaultLevelId, wallLength } from '../model/plan';
import type { Level, Opening, Vec2 } from '../model/types';
import { clearHistory, undo, usePlanStore, type NewOpening } from '../store/planStore';

const opts = { kind: 'exterior', thickness: 6.5, phase: 'existing' } as const;
const store = () => usePlanStore.getState();
const levelId = () => defaultLevelId(store().plan);
const level = (): Level => store().plan.levels[levelId()];
const walls = () => Object.values(level().walls);
const openings = () => Object.values(level().openings);

const door = (wallId: string, offset: number, extra: Partial<NewOpening> = {}): NewOpening => ({
  wallId,
  type: 'door',
  offset,
  width: 36,
  height: 80,
  sill: 0,
  phase: 'existing',
  swing: { hinge: 'a', side: 'left' },
  ...extra,
});

/** World position of an opening's center. */
function centerOf(o: Opening): Vec2 {
  const l = level();
  const w = l.walls[o.wallId];
  const a = l.nodes[w.a];
  const b = l.nodes[w.b];
  const len = wallLength(l, w);
  return { x: a.x + ((b.x - a.x) * o.offset) / len, y: a.y + ((b.y - a.y) * o.offset) / len };
}

function addStraightWall(x0: number, x1: number): string {
  return store().addWall(levelId(), { x: x0, y: 0 }, { x: x1, y: 0 }, opts)!.wallIds[0];
}

beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
});

describe('clampOpeningOffset', () => {
  it('clamps the center to [s0 + w/2, s1 - w/2]', () => {
    expect(clampOpeningOffset(5, 36, 0, 120)).toBe(18);
    expect(clampOpeningOffset(200, 36, 0, 120)).toBe(102);
    expect(clampOpeningOffset(60, 36, 0, 120)).toBe(60);
    expect(clampOpeningOffset(60, 36, 10, 110)).toBe(60);
    expect(clampOpeningOffset(0, 36, 10, 110)).toBe(28);
  });
  it('centers an opening wider than the interval', () => {
    expect(clampOpeningOffset(5, 50, 0, 40)).toBe(20);
  });
});

describe('addOpening', () => {
  it('adds with a new id and clamps the offset', () => {
    const w = addStraightWall(0, 120);
    const id = store().addOpening(levelId(), door(w, 5))!;
    expect(id).toBeTruthy();
    expect(level().openings[id].offset).toBe(18);
    const id2 = store().addOpening(levelId(), door(w, 500))!;
    expect(level().openings[id2].offset).toBe(102);
  });

  it('rejects openings that do not fit or reference nothing, without an undo step', () => {
    const w = addStraightWall(0, 120);
    const past = usePlanStore.temporal.getState().pastStates.length;
    expect(store().addOpening(levelId(), door(w, 60, { width: 130 }))).toBeNull();
    expect(store().addOpening(levelId(), door('nope', 60))).toBeNull();
    expect(store().addOpening(levelId(), door(w, 60, { width: 0 }))).toBeNull();
    expect(store().addOpening(levelId(), door(w, Number.NaN))).toBeNull();
    expect(openings()).toHaveLength(0);
    expect(usePlanStore.temporal.getState().pastStates.length).toBe(past);
  });

  it('drops swing data from non-doors', () => {
    const w = addStraightWall(0, 120);
    const id = store().addOpening(levelId(), door(w, 60, { type: 'window', sill: 36, height: 48 }))!;
    expect(level().openings[id].swing).toBeUndefined();
  });

  it('is one undo step', () => {
    const w = addStraightWall(0, 120);
    store().addOpening(levelId(), door(w, 60));
    undo();
    expect(openings()).toHaveLength(0);
    expect(walls()).toHaveLength(1);
  });
});

describe('openings clamp to the core interval between corners (M3)', () => {
  it('addOpening and updateOpening keep jambs off the mitred corner', () => {
    const r1 = store().addWall(levelId(), { x: 0, y: 0 }, { x: 120, y: 0 }, opts)!;
    store().addWall(levelId(), r1.b, { x: 120, y: 120 }, opts);
    const w = r1.wallIds[0];
    const id = store().addOpening(levelId(), door(w, 500))!;
    // s1 = 120 - 3.25 (inside face of the 6.5" corner wall).
    expect(level().openings[id].offset).toBe(116.75 - 18);
    store().updateOpening(levelId(), id, { offset: 0 });
    expect(level().openings[id].offset).toBe(18);
  });

  it('a thicker corner wall pushes an opening back', () => {
    const r1 = store().addWall(levelId(), { x: 0, y: 0 }, { x: 120, y: 0 }, opts)!;
    const r2 = store().addWall(levelId(), r1.b, { x: 120, y: 120 }, opts)!;
    const id = store().addOpening(levelId(), door(r1.wallIds[0], 120))!;
    expect(level().openings[id].offset).toBe(116.75 - 18);
    store().updateWalls(levelId(), r2.wallIds, { thickness: 12 });
    expect(level().openings[id].offset).toBe(114 - 18);
  });

  it('a new opening only has to clear corners of the proposed view', () => {
    const r1 = store().addWall(levelId(), { x: 0, y: 0 }, { x: 120, y: 0 }, opts)!;
    store().addWall(levelId(), r1.b, { x: 120, y: 120 }, { ...opts, phase: 'demo' });
    const w = r1.wallIds[0];
    const oldId = store().addOpening(levelId(), door(w, 500))!;
    const newId = store().addOpening(levelId(), door(w, 500, { phase: 'new' }))!;
    expect(level().openings[oldId].offset).toBe(116.75 - 18);
    expect(level().openings[newId].offset).toBe(120 - 18);
  });
});

describe('updateOpening', () => {
  it('re-clamps after a move or a width change', () => {
    const w = addStraightWall(0, 120);
    const id = store().addOpening(levelId(), door(w, 60))!;
    store().updateOpening(levelId(), id, { offset: 119 });
    expect(level().openings[id].offset).toBe(102);
    store().updateOpening(levelId(), id, { width: 60 });
    expect(level().openings[id].offset).toBe(90);
  });

  it('undefined clears only optional fields', () => {
    const w = addStraightWall(0, 120);
    const id = store().addOpening(levelId(), door(w, 60))!;
    store().updateOpening(levelId(), id, { phase: undefined, swing: undefined });
    expect(level().openings[id].phase).toBe('existing');
    expect(level().openings[id].swing).toBeUndefined();
    store().updateWalls(levelId(), [w], { heightOverride: 100 });
    store().updateWalls(levelId(), [w], { heightOverride: undefined, kind: undefined });
    expect(level().walls[w].heightOverride).toBeUndefined();
    expect(level().walls[w].kind).toBe('exterior');
  });

  it('ignores invalid patches', () => {
    const w = addStraightWall(0, 120);
    const id = store().addOpening(levelId(), door(w, 60))!;
    const before = level().openings[id];
    store().updateOpening(levelId(), id, { width: -3 });
    store().updateOpening(levelId(), id, { sill: -1 });
    expect(level().openings[id]).toBe(before);
  });
});

describe('normalizeLevel remaps opening offsets on split', () => {
  it('a node landing on a wall with an opening on each side keeps both in place', () => {
    const w = addStraightWall(0, 240);
    const left = store().addOpening(levelId(), door(w, 60))!;
    const right = store().addOpening(levelId(), door(w, 180, { type: 'window', sill: 36, height: 48 }))!;
    // A T junction at x = 120 splits the wall.
    store().addWall(levelId(), { x: 120, y: 0 }, { x: 120, y: 100 }, opts);
    expect(walls()).toHaveLength(3);
    const l = level();
    const oL = l.openings[left];
    const oR = l.openings[right];
    expect(oL.wallId).not.toBe(oR.wallId);
    expect(wallLength(l, l.walls[oL.wallId])).toBeCloseTo(120);
    expect(wallLength(l, l.walls[oR.wallId])).toBeCloseTo(120);
    expect(centerOf(oL)).toEqual({ x: 60, y: 0 });
    expect(centerOf(oR)).toEqual({ x: 180, y: 0 });
    expect(oR.offset).toBe(60);
  });

  it('works for a wall drawn right to left', () => {
    const w = addStraightWall(240, 0);
    const a = store().addOpening(levelId(), door(w, 40))!; // world x = 200
    const b = store().addOpening(levelId(), door(w, 190))!; // world x = 50
    store().addWall(levelId(), { x: 100, y: 0 }, { x: 100, y: -100 }, opts);
    expect(centerOf(level().openings[a]).x).toBeCloseTo(200);
    expect(centerOf(level().openings[b]).x).toBeCloseTo(50);
  });

  it('a node landing inside an opening clamps it onto one piece', () => {
    const w = addStraightWall(0, 240);
    const id = store().addOpening(levelId(), door(w, 125))!;
    store().addWall(levelId(), { x: 120, y: 0 }, { x: 120, y: 100 }, opts);
    const o = level().openings[id];
    const len = wallLength(level(), level().walls[o.wallId]);
    expect(o.offset).toBeGreaterThanOrEqual(18);
    expect(o.offset).toBeLessThanOrEqual(len - 18);
  });
});

describe('deletion cascade', () => {
  it('deleting a wall deletes its openings only', () => {
    const w1 = addStraightWall(0, 120);
    const w2 = store().addWall(levelId(), { x: 120, y: 0 }, { x: 120, y: 120 }, opts)!.wallIds[0];
    store().addOpening(levelId(), door(w1, 60));
    const keep = store().addOpening(levelId(), door(w2, 60))!;
    store().deleteWalls(levelId(), [w1]);
    expect(Object.keys(level().openings)).toEqual([keep]);
  });

  it('deleting a node deletes the openings of its walls', () => {
    const r = store().addWall(levelId(), { x: 0, y: 0 }, { x: 120, y: 0 }, opts)!;
    store().addOpening(levelId(), door(r.wallIds[0], 60));
    store().deleteNodes(levelId(), [r.b]);
    expect(openings()).toHaveLength(0);
  });

  it('deleteEntities removes selected openings, and walls with theirs, in one undo step', () => {
    const w1 = addStraightWall(0, 120);
    const w2 = store().addWall(levelId(), { x: 120, y: 0 }, { x: 120, y: 120 }, opts)!.wallIds[0];
    const o1 = store().addOpening(levelId(), door(w1, 60))!;
    const o2 = store().addOpening(levelId(), door(w2, 60))!;
    store().deleteEntities(levelId(), { nodes: [], walls: [], openings: [o2] });
    expect(Object.keys(level().openings)).toEqual([o1]);
    store().deleteEntities(levelId(), { nodes: [], walls: [w1], openings: [] });
    expect(openings()).toHaveLength(0);
    undo();
    expect(Object.keys(level().openings)).toEqual([o1]);
  });

  it('a wall collapsing to zero length (node merge) takes its openings with it', () => {
    const r = store().addWall(levelId(), { x: 0, y: 0 }, { x: 40, y: 0 }, opts)!;
    store().addOpening(levelId(), door(r.wallIds[0], 20));
    store().moveNode(levelId(), r.b, { x: 0.2, y: 0 });
    expect(walls()).toHaveLength(0);
    expect(openings()).toHaveLength(0);
  });
});

describe('setWallLength', () => {
  it('anchor start moves node b; openings keep their offset, then clamp', () => {
    const w = addStraightWall(0, 240);
    const near = store().addOpening(levelId(), door(w, 40))!;
    const far = store().addOpening(levelId(), door(w, 200))!;
    expect(store().setWallLength(levelId(), w, 150, 'start')).toBe(true);
    const l = level();
    expect(wallLength(l, l.walls[w])).toBeCloseTo(150);
    expect(l.nodes[l.walls[w].a]).toMatchObject({ x: 0, y: 0 });
    expect(l.openings[near].offset).toBe(40);
    expect(l.openings[far].offset).toBe(150 - 18);
  });

  it('anchor end moves node a; openings keep their distance from b, then clamp', () => {
    const w = addStraightWall(0, 240);
    const far = store().addOpening(levelId(), door(w, 200))!; // 40 from b
    const near = store().addOpening(levelId(), door(w, 30))!;
    expect(store().setWallLength(levelId(), w, 180, 'end')).toBe(true);
    const l = level();
    expect(l.nodes[l.walls[w].a]).toMatchObject({ x: 60, y: 0 });
    expect(l.nodes[l.walls[w].b]).toMatchObject({ x: 240, y: 0 });
    expect(l.openings[far].offset).toBeCloseTo(140);
    expect(centerOf(l.openings[far]).x).toBeCloseTo(200);
    // 30 - 60 = -30, clamped to the start of the wall.
    expect(l.openings[near].offset).toBe(18);
  });

  it('moves connected walls with the node and is one undo step', () => {
    const r1 = store().addWall(levelId(), { x: 0, y: 0 }, { x: 120, y: 0 }, opts)!;
    store().addWall(levelId(), r1.b, { x: 120, y: 120 }, opts);
    store().setWallLength(levelId(), r1.wallIds[0], 144);
    expect(level().nodes[r1.b]).toMatchObject({ x: 144, y: 0 });
    undo();
    expect(level().nodes[r1.b]).toMatchObject({ x: 120, y: 0 });
    expect(walls()).toHaveLength(2);
  });

  it('rejects non-positive lengths', () => {
    const w = addStraightWall(0, 120);
    expect(store().setWallLength(levelId(), w, 0)).toBe(false);
    expect(store().setWallLength(levelId(), w, -5)).toBe(false);
    expect(wallLength(level(), level().walls[w])).toBe(120);
  });

  it('dragging node a keeps openings where they are relative to b', () => {
    const r = store().addWall(levelId(), { x: 0, y: 0 }, { x: 240, y: 0 }, opts)!;
    const id = store().addOpening(levelId(), door(r.wallIds[0], 200))!;
    store().moveNode(levelId(), r.a, { x: 48, y: 0 });
    expect(centerOf(level().openings[id]).x).toBeCloseTo(200);
  });
});

describe('wall kind, phase and copy', () => {
  it('changing kind swaps a default thickness but keeps a customized one', () => {
    const a = addStraightWall(0, 120);
    const b = store().addWall(levelId(), { x: 0, y: 50 }, { x: 120, y: 50 }, opts)!.wallIds[0];
    store().updateWalls(levelId(), [b], { thickness: 8 });
    store().setWallKind(levelId(), [a, b], 'interior');
    expect(level().walls[a]).toMatchObject({ kind: 'interior', thickness: 4.5 });
    expect(level().walls[b]).toMatchObject({ kind: 'interior', thickness: 8 });
  });

  it('setPhase marks walls and openings together', () => {
    const w = addStraightWall(0, 120);
    const o = store().addOpening(levelId(), door(w, 60))!;
    store().setPhase(levelId(), { walls: [w], openings: [o] }, 'demo');
    expect(level().walls[w].phase).toBe('demo');
    expect(level().openings[o].phase).toBe('demo');
  });

  it('copyWallsFromLevel copies nodes and walls but not openings, as one undo step', () => {
    const plan = store().plan;
    const [, first, second] = plan.levelOrder;
    const rect: Vec2[] = [
      { x: 0, y: 0 },
      { x: 360, y: 0 },
      { x: 360, y: 480 },
      { x: 0, y: 480 },
    ];
    rect.forEach((p, i) => store().addWall(first, p, rect[(i + 1) % 4], opts));
    const w0 = Object.keys(store().plan.levels[first].walls)[0];
    store().addOpening(first, door(w0, 60));
    store().updateWalls(first, [w0], { heightOverride: 100 });
    expect(store().copyWallsFromLevel(first, second)).toEqual({ copied: 4, skipped: 0 });
    const up = store().plan.levels[second];
    const down = store().plan.levels[first];
    expect(Object.keys(up.walls)).toHaveLength(4);
    expect(Object.keys(up.nodes)).toHaveLength(4);
    expect(up.openings).toEqual({});
    expect(Object.keys(up.walls).some((id) => id in down.walls)).toBe(false);
    expect(Object.values(up.walls).every((w) => w.heightOverride === undefined)).toBe(true);
    // Copying again merges onto the identical walls instead of duplicating them.
    store().copyWallsFromLevel(first, second);
    expect(Object.keys(store().plan.levels[second].walls)).toHaveLength(4);
    undo();
    undo();
    expect(store().plan.levels[second].walls).toEqual({});
  });
});

describe('opening geometry', () => {
  const g: WallGeom = { a: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, normal: { x: 0, y: -1 }, thickness: 6, length: 120, s0: 0, s1: 120 };
  const quad = [
    { x: 0, y: -3 },
    { x: 120, y: -3 },
    { x: 120, y: 3 },
    { x: 0, y: 3 },
  ] as const;

  it('a door swings from the hinge jamb on its side with radius = width', () => {
    const sym = openingSymbol(g, { type: 'door', offset: 60, width: 36, swing: { hinge: 'a', side: 'left' } });
    expect([sym.j0, sym.j1]).toEqual([42, 78]);
    // Left of a->b along +x is -y on the plan.
    expect(sym.leaf).toEqual([
      { x: 42, y: -3 },
      { x: 42, y: -39 },
    ]);
    expect(sym.arc).toMatchObject({ from: { x: 42, y: -39 }, to: { x: 78, y: -3 }, r: 36 });
    const right = openingSymbol(g, { type: 'door', offset: 60, width: 36, swing: { hinge: 'b', side: 'right' } });
    expect(right.leaf![0]).toEqual({ x: 78, y: 3 });
    expect(right.leaf![1]).toEqual({ x: 78, y: 39 });
  });

  it('a sliding door: two panels a third of the way out either side of the centerline, overlapping 2" at the middle; no leaf or swing', () => {
    const sym = openingSymbol(g, { type: 'door', offset: 60, width: 72, swing: { hinge: 'a', side: 'left' }, sliding: true });
    expect([sym.j0, sym.j1]).toEqual([24, 96]);
    expect([sym.leaf, sym.arc]).toEqual([null, null]);
    // Left of a->b along +x is -y on the plan; the wall is 6" thick, so the tracks are 1" out.
    expect(sym.lines).toEqual([
      [
        { x: 24, y: -1 },
        { x: 61, y: -1 },
      ],
      [
        { x: 59, y: 1 },
        { x: 96, y: 1 },
      ],
    ]);
    // On a window the flag means nothing: its three lines.
    expect(openingSymbol(g, { type: 'window', offset: 60, width: 36, sliding: true }).lines).toHaveLength(3);
  });

  it('wall pieces leave a gap closed by jamb lines', () => {
    const p = wallPieces(g, quad, [
      [42, 78],
      [90, 100],
    ]);
    expect(p.fills).toHaveLength(3);
    expect(p.gaps).toEqual([
      [42, 78],
      [90, 100],
    ]);
    // 3 pieces x 2 long edges + 2 jambs per gap.
    expect(p.edges).toHaveLength(10);
    expect(p.edges).toContainEqual([
      { x: 42, y: -3 },
      { x: 42, y: 3 },
    ]);
  });

  it('overlapping gaps merge', () => {
    expect(wallPieces(g, quad, [[10, 50], [40, 60]]).gaps).toEqual([[10, 60]]);
  });

  it('getOpeningsByWall keeps list identity for untouched walls', () => {
    const w1 = addStraightWall(0, 120);
    const w2 = store().addWall(levelId(), { x: 0, y: 50 }, { x: 120, y: 50 }, opts)!.wallIds[0];
    store().addOpening(levelId(), door(w1, 60));
    const o2 = store().addOpening(levelId(), door(w2, 60))!;
    const before = getOpeningsByWall(level());
    store().updateOpening(levelId(), o2, { offset: 30 });
    const after = getOpeningsByWall(level());
    expect(after).not.toBe(before);
    expect(after.get(w1)).toBe(before.get(w1));
    expect(after.get(w2)).not.toBe(before.get(w2));
  });
});

describe('opening height limits', () => {
  it('rejects an opening taller than the wall, level height or wall override', () => {
    const w = addStraightWall(0, 240);
    // Level wall height is 96.
    expect(store().addOpening(levelId(), door(w, 60, { height: 240 }))).toBeNull();
    expect(store().addOpening(levelId(), door(w, 60, { height: 80, sill: 20 }))).toBeNull();
    expect(openings()).toHaveLength(0);
    expect(store().addOpening(levelId(), door(w, 60, { height: 96 }))).not.toBeNull();
    store().updateWalls(levelId(), [w], { heightOverride: 72 });
    // The override clamped the 96" door.
    expect(openings()[0].height).toBe(72);
    expect(store().addOpening(levelId(), door(w, 150, { height: 80 }))).toBeNull();
    expect(store().addOpening(levelId(), door(w, 150, { height: 72 }))).not.toBeNull();
  });

  it('rejects a taller update without an undo step, and accepts one that fits', () => {
    const w = addStraightWall(0, 240);
    const id = store().addOpening(levelId(), door(w, 60))!;
    const plan = store().plan;
    store().updateOpening(levelId(), id, { height: 240 });
    expect(store().plan).toBe(plan);
    store().updateOpening(levelId(), id, { sill: 20 });
    expect(store().plan).toBe(plan);
    store().updateOpening(levelId(), id, { sill: 16, height: 80 });
    expect(level().openings[id]).toMatchObject({ sill: 16, height: 80 });
  });

  it('other edits to an already too tall opening still work', () => {
    const w = addStraightWall(0, 240);
    const id = store().addOpening(levelId(), door(w, 60))!;
    usePlanStore.setState((s) => {
      s.plan.levels[levelId()].openings[id].height = 200;
    });
    store().updateOpening(levelId(), id, { width: 30 });
    expect(level().openings[id]).toMatchObject({ width: 30, height: 200 });
  });

  it('lowering the level wall height pulls openings down with it', () => {
    const w = addStraightWall(0, 480);
    const d = store().addOpening(levelId(), door(w, 60))!;
    const win = store().addOpening(levelId(), { ...door(w, 200), type: 'window', height: 48, sill: 36, swing: undefined })!;
    const high = store().addOpening(levelId(), { ...door(w, 340), type: 'window', height: 20, sill: 70, swing: undefined })!;
    store().updateLevel(levelId(), { wallHeight: 84 });
    expect(level().openings[d]).toMatchObject({ sill: 0, height: 80 });
    expect(level().openings[win]).toMatchObject({ sill: 36, height: 48 });
    // Sill 70 leaves 14" above it: shortened.
    expect(level().openings[high]).toMatchObject({ sill: 70, height: 14 });
    store().updateLevel(levelId(), { wallHeight: 60 });
    expect(level().openings[d]).toMatchObject({ sill: 0, height: 60 });
    expect(level().openings[win]).toMatchObject({ sill: 36, height: 24 });
    // Sill 70 is now within 12" of the top (or above it): the opening keeps 14" and drops its sill.
    expect(level().openings[high]).toMatchObject({ sill: 46, height: 14 });
    for (const o of openings()) expect(o.sill + o.height).toBeLessThanOrEqual(60);
    undo();
    expect(level().openings[d].height).toBe(80);
  });

  it('a wall with its own height ignores the level change; updateWall clamps too', () => {
    const w = addStraightWall(0, 240);
    store().updateWalls(levelId(), [w], { heightOverride: 120 });
    const id = store().addOpening(levelId(), door(w, 60, { height: 110 }))!;
    store().updateLevel(levelId(), { wallHeight: 72 });
    expect(level().openings[id].height).toBe(110);
    store().updateWall(levelId(), w, { heightOverride: 90 });
    expect(level().openings[id].height).toBe(90);
    // Clearing the override falls back to the level height.
    store().updateWalls(levelId(), [w], { heightOverride: undefined });
    expect(level().openings[id].height).toBe(72);
  });
});
