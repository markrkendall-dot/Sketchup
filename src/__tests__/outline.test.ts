import { describe, expect, it } from 'vitest';
import { outlinePath } from '../editor2d/outline';

const p = (x: number, y: number) => ({ x, y });

describe('outlinePath', () => {
  it('chains collinear and cornering segments into one polyline', () => {
    // Two halves of a wall face split at x = 100, then turning a corner.
    const d = outlinePath([
      [p(100, 0), p(200, 0)],
      [p(0, 0), p(100, 0)],
      [p(200, 0), p(200, 50)],
    ]);
    expect(d.match(/M/g)).toHaveLength(1);
    // The joint at x = 100 is dropped: one straight run, then the corner.
    expect(d).toBe('M0,0L200,0L200,50');
  });

  it('closes loops and keeps disjoint pieces separate', () => {
    const d = outlinePath([
      [p(0, 0), p(10, 0)],
      [p(10, 0), p(10, 10)],
      [p(10, 10), p(0, 10)],
      [p(0, 10), p(0, 0)],
      [p(50, 0), p(60, 0)],
    ]);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.match(/Z/g)).toHaveLength(1);
  });

  it('extends backwards from the first segment too', () => {
    const d = outlinePath([
      [p(10, 0), p(20, 0)],
      [p(0, 0), p(10, 0)],
      [p(20, 0), p(30, 0)],
    ]);
    expect(d).toBe('M0,0L30,0');
  });
});
