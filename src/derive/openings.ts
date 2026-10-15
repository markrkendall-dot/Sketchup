import { add, cross, dist, dot, scale, sub } from '../model/geometry';
import { isSlidingDoor, SLIDING_LAP } from '../model/finish';
import { clampOpeningOffset } from '../model/openings';
import type { Id, Level, Opening, Phase, Plan, Vec2, ViewMode } from '../model/types';
import { computeFootprints, forgetFootprintLevels, getFootprints, type Footprint, type Footprints } from './footprint';
import { isVisible } from './phase';

/** The parts of a wall footprint opening geometry needs (a Footprint satisfies it). */
export interface WallGeom {
  a: Vec2;
  dir: Vec2;
  normal: Vec2;
  thickness: number;
  length: number;
  s0: number;
  s1: number;
}

type Seg = [Vec2, Vec2];

export interface OpeningSymbol {
  /** Center and jambs along the centerline, after clamping to the wall. */
  center: number;
  j0: number;
  j1: number;
  /** The hole in the wall: [left j0, left j1, right j1, right j0]. */
  gap: [Vec2, Vec2, Vec2, Vec2];
  /** Thin solid lines (window frame and glass). */
  lines: Seg[];
  /** Dashed lines (passage header). */
  dashed: Seg[];
  /** Door leaves, each from its hinge, perpendicular to the wall: one, or two for a double door. */
  leaves: Seg[];
  /** Each leaf's swing arc from its tip to where it closes, centered on its hinge. */
  arcs: SwingArc[];
}

export interface SwingArc {
  from: Vec2;
  to: Vec2;
  center: Vec2;
  r: number;
  sweep: 0 | 1;
}

/** Point at distance s along the centerline and `off` along the left normal. */
export const wallPoint = (g: WallGeom, s: number, off: number): Vec2 =>
  add(add(g.a, scale(g.dir, s)), scale(g.normal, off));

/** Where an opening is drawn: its offset clamped to the wall's core interval. */
export const displayCenter = (g: WallGeom, o: Pick<Opening, 'offset' | 'width'>): number =>
  clampOpeningOffset(o.offset, o.width, g.s0, g.s1);

export function openingSymbol(
  g: WallGeom,
  o: Pick<Opening, 'type' | 'offset' | 'width' | 'swing' | 'sliding' | 'sashes'>,
): OpeningSymbol {
  const center = displayCenter(g, o);
  const w = Math.min(o.width, g.s1 - g.s0);
  const j0 = center - w / 2;
  const j1 = center + w / 2;
  const h = g.thickness / 2;
  const gap: OpeningSymbol['gap'] = [wallPoint(g, j0, h), wallPoint(g, j1, h), wallPoint(g, j1, -h), wallPoint(g, j0, -h)];
  const sym: OpeningSymbol = { center, j0, j1, gap, lines: [], dashed: [], leaves: [], arcs: [] };
  if (o.type === 'window') {
    for (const off of [h, 0, -h]) sym.lines.push([wallPoint(g, j0, off), wallPoint(g, j1, off)]);
  } else if (o.type === 'passage') {
    for (const off of [h, -h]) sym.dashed.push([wallPoint(g, j0, off), wallPoint(g, j1, off)]);
  } else if (isSlidingDoor(o)) {
    // A sliding door: its two panels, one in each track a third of the way out from the
    // centerline, each from its jamb to SLIDING_LAP / 2 past the middle; no leaf and no swing.
    const mid = (j0 + j1) / 2;
    const lap = Math.min(SLIDING_LAP, w / 4) / 2;
    sym.lines.push([wallPoint(g, j0, h / 3), wallPoint(g, mid + lap, h / 3)], [wallPoint(g, mid - lap, -h / 3), wallPoint(g, j1, -h / 3)]);
  } else {
    const swing = o.swing ?? { hinge: 'a', side: 'left' };
    const side = swing.side === 'left' ? 1 : -1;
    // A double door (two leaves) hangs a half-width leaf on each jamb, meeting in the middle.
    const mid = (j0 + j1) / 2;
    const hung: [number, number][] = o.sashes === 2 ? [[j0, mid], [j1, mid]] : [swing.hinge === 'a' ? [j0, j1] : [j1, j0]];
    for (const [sh, sj] of hung) {
      const r = Math.abs(sj - sh);
      const hinge = wallPoint(g, sh, side * h);
      const tip = add(hinge, scale(g.normal, side * r));
      const strike = wallPoint(g, sj, side * h);
      sym.leaves.push([hinge, tip]);
      sym.arcs.push({ from: tip, to: strike, center: hinge, r, sweep: cross(sub(tip, hinge), sub(strike, hinge)) > 0 ? 1 : 0 });
    }
  }
  return sym;
}

/** SVG path for an opening symbol's arc. */
export const arcPath = (arc: SwingArc, map: (p: Vec2) => Vec2 = (p) => p, r = arc.r): string => {
  const f = map(arc.from);
  const t = map(arc.to);
  return `M${f.x},${f.y}A${r},${r} 0 0 ${arc.sweep} ${t.x},${t.y}`;
};

export interface WallPieces {
  /** Fill polygons, one per solid piece. */
  fills: Vec2[][];
  /** Long edges of each piece, jamb lines at every gap, and the outline's drawn end segments. */
  edges: Seg[];
  /** Gaps that were cut, merged and sorted, as [j0, j1] intervals. */
  gaps: [number, number][];
}

/** The parts of a footprint outline wallPieces needs; everything but the quad is optional. */
export type WallOutline = Pick<Footprint, 'quad'> & Partial<Pick<Footprint, 'capA' | 'capB' | 'edge' | 'capEdges'>>;

/**
 * Split a wall outline into solid pieces around the given gaps (intervals along the centerline).
 * The first and last pieces keep the footprint's own end corners and extra cap points (mitres,
 * bevels, junction hubs). Long edges follow `outline.edge` (trimmed at T junctions); end caps are
 * drawn only where the outline says so (`capEdges`: open ends and bevels), never at joins.
 */
export function wallPieces(
  g: WallGeom,
  outlineIn: WallOutline | readonly [Vec2, Vec2, Vec2, Vec2],
  gapsIn: readonly [number, number][],
): WallPieces {
  const outline: WallOutline = Array.isArray(outlineIn)
    ? { quad: outlineIn as unknown as Footprint['quad'] }
    : (outlineIn as WallOutline);
  const [la, lb, rb, ra] = outline.quad;
  const [ela, elb, erb, era] = outline.edge ?? outline.quad;
  const capA = outline.capA ?? [];
  const capB = outline.capB ?? [];
  const h = g.thickness / 2;
  const sorted = gapsIn
    .map(([u, v]): [number, number] => [Math.max(u, 0), Math.min(v, g.length)])
    .filter(([u, v]) => v - u > 1e-6)
    .sort((p, q) => p[0] - q[0]);
  const gaps: [number, number][] = [];
  for (const gp of sorted) {
    const last = gaps[gaps.length - 1];
    if (last && gp[0] <= last[1]) last[1] = Math.max(last[1], gp[1]);
    else gaps.push([gp[0], gp[1]]);
  }
  const along = (p: Vec2) => dot(sub(p, g.a), g.dir);
  const fills: Vec2[][] = [];
  const edges: Seg[] = [];
  // A long edge, skipped when trimming left nothing of it.
  const pushEdge = (p: Vec2, q: Vec2) => {
    if (along(q) - along(p) > 1e-9) edges.push([p, q]);
  };
  let start = 0;
  const ends = [...gaps.map(([u]) => u), g.length];
  ends.forEach((end, i) => {
    const first = i === 0;
    const last = i === ends.length - 1;
    const l0 = first ? la : wallPoint(g, start, h);
    const r0 = first ? ra : wallPoint(g, start, -h);
    const l1 = last ? lb : wallPoint(g, end, h);
    const r1 = last ? rb : wallPoint(g, end, -h);
    if (end - start > 1e-6 || first || last) {
      fills.push([l0, l1, ...(last ? capB : []), r1, r0, ...(first ? capA : [])]);
      pushEdge(first ? ela : l0, last ? elb : l1);
      pushEdge(first ? era : r0, last ? erb : r1);
    }
    if (!first) edges.push([l0, r0]);
    if (!last) edges.push([l1, r1]);
    if (!last) start = gaps[i][1];
  });
  edges.push(...(outline.capEdges ?? []));
  return { fills, edges, gaps };
}

/**
 * True when p is in the opening's own rectangle: the hole between its jambs, across the wall
 * thickness, grown by `margin` on every side. Elsewhere on the wall the wall is what is hit.
 */
export function hitOpeningRect(g: WallGeom, o: Opening, p: Vec2, margin: number): boolean {
  const sym = openingSymbol(g, o);
  const rel = sub(p, g.a);
  const s = dot(rel, g.dir);
  const off = dot(rel, g.normal);
  return s >= sym.j0 - margin && s <= sym.j1 + margin && Math.abs(off) <= g.thickness / 2 + margin;
}

/** True when p is on a door's leaf or swing arc (within pickRadius). */
export function hitOpeningSwing(g: WallGeom, o: Opening, p: Vec2, pickRadius: number): boolean {
  const sym = openingSymbol(g, o);
  for (const [hinge, tip] of sym.leaves) {
    const d = sub(tip, hinge);
    const len2 = dot(d, d);
    const t = Math.max(0, Math.min(1, dot(sub(p, hinge), d) / len2));
    if (dist(p, add(hinge, scale(d, t))) <= pickRadius) return true;
  }
  for (const { center, from, to, r } of sym.arcs) {
    const v = sub(p, center);
    // Inside the quarter: between the leaf direction and the wall direction toward the strike.
    if (Math.abs(dist(p, center) - r) <= pickRadius && dot(v, sub(from, center)) >= -1e-9 && dot(v, sub(to, center)) >= -1e-9)
      return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Openings grouped by wall, memoized per openings record. A wall's list keeps its identity while
// its openings are unchanged, so wall components re-render only when their own openings change.

const EMPTY: readonly Opening[] = Object.freeze([]);
const byWallCache = new WeakMap<Level['openings'], ReadonlyMap<Id, readonly Opening[]>>();
const previousByLevel = new Map<Id, ReadonlyMap<Id, readonly Opening[]>>();

export function getOpeningsByWall(level: Level): ReadonlyMap<Id, readonly Opening[]> {
  const hit = byWallCache.get(level.openings);
  if (hit) return hit;
  const groups = new Map<Id, Opening[]>();
  for (const o of Object.values(level.openings)) {
    const list = groups.get(o.wallId);
    if (list) list.push(o);
    else groups.set(o.wallId, [o]);
  }
  const prev = previousByLevel.get(level.id);
  const out = new Map<Id, readonly Opening[]>();
  for (const [wallId, list] of groups) {
    const old = prev?.get(wallId);
    out.set(wallId, old && old.length === list.length && old.every((o, i) => o === list[i]) ? old : list);
  }
  byWallCache.set(level.openings, out);
  previousByLevel.set(level.id, out);
  return out;
}

/** Drop the previous-result entries of levels that are gone (see forgetFootprintLevels). */
export function forgetOpeningLevels(alive: ReadonlySet<Id>): void {
  for (const id of previousByLevel.keys()) if (!alive.has(id)) previousByLevel.delete(id);
}

/** Number of levels with a previous result (tests). */
export const openingLevelCount = (): number => previousByLevel.size;

/** Forget per-level-id derive state of levels that are not in `plan` any more. */
export function pruneDerivedCaches(plan: Pick<Plan, 'levelOrder'>): void {
  const alive = new Set(plan.levelOrder);
  forgetFootprintLevels(alive);
  forgetOpeningLevels(alive);
}

export const openingsOnWall = (level: Level, wallId: Id): readonly Opening[] =>
  getOpeningsByWall(level).get(wallId) ?? EMPTY;

// ---------------------------------------------------------------------------------------------
// Core interval for an opening, independent of the UI's view mode.

/** Footprints of a level per view mode. */
export type FootprintSource = (viewMode: ViewMode) => Footprints;

/** Memoized source for committed (non-draft) levels. */
export const liveFootprints =
  (level: Level): FootprintSource =>
  (viewMode) =>
    getFootprints(level, viewMode);

/**
 * Unmemoized source for immer drafts (a draft keeps its identity while it is mutated, so it must
 * never key a cache). Computes each view once per source.
 */
export function draftFootprints(level: Pick<Level, 'nodes' | 'walls'>): FootprintSource {
  const byMode = new Map<ViewMode, Footprints>();
  return (viewMode) => {
    let fps = byMode.get(viewMode);
    if (!fps) {
      fps = computeFootprints(level, viewMode);
      byMode.set(viewMode, fps);
    }
    return fps;
  };
}

const PHASE_VIEWS: readonly ViewMode[] = ['existing', 'proposed'];

/**
 * Where an opening of `phase` may sit on a wall: the intersection of the wall's core interval
 * [s0, s1] over every view in which the opening shows (existing and/or proposed), so it clears the
 * corners in each of them. Falls back to the "all" view (an opening that shows in neither), and to
 * [0, L] if the wall has no footprint. Null when the wall does not exist.
 */
export function coreInterval(
  level: Pick<Level, 'nodes' | 'walls'>,
  wallId: Id,
  phase: Phase,
  source: FootprintSource,
): [number, number] | null {
  const wall = level.walls[wallId];
  if (!wall) return null;
  let views = PHASE_VIEWS.filter((vm) => isVisible(phase, vm) && isVisible(wall.phase, vm));
  if (views.length === 0) views = ['all'];
  let s0 = -Infinity;
  let s1 = Infinity;
  for (const vm of views) {
    const fp = source(vm).get(wallId);
    if (!fp) continue;
    s0 = Math.max(s0, fp.s0);
    s1 = Math.min(s1, fp.s1);
  }
  if (s0 === -Infinity) {
    const a = level.nodes[wall.a];
    const b = level.nodes[wall.b];
    return [0, a && b ? dist(a, b) : 0];
  }
  return [s0, s1];
}

/** Distances from the core interval ends (inside faces of the corners) to the nearer jambs. */
export function jambDistances(
  offset: number,
  width: number,
  [s0, s1]: readonly [number, number],
): { fromA: number; fromB: number } {
  return { fromA: offset - width / 2 - s0, fromB: s1 - (offset + width / 2) };
}
