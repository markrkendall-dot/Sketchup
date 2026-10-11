import { describe, expect, it } from 'vitest';
import { computeFootprints } from '../derive/footprint';
import { faceSnapSources, snapFaceCorner, snapFaceEdge, snapPoint, type SnapContext } from '../editor2d/snap';
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

describe('ghost snapping (level below)', () => {
  // The level below has a corner at (500, 500) and a wall from (500, 500) to (800, 500).
  const ghostNodes = [{ x: 500, y: 500 }, { x: 800, y: 500 }];
  const ghostWalls = [{ a: { x: 500, y: 500 }, b: { x: 800, y: 500 } }];
  const ctx: SnapContext = { ...base, ghostNodes, ghostWalls };

  it('snaps to a ghost corner at the node radius, with no node id', () => {
    const r = snapPoint({ x: 507, y: 496 }, ctx);
    expect(r.kind).toBe('ghost-node');
    expect(r.point).toEqual({ x: 500, y: 500 });
    expect(r.nodeId).toBeUndefined();
    expect(r.wallId).toBeUndefined();
  });

  it('uses the node radius (scales with zoom)', () => {
    expect(snapPoint({ x: 507, y: 496 }, { ...ctx, k: 2 }).kind).not.toBe('ghost-node');
    expect(snapPoint({ x: 515, y: 500 }, { ...ctx, k: 0.5 }).kind).toBe('ghost-node');
  });

  it('snaps onto a ghost wall by projection, with no wall id', () => {
    const r = snapPoint({ x: 612.5, y: 505 }, ctx);
    expect(r.kind).toBe('ghost-wall');
    expect(r.point).toEqual({ x: 612.5, y: 500 });
    expect(r.wallId).toBeUndefined();
  });

  it('ghost corner beats ghost wall', () => {
    expect(snapPoint({ x: 504, y: 503 }, ctx).kind).toBe('ghost-node');
  });

  it("this level's own node, midpoint and wall snaps win over the ghost", () => {
    const own = level([node('n1', 0, 0), node('n2', 100, 0)], [wall('w1', 'n1', 'n2')]);
    const near = (x: number, y: number) => ({ ...ctx, level: own, ghostNodes: [{ x, y }], ghostWalls: [{ a: { x, y }, b: { x: x + 300, y } }] });
    // Own corner within 10px of a ghost corner: the own corner wins.
    expect(snapPoint({ x: 3, y: 2 }, near(6, 0)).kind).toBe('node');
    // Own midpoint (50, 0) versus a ghost corner 4" away.
    expect(snapPoint({ x: 52, y: 3 }, near(54, 4)).kind).toBe('midpoint');
    // Own wall projection versus a ghost corner 4" along the wall.
    const r = snapPoint({ x: 30, y: 4 }, near(34, 6));
    expect(r.kind).toBe('wall');
    expect(r.wallId).toBe('w1');
  });

  it('a ghost corner lying on one of this level\'s walls wins over the projection onto it (REVIEW-2 B2)', () => {
    const own = level([node('n1', 0, 0), node('n2', 100, 0)], [wall('w1', 'n1', 'n2')]);
    const r = snapPoint({ x: 30.3, y: 2.7 }, { ...ctx, level: own, ghostNodes: [{ x: 34, y: 0 }], ghostWalls: [] });
    expect(r.kind).toBe('ghost-node');
    expect(r.point).toEqual({ x: 34, y: 0 });
    // Beyond the node radius the projection stays.
    expect(snapPoint({ x: 20, y: 2 }, { ...ctx, level: own, ghostNodes: [{ x: 34, y: 0 }], ghostWalls: [] }).kind).toBe('wall');
  });

  it('ghost snaps beat alignment guides and the grid', () => {
    // 4" from the ghost corner, and within 6px of the own node's x: ghost wins.
    const own = level([node('n3', 504, 900)], []);
    const r = snapPoint({ x: 504, y: 497 }, { ...ctx, level: own });
    expect(r.kind).toBe('ghost-node');
    // Nothing near: falls through to the grid as before.
    expect(snapPoint({ x: 40.4, y: 80.6 }, ctx).kind).toBe('grid');
  });

  it('with ortho from a start point, ghost corners must lie near the axis', () => {
    const from = { x: 0, y: 500 };
    const on = snapPoint({ x: 497, y: 502 }, { ...ctx, level: level([], []), from });
    expect(on.kind).toBe('ghost-node');
    expect(on.point).toEqual({ x: 500, y: 500 });
    const off = snapPoint({ x: 497, y: 502 }, { ...ctx, level: level([], []), from: { x: 0, y: 520 } });
    expect(off.kind).not.toBe('ghost-node');
  });

  it('without ghost lists nothing changes', () => {
    expect(snapPoint({ x: 507, y: 496 }, base).kind).toBe('grid');
  });
});

describe('wall face snaps (roof tool)', () => {
  // The main block's north-east corner with a porch whose east wall continues the block's east wall:
  // the east walls are a through pair at (300, 0) and the north wall butts into them.
  const porch = {
    ...level(
      [node('a', 0, 0), node('ne', 300, 0), node('se', 300, 200), node('pn', 300, -96)],
      [wall('north', 'a', 'ne'), wall('east', 'ne', 'se'), wall('peast', 'pn', 'ne')],
    ),
  } as Level;
  const fps = computeFootprints(porch, 'all');

  it('offers the footprints\' outline corners, and where two exterior face lines meet past a face end', () => {
    const src = faceSnapSources(fps, porch.walls);
    // The outside corner of the block under the porch: the north wall's outside face (y = -3.25)
    // meets the east walls' outside face (x = 303.25), 6.5" past the end of the north wall's face.
    const hit = snapFaceCorner({ x: 302, y: -2 }, src, 1);
    expect(hit?.kind).toBe('face-corner');
    expect(hit?.point.x).toBeCloseTo(303.25, 9);
    expect(hit?.point.y).toBeCloseTo(-3.25, 9);
    // Interior walls do not add face-line corners.
    const interior = { ...porch, walls: { ...porch.walls, north: { ...porch.walls.north, kind: 'interior' as const } } };
    const src2 = faceSnapSources(fps, interior.walls);
    expect(src2.corners.some((p) => Math.abs(p.x - 303.25) < 1e-6 && Math.abs(p.y + 3.25) < 1e-6)).toBe(false);
    // A point on a face away from corners snaps onto the face.
    const edge = snapFaceEdge({ x: 150, y: -5 }, src, 1);
    expect(edge?.kind).toBe('face-edge');
    expect(edge?.point.y).toBeCloseTo(-3.25, 9);
    expect(snapFaceEdge({ x: 150, y: -20 }, src, 1)).toBeNull();
  });
});
