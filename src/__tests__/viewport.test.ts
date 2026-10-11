import { describe, expect, it } from 'vitest';
import { fitLevel, screenToWorld } from '../editor2d/viewport';
import { createLevel } from '../model/plan';

describe('fitLevel', () => {
  const size = { width: 800, height: 600 };
  function house(withDoor: boolean) {
    const l = createLevel('t', 96, 12);
    const pts = [
      { x: 0, y: 0 },
      { x: 240, y: 0 },
      { x: 240, y: 180 },
      { x: 0, y: 180 },
    ];
    pts.forEach((p, i) => (l.nodes[`n${i}`] = { id: `n${i}`, ...p }));
    pts.forEach((_, i) => {
      l.walls[`w${i}`] = { id: `w${i}`, a: `n${i}`, b: `n${(i + 1) % 4}`, thickness: 6, kind: 'exterior', phase: 'existing' };
    });
    // Bottom wall w2 runs right to left (240,180 -> 0,180); its left side is +y, outside the house.
    if (withDoor) {
      l.openings.d = { id: 'd', wallId: 'w2', type: 'door', offset: 120, width: 36, height: 80, sill: 0, phase: 'existing', swing: { hinge: 'a', side: 'left' } };
    }
    return l;
  }

  it('keeps an outward door swing on screen', () => {
    const plain = fitLevel(house(false), size)!;
    const v = fitLevel(house(true), size)!;
    expect(v.k).toBeLessThan(plain.k);
    // The swing reaches y = 180 + 3 + 36; it is inside the canvas.
    const bottom = screenToWorld(v, { x: 0, y: size.height }).y;
    expect(bottom).toBeGreaterThan(180 + 3 + 36);
  });

  it('returns null for an empty level', () => {
    expect(fitLevel(createLevel('e', 96, 12), size)).toBeNull();
  });
});
