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

describe('outlinePath performance', () => {
  /** Deterministic PRNG (mulberry32), so the benchmark input is the same on every run. */
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  it('chains 300 shuffled segments quickly', () => {
    const rand = rng(42);
    // 30 open chains of 10 segments: random walks, then shuffled and randomly reversed.
    const segs: [ReturnType<typeof p>, ReturnType<typeof p>][] = [];
    for (let c = 0; c < 30; c++) {
      let at = p(c * 1000 + rand() * 100, rand() * 100);
      for (let i = 0; i < 10; i++) {
        const next = p(at.x + 5 + rand() * 50, at.y + (rand() - 0.5) * 80);
        segs.push(rand() < 0.5 ? [at, next] : [next, at]);
        at = next;
      }
    }
    for (let i = segs.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [segs[i], segs[j]] = [segs[j], segs[i]];
    }
    expect(segs).toHaveLength(300);
    const t0 = performance.now();
    const d = outlinePath(segs);
    const first = performance.now() - t0;
    expect(d.match(/M/g)).toHaveLength(30);
    const times: number[] = [];
    for (let i = 0; i < 9; i++) {
      const t = performance.now();
      outlinePath(segs);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    console.log(`outlinePath(300 segments): first (cold) ${first.toFixed(2)} ms, median ${median.toFixed(2)} ms, worst ${times[times.length - 1].toFixed(2)} ms`);
    // Loose bound so a slow CI machine does not flake; typically well under 5 ms.
    expect(median).toBeLessThan(20);
  });
});
