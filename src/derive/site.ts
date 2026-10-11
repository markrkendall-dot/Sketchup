import { boundsOf, type Bounds } from '../model/geometry';
import type { Column, Id, Plan, Site, Vec2, ViewMode } from '../model/types';
import { getLevelElevations } from './levels';
import { isVisible, phasesCoexist } from './phase';
import { roofBearing, roofExtremes, roofHeightAt } from './roofs';

// The site (DESIGN.md "Site and terrain"). Pure: no three, no React, so the 2D editor can use it
// without loading the 3D chunk; derive/meshes.ts wraps the grid in a BufferGeometry.
//
// Grade points are spot elevations of the ground. The terrain is the inverse-distance-weighted
// surface through them, sampled on a coarse grid around the plan; columns (chimneys, posts) are
// boxes standing on it.

/** Grid cell size of the terrain. */
export const TERRAIN_STEP = 24;
/** The terrain extends this far beyond the plan's bounds on every side (40'). */
export const TERRAIN_MARGIN = 480;
/** The grid never has more cells than this along either axis; larger sites get a coarser step. */
export const TERRAIN_MAX_CELLS = 200;
/** A sample closer than this to a grade point takes that point's elevation exactly. */
export const GRADE_SNAP = 1;

/** The sun's height and distance in the 3D view (inches); its direction in plan is fixed by the north angle. */
const SUN_HEIGHT = 1600;
const SUN_PLAN = { x: -700, y: 1100 };

/** Width and depth of a new chimney / post, and how far the chimney stands below grade and above the ridge. */
export const COLUMN_DEFAULTS = {
  chimney: { width: 24, depth: 40, belowGrade: 12, aboveRidge: 48 },
  post: { width: 6, depth: 6 },
} as const;

const ROTATE = (p: Vec2, deg: number): Vec2 => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

// ---------------------------------------------------------------------------------------------
// Terrain

/**
 * Inverse-distance-weighted (power 2) average of the grade points at p. Within GRADE_SNAP of a grade
 * point the result is exactly that point's elevation; with no points it is `fallback` (flat ground).
 */
export function terrainHeightAt(site: Pick<Site, 'gradePoints'>, p: Vec2, fallback: number): number {
  return idw(Object.values(site.gradePoints), p.x, p.y, fallback);
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

/**
 * The terrain surface over the plan bounds plus the margin: a (cellsX + 1) x (cellsY + 1) grid of
 * vertices with the interpolated elevation (or `fallback` without grade points) and two upward
 * triangles per cell. The step is TERRAIN_STEP unless that would exceed TERRAIN_MAX_CELLS cells
 * along an axis, then it grows to fit.
 */
export function terrainGrid(site: Pick<Site, 'gradePoints'>, bounds: Bounds, fallback: number): TerrainGrid {
  const step = stepFor(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const tb = terrainBounds(bounds);
  const cellsX = Math.max(1, Math.round((tb.maxX - tb.minX) / step));
  const cellsY = Math.max(1, Math.round((tb.maxY - tb.minY) / step));
  const nx = cellsX + 1;
  const ny = cellsY + 1;
  const points = Object.values(site.gradePoints);
  const positions = new Float32Array(nx * ny * 3);
  for (let j = 0; j < ny; j++) {
    const y = tb.minY + j * step;
    for (let i = 0; i < nx; i++) {
      const x = tb.minX + i * step;
      const o = (j * nx + i) * 3;
      positions[o] = x;
      positions[o + 1] = idw(points, x, y, fallback);
      positions[o + 2] = y;
    }
  }
  const indices = new Uint32Array(cellsX * cellsY * 6);
  let k = 0;
  for (let j = 0; j < cellsY; j++) {
    for (let i = 0; i < cellsX; i++) {
      const a = j * nx + i; // (x, y)
      const b = (j + 1) * nx + i; // (x, y + step)
      const c = j * nx + i + 1; // (x + step, y)
      const d = (j + 1) * nx + i + 1;
      // (b - a) x (c - a) points along +Y in three coordinates.
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = d;
    }
  }
  return { positions, indices, bounds: tb, step, cellsX, cellsY };
}

// Memo: the grid depends on the grade points (not on columns or the north angle), the plan bounds
// (after rounding to whole cells) and the fallback elevation. Keyed by the grade points record,
// which immer keeps while an edit does not touch a grade point, so moving a wall or a column
// never rebuilds the terrain.
const terrainMemo = new WeakMap<object, { key: string; grid: TerrainGrid }>();

/** terrainGrid(), memoized by the site's grade points, the plan bounds and the fallback elevation. */
export function terrainFor(site: Pick<Site, 'gradePoints'>, bounds: Bounds, fallback: number): TerrainGrid {
  const tb = terrainBounds(bounds);
  const key = `${tb.minX},${tb.minY},${tb.maxX},${tb.maxY}|${fallback}`;
  const hit = terrainMemo.get(site.gradePoints);
  if (hit && hit.key === key) return hit.grid;
  const grid = terrainGrid(site, bounds, fallback);
  terrainMemo.set(site.gradePoints, { key, grid });
  return grid;
}

/** Flat ground without grade points: the bottom of the lowest level's slab. */
export function fallbackElevation(plan: Plan): number {
  const id = plan.levelOrder[0];
  return id ? (getLevelElevations(plan)[id]?.slabBottom ?? 0) : 0;
}

/** A plan with nothing in it: the terrain still gets a 20' square to surround. */
const EMPTY_BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 240, maxY: 240 };

/**
 * The plan's extent in plan coordinates: every level's nodes and roof outlines, the columns and
 * the grade points. A 20' square at the origin for an empty plan.
 */
export function siteBounds(plan: Plan): Bounds {
  const pts: Vec2[] = [];
  for (const id of plan.levelOrder) {
    const level = plan.levels[id];
    if (!level) continue;
    for (const n of Object.values(level.nodes)) pts.push(n);
    for (const r of Object.values(level.roofs ?? {})) for (const p of r.outline) pts.push(p);
  }
  for (const c of Object.values(plan.site.columns)) for (const p of columnOutline(c)) pts.push(p);
  for (const g of Object.values(plan.site.gradePoints)) pts.push(g.at);
  return boundsOf(pts) ?? EMPTY_BOUNDS;
}

/** The terrain grid of a plan (memoized, see terrainFor). */
export function planTerrain(plan: Plan): TerrainGrid {
  return terrainFor(plan.site, siteBounds(plan), fallbackElevation(plan));
}

/** Where the 3D view's sun stands: from the south-west in plan terms, turned with the north angle. */
export function sunPosition(northAngle: number): [number, number, number] {
  const p = ROTATE(SUN_PLAN, northAngle);
  return [p.x, SUN_HEIGHT, p.y];
}

// ---------------------------------------------------------------------------------------------
// Columns

/** The corners of a column's plan rectangle (width along x, depth along y, turned by `rotation`), clockwise on screen. */
export function columnOutline(c: Pick<Column, 'at' | 'width' | 'depth' | 'rotation'>): Vec2[] {
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

/** True when p lies inside the column's rectangle grown by `slack` on every side. */
export function pointInColumn(c: Pick<Column, 'at' | 'width' | 'depth' | 'rotation'>, p: Vec2, slack = 0): boolean {
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
 * it (the first floor's ceiling without one).
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
export function siteGhostLevelId(plan: Plan): Id | undefined {
  return plan.levelOrder[1] ?? plan.levelOrder[0];
}

/** Columns the view mode shows. */
export function visibleColumns(site: Site, viewMode: ViewMode): Column[] {
  return Object.values(site.columns).filter((c) => isVisible(c.phase, viewMode));
}
