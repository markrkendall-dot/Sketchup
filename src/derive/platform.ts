import { pointInPolygon, projectPointToSegment } from '../model/geometry';
import type { Id, Level, Plan, Vec2, ViewMode } from '../model/types';
import { isVisible } from './phase';
import { getFaces } from './rooms';

// Platform framing (DESIGN.md "Platform framing"): the exterior walls of a level run up through the
// floor slab of the level above, so the siding is continuous from one storey to the next, and that
// slab stops at the inside face of those walls.

/** How close (inches) a wall's centerline must be to the outline of the level above to carry it. */
const CARRY_TOL = 1;

/** Inside the polygon or within CARRY_TOL of its boundary. */
function insideOrNear(p: Vec2, poly: readonly Vec2[]): boolean {
  if (pointInPolygon(p, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    if (projectPointToSegment(p, poly[i], poly[(i + 1) % poly.length]).distance <= CARRY_TOL) return true;
  }
  return false;
}

const cache = new WeakMap<Level, WeakMap<object, Map<ViewMode, ReadonlyMap<Id, number>>>>();

/**
 * Extra height of each exterior wall of a level, in inches: the floor thickness of the level above
 * for an exterior wall whose centerline lies on or inside that level's outer outline (the level
 * above has a slab there for the wall to run up through), nothing for the rest. The top level, a
 * wing or porch the level above does not cover, and interior walls get no entry. Walls hidden in
 * the view mode get none either.
 */
export function wallExtensions(plan: Plan, levelId: Id, viewMode: ViewMode): ReadonlyMap<Id, number> {
  const level = plan.levels[levelId];
  const idx = plan.levelOrder.indexOf(levelId);
  const above = idx >= 0 ? plan.levels[plan.levelOrder[idx + 1]] : undefined;
  if (!level || !above || !(above.floorThickness > 0)) return new Map();
  const faces = getFaces(above, viewMode);
  let byFaces = cache.get(level);
  if (!byFaces) cache.set(level, (byFaces = new WeakMap()));
  let byMode = byFaces.get(faces.outerFaces);
  if (!byMode) byFaces.set(faces.outerFaces, (byMode = new Map()));
  const hit = byMode.get(viewMode);
  if (hit) return hit;
  const out = new Map<Id, number>();
  if (faces.outerFaces.length > 0) {
    for (const w of Object.values(level.walls)) {
      if (w.kind !== 'exterior' || !isVisible(w.phase, viewMode)) continue;
      const a = level.nodes[w.a];
      const b = level.nodes[w.b];
      if (!a || !b) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (faces.outerFaces.some((poly) => insideOrNear(mid, poly))) out.set(w.id, above.floorThickness);
    }
  }
  byMode.set(viewMode, out);
  return out;
}

/**
 * For the slab of a level, the distance from each outer-face edge's centerline to the inside face
 * of the exterior wall of the level below that runs up through the slab there (half that wall's
 * thickness), 0 where no wall does. Indexed like `FaceSet.outerFaces`. Null when no edge has one
 * (a level on the ground, or one over no walls).
 */
export function slabInsets(plan: Plan, levelId: Id, viewMode: ViewMode): number[][] | null {
  const level = plan.levels[levelId];
  const idx = plan.levelOrder.indexOf(levelId);
  const below = idx > 0 ? plan.levels[plan.levelOrder[idx - 1]] : undefined;
  if (!level || !below) return null;
  const ext = wallExtensions(plan, plan.levelOrder[idx - 1], viewMode);
  if (ext.size === 0) return null;
  const carriers = [...ext.keys()].map((id) => {
    const w = below.walls[id];
    return { a: below.nodes[w.a], b: below.nodes[w.b], half: w.thickness / 2 };
  });
  const faces = getFaces(level, viewMode);
  let any = false;
  const out = faces.outerFaces.map((poly) =>
    poly.map((p, j) => {
      const q = poly[(j + 1) % poly.length];
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      let best = 0;
      let bestDist = Infinity;
      for (const c of carriers) {
        const d = projectPointToSegment(mid, c.a, c.b).distance;
        // Parallel to the edge: the centerlines coincide along it.
        const parallel = Math.abs((q.x - p.x) * (c.b.y - c.a.y) - (q.y - p.y) * (c.b.x - c.a.x)) < 1e-6 * Math.hypot(q.x - p.x, q.y - p.y) * Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
        if (d <= CARRY_TOL && parallel && d < bestDist) {
          best = c.half;
          bestDist = d;
        }
      }
      if (best > 0) any = true;
      return best;
    }),
  );
  return any ? out : null;
}
