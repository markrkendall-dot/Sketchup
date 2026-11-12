import { pointInPolygon, polygonSignedArea } from '../model/geometry';
import type { Id, Level, Vec2, ViewMode } from '../model/types';
import { isVisible } from './phase';
import { polylabel } from './polylabel';
import { convexMinusAll, convexPieces } from './roofs';
import { getFaces, type FaceSet } from './rooms';

// A room opened by demolition (DESIGN.md "A floor opened by demolition"): taking out part of an
// exterior wall leaves the room it closed unclosed in the view, so the view finds no outline for it.
// Its floor is kept where it was (meshes.ts keptFloor); so are its label, its area (of the floor that
// is kept) and its ceiling, marked open on the plan.

/** An open room in a view: the floor it keeps, in convex pieces, its area and where its label goes. */
export interface OpenRoom {
  roomId: Id;
  pieces: Vec2[][];
  /** Net area of the kept floor, square inches. */
  area: number;
  labelPoint: Vec2;
}

/** The narrowest a kept piece may be (twice its area over its perimeter), inches: thinner slivers go. */
const MIN_WIDTH = 1;

function minWidth(poly: readonly Vec2[]): number {
  let per = 0;
  for (let i = 0; i < poly.length; i++) per += Math.hypot(poly[(i + 1) % poly.length].x - poly[i].x, poly[(i + 1) % poly.length].y - poly[i].y);
  return per > 0 ? (2 * Math.abs(polygonSignedArea(poly))) / per : 0;
}

/** Convex pieces of `polys` less `from` (any polygons), slivers dropped. */
export function piecesMinus(polys: readonly (readonly Vec2[])[], from: readonly (readonly Vec2[])[]): Vec2[][] {
  const cut = from.flatMap((r) => convexPieces(r));
  return polys.flatMap((r) => convexPieces(r)).flatMap((c) => convexMinusAll(c, cut)).filter((k) => minWidth(k) >= MIN_WIDTH);
}

const cache = new WeakMap<FaceSet, WeakMap<FaceSet, OpenRoom[]>>();

/**
 * The rooms open in the view: each room that labels an area in the Existing view, is shown in the
 * view, and labels no area of it, with the part of its existing area no room of the view covers.
 * None in the Existing view. Memoized on the two views' face sets.
 */
export function openRooms(level: Level, viewMode: ViewMode, faces: FaceSet = getFaces(level, viewMode)): OpenRoom[] {
  if (viewMode === 'existing') return [];
  const ex = getFaces(level, 'existing');
  let byView = cache.get(ex);
  if (!byView) cache.set(ex, (byView = new WeakMap()));
  const hit = byView.get(faces);
  if (hit) return hit;
  const shown = new Set(faces.faces.flatMap((f) => (f.roomId ? [f.roomId] : [])));
  const roomed = faces.faces.filter((f) => f.roomId).map((f) => f.netPolygon);
  const out: OpenRoom[] = [];
  for (const f of ex.faces) {
    const room = f.roomId ? level.rooms[f.roomId] : undefined;
    if (!room || shown.has(room.id) || !isVisible(room.phase ?? 'existing', viewMode)) continue;
    const pieces = piecesMinus([f.netPolygon], roomed);
    if (!pieces.length) continue;
    const area = pieces.reduce((a, p) => a + Math.abs(polygonSignedArea(p)), 0);
    let labelPoint: Vec2;
    if (pieces.some((p) => pointInPolygon(room.anchor, p))) labelPoint = room.anchor;
    else {
      const big = pieces.reduce((a, b) => (Math.abs(polygonSignedArea(b)) > Math.abs(polygonSignedArea(a)) ? b : a));
      labelPoint = polylabel(big, 1, 200).point;
    }
    out.push({ roomId: room.id, pieces, area, labelPoint });
  }
  byView.set(faces, out);
  return out;
}

/** The open room of a room in the view, or null. */
export function openRoomOf(level: Level, viewMode: ViewMode, roomId: Id): OpenRoom | null {
  return openRooms(level, viewMode).find((o) => o.roomId === roomId) ?? null;
}
