import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clipHalfPlane, cross, dot, halfPlaneCrossings, pointInPolygon, polygonSignedArea, scale, sub } from '../model/geometry';
import type { Id, Level, Opening, Phase, Plan, Stairs, Vec2, ViewMode, Wall, WallKind } from '../model/types';
import { getFootprints, type Footprint } from './footprint';
import { getOpeningsByWall, openingSymbol } from './openings';
import { isOpeningVisible, isVisible } from './phase';
import { getFaces, insetPolygon, selfIntersects, type FaceSet } from './rooms';
import { floorToFloor, stairsFrame, stairsOutline, stairsPoint, stairSteps } from './stairs';

// 3D meshes (DESIGN.md "Openings in 3D", "3D"). Pure: no React, no renderer, testable in node.
//
// Coordinates: plan (x, y) maps to three (x, Y, y) with Y up, in inches. Geometry is built in
// level-local space (Y = 0 at the level's floor top); the view puts each level in a group at its
// elevation. Plan polygons with positive polygonSignedArea are clockwise on the y-down screen; a
// triangle that is positive in plan coordinates faces -Y in three, so prism() orients every cap
// triangle and side quad explicitly rather than trusting input winding.

const EPS = 1e-9;

type P3 = [number, number, number];

/** Drop consecutive duplicate points (including first/last). */
function cleanRing(poly: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > EPS || Math.abs(last.y - p.y) > EPS) out.push({ x: p.x, y: p.y });
  }
  while (out.length > 1) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.abs(f.x - l.x) > EPS || Math.abs(f.y - l.y) > EPS) break;
    out.pop();
  }
  return out;
}

/** An empty geometry with the same attributes as prism() output, so it merges and renders as nothing. */
export function emptyGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([], 3));
  g.setAttribute('normal', new Float32BufferAttribute([], 3));
  return g;
}

export const triangleCount = (g: BufferGeometry): number => (g.getAttribute('position')?.count ?? 0) / 3;

export interface PrismOptions {
  /** Emit the bottom (Y = y0) / top (Y = y1) cap. Default true. */
  bottom?: boolean;
  top?: boolean;
  /**
   * Emit the side face of edge p -> q (the edge as stored after winding normalization). Default:
   * every side. Faces another solid covers exactly (a wall end at a join, a cut between two wall
   * pieces) must be left out: coincident internal faces win the depth test along the seam and
   * show as hairlines.
   */
  side?: (p: Vec2, q: Vec2) => boolean;
}

/**
 * Extrude a plan polygon (with optional holes) from Y = y0 to Y = y1. Any input winding: the outer
 * ring is normalized to positive signed area and holes to negative, cap triangles are oriented by
 * their own signed area, so every face's normal points out of the solid. Non-indexed, flat normals.
 */
export function prism(
  polygon: readonly Vec2[],
  y0: number,
  y1: number,
  holes: readonly (readonly Vec2[])[] = [],
  opts: PrismOptions = {},
): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(prismPositions(polygon, y0, y1, holes, opts), 3));
  g.computeVertexNormals(); // non-indexed: one face normal per triangle
  return g;
}

function prismPositions(
  polygon: readonly Vec2[],
  y0: number,
  y1: number,
  holes: readonly (readonly Vec2[])[],
  { bottom = true, top = true, side }: PrismOptions,
): number[] {
  const pos: number[] = [];
  const outer = cleanRing(polygon);
  if (outer.length < 3 || !(y1 - y0 > EPS) || Math.abs(polygonSignedArea(outer)) < EPS) return pos;
  if (polygonSignedArea(outer) < 0) outer.reverse();
  const hs = holes
    .map(cleanRing)
    .filter((h) => h.length >= 3 && Math.abs(polygonSignedArea(h)) > EPS)
    .map((h) => (polygonSignedArea(h) > 0 ? h.reverse() : h));
  const tri = (a: P3, b: P3, c: P3) => pos.push(...a, ...b, ...c);

  // Caps. A triangle with positive plan area faces -Y: emit it as is for the bottom, reversed for
  // the top.
  if (bottom || top) {
    const all = [outer, ...hs].flat();
    const faces = ShapeUtils.triangulateShape(
      outer.map((p) => new Vector2(p.x, p.y)),
      hs.map((h) => h.map((p) => new Vector2(p.x, p.y))),
    );
    for (const [i, j, k] of faces) {
      const a = all[i];
      let b = all[j];
      let c = all[k];
      const area = cross(sub(b, a), sub(c, a));
      if (Math.abs(area) < 1e-12) continue;
      if (area < 0) [b, c] = [c, b];
      if (bottom) tri([a.x, y0, a.y], [b.x, y0, b.y], [c.x, y0, c.y]);
      if (top) tri([a.x, y1, a.y], [c.x, y1, c.y], [b.x, y1, b.y]);
    }
  }

  // Sides. Outer ring positive and holes negative: the solid is on the left of every edge (in the
  // math sense), so (p0, q1, q0) faces right, out of the solid.
  for (const ring of [outer, ...hs]) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      if (side && !side(p, q)) continue;
      const p0: P3 = [p.x, y0, p.y];
      const q0: P3 = [q.x, y0, q.y];
      const p1: P3 = [p.x, y1, p.y];
      const q1: P3 = [q.x, y1, q.y];
      tri(p0, q1, q0);
      tri(p0, p1, q1);
    }
  }
  return pos;
}

/** Merge geometries (disposing the parts); empty parts are skipped. */
export function mergeAll(parts: BufferGeometry[]): BufferGeometry {
  const nonEmpty = parts.filter((g) => triangleCount(g) > 0);
  let out: BufferGeometry;
  if (nonEmpty.length === 0) out = emptyGeometry();
  else if (nonEmpty.length === 1) out = nonEmpty[0];
  else out = mergeGeometries(nonEmpty) ?? emptyGeometry();
  for (const g of parts) if (g !== out) g.dispose();
  return out;
}

// ---------------------------------------------------------------------------------------------
// Walls

/** A slice of a wall along its centerline, with the solid vertical ranges in it. */
export interface WallSpan {
  /** Centerline interval; -Infinity / Infinity for the end regions (they take the cap points). */
  from: number;
  to: number;
  /** Solid [bottom, top] ranges above the floor top, ascending. */
  solid: [number, number][];
}

interface Hole {
  j0: number;
  j1: number;
  bottom: number;
  top: number;
}

/**
 * Split a wall into spans: the start region up to the first jamb, the pieces between and inside
 * openings, and the end region after the last jamb. Inside an opening the span is solid below the
 * sill and above the head. Neighbouring spans with the same solid ranges are merged, so a wall with
 * no (visible) openings is one span.
 */
export function wallSpans(
  fp: Footprint,
  wall: Wall,
  openings: readonly Opening[],
  wallHeight: number,
  viewMode: ViewMode = 'all',
): WallSpan[] {
  const holes: Hole[] = [];
  for (const o of openings) {
    if (o.wallId !== wall.id || !isOpeningVisible(o, wall, viewMode)) continue;
    const sym = openingSymbol(fp, o);
    const bottom = Math.max(0, o.sill);
    const top = Math.min(wallHeight, o.sill + o.height);
    if (sym.j1 - sym.j0 > 1e-6 && top - bottom > 1e-6) holes.push({ j0: sym.j0, j1: sym.j1, bottom, top });
  }
  const cuts = [...new Set(holes.flatMap((h) => [h.j0, h.j1]))].sort((p, q) => p - q);
  const bounds: number[] = [];
  for (const c of cuts) if (!bounds.length || c - bounds[bounds.length - 1] > 1e-6) bounds.push(c);
  const edges = [-Infinity, ...bounds, Infinity];
  const spans: WallSpan[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const from = edges[i];
    const to = edges[i + 1];
    const mid = Number.isFinite(from) && Number.isFinite(to) ? (from + to) / 2 : NaN;
    const cover = Number.isNaN(mid) ? [] : holes.filter((h) => h.j0 - 1e-6 <= mid && mid <= h.j1 + 1e-6);
    // [0, H] minus the union of the covering holes' vertical ranges.
    const iv = cover.map((h): [number, number] => [h.bottom, h.top]).sort((p, q) => p[0] - q[0]);
    const solid: [number, number][] = [];
    let y = 0;
    for (const [b, t] of iv) {
      if (b > y + 1e-6) solid.push([y, b]);
      y = Math.max(y, t);
    }
    if (wallHeight > y + 1e-6) solid.push([y, wallHeight]);
    const prev = spans[spans.length - 1];
    if (prev && prev.solid.length === solid.length && prev.solid.every((r, k) => Math.abs(r[0] - solid[k][0]) < 1e-9 && Math.abs(r[1] - solid[k][1]) < 1e-9)) {
      prev.to = to;
    } else spans.push({ from, to, solid });
  }
  return spans;
}

/** Plan polygon of a wall between two centerline positions (either may be infinite). */
function slice(base: readonly Vec2[], fp: Footprint, from: number, to: number): Vec2[] {
  const a0 = dot(fp.dir, fp.a);
  let poly: Vec2[] = [...base];
  if (Number.isFinite(from)) poly = clipHalfPlane(poly, scale(fp.dir, -1), -(from + a0));
  if (Number.isFinite(to) && poly.length) poly = clipHalfPlane(poly, fp.dir, to + a0);
  return poly;
}

const samePoint = (p: Vec2, q: Vec2) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;

/**
 * The fill outline with extra vertices wherever another outline's corner lies on one of its edges:
 * the stroke-edge trim points (where a butt wall's faces land on a through wall) and the corners of
 * neighbouring walls (`extra`). Neighbours then share every vertex along common edges, so there
 * are no T-junctions to crack open.
 */
function baseOutline(fp: Footprint, poly: readonly Vec2[], extra: readonly Vec2[]): Vec2[] {
  const pts = [...fp.edge, ...extra];
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    out.push(p);
    const d = sub(q, p);
    const len2 = dot(d, d);
    if (len2 < 1e-18) continue;
    const len = Math.sqrt(len2);
    const inner = pts
      .map((x) => ({ x, t: dot(sub(x, p), d) / len2 }))
      .filter(({ x, t }) => t > 1e-9 && t < 1 - 1e-9 && Math.abs(cross(d, sub(x, p))) / len < 1e-6 && !samePoint(x, p) && !samePoint(x, q))
      .sort((u, v) => u.t - v.t);
    for (const { x } of inner) if (!samePoint(x, out[out.length - 1])) out.push(x);
  }
  return out;
}

/** Corners of other outlines that lie on this footprint's outline edges (for WallContext.splitPoints). */
export function splitPointsFor(fp: Footprint, others: Iterable<Footprint>): Vec2[] {
  const out: Vec2[] = [];
  const poly = fp.poly;
  const minX = Math.min(...poly.map((p) => p.x)) - 1e-6;
  const maxX = Math.max(...poly.map((p) => p.x)) + 1e-6;
  const minY = Math.min(...poly.map((p) => p.y)) - 1e-6;
  const maxY = Math.max(...poly.map((p) => p.y)) + 1e-6;
  for (const other of others) {
    if (other === fp) continue;
    for (const x of [...other.poly, ...other.edge]) {
      if (x.x < minX || x.x > maxX || x.y < minY || x.y > maxY) continue;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        const d = sub(q, p);
        const len2 = dot(d, d);
        if (len2 < 1e-18) continue;
        const t = dot(sub(x, p), d) / len2;
        if (t > 1e-9 && t < 1 - 1e-9 && Math.abs(cross(d, sub(x, p))) / Math.sqrt(len2) < 1e-6 && !out.some((o) => samePoint(o, x))) {
          out.push({ x: x.x, y: x.y });
          break;
        }
      }
    }
  }
  return out;
}

/** How a wall's neighbours shape its faces; see buildWallGeometry. */
export interface WallContext {
  /**
   * Heights at which every wall of the level is split into horizontal bands (sills and heads of
   * the level's openings, wall heights). Using one set for the whole level means pieces and
   * neighbouring walls always share the vertices along their common edges.
   */
  bands?: readonly number[];
  /**
   * Height of the lowest other wall at each end that covers this wall's join face there (0 when
   * none). A join face (mitre, butt end, through-wall split) is internal, so not emitted, up to that
   * height. Default: this wall's own height.
   */
  endHeights?: { a: number; b: number };
  /**
   * Height up to which butt walls cover the stretch of this wall's long face they land on, at each
   * end (0 when a butt wall there is see-through). Default: endHeights.
   */
  buttHeights?: { a: number; b: number };
  /** Neighbours' corners lying on this wall's outline edges (see splitPointsFor). */
  splitPoints?: readonly Vec2[];
}

/**
 * A wall as a solid with real holes for its openings, built from prisms (no CSG): the footprint's
 * fill outline is cut by lines perpendicular to the wall at every jamb, and each piece is extruded
 * band by band over its solid ranges. The end pieces keep the outline's corner and cap points, so
 * mitred corners stay watertight. Only faces on the outside of the union are emitted: long faces,
 * open-end caps and bevels, jambs, sills and heads, the top; join faces and the faces between
 * pieces and bands are left out. A cut line that crosses the outline more than twice (an unusual
 * non-convex junction cap reaching into the opening zone) falls back to cutting the plain quad.
 */
export function buildWallGeometry(
  fp: Footprint,
  wall: Wall,
  openings: readonly Opening[],
  wallHeight: number,
  viewMode: ViewMode = 'all',
  ctx: WallContext = {},
): BufferGeometry {
  const H = wallHeight;
  const spans = wallSpans(fp, wall, openings, H, viewMode);
  const a0 = dot(fp.dir, fp.a);
  let src: readonly Vec2[] = fp.poly;
  for (const s of spans) {
    for (const c of [s.from, s.to]) {
      if (Number.isFinite(c) && halfPlaneCrossings(fp.poly, fp.dir, c + a0) > 2) src = fp.quad;
    }
  }
  const base = baseOutline(fp, src, ctx.splitPoints ?? []);
  const pieces = spans.map((s) => {
    const poly = spans.length === 1 ? base : slice(base, fp, s.from, s.to);
    return { span: s, poly: poly.length >= 3 ? poly : null };
  });

  // Horizontal bands: the level-wide heights plus this wall's own range bounds, within (0, H).
  const raw = [0, H, ...(ctx.bands ?? []), ...spans.flatMap((s) => s.solid.flat())].filter((y) => y >= 0 && y <= H).sort((p, q) => p - q);
  const ys: number[] = [];
  for (const y of raw) if (!ys.length || y - ys[ys.length - 1] > 1e-7) ys.push(y);

  const solidAt = (i: number, y0: number, y1: number): boolean => {
    const piece = pieces[i];
    return !!piece?.poly && piece.span.solid.some(([b, t]) => b <= y0 + 1e-7 && y1 <= t + 1e-7);
  };
  const along = (p: Vec2) => dot(sub(p, fp.a), fp.dir);
  const off = (p: Vec2) => dot(sub(p, fp.a), fp.normal);
  const h = fp.thickness / 2;
  const onSeg = (p: Vec2, [u, v]: readonly [Vec2, Vec2]) => {
    const d = sub(v, u);
    const len = Math.hypot(d.x, d.y);
    if (len < 1e-9) return false;
    const t = dot(sub(p, u), d) / (len * len);
    return t > -1e-7 && t < 1 + 1e-7 && Math.abs(cross(d, sub(p, u))) / len < 1e-6;
  };
  const isCapEdge = (p: Vec2, q: Vec2) => fp.capEdges.some((seg) => onSeg(p, seg) && onSeg(q, seg));
  const endHeights = ctx.endHeights ?? { a: H, b: H };
  const buttHeights = ctx.buttHeights ?? endHeights;
  const [q0, q1, q2, q3] = fp.quad;
  const [e0, e1, e2, e3] = fp.edge;
  const interval = (p: Vec2, q: Vec2): [number, number] => [Math.min(along(p), along(q)), Math.max(along(p), along(q))];
  const coveredLeft = [interval(q0, e0), interval(e1, q1)].filter(([u, v]) => v - u > 1e-7);
  const coveredRight = [interval(q3, e3), interval(e2, q2)].filter(([u, v]) => v - u > 1e-7);

  const parts: BufferGeometry[] = [];
  pieces.forEach((piece, i) => {
    if (!piece.poly) return;
    const { span, poly } = piece;
    for (let k = 0; k + 1 < ys.length; k++) {
      const y0 = ys[k];
      const y1 = ys[k + 1];
      if (!solidAt(i, y0, y1)) continue;
      const side = (p: Vec2, q: Vec2): boolean => {
        const sp = along(p);
        const sq = along(q);
        if (Math.abs(sp - sq) < 1e-7) {
          // A cut between this piece and the previous / next one: open where that one is not solid.
          if (Number.isFinite(span.from) && Math.abs(sp - span.from) < 1e-7) return !solidAt(i - 1, y0, y1);
          if (Number.isFinite(span.to) && Math.abs(sp - span.to) < 1e-7) return !solidAt(i + 1, y0, y1);
        }
        const op = off(p);
        const oq = off(q);
        const mid = (sp + sq) / 2;
        const end = mid < fp.length / 2 ? endHeights.a : endHeights.b;
        const leftSide = Math.abs(op - h) < 1e-6 && Math.abs(oq - h) < 1e-6;
        if (leftSide || (Math.abs(op + h) < 1e-6 && Math.abs(oq + h) < 1e-6)) {
          // A long face, except the stretch a butt wall's end covers (between the quad corner and
          // the stroke edge's trim point), which is internal like a join face.
          const covered = leftSide ? coveredLeft : coveredRight;
          const butt = mid < fp.length / 2 ? buttHeights.a : buttHeights.b;
          if (covered.some(([u, v]) => mid > u + 1e-7 && mid < v - 1e-7)) return y1 > butt + 1e-7;
          return true;
        }
        if (isCapEdge(p, q)) return true;
        // A join face: covered by the neighbours up to the lowest of them.
        return y1 > end + 1e-7;
      };
      const bottom = k === 0 || !solidAt(i, ys[k - 1], y0);
      const top = k + 2 >= ys.length || !solidAt(i, y1, ys[k + 2]);
      parts.push(prism(poly, y0, y1, [], { bottom, top, side }));
    }
  });
  return mergeAll(parts);
}

// ---------------------------------------------------------------------------------------------
// Floors and stairs

/**
 * The slab polygons of a level: each outer face (DESIGN.md "Rooms"), pushed out to the exterior
 * wall faces by half of each edge's wall thickness (the centerline polygon if that fails). Outer
 * faces of components that sit inside another component (a closet island) are skipped: the
 * enclosing slab already covers them.
 */
export function slabOutlines(faces: Pick<FaceSet, 'outerFaces' | 'outerFaceThickness'>, toWallFaces = true): Vec2[][] {
  const out: Vec2[][] = [];
  faces.outerFaces.forEach((poly, k) => {
    const nested = faces.outerFaces.some((other, j) => j !== k && Math.abs(polygonSignedArea(other)) > Math.abs(polygonSignedArea(poly)) && pointInPolygon(poly[0], other));
    if (nested) return;
    const th = faces.outerFaceThickness?.[k];
    if (!toWallFaces || !th || th.length !== poly.length) {
      out.push(poly);
      return;
    }
    const grown = insetPolygon(poly, th.map((t) => -t / 2));
    const ok = polygonSignedArea(grown) > polygonSignedArea(poly) && !selfIntersects(grown);
    out.push(ok ? grown : poly);
  });
  return out;
}

/** True when the hole lies strictly inside the outline and does not touch any accepted hole. */
function holeFits(hole: readonly Vec2[], outline: readonly Vec2[], accepted: readonly (readonly Vec2[])[]): boolean {
  if (!hole.every((p) => pointInPolygon(p, outline))) return false;
  for (let i = 0; i < hole.length; i++) {
    const p = hole[i];
    const q = hole[(i + 1) % hole.length];
    for (let j = 0; j < outline.length; j++) {
      if (segmentsTouch(p, q, outline[j], outline[(j + 1) % outline.length])) return false;
    }
  }
  for (const other of accepted) {
    if (hole.some((p) => pointInPolygon(p, other)) || other.some((p) => pointInPolygon(p, hole))) return false;
    for (let i = 0; i < hole.length; i++) {
      for (let j = 0; j < other.length; j++) {
        if (segmentsTouch(hole[i], hole[(i + 1) % hole.length], other[j], other[(j + 1) % other.length])) return false;
      }
    }
  }
  return true;
}

function segmentsTouch(p0: Vec2, p1: Vec2, q0: Vec2, q1: Vec2): boolean {
  const d1 = cross(sub(p1, p0), sub(q0, p0));
  const d2 = cross(sub(p1, p0), sub(q1, p0));
  const d3 = cross(sub(q1, q0), sub(p0, q0));
  const d4 = cross(sub(q1, q0), sub(p1, q0));
  if (d1 === 0 && d2 === 0) return boxesOverlap(p0, p1, q0, q1); // collinear
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}

function boxesOverlap(p0: Vec2, p1: Vec2, q0: Vec2, q1: Vec2): boolean {
  return (
    Math.max(p0.x, p1.x) >= Math.min(q0.x, q1.x) &&
    Math.max(q0.x, q1.x) >= Math.min(p0.x, p1.x) &&
    Math.max(p0.y, p1.y) >= Math.min(q0.y, q1.y) &&
    Math.max(q0.y, q1.y) >= Math.min(p0.y, p1.y)
  );
}

/**
 * A level's floor slab, from `-thickness` to 0 (level-local), one prism per slab outline with the
 * given holes (stair openings) that fit inside it. Null when there is no closed outer face.
 */
export function buildFloorGeometry(
  faces: Pick<FaceSet, 'outerFaces' | 'outerFaceThickness'>,
  holes: readonly (readonly Vec2[])[],
  thickness: number,
): BufferGeometry | null {
  if (!(thickness > EPS)) return null;
  const outlines = slabOutlines(faces);
  if (outlines.length === 0) return null;
  const parts = outlines.map((outline) => {
    const inside: (readonly Vec2[])[] = [];
    for (const h of holes) if (holeFits(h, outline, inside)) inside.push(h);
    return prism(outline, -thickness, 0, inside);
  });
  const g = mergeAll(parts);
  if (triangleCount(g) === 0) {
    g.dispose();
    return null;
  }
  return g;
}

/**
 * A flight of stairs: `risers` steps, each a 1/risers slice of the run rising `rise` higher than the
 * last, so the last step is flush with the floor above. Built as one solid (the stepped side profile
 * extruded across the width) rather than separate boxes, so no internal faces show as seams.
 */
export function buildStairsGeometry(stairs: Pick<Stairs, 'origin' | 'direction' | 'width' | 'run'>, rise: number, risers: number): BufferGeometry {
  const d = stairs.run / risers;
  // Profile in (along the run, height).
  const profile: Vec2[] = [{ x: 0, y: 0 }];
  for (let i = 0; i < risers; i++) {
    profile.push({ x: i * d, y: (i + 1) * rise }, { x: (i + 1) * d, y: (i + 1) * rise });
  }
  profile.push({ x: stairs.run, y: 0 });
  // prism() extrudes along its Y slot: positions come out as (along, lateral, height).
  const local = prism(profile, -stairs.width / 2, stairs.width / 2);
  const f = stairsFrame(stairs);
  const src = local.getAttribute('position');
  const out: number[] = [];
  const map = (i: number): P3 => {
    const p = stairsPoint(f, src.getX(i), src.getY(i));
    return [p.x, src.getZ(i), p.y];
  };
  // (along, lateral, height) -> (x, Y, z) is a reflection when u x v points down; keep faces outward.
  const flip = cross(f.u, f.v) > 0;
  for (let i = 0; i < src.count; i += 3) {
    const [a, b, c] = [map(i), map(i + 1), map(i + 2)];
    out.push(...a, ...(flip ? c : b), ...(flip ? b : c));
  }
  local.dispose();
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(out, 3));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Memoized level meshes

export interface WallMesh {
  id: Id;
  geometry: BufferGeometry;
  phase: Phase;
  kind: WallKind;
}

export interface StairsMesh {
  id: Id;
  geometry: BufferGeometry;
  phase: Phase;
}

export interface LevelMeshes {
  walls: WallMesh[];
  /** The slab under this level (level-local Y from -floorThickness to 0). */
  floor?: BufferGeometry;
  stairs: StairsMesh[];
}

interface WallEntry {
  fp: Footprint;
  wall: Wall;
  openings: readonly Opening[] | undefined;
  height: number;
  /** WallContext as a string: bands and end heights. */
  ctxKey: string;
  geometry: BufferGeometry;
}

interface FloorEntry {
  outerFaces: FaceSet['outerFaces'];
  outerFaceThickness: FaceSet['outerFaceThickness'];
  belowStairs: Level['stairs'] | undefined;
  thickness: number;
  geometry: BufferGeometry | null;
}

interface StairsEntry {
  stairs: Stairs;
  rise: number;
  risers: number;
  geometry: BufferGeometry;
}

interface LevelEntry {
  level: Level;
  belowStairs: Level['stairs'] | undefined;
  ftf: number;
  result: LevelMeshes;
}

/** Demolished elements are drawn translucent (view3d/materials.ts). */
export const isSeeThrough = (phase: Phase): boolean => phase === 'demo';

// Keyed by `${levelId}|${viewMode}`. Each entry holds the geometries the last result used; a
// geometry that is not carried into the next result is disposed.
const wallCache = new Map<string, Map<Id, WallEntry>>();
const floorCache = new Map<string, FloorEntry>();
const stairsCache = new Map<string, Map<Id, StairsEntry>>();
const levelCache = new Map<string, LevelEntry>();

/** Value equality of nested arrays of points or numbers (faces are re-traced on any node move). */
function sameRings<T extends Vec2 | number>(p: readonly (readonly T[])[], q: readonly (readonly T[])[]): boolean {
  if (p === q) return true;
  if (p.length !== q.length) return false;
  return p.every((ring, i) => {
    const other = q[i];
    return (
      ring.length === other.length &&
      ring.every((v, j) => {
        const w = other[j];
        return typeof v === 'number' ? v === w : (v as Vec2).x === (w as Vec2).x && (v as Vec2).y === (w as Vec2).y;
      })
    );
  });
}

/** Holes cut in a level's slab by stairs on the level below. */
function stairHoles(below: Level | undefined, viewMode: ViewMode): Vec2[][] {
  if (!below) return [];
  return Object.values(below.stairs)
    .filter((s) => s.cutsFloorAbove && isVisible(s.phase, viewMode))
    .map((s) => stairsOutline(s));
}

/** Drop and dispose cache entries of levels that are no longer in the plan. */
function pruneCaches(plan: Plan): void {
  const alive = (key: string) => plan.levels[key.slice(0, key.lastIndexOf('|'))] !== undefined;
  for (const [key, m] of wallCache) {
    if (alive(key)) continue;
    for (const e of m.values()) e.geometry.dispose();
    wallCache.delete(key);
  }
  for (const [key, e] of floorCache) {
    if (alive(key)) continue;
    e.geometry?.dispose();
    floorCache.delete(key);
  }
  for (const [key, m] of stairsCache) {
    if (alive(key)) continue;
    for (const e of m.values()) e.geometry.dispose();
    stairsCache.delete(key);
  }
  for (const key of levelCache.keys()) if (!alive(key)) levelCache.delete(key);
}

/**
 * Wall, slab and stairs geometry of one level in a view mode, memoized. The same result object is
 * returned while the level, the stairs of the level below and the floor-to-floor height are
 * unchanged. Otherwise each wall's geometry is reused while its footprint object (which keeps its
 * identity while the wall's outline is unchanged), wall, openings list and height are the same, so
 * moving one node rebuilds only the walls whose outline changed.
 */
export function getLevelMeshes(plan: Plan, levelId: Id, viewMode: ViewMode): LevelMeshes {
  const level = plan.levels[levelId];
  if (!level) return { walls: [], stairs: [] };
  const key = `${levelId}|${viewMode}`;
  const idx = plan.levelOrder.indexOf(levelId);
  const below = idx > 0 ? plan.levels[plan.levelOrder[idx - 1]] : undefined;
  const ftf = floorToFloor(plan, levelId);
  const hit = levelCache.get(key);
  if (hit && hit.level === level && hit.belowStairs === below?.stairs && hit.ftf === ftf) return hit.result;
  pruneCaches(plan);

  // Walls.
  const fps = getFootprints(level, viewMode);
  const byWall = getOpeningsByWall(level);
  const prevWalls = wallCache.get(key);
  const nextWalls = new Map<Id, WallEntry>();
  const walls: WallMesh[] = [];
  const heightOf = (w: Wall) => w.heightOverride ?? level.wallHeight;
  // Level-wide band heights: every visible sill and head, every wall height.
  const bandSet = new Set<number>();
  for (const w of Object.values(level.walls)) if (fps.has(w.id)) bandSet.add(heightOf(w));
  for (const o of Object.values(level.openings)) {
    if (!fps.has(o.wallId) || !isOpeningVisible(o, level.walls[o.wallId], viewMode)) continue;
    bandSet.add(Math.max(0, o.sill));
    bandSet.add(o.sill + o.height);
  }
  const bands = [...bandSet].sort((p, q) => p - q);
  const bandsKey = bands.join(',');
  // Heights of the visible walls at each node, for the join faces. Only a neighbour drawn the same
  // way covers a join: through a translucent (demolished) wall you would see into an opaque wall
  // whose join face was left out, so mixed joins keep their faces.
  const atNode = new Map<Id, { id: Id; h: number; seeThrough: boolean; dir: Vec2 }[]>();
  for (const w of Object.values(level.walls)) {
    const fp = fps.get(w.id);
    if (!fp) continue;
    for (const n of [w.a, w.b]) {
      const list = atNode.get(n);
      const item = { id: w.id, h: heightOf(w), seeThrough: isSeeThrough(w.phase), dir: fp.dir };
      if (list) list.push(item);
      else atNode.set(n, [item]);
    }
  }
  // Butt walls (not collinear with this one) cover the stretch of its face they land on, unless
  // one of them is see-through.
  const buttCover = (nodeId: Id, wall: Wall, dir: Vec2) => {
    const butts = (atNode.get(nodeId) ?? []).filter((x) => x.id !== wall.id && Math.abs(cross(x.dir, dir)) > 1e-6);
    if (!butts.length || butts.some((x) => x.seeThrough !== isSeeThrough(wall.phase))) return 0;
    return Math.min(...butts.map((x) => x.h));
  };
  const lowestOther = (nodeId: Id, wall: Wall) => {
    const hs = (atNode.get(nodeId) ?? []).filter((x) => x.id !== wall.id && x.seeThrough === isSeeThrough(wall.phase)).map((x) => x.h);
    return hs.length ? Math.min(...hs) : 0; // nothing covers the join
  };
  for (const wall of Object.values(level.walls)) {
    const fp = fps.get(wall.id);
    if (!fp) continue;
    const openings = byWall.get(wall.id);
    const height = heightOf(wall);
    const endHeights = { a: lowestOther(wall.a, wall), b: lowestOther(wall.b, wall) };
    const buttHeights = { a: buttCover(wall.a, wall, fp.dir), b: buttCover(wall.b, wall, fp.dir) };
    const splitPoints = splitPointsFor(fp, fps.values());
    const ctxKey = [bandsKey, endHeights.a, endHeights.b, buttHeights.a, buttHeights.b, splitPoints.map((p) => `${p.x},${p.y}`).join(';')].join('|');
    const old = prevWalls?.get(wall.id);
    const entry =
      old && old.fp === fp && old.wall === wall && old.openings === openings && old.height === height && old.ctxKey === ctxKey
        ? old
        : {
            fp,
            wall,
            openings,
            height,
            ctxKey,
            geometry: buildWallGeometry(fp, wall, openings ?? [], height, viewMode, { bands, endHeights, buttHeights, splitPoints }),
          };
    nextWalls.set(wall.id, entry);
    walls.push({ id: wall.id, geometry: entry.geometry, phase: wall.phase, kind: wall.kind });
  }
  if (prevWalls) for (const [id, e] of prevWalls) if (nextWalls.get(id) !== e) e.geometry.dispose();
  wallCache.set(key, nextWalls);

  // Floor slab.
  const faces = getFaces(level, viewMode);
  const belowStairs = below?.stairs;
  const prevFloor = floorCache.get(key);
  let floor: FloorEntry;
  if (
    prevFloor &&
    sameRings(prevFloor.outerFaces, faces.outerFaces) &&
    sameRings(prevFloor.outerFaceThickness, faces.outerFaceThickness) &&
    prevFloor.belowStairs === belowStairs &&
    prevFloor.thickness === level.floorThickness
  ) {
    floor = prevFloor;
  } else {
    prevFloor?.geometry?.dispose();
    const holes = stairHoles(below, viewMode);
    floor = {
      outerFaces: faces.outerFaces,
      outerFaceThickness: faces.outerFaceThickness,
      belowStairs,
      thickness: level.floorThickness,
      geometry: buildFloorGeometry(faces, holes, level.floorThickness),
    };
    floorCache.set(key, floor);
  }

  // Stairs.
  const { rise, risers } = stairSteps(ftf);
  const prevStairs = stairsCache.get(key);
  const nextStairs = new Map<Id, StairsEntry>();
  const stairs: StairsMesh[] = [];
  for (const s of Object.values(level.stairs)) {
    if (!isVisible(s.phase, viewMode) || !(s.width > 0) || !(s.run > 0)) continue;
    const old = prevStairs?.get(s.id);
    const entry =
      old && old.stairs === s && old.rise === rise && old.risers === risers
        ? old
        : { stairs: s, rise, risers, geometry: buildStairsGeometry(s, rise, risers) };
    nextStairs.set(s.id, entry);
    stairs.push({ id: s.id, geometry: entry.geometry, phase: s.phase });
  }
  if (prevStairs) for (const [id, e] of prevStairs) if (nextStairs.get(id) !== e) e.geometry.dispose();
  stairsCache.set(key, nextStairs);

  const result: LevelMeshes = { walls, stairs, ...(floor.geometry ? { floor: floor.geometry } : {}) };
  levelCache.set(key, { level, belowStairs, ftf, result });
  return result;
}

/** Dispose every cached geometry (tests, or when the 3D view is torn down for good). */
export function clearMeshCache(): void {
  for (const m of wallCache.values()) for (const e of m.values()) e.geometry.dispose();
  for (const e of floorCache.values()) e.geometry?.dispose();
  for (const m of stairsCache.values()) for (const e of m.values()) e.geometry.dispose();
  wallCache.clear();
  floorCache.clear();
  stairsCache.clear();
  levelCache.clear();
}
