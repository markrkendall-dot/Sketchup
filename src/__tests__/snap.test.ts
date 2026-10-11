import { describe, expect, it } from 'vitest';
import { snapPoint, type SnapContext } from '../editor2d/snap';
import type { Level, Node, Wall } from '../model/types';

const node = (id: string, x: number, y: number): Node => ({ id, x, y });
const wall = (id: string, a: string, b: string): Wall => ({
  id,
  a,
  b,
  thickness: 6.5,
  kind: 'exterior',
  phase: 'existing',
});

function level(nodes: Node[], walls: Wall[]): Pick<Level, 'nodes' | 'walls'> {
  return {
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    walls: Object.fromEntries(walls.map((w) => [w.id, w])),
  };
}

// One horizontal wall from (0,0) to (100,0), plus a lone corner at (200, 50).
const lvl = level(
  [node('n1', 0, 0), node('n2', 100, 0), node('n3', 200, 50), node('n4', 200, 150)],
  [wall('w1', 'n1', 'n2'), wall('w2', 'n3', 'n4')],
);

// k = 1: radii in inches equal pixels (node 10, midpoint 8, wall 8, guide 6).
const base: SnapContext = { level: lvl, k: 1, snapGrid: 1, orthoLock: true, shift: false };

describe('snapPoint priorities (no start point)', () => {
  it('snaps to a node within 10px', () => {
    const r = snapPoint({ x: 7, y: 6 }, base);
    expect(r.kind).toBe('node');
    expect(r.nodeId).toBe('n1');
    expect(r.point).toEqual({ x: 0, y: 0 });
  });

  it('node radius scales with zoom', () => {
    expect(snapPoint({ x: 7, y: 6 }, { ...base, k: 2 }).kind).not.toBe('node');
    expect(snapPoint({ x: 15, y: 0 }, { ...base, k: 0.5 }).kind).toBe('node');
  });

  it('node beats midpoint and wall', () => {
    // Short wall: its midpoint is 3" from the end node.
    const short = level([node('a', 0, 0), node('b', 6, 0)], [wall('w', 'a', 'b')]);
    const r = snapPoint({ x: 5, y: 1 }, { ...base, level: short });
    expect(r.kind).toBe('node');
    expect(r.nodeId).toBe('b');
  });

  it('snaps to a wall midpoint within 8px', () => {
    const r = snapPoint({ x: 53, y: 4 }, base);
    expect(r.kind).toBe('midpoint');
    expect(r.wallId).toBe('w1');
    expect(r.point).toEqual({ x: 50, y: 0 });
  });

  it('midpoint beats on-wall', () => {
    const r = snapPoint({ x: 51, y: 1 }, base);
    expect(r.kind).toBe('midpoint');
  });

  it('snaps onto a wall by projection within 8px', () => {
    const r = snapPoint({ x: 30.25, y: 5 }, base);
    expect(r.kind).toBe('wall');
    expect(r.wallId).toBe('w1');
    expect(r.point).toEqual({ x: 30.25, y: 0 });
  });

  it('alignment guides to node x and y within 6px', () => {
    const r = snapPoint({ x: 104, y: 47 }, base);
    expect(r.kind).toBe('guide');
    expect(r.point).toEqual({ x: 100, y: 50 }); // x of n2, y of n3
    expect(r.guides).toHaveLength(2);
  });

  it('a single guide grid-snaps the other coordinate', () => {
    const r = snapPoint({ x: 203.4, y: 300.6 }, base);
    expect(r.kind).toBe('guide');
    expect(r.point).toEqual({ x: 200, y: 301 });
    expect(r.guides).toEqual([{ from: { x: 200, y: 50 }, to: { x: 200, y: 301 } }]);
  });

  it('falls back to the grid', () => {
    const r = snapPoint({ x: 40.4, y: 80.6 }, base);
    expect(r.kind).toBe('grid');
    expect(r.point).toEqual({ x: 40, y: 81 });
    expect(snapPoint({ x: 41, y: 80 }, { ...base, snapGrid: 12 }).point).toEqual({ x: 36, y: 84 });
  });

  it('with no grid returns the raw point', () => {
    const r = snapPoint({ x: 40.4, y: 80.6 }, { ...base, snapGrid: 0 });
    expect(r.kind).toBe('none');
    expect(r.point).toEqual({ x: 40.4, y: 80.6 });
  });

  it('honours excluded nodes and their walls', () => {
    const r = snapPoint({ x: 2, y: 2 }, { ...base, excludeNodeIds: new Set(['n1']) });
    expect(r.kind).not.toBe('node');
    expect(r.wallId).toBeUndefined();
  });
});

describe('ortho lock', () => {
  const from = { x: 0, y: 300 };
  const empty = level([], []);

  it('projects onto the horizontal axis through the start', () => {
    const r = snapPoint({ x: 120.4, y: 317 }, { ...base, level: empty, from });
    expect(r.point).toEqual({ x: 120, y: 300 });
    expect(r.kind).toBe('grid');
  });

  it('projects onto the vertical axis when |dy| > |dx|', () => {
    const r = snapPoint({ x: 30, y: 500.2 }, { ...base, level: empty, from });
    expect(r.point).toEqual({ x: 0, y: 500 });
  });

  it('keeps a non-grid start coordinate on the fixed axis', () => {
    const r = snapPoint({ x: 50.2, y: 10 }, { ...base, level: empty, from: { x: 0.3, y: 7.7 } });
    expect(r.point).toEqual({ x: 50, y: 7.7 });
  });

  it('accepts nodes only within 1" of the axis', () => {
    const lv = level([node('on', 100, 300.8), node('off', 100, 304)], []);
    const r = snapPoint({ x: 99, y: 302 }, { ...base, level: lv, from });
    expect(r.kind).toBe('node');
    expect(r.nodeId).toBe('on');
    const lv2 = level([node('off', 100, 304)], []);
    const r2 = snapPoint({ x: 99, y: 302 }, { ...base, level: lv2, from });
    expect(r2.kind).not.toBe('node');
    expect(r2.point.y).toBe(300);
  });

  it('snaps where the axis crosses a wall', () => {
    // Diagonal wall crossing y = 300 at x = 140 (its midpoint is off the axis).
    const lv = level([node('a', 100, 260), node('b', 200, 360)], [wall('w', 'a', 'b')]);
    const r = snapPoint({ x: 137, y: 290 }, { ...base, level: lv, from });
    expect(r.kind).toBe('wall');
    expect(r.wallId).toBe('w');
    expect(r.point.x).toBeCloseTo(140);
    expect(r.point.y).toBeCloseTo(300);
  });

  it('aligns the free coordinate with another node', () => {
    const lv = level([node('n', 96, 0)], []);
    const r = snapPoint({ x: 100, y: 310 }, { ...base, level: lv, from });
    expect(r.kind).toBe('guide');
    expect(r.point).toEqual({ x: 96, y: 300 });
    expect(r.guides[0].from).toEqual({ x: 96, y: 0 });
  });

  it('Shift inverts ortho lock', () => {
    const r = snapPoint({ x: 120.4, y: 317.2 }, { ...base, level: empty, from, shift: true });
    expect(r.point).toEqual({ x: 120, y: 317 });
  });

  it('with ortho off and Shift held, snaps to 15 degree steps', () => {
    const ctx: SnapContext = { ...base, level: empty, from, orthoLock: false, shift: true };
    // ~31 degrees below horizontal (y down) -> 30 degrees, length rounded to 1".
    const r = snapPoint({ x: 100, y: 300 + 60 }, ctx);
    expect(r.kind).toBe('angle');
    const ang = (Math.atan2(r.point.y - from.y, r.point.x - from.x) * 180) / Math.PI;
    expect(ang).toBeCloseTo(30, 6);
    expect(Math.hypot(r.point.x - from.x, r.point.y - from.y)).toBeCloseTo(117, 6);
  });

  it('with ortho off and no Shift, snaps freely', () => {
    const r = snapPoint({ x: 100.2, y: 360.4 }, { ...base, level: empty, from, orthoLock: false });
    expect(r.point).toEqual({ x: 100, y: 360 });
  });
});
