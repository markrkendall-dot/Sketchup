import { add, clipHalfPlane, cross, dist, dot, lineIntersection, normalize, pointInPolygon, polygonSignedArea, projectPointToSegment, scale, sub } from '../model/geometry';
import { rafterOf, roofEaveOf } from '../model/finish';
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
    if (roof.shape === 'hip') {
      // Hip roofs are built over the outline's bounding rectangle in the ridge frame.
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
 * roof its bounding rectangle in the ridge frame.
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
  return planesHeightAt(roofPlanes(roof, bearingHeight), p);
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

/** Ridge and hip lines (where two planes meet), over the overhang outline. */
export function roofRidgeLines(roof: Roof): [Vec2, Vec2][] {
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
}

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
export function roofSolid(roof: Roof, bearingHeight: number): RoofSolid {
  const over = roofOutlineWithOverhang(roof);
  const regions = roofRegions(roof, bearingHeight, over);
  const T = roof.thickness;
  const slab: number[] = [];
  const segs: EdgeSeg[] = [];
  for (const r of regions) {
    const z = (p: Vec2) => planeAt(r.plane, p);
    slopedPrismPositions(r.poly, z, (p) => z(p) + T, { side: (p, q) => onPolygonEdge(p, q, over) }, slab);
    const ring = cleanPositive(r.poly);
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      if (Math.hypot(q.x - p.x, q.y - p.y) > 1e-6 && onPolygonEdge(p, q, over)) segs.push({ p, q, plane: r.plane });
    }
  }
  const ridge = roof.finish === 'metal' && (roof.shape === 'gable' || roof.shape === 'hip') ? ridgeCap(regions, over, T) : [];
  const boards: number[][] = [];
  const rafters: number[][] = [];
  if (segs.length === 0) return { slab, boards, rafters, ridge };

  // Put the boundary stretches in ring order: by outline edge, then along it.
  const ordered: { s: EdgeSeg; edge: OutlineEdge }[] = [];
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
  const t = BOARD_THICKNESS;
  const F = roof.fascia;
  const open = roofEaveOf(roof) === 'open';
  const planes = regions.map((r) => r.plane);
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
      rafterTails(roof, s, planes, rafters);
      return;
    }
    if (!(F > 0)) return;
    const prev = info[(i + info.length - 1) % info.length];
    const next = info[(i + 1) % info.length];
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
function rafterTails(roof: Roof, s: EdgeSeg & { edge: OutlineEdge }, planes: readonly RoofPlane[], out: number[][]): void {
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
    out.push(slopedPrismPositions(poly, (p) => z(p) - depth, z));
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
function ridgeCap(regions: readonly RoofRegion[], over: readonly Vec2[], T: number): number[] {
  const out: number[] = [];
  const W = RIDGE_CAP_WIDTH;
  for (const r of regions) {
    const ring = cleanPositive(r.poly);
    const n = ring.length;
    if (n < 3) continue;
    const next = (i: number) => ring[(i + 1) % n];
    const inner = ring.map((p, i) => dist(p, next(i)) > 1e-6 && !onPolygonEdge(p, next(i), over));
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
      const zb = (p: Vec2) => planeAt(r.plane, p) + T;
      slopedPrismPositions([...vs, ...[...ws].reverse()], zb, (p) => zb(p) + RIDGE_CAP_THICKNESS, { side: (p, q) => !onRun(p, q) }, out);
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
export function wallRoofProfile(fp: WallLine, base: number, roofs: readonly RoofOnLevel[]): WallProfile | null {
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
  for (const { roof, bearing } of roofs) {
    const outline = roofBaseOutline(roof);
    if (outline.length < 3 || !pointInPolygon(mid, outline) || distanceToBoundary(mid, outline) < 1e-6) continue;
    const left = add(mid, scale(fp.normal, half));
    const right = sub(mid, scale(fp.normal, half));
    const side = distanceToBoundary(left, outline) <= distanceToBoundary(right, outline) ? 1 : -1;
    const origin = add(fp.a, scale(fp.normal, side * half));
    groups.push(roofPlanes(roof, bearing).map((pl) => ({ a: planeAt(pl, origin), b: pl.gx * fp.dir.x + pl.gy * fp.dir.y })));
  }
  if (groups.length === 0) return null;
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
