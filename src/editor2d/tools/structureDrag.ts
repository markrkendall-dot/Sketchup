// Dragging a building in site mode (DESIGN.md "Structures"): pick a building by its ground floor's
// outline, move its origin with the pointer, and snap its wall-face corners to the other
// buildings' face corners, then to their faces, else the move to the snap grid.
import { getFaces } from '../../derive/rooms';
import { getFootprints } from '../../derive/footprint';
import { siteGhostLevelId } from '../../derive/site';
import { add, pointInPolygon, sub } from '../../model/geometry';
import { structuresOf, toLocal, toSite } from '../../model/structures';
import type { Id, Plan, Structure, Vec2, ViewMode } from '../../model/types';
import type { SnapResult } from '../../store/uiStore';
import { faceSnapSources, snapFaceCorner, snapFaceEdge, type FaceSnapSources } from '../snap';

/** The face snap sources of a structure's site ghost level (its ground floor), in its own coordinates. */
function ghostSources(plan: Plan, s: Structure, viewMode: ViewMode): FaceSnapSources | null {
  const level = plan.levels[siteGhostLevelId(s) ?? ''];
  return level ? faceSnapSources(getFootprints(level, viewMode), level.walls) : null;
}

/**
 * The building whose ground floor's outline (its outer wall faces, as the view shows them) holds
 * the site point p; the smallest when outlines overlap. `skip` leaves buildings out (hidden ones).
 */
export function structureAt(plan: Plan, p: Vec2, viewMode: ViewMode, skip?: ReadonlySet<Id>): Structure | null {
  let best: Structure | null = null;
  let bestArea = Infinity;
  for (const s of structuresOf(plan)) {
    if (skip?.has(s.id)) continue;
    const level = plan.levels[siteGhostLevelId(s) ?? ''];
    if (!level) continue;
    const q = toLocal(s, p);
    for (const poly of getFaces(level, viewMode).outerFaces) {
      if (!pointInPolygon(q, poly)) continue;
      let area = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        area += a.x * b.y - b.x * a.y;
      }
      area = Math.abs(area / 2);
      if (area < bestArea) {
        bestArea = area;
        best = s;
      }
    }
  }
  return best;
}

/**
 * Where a dragged building's origin goes: `wanted` moved so that one of its face corners lands on
 * another building's face corner (within the node snap radius), else on another building's face
 * (the wall radius), the nearest such pull winning; else `wanted` rounded to the snap grid. `snap`
 * is the corner it caught, in site coordinates, for the marker.
 */
export function snapStructureOrigin(
  plan: Plan,
  id: Id,
  wanted: Vec2,
  k: number,
  viewMode: ViewMode,
  skip?: ReadonlySet<Id>,
): { origin: Vec2; snap: SnapResult | null } {
  const s = plan.structures[id];
  const grid = plan.settings.snapGrid;
  const round = (v: number) => (grid > 0 ? Math.round(v / grid) * grid : v);
  const gridded = { origin: { x: round(wanted.x), y: round(wanted.y) }, snap: null };
  if (!s) return gridded;
  const own = ghostSources(plan, s, viewMode);
  if (!own || own.corners.length === 0) return gridded;
  const placed = { origin: wanted, rotation: s.rotation };
  const corners = own.corners.map((c) => toSite(placed, c));
  const others = structuresOf(plan).flatMap((o) => {
    if (o.id === id || skip?.has(o.id)) return [];
    const src = ghostSources(plan, o, viewMode);
    return src ? [{ o, src }] : [];
  });
  for (const pass of [snapFaceCorner, snapFaceEdge]) {
    let best: { delta: Vec2; d: number; point: Vec2; kind: SnapResult['kind'] } | null = null;
    for (const c of corners) {
      for (const { o, src } of others) {
        const hit = pass(toLocal(o, c), src, k);
        if (!hit) continue;
        const point = toSite(o, hit.point);
        const delta = sub(point, c);
        const d = Math.hypot(delta.x, delta.y);
        if (!best || d < best.d) best = { delta, d, point, kind: hit.kind };
      }
    }
    if (best) return { origin: add(wanted, best.delta), snap: { point: best.point, kind: best.kind, guides: [] } };
  }
  return gridded;
}
