import { describe, expect, it } from 'vitest';
import {
  add,
  boundsOf,
  cross,
  dist,
  dot,
  length,
  lineIntersection,
  normalize,
  perpLeft,
  pointInPolygon,
  polygonSignedArea,
  projectPointToSegment,
  scale,
  segmentIntersection,
  sub,
} from '../model/geometry';

const v = (x: number, y: number) => ({ x, y });

describe('vector helpers', () => {
  it('basic arithmetic', () => {
    expect(add(v(1, 2), v(3, 4))).toEqual(v(4, 6));
    expect(sub(v(1, 2), v(3, 5))).toEqual(v(-2, -3));
    expect(scale(v(1, -2), 3)).toEqual(v(3, -6));
    expect(dot(v(1, 2), v(3, 4))).toBe(11);
    expect(cross(v(1, 0), v(0, 1))).toBe(1);
    expect(cross(v(0, 1), v(1, 0))).toBe(-1);
    expect(length(v(3, 4))).toBe(5);
    expect(dist(v(1, 1), v(4, 5))).toBe(5);
  });

  it('normalize', () => {
    expect(normalize(v(3, 4))).toEqual(v(0.6, 0.8));
    expect(normalize(v(0, 0))).toEqual(v(0, 0));
  });

  it('perpLeft points to the left of travel on a y-down plan', () => {
    // Walking +x on screen, left is up (-y).
    expect(perpLeft(v(1, 0))).toEqual(v(0, -1));
    // Walking down (+y), left is +x (east).
    expect(perpLeft(v(0, 1))).toEqual(v(1, -0));
    expect(dot(perpLeft(v(3, 7)), v(3, 7))).toBe(0);
  });
});

describe('projectPointToSegment', () => {
  it('projects inside the segment', () => {
    const r = projectPointToSegment(v(5, 3), v(0, 0), v(10, 0));
    expect(r.t).toBe(0.5);
    expect(r.point).toEqual(v(5, 0));
    expect(r.distance).toBe(3);
  });
  it('clamps t but reports tRaw', () => {
    const r = projectPointToSegment(v(-5, 0), v(0, 0), v(10, 0));
    expect(r.t).toBe(0);
    expect(r.tRaw).toBe(-0.5);
    expect(r.point).toEqual(v(0, 0));
    expect(r.distance).toBe(5);
  });
  it('handles degenerate segments', () => {
    const r = projectPointToSegment(v(3, 4), v(0, 0), v(0, 0));
    expect(r.t).toBe(0);
    expect(r.distance).toBe(5);
  });
});

describe('segmentIntersection', () => {
  it('finds a crossing', () => {
    const r = segmentIntersection(v(0, 0), v(10, 10), v(0, 10), v(10, 0));
    expect(r).not.toBeNull();
    expect(r!.point.x).toBeCloseTo(5);
    expect(r!.point.y).toBeCloseTo(5);
    expect(r!.t).toBeCloseTo(0.5);
    expect(r!.u).toBeCloseTo(0.5);
  });
  it('touching endpoints count', () => {
    const r = segmentIntersection(v(0, 0), v(10, 0), v(10, 0), v(10, 10));
    expect(r?.point).toEqual(v(10, 0));
  });
  it('returns null for disjoint or parallel segments', () => {
    expect(segmentIntersection(v(0, 0), v(1, 0), v(2, -1), v(2, 1))).toBeNull();
    expect(segmentIntersection(v(0, 0), v(10, 0), v(0, 1), v(10, 1))).toBeNull();
    expect(segmentIntersection(v(0, 0), v(10, 0), v(5, 0), v(15, 0))).toBeNull();
  });
  it('lineIntersection ignores segment bounds', () => {
    expect(lineIntersection(v(0, 0), v(1, 0), v(20, -5), v(0, 1))).toEqual(v(20, 0));
    expect(lineIntersection(v(0, 0), v(1, 0), v(0, 1), v(2, 0))).toBeNull();
  });
});

describe('polygons', () => {
  // On the y-down plan this square goes right, down, left: clockwise on screen.
  const square = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
  it('signed area sign depends on winding', () => {
    expect(polygonSignedArea(square)).toBe(100);
    expect(polygonSignedArea([...square].reverse())).toBe(-100);
    expect(polygonSignedArea([])).toBe(0);
  });
  it('pointInPolygon', () => {
    expect(pointInPolygon(v(5, 5), square)).toBe(true);
    expect(pointInPolygon(v(15, 5), square)).toBe(false);
    expect(pointInPolygon(v(-1, -1), square)).toBe(false);
    const ell = [v(0, 0), v(20, 0), v(20, 10), v(10, 10), v(10, 20), v(0, 20)];
    expect(pointInPolygon(v(15, 15), ell)).toBe(false);
    expect(pointInPolygon(v(5, 15), ell)).toBe(true);
  });
  it('boundsOf', () => {
    expect(boundsOf(square)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(boundsOf([])).toBeNull();
  });
});
