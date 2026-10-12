import { add, lineIntersection, pointInPolygon, polygonSignedArea, scale, segmentIntersection, sub } from '../model/geometry';
import type { Id, Level, Vec2, ViewMode } from '../model/types';
import { isVisible } from './phase';
import { polylabel } from './polylabel';

// Rooms (DESIGN.md "Rooms"): planar face enumeration of the walls visible in a view mode.
//
// Winding convention (pinned by rooms.test.ts): plan coordinates are y-down and outgoing half-edges
// at each node are sorted by atan2 ascending (clockwise on screen). A face is traced by stepping
// from half-edge u->v to the outgoing half-edge at v that comes just BEFORE the twin v->u in that
// order (the next one clockwise from the twin in the y-up/math sense). Bounded faces then come out
// clockwise on screen with POSITIVE shoelace area (polygonSignedArea), their interior on the right
// of each half-edge; the outer face of every connected component comes out negative.

/** Faces smaller than one square foot are slivers, not rooms. */
export const MIN_FACE_AREA = 144;

export interface Face {
  /** Stable id: hash of the sorted boundary node ids. */
  id: string;
  /** Boundary nodes in trace order (clockwise on screen), dangling spikes removed. */
  nodeIds: Id[];
  /** Wall of each boundary edge nodeIds[i] -> nodeIds[i + 1]. */
  wallIds: Id[];
  /** Centerline polygon, same order as nodeIds. */
  polygon: Vec2[];
  /** Polygon inset by half of each bounding wall's thickness (or the centerline polygon if that fails). */
  netPolygon: Vec2[];
  /** Square inches. */
  grossArea: number;
  netArea: number;
  /** Room whose anchor lies in this face (the first one, if several do). */
  roomId?: Id;
  /**
   * Where the face's label goes: its room's anchor when that lies inside the net polygon (a label
   * dragged by hand stays put), else the net polygon's pole of inaccessibility (polylabel.ts).
   */
  labelPoint: Vec2;
}

export interface FaceSet {
  faces: Face[];
  /** Outer boundary of each component that encloses at least one face, positive (clockwise on screen). */
  outerFaces: Vec2[][];
  /** Thickness of the wall along each edge outerFaces[k][i] -> [i + 1] (for slabs out to the wall faces). */
  outerFaceThickness: number[][];
  /** Nodes with exactly one visible wall. */
  openEnds: Id[];
  /** Rooms whose anchor is in no face, or in a face another room already labels. */
  orphanRoomIds: Id[];
}

interface Geometry {
  faces: Omit<Face, 'roomId' | 'labelPoint'>[];
  outerFaces: Vec2[][];
  outerFaceThickness: number[][];
  openEnds: Id[];
}

// ---------------------------------------------------------------------------------------------
// Polygon helpers

/** Area-weighted centroid; falls back to the vertex mean for degenerate polygons. */
export function polygonCentroid(poly: readonly Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const c = p.x * q.y - q.x * p.y;
    a += c;
    cx += (p.x + q.x) * c;
    cy += (p.y + q.y) * c;
  }
  if (Math.abs(a) < 1e-9) {
    const n = Math.max(poly.length, 1);
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** A point inside the polygon: its centroid if inside, else the middle of the widest span at that height. */
export function interiorPoint(poly: readonly Vec2[]): Vec2 {
  const c = polygonCentroid(poly);
  if (pointInPolygon(c, poly)) return c;
  const xs: number[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > c.y !== b.y > c.y) xs.push(((b.x - a.x) * (c.y - a.y)) / (b.y - a.y) + a.x);
  }
  xs.sort((p, q) => p - q);
  let best: Vec2 = c;
  let bestW = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > bestW) {
      bestW = xs[i + 1] - xs[i];
      best = { x: (xs[i] + xs[i + 1]) / 2, y: c.y };
    }
  }
  return best;
}

/** True when two non-adjacent edges of the closed polygon cross or touch. */
export function selfIntersects(poly: readonly Vec2[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a0 = poly[i];
    const a1 = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the wrap
      if (segmentIntersection(a0, a1, poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}

/**
 * Inset a positive (clockwise on screen) polygon: edge i moves inward (to its right) by inset[i].
 * Collinear neighbours with equal insets share one point; with different insets the step gets two.
 */
export function insetPolygon(poly: readonly Vec2[], inset: readonly number[]): Vec2[] {
  const n = poly.length;
  const dirs = poly.map((p, i) => {
    const d = sub(poly[(i + 1) % n], p);
    const len = Math.hypot(d.x, d.y);
    return len < 1e-12 ? { x: 0, y: 0 } : { x: d.x / len, y: d.y / len };
  });
  // Right of travel on a y-down plan: (-d.y, d.x).
  const inward = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x });
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const dp = dirs[prev];
    const dn = dirs[i];
    const p = poly[i];
    const lp = add(p, scale(inward(dp), inset[prev]));
    const ln = add(p, scale(inward(dn), inset[i]));
    const x = Math.abs(dp.x * dn.y - dp.y * dn.x) < 1e-9 ? null : lineIntersection(lp, dp, ln, dn);
    if (x) out.push(x);
    else if (Math.abs(inset[prev] - inset[i]) < 1e-9) out.push(ln);
    else out.push(lp, ln);
  }
  return out;
}

function hashIds(ids: readonly string[]): string {
  // FNV-1a over the joined ids; plenty for ids of faces on one level.
  let h = 0x811c9dc5;
  const s = ids.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `f${(h >>> 0).toString(36)}`;
}

// ---------------------------------------------------------------------------------------------
// Face enumeration

/** Faces of the walls visible in `viewMode`. Pure; not memoized. */
export function computeFaceGeometry(level: Pick<Level, 'nodes' | 'walls'>, viewMode: ViewMode): Geometry {
  // Half-edges: 2w is a->b, 2w+1 is b->a, so the twin of h is h ^ 1.
  const from: Id[] = [];
  const to: Id[] = [];
  const wallOf: Id[] = [];
  const angle: number[] = [];
  const thickness: number[] = [];
  for (const w of Object.values(level.walls)) {
    if (!isVisible(w.phase, viewMode)) continue;
    const a = level.nodes[w.a];
    const b = level.nodes[w.b];
    if (!a || !b || w.a === w.b) continue;
    from.push(w.a, w.b);
    to.push(w.b, w.a);
    wallOf.push(w.id, w.id);
    angle.push(Math.atan2(b.y - a.y, b.x - a.x), Math.atan2(a.y - b.y, a.x - b.x));
    thickness.push(w.thickness, w.thickness);
  }
  const H = from.length;
  const out = new Map<Id, number[]>();
  for (let h = 0; h < H; h++) {
    const list = out.get(from[h]);
    if (list) list.push(h);
    else out.set(from[h], [h]);
  }
  const pos = new Int32Array(H);
  for (const list of out.values()) {
    list.sort((p, q) => angle[p] - angle[q] || p - q);
    list.forEach((h, i) => (pos[h] = i));
  }
  const openEnds: Id[] = [];
  for (const [id, list] of out) if (list.length === 1) openEnds.push(id);

  const next = (h: number): number => {
    const t = h ^ 1;
    const list = out.get(to[h])!;
    return list[(pos[t] - 1 + list.length) % list.length];
  };

  const visited = new Uint8Array(H);
  const faces: Geometry['faces'] = [];
  const outerFaces: Vec2[][] = [];
  const outerFaceThickness: number[][] = [];
  const usedIds = new Set<string>();
  for (let start = 0; start < H; start++) {
    if (visited[start]) continue;
    let cycle: number[] = [];
    let h = start;
    while (!visited[h]) {
      visited[h] = 1;
      cycle.push(h);
      h = next(h);
    }
    // Remove spikes (p -> q -> p along one dangling wall) until none are left.
    let changed = true;
    while (changed && cycle.length > 0) {
      changed = false;
      for (let i = 0; i < cycle.length; i++) {
        const j = (i + 1) % cycle.length;
        if (cycle.length >= 2 && (cycle[i] ^ 1) === cycle[j]) {
          cycle = cycle.filter((_, k) => k !== i && k !== j);
          changed = true;
          break;
        }
      }
    }
    if (cycle.length < 3) continue;
    const nodeIds = cycle.map((e) => from[e]);
    const polygon = nodeIds.map((id) => ({ x: level.nodes[id].x, y: level.nodes[id].y }));
    const area = polygonSignedArea(polygon);
    if (area < 0) {
      if (-area >= MIN_FACE_AREA) {
        outerFaces.push([...polygon].reverse());
        // Reversed edge j runs node k-1-j -> k-2-j, which is traced edge k-2-j backwards.
        const k = cycle.length;
        outerFaceThickness.push(cycle.map((_, j) => thickness[cycle[(2 * k - 2 - j) % k]]));
      }
      continue;
    }
    if (area < MIN_FACE_AREA) continue;
    let netPolygon = insetPolygon(
      polygon,
      cycle.map((e) => thickness[e] / 2),
    );
    let netArea = polygonSignedArea(netPolygon);
    if (!(netArea > 0) || netArea > area || selfIntersects(netPolygon)) {
      netPolygon = polygon;
      netArea = area;
    }
    let id = hashIds([...new Set(nodeIds)].sort());
    while (usedIds.has(id)) id += '_';
    usedIds.add(id);
    faces.push({ id, nodeIds, wallIds: cycle.map((e) => wallOf[e]), polygon, netPolygon, grossArea: area, netArea });
  }
  return { faces, outerFaces, outerFaceThickness, openEnds };
}

/**
 * The face's pole of inaccessibility (the centre of the largest circle that fits in the net
 * polygon, to 1"), cached per face geometry: labels are re-done on every room edit, the pole only
 * when the walls change. Falls back to a point inside the centerline polygon when the search finds
 * nothing inside the net one.
 */
const poleCache = new WeakMap<Geometry['faces'][number], Vec2>();
function poleOf(f: Geometry['faces'][number]): Vec2 {
  let p = poleCache.get(f);
  if (!p) {
    const pole = polylabel(f.netPolygon, 1, 200);
    p = pole.distance > 0 ? pole.point : interiorPoint(f.polygon);
    poleCache.set(f, p);
  }
  return p;
}

/**
 * Label rooms: each room's anchor goes to the smallest face containing it; first come, first
 * served. Each face's label point is its room's anchor when that is inside the net polygon, else
 * the pole of inaccessibility. Rooms whose phase the view mode hides (absent: existing) take no part:
 * they name no face and are not orphans.
 */
export function labelFaces(geo: Geometry, rooms: Level['rooms'], viewMode: ViewMode = 'all'): FaceSet {
  const owner = new Map<string, Id>();
  const orphanRoomIds: Id[] = [];
  const anchorOf = new Map<Id, Vec2>();
  for (const room of Object.values(rooms)) {
    if (!isVisible(room.phase ?? 'existing', viewMode)) continue;
    let best: Geometry['faces'][number] | null = null;
    for (const f of geo.faces) {
      if ((!best || f.grossArea < best.grossArea) && pointInPolygon(room.anchor, f.polygon)) best = f;
    }
    if (!best || owner.has(best.id)) orphanRoomIds.push(room.id);
    else {
      owner.set(best.id, room.id);
      anchorOf.set(room.id, room.anchor);
    }
  }
  const faces: Face[] = geo.faces.map((f) => {
    const roomId = owner.get(f.id);
    const anchor = roomId ? anchorOf.get(roomId)! : null;
    const labelPoint = anchor && pointInPolygon(anchor, f.netPolygon) ? anchor : poleOf(f);
    return roomId ? { ...f, roomId, labelPoint } : { ...f, labelPoint };
  });
  return { faces, outerFaces: geo.outerFaces, outerFaceThickness: geo.outerFaceThickness, openEnds: geo.openEnds, orphanRoomIds };
}

// Geometry depends on nodes and walls only; labels also on rooms. Both records keep their identity
// across unrelated edits (immer structural sharing), so a room rename does not re-trace faces and an
// opening edit returns the very same FaceSet.
const geoCache = new WeakMap<Level['nodes'], WeakMap<Level['walls'], Map<ViewMode, Geometry>>>();
const labelCache = new WeakMap<Geometry, WeakMap<Level['rooms'], FaceSet>>();

function getGeometry(level: Level, viewMode: ViewMode): Geometry {
  let byWalls = geoCache.get(level.nodes);
  if (!byWalls) geoCache.set(level.nodes, (byWalls = new WeakMap()));
  let byMode = byWalls.get(level.walls);
  if (!byMode) byWalls.set(level.walls, (byMode = new Map()));
  let geo = byMode.get(viewMode);
  if (!geo) byMode.set(viewMode, (geo = computeFaceGeometry(level, viewMode)));
  return geo;
}

/** Faces, open ends and room labels of a level in a view mode. Memoized. */
export function getFaces(level: Level, viewMode: ViewMode): FaceSet {
  const geo = getGeometry(level, viewMode);
  let byRooms = labelCache.get(geo);
  if (!byRooms) labelCache.set(geo, (byRooms = new WeakMap()));
  let set = byRooms.get(level.rooms);
  if (!set) byRooms.set(level.rooms, (set = labelFaces(geo, level.rooms, viewMode)));
  return set;
}

/** The face a room labels, or null. */
export function faceOfRoom(set: FaceSet, roomId: Id): Face | null {
  return set.faces.find((f) => f.roomId === roomId) ?? null;
}

/**
 * The faces on each side of a wall: `left` is the +normal side of a->b (DESIGN.md), `right` the
 * other. A face's interior is on the right of each of its half-edges, so a face that traces the
 * wall a->b lies on the wall's right and one that traces b->a on its left. Null where no closed
 * face touches that side (outside, or an open area).
 */
export function facesBesideWall(
  set: FaceSet,
  wall: Pick<Level['walls'][string], 'id' | 'a' | 'b'>,
): { left: Face | null; right: Face | null } {
  let left: Face | null = null;
  let right: Face | null = null;
  for (const f of set.faces) {
    const n = f.nodeIds.length;
    for (let i = 0; i < n; i++) {
      if (f.wallIds[i] !== wall.id) continue;
      if (f.nodeIds[i] === wall.a && f.nodeIds[(i + 1) % n] === wall.b) right = f;
      else if (f.nodeIds[i] === wall.b && f.nodeIds[(i + 1) % n] === wall.a) left = f;
    }
  }
  return { left, right };
}

/** The smallest face containing p. */
export function faceAt(set: FaceSet, p: Vec2): Face | null {
  let best: Face | null = null;
  for (const f of set.faces) if ((!best || f.grossArea < best.grossArea) && pointInPolygon(p, f.polygon)) best = f;
  return best;
}

// ---------------------------------------------------------------------------------------------
// Room dimensions, face to face (what a tape measure across the room gives).

export interface RoomDimensions {
  /**
   * Edge lengths of the net polygon with collinear vertices merged (a wall meeting the room's side
   * at a T does not break the side), clockwise on screen from the top-left corner.
   */
  edges: number[];
  /** Corner points matching `edges` (edge i runs corners[i] -> corners[i + 1]). */
  corners: Vec2[];
  /** For a rectangle: its horizontal and vertical sides (width x depth), else null. */
  rect: { width: number; depth: number } | null;
}

/** Face-to-face dimensions of a room's net polygon (Face.netPolygon). */
export function roomDimensions(netPolygon: readonly Vec2[]): RoomDimensions {
  // Drop repeated points, then vertices where the outline runs straight on.
  let pts = netPolygon.filter((p, i) => {
    const q = netPolygon[(i + 1) % netPolygon.length];
    return Math.hypot(q.x - p.x, q.y - p.y) > 1e-6;
  });
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[(i - 1 + pts.length) % pts.length];
      const q = pts[i];
      const r = pts[(i + 1) % pts.length];
      const u = sub(q, p);
      const v = sub(r, q);
      const lu = Math.hypot(u.x, u.y);
      const lv = Math.hypot(v.x, v.y);
      if (Math.abs(u.x * v.y - u.y * v.x) / (lu * lv) < 1e-9 && u.x * v.x + u.y * v.y > 0) {
        pts = pts.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  if (pts.length < 3 || Math.abs(polygonSignedArea(pts)) < 1e-9) return { edges: [], corners: [], rect: null };
  // Start at the top-left corner: smallest y (up the screen), then smallest x.
  let start = 0;
  pts.forEach((p, i) => {
    const s = pts[start];
    if (p.y < s.y - 1e-6 || (Math.abs(p.y - s.y) <= 1e-6 && p.x < s.x)) start = i;
  });
  const corners = [...pts.slice(start), ...pts.slice(0, start)];
  const edges = corners.map((p, i) => {
    const q = corners[(i + 1) % corners.length];
    return Math.hypot(q.x - p.x, q.y - p.y);
  });
  let rect: RoomDimensions['rect'] = null;
  if (corners.length === 4) {
    const dirs = corners.map((p, i) => {
      const q = corners[(i + 1) % 4];
      return { x: (q.x - p.x) / edges[i], y: (q.y - p.y) / edges[i] };
    });
    const square = dirs.every((d, i) => Math.abs(d.x * dirs[(i + 1) % 4].x + d.y * dirs[(i + 1) % 4].y) < 1e-6);
    if (square) {
      const horizontal = Math.abs(dirs[0].x) >= Math.abs(dirs[0].y) ? 0 : 1;
      rect = { width: edges[horizontal], depth: edges[1 - horizontal] };
    }
  }
  return { edges, corners, rect };
}

// ---------------------------------------------------------------------------------------------
// Slabs

/**
 * The slab polygons of a level: each outer face (DESIGN.md "Rooms"), pushed out to the exterior
 * wall faces by half of each edge's wall thickness (the centerline polygon if that fails). Outer
 * faces of components that sit inside another component (a closet island) are skipped: the
 * enclosing slab already covers them.
 *
 * `inside` is for slabs under platform framing, where the walls below run up through the slab
 * (DESIGN.md "Platform framing"): `true` stops every edge at the inside face of its wall (an inset
 * of half the thickness instead of an outset); an array (per outer face, per edge) gives the inside
 * distance of each edge, 0 meaning the edge still reaches the wall's outside face.
 */
export function slabOutlines(
  faces: Pick<FaceSet, 'outerFaces' | 'outerFaceThickness'>,
  toWallFaces = true,
  inside: boolean | readonly (readonly number[])[] = false,
): Vec2[][] {
  const out: Vec2[][] = [];
  faces.outerFaces.forEach((poly, k) => {
    const nested = faces.outerFaces.some((other, j) => j !== k && Math.abs(polygonSignedArea(other)) > Math.abs(polygonSignedArea(poly)) && pointInPolygon(poly[0], other));
    if (nested) return;
    const th = faces.outerFaceThickness?.[k];
    if (!toWallFaces || !th || th.length !== poly.length) {
      out.push(poly);
      return;
    }
    // Per edge, how far it moves inward from the centerline: negative reaches the outside face.
    const insets = th.map((t, j) => {
      if (inside === true) return t / 2;
      const d = inside ? inside[k]?.[j] ?? 0 : 0;
      return d > 0 ? d : -t / 2;
    });
    const grown = insetPolygon(poly, insets);
    const area = polygonSignedArea(grown);
    const ok = insets.every((d) => d < 0) ? area > polygonSignedArea(poly) && !selfIntersects(grown) : area > 0 && !selfIntersects(grown);
    out.push(ok ? grown : poly);
  });
  return out;
}
