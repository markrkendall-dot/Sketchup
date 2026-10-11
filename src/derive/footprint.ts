import { add, dist, normalize, perpLeft, scale, sub } from '../model/geometry';
import type { Id, Level, Vec2, Wall } from '../model/types';

export interface Footprint {
  wallId: Id;
  /** [leftA, leftB, rightB, rightA]; "left" is the +perpLeft side of a->b. */
  quad: [Vec2, Vec2, Vec2, Vec2];
  /** Centerline endpoints. */
  a: Vec2;
  b: Vec2;
  /** Unit direction a->b and left normal. */
  dir: Vec2;
  normal: Vec2;
  length: number;
  thickness: number;
  /** Core interval along the centerline not shared with corner joins. */
  s0: number;
  s1: number;
}

export type Footprints = ReadonlyMap<Id, Footprint>;

// M1: square caps only. M3 replaces computeFootprint with mitred joins (DESIGN.md "Corner joins");
// the memoization contract below stays the same.
function computeFootprint(level: Level, wall: Wall): Footprint | null {
  const a = level.nodes[wall.a];
  const b = level.nodes[wall.b];
  if (!a || !b) return null;
  const length = dist(a, b);
  const dir = normalize(sub(b, a));
  const normal = perpLeft(dir);
  const half = scale(normal, wall.thickness / 2);
  const A: Vec2 = { x: a.x, y: a.y };
  const B: Vec2 = { x: b.x, y: b.y };
  return {
    wallId: wall.id,
    quad: [add(A, half), add(B, half), sub(B, half), sub(A, half)],
    a: A,
    b: B,
    dir,
    normal,
    length,
    thickness: wall.thickness,
    s0: 0,
    s1: length,
  };
}

const samePt = (p: Vec2, q: Vec2) => p.x === q.x && p.y === q.y;

function sameFootprint(p: Footprint, q: Footprint): boolean {
  return (
    p.length === q.length &&
    p.thickness === q.thickness &&
    p.s0 === q.s0 &&
    p.s1 === q.s1 &&
    samePt(p.a, q.a) &&
    samePt(p.b, q.b) &&
    p.quad.every((pt, i) => samePt(pt, q.quad[i]))
  );
}

const cache = new WeakMap<Level, Footprints>();
/** Previous result per level id, used to keep footprint identity for unchanged walls. */
const previous = new Map<Id, Footprints>();

/**
 * Footprints of every wall on a level. Memoized per Level object; a wall whose footprint is
 * value-equal to the previous computation keeps the previous object, so consumers can memoize on
 * footprint identity and rebuild only walls that actually changed. When nothing changed at all
 * the previous Map itself is returned.
 */
export function getFootprints(level: Level): Footprints {
  const hit = cache.get(level);
  if (hit) return hit;
  const prev = previous.get(level.id);
  const next = new Map<Id, Footprint>();
  let allSame = prev !== undefined;
  for (const wall of Object.values(level.walls)) {
    const fp = computeFootprint(level, wall);
    if (!fp) continue;
    const old = prev?.get(wall.id);
    if (old && sameFootprint(old, fp)) next.set(wall.id, old);
    else {
      next.set(wall.id, fp);
      allSame = false;
    }
  }
  const result: Footprints = allSame && prev && prev.size === next.size ? prev : next;
  cache.set(level, result);
  previous.set(level.id, result);
  return result;
}
