// Moving a wall of the house as it stands, as a renovation (DESIGN.md "Renovation moves"): the old
// wall is demolished where it is and a new one built where it goes, and the walls it met are
// extended to it (new work) or cut back to it (the piece it passes demolished). Pure: it works on a
// copy of the level and the store puts the result in. The existing view must come out exactly as it
// went in; anything else is refused.

import { add, dist, dot, normalize, projectPointToSegment, scale, sub } from './geometry';
import { planWallOffset } from './offset';
import { MERGE_EPS, newId, normalizeLevel, wallOverlapping, WALL_OVERLAP_MESSAGE } from './plan';
import type { Id, Level, Opening, Vec2, Wall } from './types';

export const DEMO_MOVE_MESSAGE = 'A demolished wall stays where it is: move the new wall instead.';
export const CUT_IN_OPENING_MESSAGE = 'A wall it meets has a door or window where it would be cut back: move that opening first.';
export const EXISTING_CHANGED_MESSAGE = 'That move would change the house as it stands; correct the drawing instead, or move the wall in smaller steps.';

export type Renovation = { level: Level; walls: Id[] } | { error: string };

/** The wall props a new piece takes from the wall it continues. */
const pieceOf = (w: Wall, a: Id, b: Id, phase: Wall['phase']): Wall => {
  const out: Wall = { ...w, id: newId(), a, b, phase };
  return out;
};

/**
 * Plan a renovation move of walls by their shift vectors (perpendicular to each, model/offset.ts
 * planWallOffset decides where every corner goes, with the walls running straight on from them):
 *
 * - each moved existing wall is demolished with its existing openings, and a new wall built between
 *   the corners' new places with copies of them (as new work); its new openings move with it; a
 *   moved new wall just moves;
 * - at each corner, a wall the move goes away from gets a new piece out to the new corner; one it
 *   moves into is cut there and the piece between demolished (removed, if it was new); a wall that
 *   runs on through the corner (a T) is simply met further along.
 *
 * Refuses a demolished wall, a cut through a door or window, a wall laid on another, and anything
 * that would change the existing view.
 */
export function planRenovation(input: Level, shifts: ReadonlyMap<Id, Vec2>): Renovation {
  const level: Level = structuredClone(input);
  const planned = planWallOffset(level, shifts);
  if ('error' in planned) return planned;
  if (planned.walls.length === 0) return { error: 'Nothing to move.' };
  const moved = new Set(planned.walls);
  if ([...moved].some((id) => level.walls[id].phase === 'demo')) return { error: DEMO_MOVE_MESSAGE };

  // The moved walls' new segments must not lie on another wall.
  for (const id of moved) {
    const w = level.walls[id];
    const a = planned.positions[w.a] ?? level.nodes[w.a];
    const b = planned.positions[w.b] ?? level.nodes[w.b];
    if (wallOverlapping(level, a, b, (o) => moved.has(o.id))) return { error: WALL_OVERLAP_MESSAGE };
  }

  // A new node at each corner's new place.
  const fresh = new Map<Id, Id>();
  for (const [n, p] of Object.entries(planned.positions)) {
    const id = newId();
    level.nodes[id] = { id, x: p.x, y: p.y };
    fresh.set(n, id);
  }
  const openingsOn = (wallId: Id): Opening[] => Object.values(level.openings).filter((o) => o.wallId === wallId);

  // The walls met at each moved corner, and what happens to them.
  const incident = (n: Id) => Object.values(level.walls).filter((w) => w.a === n || w.b === n);
  type Meet = { kind: 'cut'; wall: Wall; corner: Id; by: number } | { kind: 'extend'; wall: Wall; corner: Id };
  const meets: Meet[] = [];
  for (const n of fresh.keys()) {
    const at = level.nodes[n];
    const to = planned.positions[n];
    const fixed = incident(n).filter((w) => !moved.has(w.id) && w.phase !== 'demo');
    if (fixed.length === 0) continue;
    const away = (w: Wall) => normalize(sub(level.nodes[w.a === n ? w.b : w.a], at));
    // A wall running on through the corner: the new corner lies on it and splits it there.
    const through = fixed.some((p) => fixed.some((q) => q !== p && dot(away(p), away(q)) < -0.999));
    if (through) {
      for (const w of fixed) {
        const a = level.nodes[w.a];
        const b = level.nodes[w.b];
        const pr = projectPointToSegment(to, a, b);
        if (pr.distance > MERGE_EPS || pr.t <= 0 || pr.t >= 1) continue;
        const s = pr.t * dist(a, b);
        if (openingsOn(w.id).some((o) => Math.abs(s - o.offset) < o.width / 2)) return { error: CUT_IN_OPENING_MESSAGE };
      }
      continue;
    }
    for (const w of fixed) {
      const d = dot(sub(to, at), away(w));
      if (d > MERGE_EPS) {
        // Moving into it: it is cut at the new corner; that must not fall in an opening.
        const len = dist(level.nodes[w.a], level.nodes[w.b]);
        const s = w.a === n ? d : len - d;
        if (openingsOn(w.id).some((o) => Math.abs(s - o.offset) < o.width / 2)) return { error: CUT_IN_OPENING_MESSAGE };
        meets.push({ kind: 'cut', wall: w, corner: n, by: d });
      } else if (d < -MERGE_EPS) meets.push({ kind: 'extend', wall: w, corner: n });
    }
  }

  // The moved walls: existing ones rebuilt, new ones moved.
  const made: Id[] = [];
  for (const id of moved) {
    const w = level.walls[id];
    const a = fresh.get(w.a) ?? w.a;
    const b = fresh.get(w.b) ?? w.b;
    if (w.phase === 'new') {
      w.a = a;
      w.b = b;
      made.push(w.id);
      continue;
    }
    const copy = pieceOf(w, a, b, 'new');
    level.walls[copy.id] = copy;
    made.push(copy.id);
    w.phase = 'demo';
    for (const o of openingsOn(w.id)) {
      if (o.phase === 'existing') {
        const c: Opening = { ...o, id: newId(), wallId: copy.id, phase: 'new' };
        level.openings[c.id] = c;
        o.phase = 'demo';
      } else if (o.phase === 'new') o.wallId = copy.id;
    }
  }

  // The walls met at the corners.
  for (const m of meets) {
    const w = level.walls[m.wall.id];
    const n = m.corner;
    const to = fresh.get(n)!;
    if (m.kind === 'extend') {
      const piece = pieceOf(w, n, to, 'new');
      level.walls[piece.id] = piece;
      continue;
    }
    // Cut back: the wall now ends at the new corner; the piece between goes (demolished if it was
    // there before, removed if it was new), with the openings on it.
    const len = dist(level.nodes[w.a], level.nodes[w.b]);
    const fromA = w.a === n;
    const cutAt = fromA ? m.by : len - m.by;
    if (w.phase === 'existing') {
      const piece = pieceOf(w, n, to, 'demo');
      level.walls[piece.id] = piece;
      for (const o of openingsOn(w.id)) {
        const inPiece = fromA ? o.offset < cutAt : o.offset > cutAt;
        if (inPiece) {
          o.wallId = piece.id;
          o.offset = fromA ? o.offset : o.offset - cutAt;
          // The piece runs from the corner (offset 0) to the cut.
          if (!fromA) o.offset = m.by - o.offset;
          o.phase = 'demo';
        } else if (fromA) o.offset -= cutAt;
      }
    } else {
      for (const o of openingsOn(w.id)) {
        const inPiece = fromA ? o.offset < cutAt : o.offset > cutAt;
        if (inPiece) delete level.openings[o.id];
        else if (fromA) o.offset -= cutAt;
      }
    }
    if (fromA) w.a = to;
    else w.b = to;
  }

  normalizeLevel(level, new Set(fresh.values()));
  if (existingViewSignature(level) !== existingViewSignature(input)) return { error: EXISTING_CHANGED_MESSAGE };
  // The walls now standing where the moved ones went (normalize may have split them).
  const newNodes = new Set(fresh.values());
  const walls = Object.values(level.walls)
    .filter((w) => w.phase === 'new' && newNodes.has(w.a) && newNodes.has(w.b))
    .map((w) => w.id);
  return { level, walls: walls.length ? walls : made.filter((id) => level.walls[id]) };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The house as it stands, as text: every wall shown in the existing view as the points it covers
 * (every 3" along it, and its ends, with its thickness and kind), and every opening shown there by
 * its centre, size and kind. Two levels with the same signature look the same in the existing view
 * however their walls are split.
 */
export function existingViewSignature(level: Level): string {
  const walls = Object.values(level.walls).filter((w) => w.phase !== 'new' && level.nodes[w.a] && level.nodes[w.b]);
  const pts = new Set<string>();
  // Wall ends, by place: a joint where two pieces of one wall run on straight is not an end.
  const ends = new Map<string, { u: Vec2; kind: string }[]>();
  for (const w of walls) {
    const a = level.nodes[w.a];
    const b = level.nodes[w.b];
    const len = dist(a, b);
    const u = normalize(sub(b, a));
    const tag = `${w.thickness}|${w.kind}`;
    // Sample on a grid along the wall's line (from the origin), so a split wall gives the same points.
    const t0 = dot(a, u);
    const first = Math.ceil((t0 - 1e-6) / 3) * 3;
    for (let t = first; t <= t0 + len + 1e-6; t += 3) {
      const p = add(a, scale(u, t - t0));
      pts.add(`${r2(p.x)},${r2(p.y)}|${tag}`);
    }
    for (const [p, d] of [
      [a, u],
      [b, scale(u, -1)],
    ] as const) {
      const key = `${r2(p.x)},${r2(p.y)}`;
      const list = ends.get(key) ?? [];
      list.push({ u: d, kind: tag });
      ends.set(key, list);
    }
  }
  for (const [key, list] of ends) {
    const joint = list.length === 2 && list[0].kind === list[1].kind && dot(list[0].u, list[1].u) < -0.999999;
    if (!joint) for (const e of list) pts.add(`end ${key}|${e.kind}|${r2(e.u.x)},${r2(e.u.y)}`);
  }
  const ops = Object.values(level.openings)
    .filter((o) => o.phase !== 'new' && level.walls[o.wallId])
    .map((o) => {
      const w = level.walls[o.wallId];
      const a = level.nodes[w.a];
      const u = normalize(sub(level.nodes[w.b], a));
      const c = add(a, scale(u, o.offset));
      return `${o.type}@${r2(c.x)},${r2(c.y)}:${o.width}x${o.height}+${o.sill}`;
    })
    .sort();
  return JSON.stringify([[...pts].sort(), ops]);
}
