import type { Vec2 } from './types';

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** z of the 3D cross product. */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const midpoint = (a: Vec2, b: Vec2): Vec2 => lerp(a, b, 0.5);

/** Unit vector, or (0,0) for a zero vector. */
export function normalize(a: Vec2): Vec2 {
  const len = length(a);
  return len === 0 ? { x: 0, y: 0 } : { x: a.x / len, y: a.y / len };
}

/**
 * Left perpendicular in plan coordinates (y down): for d = (1,0) this is (0,-1), i.e. "up" on
 * screen, which is the left side when walking along +x on a y-down plan.
 */
export const perpLeft = (a: Vec2): Vec2 => ({ x: a.y, y: -a.x });

export interface SegmentProjection {
  /** Parameter along a->b, clamped to [0,1]. */
  t: number;
  /** Unclamped parameter. */
  tRaw: number;
  point: Vec2;
  distance: number;
}

export function projectPointToSegment(p: Vec2, a: Vec2, b: Vec2): SegmentProjection {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  const tRaw = len2 === 0 ? 0 : dot(sub(p, a), ab) / len2;
  const t = Math.max(0, Math.min(1, tRaw));
  const point = lerp(a, b, t);
  return { t, tRaw, point, distance: dist(p, point) };
}

export interface SegmentIntersection {
  point: Vec2;
  /** Parameter on segment p0->p1. */
  t: number;
  /** Parameter on segment q0->q1. */
  u: number;
}

/** Intersection of two closed segments; null when parallel/collinear or disjoint. */
export function segmentIntersection(
  p0: Vec2,
  p1: Vec2,
  q0: Vec2,
  q1: Vec2,
  eps = 1e-9,
): SegmentIntersection | null {
  const r = sub(p1, p0);
  const s = sub(q1, q0);
  const denom = cross(r, s);
  if (Math.abs(denom) < eps) return null;
  const qp = sub(q0, p0);
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return { point: add(p0, scale(r, t)), t, u };
}

/** Intersection of two infinite lines p + t*r and q + u*s; null when parallel. */
export function lineIntersection(p: Vec2, r: Vec2, q: Vec2, s: Vec2, eps = 1e-9): Vec2 | null {
  const denom = cross(r, s);
  if (Math.abs(denom) < eps) return null;
  const t = cross(sub(q, p), s) / denom;
  return add(p, scale(r, t));
}

/** Shoelace signed area. Positive for counter-clockwise in a y-up frame (clockwise on screen). */
export function polygonSignedArea(poly: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Even-odd ray cast. Points exactly on the boundary may go either way. */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: Iterable<Vec2>): Bounds | null {
  let b: Bounds | null = null;
  for (const p of points) {
    if (!b) b = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    else {
      b.minX = Math.min(b.minX, p.x);
      b.minY = Math.min(b.minY, p.y);
      b.maxX = Math.max(b.maxX, p.x);
      b.maxY = Math.max(b.maxY, p.y);
    }
  }
  return b;
}
