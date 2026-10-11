import { describe, expect, it } from 'vitest';
import { computeFootprints, getFootprints, MITER_LIMIT, type Footprint } from '../derive/footprint';
import { coreInterval, liveFootprints, wallPieces } from '../derive/openings';
import { getFaces } from '../derive/rooms';
import { dist, polygonSignedArea } from '../model/geometry';
import { createLevel } from '../model/plan';
import type { Level, Phase, Vec2, Wall } from '../model/types';

/** A level built by hand: nodes by name, walls as [a, b, thickness?, phase?]. */
function build(nodes: Record<string, Vec2>, walls: [string, string, number?, Phase?][]): Level {
  const l = createLevel('t', 96, 12);
  for (const [id, p] of Object.entries(nodes)) l.nodes[id] = { id, x: p.x, y: p.y };
  walls.forEach(([a, b, t = 6.5, phase = 'existing'], i) => {
    const w: Wall = { id: `w${i}`, a, b, thickness: t, kind: 'exterior', phase };
    l.walls[w.id] = w;
  });
  return l;
}

const fp = (l: Level, id: string, vm: 'all' | 'existing' | 'proposed' = 'all'): Footprint =>
  computeFootprints(l, vm).get(id)!;

const areaOf = (f: Footprint) => Math.abs(polygonSignedArea(f.poly));

describe('L corner', () => {
  const l = build({ p: { x: 0, y: 0 }, q: { x: 120, y: 0 }, r: { x: 120, y: 120 } }, [
    ['p', 'q'],
    ['q', 'r'],
  ]);
  const w0 = fp(l, 'w0');
  const w1 = fp(l, 'w1');

  it('both walls share the outer and inner corner points exactly', () => {
    // w0 runs +x; its left (perpLeft) side is up the screen (-y), the outside of this corner.
    expect(w0.quad[1]).toEqual({ x: 123.25, y: -3.25 }); // leftB, outer
    expect(w0.quad[2]).toEqual({ x: 116.75, y: 3.25 }); // rightB, inner
    // w1 runs +y; its left side is +x, again the outside.
    expect(w1.quad[0]).toEqual({ x: 123.25, y: -3.25 }); // leftA, outer
    expect(w1.quad[3]).toEqual({ x: 116.75, y: 3.25 }); // rightA, inner
    expect(w0.quad[1]).toStrictEqual(w1.quad[0]);
    expect(w0.quad[2]).toStrictEqual(w1.quad[3]);
  });

  it('plain quads, open ends square capped and stroked, the corner not', () => {
    expect(w0.poly).toEqual(w0.quad);
    expect(w0.openA && !w0.openB && !w1.openA && w1.openB).toBe(true);
    expect(w0.quad[0]).toEqual({ x: 0, y: -3.25 });
    expect(w0.quad[3]).toEqual({ x: 0, y: 3.25 });
    expect(w0.capEdges).toEqual([[{ x: 0, y: -3.25 }, { x: 0, y: 3.25 }]]);
    expect(w0.s0).toBe(0);
    expect(w0.s1).toBe(116.75);
  });

  it('no overlap and no notch: areas add up to the L outline', () => {
    const outline = 123.25 * 6.5 + 6.5 * (120 - 3.25);
    expect(areaOf(w0) + areaOf(w1)).toBeCloseTo(outline, 9);
  });
});

describe('T junction', () => {
  const l = build(
    { p: { x: 0, y: 0 }, m: { x: 120, y: 0 }, q: { x: 240, y: 0 }, s: { x: 120, y: 120 } },
    [
      ['p', 'm'],
      ['m', 'q'],
      ['m', 's', 4.5],
    ],
  );
  const left = fp(l, 'w0');
  const right = fp(l, 'w1');
  const butt = fp(l, 'w2');

  it('the through wall is square capped at the junction', () => {
    expect(left.quad).toEqual([
      { x: 0, y: -3.25 },
      { x: 120, y: -3.25 },
      { x: 120, y: 3.25 },
      { x: 0, y: 3.25 },
    ]);
    expect(right.quad[0]).toEqual({ x: 120, y: -3.25 });
    expect(right.quad[3]).toEqual({ x: 120, y: 3.25 });
    expect(left.capEdges).toHaveLength(1); // only the open end at p
    expect(right.capEdges).toHaveLength(1);
  });

  it('the butt wall lands its corners on the through wall face line', () => {
    expect(butt.quad[0]).toEqual({ x: 122.25, y: 3.25 }); // leftA (+x side)
    expect(butt.quad[3]).toEqual({ x: 117.75, y: 3.25 });
    expect(butt.poly).toEqual(butt.quad);
    expect(butt.s0).toBe(3.25);
  });

  it('the through wall face is stroked only outside the butt wall mouth; openings stay clear of it', () => {
    // Right edge of the left half (+y face) stops where the butt wall begins.
    expect(left.edge[2]).toEqual({ x: 117.75, y: 3.25 });
    expect(left.edge[1]).toEqual({ x: 120, y: -3.25 });
    expect(right.edge[3]).toEqual({ x: 122.25, y: 3.25 });
    expect(left.s1).toBe(117.75);
    expect(right.s0).toBe(2.25);
    const pieces = wallPieces(left, left, []);
    expect(pieces.edges).toContainEqual([{ x: 0, y: 3.25 }, { x: 117.75, y: 3.25 }]);
    expect(pieces.edges).toContainEqual([{ x: 0, y: -3.25 }, { x: 120, y: -3.25 }]);
  });

  it('areas add up exactly (no gap, no overlap)', () => {
    const total = areaOf(left) + areaOf(right) + areaOf(butt);
    expect(total).toBeCloseTo(240 * 6.5 + 4.5 * (120 - 3.25), 9);
  });
});

describe('X junction', () => {
  const l = build(
    { c: { x: 0, y: 0 }, e: { x: 120, y: 0 }, w: { x: -120, y: 0 }, n: { x: 0, y: -120 }, s: { x: 0, y: 120 } },
    [
      ['c', 'e'],
      ['w', 'c'],
      ['c', 'n', 4.5],
      ['s', 'c', 4.5],
    ],
  );
  const fps = computeFootprints(l, 'all');

  it('the thicker pair runs through; the other pair butts against its faces', () => {
    const e = fps.get('w0')!;
    expect(e.quad[0]).toEqual({ x: 0, y: -3.25 });
    expect(e.quad[3]).toEqual({ x: 0, y: 3.25 });
    const north = fps.get('w2')!; // c -> n, direction -y, left is -x
    expect(north.quad[0]).toEqual({ x: -2.25, y: -3.25 });
    expect(north.quad[3]).toEqual({ x: 2.25, y: -3.25 });
    const south = fps.get('w3')!; // s -> c ends at the face y = 3.25
    expect(south.quad[1].y).toBe(3.25);
    expect(south.quad[2].y).toBe(3.25);
  });

  it('each arm mitres against its two angular neighbours; areas add up', () => {
    const total = [...fps.values()].reduce((s, f) => s + areaOf(f), 0);
    expect(total).toBeCloseTo(240 * 6.5 + 2 * 4.5 * (120 - 3.25), 9);
  });
});

describe('Y junction (no through pair)', () => {
  const r = 120;
  const at = (deg: number) => ({ x: r * Math.cos((deg * Math.PI) / 180), y: r * Math.sin((deg * Math.PI) / 180) });
  const l = build({ c: { x: 0, y: 0 }, a: at(-90), b: at(30), d: at(150) }, [
    ['c', 'a'],
    ['c', 'b'],
    ['c', 'd'],
  ]);
  const fps = [...computeFootprints(l, 'all').values()];

  it('each cap runs through the node so the hub is covered, corners shared', () => {
    for (const f of fps) {
      expect(f.capA).toHaveLength(1);
      expect(f.capA[0]).toEqual({ x: 0, y: 0 });
    }
    // Corner between consecutive walls is the same point for both.
    const corners = fps.flatMap((f) => [f.quad[0], f.quad[3]]);
    for (const p of corners) expect(corners.filter((q) => dist(p, q) < 1e-12)).toHaveLength(2);
    // Each arm: a strip from its corners (c along the arm) to the open end, plus its third of the hub.
    const c = 3.25 / Math.sqrt(3);
    const total = fps.reduce((sum, f) => sum + areaOf(f), 0);
    expect(total).toBeCloseTo(3 * (6.5 * (r - c) + 3.25 * c), 9);
  });
});

describe('acute corner', () => {
  const deg = 30;
  const rad = (deg * Math.PI) / 180;
  const l = build({ p: { x: 120, y: 0 }, o: { x: 0, y: 0 }, q: { x: 120 * Math.cos(rad), y: 120 * Math.sin(rad) } }, [
    ['p', 'o'],
    ['o', 'q'],
  ]);
  const a = fp(l, 'w0');
  const b = fp(l, 'w1');

  it('the outer miter is beveled at 1.5 x thickness; the bevel is shared and stroked', () => {
    const cap = MITER_LIMIT * 6.5;
    // w0 ends at o (its b end), w1 starts there.
    expect(a.capB).toHaveLength(1);
    expect(b.capA).toHaveLength(1);
    const mid = a.capB[0];
    expect(mid).toEqual(b.capA[0]);
    expect(dist(mid, { x: 0, y: 0 })).toBeCloseTo(cap, 9);
    expect(a.capEdges).toHaveLength(2); // open end at p + the bevel half
    expect(b.capEdges).toHaveLength(2);
    // Bevel points are distinct and no farther from o than the plain miter would be.
    const miter = 3.25 / Math.sin(rad / 2);
    expect(miter).toBeGreaterThan(cap);
  });

  it('the inner corner is a real miter shared by both walls', () => {
    const inner = 3.25 / Math.sin(rad / 2);
    const shared = [a.quad[1], a.quad[2]].find((p) => [b.quad[0], b.quad[3]].some((q) => q === p || (q.x === p.x && q.y === p.y)));
    expect(shared).toBeDefined();
    expect(dist(shared!, { x: 0, y: 0 })).toBeCloseTo(inner, 9);
  });
});

describe('fallbacks and thickness', () => {
  it('degree 1: square caps at both ends', () => {
    const l = build({ p: { x: 0, y: 0 }, q: { x: 0, y: 100 } }, [['p', 'q', 4]]);
    const f = fp(l, 'w0');
    // Direction +y, left is +x.
    expect(f.quad).toEqual([
      { x: 2, y: 0 },
      { x: 2, y: 100 },
      { x: -2, y: 100 },
      { x: -2, y: 0 },
    ]);
    expect(f.capEdges).toHaveLength(2);
    expect([f.s0, f.s1]).toEqual([0, 100]);
  });

  it('different thicknesses at a corner still share both points', () => {
    const l = build({ p: { x: 0, y: 0 }, q: { x: 120, y: 0 }, r: { x: 120, y: 120 } }, [
      ['p', 'q', 6.5],
      ['q', 'r', 4.5],
    ]);
    const w0 = fp(l, 'w0');
    const w1 = fp(l, 'w1');
    expect(w0.quad[1]).toEqual({ x: 122.25, y: -3.25 });
    expect(w0.quad[2]).toEqual({ x: 117.75, y: 3.25 });
    expect(w1.quad[0]).toEqual(w0.quad[1]);
    expect(w1.quad[3]).toEqual(w0.quad[2]);
    expect(w1.s0).toBe(3.25);
    expect(w0.s1).toBe(117.75);
  });

  it("s0/s1 of a 10' wall between two 6.5\" walls at right angles is [3.25, 116.75]", () => {
    const l = build({ a: { x: 0, y: 120 }, b: { x: 0, y: 0 }, c: { x: 120, y: 0 }, d: { x: 120, y: 120 } }, [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
    ]);
    const f = fp(l, 'w1');
    expect([f.s0, f.s1]).toEqual([3.25, 116.75]);
  });

  it('straight continuation through a degree-2 node: square caps, no seam stroke', () => {
    const l = build({ p: { x: 0, y: 0 }, m: { x: 100, y: 0 }, q: { x: 200, y: 0 } }, [
      ['p', 'm'],
      ['m', 'q'],
    ]);
    const a = fp(l, 'w0');
    expect(a.quad[1]).toEqual({ x: 100, y: -3.25 });
    expect(a.capEdges).toHaveLength(1);
    expect(a.s1).toBe(100);
  });
});

describe('view mode dependence', () => {
  const l = build({ p: { x: 0, y: 0 }, q: { x: 120, y: 0 }, r: { x: 120, y: 120 } }, [
    ['p', 'q'],
    ['q', 'r', 6.5, 'demo'],
  ]);

  it('hidden walls have no footprint and do not shape corners', () => {
    const existing = fp(l, 'w0', 'existing');
    const proposed = fp(l, 'w0', 'proposed');
    expect(existing.quad[1]).toEqual({ x: 123.25, y: -3.25 });
    expect(proposed.quad[1]).toEqual({ x: 120, y: -3.25 });
    expect(proposed.openB).toBe(true);
    expect(computeFootprints(l, 'proposed').has('w1')).toBe(false);
    expect([existing.s1, proposed.s1]).toEqual([116.75, 120]);
  });

  it('memoized per level and view mode', () => {
    const e = getFootprints(l, 'existing');
    expect(getFootprints(l, 'existing')).toBe(e);
    expect(getFootprints(l, 'proposed')).not.toBe(e);
  });

  it('an existing opening clears the corner in every view it shows in', () => {
    // Existing opening on the existing wall: shows in both views, interval is the intersection.
    expect(coreInterval(l, 'w0', 'existing', liveFootprints(l))).toEqual([0, 116.75]);
    // A new opening shows only in the proposed view, where the demo wall is gone.
    expect(coreInterval(l, 'w0', 'new', liveFootprints(l))).toEqual([0, 120]);
  });
});

describe('performance and identity', () => {
  /** A grid of rooms: cols x rows nodes, 12' spacing. */
  function grid(cols: number, rows: number): Level {
    const nodes: Record<string, Vec2> = {};
    const walls: [string, string, number?][] = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) nodes[`n${i}_${j}`] = { x: i * 144, y: j * 144 };
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const t = i === 0 || j === 0 || i === cols - 1 || j === rows - 1 ? 6.5 : 4.5;
        if (i + 1 < cols) walls.push([`n${i}_${j}`, `n${i + 1}_${j}`, t]);
        if (j + 1 < rows) walls.push([`n${i}_${j}`, `n${i}_${j + 1}`, t]);
      }
    return build(nodes, walls);
  }

  it('300+ walls: footprints and faces well under budget', () => {
    const l = grid(12, 14);
    expect(Object.keys(l.walls).length).toBeGreaterThanOrEqual(300);
    // Warm up the JIT on a copy, then time fresh levels (no cache hits).
    getFootprints({ ...l }, 'all');
    getFaces({ ...l, nodes: { ...l.nodes } }, 'all');
    let t = performance.now();
    const fps = getFootprints({ ...l }, 'proposed');
    const tFoot = performance.now() - t;
    t = performance.now();
    const faces = getFaces({ ...l, nodes: { ...l.nodes } }, 'proposed');
    const tFaces = performance.now() - t;
    console.log(`300-wall level: getFootprints ${tFoot.toFixed(2)} ms, getFaces ${tFaces.toFixed(2)} ms`);
    expect(fps.size).toBe(Object.keys(l.walls).length);
    expect(faces.faces).toHaveLength(11 * 13);
    expect(tFoot).toBeLessThan(100);
    expect(tFaces).toBeLessThan(100);
  });

  it('moving one node rebuilds only footprints whose joins it touches', () => {
    const l = grid(12, 14);
    const before = getFootprints(l, 'all');
    // Slide an interior node along its horizontal walls: only its incident walls change shape
    // (the horizontal ones change length; the vertical ones change direction, which also moves
    // their far-end corners, so walls at the neighbouring nodes may change too).
    const moved = 'n5_6';
    const l2: Level = { ...l, nodes: { ...l.nodes, [moved]: { id: moved, x: 5 * 144 + 6, y: 6 * 144 } } };
    const after = getFootprints(l2, 'all');
    expect(after).not.toBe(before);
    const incident = Object.values(l.walls).filter((w) => w.a === moved || w.b === moved);
    const nearNodes = new Set(incident.flatMap((w) => [w.a, w.b]));
    const changed = [...after.keys()].filter((id) => after.get(id) !== before.get(id));
    for (const w of incident) expect(changed).toContain(w.id);
    for (const id of changed) {
      const w = l.walls[id];
      expect(nearNodes.has(w.a) || nearNodes.has(w.b)).toBe(true);
    }
    expect(changed.length).toBeLessThan(20);
    console.log(`moved node: ${changed.length} of ${after.size} footprints rebuilt (${incident.length} incident)`);

    // Moving it straight along a wall keeps the far-end joins: exactly the incident walls change.
    const lAlong = build({ p: { x: 0, y: 0 }, q: { x: 120, y: 0 }, r: { x: 120, y: 120 }, s: { x: 240, y: 120 } }, [
      ['p', 'q'],
      ['q', 'r'],
      ['r', 's'],
    ]);
    const b0 = getFootprints(lAlong, 'all');
    const l3: Level = { ...lAlong, nodes: { ...lAlong.nodes, p: { id: 'p', x: -30, y: 0 } } };
    const b1 = getFootprints(l3, 'all');
    expect(b1.get('w0')).not.toBe(b0.get('w0'));
    expect(b1.get('w1')).toBe(b0.get('w1'));
    expect(b1.get('w2')).toBe(b0.get('w2'));
  });
});
