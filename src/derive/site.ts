import { boundsOf, clipHalfPlane, cross, pointInPolygon, polygonSignedArea, sub, type Bounds } from '../model/geometry';
import type { Column, Id, Plan, Site, Vec2, ViewMode } from '../model/types';
import { getLevelElevations } from './levels';
import { isVisible, phasesCoexist } from './phase';
import { roofBearing, roofExtremes, roofHeightAt, triangulate } from './roofs';
import { getFaces, slabOutlines } from './rooms';

// The site (DESIGN.md "Site and terrain"). Pure: no three, no React, so the 2D editor can use it
// without loading the 3D chunk; derive/meshes.ts wraps the grid in a BufferGeometry.
//
// Grade points are spot elevations of the ground. The terrain is the triangulated surface through
// them (a TIN: linear over the Delaunay triangles of the points, level beyond their hull), sampled
// on a coarse grid around the plan; columns (chimneys, posts) are boxes standing on it.

/** Grid cell size of the terrain. */
export const TERRAIN_STEP = 24;
/** The terrain extends this far beyond the plan's bounds on every side (100'). */
export const TERRAIN_MARGIN = 1200;
/** How far the terrain's skirt reaches below its lowest edge vertex. */
export const TERRAIN_SKIRT_DROP = 12;
/** The grid never has more cells than this along either axis; larger sites get a coarser step. */
export const TERRAIN_MAX_CELLS = 200;
/** A sample closer than this to a grade point takes that point's elevation exactly. */
export const GRADE_SNAP = 1;

/** The sun's height and distance in the 3D view (inches); its direction in plan is fixed by the north angle. */
const SUN_HEIGHT = 1600;
const SUN_PLAN = { x: -700, y: 1100 };

/**
 * Width and depth of a new chimney / post / flue / pier; how far the chimney stands below grade and
 * above the ridge; a flue (a stove's pipe) starts at a stove top over the first floor and stands 2'
 * over the ridge; a pier (fieldstone) stands on the ground up to the first floor.
 */
export const COLUMN_DEFAULTS = {
  chimney: { width: 24, depth: 40, belowGrade: 12, aboveRidge: 48 },
  post: { width: 6, depth: 6 },
  flue: { width: 8, depth: 8, aboveFloor: 30, aboveRidge: 24 },
  pier: { width: 16, depth: 16, height: 24 },
} as const;

/** Sides of the polygon a round flue is drawn with. */
export const FLUE_SIDES = 24;

const ROTATE = (p: Vec2, deg: number): Vec2 => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

// ---------------------------------------------------------------------------------------------
// Terrain

/**
 * The ground's elevation at p: linear over the Delaunay triangle of grade points that contains p,
 * and beyond the points' hull the hull's elevation at the nearest point of its edge, so the ground
 * between two points is the straight line between them and three points at one height make a
 * level plane (no pull toward distant points). Within GRADE_SNAP of a grade point the result is
 * exactly that point's elevation; with no points it is `fallback` (flat ground), with one it is
 * level at it, and with points that do not span an area (all in a line) it is their
 * inverse-distance (power 2) average.
 */
export function terrainHeightAt(site: Pick<Site, 'gradePoints'>, p: Vec2, fallback: number): number {
  const points = Object.values(site.gradePoints);
  if (points.length < 3) return idw(points, p.x, p.y, fallback);
  return tinHeight(tinOf(site.gradePoints), points, p.x, p.y, fallback);
}

/** A triangulated irregular network: the grade points, their Delaunay triangles and the edges on the hull. */
export interface Tin {
  pts: { x: number; y: number; z: number }[];
  /** Counter-clockwise in plan maths (positive area), by index into pts. */
  tris: [number, number, number][];
  /** The edges that belong to one triangle only: the hull. */
  hull: [number, number][];
}

/**
 * Delaunay triangulation of the grade points (Bowyer-Watson in a super triangle far larger than the
 * points). A point within GRADE_SNAP of one already in is left out. Triangles touching the super
 * triangle are dropped, and the edges of the rest that only one triangle uses are the hull (which
 * the height outside follows, convex or not).
 */
export function delaunay(points: readonly { at: Vec2; elevation: number }[]): Tin {
  const pts: Tin['pts'] = [];
  for (const g of points) {
    if (pts.some((q) => (q.x - g.at.x) ** 2 + (q.y - g.at.y) ** 2 <= GRADE_SNAP * GRADE_SNAP)) continue;
    pts.push({ x: g.at.x, y: g.at.y, z: g.elevation });
  }
  const n = pts.length;
  if (n < 3) return { pts, tris: [], hull: [] };
  const b = boundsOf(pts)!;
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const all = [...pts, { x: cx - 100 * span, y: cy - 100 * span, z: 0 }, { x: cx + 100 * span, y: cy - 100 * span, z: 0 }, { x: cx, y: cy + 100 * span, z: 0 }];
  type T = { a: number; b: number; c: number; ox: number; oy: number; r2: number };
  const circum = (a: number, bi: number, c: number): T => {
    const A = all[a];
    const B = all[bi];
    const C = all[c];
    const d = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
    const a2 = A.x * A.x + A.y * A.y;
    const b2 = B.x * B.x + B.y * B.y;
    const c2 = C.x * C.x + C.y * C.y;
    const ox = (a2 * (B.y - C.y) + b2 * (C.y - A.y) + c2 * (A.y - B.y)) / d;
    const oy = (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / d;
    return { a, b: bi, c, ox, oy, r2: (A.x - ox) ** 2 + (A.y - oy) ** 2 };
  };
  let tris: T[] = [circum(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const p = all[i];
    const bad: T[] = [];
    const keep: T[] = [];
    for (const t of tris) ((p.x - t.ox) ** 2 + (p.y - t.oy) ** 2 < t.r2 * (1 - 1e-12) ? bad : keep).push(t);
    // The cavity's boundary: the edges of exactly one bad triangle.
    const edges = new Map<string, [number, number]>();
    for (const t of bad) {
      for (const [u, v] of [
        [t.a, t.b],
        [t.b, t.c],
        [t.c, t.a],
      ]) {
        const k = u < v ? `${u},${v}` : `${v},${u}`;
        if (edges.has(k)) edges.delete(k);
        else edges.set(k, [u, v]);
      }
    }
    for (const [u, v] of edges.values()) {
      const area = cross(sub(all[v], all[u]), sub(p, all[u]));
      if (Math.abs(area) > 1e-9) keep.push(circum(u, v, i));
    }
    tris = keep;
  }
  const out: Tin['tris'] = [];
  for (const t of tris) {
    if (t.a >= n || t.b >= n || t.c >= n) continue;
    const area = cross(sub(pts[t.b], pts[t.a]), sub(pts[t.c], pts[t.a]));
    if (Math.abs(area) < 1e-9) continue;
    out.push(area > 0 ? [t.a, t.b, t.c] : [t.a, t.c, t.b]);
  }
  const count = new Map<string, [number, number] | null>();
  for (const [a, bi, c] of out) {
    for (const [u, v] of [
      [a, bi],
      [bi, c],
      [c, a],
    ] as [number, number][]) {
      const k = u < v ? `${u},${v}` : `${v},${u}`;
      count.set(k, count.has(k) ? null : [u, v]);
    }
  }
  const hull = [...count.values()].filter((e): e is [number, number] => e !== null);
  return { pts, tris: out, hull };
}

const tinCache = new WeakMap<Site['gradePoints'], Tin>();

/** The grade points' triangulation, made once per grade-point record (a grade edit replaces the record). */
function tinOf(gradePoints: Site['gradePoints']): Tin {
  let t = tinCache.get(gradePoints);
  if (!t) tinCache.set(gradePoints, (t = delaunay(Object.values(gradePoints))));
  return t;
}

/** The TIN's height at (x, y); points that span no triangle fall back to the weighted average. */
function tinHeight(tin: Tin, points: readonly { at: Vec2; elevation: number }[], x: number, y: number, fallback: number): number {
  for (const q of tin.pts) if ((q.x - x) ** 2 + (q.y - y) ** 2 <= GRADE_SNAP * GRADE_SNAP) return q.z;
  if (!tin.tris.length) return idw(points, x, y, fallback);
  const { pts } = tin;
  for (const [a, b, c] of tin.tris) {
    const A = pts[a];
    const B = pts[b];
    const C = pts[c];
    const d = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
    const wa = ((B.y - C.y) * (x - C.x) + (C.x - B.x) * (y - C.y)) / d;
    const wb = ((C.y - A.y) * (x - C.x) + (A.x - C.x) * (y - C.y)) / d;
    const wc = 1 - wa - wb;
    if (wa >= -1e-9 && wb >= -1e-9 && wc >= -1e-9) return wa * A.z + wb * B.z + wc * C.z;
  }
  // Outside the hull: level with the nearest point of its edge.
  let best = Infinity;
  let z = fallback;
  for (const [a, b] of tin.hull) {
    const A = pts[a];
    const B = pts[b];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const t = Math.max(0, Math.min(1, ((x - A.x) * dx + (y - A.y) * dy) / (dx * dx + dy * dy)));
    const d2 = (A.x + t * dx - x) ** 2 + (A.y + t * dy - y) ** 2;
    if (d2 < best) {
      best = d2;
      z = A.z + t * (B.z - A.z);
    }
  }
  return z;
}

function idw(points: readonly { at: Vec2; elevation: number }[], x: number, y: number, fallback: number): number {
  if (points.length === 0) return fallback;
  if (points.length === 1) return points[0].elevation; // flat, and exactly so
  let num = 0;
  let den = 0;
  for (const g of points) {
    const d2 = (g.at.x - x) * (g.at.x - x) + (g.at.y - y) * (g.at.y - y);
    if (d2 <= GRADE_SNAP * GRADE_SNAP) return g.elevation;
    const w = 1 / d2;
    num += w * g.elevation;
    den += w;
  }
  return num / den;
}

export interface TerrainGrid {
  /** Vertex positions in three coordinates, 3 numbers each: (plan x, elevation, plan y). */
  positions: Float32Array;
  /** Triangle corner indices; every triangle faces up (+Y). */
  indices: Uint32Array;
  /** The grid's extent in plan coordinates: what `terrainBounds` returns for the plan's bounds. */
  bounds: Bounds;
  /** Cell size actually used (TERRAIN_STEP, or coarser when the site is large). */
  step: number;
  /** Cells along x and along plan y. */
  cellsX: number;
  cellsY: number;
  /**
   * The lowest vertex on the grid's boundary minus TERRAIN_SKIRT_DROP: where the skirt hung from
   * the boundary ends (meshes.ts buildTerrainGeometry), and the far ground round the grid reaches.
   */
  skirtElevation: number;
}

/**
 * Cell size for a plan of these dimensions: the standard step, coarsened to keep within the cell
 * cap. The grid is rounded out to whole cells, which can add one, hence the cap minus one.
 */
function stepFor(width: number, height: number): number {
  const need = Math.max(width, height) + 2 * TERRAIN_MARGIN;
  return Math.ceil(need / TERRAIN_STEP) + 1 > TERRAIN_MAX_CELLS ? Math.ceil(need / (TERRAIN_MAX_CELLS - 1)) : TERRAIN_STEP;
}

/**
 * The area the terrain covers for a plan whose bounds are `bounds`: expanded by TERRAIN_MARGIN and
 * rounded outward to whole cells, so a wall moving about inside does not change it.
 */
export function terrainBounds(bounds: Bounds): Bounds {
  const step = stepFor(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  return {
    minX: Math.floor((bounds.minX - TERRAIN_MARGIN) / step) * step,
    minY: Math.floor((bounds.minY - TERRAIN_MARGIN) / step) * step,
    maxX: Math.ceil((bounds.maxX + TERRAIN_MARGIN) / step) * step,
    maxY: Math.ceil((bounds.maxY + TERRAIN_MARGIN) / step) * step,
  };
}

/** How far under the lowest slab's bottom the ground inside the house's footprint sits. */
export const TERRAIN_UNDER_SLAB = 2;

/**
 * The terrain surface over the plan bounds plus the margin: a (cellsX + 1) x (cellsY + 1) grid of
 * vertices with the interpolated elevation (or `fallback` without grade points) and two upward
 * triangles per cell. The step is TERRAIN_STEP unless that would exceed TERRAIN_MAX_CELLS cells
 * along an axis, then it grows to fit.
 *
 * `footprints` (the lowest level's slab outlines, out to the walls' outside faces) cut the house
 * out of the ground: grid vertices inside one get `floorUnder` (the lowest slab's bottom minus
 * 2"), so the ground dips under the basement instead of filling it. The cells the outlines cross
 * are split along them (extra vertices after the grid's), so the ground meets the wall's outside
 * face at grade and drops to `floorUnder` straight down there, inside the wall, rather than
 * sloping across a whole cell.
 *
 * `skirtElevation` is the lowest boundary vertex minus TERRAIN_SKIRT_DROP: the grid's edge hangs a
 * skirt down to it (meshes.ts buildTerrainGeometry), so the ground has no open edge, and the far
 * ground round the grid falls to it at its outer edge.
 */
export function terrainGrid(
  site: Pick<Site, 'gradePoints'>,
  bounds: Bounds,
  fallback: number,
  footprints: readonly (readonly Vec2[])[] = [],
  floorUnder: number = fallback - TERRAIN_UNDER_SLAB,
): TerrainGrid {
  const step = stepFor(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const tb = terrainBounds(bounds);
  const cellsX = Math.max(1, Math.round((tb.maxX - tb.minX) / step));
  const cellsY = Math.max(1, Math.round((tb.maxY - tb.minY) / step));
  const nx = cellsX + 1;
  const ny = cellsY + 1;
  const points = Object.values(site.gradePoints);
  const tin = tinOf(site.gradePoints);
  const cut = footprintCut(footprints);
  const grade = new Float64Array(nx * ny);
  const inside = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const y = tb.minY + j * step;
    for (let i = 0; i < nx; i++) {
      const x = tb.minX + i * step;
      const v = j * nx + i;
      grade[v] = points.length < 3 ? idw(points, x, y, fallback) : tinHeight(tin, points, x, y, fallback);
      if (cut && cut.contains(x, y)) inside[v] = 1;
    }
  }
  const pos: number[] = [];
  let edgeLow = Infinity;
  for (let v = 0; v < nx * ny; v++) {
    const i = v % nx;
    const j = Math.floor(v / nx);
    const h = inside[v] ? floorUnder : grade[v];
    pos.push(tb.minX + i * step, h, tb.minY + j * step);
    if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) edgeLow = Math.min(edgeLow, h);
  }
  const idx: number[] = [];
  // Extra vertices of the split cells, shared by position and side (ground / under the house);
  // a grid vertex is reused where it is on the same side.
  const extra = new Map<string, number>();
  const vertexAt = (p: Vec2, under: boolean, h: number): number => {
    const key = `${p.x.toFixed(5)},${p.y.toFixed(5)},${under ? 1 : 0}`;
    let k = extra.get(key);
    if (k === undefined) {
      const gi = Math.round((p.x - tb.minX) / step);
      const gj = Math.round((p.y - tb.minY) / step);
      const onGrid = Math.abs(tb.minX + gi * step - p.x) < 1e-6 && Math.abs(tb.minY + gj * step - p.y) < 1e-6;
      if (onGrid && gi >= 0 && gi < nx && gj >= 0 && gj < ny && !!inside[gj * nx + gi] === under) k = gj * nx + gi;
      else {
        k = pos.length / 3;
        pos.push(p.x, h, p.y);
      }
      extra.set(key, k);
    }
    return k;
  };
  for (let j = 0; j < cellsY; j++) {
    for (let i = 0; i < cellsX; i++) {
      const a = j * nx + i; // (x, y)
      const b = (j + 1) * nx + i; // (x, y + step)
      const c = j * nx + i + 1; // (x + step, y)
      const d = (j + 1) * nx + i + 1;
      const x0 = tb.minX + i * step;
      const y0 = tb.minY + j * step;
      if (!cut || !cut.crosses(x0, y0, x0 + step, y0 + step)) {
        // (b - a) x (c - a) points along +Y in three coordinates.
        idx.push(a, b, c, c, b, d);
        continue;
      }
      // The outline crosses this cell: split both triangles into the parts outside (on the
      // grade plane of the triangle) and inside (flat at floorUnder).
      const P = (v: number): Vec2 => ({ x: pos[v * 3], y: pos[v * 3 + 2] });
      for (const tri of [
        [a, b, c],
        [c, b, d],
      ]) {
        const corners = tri.map(P);
        const heightAt = planeThrough(corners, tri.map((v) => grade[v]));
        for (const piece of cut.split(corners)) {
          const under = piece.inside;
          const ids = piece.poly.map((p) => vertexAt(p, under, under ? floorUnder : heightAt(p)));
          for (let k = 1; k + 1 < ids.length; k++) {
            const p0 = piece.poly[0];
            const p1 = piece.poly[k];
            const p2 = piece.poly[k + 1];
            // Upward in three coordinates: negative signed area on the y-down plan.
            if (cross(sub(p1, p0), sub(p2, p0)) < 0) idx.push(ids[0], ids[k], ids[k + 1]);
            else idx.push(ids[0], ids[k + 1], ids[k]);
          }
        }
      }
    }
  }
  return {
    positions: new Float32Array(pos),
    indices: new Uint32Array(idx),
    bounds: tb,
    step,
    cellsX,
    cellsY,
    skirtElevation: edgeLow - TERRAIN_SKIRT_DROP,
  };
}

/** The height function of the plane through three plan points with the given heights. */
function planeThrough(p: readonly Vec2[], h: readonly number[]): (q: Vec2) => number {
  const det = cross(sub(p[1], p[0]), sub(p[2], p[0]));
  return (q) => {
    if (Math.abs(det) < 1e-12) return h[0];
    // Barycentric weights of q.
    const w1 = cross(sub(q, p[0]), sub(p[2], p[0])) / det;
    const w2 = cross(sub(p[1], p[0]), sub(q, p[0])) / det;
    return h[0] + (h[1] - h[0]) * w1 + (h[2] - h[0]) * w2;
  };
}

interface FootprintCut {
  contains(x: number, y: number): boolean;
  /** True when an outline edge touches the closed rectangle. */
  crosses(x0: number, y0: number, x1: number, y1: number): boolean;
  /** A convex polygon cut into convex pieces inside and outside the footprints (slivers dropped). */
  split(poly: Vec2[]): { poly: Vec2[]; inside: boolean }[];
}

const MIN_PIECE_AREA = 1e-6;

/** The footprints as convex triangles (ear clipping) plus their edges, for terrainGrid. */
function footprintCut(footprints: readonly (readonly Vec2[])[]): FootprintCut | null {
  const rings = footprints.filter((f) => f.length >= 3 && Math.abs(polygonSignedArea(f)) > MIN_PIECE_AREA).map((f) => (polygonSignedArea(f) > 0 ? [...f] : [...f].reverse()));
  if (rings.length === 0) return null;
  // Each triangle as its three inward half-planes (dot(n, p) <= c keeps the inside).
  const tris: { n: Vec2; c: number }[][] = [];
  const triBoxes: Bounds[] = [];
  for (const ring of rings) {
    for (const [i0, i1, i2] of triangulate(ring)) {
      const t = [ring[i0], ring[i1], ring[i2]];
      tris.push(
        t.map((p, k) => {
          const q = t[(k + 1) % 3];
          // Positive area (math sense): the inside is left of p -> q, i.e. cross(q - p, x - p) >= 0.
          const n = { x: q.y - p.y, y: -(q.x - p.x) };
          return { n, c: n.x * p.x + n.y * p.y };
        }),
      );
      triBoxes.push(boundsOf(t)!);
    }
  }
  const edges: [Vec2, Vec2][] = rings.flatMap((r) => r.map((p, i) => [p, r[(i + 1) % r.length]] as [Vec2, Vec2]));
  const area = (poly: Vec2[]) => Math.abs(polygonSignedArea(poly));
  return {
    contains: (x, y) => rings.some((r) => pointInPolygon({ x, y }, r)),
    crosses: (x0, y0, x1, y1) => edges.some(([p, q]) => segmentTouchesRect(p, q, x0, y0, x1, y1)),
    split(poly) {
      const box = boundsOf(poly)!;
      const out: { poly: Vec2[]; inside: boolean }[] = [];
      let outside: Vec2[][] = [poly];
      tris.forEach((planes, t) => {
        const tb = triBoxes[t];
        if (tb.maxX < box.minX || tb.minX > box.maxX || tb.maxY < box.minY || tb.minY > box.maxY) return;
        // Inside part: the polygon clipped by the triangle's three half-planes.
        let inPart: Vec2[] = poly;
        for (const { n, c } of planes) if (inPart.length) inPart = clipHalfPlane(inPart, n, c);
        if (inPart.length && area(inPart) > MIN_PIECE_AREA) out.push({ poly: inPart, inside: true });
        // Outside parts: subtract the triangle from every remaining piece (convex difference).
        const next: Vec2[][] = [];
        for (const piece of outside) {
          let rest: Vec2[] = piece;
          for (const { n, c } of planes) {
            const beyond = clipHalfPlane(rest, { x: -n.x, y: -n.y }, -c);
            if (beyond.length && area(beyond) > MIN_PIECE_AREA) next.push(beyond);
            rest = clipHalfPlane(rest, n, c);
            if (!rest.length) break;
          }
        }
        outside = next;
      });
      for (const p of outside) out.push({ poly: p, inside: false });
      return out;
    },
  };
}

/** True when segment p-q has a point in the closed rectangle (Liang-Barsky). */
function segmentTouchesRect(p: Vec2, q: Vec2, x0: number, y0: number, x1: number, y1: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  for (const [den, num] of [
    [-dx, p.x - x0],
    [dx, x1 - p.x],
    [-dy, p.y - y0],
    [dy, y1 - p.y],
  ]) {
    if (den === 0) {
      if (num < 0) return false;
    } else {
      const r = num / den;
      if (den < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/**
 * The house cut out of the ground (terrainGrid's `footprints` and `floorUnder`): `key` is what the
 * outlines are derived from (the lowest level's outer faces), so the memo can tell they are the
 * same without building them.
 */
export interface TerrainCut {
  key: object;
  floorUnder: number;
  footprints: () => Vec2[][];
}

// Memo: the grid depends on the grade points (not on columns or the north angle), the plan bounds
// (after rounding to whole cells), the fallback elevation and the house cut. Keyed by the grade
// points record, which immer keeps while an edit does not touch a grade point, and by the lowest
// level's outer faces (getFaces keeps them while its nodes and walls are untouched), so moving a
// wall on another level or a column never rebuilds the terrain.
const terrainMemo = new WeakMap<object, { key: string; cut: object | null; grid: TerrainGrid }>();

/** terrainGrid(), memoized by the site's grade points, the plan bounds, the fallback elevation and the cut. */
export function terrainFor(site: Pick<Site, 'gradePoints'>, bounds: Bounds, fallback: number, cut?: TerrainCut): TerrainGrid {
  const tb = terrainBounds(bounds);
  const key = `${tb.minX},${tb.minY},${tb.maxX},${tb.maxY}|${fallback}|${cut ? cut.floorUnder : ''}`;
  const hit = terrainMemo.get(site.gradePoints);
  if (hit && hit.key === key && hit.cut === (cut?.key ?? null)) return hit.grid;
  const grid = cut ? terrainGrid(site, bounds, fallback, cut.footprints(), cut.floorUnder) : terrainGrid(site, bounds, fallback);
  terrainMemo.set(site.gradePoints, { key, cut: cut?.key ?? null, grid });
  return grid;
}

/**
 * The house's cut in the ground: the lowest level's slab outlines in the view mode (out to the
 * walls' outside faces), with the ground TERRAIN_UNDER_SLAB under that level's slab. Undefined when
 * the lowest level has no closed outline.
 */
export function terrainCut(plan: Plan, viewMode: ViewMode): TerrainCut | undefined {
  const lowest = plan.levels[plan.levelOrder[0]];
  if (!lowest) return undefined;
  const faces = getFaces(lowest, viewMode);
  if (faces.outerFaces.length === 0) return undefined;
  return { key: faces.outerFaces, floorUnder: fallbackElevation(plan) - TERRAIN_UNDER_SLAB, footprints: () => slabOutlines(faces, true) };
}

/** Flat ground without grade points: the bottom of the lowest level's slab. */
export function fallbackElevation(plan: Plan): number {
  const id = plan.levelOrder[0];
  return id ? (getLevelElevations(plan)[id]?.slabBottom ?? 0) : 0;
}

/** The lowest ground: the flat ground used without grade points, or the lowest grade point when it is lower. */
export function lowestGround(plan: Plan): number {
  let low = fallbackElevation(plan);
  for (const g of Object.values(plan.site.gradePoints)) low = Math.min(low, g.elevation);
  return low;
}

/** A plan with nothing in it: the terrain still gets a 20' square to surround. */
const EMPTY_BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 240, maxY: 240 };

/**
 * The plan's extent in plan coordinates: every level's nodes, roof and deck outlines, the columns
 * and the grade points. A 20' square at the origin for an empty plan.
 */
export function siteBounds(plan: Plan): Bounds {
  const pts: Vec2[] = [];
  for (const id of plan.levelOrder) {
    const level = plan.levels[id];
    if (!level) continue;
    for (const n of Object.values(level.nodes)) pts.push(n);
    for (const r of Object.values(level.roofs ?? {})) for (const p of r.outline) pts.push(p);
    for (const d of Object.values(level.decks ?? {})) for (const p of d.outline) pts.push(p);
  }
  for (const c of Object.values(plan.site.columns)) for (const p of columnOutline(c)) pts.push(p);
  for (const g of Object.values(plan.site.gradePoints)) pts.push(g.at);
  return boundsOf(pts) ?? EMPTY_BOUNDS;
}

/** The terrain grid of a plan in a view mode, the house cut out of it (memoized, see terrainFor). */
export function planTerrain(plan: Plan, viewMode: ViewMode = 'all'): TerrainGrid {
  return terrainFor(plan.site, siteBounds(plan), fallbackElevation(plan), terrainCut(plan, viewMode));
}

/** Where the 3D view's sun stands: from the south-west in plan terms, turned with the north angle. */
export function sunPosition(northAngle: number): [number, number, number] {
  const p = ROTATE(SUN_PLAN, northAngle);
  return [p.x, SUN_HEIGHT, p.y];
}

// ---------------------------------------------------------------------------------------------
// Columns

/** A circle of `diameter` round `at`, as FLUE_SIDES corners clockwise on screen. */
export function circleOutline(at: Vec2, diameter: number): Vec2[] {
  const r = diameter / 2;
  return Array.from({ length: FLUE_SIDES }, (_, i) => {
    const t = (2 * Math.PI * i) / FLUE_SIDES;
    return { x: at.x + r * Math.cos(t), y: at.y + r * Math.sin(t) };
  });
}

/**
 * The corners of a column's plan rectangle (width along x, depth along y, turned by `rotation`),
 * clockwise on screen; a flue's circle of diameter `width` (circleOutline).
 */
export function columnOutline(c: Pick<Column, 'at' | 'width' | 'depth' | 'rotation'> & Partial<Pick<Column, 'kind'>>): Vec2[] {
  if (c.kind === 'flue') return circleOutline(c.at, c.width);
  const hw = c.width / 2;
  const hd = c.depth / 2;
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map((p) => {
    const r = ROTATE(p, c.rotation);
    return { x: c.at.x + r.x, y: c.at.y + r.y };
  });
}

/**
 * A capped chimney's parts (Column.cap): a concrete cap `thickness` deep at the top of the shaft,
 * `proud` past its faces all round, and a wire spark arrestor `arrestor` high on top of it, `inset`
 * in from the shaft's faces.
 */
export const CHIMNEY_CAP = { thickness: 4, proud: 2, arrestor: 12, inset: 1 } as const;

/** True when the column is a chimney with its cap and spark arrestor (a post ignores `cap`). */
export const hasChimneyCap = (c: Partial<Pick<Column, 'kind' | 'cap'>>): boolean => c.kind === 'chimney' && c.cap === true;

/**
 * A capped flue's rain cap: a disc `spread` times the pipe's width and `thickness` deep, `gap` over
 * the top of the pipe, on a spacer `stem` times its width.
 */
export const FLUE_CAP = { gap: 3, thickness: 1.5, spread: 2, stem: 0.5 } as const;

/** True when the column is a flue with its rain cap. */
export const hasFlueCap = (c: Partial<Pick<Column, 'kind' | 'cap'>>): boolean => c.kind === 'flue' && c.cap === true;

/** The highest point of a column: its top, or the top of a capped chimney's spark arrestor or a capped flue's rain cap. */
export const columnPeak = (c: Pick<Column, 'kind' | 'cap' | 'top'>): number =>
  c.top + (hasChimneyCap(c) ? CHIMNEY_CAP.arrestor : hasFlueCap(c) ? FLUE_CAP.gap + FLUE_CAP.thickness : 0);

/** The parts a capped chimney (cap, arrestor) or a capped flue (its rain cap's hood and stem) adds to its shaft, each in its own material. */
export type ChimneyPart = 'cap' | 'arrestor' | 'hood' | 'stem';

/** One part of a capped chimney: its plan rectangle (columnOutline order) and its bottom and top elevations. */
export interface ChimneyPartBox {
  part: ChimneyPart;
  outline: Vec2[];
  bottom: number;
  top: number;
}

/**
 * The cap and spark arrestor of a capped chimney (none for anything else): the cap from `top` less
 * its thickness (never below the base) to `top`, its rectangle grown by `proud` on every side; the
 * arrestor from `top` up, its rectangle the shaft's shrunk by `inset` (at most a quarter of the
 * shaft, so a slender one keeps some width). Both turn with the column.
 */
export function chimneyPartBoxes(c: Pick<Column, 'at' | 'width' | 'depth' | 'rotation' | 'base' | 'top' | 'kind' | 'cap'>): ChimneyPartBox[] {
  if (hasFlueCap(c)) {
    const { gap, thickness, spread, stem } = FLUE_CAP;
    return [
      { part: 'stem', outline: circleOutline(c.at, c.width * stem), bottom: c.top, top: c.top + gap },
      { part: 'hood', outline: circleOutline(c.at, c.width * spread), bottom: c.top + gap, top: c.top + gap + thickness },
    ];
  }
  if (!hasChimneyCap(c)) return [];
  const { thickness, proud, arrestor } = CHIMNEY_CAP;
  const inset = Math.min(CHIMNEY_CAP.inset, c.width / 4, c.depth / 4);
  return [
    { part: 'cap', outline: columnOutline({ ...c, width: c.width + 2 * proud, depth: c.depth + 2 * proud }), bottom: Math.max(c.base, c.top - thickness), top: c.top },
    { part: 'arrestor', outline: columnOutline({ ...c, width: c.width - 2 * inset, depth: c.depth - 2 * inset }), bottom: c.top, top: c.top + arrestor },
  ];
}

/** True when p lies inside the column's rectangle (a flue's circle) grown by `slack` on every side. */
export function pointInColumn(c: Pick<Column, 'at' | 'width' | 'depth' | 'rotation'> & Partial<Pick<Column, 'kind'>>, p: Vec2, slack = 0): boolean {
  if (c.kind === 'flue') return Math.hypot(p.x - c.at.x, p.y - c.at.y) <= c.width / 2 + slack;
  const q = ROTATE({ x: p.x - c.at.x, y: p.y - c.at.y }, -c.rotation);
  return Math.abs(q.x) <= c.width / 2 + slack && Math.abs(q.y) <= c.depth / 2 + slack;
}

/** Elevation of the ground at a plan point (the plan's terrain, flat at the fallback without grade points). */
export function groundAt(plan: Plan, p: Vec2): number {
  return terrainHeightAt(plan.site, p, fallbackElevation(plan));
}

/** Top surface of the highest roof ridge on the plan (any phase), or null without roofs. */
export function highestRidge(plan: Plan): number | null {
  const elev = getLevelElevations(plan);
  let top: number | null = null;
  for (const id of plan.levelOrder) {
    const level = plan.levels[id];
    const e = elev[id];
    if (!level || !e) continue;
    for (const r of Object.values(level.roofs ?? {})) {
      const h = e.floorTop + roofExtremes(r, roofBearing(level.wallHeight, r)).ridge + r.thickness;
      if (top === null || h > top) top = h;
    }
  }
  return top;
}

/**
 * The lowest roof underside above a plan point (absolute elevation), among roofs that can be seen
 * together with a column of phase `phase` (a new post ignores a roof being demolished). Null where
 * no roof covers the point.
 */
export function lowestRoofUnderside(plan: Plan, p: Vec2, phase: Column['phase'] = 'existing'): number | null {
  const elev = getLevelElevations(plan);
  let low: number | null = null;
  for (const id of plan.levelOrder) {
    const level = plan.levels[id];
    const e = elev[id];
    if (!level || !e) continue;
    for (const r of Object.values(level.roofs ?? {})) {
      if (!phasesCoexist(r.phase, phase)) continue;
      const h = roofHeightAt(r, roofBearing(level.wallHeight, r), p);
      if (h === null) continue;
      const abs = e.floorTop + h;
      if (low === null || abs < low) low = abs;
    }
  }
  return low;
}

/**
 * Size and heights of a column about to be placed at `at` (DESIGN.md "Site and terrain").
 * Chimney: 24" x 40", from 12" below the ground to 48" above the highest ridge (above the top
 * level's ceiling without roofs). Post: 6" x 6", from the ground to the lowest roof underside over
 * it (the first floor's ceiling without one). Pier: 16" x 16", from the ground to the first floor's
 * floor top (24" high where that is not above the ground).
 */
export function columnDefaults(plan: Plan, kind: Column['kind'], at: Vec2, phase: Column['phase'] = 'existing'): Pick<Column, 'width' | 'depth' | 'rotation' | 'base' | 'top'> {
  const ground = groundAt(plan, at);
  const elev = getLevelElevations(plan);
  const last = plan.levelOrder[plan.levelOrder.length - 1];
  if (kind === 'chimney') {
    const d = COLUMN_DEFAULTS.chimney;
    const ridge = highestRidge(plan);
    const top = (ridge ?? (last ? elev[last].ceiling : ground)) + d.aboveRidge;
    return { width: d.width, depth: d.depth, rotation: 0, base: ground - d.belowGrade, top };
  }
  const first = plan.levelOrder[1] ?? plan.levelOrder[0];
  if (kind === 'pier') {
    const d = COLUMN_DEFAULTS.pier;
    const top = first ? elev[first].floorTop : ground + d.height;
    return { width: d.width, depth: d.depth, rotation: 0, base: ground, top: top > ground ? top : ground + d.height };
  }
  if (kind === 'flue') {
    const d = COLUMN_DEFAULTS.flue;
    const base = (first ? elev[first].floorTop : ground) + d.aboveFloor;
    const ridge = highestRidge(plan);
    const top = (ridge ?? (last ? elev[last].ceiling : base + 96)) + d.aboveRidge;
    return { width: d.width, depth: d.depth, rotation: 0, base, top: top > base ? top : base + 96 };
  }
  const under = lowestRoofUnderside(plan, at, phase);
  const top = under ?? (first ? elev[first].ceiling : ground + 96);
  return { width: COLUMN_DEFAULTS.post.width, depth: COLUMN_DEFAULTS.post.depth, rotation: 0, base: ground, top: top > ground ? top : ground + 96 };
}

/** The default elevation of a new grade point: the floor top of the level shown under the site layer. */
export function defaultGradeElevation(plan: Plan): number {
  const id = siteGhostLevelId(plan);
  return id ? (getLevelElevations(plan)[id]?.floorTop ?? 0) : 0;
}

/** The level the site view shows as a ghost: the first floor (the level above the lowest), or the lowest if only one. */
export function siteGhostLevelId(plan: { readonly levelOrder: readonly Id[] }): Id | undefined {
  return plan.levelOrder[1] ?? plan.levelOrder[0];
}

/** Columns the view mode shows. */
export function visibleColumns(site: Site, viewMode: ViewMode): Column[] {
  return Object.values(site.columns).filter((c) => isVisible(c.phase, viewMode));
}
