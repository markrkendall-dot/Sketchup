import { describe, expect, it } from 'vitest';
import { getGraph } from '../derive/graph';
import { createLevel, MERGE_EPS, normalizeLevel } from '../model/plan';
import type { Level, Vec2, Wall } from '../model/types';

function build(nodes: Record<string, Vec2>, walls: [string, string][]): Level {
  const l = createLevel('t', 96, 12);
  for (const [id, p] of Object.entries(nodes)) l.nodes[id] = { id, ...p };
  walls.forEach(([a, b], i) => {
    const w: Wall = { id: `w${i}`, a, b, thickness: 6.5, kind: 'exterior', phase: 'existing' };
    l.walls[w.id] = w;
  });
  return l;
}

describe('normalizeLevel', () => {
  it('merges nodes within MERGE_EPS, preferring stationary ones', () => {
    const l = build({ p: { x: 0, y: 0 }, q: { x: 100, y: 0 }, r: { x: 100 + MERGE_EPS * 0.9, y: 0 }, s: { x: 100, y: 100 } }, [
      ['p', 'q'],
      ['r', 's'],
    ]);
    const remap = normalizeLevel(l, new Set(['q']));
    expect(remap.get('q')).toBe('r');
    expect(Object.keys(l.nodes).sort()).toEqual(['p', 'r', 's']);
    expect(l.walls.w0.b).toBe('r');
  });

  it('drops zero-length and duplicate walls (simple graph)', () => {
    const l = build({ p: { x: 0, y: 0 }, q: { x: 100, y: 0 } }, [
      ['p', 'q'],
      ['q', 'p'],
      ['p', 'p'],
    ]);
    normalizeLevel(l);
    expect(Object.keys(l.walls)).toEqual(['w0']);
  });

  it('splits a wall at a node on its interior, keeping the new pieces on the same line', () => {
    const l = build({ p: { x: 0, y: 0 }, q: { x: 240, y: 0 }, m: { x: 120, y: 0.3 }, s: { x: 120, y: 120 } }, [
      ['p', 'q'],
      ['m', 's'],
    ]);
    normalizeLevel(l);
    const g = getGraph(l);
    expect(Object.keys(l.walls)).toHaveLength(3);
    expect(g.degree('m')).toBe(3);
    expect(g.degree('p')).toBe(1);
  });

  it('removes nodes left without walls', () => {
    const l = build({ p: { x: 0, y: 0 }, q: { x: 100, y: 0 }, lone: { x: 50, y: 50 } }, [['p', 'q']]);
    normalizeLevel(l);
    expect(l.nodes.lone).toBeUndefined();
  });

  it('is idempotent', () => {
    const l = build({ p: { x: 0, y: 0 }, q: { x: 240, y: 0 }, m: { x: 120, y: 0 }, s: { x: 120, y: 120 } }, [
      ['p', 'q'],
      ['m', 's'],
    ]);
    normalizeLevel(l);
    const snapshot = JSON.stringify(l);
    normalizeLevel(l);
    expect(JSON.stringify(l)).toBe(snapshot);
  });
});

describe('normalizeLevel: which duplicate survives (REVIEW-2 A1)', () => {
  it('keeps the existing wall over a new one between the same nodes, wherever it comes in the record', () => {
    const l = build({ p: { x: 0, y: 0 }, q: { x: 100, y: 0 } }, [
      ['p', 'q'],
      ['q', 'p'],
    ]);
    l.walls.w0.phase = 'new';
    normalizeLevel(l);
    expect(Object.keys(l.walls)).toEqual(['w1']);
    expect(l.walls.w1.phase).toBe('existing');
  });

  it('keeps a wall with openings over one without (same phase), and moves the openings over', () => {
    const l = build({ p: { x: 0, y: 0 }, q: { x: 100, y: 0 } }, [
      ['p', 'q'],
      ['q', 'p'],
    ]);
    l.openings.o = { id: 'o', wallId: 'w1', type: 'window', offset: 30, width: 24, height: 36, sill: 30, phase: 'existing' };
    normalizeLevel(l);
    expect(Object.keys(l.walls)).toEqual(['w1']);
    expect(l.openings.o.wallId).toBe('w1');
    expect(l.openings.o.offset).toBe(30);
    // Equal ranks: the first one stays.
    const m = build({ p: { x: 0, y: 0 }, q: { x: 100, y: 0 } }, [
      ['p', 'q'],
      ['q', 'p'],
    ]);
    normalizeLevel(m);
    expect(Object.keys(m.walls)).toEqual(['w0']);
  });

  it('a new wall lying on an existing one does not replace the existing piece when split', () => {
    const l = build({ p: { x: 0, y: 0 }, q: { x: 300, y: 0 }, m: { x: 100, y: 0 }, n: { x: 200, y: 0 } }, [
      ['p', 'q'],
      ['m', 'n'],
    ]);
    l.walls.w1.phase = 'new';
    l.openings.o = { id: 'o', wallId: 'w0', type: 'door', offset: 150, width: 36, height: 80, sill: 0, phase: 'existing' };
    normalizeLevel(l);
    const walls = Object.values(l.walls);
    expect(walls).toHaveLength(3);
    expect(walls.every((w) => w.phase === 'existing')).toBe(true);
    // The door stays on the middle piece, at the same place along the line.
    const o = l.openings.o;
    const w = l.walls[o.wallId];
    const a = l.nodes[w.a];
    const b = l.nodes[w.b];
    expect(Math.min(a.x, b.x)).toBe(100);
    expect(Math.max(a.x, b.x)).toBe(200);
    expect(a.x + Math.sign(b.x - a.x) * o.offset).toBeCloseTo(150, 9);
    expect(getGraph(l).degree('m')).toBe(2);
  });
});
