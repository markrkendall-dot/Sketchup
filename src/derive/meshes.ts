import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Uint32BufferAttribute, Vector2 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clipHalfPlane, cross, dot, halfPlaneCrossings, pointInPolygon, polygonSignedArea, scale, sub } from '../model/geometry';
import type { Column, Fixture, FixtureKind, FloorFinish, Id, Level, LevelFinishes, Opening, Phase, Plan, Roof, RoofFinish, Room, RoomWallFinish, Site, Stairs, Vec2, ViewMode, Wall, WallFinish, WallKind } from '../model/types';
import { counterRuns, fixtureBoxes, fixtureFrame, fixturePoint, type CasePart, type CounterRun } from './casework';
import { frontColorOf, frontStyleOf, hasCounter } from '../model/casework';
import { DECK, getDeckLayout, type DeckBox, type DeckLayout } from './decks';
import { memberBoxes } from './members';
import { isTimber } from '../model/structure';
import { floorOpeningHoles, getFloorOpeningLayout, type FloorOpeningLayout } from './floorOpenings';
import { getFootprints, type Footprint } from './footprint';
import { columnColorOf, deckColorOf, DEFAULT_INTERIOR_COLOR, DEFAULT_TRIM, floorLookOf, isSlidingDoor, leafColorOf, roomWallLookOf, wainscotOf, wallColorOf, wallFinishOf } from '../model/finish';
import { getOpeningsByWall, openingSymbol, wallPoint } from './openings';
import { openingFill, type FillBox, type FillPart } from './openings3d';
import { isOpeningVisible, isVisible, shownPhase } from './phase';
import { slabInsets, wallExtensions } from './platform';
import { facesBesideWall, getFaces, slabOutlines, wallSideFaces, type FaceSet } from './rooms';
import { CHIMNEY_CAP, chimneyPartBoxes, columnOutline, hasChimneyCap, planTerrain, type ChimneyPart, type TerrainGrid } from './site';
import { boardColorOf, DEFAULT_SASH_COLOR, ROOF_COLOR, roofColorOf, ROOF_TILE, SIDING_FINISHES, TRIM_COLOR, weatheringOf } from '../model/finish';
import { profileAt, roofBearing, roofFrame, roofSolid, slopedPrismPositions, wallRoofProfile, type RoofOnLevel, type SlopedPrismOptions, type WallProfile } from './roofs';
import { flightSteps, floorToFloor, stairsBase, stairsFrame, stairsHoleOutline, stairsPoint } from './stairs';
import { getStaircaseLayout, heightAt, type StairPartGroup, type StairPartMat, type StairSolid, type StaircaseLayout } from './staircase';

/** Moved to rooms.ts (the 2D editor uses it for "Fit to walls"); re-exported for the 3D code. */
export { slabOutlines };

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

/** A non-indexed geometry with flat normals from a position array. */
function geometryFrom(positions: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

/** prism() between two height fields (roofs.ts slopedPrismPositions): sloped tops and bottoms. */
export function slopedPrism(polygon: readonly Vec2[], zb: (p: Vec2) => number, zt: (p: Vec2) => number, opts: SlopedPrismOptions = {}): BufferGeometry {
  return geometryFrom(slopedPrismPositions(polygon, zb, zt, opts));
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
  openingTop: number = wallHeight,
): WallSpan[] {
  const holes: Hole[] = [];
  for (const o of openings) {
    if (o.wallId !== wall.id || !isOpeningVisible(o, wall, viewMode)) continue;
    const sym = openingSymbol(fp, o);
    const bottom = Math.max(0, o.sill);
    const top = Math.min(openingTop, o.sill + o.height);
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
  /**
   * The wall's top under the level's roofs (roofs.ts wallRoofProfile): where it rises above the
   * wall height, the wall is cut at every station of the profile and the part above the wall
   * height is built with a sloped top.
   */
  roofTop?: WallProfile | null;
  /**
   * At each end, a collinear neighbour of the same thickness and class is raised by the same roof,
   * so the join face above the wall height is internal.
   */
  raisedJoin?: { a: boolean; b: boolean };
  /**
   * Height openings are clamped to when the wall is taller than its level's wall height (an
   * exterior wall running up through the slab above). Default: the wall height.
   */
  openingTop?: number;
}

/** Split spans at the given centerline positions (each piece keeps its solid ranges). */
function splitSpans(spans: WallSpan[], cuts: readonly number[]): WallSpan[] {
  let out = spans;
  for (const c of cuts) {
    const next: WallSpan[] = [];
    for (const sp of out) {
      if (c > sp.from + 1e-7 && c < sp.to - 1e-7) next.push({ from: sp.from, to: c, solid: sp.solid }, { from: c, to: sp.to, solid: sp.solid });
      else next.push(sp);
    }
    out = next;
  }
  return out;
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
  const profile = ctx.roofTop ?? null;
  let spans = wallSpans(fp, wall, openings, H, viewMode, ctx.openingTop ?? H);
  if (profile) spans = splitSpans(spans, profile.s.slice(1, -1));
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
  // Roof: the top above the wall height, and which pieces rise above it.
  const roofTop = (p: Vec2) => (profile ? Math.max(H, profileAt(profile, along(p))) : H);
  const raised = pieces.map((pc) => !!profile && !!pc.poly && pc.poly.some((p) => roofTop(p) > H + 1e-6));
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
      // Under a raised top the band's top is internal.
      const top = (k + 2 >= ys.length || !solidAt(i, y1, ys[k + 2])) && !(raised[i] && Math.abs(y1 - H) < 1e-7);
      parts.push(prism(poly, y0, y1, [], { bottom, top, side }));
    }
    if (!raised[i]) return;
    // The part above the wall height, up to the roof: sloped top, vertical sides. Faces against a
    // raised neighbouring piece, or a collinear neighbour raised by the same roof, are internal.
    const below = ys.length >= 2 && solidAt(i, ys[ys.length - 2], H);
    const side = (p: Vec2, q: Vec2): boolean => {
      const sp = along(p);
      const sq = along(q);
      if (Math.abs(sp - sq) < 1e-7) {
        if (Number.isFinite(span.from) && Math.abs(sp - span.from) < 1e-7) return !raised[i - 1];
        if (Number.isFinite(span.to) && Math.abs(sp - span.to) < 1e-7) return !raised[i + 1];
      }
      const op = off(p);
      const oq = off(q);
      if ((Math.abs(op - h) < 1e-6 && Math.abs(oq - h) < 1e-6) || (Math.abs(op + h) < 1e-6 && Math.abs(oq + h) < 1e-6)) return true;
      if (isCapEdge(p, q)) return true;
      const atA = (sp + sq) / 2 < fp.length / 2;
      if (atA ? ctx.raisedJoin?.a : ctx.raisedJoin?.b) return false;
      const end = atA ? endHeights.a : endHeights.b;
      return end < Math.max(roofTop(p), roofTop(q)) - 1e-7;
    };
    parts.push(slopedPrism(poly, () => H, roofTop, { bottom: !below, top: true, side }));
  });
  return addWallUVs(mergeAll(parts), fp);
}

/**
 * Texture coordinates in inches, so a siding texture that repeats every 48" lines up across pieces
 * and openings (view3d/textures.ts). Faces along the wall (long faces, the gable triangle above the
 * plate): u is the distance along the centerline from the wall's start, v the height above the
 * floor top. Faces across the wall (jambs, ends): u is the distance across the wall, v the height.
 * Top and bottom faces (including the sloped tops under a roof): u along the wall, v across it.
 * The geometry is non-indexed with flat normals, so the mapping is chosen per triangle.
 */
export function addWallUVs(g: BufferGeometry, fp: Pick<Footprint, 'a' | 'dir' | 'normal'>): BufferGeometry {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = new Float32Array((pos?.count ?? 0) * 2);
  for (let i = 0; i < (pos?.count ?? 0); i++) {
    const x = pos.getX(i) - fp.a.x;
    const z = pos.getZ(i) - fp.a.y;
    const along = x * fp.dir.x + z * fp.dir.y;
    const across = x * fp.normal.x + z * fp.normal.y;
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const nz = nor.getZ(i);
    if (Math.abs(ny) > 0.5) {
      uv[2 * i] = along;
      uv[2 * i + 1] = across;
    } else if (Math.abs(nx * fp.normal.x + nz * fp.normal.y) >= Math.abs(nx * fp.dir.x + nz * fp.dir.y)) {
      uv[2 * i] = along;
      uv[2 * i + 1] = pos.getY(i);
    } else {
      uv[2 * i] = across;
      uv[2 * i + 1] = pos.getY(i);
    }
  }
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return g;
}

// ---------------------------------------------------------------------------------------------
// Floors and stairs

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
  inside: boolean | readonly (readonly number[])[] = false,
): BufferGeometry | null {
  if (!(thickness > EPS)) return null;
  const outlines = slabOutlines(faces, true, inside);
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

// ---------------------------------------------------------------------------------------------
// Interior finishes (DESIGN.md "Interior finishes")

/**
 * How one long face of a wall is split off for a room's finish: false, not at all (it stays in the
 * wall's own finish); null, as one face; a number, as a wainscot below that height and the upper
 * face above it.
 */
export type SideCut = false | null | number;

/** A long face of a wall split off from the rest, in one band. */
export interface WallFacePart {
  side: 'left' | 'right';
  band: 'upper' | 'wainscot';
  geometry: BufferGeometry;
}

/** A vertex lies on a long face within this (positions are float32). */
const FACE_TOL = 1e-3;

/**
 * Split a wall's geometry (buildWallGeometry, with UVs) into its core and the long faces the cuts
 * name: a triangle belongs to the left face when its three vertices lie at +thickness/2 along the
 * wall's normal and it faces that way (likewise right at -thickness/2), and to the wainscot band
 * when its centroid is below the cut (the cut is one of the level's band heights, so no triangle
 * crosses it). Everything else (jambs, sills, heads, ends, tops, the faces of uncut sides) is the
 * core. The input is left as it is.
 */
export function splitWallFaces(
  g: BufferGeometry,
  fp: Pick<Footprint, 'a' | 'normal' | 'thickness'>,
  cuts: { left: SideCut; right: SideCut },
): { core: BufferGeometry; faces: WallFacePart[] } {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const h = fp.thickness / 2;
  const buckets = new Map<string, { p: number[]; n: number[]; t: number[] }>();
  const count = pos?.count ?? 0;
  for (let i = 0; i + 2 < count; i += 3) {
    let key = 'core';
    const facing = nor.getX(i) * fp.normal.x + nor.getZ(i) * fp.normal.y;
    for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
      const cut = cuts[side];
      if (cut === false || facing * sign < 0.5) continue;
      let on = true;
      for (let k = i; k < i + 3 && on; k++) {
        const off = (pos.getX(k) - fp.a.x) * fp.normal.x + (pos.getZ(k) - fp.a.y) * fp.normal.y;
        if (Math.abs(off - sign * h) > FACE_TOL) on = false;
      }
      if (!on) continue;
      const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      key = `${side}:${cut !== null && cy < cut ? 'wainscot' : 'upper'}`;
    }
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { p: [], n: [], t: [] }));
    for (let k = i; k < i + 3; k++) {
      b.p.push(pos.getX(k), pos.getY(k), pos.getZ(k));
      b.n.push(nor.getX(k), nor.getY(k), nor.getZ(k));
      if (uv) b.t.push(uv.getX(k), uv.getY(k));
    }
  }
  const make = (b: { p: number[]; n: number[]; t: number[] } | undefined) => {
    const out = new BufferGeometry();
    out.setAttribute('position', new Float32BufferAttribute(b?.p ?? [], 3));
    out.setAttribute('normal', new Float32BufferAttribute(b?.n ?? [], 3));
    if (uv) out.setAttribute('uv', new Float32BufferAttribute(b?.t ?? [], 2));
    return out;
  };
  const faces: WallFacePart[] = [];
  for (const side of ['left', 'right'] as const) {
    for (const band of ['wainscot', 'upper'] as const) {
      const b = buckets.get(`${side}:${band}`);
      if (b) faces.push({ side, band, geometry: make(b) });
    }
  }
  return { core: make(buckets.get('core')), faces };
}

/** A room's floor finish sits this far over the slab top, so the two never share a plane. */
export const FLOOR_FINISH_LIFT = 1 / 16;

/**
 * A convex or concave polygon less a convex hole, as convex-or-simple pieces: for each edge of the
 * hole in turn, the part of what is left outside that edge is kept, the rest carried on (the part
 * inside every edge, the overlap, is dropped).
 */
export function subtractConvex(poly: readonly Vec2[], hole: readonly Vec2[]): Vec2[][] {
  const ring = polygonSignedArea(hole) > 0 ? hole : [...hole].reverse();
  const out: Vec2[][] = [];
  let rest: Vec2[] = [...poly];
  for (let i = 0; i < ring.length && rest.length >= 3; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    // Positive area: the hole is on the left of p->q in plan maths, so its outward normal is the
    // edge turned clockwise.
    const e = sub(q, p);
    const n = { x: e.y, y: -e.x };
    const c = dot(n, p);
    const outside = clipHalfPlane(rest, scale(n, -1), -c);
    if (outside.length >= 3 && Math.abs(polygonSignedArea(outside)) > EPS) out.push(outside);
    rest = clipHalfPlane(rest, n, c);
  }
  return out;
}

/**
 * The top of a room's floor finish: the room's net polygon less the stair holes through the slab,
 * one upward-facing surface `lift` over the floor top. UVs in inches along the room's longer side
 * (u) and across it (v), so boards and parquet rows run the long way. Null when nothing is left.
 */
export function buildFloorFinishGeometry(net: readonly Vec2[], holes: readonly (readonly Vec2[])[], lift = FLOOR_FINISH_LIFT): BufferGeometry | null {
  const outer = cleanRing(net);
  if (outer.length < 3 || Math.abs(polygonSignedArea(outer)) < EPS) return null;
  const xs = outer.map((p) => p.x);
  const ys = outer.map((p) => p.y);
  const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
  const tris = ShapeUtils.triangulateShape(
    outer.map((p) => new Vector2(p.x, p.y)),
    [],
  );
  const pos: number[] = [];
  const uv: number[] = [];
  const emit = (a: Vec2, b: Vec2, c: Vec2) => {
    const area = cross(sub(b, a), sub(c, a));
    if (Math.abs(area) < 1e-9) return;
    // A triangle with positive plan area faces -Y (see the file comment): reverse it to face up.
    const [p, q, r] = area > 0 ? [a, c, b] : [a, b, c];
    for (const v of [p, q, r]) {
      pos.push(v.x, lift, v.y);
      uv.push(alongX ? v.x : v.y, alongX ? v.y : v.x);
    }
  };
  for (const [i, j, k] of tris) {
    let pieces: Vec2[][] = [[outer[i], outer[j], outer[k]]];
    for (const h of holes) {
      if (h.length < 3) continue;
      pieces = pieces.flatMap((piece) => subtractConvex(piece, h));
    }
    for (const piece of pieces) for (let m = 1; m + 1 < piece.length; m++) emit(piece[0], piece[m], piece[m + 1]);
  }
  if (!pos.length) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(Array.from({ length: pos.length / 3 }, () => [0, 1, 0]).flat(), 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return g;
}

/** Open stairs: tread thickness, and the stringers' thickness (across) and depth (square to their slope). */
export const OPEN_TREAD = 1.5;
export const STRINGER = { thick: 1.5, depth: 9.25 } as const;

/**
 * A flight of stairs: `risers` steps, each a 1/risers slice of the run rising `rise` (the height of
 * one riser) higher than the last, the first one `base` + `rise` above the floor top. The flight is
 * solid down to the floor (or to its base, when it starts below the floor), so one that starts on a
 * landing (`base` > 0) has no void under it, and a landing (one riser) is a plain box. Built as one
 * solid (the stepped side profile extruded across the width) rather than separate boxes, so no
 * internal faces show as seams. `open` (outdoor steps) builds treads on two stringers instead,
 * nothing under them: each tread OPEN_TREAD thick across the width between the stringers, each
 * stringer STRINGER.thick wide and STRINGER.depth deep under the line of the tread fronts, from the
 * bottom of the flight to its top.
 */
export function buildStairsGeometry(stairs: Pick<Stairs, 'origin' | 'direction' | 'width' | 'run'>, rise: number, risers: number, base = 0, open = false): BufferGeometry {
  const d = stairs.run / risers;
  const w = stairs.width / 2;
  // Each part: a profile in (along the run, height) extruded across [l0, l1] of the width.
  const parts: [Vec2[], number, number][] = [];
  if (open) {
    const t = Math.min(STRINGER.thick, w / 4);
    for (let i = 0; i < risers; i++) {
      const top = base + (i + 1) * rise;
      parts.push([
        [
          { x: i * d, y: top - OPEN_TREAD },
          { x: (i + 1) * d, y: top - OPEN_TREAD },
          { x: (i + 1) * d, y: top },
          { x: i * d, y: top },
        ],
        -w + t,
        w - t,
      ]);
    }
    // The stringer's top runs from the bottom of the flight to its top tread's back edge; its
    // vertical depth is STRINGER.depth measured square to that slope, and its foot is cut level
    // where it stands (it never goes below the bottom of the flight).
    const total = risers * rise;
    const deep = (STRINGER.depth * Math.hypot(stairs.run, total)) / stairs.run;
    const foot = Math.min(stairs.run, (deep * stairs.run) / total);
    const stringer: Vec2[] = [{ x: 0, y: base }, { x: foot, y: base }];
    if (foot < stairs.run) stringer.push({ x: stairs.run, y: base + total - deep });
    stringer.push({ x: stairs.run, y: base + total });
    parts.push([stringer, -w, -w + t], [stringer, w - t, w]);
  } else {
    const bottom = Math.min(0, base);
    const profile: Vec2[] = [{ x: 0, y: bottom }];
    for (let i = 0; i < risers; i++) {
      profile.push({ x: i * d, y: base + (i + 1) * rise }, { x: (i + 1) * d, y: base + (i + 1) * rise });
    }
    profile.push({ x: stairs.run, y: bottom });
    parts.push([profile, -w, w]);
  }
  return stairsPartsGeometry(stairs, parts);
}

/**
 * Profiles in a flight's own frame, each a polygon in (distance up the run, height) extruded across
 * [l0, l1] of its width (to the right of travel positive), as one geometry in plan space.
 */
function stairsPartsGeometry(stairs: Pick<Stairs, 'origin' | 'direction'>, parts: readonly [Vec2[], number, number][]): BufferGeometry {
  const f = stairsFrame(stairs);
  // (along, lateral, height) -> (x, Y, z) is a reflection when u x v points down; keep faces outward.
  const flip = cross(f.u, f.v) > 0;
  const out: number[] = [];
  for (const [profile, l0, l1] of parts) {
    // prism() extrudes along its Y slot: positions come out as (along, lateral, height).
    const local = prism(profile, l0, l1);
    const src = local.getAttribute('position');
    const map = (i: number): P3 => {
      const p = stairsPoint(f, src.getX(i), src.getY(i));
      return [p.x, src.getZ(i), p.y];
    };
    for (let i = 0; i < src.count; i += 3) {
      const [a, b, c] = [map(i), map(i + 1), map(i + 2)];
      out.push(...a, ...(flip ? c : b), ...(flip ? b : c));
    }
    local.dispose();
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(out, 3));
  g.computeVertexNormals();
  return g;
}

/** A stair railing's sizes (DESIGN.md "Stair railings"): the deck railing's, 36" over the nosings. */
export const STAIR_RAIL = { height: DECK.railHeight, newel: DECK.railPost, newelAbove: 4, rail: DECK.cap, railThick: DECK.capThick, baluster: DECK.baluster, gap: DECK.balusterGap } as const;

/**
 * The railings on a flight's railed sides (`railings.left` / `.right`, as you climb), level-local:
 * per side a newel at the bottom (on the first tread) and at the top (on the last), a handrail
 * between them whose top is STAIR_RAIL.height over the line of the nosings (level over a landing,
 * a one-riser flight), and balusters standing on the treads with at most STAIR_RAIL.gap between
 * them. All of it inside the flight's width, flush with its side. Null with no railed side.
 */
export function buildStairsRailingGeometry(
  stairs: Pick<Stairs, 'origin' | 'direction' | 'width' | 'run' | 'railings'>,
  rise: number,
  risers: number,
  base = 0,
): BufferGeometry | null {
  const sides = ([['left', -1], ['right', 1]] as const).filter(([k]) => stairs.railings?.[k]);
  if (sides.length === 0 || !(risers >= 1) || !(stairs.run > 0)) return null;
  const R = STAIR_RAIL;
  const d = stairs.run / risers;
  const w = stairs.width / 2;
  // Height of the tread under a point `a` up the run, and of the nosing line there (the step's
  // front edges; level over a landing).
  const treadAt = (a: number) => base + (Math.min(risers - 1, Math.max(0, Math.floor(a / d))) + 1) * rise;
  const slope = risers > 1 ? rise / d : 0;
  const nosing = (a: number) => base + rise + a * slope;
  const railTop = (a: number) => nosing(a) + R.height;
  const c = R.newel / 2;
  const a0 = c;
  const a1 = stairs.run - c;
  const parts: [Vec2[], number, number][] = [];
  for (const [, sign] of sides) {
    // Lateral bands, flush with the flight's side: newels and rail across R.newel, balusters centred on it.
    const outer = sign * w;
    const inner = sign * (w - R.newel);
    const band = (width: number): [number, number] => {
      const mid = sign * (w - c);
      return [mid - width / 2, mid + width / 2];
    };
    const [n0, n1] = [Math.min(outer, inner), Math.max(outer, inner)];
    // Newels: from the tread they stand on to above the rail.
    for (const a of [a0, a1]) {
      const top = railTop(a) + R.newelAbove;
      parts.push([[{ x: a - c, y: treadAt(a) }, { x: a + c, y: treadAt(a) }, { x: a + c, y: top }, { x: a - c, y: top }], n0, n1]);
    }
    // The handrail between the newels' faces, sloped with the nosings.
    const r0 = a0 + c;
    const r1 = a1 - c;
    if (r1 - r0 > 1e-6) {
      const [l0, l1] = band(R.rail);
      parts.push([[{ x: r0, y: railTop(r0) - R.railThick }, { x: r1, y: railTop(r1) - R.railThick }, { x: r1, y: railTop(r1) }, { x: r0, y: railTop(r0) }], l0, l1]);
      // Balusters, evenly between the newels, each from its tread to the rail's underside.
      const bw = R.baluster;
      const count = Math.max(0, Math.ceil((r1 - r0 - R.gap) / (R.gap + bw) - 1e-9));
      const gap = (r1 - r0 - count * bw) / (count + 1);
      const [b0, b1] = band(bw);
      for (let m = 0; m < count; m++) {
        const x0 = r0 + gap * (m + 1) + bw * m;
        const x1 = x0 + bw;
        const foot = treadAt((x0 + x1) / 2);
        parts.push([[{ x: x0, y: foot }, { x: x1, y: foot }, { x: x1, y: railTop(x1) - R.railThick }, { x: x0, y: railTop(x0) - R.railThick }], b0, b1]);
      }
    }
  }
  return stairsPartsGeometry(stairs, parts);
}

// ---------------------------------------------------------------------------------------------
// Roofs

/**
 * A roof as one geometry (level-local, like walls): the slab over the overhang outline with its
 * fascia and rake boards (roofs.ts roofSolid). Each part is a closed solid. The rafter tails and
 * the ridge cap are drawn by buildRoofParts only.
 */
export function buildRoofGeometry(roof: Roof, bearingHeight: number): BufferGeometry {
  const { slab, boards } = roofSolid(roof, bearingHeight);
  return geometryFrom(boards.reduce((all, b) => all.concat(b), slab));
}

/** A roof's three drawn parts: each has its own material. */
export interface RoofParts {
  /** The slab and the ridge cap (the roof's surface material), with roof UVs (addRoofUVs). */
  slab: BufferGeometry;
  /** Fascia and rake boards, null when the roof has none. */
  fascia: BufferGeometry | null;
  /** Rafter tails under open eaves, null when the roof has none. */
  rafters: BufferGeometry | null;
}

/**
 * The roof as separate geometries: the slab with the ridge cap merged into it (both take the
 * roof's material), the fascia and rake boards, and the rafter tails (both in the board colour).
 */
export function buildRoofParts(roof: Roof, bearingHeight: number): RoofParts {
  const { slab, boards, rafters, ridge } = roofSolid(roof, bearingHeight);
  const fascia = boards.flat();
  const tails = rafters.flat();
  return {
    slab: addRoofUVs(geometryFrom(ridge.length ? slab.concat(ridge) : slab), roofFrame(roof).v),
    fascia: fascia.length ? geometryFrom(fascia) : null,
    rafters: tails.length ? geometryFrom(tails) : null,
  };
}

function roofParts(roof: Roof, bearing: number): { geometry: BufferGeometry; fascia: BufferGeometry | null; rafters: BufferGeometry | null } {
  const { slab, fascia, rafters } = buildRoofParts(roof, bearing);
  return { geometry: slab, fascia, rafters };
}

/**
 * Texture coordinates of a roof slab in tiles (ROOF_TILE: 24" across the slope by 48" down it; the
 * roof textures repeat once per tile, view3d/textures.ts roofTexture), per triangle by its flat
 * normal, like addWallUVs. Faces turned up or down (the roof's surfaces): `down` is the plan
 * direction the face slopes down toward (`level`, the ridge frame's v, on a level face), `along` is
 * square to it, u = dot(p, along) / 24 and v = dot(p, down) * sqrt(1 + k^2) / 48 with k the slope,
 * so corrugations run down the slope, repeat every 24" / 9 along the eave, and courses are measured
 * along the slope, not squeezed by it (sqrt(1 + k^2) is 1 / |ny| for a unit normal). Vertical faces
 * (the slab's edges): u along the edge / 24, v = Y / 48.
 */
export function addRoofUVs(g: BufferGeometry, level: Vec2): BufferGeometry {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const count = pos?.count ?? 0;
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const nz = nor.getZ(i);
    const h = Math.hypot(nx, nz);
    if (Math.abs(ny) > 0.5) {
      const down = h > 1e-9 ? { x: nx / h, y: nz / h } : level;
      const along = { x: -down.y, y: down.x };
      uv[2 * i] = (x * along.x + z * along.y) / ROOF_TILE.across;
      uv[2 * i + 1] = (x * down.x + z * down.y) / Math.abs(ny) / ROOF_TILE.down;
    } else {
      // Along the face: its normal turned a quarter in plan.
      const t = h > 1e-9 ? { x: -nz / h, y: nx / h } : { x: 1, y: 0 };
      uv[2 * i] = (x * t.x + z * t.y) / ROOF_TILE.across;
      uv[2 * i + 1] = pos.getY(i) / ROOF_TILE.down;
    }
  }
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return g;
}

// ---------------------------------------------------------------------------------------------
// Window and door fills (openings3d.ts)

/**
 * The geometry of an opening's fill, one merged geometry per material part. `side` is +1 when the
 * wall's left normal points outside, -1 when the right one does (trim, sills and shutters go on
 * the outside face). Level-local, like the wall. UVs are in inches like the wall's (addWallUVs), so
 * a textured part (the screen mesh) has the same scale as the siding round it.
 */
export function buildOpeningFill(fp: Footprint, o: Opening, wallHeight: number, side: 1 | -1): OpeningMesh['parts'] {
  const sym = openingSymbol(fp, o);
  const bottom = Math.max(0, o.sill);
  const top = Math.min(wallHeight, o.sill + o.height);
  const boxes = openingFill({
    type: o.type,
    j0: sym.j0,
    j1: sym.j1,
    bottom,
    top,
    thickness: fp.thickness,
    lites: o.lites,
    trim: o.trim ?? DEFAULT_TRIM,
    shutters: o.shutters,
    sashes: o.sashes,
    fixedCenter: o.fixedCenter,
    glazing: o.glazing,
    halfLite: o.halfLite,
    sliding: isSlidingDoor(o),
  });
  const byPart = new Map<FillPart, BufferGeometry[]>();
  for (const b of boxes) {
    const list = byPart.get(b.part);
    const g = boxGeometry(fp, b, side);
    if (list) list.push(g);
    else byPart.set(b.part, [g]);
  }
  return [...byPart]
    .map(([part, gs]) => ({ part, geometry: mergeAll(gs) }))
    .filter((p) => triangleCount(p.geometry) > 0)
    .map((p) => ({ part: p.part, geometry: addWallUVs(p.geometry, fp) }));
}

/** A fill box in plan space: a rectangle along the wall (s, outward d) extruded from y0 to y1. */
function boxGeometry(fp: Footprint, b: FillBox, side: 1 | -1): BufferGeometry {
  const pt = (s: number, d: number) => wallPoint(fp, s, side * d);
  return prism([pt(b.s0, b.d0), pt(b.s1, b.d0), pt(b.s1, b.d1), pt(b.s0, b.d1)], b.y0, b.y1);
}

/** Mean of a level's node positions (the fallback for telling a wall's outside from its inside). */
export function levelCentroid(level: Level): Vec2 {
  const nodes = Object.values(level.nodes);
  if (!nodes.length) return { x: 0, y: 0 };
  return { x: nodes.reduce((t, n) => t + n.x, 0) / nodes.length, y: nodes.reduce((t, n) => t + n.y, 0) / nodes.length };
}

/**
 * Which side of a wall is outside: +1 for the left normal, -1 for the right one. The side with no
 * closed room beside it, when the other has one; otherwise the side facing away from the middle of
 * the level's nodes.
 */
export function outwardSide(fp: Pick<Footprint, 'a' | 'b' | 'normal' | 'wallId'>, wall: Pick<Wall, 'id' | 'a' | 'b'>, faces: FaceSet, centroid: Vec2): 1 | -1 {
  const { left, right } = facesBesideWall(faces, wall);
  if (left && !right) return -1;
  if (right && !left) return 1;
  const mid = { x: (fp.a.x + fp.b.x) / 2, y: (fp.a.y + fp.b.y) / 2 };
  return dot(sub(mid, centroid), fp.normal) >= 0 ? 1 : -1;
}

// ---------------------------------------------------------------------------------------------
// Casework (derive/casework.ts): cabinets, appliances and sinks as boxes, counters as slabs.

/**
 * A fixture's boxes (fixtureBoxes) turned into the plan and extruded, merged per material part.
 * Level-local like the walls. Every box is a closed prism, so each part is a closed surface.
 */
export function buildFixtureParts(f: Fixture, finishes?: LevelFinishes): FixtureMesh['parts'] {
  const fr = fixtureFrame(f);
  const byPart = new Map<CasePart, BufferGeometry[]>();
  for (const b of fixtureBoxes(f, finishes)) {
    const poly = [fixturePoint(fr, b.s0, b.d0), fixturePoint(fr, b.s1, b.d0), fixturePoint(fr, b.s1, b.d1), fixturePoint(fr, b.s0, b.d1)];
    const g = prism(poly, b.y0, b.y1);
    const list = byPart.get(b.part);
    if (list) list.push(g);
    else byPart.set(b.part, [g]);
  }
  return [...byPart].map(([part, gs]) => ({ part, geometry: mergeAll(gs) })).filter((p) => triangleCount(p.geometry) > 0);
}

/** A counter run (counterRuns) as one slab with its basin holes. */
export function buildCounterGeometry(run: CounterRun): BufferGeometry {
  return prism(run.outline, run.y0, run.y1, run.holes);
}

// ---------------------------------------------------------------------------------------------
// Memoized level meshes

export interface FixtureMesh {
  id: Id;
  kind: FixtureKind;
  phase: Phase;
  /** The cabinet fronts' colour after the defaults (model/casework.ts frontColorOf). */
  frontColor: string;
  /** One merged geometry per material part, level-local like the walls. */
  parts: { part: CasePart; geometry: BufferGeometry }[];
}

export interface CounterMesh {
  /** The run's fixture ids, joined. */
  id: Id;
  geometry: BufferGeometry;
  /** Demolished when every cabinet under it is, new when any is, else existing. */
  phase: Phase;
  fixtureIds: Id[];
}

export interface WallMesh {
  id: Id;
  /** The wall, less the long faces a room dresses (`faces`) when there are any. */
  geometry: BufferGeometry;
  phase: Phase;
  kind: WallKind;
  /** The wall's finish and colour after defaults (model/finish.ts). */
  finish: WallFinish;
  color: string;
  /**
   * The long faces on the side of a room with interior finishes (DESIGN.md "Interior finishes"),
   * each band in the room's finish and colour; absent when no room dresses the wall.
   */
  faces?: { roomId: Id; side: 'left' | 'right'; band: 'upper' | 'wainscot'; geometry: BufferGeometry; finish: RoomWallFinish; color: string }[];
}

/** A room's floor finish (DESIGN.md "Interior finishes"): a surface just over the slab top. */
export interface FloorFinishMesh {
  roomId: Id;
  /** The room label's phase. */
  phase: Phase;
  finish: FloorFinish;
  color: string;
  geometry: BufferGeometry;
}

/**
 * A staircase's parts (derive/staircase.ts), one geometry per group and material: the stair (treads
 * in the tread colour, the carcass and risers in the paint), its framing and panels (paint), its
 * railing (handrail and newel caps in the tread colour, newels and balusters in the paint).
 */
export interface StaircaseMesh {
  id: Id;
  phase: Phase;
  treadColor: string;
  paintColor: string;
  parts: { group: StairPartGroup; mat: StairPartMat; geometry: BufferGeometry }[];
}

export interface StairsMesh {
  id: Id;
  geometry: BufferGeometry;
  /** The railings on its railed sides (buildStairsRailingGeometry), null with none. */
  railing: BufferGeometry | null;
  phase: Phase;
}

/** A deck's meshes (level-local): the boards, the framing with the support posts, and the railing. */
export interface DeckMesh {
  id: Id;
  /** The phase as shown in the view mode (shownPhase). */
  phase: Phase;
  color: string;
  boards: BufferGeometry;
  frame: BufferGeometry;
  railing: BufferGeometry | null;
}

/** A staircase's solids as one geometry per group and material (empty ones left out). */
export function buildStaircaseParts(solids: readonly StairSolid[]): StaircaseMesh['parts'] {
  const by = new Map<string, { group: StairPartGroup; mat: StairPartMat; pos: number[] }>();
  for (const s of solids) {
    const k = `${s.group}|${s.mat}`;
    let e = by.get(k);
    if (!e) by.set(k, (e = { group: s.group, mat: s.mat, pos: [] }));
    slopedPrismPositions(s.poly, (p) => heightAt(s.zb, p), (p) => heightAt(s.zt, p), {}, e.pos);
  }
  return [...by.values()].filter((e) => e.pos.length).map((e) => ({ group: e.group, mat: e.mat, geometry: geometryFrom(e.pos) }));
}

/** The boxes of a deck as one geometry (prisms concatenated into one buffer). */
export function deckBoxesGeometry(boxes: readonly DeckBox[]): BufferGeometry {
  const pos: number[] = [];
  for (const b of boxes) {
    const part = prismPositions(b.poly, b.bottom, b.top, b.holes ?? [], {});
    for (let i = 0; i < part.length; i++) pos.push(part[i]);
  }
  return geometryFrom(pos);
}

/**
 * The visible decks of a level in a view mode, memoized apart from getLevelMeshes (a deck depends on
 * the ground and on other levels' walls and stairs, which that cache does not watch): a deck's
 * geometry is rebuilt only when its layout object changes (derive/decks.ts getDeckLayout), and the
 * same array comes back while every deck's geometry, phase and colour are the same, so a selector
 * on it is stable.
 */
export function getDeckMeshes(plan: Plan, levelId: Id, viewMode: ViewMode): DeckMesh[] {
  const key = `${levelId}|${viewMode}`;
  const prev = deckResult.get(key);
  if (prev && prev.plan === plan) return prev.result;
  pruneCaches(plan);
  const level = plan.levels[levelId];
  let entries = deckCache.get(key);
  if (!entries) deckCache.set(key, (entries = new Map()));
  const out: DeckMesh[] = [];
  const seen = new Set<Id>();
  for (const deck of Object.values(level?.decks ?? {})) {
    if (!isVisible(deck.phase, viewMode)) continue;
    const layout = getDeckLayout(plan, levelId, deck.id, viewMode);
    if (!layout) continue;
    let e = entries.get(deck.id);
    if (!e || e.layout !== layout) {
      if (e) disposeDeckEntry(e);
      e = {
        layout,
        boards: deckBoxesGeometry([layout.boards]),
        frame: deckBoxesGeometry([...layout.frame, ...layout.posts]),
        railing: layout.railing.length ? deckBoxesGeometry(layout.railing) : null,
      };
      entries.set(deck.id, e);
    }
    seen.add(deck.id);
    out.push({ id: deck.id, phase: shownPhase(deck.phase, viewMode), color: deckColorOf(deck), boards: e.boards, frame: e.frame, railing: e.railing });
  }
  for (const [id, e] of entries) {
    if (seen.has(id)) continue;
    disposeDeckEntry(e);
    entries.delete(id);
  }
  const same =
    !!prev &&
    prev.result.length === out.length &&
    prev.result.every((m, i) => m.id === out[i].id && m.phase === out[i].phase && m.color === out[i].color && m.boards === out[i].boards && m.frame === out[i].frame && m.railing === out[i].railing);
  const result = same ? prev.result : out;
  deckResult.set(key, { plan, result });
  return result;
}

/** A beam's or post's mesh (level-local), and a post's footing under the slab. */
export interface MemberMesh {
  id: Id;
  kind: 'beam' | 'post';
  /** The phase as shown in the view mode (shownPhase). */
  phase: Phase;
  /** A timber's own colour. */
  color?: string;
  /** Null for a flush beam no deeper than the joists (all of it hidden in the floor). */
  body: BufferGeometry | null;
  footing: BufferGeometry | null;
}

/** How far a member stops short of a slab face it would otherwise share (no coplanar faces). */
export const MEMBER_INSET = 1 / 16;

/**
 * The visible beams and posts of a level in a view mode, memoized per level and view like the decks
 * (a post's height depends on the beams over it): a flush beam is drawn only where it hangs below the
 * ceiling (the rest is inside the floor above), so nothing shares a face with a slab.
 */
export function getMemberMeshes(plan: Plan, levelId: Id, viewMode: ViewMode): MemberMesh[] {
  const key = `${levelId}|${viewMode}`;
  const prev = memberResult.get(key);
  if (prev && prev.plan === plan) return prev.result;
  pruneCaches(plan);
  const level = plan.levels[levelId];
  let entries = memberCache.get(key);
  if (!entries) memberCache.set(key, (entries = new Map()));
  const out: MemberMesh[] = [];
  const seen = new Set<Id>();
  const ceiling = (level?.wallHeight ?? 0) - MEMBER_INSET;
  for (const m of Object.values(level?.members ?? {})) {
    if (!isVisible(m.phase, viewMode)) continue;
    const boxes = memberBoxes(plan, levelId, m, viewMode);
    // A timber is drawn as set (it may stand above the ceiling, in a gable); the rest stop under it.
    const timber = isTimber(m);
    const top = timber ? boxes.body.top : Math.min(boxes.body.top, ceiling);
    const sig = JSON.stringify([boxes.body.poly, boxes.body.bottom, top, boxes.footing, m.kind === 'beam' ? [m.za, m.zb, m.depth] : null]);
    let e = entries.get(m.id);
    if (!e || e.sig !== sig) {
      e?.body?.dispose();
      e?.footing?.dispose();
      const f = boxes.footing;
      const s = boxes.slope;
      e = {
        sig,
        body: s ? slopedPrism(boxes.body.poly, s.bottom, s.top) : top - boxes.body.bottom > 0.01 ? deckBoxesGeometry([{ ...boxes.body, top }]) : null,
        footing: f ? deckBoxesGeometry([{ ...f, top: f.top - MEMBER_INSET }]) : null,
      };
      entries.set(m.id, e);
    }
    seen.add(m.id);
    out.push({ id: m.id, kind: m.kind, phase: shownPhase(m.phase, viewMode), ...(m.color ? { color: m.color } : {}), body: e.body, footing: e.footing });
  }
  for (const [id, e] of entries) {
    if (seen.has(id)) continue;
    e.body?.dispose();
    e.footing?.dispose();
    entries.delete(id);
  }
  const same =
    !!prev &&
    prev.result.length === out.length &&
    prev.result.every((m, i) => m.id === out[i].id && m.phase === out[i].phase && m.color === out[i].color && m.body === out[i].body && m.footing === out[i].footing);
  const result = same ? prev.result : out;
  memberResult.set(key, { plan, result });
  return result;
}

/** A floor opening's guard (level-local, standing on the floor round the hole). */
export interface FloorOpeningMesh {
  id: Id;
  /** The phase as shown in the view mode (shownPhase). */
  phase: Phase;
  railing: BufferGeometry;
  /** In an arriving staircase's style: its handrail as the cap, in `style.treadColor`; the rest in `style.paintColor`. */
  rail?: BufferGeometry;
  style?: { treadColor: string; paintColor: string };
}

/**
 * The guards round the visible floor openings of a level in a view mode, memoized like the decks
 * (they depend on the level's walls and on the stairs below): an opening's geometry is rebuilt only
 * when its layout object changes (getFloorOpeningLayout), and the same array comes back while every
 * guard and phase is the same. An opening with no guard (every edge against a wall) has no mesh.
 */
export function getFloorOpeningMeshes(plan: Plan, levelId: Id, viewMode: ViewMode): FloorOpeningMesh[] {
  const key = `${levelId}|${viewMode}`;
  const prev = guardResult.get(key);
  if (prev && prev.plan === plan) return prev.result;
  pruneCaches(plan);
  const level = plan.levels[levelId];
  let entries = guardCache.get(key);
  if (!entries) guardCache.set(key, (entries = new Map()));
  const out: FloorOpeningMesh[] = [];
  const seen = new Set<Id>();
  for (const o of Object.values(level?.floorOpenings ?? {})) {
    if (!isVisible(o.phase, viewMode)) continue;
    const layout = getFloorOpeningLayout(plan, levelId, o.id, viewMode);
    if (!layout || layout.railing.length === 0) continue;
    let e = entries.get(o.id);
    if (!e || e.layout !== layout) {
      e?.railing.dispose();
      e?.rail?.dispose();
      e = { layout, railing: deckBoxesGeometry(layout.railing), ...(layout.rail.length ? { rail: deckBoxesGeometry(layout.rail) } : {}) };
      entries.set(o.id, e);
    }
    seen.add(o.id);
    out.push({ id: o.id, phase: shownPhase(o.phase, viewMode), railing: e.railing, ...(e.rail ? { rail: e.rail } : {}), ...(layout.style ? { style: layout.style } : {}) });
  }
  for (const [id, e] of entries) {
    if (seen.has(id)) continue;
    e.railing.dispose();
    e.rail?.dispose();
    entries.delete(id);
  }
  const same =
    !!prev &&
    prev.result.length === out.length &&
    prev.result.every((m, i) => m.id === out[i].id && m.phase === out[i].phase && m.railing === out[i].railing && m.rail === out[i].rail && m.style?.treadColor === out[i].style?.treadColor && m.style?.paintColor === out[i].style?.paintColor);
  const result = same ? prev.result : out;
  guardResult.set(key, { plan, result });
  return result;
}

export interface RoofMesh {
  id: Id;
  /** The roof slab, with the ridge cap of a metal gable or hip roof. */
  geometry: BufferGeometry;
  /** Fascia and rake boards, null when the roof has none. */
  fascia: BufferGeometry | null;
  /** Rafter tails under open eaves, null when the roof has none. */
  rafters: BufferGeometry | null;
  phase: Phase;
  finish: RoofFinish;
  /** Hex colour of the slab (the roof's own, else by finish). */
  color: string;
  /** Hex colour of the fascia, the rake boards and the rafter tails (the roof's own, else tan). */
  boardColor: string;
  /** Rust and streaking of a metal roof, 0 to 1 (the roof's own, else the default). */
  weathering: number;
}

/** What an opening fill is for, in the export: `Window` or `Door`. */
export interface OpeningMesh {
  id: Id;
  type: 'window' | 'door';
  phase: Phase;
  /** The door leaf's colour after the default (model/finish.ts leafColorOf); windows carry the default. */
  leafColor: string;
  /** The trim (casings, sill) and sash (and door frame) colours: the defaults, or the proposed look's in Proposed. */
  trimColor: string;
  sashColor: string;
  /** One merged geometry per material part, level-local like the walls. */
  parts: { part: FillPart; geometry: BufferGeometry }[];
}

/** The colour of an opening's part where the part has one of its own: the leaf, the trim, the sash. */
export function openingPartColor(o: Pick<OpeningMesh, 'leafColor' | 'trimColor' | 'sashColor'>, part: FillPart): string | undefined {
  return part === 'leaf' ? o.leafColor : part === 'trim' ? o.trimColor : part === 'sash' ? o.sashColor : undefined;
}

export interface LevelMeshes {
  walls: WallMesh[];
  /** The slab under this level (level-local Y from -floorThickness to 0). */
  floor?: BufferGeometry;
  /** The floor finishes of the rooms labelled in the view mode that set one. */
  floorFinishes: FloorFinishMesh[];
  stairs: StairsMesh[];
  /** Staircases (their pieces are not in `stairs`). */
  staircases: StaircaseMesh[];
  /** The level's roofs visible in the view mode (level-local, like the walls). */
  roofs: RoofMesh[];
  /** Window and door fills of the visible openings (passages have none). */
  openings: OpeningMesh[];
  /** The visible cabinets, appliances and sinks (DESIGN.md "Casework"). */
  fixtures: FixtureMesh[];
  /** The counter slabs over them, one per run of touching counter fixtures. */
  counters: CounterMesh[];
}

interface FixtureEntry {
  fixture: Fixture;
  /** The resolved front style (the level default can change it). */
  style: string;
  parts: FixtureMesh['parts'];
}

interface CounterEntry {
  /** The visible counter fixtures the runs were built from, in order. */
  fixtures: Fixture[];
  counters: CounterMesh[];
}

interface WallEntry {
  fp: Footprint;
  wall: Wall;
  openings: readonly Opening[] | undefined;
  height: number;
  /** WallContext as a string: bands and end heights. */
  ctxKey: string;
  geometry: BufferGeometry;
  /** The cuts the split was made with, as a string, and the split (null: the wall is not split). */
  splitKey: string;
  split: { core: BufferGeometry; faces: WallFacePart[] } | null;
}

interface FloorFinishEntry {
  net: Vec2[];
  holes: Vec2[][];
  geometry: BufferGeometry | null;
}

interface FloorEntry {
  outerFaces: FaceSet['outerFaces'];
  outerFaceThickness: FaceSet['outerFaceThickness'];
  /** Per outer-face edge, the inside distance of the wall below that runs up through the slab (slabInsets). */
  insets: number[][] | null;
  belowStairs: Level['stairs'] | undefined;
  /** The level's own floor openings (their holes go through this slab). */
  floorOpenings: Level['floorOpenings'] | undefined;
  /** Floor to floor of the level below: where its stairs' holes start depends on it. */
  belowFtf: number;
  thickness: number;
  geometry: BufferGeometry | null;
}

interface StairsEntry {
  stairs: Stairs;
  /** Height of one riser. */
  rise: number;
  risers: number;
  base: number;
  geometry: BufferGeometry;
  railing: BufferGeometry | null;
}

interface RoofEntry {
  roof: Roof;
  /** The finish it was built for (the proposed look's can differ from the roof's: the ridge cap follows). */
  finish: Roof['finish'];
  bearing: number;
  geometry: BufferGeometry;
  fascia: BufferGeometry | null;
  rafters: BufferGeometry | null;
}

interface OpeningEntry {
  fp: Footprint;
  opening: Opening;
  wall: Wall;
  height: number;
  side: 1 | -1;
  /** Built without its shutters (the proposed look takes them off). */
  noShutters: boolean;
  parts: OpeningMesh['parts'];
}

interface LevelEntry {
  level: Level;
  belowStairs: Level['stairs'] | undefined;
  ftf: number;
  /** The neighbours the platform framing reads: walls through the slab above, slab inset by the walls below. */
  above: Level | undefined;
  below: Level | undefined;
  /** The plan's proposed look, which the Proposed view's meshes follow. */
  look: Plan['proposedLook'];
  result: LevelMeshes;
}

/** Demolished elements are drawn translucent (view3d/materials.ts). */
export const isSeeThrough = (phase: Phase): boolean => phase === 'demo';

// Keyed by `${levelId}|${viewMode}`. Each entry holds the geometries the last result used; a
// geometry that is not carried into the next result is disposed.
const wallCache = new Map<string, Map<Id, WallEntry>>();
const floorCache = new Map<string, FloorEntry>();
const floorFinishCache = new Map<string, Map<Id, FloorFinishEntry>>();
const stairsCache = new Map<string, Map<Id, StairsEntry>>();
interface StaircaseEntry {
  layout: StaircaseLayout;
  parts: StaircaseMesh['parts'];
}
const staircaseCache = new Map<string, Map<Id, StaircaseEntry>>();
const roofCache = new Map<string, Map<Id, RoofEntry>>();
const openingCache = new Map<string, Map<Id, OpeningEntry>>();
const fixtureCache = new Map<string, Map<Id, FixtureEntry>>();
const counterCache = new Map<string, CounterEntry>();
const levelCache = new Map<string, LevelEntry>();
/** Decks: their geometry per deck while its layout object is the same, and the last result per level. */
interface DeckEntry {
  layout: DeckLayout;
  boards: BufferGeometry;
  frame: BufferGeometry;
  railing: BufferGeometry | null;
}
const deckCache = new Map<string, Map<Id, DeckEntry>>();
const deckResult = new Map<string, { plan: Plan; result: DeckMesh[] }>();
/** Floor openings' guards, cached like the decks. */
const guardCache = new Map<string, Map<Id, { layout: FloorOpeningLayout; railing: BufferGeometry; rail?: BufferGeometry }>>();
const guardResult = new Map<string, { plan: Plan; result: FloorOpeningMesh[] }>();
/** Beams and posts, cached like the decks (by their boxes). */
const memberCache = new Map<string, Map<Id, { sig: string; body: BufferGeometry | null; footing: BufferGeometry | null }>>();
const memberResult = new Map<string, { plan: Plan; result: MemberMesh[] }>();

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

/**
 * Holes cut in a level's slab by stairs on the level below (`belowFtf`: that level's floor to
 * floor): only the part of each flight where the headroom under the slab is short
 * (stairsHoleOutline), so a closet over the low end keeps its floor.
 */
export function stairHoles(below: Level | undefined, viewMode: ViewMode, belowFtf: number): Vec2[][] {
  if (!below) return [];
  const out: Vec2[][] = [];
  for (const s of Object.values(below.stairs)) {
    if (!s.cutsFloorAbove || !isVisible(s.phase, viewMode)) continue;
    const hole = stairsHoleOutline(s, belowFtf, below.wallHeight);
    if (hole) out.push(hole);
  }
  return out;
}

/** Dispose a wall entry's geometries, except those `keep` (the entry that replaces it) still uses. */
function disposeWallEntry(e: WallEntry, keep?: WallEntry): void {
  if (e.geometry !== keep?.geometry) e.geometry.dispose();
  if (e.split && e.split !== keep?.split) {
    e.split.core.dispose();
    for (const f of e.split.faces) f.geometry.dispose();
  }
}

function disposeEntry(e: { geometry: BufferGeometry; fascia?: BufferGeometry | null; rafters?: BufferGeometry | null; railing?: BufferGeometry | null }): void {
  e.geometry.dispose();
  e.fascia?.dispose();
  e.rafters?.dispose();
  e.railing?.dispose();
}

/** Drop and dispose cache entries of levels that are no longer in the plan. */
function pruneCaches(plan: Plan): void {
  const alive = (key: string) => plan.levels[key.slice(0, key.lastIndexOf('|'))] !== undefined;
  for (const [key, m] of wallCache) {
    if (alive(key)) continue;
    for (const e of m.values()) disposeWallEntry(e);
    wallCache.delete(key);
  }
  for (const [key, e] of floorCache) {
    if (alive(key)) continue;
    e.geometry?.dispose();
    floorCache.delete(key);
  }
  for (const [key, m] of floorFinishCache) {
    if (alive(key)) continue;
    for (const e of m.values()) e.geometry?.dispose();
    floorFinishCache.delete(key);
  }
  for (const cache of [stairsCache, roofCache]) {
    for (const [key, m] of cache) {
      if (alive(key)) continue;
      for (const e of m.values()) disposeEntry(e);
      cache.delete(key);
    }
  }
  for (const [key, m] of openingCache) {
    if (alive(key)) continue;
    for (const e of m.values()) for (const p of e.parts) p.geometry.dispose();
    openingCache.delete(key);
  }
  for (const [key, m] of staircaseCache) {
    if (alive(key)) continue;
    for (const e of m.values()) for (const p of e.parts) p.geometry.dispose();
    staircaseCache.delete(key);
  }
  for (const [key, m] of fixtureCache) {
    if (alive(key)) continue;
    for (const e of m.values()) for (const p of e.parts) p.geometry.dispose();
    fixtureCache.delete(key);
  }
  for (const [key, e] of counterCache) {
    if (alive(key)) continue;
    for (const c of e.counters) c.geometry.dispose();
    counterCache.delete(key);
  }
  for (const key of levelCache.keys()) if (!alive(key)) levelCache.delete(key);
  for (const [key, m] of deckCache) {
    if (alive(key)) continue;
    for (const e of m.values()) disposeDeckEntry(e);
    deckCache.delete(key);
  }
  for (const key of deckResult.keys()) if (!alive(key)) deckResult.delete(key);
  for (const [key, m] of guardCache) {
    if (alive(key)) continue;
    for (const e of m.values()) e.railing.dispose();
    guardCache.delete(key);
  }
  for (const key of guardResult.keys()) if (!alive(key)) guardResult.delete(key);
  for (const [key, m] of memberCache) {
    if (alive(key)) continue;
    for (const e of m.values()) {
      e.body?.dispose();
      e.footing?.dispose();
    }
    memberCache.delete(key);
  }
  for (const key of memberResult.keys()) if (!alive(key)) memberResult.delete(key);
}

function disposeDeckEntry(e: DeckEntry): void {
  e.boards.dispose();
  e.frame.dispose();
  e.railing?.dispose();
}

/** The phase a counter slab takes from the cabinets under it. */
function counterPhase(members: readonly Fixture[]): Phase {
  if (members.length && members.every((f) => f.phase === 'demo')) return 'demo';
  return members.some((f) => f.phase === 'new') ? 'new' : 'existing';
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
  if (!level) return { walls: [], floorFinishes: [], stairs: [], staircases: [], roofs: [], openings: [], fixtures: [], counters: [] };
  const key = `${levelId}|${viewMode}`;
  // Every mesh carries the phase it is drawn in (phase.ts shownPhase): red and green only in All.
  const sp = (p: Phase): Phase => shownPhase(p, viewMode);
  // The house after the work (types.ts ProposedLook): siding, roofs and windows, in Proposed only.
  const look = viewMode === 'proposed' ? plan.proposedLook : undefined;
  const idx = plan.levelOrder.indexOf(levelId);
  const below = idx > 0 ? plan.levels[plan.levelOrder[idx - 1]] : undefined;
  const ftf = floorToFloor(plan, levelId);
  const aboveLevel = idx >= 0 ? plan.levels[plan.levelOrder[idx + 1]] : undefined;
  const hit = levelCache.get(key);
  if (hit && hit.level === level && hit.belowStairs === below?.stairs && hit.ftf === ftf && hit.above === aboveLevel && hit.below === below && hit.look === plan.proposedLook) return hit.result;
  pruneCaches(plan);

  // Walls.
  const fps = getFootprints(level, viewMode);
  const byWall = getOpeningsByWall(level);
  const prevWalls = wallCache.get(key);
  const nextWalls = new Map<Id, WallEntry>();
  const walls: WallMesh[] = [];
  const heightOf = (w: Wall) => w.heightOverride ?? level.wallHeight;
  // Platform framing: an exterior wall under the slab of the level above runs up through it.
  const extensions = wallExtensions(plan, levelId, viewMode);
  const topOf = (w: Wall) => heightOf(w) + (extensions.get(w.id) ?? 0);
  // Level-wide band heights: every visible sill and head, every wall height.
  const bandSet = new Set<number>();
  for (const w of Object.values(level.walls)) if (fps.has(w.id)) bandSet.add(topOf(w));
  for (const o of Object.values(level.openings)) {
    if (!fps.has(o.wallId) || !isOpeningVisible(o, level.walls[o.wallId], viewMode)) continue;
    bandSet.add(Math.max(0, o.sill));
    bandSet.add(o.sill + o.height);
  }
  // Interior finishes: the rooms labelled in the view, the face on each side of each wall, and the
  // wainscot heights as level-wide bands too (neighbouring walls cut alike stay watertight).
  const faces = getFaces(level, viewMode);
  const sideFaces = wallSideFaces(faces, level.walls);
  const roomOf = (f: { roomId?: Id } | null | undefined): Room | undefined => (f?.roomId ? level.rooms[f.roomId] : undefined);
  for (const f of faces.faces) {
    const room = roomOf(f);
    const w = room && wainscotOf(room, level.wallHeight);
    if (w) bandSet.add(w.height);
  }
  const bands = [...bandSet].sort((p, q) => p - q);
  const bandsKey = bands.join(',');
  // Heights of the visible walls at each node, for the join faces. Only a neighbour drawn the same
  // way covers a join: through a translucent (demolished) wall you would see into an opaque wall
  // whose join face was left out, so mixed joins keep their faces.
  // Roofs visible in the view mode raise the exterior walls under them (roofs.ts wallRoofProfile).
  const roofsOnLevel: RoofOnLevel[] = Object.values(level.roofs ?? {})
    .filter((r) => isVisible(r.phase, viewMode))
    .map((roof) => ({ roof, bearing: roofBearing(level.wallHeight, roof) }));
  const profiles = new Map<Id, WallProfile>();
  if (roofsOnLevel.length) {
    for (const w of Object.values(level.walls)) {
      const fp = fps.get(w.id);
      if (!fp || w.kind !== 'exterior') continue;
      const pr = wallRoofProfile(fp, topOf(w), roofsOnLevel);
      if (pr) profiles.set(w.id, pr);
    }
  }
  const atNode = new Map<Id, { id: Id; h: number; seeThrough: boolean; dir: Vec2; t: number }[]>();
  for (const w of Object.values(level.walls)) {
    const fp = fps.get(w.id);
    if (!fp) continue;
    for (const n of [w.a, w.b]) {
      const list = atNode.get(n);
      const item = { id: w.id, h: topOf(w), seeThrough: isSeeThrough(sp(w.phase)), dir: fp.dir, t: w.thickness };
      if (list) list.push(item);
      else atNode.set(n, [item]);
    }
  }
  // Butt walls (not collinear with this one) cover the stretch of its face they land on, unless
  // one of them is see-through.
  const buttCover = (nodeId: Id, wall: Wall, dir: Vec2) => {
    const butts = (atNode.get(nodeId) ?? []).filter((x) => x.id !== wall.id && Math.abs(cross(x.dir, dir)) > 1e-6);
    if (!butts.length || butts.some((x) => x.seeThrough !== isSeeThrough(sp(wall.phase)))) return 0;
    return Math.min(...butts.map((x) => x.h));
  };
  const lowestOther = (nodeId: Id, wall: Wall) => {
    const hs = (atNode.get(nodeId) ?? []).filter((x) => x.id !== wall.id && x.seeThrough === isSeeThrough(sp(wall.phase))).map((x) => x.h);
    return hs.length ? Math.min(...hs) : 0; // nothing covers the join
  };
  for (const wall of Object.values(level.walls)) {
    const fp = fps.get(wall.id);
    if (!fp) continue;
    const openings = byWall.get(wall.id);
    const openingTop = heightOf(wall);
    const height = topOf(wall);
    const endHeights = { a: lowestOther(wall.a, wall), b: lowestOther(wall.b, wall) };
    const buttHeights = { a: buttCover(wall.a, wall, fp.dir), b: buttCover(wall.b, wall, fp.dir) };
    const splitPoints = splitPointsFor(fp, fps.values());
    const roofTop = profiles.get(wall.id) ?? null;
    // A collinear neighbour raised by the roof too (same thickness and class) covers the join above the plate.
    const raisedAt = (nodeId: Id) =>
      !!roofTop &&
      (atNode.get(nodeId) ?? []).some(
        (x) => x.id !== wall.id && Math.abs(cross(x.dir, fp.dir)) < 1e-6 && x.seeThrough === isSeeThrough(sp(wall.phase)) && Math.abs(x.t - wall.thickness) < 1e-9 && profiles.has(x.id),
      );
    const raisedJoin = { a: raisedAt(wall.a), b: raisedAt(wall.b) };
    const ctxKey = [
      bandsKey,
      endHeights.a,
      endHeights.b,
      buttHeights.a,
      buttHeights.b,
      splitPoints.map((p) => `${p.x},${p.y}`).join(';'),
      roofTop ? `${roofTop.s.join(',')}/${roofTop.h.join(',')}/${raisedJoin.a}/${raisedJoin.b}` : '',
    ].join('|');
    // The long faces a room on that side dresses (never a demolished or screen wall's).
    const sides = sideFaces.get(wall.id);
    const dressable = sp(wall.phase) !== 'demo' && wallFinishOf(wall) !== 'screen';
    const sideLook = (side: 'left' | 'right') => {
      const room = dressable ? roomOf(sides?.[side]) : undefined;
      const look = room ? roomWallLookOf(room) : null;
      const wainscot = room ? wainscotOf(room, level.wallHeight) : null;
      return room && (look || wainscot) ? { room, look, wainscot } : null;
    };
    const looks = { left: sideLook('left'), right: sideLook('right') };
    const cutOf = (s: ReturnType<typeof sideLook>): SideCut => (s ? (s.wainscot?.height ?? null) : false);
    const cuts = { left: cutOf(looks.left), right: cutOf(looks.right) };
    const splitKey = `${cuts.left}|${cuts.right}`;
    const old = prevWalls?.get(wall.id);
    const sameGeometry = !!old && old.fp === fp && old.wall === wall && old.openings === openings && old.height === height && old.ctxKey === ctxKey;
    const geometry = sameGeometry
      ? old.geometry
      : buildWallGeometry(fp, wall, openings ?? [], height, viewMode, { bands, endHeights, buttHeights, splitPoints, roofTop, raisedJoin, openingTop });
    const entry: WallEntry =
      sameGeometry && old.splitKey === splitKey
        ? old
        : {
            fp,
            wall,
            openings,
            height,
            ctxKey,
            geometry,
            splitKey,
            split: cuts.left === false && cuts.right === false ? null : splitWallFaces(geometry, fp, cuts),
          };
    nextWalls.set(wall.id, entry);
    const dressed = entry.split?.faces.map((part) => {
      const s = looks[part.side]!;
      const look = part.band === 'wainscot' && s.wainscot ? s.wainscot : (s.look ?? { finish: 'paint' as const, color: DEFAULT_INTERIOR_COLOR });
      return { roomId: s.room.id, side: part.side, band: part.band, geometry: part.geometry, finish: look.finish, color: look.color };
    });
    // A re-sided wall: an exterior wall in a siding finish takes the proposed look's.
    const resided = !!look && wall.kind === 'exterior' && SIDING_FINISHES.includes(wallFinishOf(wall));
    walls.push({
      id: wall.id,
      geometry: entry.split ? entry.split.core : entry.geometry,
      phase: sp(wall.phase),
      kind: wall.kind,
      finish: (resided && look.wallFinish) || wallFinishOf(wall),
      color: (resided && look.wallColor) || wallColorOf(wall),
      ...(dressed ? { faces: dressed } : {}),
    });
  }
  if (prevWalls) for (const [id, e] of prevWalls) if (nextWalls.get(id) !== e) disposeWallEntry(e, nextWalls.get(id));
  wallCache.set(key, nextWalls);

  // Floor slab.
  const belowStairs = below?.stairs;
  const belowFtf = below ? floorToFloor(plan, below.id) : 0;
  const insets = slabInsets(plan, levelId, viewMode);
  const prevFloor = floorCache.get(key);
  let floor: FloorEntry;
  if (
    prevFloor &&
    sameRings(prevFloor.outerFaces, faces.outerFaces) &&
    sameRings(prevFloor.outerFaceThickness, faces.outerFaceThickness) &&
    sameRings(prevFloor.insets ?? [], insets ?? []) &&
    prevFloor.belowStairs === belowStairs &&
    prevFloor.floorOpenings === level.floorOpenings &&
    prevFloor.belowFtf === belowFtf &&
    prevFloor.thickness === level.floorThickness
  ) {
    floor = prevFloor;
  } else {
    prevFloor?.geometry?.dispose();
    // Floor openings first: a stair hole inside one is dropped (holeFits), the opening covers it.
    const holes = [...floorOpeningHoles(plan, levelId, viewMode), ...stairHoles(below, viewMode, belowFtf)];
    floor = {
      outerFaces: faces.outerFaces,
      outerFaceThickness: faces.outerFaceThickness,
      insets,
      belowStairs,
      floorOpenings: level.floorOpenings,
      belowFtf,
      thickness: level.floorThickness,
      geometry: buildFloorGeometry(faces, holes, level.floorThickness, insets ?? false),
    };
    floorCache.set(key, floor);
  }

  // Floor finishes: one surface per room that sets one, rebuilt when its net outline or the stair
  // holes through the slab change.
  const finishHoles = [...floorOpeningHoles(plan, levelId, viewMode), ...stairHoles(below, viewMode, belowFtf)];
  const prevFinishes = floorFinishCache.get(key);
  const nextFinishes = new Map<Id, FloorFinishEntry>();
  const floorFinishes: FloorFinishMesh[] = [];
  for (const f of faces.faces) {
    const room = roomOf(f);
    const look = room ? floorLookOf(room) : null;
    if (!room || !look) continue;
    const old = prevFinishes?.get(room.id);
    const entry: FloorFinishEntry =
      old && sameRings([old.net], [f.netPolygon]) && sameRings(old.holes, finishHoles)
        ? old
        : { net: f.netPolygon, holes: finishHoles, geometry: buildFloorFinishGeometry(f.netPolygon, finishHoles) };
    nextFinishes.set(room.id, entry);
    if (entry.geometry) floorFinishes.push({ roomId: room.id, phase: sp(room.phase ?? 'existing'), finish: look.finish, color: look.color, geometry: entry.geometry });
  }
  if (prevFinishes) for (const [id, e] of prevFinishes) if (nextFinishes.get(id) !== e) e.geometry?.dispose();
  floorFinishCache.set(key, nextFinishes);

  // Stairs: each flight its own base, climb and riser count (a short flight, a landing).
  const prevStairs = stairsCache.get(key);
  const nextStairs = new Map<Id, StairsEntry>();
  const stairs: StairsMesh[] = [];
  for (const s of Object.values(level.stairs)) {
    if (!isVisible(s.phase, viewMode) || !(s.width > 0) || !(s.run > 0)) continue;
    // A staircase's pieces are drawn with it.
    if (s.staircaseId && level.staircases?.[s.staircaseId]) continue;
    const { rise, risers } = flightSteps(s, ftf);
    const base = stairsBase(s);
    if (!(rise > 0)) continue;
    const old = prevStairs?.get(s.id);
    const entry =
      old && old.stairs === s && old.rise === rise && old.risers === risers && old.base === base
        ? old
        : { stairs: s, rise, risers, base, geometry: buildStairsGeometry(s, rise, risers, base, !!s.open), railing: buildStairsRailingGeometry(s, rise, risers, base) };
    nextStairs.set(s.id, entry);
    stairs.push({ id: s.id, geometry: entry.geometry, railing: entry.railing, phase: sp(s.phase) });
  }
  if (prevStairs)
    for (const [id, e] of prevStairs) {
      if (nextStairs.get(id) === e) continue;
      e.geometry.dispose();
      e.railing?.dispose();
    }
  stairsCache.set(key, nextStairs);

  // Staircases: rebuilt when their layout object changes (getStaircaseLayout).
  const prevStaircases = staircaseCache.get(key);
  const nextStaircases = new Map<Id, StaircaseEntry>();
  const staircases: StaircaseMesh[] = [];
  for (const id of Object.keys(level.staircases ?? {})) {
    const layout = getStaircaseLayout(plan, levelId, id, viewMode);
    if (!layout) continue;
    const old = prevStaircases?.get(id);
    const entry = old && old.layout === layout ? old : { layout, parts: buildStaircaseParts(layout.solids) };
    nextStaircases.set(id, entry);
    const first = level.stairs[layout.members[0]];
    staircases.push({ id, phase: sp(first?.phase ?? 'existing'), treadColor: layout.style.treadColor, paintColor: layout.style.riserColor, parts: entry.parts });
  }
  if (prevStaircases) for (const [id, e] of prevStaircases) if (nextStaircases.get(id) !== e) for (const p of e.parts) p.geometry.dispose();
  staircaseCache.set(key, nextStaircases);

  // Roofs: rebuilt only when the roof object or its bearing height changes.
  const prevRoofs = roofCache.get(key);
  const nextRoofs = new Map<Id, RoofEntry>();
  const roofs: RoofMesh[] = [];
  for (const { roof, bearing } of roofsOnLevel) {
    // A re-roof: the proposed look's finish and colour, new (no weathering), its board colour.
    const finish = look?.roofFinish ?? roof.finish;
    const reroofed = !!look && (look.roofFinish !== undefined || look.roofColor !== undefined);
    const old = prevRoofs?.get(roof.id);
    const entry: RoofEntry =
      old && old.roof === roof && old.finish === finish && old.bearing === bearing
        ? old
        : { roof, finish, bearing, ...roofParts(finish === roof.finish ? roof : { ...roof, finish }, bearing) };
    nextRoofs.set(roof.id, entry);
    roofs.push({
      id: roof.id,
      geometry: entry.geometry,
      fascia: entry.fascia,
      rafters: entry.rafters,
      phase: sp(roof.phase),
      finish,
      color: look?.roofColor ?? (look?.roofFinish ? ROOF_COLOR[look.roofFinish] : roofColorOf(roof)),
      boardColor: look?.boardColor ?? boardColorOf(roof),
      weathering: reroofed ? 0 : weatheringOf(roof),
    });
  }
  if (prevRoofs) for (const [id, e] of prevRoofs) if (nextRoofs.get(id) !== e) disposeEntry(e);
  roofCache.set(key, nextRoofs);

  // Window and door fills.
  const prevFills = openingCache.get(key);
  const nextFills = new Map<Id, OpeningEntry>();
  const openingMeshes: OpeningMesh[] = [];
  const centroid = levelCentroid(level);
  for (const wall of Object.values(level.walls)) {
    const fp = fps.get(wall.id);
    const list = byWall.get(wall.id);
    if (!fp || !list) continue;
    let side: 1 | -1 | null = null;
    for (const o of list) {
      if (o.type === 'passage' || !isOpeningVisible(o, wall, viewMode)) continue;
      side ??= outwardSide(fp, wall, faces, centroid);
      const height = heightOf(wall);
      const noShutters = look?.shutters === false && !!o.shutters;
      const old = prevFills?.get(o.id);
      const entry: OpeningEntry =
        old && old.fp === fp && old.opening === o && old.wall === wall && old.height === height && old.side === side && old.noShutters === noShutters
          ? old
          : { fp, opening: o, wall, height, side, noShutters, parts: buildOpeningFill(fp, noShutters ? { ...o, shutters: false } : o, height, side) };
      nextFills.set(o.id, entry);
      if (entry.parts.length) {
        openingMeshes.push({
          id: o.id,
          type: o.type,
          phase: sp(o.phase),
          leafColor: leafColorOf(o),
          trimColor: look?.trimColor ?? TRIM_COLOR,
          sashColor: look?.sashColor ?? DEFAULT_SASH_COLOR,
          parts: entry.parts,
        });
      }
    }
  }
  if (prevFills) for (const [id, e] of prevFills) if (nextFills.get(id) !== e) for (const p of e.parts) p.geometry.dispose();
  openingCache.set(key, nextFills);

  // Casework: each fixture's parts are rebuilt only when its object or the resolved front style
  // changes; the counter slabs when the list of visible counter fixtures does.
  const finishes = level.finishes;
  const prevFixtures = fixtureCache.get(key);
  const nextFixtures = new Map<Id, FixtureEntry>();
  const fixtureMeshes: FixtureMesh[] = [];
  const counterFixtures: Fixture[] = [];
  for (const f of Object.values(level.fixtures ?? {})) {
    if (!isVisible(f.phase, viewMode)) continue;
    if (hasCounter(f.kind)) counterFixtures.push(f);
    const style = frontStyleOf(f, finishes);
    const old = prevFixtures?.get(f.id);
    const entry: FixtureEntry = old && old.fixture === f && old.style === style ? old : { fixture: f, style, parts: buildFixtureParts(f, finishes) };
    nextFixtures.set(f.id, entry);
    if (entry.parts.length) fixtureMeshes.push({ id: f.id, kind: f.kind, phase: sp(f.phase), frontColor: frontColorOf(f, finishes), parts: entry.parts });
  }
  if (prevFixtures) for (const [id, e] of prevFixtures) if (nextFixtures.get(id) !== e) for (const p of e.parts) p.geometry.dispose();
  fixtureCache.set(key, nextFixtures);
  const prevCounters = counterCache.get(key);
  let counters: CounterMesh[];
  if (prevCounters && prevCounters.fixtures.length === counterFixtures.length && prevCounters.fixtures.every((f, i) => f === counterFixtures[i])) {
    counters = prevCounters.counters;
  } else {
    if (prevCounters) for (const c of prevCounters.counters) c.geometry.dispose();
    const byId = new Map(counterFixtures.map((f) => [f.id, f]));
    counters = counterRuns(counterFixtures).map((run) => ({
      id: run.fixtureIds.join('+'),
      geometry: buildCounterGeometry(run),
      phase: sp(counterPhase(run.fixtureIds.map((id) => byId.get(id)!))),
      fixtureIds: run.fixtureIds,
    }));
    counterCache.set(key, { fixtures: counterFixtures, counters });
  }

  const result: LevelMeshes = { walls, floorFinishes, stairs, staircases, roofs, openings: openingMeshes, fixtures: fixtureMeshes, counters, ...(floor.geometry ? { floor: floor.geometry } : {}) };
  levelCache.set(key, { level, belowStairs, ftf, above: aboveLevel, below, look: plan.proposedLook, result });
  return result;
}

/** Dispose every cached geometry (tests, or when the 3D view is torn down for good). */
export function clearMeshCache(): void {
  for (const m of wallCache.values()) for (const e of m.values()) disposeWallEntry(e);
  for (const e of floorCache.values()) e.geometry?.dispose();
  for (const m of floorFinishCache.values()) for (const e of m.values()) e.geometry?.dispose();
  floorFinishCache.clear();
  for (const m of stairsCache.values()) for (const e of m.values()) disposeEntry(e);
  for (const m of roofCache.values()) for (const e of m.values()) disposeEntry(e);
  for (const m of openingCache.values()) for (const e of m.values()) for (const p of e.parts) p.geometry.dispose();
  for (const m of staircaseCache.values()) for (const e of m.values()) for (const p of e.parts) p.geometry.dispose();
  staircaseCache.clear();
  for (const m of fixtureCache.values()) for (const e of m.values()) for (const p of e.parts) p.geometry.dispose();
  for (const e of counterCache.values()) for (const c of e.counters) c.geometry.dispose();
  for (const m of deckCache.values()) for (const e of m.values()) disposeDeckEntry(e);
  deckCache.clear();
  deckResult.clear();
  for (const m of guardCache.values())
    for (const e of m.values()) {
      e.railing.dispose();
      e.rail?.dispose();
    }
  guardCache.clear();
  guardResult.clear();
  roofCache.clear();
  openingCache.clear();
  fixtureCache.clear();
  counterCache.clear();
  clearSiteCache();
  wallCache.clear();
  floorCache.clear();
  stairsCache.clear();
  levelCache.clear();
}

// ---------------------------------------------------------------------------------------------
// Site: terrain and columns (DESIGN.md "Site and terrain"). Unlike the level meshes these are in
// absolute elevation (Y = the plan's elevation), so the view puts them in a group at the origin.

/**
 * Texture coordinates in inches for a box-like solid (a column's shaft and parts), per triangle by
 * its flat normal like addWallUVs: faces turned up or down take (x, z), the plan position; a
 * vertical face with normal (nx, 0, nz) takes u = x t.x + z t.z along its tangent t = (-nz, 0, nx)
 * (the normal turned a quarter in plan) and v = Y, so courses run level round every face. The
 * textures on them repeat every 48" (repeat 1/48, view3d/textures.ts).
 */
export function addBoxUVs(g: BufferGeometry): BufferGeometry {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const count = pos?.count ?? 0;
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const nx = nor.getX(i);
    const nz = nor.getZ(i);
    if (Math.abs(nor.getY(i)) > 0.5) {
      uv[2 * i] = x;
      uv[2 * i + 1] = z;
    } else {
      const h = Math.hypot(nx, nz) || 1;
      uv[2 * i] = (x * -nz + z * nx) / h;
      uv[2 * i + 1] = pos.getY(i);
    }
  }
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return g;
}

/**
 * A column's shaft: a box from its base to its top, turned by its rotation about its centre, with
 * UVs in inches (addBoxUVs). On a capped chimney the shaft stops under the cap (CHIMNEY_CAP), so no
 * two faces of the shaft and its cap lie on top of each other.
 */
export function buildColumnGeometry(column: Pick<Column, 'at' | 'width' | 'depth' | 'rotation' | 'base' | 'top'> & Partial<Pick<Column, 'kind' | 'cap'>>): BufferGeometry {
  const top = hasChimneyCap(column) ? Math.max(column.base, column.top - CHIMNEY_CAP.thickness) : column.top;
  const g = addBoxUVs(prism(columnOutline(column), column.base, top));
  return column.kind === 'flue' ? roundNormals(g, column.at) : g;
}

/** A round solid's side faces get normals pointing straight out from its axis at `at`, so it shades smooth. */
function roundNormals(g: BufferGeometry, at: Vec2): BufferGeometry {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(nor.getY(i)) > 0.5) continue;
    const dx = pos.getX(i) - at.x;
    const dz = pos.getZ(i) - at.y;
    const len = Math.hypot(dx, dz) || 1;
    nor.setXYZ(i, dx / len, 0, dz / len);
  }
  nor.needsUpdate = true;
  return g;
}

/**
 * The cap and spark arrestor of a capped chimney, or the rain cap's stem and hood of a capped flue
 * (site.ts chimneyPartBoxes), one geometry each with UVs in inches; none for a column without them.
 * The cap is a closed box; the arrestor is a wire box open at the bottom, where it stands on the cap
 * over the flue; a flue's parts are round, shading smooth like its pipe.
 */
export function buildColumnParts(column: Pick<Column, 'at' | 'width' | 'depth' | 'rotation' | 'base' | 'top' | 'kind' | 'cap'>): ColumnPartMesh[] {
  return chimneyPartBoxes(column).map((b) => {
    const g = addBoxUVs(prism(b.outline, b.bottom, b.top, [], { bottom: b.part !== 'arrestor' }));
    return { part: b.part, geometry: column.kind === 'flue' ? roundNormals(g, column.at) : g };
  });
}

interface GridSide {
  /** The side's boundary vertices, in order of increasing x (`along` 0) or plan y (`along` 2). */
  ids: number[];
  along: 0 | 2;
  /** Outward direction in (x, plan y). */
  out: [number, number];
}

/** The terrain grid's four sides (north, south, west, east), corners on two of them. */
function gridSides(grid: TerrainGrid): GridSide[] {
  const nx = grid.cellsX + 1;
  const ny = grid.cellsY + 1;
  const run = (n: number, at: (k: number) => number) => Array.from({ length: n }, (_, k) => at(k));
  return [
    { ids: run(nx, (i) => i), along: 0, out: [0, -1] },
    { ids: run(nx, (i) => (ny - 1) * nx + i), along: 0, out: [0, 1] },
    { ids: run(ny, (j) => j * nx), along: 2, out: [-1, 0] },
    { ids: run(ny, (j) => j * nx + nx - 1), along: 2, out: [1, 0] },
  ];
}

/** Push triangle a, b, c (indices into `pos`) wound so its normal points along `dir` (x, y, z). */
function pushFacing(idx: number[], pos: readonly number[], a: number, b: number, c: number, dir: P3): void {
  const u = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]];
  const w = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]];
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  if (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] >= 0) idx.push(a, b, c);
  else idx.push(a, c, b);
}

/**
 * The terrain grid (site.ts) as an indexed geometry: the grid with smooth upward normals, then its
 * skirt, a vertical strip on each of the grid's four sides from the boundary vertices down to
 * `skirtElevation`, facing out, so the ground (in the export too) has no open edge. The skirt has
 * vertices of its own (a copy of each boundary vertex and one at the bottom), so the boundary keeps
 * its upward normals and each side gets flat outward ones. UVs are in inches like the walls':
 * (plan x, plan y) on the grid, (distance along the side, elevation) on the skirt; the lawn texture
 * repeats every 96" (view3d/groundTexture.ts).
 */
export function buildTerrainGeometry(grid: TerrainGrid): BufferGeometry {
  const p = grid.positions;
  const pos = Array.from(p);
  const uv: number[] = [];
  for (let v = 0; v < p.length / 3; v++) uv.push(p[v * 3], p[v * 3 + 2]);
  const idx = Array.from(grid.indices);
  const bottom = grid.skirtElevation;
  for (const { ids, along, out } of gridSides(grid)) {
    const dir: P3 = [out[0], 0, out[1]];
    const top0 = pos.length / 3;
    for (const g of ids) {
      pos.push(p[g * 3], p[g * 3 + 1], p[g * 3 + 2]);
      uv.push(p[g * 3 + along], p[g * 3 + 1]);
    }
    const bottom0 = pos.length / 3;
    for (const g of ids) {
      pos.push(p[g * 3], bottom, p[g * 3 + 2]);
      uv.push(p[g * 3 + along], bottom);
    }
    for (let k = 0; k + 1 < ids.length; k++) {
      pushFacing(idx, pos, top0 + k, bottom0 + k, bottom0 + k + 1, dir);
      pushFacing(idx, pos, top0 + k, bottom0 + k + 1, top0 + k + 1, dir);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

/** Half the side of the far ground's square, from the terrain grid's centre (1000'; the sky box is 30000" wide). */
export const FAR_GROUND_HALF = 12000;

/**
 * The far ground round the terrain (DESIGN.md "Site and terrain"), so the horizon shows ground: a collar from
 * the grid's boundary out to a square FAR_GROUND_HALF from the grid's centre. Each side is a strip
 * of quads from the boundary vertices (their heights, and their normals from `terrainNormals`, the
 * terrain geometry's normal array, so the seam does not show) to as many points spread along the
 * square's side at the grid's `skirtElevation`, normals up; over 1000' the fall is imperceptible.
 * The collar leaves the grid's area open: a plane under the whole site would cross the basement
 * where the house is cut out of the ground. UVs in inches like the terrain.
 */
export function buildFarGroundGeometry(grid: TerrainGrid, terrainNormals?: ArrayLike<number>, half: number = FAR_GROUND_HALF): BufferGeometry {
  const { minX, minY, maxX, maxY } = grid.bounds;
  const cx = (minX + maxX) / 2;
  const cz = (minY + maxY) / 2;
  // A site wider than the square still gets a strip round it.
  const h = Math.max(half, (maxX - minX) / 2 + grid.step, (maxY - minY) / 2 + grid.step);
  const p = grid.positions;
  const pos: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const { ids, along, out } of gridSides(grid)) {
    const inner0 = pos.length / 3;
    for (const g of ids) {
      pos.push(p[g * 3], p[g * 3 + 1], p[g * 3 + 2]);
      if (terrainNormals) normal.push(terrainNormals[g * 3], terrainNormals[g * 3 + 1], terrainNormals[g * 3 + 2]);
      else normal.push(0, 1, 0);
      uv.push(p[g * 3], p[g * 3 + 2]);
    }
    // The square's side beyond this one: fixed x (west, east) or plan y (north, south).
    const fixed = along === 0 ? cz + out[1] * h : cx + out[0] * h;
    const start = (along === 0 ? cx : cz) - h;
    const outer0 = pos.length / 3;
    for (let k = 0; k < ids.length; k++) {
      const t = start + (2 * h * k) / (ids.length - 1);
      const [x, z] = along === 0 ? [t, fixed] : [fixed, t];
      pos.push(x, grid.skirtElevation, z);
      normal.push(0, 1, 0);
      uv.push(x, z);
    }
    for (let k = 0; k + 1 < ids.length; k++) {
      pushFacing(idx, pos, inner0 + k, outer0 + k, outer0 + k + 1, [0, 1, 0]);
      pushFacing(idx, pos, inner0 + k, outer0 + k + 1, inner0 + k + 1, [0, 1, 0]);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

let terrainEntry: { grid: TerrainGrid; geometry: BufferGeometry } | null = null;
let farGroundEntry: { terrain: BufferGeometry; geometry: BufferGeometry } | null = null;

/**
 * The terrain's geometry in a view mode: the same object while the grid (site.ts planTerrain,
 * which is memoized by the grade points, the plan bounds, the fallback elevation and the lowest
 * level's outline that is cut out of the ground) is the same, so a 2D edit that touches none of
 * them rebuilds nothing. The replaced geometry is disposed.
 */
export function getTerrainGeometry(plan: Plan, viewMode: ViewMode = 'all'): BufferGeometry {
  const grid = planTerrain(plan, viewMode);
  if (terrainEntry && terrainEntry.grid === grid) return terrainEntry.geometry;
  terrainEntry?.geometry.dispose();
  terrainEntry = { grid, geometry: buildTerrainGeometry(grid) };
  return terrainEntry.geometry;
}

/**
 * The far ground round the plan's terrain: the same object while the terrain geometry is (its
 * inner edge follows the terrain's boundary). The replaced geometry is disposed.
 */
export function getFarGroundGeometry(plan: Plan, viewMode: ViewMode = 'all'): BufferGeometry {
  const terrain = getTerrainGeometry(plan, viewMode);
  if (farGroundEntry && farGroundEntry.terrain === terrain) return farGroundEntry.geometry;
  farGroundEntry?.geometry.dispose();
  const normals = terrain.getAttribute('normal').array;
  farGroundEntry = { terrain, geometry: buildFarGroundGeometry(planTerrain(plan, viewMode), normals) };
  return farGroundEntry.geometry;
}

/** A part of a column drawn in its own material: a chimney's cap or spark arrestor. */
export interface ColumnPartMesh {
  part: ChimneyPart;
  geometry: BufferGeometry;
}

export interface ColumnMesh {
  id: Id;
  /** The shaft (buildColumnGeometry). */
  geometry: BufferGeometry;
  phase: Phase;
  kind: Column['kind'];
  /** The column's colour after the default (model/finish.ts columnColorOf). */
  color: string;
  /** A capped chimney's cap and spark arrestor (buildColumnParts); absent on any other column. */
  parts?: ColumnPartMesh[];
}

export interface SiteMeshes {
  /** The columns the view mode shows. */
  columns: ColumnMesh[];
}

interface ColumnEntry {
  column: Column;
  geometry: BufferGeometry;
  parts: ColumnPartMesh[];
}

function disposeColumnEntry(e: ColumnEntry): void {
  e.geometry.dispose();
  for (const p of e.parts) p.geometry.dispose();
}

const columnCache = new Map<ViewMode, Map<Id, ColumnEntry>>();
const siteResultCache = new Map<ViewMode, { columns: Site['columns']; result: SiteMeshes }>();

/**
 * The columns visible in a view mode as meshes, memoized: the same result object while the
 * columns record is unchanged, and a column's geometries (the shaft, and a capped chimney's parts)
 * are reused while its object is unchanged (geometry that drops out is disposed).
 */
export function getSiteMeshes(plan: Plan, viewMode: ViewMode): SiteMeshes {
  const columns = plan.site.columns;
  const hit = siteResultCache.get(viewMode);
  if (hit && hit.columns === columns) return hit.result;
  const prev = columnCache.get(viewMode);
  const next = new Map<Id, ColumnEntry>();
  const out: ColumnMesh[] = [];
  for (const c of Object.values(columns)) {
    if (!isVisible(c.phase, viewMode)) continue;
    const old = prev?.get(c.id);
    const entry = old && old.column === c ? old : { column: c, geometry: buildColumnGeometry(c), parts: buildColumnParts(c) };
    next.set(c.id, entry);
    out.push({ id: c.id, geometry: entry.geometry, phase: shownPhase(c.phase, viewMode), kind: c.kind, color: columnColorOf(c), ...(entry.parts.length ? { parts: entry.parts } : {}) });
  }
  if (prev) for (const [id, e] of prev) if (next.get(id) !== e) disposeColumnEntry(e);
  columnCache.set(viewMode, next);
  const result: SiteMeshes = { columns: out };
  siteResultCache.set(viewMode, { columns, result });
  return result;
}

function clearSiteCache(): void {
  for (const m of columnCache.values()) for (const e of m.values()) disposeColumnEntry(e);
  columnCache.clear();
  siteResultCache.clear();
  terrainEntry?.geometry.dispose();
  terrainEntry = null;
  farGroundEntry?.geometry.dispose();
  farGroundEntry = null;
}
