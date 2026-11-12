import { add, cross, dot, lineIntersection, normalize, pointInPolygon, polygonSignedArea, scale, sub } from '../model/geometry';
import { levelBelowId } from '../model/structures';
import type { Foundation, Id, Level, Phase, Plan, Vec2, ViewMode } from '../model/types';
import { convexMinusAll, convexPieces } from './roofs';
import { getFaces, slabOutlines } from './rooms';

// Foundations (DESIGN.md "Foundations"): under the part of a level's floor that has nothing of its
// building beneath it (the lowest level's whole floor; on an upper level, what is not over a floor
// of the level below, such as a wing drawn on the First Floor beside a basement), a slab on grade or
// a perimeter stem wall on a footing, per the level's `foundation`. Heights are level-local (0 =
// the level's floor top), like the walls.

export const FOUNDATION_DEFAULTS = { thickness: 4, wallThickness: 8, depth: 36, material: 'concrete' as const };
/** The footing under a stem wall: this much wider each side, this deep. */
export const FOOTING_PROJECTION = 4;
export const FOOTING_DEPTH = 8;
/** A stem wall or slab reaches at least this far into the ground at its lowest point. */
export const FOUNDATION_BURY = 6;
/** Pieces of the region thinner than this (a wall-thickness mismatch with the level below) are left out. */
const MIN_WIDTH = 3;

/** The level's foundation with its defaults, or null for none. */
export function foundationOf(level: Pick<Level, 'foundation'>): Required<Foundation> | null {
  const f = level.foundation;
  if (!f || f.kind === 'none') return null;
  return { kind: f.kind, thickness: f.thickness ?? FOUNDATION_DEFAULTS.thickness, wallThickness: f.wallThickness ?? FOUNDATION_DEFAULTS.wallThickness, depth: f.depth ?? FOUNDATION_DEFAULTS.depth, material: f.material ?? FOUNDATION_DEFAULTS.material };
}

/** The part of the level's floor (out to its walls' outside faces) over no floor of the level below, in convex pieces. */
export interface FoundationRegion {
  pieces: Vec2[][];
  /** The level below's floor outlines (an edge against them needs no stem wall). */
  below: Vec2[][];
}

const regionCache = new WeakMap<Level, Map<string, { below: Level | undefined; region: FoundationRegion }>>();

export function foundationRegion(plan: Plan, levelId: Id, viewMode: ViewMode): FoundationRegion {
  const level = plan.levels[levelId];
  const belowId = levelBelowId(plan, levelId);
  const belowLevel = belowId ? plan.levels[belowId] : undefined;
  if (!level) return { pieces: [], below: [] };
  let byView = regionCache.get(level);
  if (!byView) regionCache.set(level, (byView = new Map()));
  const hit = byView.get(viewMode);
  if (hit && hit.below === belowLevel) return hit.region;
  const outlines = slabOutlines(getFaces(level, viewMode), true);
  const below = belowLevel ? slabOutlines(getFaces(belowLevel, viewMode), true) : [];
  const holes = below.flatMap((r) => convexPieces(r));
  const pieces: Vec2[][] = [];
  for (const o of outlines) for (const c of convexPieces(o)) for (const k of convexMinusAll(c, holes)) if (widthOf(k) >= MIN_WIDTH) pieces.push(k);
  const region = { pieces, below };
  byView.set(viewMode, { below: belowLevel, region });
  return region;
}

/** Twice the area over the perimeter: about the width of a long thin piece. */
function widthOf(poly: readonly Vec2[]): number {
  let per = 0;
  for (let i = 0; i < poly.length; i++) per += Math.hypot(poly[(i + 1) % poly.length].x - poly[i].x, poly[(i + 1) % poly.length].y - poly[i].y);
  return per > 0 ? (2 * Math.abs(polygonSignedArea(poly))) / per : 0;
}

/** One solid of a foundation: a vertical prism over `poly` from `bottom` to `top` (level-local). */
export interface FoundationSolid {
  poly: Vec2[];
  top: number;
  bottom: number;
  phase: Phase;
}

export interface FoundationLayout {
  kind: 'slab' | 'stem';
  material: 'block' | 'concrete';
  solids: FoundationSolid[];
  /** The region (convex pieces) and the level-local height the ground is cut to under it. */
  region: Vec2[][];
  groundUnder: number;
}

const onEdge = (p: Vec2, a: Vec2, b: Vec2) => {
  const d = sub(b, a);
  const len = Math.hypot(d.x, d.y);
  if (len < 1e-9) return false;
  const t = dot(sub(p, a), d) / (len * len);
  return t > -1e-6 && t < 1 + 1e-6 && Math.abs(cross(d, sub(p, a))) / len < 1e-3;
};
const inOrOn = (p: Vec2, poly: readonly Vec2[]) => pointInPolygon(p, poly) || poly.some((a, i) => onEdge(p, a, poly[(i + 1) % poly.length]));

/**
 * The level's foundation: null when it has none or nothing of its floor is over open ground.
 * `groundAt` is the ground's height (level-local) at a point, so the slab or the stem walls reach
 * FOUNDATION_BURY into it at their lowest. A piece is new (green in All) where the level's floor
 * in the Existing view does not reach.
 */
export function foundationLayout(plan: Plan, levelId: Id, viewMode: ViewMode, groundAt: (p: Vec2) => number): FoundationLayout | null {
  const level = plan.levels[levelId];
  const f = level ? foundationOf(level) : null;
  if (!level || !f) return null;
  const { pieces, below } = foundationRegion(plan, levelId, viewMode);
  if (!pieces.length) return null;
  const existing = viewMode === 'existing' ? null : slabOutlines(getFaces(level, 'existing'), true);
  const phaseAt = (p: Vec2): Phase => (existing && !existing.some((o) => pointInPolygon(p, o)) ? 'new' : 'existing');
  const centroid = (poly: readonly Vec2[]) => scale(poly.reduce((s, p) => add(s, p), { x: 0, y: 0 }), 1 / poly.length);
  const top = -level.floorThickness;
  const solids: FoundationSolid[] = [];
  if (f.kind === 'slab') {
    for (const poly of pieces) {
      const low = Math.min(...poly.map(groundAt));
      solids.push({ poly, top, bottom: Math.min(top - f.thickness, low - FOUNDATION_BURY), phase: phaseAt(centroid(poly)) });
    }
    return { kind: 'slab', material: f.material, solids, region: pieces, groundUnder: top - f.thickness - 2 };
  }
  // Stem walls: along every outside edge of the region that is not against the level below's floor.
  const edges: { p: Vec2; q: Vec2 }[] = [];
  for (const [i, poly] of pieces.entries()) {
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k];
      const q = poly[(k + 1) % poly.length];
      const d = sub(q, p);
      const len = Math.hypot(d.x, d.y);
      if (len < 1e-6) continue;
      const m = scale(add(p, q), 0.5);
      const out = add(m, scale({ x: d.y / len, y: -d.x / len }, 0.5));
      // Another piece beyond it (inside the region), or the level below's floor: no wall.
      if (pieces.some((o, j) => j !== i && inOrOn(out, o))) continue;
      if (below.some((o) => inOrOn(out, o))) continue;
      edges.push({ p, q });
    }
  }
  // Join straight runs, so a wall is one piece along a side.
  const runs = joinRuns(edges);
  const t = f.wallThickness;
  for (const run of runs) {
    const n = run.length;
    const closed = n > 2 && dist2(run[0], run[n - 1]) < 1e-6;
    const pts = closed ? run.slice(0, -1) : run;
    const m = pts.length;
    const segs = closed ? m : m - 1;
    // Each corner of the inner line: where the neighbouring sides, moved in by t, meet (a mitre).
    const inward = (a: Vec2, b: Vec2) => {
      const d = normalize(sub(b, a));
      return { d, n: { x: -d.y, y: d.x } };
    };
    const innerAt = (i: number, off: number): Vec2 => {
      const before = closed || i > 0 ? inward(pts[(i - 1 + m) % m], pts[i]) : null;
      const after = closed || i < m - 1 ? inward(pts[i], pts[(i + 1) % m]) : null;
      if (before && after) {
        const w = lineIntersection(add(pts[i], scale(before.n, off)), before.d, add(pts[i], scale(after.n, off)), after.d);
        if (w) return w;
      }
      return add(pts[i], scale((after ?? before)!.n, off));
    };
    const outerAt = (i: number, off: number) => innerAt(i, -off);
    for (let s = 0; s < segs; s++) {
      const a = s;
      const b = (s + 1) % m;
      const low = Math.min(groundAt(pts[a]), groundAt(pts[b]));
      const bottom = Math.min(-f.depth, low - FOUNDATION_BURY);
      const phase = phaseAt(scale(add(pts[a], pts[b]), 0.5));
      solids.push({ poly: [pts[a], pts[b], innerAt(b, t), innerAt(a, t)], top, bottom, phase });
      solids.push({ poly: [outerAt(a, FOOTING_PROJECTION), outerAt(b, FOOTING_PROJECTION), innerAt(b, t + FOOTING_PROJECTION), innerAt(a, t + FOOTING_PROJECTION)], top: bottom, bottom: bottom - FOOTING_DEPTH, phase });
    }
  }
  return { kind: 'stem', material: f.material, solids, region: pieces, groundUnder: top - 2 };
}

const dist2 = (p: Vec2, q: Vec2) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2;

/** Edges (each p -> q, region on its right... any one winding) chained end to end into polylines, straight runs merged. */
function joinRuns(edges: { p: Vec2; q: Vec2 }[]): Vec2[][] {
  const left = [...edges];
  const runs: Vec2[][] = [];
  while (left.length) {
    const e = left.shift()!;
    const run = [e.p, e.q];
    let grown = true;
    while (grown) {
      grown = false;
      const i = left.findIndex((o) => dist2(o.p, run[run.length - 1]) < 1e-6);
      if (i >= 0) {
        run.push(left[i].q);
        left.splice(i, 1);
        grown = true;
        continue;
      }
      const j = left.findIndex((o) => dist2(o.q, run[0]) < 1e-6);
      if (j >= 0) {
        run.unshift(left[j].p);
        left.splice(j, 1);
        grown = true;
      }
    }
    // Drop corners on a straight line.
    const out: Vec2[] = [];
    for (let k = 0; k < run.length; k++) {
      const prev = out[out.length - 1];
      const next = run[k + 1];
      if (prev && next && Math.abs(cross(normalize(sub(run[k], prev)), normalize(sub(next, run[k])))) < 1e-9 && dist2(run[k], run[0]) > 1e-6) continue;
      out.push(run[k]);
    }
    runs.push(out);
  }
  return runs;
}
