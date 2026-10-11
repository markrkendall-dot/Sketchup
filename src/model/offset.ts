// Moving walls sideways by a distance (docs/REVIEW-2.md B1). Pure: the store applies the result.
import { add, cross, dist, dot, lineIntersection, normalize, perpLeft, scale, sub } from './geometry';
import { MERGE_EPS } from './plan';
import type { Id, Level, Vec2 } from './types';

/** Which side of a wall, relative to its a->b direction (left = +normal, DESIGN.md). */
export type WallSide = 'left' | 'right';

export const ODD_CORNER_MESSAGE = 'That corner has walls at odd angles; move its corner instead';
export const OFFSET_COLLAPSE_MESSAGE = 'That move is too far: a wall it moves along would shrink to nothing.';
export const OFFSET_CONFLICT_MESSAGE = 'Those walls are on one line but would move different ways.';

/** Unit vectors closer to parallel than this (sine of the angle) are collinear. */
const COLLINEAR_SIN = 1e-6;
/** Neighbours must agree on where a corner goes to within this (inches). */
const AGREE_EPS = 0.01;

export type OffsetPlan = { positions: Record<Id, Vec2>; walls: Id[] } | { error: string };

const dirOf = (level: Pick<Level, 'nodes' | 'walls'>, id: Id): Vec2 => {
  const w = level.walls[id];
  return normalize(sub(level.nodes[w.b], level.nodes[w.a]));
};

/** The shift that moves a wall `distance` to one side: along its left normal, negated for right. */
export function wallShift(level: Pick<Level, 'nodes' | 'walls'>, wallId: Id, distance: number, side: WallSide): Vec2 {
  return clean(scale(perpLeft(dirOf(level, wallId)), side === 'left' ? distance : -distance));
}

/** No negative zeros. */
const clean = (v: Vec2): Vec2 => ({ x: v.x || 0, y: v.y || 0 });

/**
 * Where the nodes go when each wall in `shifts` moves by its shift vector (perpendicular to the wall).
 *
 * The walls' target lines are their centerlines shifted. Walls collinear with a moved wall at one of
 * its nodes move with it (followed from node to node). At each node of a moved wall: where two moved
 * walls meet at an angle the node goes to the crossing of their target lines; where only one target
 * line passes, the node translates by the shift when no other wall is there, otherwise it slides
 * along the neighbour closest to perpendicular (its line crossed with the target line) so the
 * neighbour stays attached and straight. Neighbours that disagree on the point refuse the move
 * (ODD_CORNER_MESSAGE), as does a move that would shrink a wall to nothing.
 */
export function planWallOffset(level: Pick<Level, 'nodes' | 'walls'>, shifts: ReadonlyMap<Id, Vec2>): OffsetPlan {
  const incident = new Map<Id, Id[]>();
  for (const w of Object.values(level.walls)) {
    if (!level.nodes[w.a] || !level.nodes[w.b]) continue;
    for (const n of [w.a, w.b]) {
      const list = incident.get(n);
      if (list) list.push(w.id);
      else incident.set(n, [w.id]);
    }
  }
  const dirs = new Map<Id, Vec2>();
  const dir = (id: Id) => {
    let d = dirs.get(id);
    if (!d) dirs.set(id, (d = dirOf(level, id)));
    return d;
  };
  const collinear = (p: Id, q: Id) => Math.abs(cross(dir(p), dir(q))) < COLLINEAR_SIN;

  // The moved walls: the given ones and, from node to node, the walls running straight on from them.
  const moved = new Map<Id, Vec2>();
  const queue: Id[] = [];
  for (const [id, s] of shifts) {
    const w = level.walls[id];
    if (!w || !level.nodes[w.a] || !level.nodes[w.b] || dist(level.nodes[w.a], level.nodes[w.b]) < 1e-9) continue;
    moved.set(id, s);
    queue.push(id);
  }
  while (queue.length) {
    const id = queue.pop()!;
    const w = level.walls[id];
    const s = moved.get(id)!;
    for (const n of [w.a, w.b]) {
      for (const o of incident.get(n) ?? []) {
        if (o === id || !collinear(id, o)) continue;
        const prev = moved.get(o);
        if (prev) {
          if (dist(prev, s) > 1e-9) return { error: OFFSET_CONFLICT_MESSAGE };
          continue;
        }
        moved.set(o, s);
        queue.push(o);
      }
    }
  }
  if (moved.size === 0) return { positions: {}, walls: [] };

  const nodes = new Set<Id>();
  for (const id of moved.keys()) {
    nodes.add(level.walls[id].a);
    nodes.add(level.walls[id].b);
  }
  const positions: Record<Id, Vec2> = {};
  for (const n of nodes) {
    const at = level.nodes[n];
    const here = incident.get(n) ?? [];
    // Target lines through this node, one per direction (collinear moved walls share a shift).
    const lines: { p: Vec2; d: Vec2 }[] = [];
    for (const id of here) {
      const s = moved.get(id);
      if (!s) continue;
      const line = { p: add(at, s), d: dir(id) };
      if (!lines.some((l) => Math.abs(cross(l.d, line.d)) < COLLINEAR_SIN)) lines.push(line);
    }
    const fixed = here.filter((id) => !moved.has(id));
    let point: Vec2 | null;
    if (lines.length >= 2) {
      // Two moved walls meet at an angle: the corner is where their new lines cross.
      point = lineIntersection(lines[0].p, lines[0].d, lines[1].p, lines[1].d);
      if (!point) return { error: ODD_CORNER_MESSAGE };
      for (const l of lines.slice(2)) if (Math.abs(cross(l.d, sub(point, l.p))) > AGREE_EPS) return { error: ODD_CORNER_MESSAGE };
      for (const f of fixed) if (Math.abs(cross(dir(f), sub(point, at))) > AGREE_EPS) return { error: ODD_CORNER_MESSAGE };
    } else if (fixed.length === 0) {
      point = lines[0].p;
    } else {
      const line = lines[0];
      // Slide along the neighbour closest to perpendicular; every other neighbour must agree.
      const best = fixed.reduce((p, q) => (Math.abs(cross(dir(q), line.d)) > Math.abs(cross(dir(p), line.d)) ? q : p));
      point = lineIntersection(line.p, line.d, at, dir(best));
      if (!point) return { error: ODD_CORNER_MESSAGE };
      for (const f of fixed) {
        if (f === best) continue;
        const q = lineIntersection(line.p, line.d, at, dir(f));
        if (!q || dist(q, point) > AGREE_EPS) return { error: ODD_CORNER_MESSAGE };
      }
    }
    positions[n] = point;
  }

  // No wall may shrink to nothing or turn round: the moved walls themselves and the neighbours
  // they slide along (whose far end stays put).
  const after = (id: Id) => positions[id] ?? level.nodes[id];
  const touched = new Set<Id>();
  for (const n of nodes) for (const id of incident.get(n) ?? []) touched.add(id);
  for (const id of touched) {
    const w = level.walls[id];
    const before = sub(level.nodes[w.b], level.nodes[w.a]);
    const now = sub(after(w.b), after(w.a));
    if (Math.hypot(now.x, now.y) <= MERGE_EPS || dot(now, before) <= 0) return { error: OFFSET_COLLAPSE_MESSAGE };
  }
  return { positions, walls: [...moved.keys()] };
}

/**
 * The shifts that nudge walls one step in a screen direction: each wall moves to the side its
 * normal points along `dir` (by dot product); walls running along `dir` are skipped.
 */
export function nudgeShifts(level: Pick<Level, 'nodes' | 'walls'>, ids: readonly Id[], dirIn: Vec2, step: number): Map<Id, Vec2> {
  const out = new Map<Id, Vec2>();
  for (const id of ids) {
    const w = level.walls[id];
    if (!w || !level.nodes[w.a] || !level.nodes[w.b]) continue;
    const n = perpLeft(dirOf(level, id));
    const d = dot(n, dirIn);
    if (Math.abs(d) < 0.3) continue;
    out.set(id, clean(scale(n, d > 0 ? step : -step)));
  }
  return out;
}
