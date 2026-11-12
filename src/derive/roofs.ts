import { add, clipHalfPlane, cross, dist, dot, lineIntersection, normalize, pointInPolygon, polygonSignedArea, projectPointToSegment, scale, sub } from '../model/geometry';
import { isMetalRoof, rafterOf, roofEaveOf } from '../model/finish';
import type { Roof, RoofShape, Vec2 } from '../model/types';
import { insetPolygon } from './rooms';
import { directionVector } from './stairs';

// Roofs (DESIGN.md "Roofs"). Pure: no three, no React, so the 2D editor can use it without loading
// the 3D chunk; derive/meshes.ts wraps the solid in a BufferGeometry (buildRoofGeometry).
//
// A roof is a set of planes over its outline. The underside height at a plan point is the lowest of
// the planes there (gable, hip: the planes rise from the eaves toward the ridge, so their lower
// envelope is the roof); every plane passes through the bearing height along its eave line, which
// lies on the outline (the bearing walls' outside faces), so the overhang hangs lower than the
// plate by overhang * pitch / 12. The solid spans the outline grown by the overhang, from the
// underside up `thickness` (measured vertically), with fascia boards along the eaves and rake
// boards along the sloped edges; open eaves have rafter tails instead of a fascia board, and a
// metal gable or hip roof has a ridge cap.
//
// Heights are level-local (0 = the level's floor top); the bearing height is the level's wall
// height plus the roof's bearingOffset (roofBearing).

const EPS = 1e-9;
/** Thickness of the fascia and rake boards, proud of the slab edge. */
export const BOARD_THICKNESS = 1.5;
/** Width of a rafter tail (a 2x rafter). */
export const RAFTER_WIDTH = 1.5;
/** How far a rafter tail stops short of the roof's edge. */
export const RAFTER_SETBACK = 1;
/** Ridge cap of a metal roof: a strip this wide (in plan) each side of a ridge or hip line, this thick. */
export const RIDGE_CAP_WIDTH = 6;
export const RIDGE_CAP_THICKNESS = 2.5;

export const ROOF_DEFAULTS = {
  shape: 'gable' as RoofShape,
  pitch: 8,
  overhang: 24,
  bearingOffset: 0,
  thickness: 8,
  fascia: 6,
  finish: 'metal' as const,
};

export const ROOF_SHAPE_LABEL: Record<RoofShape, string> = {
  gable: 'Gable',
  shed: 'Shed (lean-to)',
  hip: 'Hip',
  flat: 'Flat',
};

/** Height of a roof's bearing line above the level's floor top. */
export const roofBearing = (wallHeight: number, roof: Pick<Roof, 'bearingOffset'>): number => wallHeight + roof.bearingOffset;

/** A plane over the plan: height = c + gx * x + gy * y. */
export interface RoofPlane {
  c: number;
  gx: number;
  gy: number;
}

export const planeAt = (pl: RoofPlane, p: Vec2): number => pl.c + pl.gx * p.x + pl.gy * p.y;

/** The ridge frame: u along the ridge (for a shed, the downhill direction), v across it. */
export interface RoofFrame {
  u: Vec2;
  v: Vec2;
  umin: number;
  umax: number;
  vmin: number;
  vmax: number;
}

export function roofFrame(roof: Pick<Roof, 'outline' | 'ridgeAngle'>): RoofFrame {
  const u = directionVector(roof.ridgeAngle);
  const v = { x: -u.y, y: u.x };
  let umin = Infinity;
  let umax = -Infinity;
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const p of roof.outline) {
    const a = dot(p, u);
    const b = dot(p, v);
    umin = Math.min(umin, a);
    umax = Math.max(umax, a);
    vmin = Math.min(vmin, b);
    vmax = Math.max(vmax, b);
  }
  return { u, v, umin, umax, vmin, vmax };
}

/** Height `bearing` where dot(dir, p) = s0, rising at `k` per inch in the +dir direction. */
const slope = (bearing: number, k: number, dir: Vec2, s0: number): RoofPlane => ({ c: bearing - k * s0, gx: k * dir.x, gy: k * dir.y });

/**
 * The roof's planes (the underside). Gable: two planes meeting at a ridge through the middle of the
 * outline along ridgeAngle, each at the bearing height on the outline's farthest extent across the
 * ridge. Shed: one plane at the bearing height on the outline's farthest extent in the ridgeAngle
 * direction, rising against it. Hip: the gable's planes plus one at each end of the outline's
 * bounding rectangle in the ridge frame. Flat (or a pitch of 0): one horizontal plane.
 */
export function roofPlanes(roof: Pick<Roof, 'shape' | 'outline' | 'ridgeAngle' | 'pitch'>, bearingHeight: number): RoofPlane[] {
  const k = roof.pitch / 12;
  if (roof.shape === 'flat' || !(k > 0)) return [{ c: bearingHeight, gx: 0, gy: 0 }];
  const f = roofFrame(roof);
  const neg = (d: Vec2) => ({ x: -d.x, y: -d.y });
  if (roof.shape === 'shed') return [slope(bearingHeight, k, neg(f.u), -f.umax)];
  const sides = [slope(bearingHeight, k, f.v, f.vmin), slope(bearingHeight, k, neg(f.v), -f.vmax)];
  if (roof.shape === 'gable') return sides;
  return [...sides, slope(bearingHeight, k, f.u, f.umin), slope(bearingHeight, k, neg(f.u), -f.umax)];
}

/** Lowest of the planes at p: the underside where every plane of a convex roof meets. */
export function planesHeightAt(planes: readonly RoofPlane[], p: Vec2): number {
  let h = Infinity;
  for (const pl of planes) h = Math.min(h, planeAt(pl, p));
  return h;
}

/** Drop consecutive duplicates and turn to positive signed area (clockwise on screen). */
function cleanPositive(poly: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > EPS || Math.abs(last.y - p.y) > EPS) out.push({ x: p.x, y: p.y });
  }
  while (out.length > 1 && Math.abs(out[0].x - out[out.length - 1].x) <= EPS && Math.abs(out[0].y - out[out.length - 1].y) <= EPS) out.pop();
  if (polygonSignedArea(out) < 0) out.reverse();
  return out;
}

const outlineCache = new WeakMap<Roof, { base: Vec2[]; grown: Vec2[] }>();

function outlines(roof: Roof): { base: Vec2[]; grown: Vec2[] } {
  let hit = outlineCache.get(roof);
  if (!hit) {
    let base: Vec2[];
    if (roof.shape === 'hip' && !hipArms(roof)) {
      // Hip roofs are built over the outline's bounding rectangle in the ridge frame, unless the
      // outline is an L (hipArms): then over the L itself.
      const f = roofFrame(roof);
      const at = (a: number, b: number) => add(scale(f.u, a), scale(f.v, b));
      base = cleanPositive([at(f.umin, f.vmin), at(f.umax, f.vmin), at(f.umax, f.vmax), at(f.umin, f.vmax)]);
    } else base = cleanPositive(roof.outline);
    const grown = roof.overhang > 0 && base.length >= 3 ? insetPolygon(base, base.map(() => -roof.overhang)) : base;
    hit = { base, grown };
    outlineCache.set(roof, hit);
  }
  return hit;
}

/**
 * The outline the roof bears on, positive (clockwise on screen): the stored outline, or for a hip
 * roof its bounding rectangle in the ridge frame (an L-shaped hip keeps its L, hipArms).
 */
export const roofBaseOutline = (roof: Roof): Vec2[] => outlines(roof).base;

/** The outline grown by the overhang on every side (eaves and rakes alike), positive. */
export const roofOutlineWithOverhang = (roof: Roof): Vec2[] => outlines(roof).grown;

/** Distance from p to the closest edge of a closed polygon. */
export function distanceToBoundary(p: Vec2, poly: readonly Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, projectPointToSegment(p, poly[i], poly[(i + 1) % poly.length]).distance);
  return d;
}

/** Inside the polygon or within 1e-6 of its boundary. */
const insideOrOn = (p: Vec2, poly: readonly Vec2[]) => pointInPolygon(p, poly) || distanceToBoundary(p, poly) < 1e-6;

/** Underside height at a plan point, or null outside the overhang outline. */
export function roofHeightAt(roof: Roof, bearingHeight: number, p: Vec2): number | null {
  if (!insideOrOn(p, roofOutlineWithOverhang(roof))) return null;
  const arms = hipArms(roof);
  if (!arms) return planesHeightAt(roofPlanes(roof, bearingHeight), p);
  // An L-shaped hip: the higher of its two arms' hips where both cover the point (the valley).
  let h = -Infinity;
  for (const s of roofSections(roof, bearingHeight)) if (insideOrOn(p, s.grown)) h = Math.max(h, planesHeightAt(s.planes, p));
  return Number.isFinite(h) ? h : null;
}

// ---------------------------------------------------------------------------------------------
// Sections: the convex roofs a roof is built from

/**
 * An L-shaped hip roof (DESIGN.md "Roofs that meet"): the two rectangles, in the ridge frame, whose
 * union is the outline when it is an L of six corners with every side along or across the ridge,
 * each holding the corner square. Null for any other outline (a hip over it uses its bounding
 * rectangle).
 */
export function hipArms(roof: Pick<Roof, 'shape' | 'outline' | 'ridgeAngle'>): [Vec2[], Vec2[]] | null {
  if (roof.shape !== 'hip') return null;
  const hit = armsCache.get(roof as Roof);
  if (hit !== undefined) return hit;
  const f = roofFrame(roof);
  const toFrame = (p: Vec2) => ({ x: dot(p, f.u), y: dot(p, f.v) });
  const fromFrame = (q: Vec2) => add(scale(f.u, q.x), scale(f.v, q.y));
  let ring = cleanPositive(roof.outline.map(toFrame));
  // Drop corners on a straight run.
  ring = ring.filter((p, i) => Math.abs(cross(sub(p, ring[(i + ring.length - 1) % ring.length]), sub(ring[(i + 1) % ring.length], p))) > 1e-6);
  let out: [Vec2[], Vec2[]] | null = null;
  const square = ring.every((p, i) => {
    const q = ring[(i + 1) % ring.length];
    return Math.abs(p.x - q.x) < 1e-6 || Math.abs(p.y - q.y) < 1e-6;
  });
  if (ring.length === 6 && square) {
    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
    // The one corner of the bounding rectangle the L leaves out, and the reflex corner.
    const corners = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    const missing = corners.find((c) => !ring.some((p) => near(p.x, c.x) && near(p.y, c.y)));
    const reflex = ring.find((p) => !near(p.x, x0) && !near(p.x, x1) && !near(p.y, y0) && !near(p.y, y1));
    if (missing && reflex) {
      const rect = (a0: number, a1: number, b0: number, b1: number) => [fromFrame({ x: a0, y: b0 }), fromFrame({ x: a1, y: b0 }), fromFrame({ x: a1, y: b1 }), fromFrame({ x: a0, y: b1 })];
      const ax = near(missing.x, x1) ? [x0, reflex.x] : [reflex.x, x1];
      const by = near(missing.y, y1) ? [y0, reflex.y] : [reflex.y, y1];
      out = [cleanPositive(rect(ax[0], ax[1], y0, y1)), cleanPositive(rect(x0, x1, by[0], by[1]))];
    }
  }
  armsCache.set(roof as Roof, out);
  return out;
}

const armsCache = new WeakMap<Roof, [Vec2[], Vec2[]] | null>();

/** A convex polygon (every corner turning one way or straight). */
export function isConvex(poly: readonly Vec2[]): boolean {
  const n = poly.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const c = cross(sub(poly[(i + 1) % n], poly[i]), sub(poly[(i + 2) % n], poly[(i + 1) % n]));
    if (Math.abs(c) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

/**
 * A simple polygon as convex pieces, positive: itself when convex, else its triangles merged
 * across their shared diagonals while the union stays convex (Hertel-Mehlhorn).
 */
export function convexPieces(poly: readonly Vec2[]): Vec2[][] {
  const ring = cleanPositive(poly);
  if (ring.length < 3) return [];
  if (isConvex(ring)) return [ring];
  let pieces: number[][] = triangulate(ring).map((t) => [...t]);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const a = pieces[i];
        const b = pieces[j];
        // A shared edge: a has u -> v, b has v -> u.
        for (let k = 0; k < a.length; k++) {
          const u = a[k];
          const v = a[(k + 1) % a.length];
          const m = b.findIndex((x, l) => x === v && b[(l + 1) % b.length] === u);
          if (m < 0) continue;
          // a from v round to u, then b from u round to v (without the shared ends twice).
          const joined: number[] = [];
          for (let t = 0; t < a.length; t++) joined.push(a[(k + 1 + t) % a.length]);
          for (let t = 2; t < b.length; t++) joined.push(b[(m + t) % b.length]);
          if (!isConvex(joined.map((x) => ring[x]))) continue;
          pieces = pieces.filter((_, x) => x !== i && x !== j);
          pieces.push(joined);
          merged = true;
          break outer;
        }
      }
    }
  }
  return pieces.map((pc) => cleanPositive(pc.map((x) => ring[x])));
}

/** Convex `poly` clipped to convex `clip` (both any winding). */
export function clipConvex(poly: readonly Vec2[], clip: readonly Vec2[]): Vec2[] {
  const c = cleanPositive(clip);
  let out: Vec2[] = [...poly];
  for (let i = 0; i < c.length && out.length; i++) {
    const d = sub(c[(i + 1) % c.length], c[i]);
    const n = { x: d.y, y: -d.x }; // outward on a positive ring
    out = clipHalfPlane(out, n, dot(n, c[i]));
  }
  return out;
}

/** Convex `poly` less convex `hole`: convex pieces, positive (poly itself when they do not overlap). */
export function convexMinus(poly: readonly Vec2[], hole: readonly Vec2[]): Vec2[][] {
  const h = cleanPositive(hole);
  const out: Vec2[][] = [];
  let rest: Vec2[] = [...poly];
  if (!boxesMeet(poly, h)) return [cleanPositive(poly)];
  for (let i = 0; i < h.length; i++) {
    const d = sub(h[(i + 1) % h.length], h[i]);
    if (Math.hypot(d.x, d.y) < 1e-12) continue;
    const n = { x: d.y, y: -d.x };
    const k = dot(n, h[i]);
    const outside = clipHalfPlane(rest, scale(n, -1), -k);
    if (outside.length >= 3 && Math.abs(polygonSignedArea(outside)) > AREA_EPS) out.push(cleanPositive(outside));
    rest = clipHalfPlane(rest, n, k);
    if (rest.length < 3) return out;
  }
  // What is left is inside the hole.
  return out;
}

/** Pieces smaller than this (square inches) are slivers of the clipping and are dropped. */
const AREA_EPS = 1e-6;

function boxesMeet(p: readonly Vec2[], q: readonly Vec2[], pad = 1e-9): boolean {
  const b = (poly: readonly Vec2[]) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const v of poly) {
      x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y);
    }
    return { x0, y0, x1, y1 };
  };
  const a = b(p);
  const c = b(q);
  return a.x0 <= c.x1 + pad && c.x0 <= a.x1 + pad && a.y0 <= c.y1 + pad && c.y0 <= a.y1 + pad;
}

/** Convex pieces of `poly` less every convex hole in `holes`. */
export function convexMinusAll(poly: readonly Vec2[], holes: readonly (readonly Vec2[])[]): Vec2[][] {
  let pieces: Vec2[][] = [cleanPositive(poly)];
  for (const h of holes) {
    const next: Vec2[][] = [];
    for (const pc of pieces) next.push(...convexMinus(pc, h));
    pieces = next;
    if (!pieces.length) break;
  }
  return pieces.filter((pc) => pc.length >= 3 && Math.abs(polygonSignedArea(pc)) > AREA_EPS);
}

/**
 * One convex roof a roof is built from: the roof itself, or one arm of an L-shaped hip
 * (hipArms). `regions` are where each plane is the underside, in convex pieces of `grown`.
 */
export interface RoofSection {
  /** The outline it bears on and that grown by the overhang, positive. */
  base: Vec2[];
  grown: Vec2[];
  planes: RoofPlane[];
  regions: RoofRegion[];
  /** Convex pieces of `base`. */
  baseParts: Vec2[][];
}

const sectionCache = new WeakMap<Roof, Map<number, RoofSection[]>>();

/** The roof's sections at a bearing height (memoized per roof object and bearing). */
export function roofSections(roof: Roof, bearingHeight: number): RoofSection[] {
  let byBearing = sectionCache.get(roof);
  if (!byBearing) sectionCache.set(roof, (byBearing = new Map()));
  const hit = byBearing.get(bearingHeight);
  if (hit) return hit;
  const arms = hipArms(roof);
  const make = (base: Vec2[], grown: Vec2[], planes: RoofPlane[]): RoofSection => ({
    base,
    grown,
    planes,
    regions: convexPieces(grown).flatMap((g) => regionsOver(planes, g)),
    baseParts: convexPieces(base),
  });
  const out = arms
    ? arms.map((rect) => {
        const part: Roof = { ...roof, outline: rect };
        const grown = roof.overhang > 0 ? insetPolygon(rect, rect.map(() => -roof.overhang)) : rect;
        return make(rect, cleanPositive(grown), roofPlanes(part, bearingHeight));
      })
    : [make(roofBaseOutline(roof), roofOutlineWithOverhang(roof), roofPlanes(roof, bearingHeight))];
  byBearing.set(bearingHeight, out);
  return out;
}

/** `over` split into where each plane is the lowest (roofRegions over given planes). */
function regionsOver(planes: readonly RoofPlane[], over: readonly Vec2[]): RoofRegion[] {
  const out: RoofRegion[] = [];
  planes.forEach((pl, i) => {
    let poly: Vec2[] = [...over];
    for (let j = 0; j < planes.length && poly.length; j++) {
      if (j === i) continue;
      const o = planes[j];
      const n = { x: pl.gx - o.gx, y: pl.gy - o.gy };
      if (Math.hypot(n.x, n.y) < 1e-12) continue;
      poly = clipHalfPlane(poly, n, o.c - pl.c);
    }
    if (poly.length >= 3 && Math.abs(polygonSignedArea(poly)) > 1e-6) out.push({ plane: pl, poly: cleanPositive(poly) });
  });
  return out;
}

/** Where one plane is the underside: the overhang outline clipped to where it is the lowest. */
export interface RoofRegion {
  plane: RoofPlane;
  poly: Vec2[];
}

/** The overhang outline (or `over`) split into the regions where each plane is the underside. */
export function roofRegions(roof: Roof, bearingHeight: number, over: readonly Vec2[] = roofOutlineWithOverhang(roof)): RoofRegion[] {
  const planes = roofPlanes(roof, bearingHeight);
  const out: RoofRegion[] = [];
  planes.forEach((pl, i) => {
    let poly: Vec2[] = [...over];
    for (let j = 0; j < planes.length && poly.length; j++) {
      if (j === i) continue;
      const o = planes[j];
      const n = { x: pl.gx - o.gx, y: pl.gy - o.gy };
      if (Math.hypot(n.x, n.y) < 1e-12) continue;
      poly = clipHalfPlane(poly, n, o.c - pl.c);
    }
    if (poly.length >= 3 && Math.abs(polygonSignedArea(poly)) > 1e-6) out.push({ plane: pl, poly });
  });
  return out;
}

/** True when segment p-q lies on an edge of the polygon. */
function onPolygonEdge(p: Vec2, q: Vec2, poly: readonly Vec2[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (projectPointToSegment(p, a, b).distance < 1e-6 && projectPointToSegment(q, a, b).distance < 1e-6) return true;
  }
  return false;
}

/**
 * Ridge and hip lines (where two planes meet), over the overhang outline; for an L-shaped hip
 * (hipArms) the valley too. A roof joined to others (joinRoof) passes its regions as `join`: its
 * lines are then where it is drawn, with the valleys where it meets the others.
 */
export function roofRidgeLines(roof: Roof, join?: readonly JoinRegion[] | null): [Vec2, Vec2][] {
  const j = join ?? (hipArms(roof) ? joinRoof(roof, 0, []) : null);
  if (j) return joinedLines(roof, j);
  const over = roofOutlineWithOverhang(roof);
  const out: [Vec2, Vec2][] = [];
  const key = (p: Vec2) => `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)}`;
  const seen = new Set<string>();
  for (const r of roofRegions(roof, 0, over)) {
    for (let i = 0; i < r.poly.length; i++) {
      const p = r.poly[i];
      const q = r.poly[(i + 1) % r.poly.length];
      if (Math.hypot(q.x - p.x, q.y - p.y) < 1e-6 || onPolygonEdge(p, q, over)) continue;
      const k = [key(p), key(q)].sort().join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push([p, q]);
    }
  }
  return out;
}

/**
 * Underside heights (level-local): `ridge` is the highest point over the outline the roof bears on
 * (the ridge of a gable or hip, the high side of a shed), `eave` the lowest point of the overhang.
 */
export function roofExtremes(roof: Roof, bearingHeight: number): { ridge: number; eave: number } {
  if (hipArms(roof)) {
    // An L-shaped hip: the higher arm's ridge; the eave is the lowest corner of the overhang.
    let ridge = -Infinity;
    for (const sec of roofSections(roof, bearingHeight)) for (const r of regionsOver(sec.planes, sec.base)) for (const p of r.poly) ridge = Math.max(ridge, planeAt(r.plane, p));
    let eave = Infinity;
    for (const p of roofOutlineWithOverhang(roof)) eave = Math.min(eave, roofHeightAt(roof, bearingHeight, p) ?? Infinity);
    return { ridge: Number.isFinite(ridge) ? ridge : bearingHeight, eave: Number.isFinite(eave) ? eave : bearingHeight };
  }
  let ridge = -Infinity;
  for (const r of roofRegions(roof, bearingHeight, roofBaseOutline(roof))) for (const p of r.poly) ridge = Math.max(ridge, planeAt(r.plane, p));
  const planes = roofPlanes(roof, bearingHeight);
  let eave = Infinity;
  for (const p of roofOutlineWithOverhang(roof)) eave = Math.min(eave, planesHeightAt(planes, p));
  if (!Number.isFinite(ridge)) ridge = bearingHeight;
  if (!Number.isFinite(eave)) eave = bearingHeight;
  return { ridge, eave };
}

// ---------------------------------------------------------------------------------------------
// Solids

const samePoint = (p: Vec2, q: Vec2) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;

/** p inside triangle a-b-c (positive) or on its boundary. */
function inTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const e = 1e-9;
  return cross(sub(b, a), sub(p, a)) >= -e && cross(sub(c, b), sub(p, b)) >= -e && cross(sub(a, c), sub(p, c)) >= -e;
}

/**
 * Ear-clipping triangulation of a simple polygon with positive signed area. Vertices lying on an
 * edge (collinear runs) are kept as triangle corners, so the triangles share every boundary
 * vertex with the side faces. Returns index triples, each with positive area.
 */
export function triangulate(poly: readonly Vec2[]): [number, number, number][] {
  const idx = poly.map((_, i) => i);
  const tris: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 100000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length];
      const i1 = idx[k];
      const i2 = idx[(k + 1) % idx.length];
      const a = poly[i0];
      const b = poly[i1];
      const c = poly[i2];
      if (cross(sub(b, a), sub(c, b)) <= 1e-12) continue; // reflex or flat
      let blocked = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        const p = poly[j];
        if (samePoint(p, a) || samePoint(p, b) || samePoint(p, c)) continue;
        if (inTriangle(p, a, b, c)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      tris.push([i0, i1, i2]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Only flat or blocked corners left (a degenerate input): drop the flattest corner.
      let best = 0;
      let bestArea = Infinity;
      for (let k = 0; k < idx.length; k++) {
        const a = poly[idx[(k + idx.length - 1) % idx.length]];
        const b = poly[idx[k]];
        const c = poly[idx[(k + 1) % idx.length]];
        const area = Math.abs(cross(sub(b, a), sub(c, b)));
        if (area < bestArea) {
          bestArea = area;
          best = k;
        }
      }
      idx.splice(best, 1);
    }
  }
  if (idx.length === 3) {
    const [i0, i1, i2] = idx;
    if (cross(sub(poly[i1], poly[i0]), sub(poly[i2], poly[i1])) > 1e-12) tris.push([i0, i1, i2]);
  }
  return tris;
}

export interface SlopedPrismOptions {
  /** Emit the bottom / top surface. Default true. */
  bottom?: boolean;
  top?: boolean;
  /** Emit the side face of edge p -> q (edges of the positive ring). Default: every side. */
  side?: (p: Vec2, q: Vec2) => boolean;
}

type P3 = [number, number, number];

/**
 * A prism between two height fields over a plan polygon (any winding), like meshes.ts prism() but
 * with the bottom at zb(p) and the top at zt(p) per vertex: a planar slope when zb and zt are
 * affine over the polygon. Sides are vertical. Triangles are oriented outward (plan (x, y) maps to
 * three (x, Y, y)); zero-area triangles (a side of zero height at one end) are left out. Appends
 * positions to `out` and returns it.
 */
export function slopedPrismPositions(
  polygon: readonly Vec2[],
  zb: (p: Vec2) => number,
  zt: (p: Vec2) => number,
  { bottom = true, top = true, side }: SlopedPrismOptions = {},
  out: number[] = [],
): number[] {
  const ring = cleanPositive(polygon);
  if (ring.length < 3 || Math.abs(polygonSignedArea(ring)) < EPS) return out;
  const lo = ring.map(zb);
  const hi = ring.map(zt);
  const tri = (a: P3, b: P3, c: P3) => {
    const u: P3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v: P3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
    if (n > 1e-10) out.push(...a, ...b, ...c);
  };
  const at = (i: number, h: number): P3 => [ring[i].x, h, ring[i].y];
  if (bottom || top) {
    for (const [i, j, k] of triangulate(ring)) {
      // Positive in plan coordinates faces -Y: as is for the bottom, reversed for the top.
      if (bottom) tri(at(i, lo[i]), at(j, lo[j]), at(k, lo[k]));
      if (top) tri(at(i, hi[i]), at(k, hi[k]), at(j, hi[j]));
    }
  }
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    if (side && !side(ring[i], ring[j])) continue;
    if (hi[i] - lo[i] < 1e-9 && hi[j] - lo[j] < 1e-9) continue;
    const p0 = at(i, lo[i]);
    const q0 = at(j, lo[j]);
    const p1 = at(i, hi[i]);
    const q1 = at(j, hi[j]);
    tri(p0, q1, q0);
    tri(p0, p1, q1);
  }
  return out;
}

/**
 * A roof solid as position arrays (three coordinates, level-local): the slab, the boards, the
 * rafter tails and the ridge cap.
 */
export interface RoofSolid {
  slab: number[];
  /** Fascia boards along the eaves, rake boards along the sloped edges; each a closed solid. */
  boards: number[][];
  /** Rafter tails under open eaves (`eave: 'open'`); each a closed solid. */
  rafters: number[][];
  /**
   * The ridge cap of a metal gable or hip roof: a strip each side of every ridge and hip line on the
   * roof's top surface, closed together. Kept apart from the slab (meshes.ts merges it for drawing).
   */
  ridge: number[];
}

interface EdgeSeg {
  p: Vec2;
  q: Vec2;
  plane: RoofPlane;
  /** The planes of the section it is on (the roof's, or an L-shaped hip's arm). */
  planes?: RoofPlane[];
}

const samePt = (p: Vec2, q: Vec2) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;

/** An outline edge: its start, unit direction and length. */
interface OutlineEdge {
  a: Vec2;
  e: Vec2;
  len: number;
}

/**
 * The roof as closed solids. The slab: each plane's region of the overhang outline from the
 * underside up `thickness`, vertical faces around the outline, none along the ridge and hip lines
 * (the regions share them). Boards: along every outline stretch, 1.5" proud of the slab edge, top
 * flush with the roof's top surface, `fascia` deep; a level stretch (an eave) is a fascia board and
 * runs past a corner onto the next stretch's board line, a sloped stretch is a rake board. With
 * open eaves a level stretch the roof descends toward (its plane rises away from the edge) has
 * rafter tails under it instead of a board (rafterTails); a shed's high edge and every edge of a
 * flat roof keep their boards. A metal gable or hip roof has a ridge cap (ridgeCap).
 */
export function roofSolid(roof: Roof, bearingHeight: number, join?: readonly JoinRegion[] | null): RoofSolid {
  const over = roofOutlineWithOverhang(roof);
  const T = roof.thickness;
  const slab: number[] = [];
  let segs: EdgeSeg[] = [];
  const capped = isMetalRoof(roof.finish) && (roof.shape === 'gable' || roof.shape === 'hip');
  let ridge: number[] = [];
  const j = join ?? (hipArms(roof) ? joinRoof(roof, bearingHeight, []) : null);
  if (!j) {
    const regions = roofRegions(roof, bearingHeight, over);
    for (const r of regions) {
      const z = (p: Vec2) => planeAt(r.plane, p);
      slopedPrismPositions(r.poly, z, (p) => z(p) + T, { side: (p, q) => onPolygonEdge(p, q, over) }, slab);
      const ring = cleanPositive(r.poly);
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % ring.length];
        if (Math.hypot(q.x - p.x, q.y - p.y) > 1e-6 && onPolygonEdge(p, q, over)) segs.push({ p, q, plane: r.plane, planes: regions.map((x) => x.plane) });
      }
    }
    if (capped) ridge = ridgeCap(regions, over, T);
  } else {
    // A joined roof: what is left of each region once the others are cut out of it, each piece a
    // closed solid where it meets another piece or a cut (DESIGN.md "Roofs that meet").
    const pieces = keptPieces(j);
    segs = emitPieces(pieces, 0, T, slab).filter((e) => onPolygonEdge(e.p, e.q, over));
    if (capped) {
      // The cap runs along the lines where two drawn pieces of different slopes meet in a ridge or a
      // hip (not a valley, and not between two arms of an L-shaped hip lying in one plane).
      const bands: Piece[] = [];
      const innerOf = (r: RoofRegion, ring: Vec2[]) =>
        ring.map((p, k) => {
          const q = ring[(k + 1) % ring.length];
          if (dist(p, q) < 1e-6) return false;
          const d = normalize(sub(q, p));
          const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
          const outward = add(m, scale({ x: d.y, y: -d.x }, 1e-4));
          const inward = add(m, scale({ x: -d.y, y: d.x }, 1e-4));
          const across = pieces.find((o) => o.poly !== r.poly && insideOrOn(outward, o.poly));
          if (!across || coplanar(across.plane, r.plane)) return false;
          return planeAt(r.plane, inward) <= planeAt(across.plane, inward) + 1e-9;
        });
      ridgeCap(pieces, over, T, (poly, plane) => {
        for (const c of convexPieces(poly)) bands.push({ plane, poly: c });
      }, innerOf);
      emitPieces(bands, T, RIDGE_CAP_THICKNESS, ridge);
    }
  }
  const boards: number[][] = [];
  const rafters: number[][] = [];
  if (segs.length === 0) return { slab, boards, rafters, ridge };

  // Put the boundary stretches in ring order: by outline edge, then along it.
  let ordered: { s: EdgeSeg; edge: OutlineEdge }[] = [];
  const taken = new Set<EdgeSeg>();
  for (let e = 0; e < over.length; e++) {
    const a = over[e];
    const b = over[(e + 1) % over.length];
    const d = sub(b, a);
    const len2 = dot(d, d);
    if (len2 < 1e-12) continue;
    const on = segs.filter((s) => {
      const m = { x: (s.p.x + s.q.x) / 2, y: (s.p.y + s.q.y) / 2 };
      return projectPointToSegment(m, a, b).distance < 1e-6 && Math.abs(cross(d, sub(s.q, s.p))) / Math.sqrt(len2) < 1e-6 * Math.max(1, Math.hypot(s.q.x - s.p.x, s.q.y - s.p.y));
    });
    on.sort((s, t) => dot(sub(s.p, a), d) - dot(sub(t.p, a), d));
    const len = Math.sqrt(len2);
    for (const s of on) {
      if (taken.has(s)) continue;
      taken.add(s);
      ordered.push({ s, edge: { a, e: scale(d, 1 / len), len } });
    }
  }
  if (j) {
    // The pieces split a stretch where another piece meets it: join the runs back up.
    const merged: typeof ordered = [];
    for (const o of ordered) {
      const last = merged[merged.length - 1];
      if (last && last.edge === o.edge && last.s.plane === o.s.plane && samePt(last.s.q, o.s.p)) last.s = { ...last.s, q: o.s.q };
      else merged.push({ s: { ...o.s }, edge: o.edge });
    }
    ordered = merged;
  }
  const t = BOARD_THICKNESS;
  const F = roof.fascia;
  const open = roofEaveOf(roof) === 'open';
  const planes = segs[0].planes ?? [];
  const info = ordered.map(({ s, edge }) => {
    const d0 = sub(s.q, s.p);
    const len = Math.hypot(d0.x, d0.y);
    const d = scale(d0, 1 / len);
    const zp = planeAt(s.plane, s.p) + T;
    const zq = planeAt(s.plane, s.q) + T;
    const level = Math.abs(zq - zp) < 1e-6;
    // The roof descends toward the edge when its plane's gradient points inward, against the
    // outward normal (d.y, -d.x): an eave. Not a shed's high edge, nor any edge of a flat roof.
    const descends = level && s.plane.gx * d.y - s.plane.gy * d.x < -1e-9;
    return { ...s, d, len, zp, zq, level, edge, tails: open && descends };
  });
  info.forEach((s, i) => {
    if (s.tails) {
      rafterTails(roof, s, s.planes ?? planes, rafters, j ? cutsOf(j, s.plane) : []);
      return;
    }
    if (!(F > 0)) return;
    // The stretches either side, when they meet this one (a cut of a joined roof ends a stretch
    // with nothing after it: the board stops square there).
    const prevS = info[(i + info.length - 1) % info.length];
    const nextS = info[(i + 1) % info.length];
    const prev = samePt(prevS.q, s.p) ? prevS : { d: s.d, level: s.level };
    const next = samePt(s.q, nextS.p) ? nextS : { d: s.d, level: s.level };
    const turnIn = cross(prev.d, s.d);
    const turnOut = cross(s.d, next.d);
    let e0 = 0;
    let e1 = 0;
    if (s.level) {
      // Fascia: covers a convex corner at its end, and at its start when a rake board meets it.
      if (turnOut > 1e-6) e1 = t;
      if (turnIn > 1e-6 && !prev.level) e0 = t;
    }
    // A reflex corner: stop short so this board and the next do not overlap.
    if (turnOut < -1e-6) e1 = -t;
    if (s.len + e0 + e1 < 1e-6) return;
    const n = { x: s.d.y, y: -s.d.x }; // outward for a positive ring
    const p0 = sub(s.p, scale(s.d, e0));
    const q0 = add(s.q, scale(s.d, e1));
    const rise = (s.zq - s.zp) / s.len;
    const ztop = (x: Vec2) => s.zp + rise * dot(sub(x, s.p), s.d);
    const quad = [p0, q0, add(q0, scale(n, t)), add(p0, scale(n, t))];
    boards.push(slopedPrismPositions(quad, (x) => ztop(x) - F, ztop));
  });
  return { slab, boards, rafters, ridge };
}

/**
 * Rafter tails under an open eave stretch: RAFTER_WIDTH boxes every `spacing` measured along the
 * overhang outline edge the stretch lies on (the first half a spacing from the edge's start), each
 * kept when its centre falls in the stretch. A tail runs square to the edge from RAFTER_SETBACK
 * inside it back to the outline (the bearing walls' outside faces), with its top on the stretch's
 * plane (the slab's underside) and its bottom `depth` lower. Each is clipped to where its plane is
 * the lowest (the half-planes roofRegions uses), so a tail near a hip stays under its own slope.
 */
function rafterTails(roof: Roof, s: EdgeSeg & { edge: OutlineEdge }, planes: readonly RoofPlane[], out: number[][], cuts: readonly (readonly Vec2[])[] = []): void {
  const { depth, spacing } = rafterOf(roof);
  if (!(roof.overhang > RAFTER_SETBACK) || !(depth > 0) || !(spacing > 0)) return;
  const { a, e, len } = s.edge;
  const inward = { x: -e.y, y: e.x }; // right of travel on a positive ring
  const t0 = dot(sub(s.p, a), e);
  const t1 = dot(sub(s.q, a), e);
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  // Never closer than their own width (they would merge into one band).
  const step = Math.max(spacing, RAFTER_WIDTH);
  const at = (along: number, inside: number) => add(add(a, scale(e, along)), scale(inward, inside));
  const z = (p: Vec2) => planeAt(s.plane, p);
  const half = RAFTER_WIDTH / 2;
  for (let k = 0; (k + 0.5) * step <= len + 1e-6; k++) {
    const c = (k + 0.5) * step;
    // Half open, so a tail on the boundary between two stretches of one edge is made once.
    if (c < lo - 1e-6 || c >= hi - 1e-6) continue;
    let poly = [at(c - half, RAFTER_SETBACK), at(c + half, RAFTER_SETBACK), at(c + half, roof.overhang), at(c - half, roof.overhang)];
    for (const o of planes) {
      const n = { x: s.plane.gx - o.gx, y: s.plane.gy - o.gy };
      if (Math.hypot(n.x, n.y) < 1e-12) continue;
      poly = clipHalfPlane(poly, n, o.c - s.plane.c);
      if (!poly.length) break;
    }
    if (poly.length < 3 || Math.abs(polygonSignedArea(poly)) < 1e-6) continue;
    // A joined roof: no tail where the roof is cut away (under the roof it runs into).
    const parts = cuts.length ? convexMinusAll(poly, cuts) : [poly];
    for (const part of parts) out.push(slopedPrismPositions(part, (p) => z(p) - depth, z));
  }
}

/**
 * The ridge cap: in each region, a band RIDGE_CAP_WIDTH wide (in plan) along every run of its
 * ridge and hip lines (region edges inside the overhang outline), from the roof's top surface up
 * RIDGE_CAP_THICKNESS, so it follows the slope on each side. The band's inner edge is each line
 * moved into the region: mitred where two lines meet (a hip and the ridge), cut along the outline
 * where a line reaches it. The faces along the lines are left out (the band on the other side
 * shares them), so the bands together are one closed surface. A region too small to hold its band
 * gets none.
 */
function ridgeCap(
  regions: readonly RoofRegion[],
  over: readonly Vec2[],
  T: number,
  collect?: (band: Vec2[], plane: RoofPlane) => void,
  innerOf?: (r: RoofRegion, ring: Vec2[]) => boolean[],
): number[] {
  const out: number[] = [];
  const W = RIDGE_CAP_WIDTH;
  for (const r of regions) {
    const ring = cleanPositive(r.poly);
    const n = ring.length;
    if (n < 3) continue;
    const next = (i: number) => ring[(i + 1) % n];
    const inner = innerOf ? innerOf(r, ring) : ring.map((p, i) => dist(p, next(i)) > 1e-6 && !onPolygonEdge(p, next(i), over));
    if (!inner.some(Boolean) || inner.every(Boolean)) continue;
    // Edge i's line moved `off` into the region (right of travel on a positive ring).
    const line = (i: number, off: number) => {
      const d = normalize(sub(next(i), ring[i]));
      const inward = { x: -d.y, y: d.x };
      return { p: add(ring[i], scale(inward, off)), d, inward };
    };
    for (let first = 0; first < n; first++) {
      if (!inner[first] || inner[(first + n - 1) % n]) continue;
      // The run of ridge and hip edges first, first + 1, ... up to the next outline edge.
      let m = 0;
      while (inner[(first + m) % n]) m++;
      const vs: Vec2[] = [];
      for (let j = 0; j <= m; j++) vs.push(ring[(first + j) % n]);
      // The inner edge's corners: where the lines either side of each vertex meet once moved in.
      const ws = vs.map((v, j) => {
        const before = (first + j - 1 + n) % n;
        const after = (first + j) % n;
        const lb = line(before, inner[before] ? W : 0);
        const la = line(after, inner[after] ? W : 0);
        const w = lineIntersection(lb.p, lb.d, la.p, la.d);
        // Parallel lines (a straight run), or a mitre that runs far off: square to the line.
        if (w && dist(w, v) <= 4 * W) return w;
        return add(v, scale((inner[after] ? la : lb).inward, W));
      });
      if (!ws.every((w) => insideOrOn(w, ring))) continue;
      const onRun = (p: Vec2, q: Vec2) => {
        for (let j = 0; j < m; j++) {
          if (projectPointToSegment(p, vs[j], vs[j + 1]).distance < 1e-6 && projectPointToSegment(q, vs[j], vs[j + 1]).distance < 1e-6) return true;
        }
        return false;
      };
      if (collect) {
        collect([...vs, ...[...ws].reverse()], r.plane);
        continue;
      }
      const zb = (p: Vec2) => planeAt(r.plane, p) + T;
      slopedPrismPositions([...vs, ...[...ws].reverse()], zb, (p) => zb(p) + RIDGE_CAP_THICKNESS, { side: (p, q) => !onRun(p, q) }, out);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Roofs that meet (DESIGN.md "Roofs that meet")

/** Another roof a roof is joined against, its heights in the joined roof's level-local frame. */
export interface JoinOther {
  roof: Roof;
  /** Its bearing height in the joined roof's frame. */
  bearing: number;
  /** True when this one is drawn where the two coincide exactly (the earlier roof). */
  wins: boolean;
}

/**
 * A region of a joined roof: a convex piece of the overhang outline where `plane` is the underside,
 * and the convex `cuts` out of it where the roof is not drawn because another roof (or the other
 * arm of an L-shaped hip) is drawn there instead. `planes` are the planes of its section.
 */
export interface JoinRegion {
  plane: RoofPlane;
  poly: Vec2[];
  cuts: Vec2[][];
  planes: RoofPlane[];
}

interface Piece {
  plane: RoofPlane;
  poly: Vec2[];
  planes?: RoofPlane[];
}

/**
 * Trim a roof against the roofs it meets: the upper envelope of the solids. In each region, the
 * roof is cut away where another roof's top is higher and either the two slabs overlap in height
 * there, or the point is inside the other roof's bearing outline (over its walls). An overhang that passes clear under another roof's overhang is left whole, and roofs that
 * only touch along an edge are not changed. The two arms of an L-shaped hip are one surface: the
 * lower is cut wherever they overlap. Where two tops coincide exactly the one that `wins` is kept.
 * Null when nothing is cut and the roof is not an L-shaped hip (draw it whole, roofSolid).
 */
export function joinRoof(roof: Roof, bearing: number, others: readonly JoinOther[]): JoinRegion[] | null {
  const own = roofSections(roof, bearing);
  const T = roof.thickness;
  interface Rival {
    sec: RoofSection;
    T: number;
    same: boolean;
    wins: boolean;
  }
  const out: JoinRegion[] = [];
  let any = own.length > 1;
  own.forEach((sec, si) => {
    const rivals: Rival[] = [];
    own.forEach((o, oi) => {
      if (oi !== si) rivals.push({ sec: o, T, same: true, wins: oi < si });
    });
    for (const o of others) for (const os of roofSections(o.roof, o.bearing)) rivals.push({ sec: os, T: o.roof.thickness, same: false, wins: o.wins });
    for (const r of sec.regions) {
      const cuts: Vec2[][] = [];
      const push = (poly: Vec2[]) => {
        if (poly.length >= 3 && Math.abs(polygonSignedArea(poly)) > AREA_EPS) cuts.push(cleanPositive(poly));
      };
      const a = r.plane;
      for (const q of rivals) {
        if (!boxesMeet(r.poly, q.sec.grown)) continue;
        for (const sr of q.sec.regions) {
          let x = clipConvex(r.poly, sr.poly);
          if (x.length < 3 || Math.abs(polygonSignedArea(x)) <= AREA_EPS) continue;
          const b = sr.plane;
          // Where this top is below the other's: a + T <= b + T' (n . p <= c).
          const n = { x: a.gx - b.gx, y: a.gy - b.gy };
          const c = b.c - a.c + q.T - T;
          if (Math.hypot(n.x, n.y) < 1e-12) {
            if (!(Math.abs(c) < 1e-6 ? q.wins : c > 0)) continue;
          } else {
            x = clipHalfPlane(x, n, c);
            if (x.length < 3) continue;
          }
          if (q.same) {
            push(x);
            continue;
          }
          // The slabs overlap in height: the other's underside below this top (b < a + T).
          const m = { x: -n.x, y: -n.y };
          const lim = a.c + T - b.c - 1e-6;
          if (Math.hypot(m.x, m.y) < 1e-12) {
            if (lim > 0) push(x);
          } else push(clipHalfPlane(x, m, lim));
          // Over the other's walls: inside its bearing outline (a porch roof run into the wall of the
          // storey above, a wing's overhang into the main house).
          for (const k of q.sec.baseParts) push(clipConvex(x, k));
        }
      }
      if (cuts.length) any = true;
      out.push({ plane: a, poly: r.poly, cuts, planes: sec.planes });
    }
  });
  return any ? out : null;
}

/**
 * What is drawn of a joined roof: each region less its cuts, in convex pieces, each with the corners
 * of its neighbours that lie on its sides (withTJunctions).
 */
function keptPieces(join: readonly JoinRegion[]): Piece[] {
  const out: Piece[] = [];
  for (const r of join) for (const poly of r.cuts.length ? convexMinusAll(r.poly, r.cuts) : [cleanPositive(r.poly)]) out.push({ plane: r.plane, poly, planes: r.planes });
  const rings = withTJunctions(out.map((pc) => pc.poly));
  return out.map((pc, i) => ({ ...pc, poly: rings[i] }));
}

/** Two planes that are one (an L-shaped hip's arms share their outer slopes). */
const coplanar = (a: RoofPlane, b: RoofPlane) => Math.abs(a.c - b.c) < 1e-6 && Math.abs(a.gx - b.gx) < 1e-9 && Math.abs(a.gy - b.gy) < 1e-9;

/** The cuts of every region of a plane (the plane objects are shared, roofSections). */
function cutsOf(join: readonly JoinRegion[], plane: RoofPlane): Vec2[][] {
  const out: Vec2[][] = [];
  for (const r of join) if (r.plane === plane) out.push(...r.cuts);
  return out;
}

/**
 * True where a plan point is under a part of the roof that is drawn: inside or on a region and not
 * inside or on any of its cuts (a point on a cut's edge, a valley, counts as cut).
 */
export function joinedCovers(join: readonly JoinRegion[], p: Vec2): boolean {
  for (const r of join) {
    if (!insideOrOn(p, r.poly)) continue;
    if (!r.cuts.some((c) => insideOrOn(p, c))) return true;
  }
  return false;
}

/** Each ring with the corners of the others that lie on its sides put in (no T-junctions). */
function withTJunctions(rings: readonly Vec2[][]): Vec2[][] {
  const all = rings.flat();
  return rings.map((ring) => {
    const out: Vec2[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      out.push(a);
      const d = sub(b, a);
      const len2 = dot(d, d);
      if (len2 < 1e-12) continue;
      const on: { t: number; v: Vec2 }[] = [];
      for (const v of all) {
        const t = dot(sub(v, a), d) / len2;
        if (t <= 1e-9 || t >= 1 - 1e-9) continue;
        if (Math.abs(cross(d, sub(v, a))) / Math.sqrt(len2) > 1e-6) continue;
        if (samePt(v, a) || samePt(v, b)) continue;
        on.push({ t, v });
      }
      on.sort((p, q) => p.t - q.t);
      for (const o of on) if (!samePt(o.v, out[out.length - 1])) out.push(o.v);
    }
    return cleanPositive(out);
  });
}

/**
 * The pieces as one closed solid: each from its plane + `lift` up `thick`, with a side face on each
 * stretch of its edge that no other piece lies beyond. Returns those outside stretches.
 */
function emitPieces(pieces: readonly Piece[], lift: number, thick: number, out: number[]): EdgeSeg[] {
  const rings = withTJunctions(pieces.map((pc) => cleanPositive(pc.poly)));
  const exterior: EdgeSeg[] = [];
  const outside = (p: Vec2, q: Vec2, self: number) => {
    const d = normalize(sub(q, p));
    const x = add({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, scale({ x: d.y, y: -d.x }, 1e-4));
    return !rings.some((r, i) => i !== self && insideOrOn(x, r));
  };
  rings.forEach((ring, i) => {
    const pl = pieces[i].plane;
    const z = (p: Vec2) => planeAt(pl, p) + lift;
    slopedPrismPositions(ring, z, (p) => z(p) + thick, { side: (p, q) => outside(p, q, i) }, out);
    for (let k = 0; k < ring.length; k++) {
      const p = ring[k];
      const q = ring[(k + 1) % ring.length];
      if (dist(p, q) > 1e-6 && outside(p, q, i)) exterior.push({ p, q, plane: pl, planes: pieces[i].planes });
    }
  });
  return exterior;
}

/** A joined roof's lines on the plan: where two of its planes meet, and where it is cut (the valleys). */
function joinedLines(roof: Roof, join: readonly JoinRegion[]): [Vec2, Vec2][] {
  const over = roofOutlineWithOverhang(roof);
  const pieces = keptPieces(join);
  const rings = pieces.map((pc) => pc.poly);
  const out: [Vec2, Vec2][] = [];
  const key = (p: Vec2) => `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)}`;
  const seen = new Set<string>();
  rings.forEach((ring, i) => {
    for (let k = 0; k < ring.length; k++) {
      const p = ring[k];
      const q = ring[(k + 1) % ring.length];
      if (dist(p, q) < 1e-6 || onPolygonEdge(p, q, over)) continue;
      const d = normalize(sub(q, p));
      const x = add({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, scale({ x: d.y, y: -d.x }, 1e-4));
      const across = rings.findIndex((r, j) => j !== i && insideOrOn(x, r));
      // Inside one plane (between two pieces of it): no line.
      if (across >= 0 && coplanar(pieces[across].plane, pieces[i].plane)) continue;
      const kk = [key(p), key(q)].sort().join('|');
      if (seen.has(kk)) continue;
      seen.add(kk);
      out.push([p, q]);
    }
  });
  return mergeCollinear(out);
}

/** Segments that continue one another in a straight line, joined. */
function mergeCollinear(segs: [Vec2, Vec2][]): [Vec2, Vec2][] {
  const out = segs.map((s) => [s[0], s[1]] as [Vec2, Vec2]);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length && !changed; i++) {
      for (let j = i + 1; j < out.length && !changed; j++) {
        const [a, b] = out[i];
        for (const [c, d] of [out[j], [out[j][1], out[j][0]] as [Vec2, Vec2]]) {
          const ab = sub(b, a);
          if (samePt(b, c) && Math.abs(cross(normalize(ab), normalize(sub(d, c)))) < 1e-9 && dot(ab, sub(d, c)) > 0) {
            out[i] = [a, d];
            out.splice(j, 1);
            changed = true;
            break;
          }
          if (samePt(a, d) && Math.abs(cross(normalize(ab), normalize(sub(d, c)))) < 1e-9 && dot(ab, sub(d, c)) > 0) {
            out[i] = [c, b];
            out.splice(j, 1);
            changed = true;
            break;
          }
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Walls under a roof

/** A roof on a level with its bearing height (level-local). */
export interface RoofOnLevel {
  roof: Roof;
  bearing: number;
  /** Its regions when it is joined to the roofs it meets (joinRoof); absent or null: whole. */
  join?: readonly JoinRegion[] | null;
}

/** A wall's top as a polyline over its centerline position `s` (from the wall's a end). */
export interface WallProfile {
  s: number[];
  h: number[];
}

/** What wallRoofProfile needs of a wall footprint. */
export interface WallLine {
  a: Vec2;
  dir: Vec2;
  normal: Vec2;
  thickness: number;
  length: number;
  poly: readonly Vec2[];
}

/** Height of a profile at s (linear between stations, extended at the ends). */
export function profileAt(pr: WallProfile, s: number): number {
  const { s: xs, h } = pr;
  if (xs.length === 1) return h[0];
  let i = 0;
  while (i < xs.length - 2 && s > xs[i + 1]) i++;
  const t = (s - xs[i]) / (xs[i + 1] - xs[i]);
  return h[i] + (h[i + 1] - h[i]) * t;
}

/**
 * The top of a wall under the roofs of its level: max(base, the lowest covering roof's underside),
 * sampled along the wall's outside face (the face nearer the roof outline's edge, which an
 * exterior wall's outside face lies on), at the ends of the wall's outline and at every point where
 * the profile bends (ridge and hip crossings, and where the roof rises above the plate). A roof
 * covers the wall when the middle of its centerline is inside the outline the roof bears on. Null
 * when no roof raises the wall above `base`: an eave wall, whose outside face is on the eave line,
 * stays at the plate.
 */
export function wallRoofProfile(fp: WallLine, base: number, roofs: readonly RoofOnLevel[], caps: readonly RoofOnLevel[] = []): WallProfile | null {
  if (roofs.length === 0 || !(fp.length > 0)) return null;
  const mid = add(fp.a, scale(fp.dir, fp.length / 2));
  let smin = Infinity;
  let smax = -Infinity;
  for (const p of fp.poly) {
    const s = dot(sub(p, fp.a), fp.dir);
    smin = Math.min(smin, s);
    smax = Math.max(smax, s);
  }
  if (!(smax - smin > 1e-9)) return null;
  const half = fp.thickness / 2;
  // Each covering roof's planes along the wall's outside face, as lines h = a + b * s.
  const groups: { a: number; b: number }[][] = [];
  const covering = new Set<Roof>();
  // The planes of the roof's sections over p (an L-shaped hip has two), as lines along the face.
  const planesOver = (roof: Roof, bearing: number, p: Vec2) => {
    const secs = roofSections(roof, bearing);
    return secs.length === 1 ? secs[0].planes : secs.filter((sc) => insideOrOn(p, sc.grown)).flatMap((sc) => sc.planes);
  };
  for (const { roof, bearing, join } of roofs) {
    const outline = roofBaseOutline(roof);
    if (outline.length < 3 || !pointInPolygon(mid, outline) || distanceToBoundary(mid, outline) < 1e-6) continue;
    // A joined roof covers the wall only where it is drawn (not where another roof is instead).
    if (join && !joinedCovers(join, mid)) continue;
    covering.add(roof);
    const left = add(mid, scale(fp.normal, half));
    const right = sub(mid, scale(fp.normal, half));
    const side = distanceToBoundary(left, outline) <= distanceToBoundary(right, outline) ? 1 : -1;
    const origin = add(fp.a, scale(fp.normal, side * half));
    groups.push(planesOver(roof, bearing, mid).map((pl) => ({ a: planeAt(pl, origin), b: pl.gx * fp.dir.x + pl.gy * fp.dir.y })));
  }
  if (groups.length === 0) return null;
  // Another roof of the building over the whole wall, above its plate: the wall stops under it too,
  // so a wall that rises to its own roof does not come up through a roof that passes over it.
  const end = add(fp.a, scale(fp.dir, fp.length));
  for (const { roof, bearing, join } of caps) {
    if (covering.has(roof)) continue;
    const over = (p: Vec2) => (join ? joinedCovers(join, p) : insideOrOn(p, roofOutlineWithOverhang(roof)));
    if (![fp.a, mid, end].every((p) => over(p) && distanceToBoundary(p, roofOutlineWithOverhang(roof)) > 1e-6)) continue;
    const under = roofHeightAt(roof, bearing, mid);
    if (under === null || !(under > base + 1e-6)) continue;
    groups.push(planesOver(roof, bearing, mid).map((pl) => ({ a: planeAt(pl, fp.a), b: pl.gx * fp.dir.x + pl.gy * fp.dir.y })));
  }
  const g = (s: number) => {
    let v = Infinity;
    for (const gr of groups) for (const l of gr) v = Math.min(v, l.a + l.b * s);
    return v - base < 1e-6 ? base : v;
  };
  const lines = [{ a: base, b: 0 }, ...groups.flat()];
  const cand = [smin, smax];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const db = lines[i].b - lines[j].b;
      if (Math.abs(db) < 1e-12) continue;
      const s = (lines[j].a - lines[i].a) / db;
      if (s > smin + 1e-6 && s < smax - 1e-6) cand.push(s);
    }
  }
  cand.sort((p, q) => p - q);
  const xs: number[] = [];
  for (const s of cand) if (!xs.length || s - xs[xs.length - 1] > 1e-6) xs.push(s);
  const hs = xs.map(g);
  if (Math.max(...hs) <= base + 1e-6) return null;
  // Keep the ends and the bends only.
  const s: number[] = [xs[0]];
  const h: number[] = [hs[0]];
  for (let i = 1; i + 1 < xs.length; i++) {
    const before = (hs[i] - h[h.length - 1]) / (xs[i] - s[s.length - 1]);
    const after = (hs[i + 1] - hs[i]) / (xs[i + 1] - xs[i]);
    if (Math.abs(before - after) > 1e-9) {
      s.push(xs[i]);
      h.push(hs[i]);
    }
  }
  s.push(xs[xs.length - 1]);
  h.push(hs[hs.length - 1]);
  return { s, h };
}
