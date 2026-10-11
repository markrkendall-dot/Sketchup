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
