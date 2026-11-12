import { clipHalfPlane, pointInPolygon, polygonSignedArea } from '../model/geometry';
import { levelAboveId } from '../model/structures';
import type { Id, Plan, Room, Vec2, ViewMode } from '../model/types';
import { getLevelRoofs } from './roofJoin';
import { faceOfRoom, getFaces } from './rooms';
import { clipConvex, convexMinusAll, convexPieces, joinedCovers, planeAt, roofDrawnPieces, roofOutlineWithOverhang, type RoofOnLevel, type RoofPlane } from './roofs';

// Ceilings that follow the roof (DESIGN.md "Ceilings"): a room's ceiling on the underside of the
// roofs of its level drawn over it, with a flat part where the roof rises above a set height. Pure
// (no three): meshes.ts builds the surface, the panel asks whether a roof is over the room.

/** A convex piece of a ceiling and the plane it lies in (height = plane at a plan point). */
export interface CeilingPiece {
  poly: Vec2[];
  plane: RoofPlane;
}

const AREA = 1e-3;
const flatPlane = (h: number): RoofPlane => ({ c: h, gx: 0, gy: 0 });

/** True where one of the roofs is drawn over the plan point. */
export function roofDrawnAt(roofs: readonly RoofOnLevel[], p: Vec2): boolean {
  return roofs.some((r) => (r.join ? joinedCovers(r.join, p) : pointInPolygon(p, roofOutlineWithOverhang(r.roof))));
}

/** Whether a room can have a ceiling that follows the roof: not under a floor above, a roof drawn over its label point. */
export function canFollowRoof(roofs: readonly RoofOnLevel[], labelPoint: Vec2, underFloor: boolean): boolean {
  return !underFloor && roofDrawnAt(roofs, labelPoint);
}

/**
 * The ceiling of a room that follows the roof, as convex pieces over its net polygon: under each
 * drawn piece of the level's roofs, parallel to the roof's underside and `wallThickness` x its slope
 * below it (so at the inside face of an eave wall it meets the wall's top, which is the plate at the
 * outside face; where two drawn pieces overlap, the one met first is used), cut flat at `flatTop`
 * where it is higher; flat at `flat` where no roof is drawn over the room. Null when no roof is
 * drawn over any of it (the ceiling is then flat).
 */
export function slopedCeilingPieces(net: readonly Vec2[], roofs: readonly RoofOnLevel[], flat: number, flatTop?: number, wallThickness = 0): CeilingPiece[] | null {
  const parts = convexPieces(net);
  const roofPieces = roofs.flatMap((r) => roofDrawnPieces(r.roof, r.bearing, r.join));
  const out: CeilingPiece[] = [];
  let any = false;
  const add = (poly: Vec2[], plane: RoofPlane) => {
    if (poly.length >= 3 && Math.abs(polygonSignedArea(poly)) > AREA) out.push({ poly, plane });
  };
  for (const part of parts) {
    const taken: Vec2[][] = [];
    for (const rp of roofPieces) {
      const x = clipConvex(part, rp.poly);
      if (x.length < 3 || Math.abs(polygonSignedArea(x)) <= AREA) continue;
      for (const piece of taken.length ? convexMinusAll(x, taken) : [x]) {
        any = true;
        const pl = { ...rp.plane, c: rp.plane.c - Math.hypot(rp.plane.gx, rp.plane.gy) * wallThickness };
        if (flatTop === undefined) {
          add(piece, pl);
          continue;
        }
        const g = { x: pl.gx, y: pl.gy };
        if (Math.hypot(g.x, g.y) < 1e-12) {
          add(piece, pl.c > flatTop ? flatPlane(flatTop) : pl);
          continue;
        }
        // Sloped where the roof is at or under the flat top (g . p <= flatTop - c), flat above it.
        add(clipHalfPlane(piece, g, flatTop - pl.c), pl);
        add(clipHalfPlane(piece, { x: -g.x, y: -g.y }, pl.c - flatTop), flatPlane(flatTop));
      }
      taken.push(x);
    }
    for (const rest of taken.length ? convexMinusAll(part, taken) : [part]) add(rest, flatPlane(flat));
  }
  return any ? out : null;
}

/** The ceiling's height over a plan point (for checks): the piece's plane, or null outside the pieces. */
export function ceilingHeightAt(pieces: readonly CeilingPiece[], p: Vec2): number | null {
  for (const pc of pieces) if (pointInPolygon(p, pc.poly)) return planeAt(pc.plane, p);
  return null;
}

/** A room that asks for a ceiling following the roof (Room.ceilingShape). */
export const followsRoof = (r: Pick<Room, 'ceilingShape'>): boolean => r.ceilingShape === 'roof';

/**
 * Whether the room's ceiling can follow the roof in the view (the panel offers the choice only then):
 * a roof of its level is drawn over its label point and it is not under the floor of a level above.
 */
export function roomCanFollowRoof(plan: Plan, levelId: Id, roomId: Id, viewMode: ViewMode): boolean {
  const level = plan.levels[levelId];
  if (!level) return false;
  const face = faceOfRoom(getFaces(level, viewMode), roomId);
  if (!face) return false;
  const aboveId = levelAboveId(plan, levelId);
  const above = aboveId ? plan.levels[aboveId] : undefined;
  const underFloor = !!above && getFaces(above, viewMode).outerFaces.some((o) => pointInPolygon(face.labelPoint, o));
  return canFollowRoof(getLevelRoofs(plan, levelId, viewMode).own, face.labelPoint, underFloor);
}
