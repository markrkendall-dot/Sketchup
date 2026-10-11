import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyPlan, createLevel, defaultLevelId, normalizeLevel, wallLength } from '../model/plan';
import type { Level, Opening, Vec2, Wall } from '../model/types';
import { clearHistory, undo, usePlanStore } from '../store/planStore';

const opts = { kind: 'interior', thickness: 4.5, phase: 'existing' } as const;
const store = () => usePlanStore.getState();
const levelId = () => defaultLevelId(store().plan);
const level = (): Level => store().plan.levels[levelId()];

/** World position of an opening's center on its wall. */
function centerOf(l: Level, o: Opening): Vec2 {
  const w = l.walls[o.wallId];
  const a = l.nodes[w.a];
  const b = l.nodes[w.b];
  const len = wallLength(l, w);
  return { x: a.x + ((b.x - a.x) * o.offset) / len, y: a.y + ((b.y - a.y) * o.offset) / len };
}

/** A plain level with the given walls (as point pairs) and no normalization yet. */
function rawLevel(segments: [Vec2, Vec2][]): Level {
  const level = createLevel('Test', 96, 12);
  segments.forEach(([p, q], i) => {
    level.nodes[`a${i}`] = { id: `a${i}`, x: p.x, y: p.y };
    level.nodes[`b${i}`] = { id: `b${i}`, x: q.x, y: q.y };
    const wall: Wall = { id: `w${i}`, a: `a${i}`, b: `b${i}`, thickness: 4.5, kind: 'interior', phase: 'existing' };
    level.walls[wall.id] = wall;
  });
  return level;
}

const opening = (id: string, wallId: string, offset: number, type: Opening['type'] = 'door'): Opening => ({
  id,
  wallId,
  type,
  offset,
  width: type === 'window' ? 30 : 32,
  height: type === 'window' ? 48 : 80,
  sill: type === 'window' ? 36 : 0,
  phase: 'existing',
});

beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
});

describe('normalizeLevel splits crossing walls', () => {
  it('turns a + of two walls into 4 walls and 5 nodes, keeping both openings in place', () => {
    const l = rawLevel([
      [{ x: -120, y: 0 }, { x: 120, y: 0 }],
      [{ x: 0, y: -120 }, { x: 0, y: 120 }],
    ]);
    l.openings.d = opening('d', 'w0', 60); // x = -60 on the horizontal wall
    l.openings.n = opening('n', 'w1', 180, 'window'); // y = 60 on the vertical wall
    normalizeLevel(l);
    expect(Object.keys(l.walls)).toHaveLength(4);
    expect(Object.keys(l.nodes)).toHaveLength(5);
    const center = Object.values(l.nodes).find((n) => Math.hypot(n.x, n.y) < 1e-9);
    expect(center).toBeDefined();
    for (const w of Object.values(l.walls)) {
      expect(w.a === center!.id || w.b === center!.id).toBe(true);
      expect(wallLength(l, w)).toBeCloseTo(120);
    }
    const d = l.openings.d;
    const n = l.openings.n;
    expect(d && n).toBeTruthy();
    expect(centerOf(l, d).x).toBeCloseTo(-60);
    expect(centerOf(l, d).y).toBeCloseTo(0);
    expect(centerOf(l, n).x).toBeCloseTo(0);
    expect(centerOf(l, n).y).toBeCloseTo(60);
    // Each opening sits on the piece that holds its centre.
    const dw = l.walls[d.wallId];
    expect([l.nodes[dw.a].x, l.nodes[dw.b].x].sort((p, q) => p - q)).toEqual([-120, 0]);
    const nw = l.walls[n.wallId];
    expect([l.nodes[nw.a].y, l.nodes[nw.b].y].sort((p, q) => p - q)).toEqual([0, 120]);
  });

  it('splits every crossing of a grid and terminates', () => {
    const segs: [Vec2, Vec2][] = [];
    for (let i = 0; i < 5; i++) {
      segs.push([{ x: 0, y: 24 + i * 48 }, { x: 240, y: 24 + i * 48 }]);
      segs.push([{ x: 24 + i * 48, y: 0 }, { x: 24 + i * 48, y: 240 }]);
    }
    const l = rawLevel(segs);
    normalizeLevel(l);
    expect(Object.keys(l.nodes)).toHaveLength(25 + 20);
    expect(Object.keys(l.walls)).toHaveLength(10 * 6);
  });

  it('splits a diagonal crossing at the intersection point', () => {
    const l = rawLevel([
      [{ x: 0, y: 0 }, { x: 100, y: 100 }],
      [{ x: 0, y: 100 }, { x: 100, y: 0 }],
    ]);
    normalizeLevel(l);
    expect(Object.keys(l.walls)).toHaveLength(4);
    expect(Object.values(l.nodes).some((n) => Math.abs(n.x - 50) < 1e-9 && Math.abs(n.y - 50) < 1e-9)).toBe(true);
  });

  it('leaves walls that only touch at an end, share a node, or are parallel alone', () => {
    const l = rawLevel([
      [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      [{ x: 0, y: 10 }, { x: 100, y: 10 }], // parallel
      [{ x: 100.3, y: -50 }, { x: 100.3, y: -1 }], // stops short of the first wall's end
    ]);
    normalizeLevel(l);
    expect(Object.keys(l.walls)).toHaveLength(3);
    expect(Object.keys(l.nodes)).toHaveLength(6);
  });

  it('does not split a crossing that is within MERGE_EPS of a wall end (a T handles it)', () => {
    const l = rawLevel([
      [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      [{ x: 50, y: -0.3 }, { x: 50, y: 100 }], // pokes 0.3" past the first wall
    ]);
    normalizeLevel(l);
    // The end node lies on the first wall (within MERGE_EPS): a T split, 3 walls, 4 nodes.
    expect(Object.keys(l.walls)).toHaveLength(3);
    expect(Object.keys(l.nodes)).toHaveLength(4);
  });
});

describe('addWall across an existing wall', () => {
  it('splits both walls on commit, keeps the opening, and undoes in one step', () => {
    const h = store().addWall(levelId(), { x: 0, y: 0 }, { x: 240, y: 0 }, opts)!.wallIds[0];
    const id = store().addOpening(levelId(), {
      wallId: h,
      type: 'door',
      offset: 180,
      width: 32,
      height: 80,
      sill: 0,
      phase: 'existing',
      swing: { hinge: 'a', side: 'left' },
    })!;
    const r = store().addWall(levelId(), { x: 120, y: -60 }, { x: 120, y: 60 }, opts)!;
    expect(r.wallIds).toHaveLength(2);
    const l = level();
    expect(Object.keys(l.walls)).toHaveLength(4);
    expect(Object.keys(l.nodes)).toHaveLength(5);
    expect(centerOf(l, l.openings[id]).x).toBeCloseTo(180);
    undo();
    expect(Object.keys(level().walls)).toHaveLength(1);
    expect(level().openings[id].wallId).toBe(h);
  });
});
