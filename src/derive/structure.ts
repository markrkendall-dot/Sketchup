// Which walls bear (DESIGN.md "Structure"): a wall's own flag, else inferred from what is over it,
// level by level from the top down. Pure; memoized per plan and view.
//
// A wall is likely bearing when:
//   - it is marked so (a mark either way wins);
//   - it is an exterior wall that the joists over it cross (they bear on it), or whose joists are
//     not set (it may);
//   - a bearing wall on the level above stands on it (parallel, within the joists' depth: R502.4),
//     a post on the level above stands in it, or a beam's end over this level bears in it;
//   - it is an existing interior wall at least 4' long (its collinear run) that the joists over it
//     cross, and without it they would span more than 14' between the walls and beams that cross
//     them. A new wall never becomes bearing by span alone: what a new wall carries is designed.
// The words say "likely": the inference is a prompt to look, the engineer decides.

import { add, cross, dist, dot, normalize, pointInPolygon, scale, sub } from '../model/geometry';
import type { Id, Level, Plan, Vec2, ViewMode, Wall } from '../model/types';
import { formatLength } from '../model/units';
import { getFootprints } from './footprint';
import { joistDepth, joistsAt } from './members';
import { isVisible } from './phase';

/** Joists spanning more than this without a wall would likely need it, inches (14'). */
export const SPAN_LIMIT = 168;
/** A wall shorter than this (its collinear run) is a stub, not a support, inches. */
export const MIN_BEARING_RUN = 48;
/** Walls within this angle of each other are parallel (sine of 10°). */
const PARALLEL_SIN = Math.sin((10 * Math.PI) / 180);
/** A wall over another must overlap it this much to stand on it, inches. */
const MIN_OVERLAP = 12;

export interface WallBearing {
  bearing: boolean;
  /** Why, in a few words ("an exterior wall", "joists cross it mid-span: 25'-8\" without it"). */
  reason: string;
  /** The wall's own mark, not an inference. */
  explicit: boolean;
}

export type BearingView = 'existing' | 'proposed';

/** level id -> wall id -> bearing, for the walls shown in the view. */
export type WallBearings = Record<Id, Map<Id, WallBearing>>;

const cache = new WeakMap<Plan, Partial<Record<BearingView, WallBearings>>>();

export interface Segment {
  a: Vec2;
  b: Vec2;
}

/** A wall's centerline, or null when a node is missing. */
export function wallSegment(level: Level, w: Wall): Segment | null {
  const a = level.nodes[w.a];
  const b = level.nodes[w.b];
  return a && b ? { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } } : null;
}

const dirOf = (s: Segment) => normalize(sub(s.b, s.a));
export const isParallel = (u: Vec2, v: Vec2) => Math.abs(cross(u, v)) < PARALLEL_SIN;
/** Whether a line along `d` crosses joists along `j` (at 45° or more). */
const crossesJoists = (d: Vec2, j: Vec2) => Math.abs(cross(d, j)) >= Math.SQRT1_2;
export const joistVector = (deg: number): Vec2 => ({ x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) });

/** Distance along a ray from p in direction d to segment s, or Infinity. */
function rayToSegment(p: Vec2, d: Vec2, s: Segment): number {
  const e = sub(s.b, s.a);
  const denom = cross(d, e);
  if (Math.abs(denom) < 1e-9) return Infinity;
  const ap = sub(s.a, p);
  const t = cross(ap, e) / denom;
  const u = cross(ap, d) / denom;
  return t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 ? t : Infinity;
}

/** The length of the run of collinear walls shown in the view that a wall is part of. */
function collinearRun(level: Level, w: Wall, viewMode: ViewMode): number {
  const seg = wallSegment(level, w);
  if (!seg) return 0;
  const d = dirOf(seg);
  const shown = Object.values(level.walls).filter((o) => isVisible(o.phase, viewMode));
  const seen = new Set<Id>([w.id]);
  let total = dist(seg.a, seg.b);
  const walk = (node: Id) => {
    for (;;) {
      const next = shown.find((o) => !seen.has(o.id) && (o.a === node || o.b === node) && (() => {
        const s = wallSegment(level, o);
        return !!s && isParallel(dirOf(s), d);
      })());
      if (!next) return;
      seen.add(next.id);
      const s = wallSegment(level, next)!;
      total += dist(s.a, s.b);
      node = next.a === node ? next.b : next.a;
    }
  };
  walk(w.a);
  walk(w.b);
  return total;
}

/** Whether wall `upper` (one level up) stands on `lower`: parallel, within `offset`, overlapping. */
function standsOn(upper: Segment, lower: Segment, offset: number): boolean {
  const d = dirOf(lower);
  if (!isParallel(dirOf(upper), d)) return false;
  const n = { x: -d.y, y: d.x };
  const off = (p: Vec2) => Math.abs(dot(sub(p, lower.a), n));
  if (Math.max(off(upper.a), off(upper.b)) > offset + 0.01) return false;
  const len = dist(lower.a, lower.b);
  const t0 = dot(sub(upper.a, lower.a), d);
  const t1 = dot(sub(upper.b, lower.a), d);
  return Math.min(len, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)) >= Math.min(MIN_OVERLAP, len);
}

/** The walls and beams that cross joists along `j` on a level in a view, but `skip`. */
function crossingSupports(plan: Plan, levelId: Id, j: Vec2, viewMode: ViewMode, skip: Id): Segment[] {
  const level = plan.levels[levelId];
  const out: Segment[] = [];
  for (const w of Object.values(level.walls)) {
    if (w.id === skip || !isVisible(w.phase, viewMode)) continue;
    const s = wallSegment(level, w);
    if (s && crossesJoists(dirOf(s), j)) out.push(s);
  }
  for (const m of Object.values(level.members ?? {})) {
    if (m.kind === 'beam' && isVisible(m.phase, viewMode) && crossesJoists(dirOf(m), j)) out.push({ a: m.a, b: m.b });
  }
  return out;
}

/**
 * The span the joists over a wall would have without it, the most over points a quarter, half and
 * three quarters along it; null when the joists run along it or are not known there.
 */
export function spanWithout(plan: Plan, levelId: Id, w: Wall, viewMode: ViewMode): number | null {
  const level = plan.levels[levelId];
  const seg = wallSegment(level, w);
  if (!seg) return null;
  let most: number | null = null;
  for (const t of [0.25, 0.5, 0.75]) {
    const p = add(seg.a, scale(sub(seg.b, seg.a), t));
    const joists = joistsAt(plan, levelId, p, viewMode);
    if (!joists) continue;
    const j = joistVector(joists.joists);
    if (!crossesJoists(dirOf(seg), j)) continue;
    const supports = crossingSupports(plan, levelId, j, viewMode, w.id);
    const near = (d: Vec2) => Math.min(...supports.map((s) => rayToSegment(p, d, s)));
    const span = near(j) + near(scale(j, -1));
    most = Math.max(most ?? 0, span);
  }
  return most;
}

/** Every shown wall's bearing in a view, the top level first (each level looks at the one above). */
export function wallBearings(plan: Plan, view: BearingView): WallBearings {
  let byView = cache.get(plan);
  if (!byView) cache.set(plan, (byView = {}));
  const hit = byView[view];
  if (hit) return hit;
  const out: WallBearings = {};
  const fmt = (v: number) => formatLength(v, plan.settings.precisionDenominator);
  for (let i = plan.levelOrder.length - 1; i >= 0; i--) {
    const levelId = plan.levelOrder[i];
    const level = plan.levels[levelId];
    const map = new Map<Id, WallBearing>();
    out[levelId] = map;
    if (!level) continue;
    const aboveId = plan.levelOrder[i + 1];
    const above = aboveId ? plan.levels[aboveId] : undefined;
    const fps = getFootprints(level, view);
    const depth = joistDepth(plan, levelId);
    const bearingAbove: Segment[] = [];
    const postsAbove: Vec2[] = [];
    if (above) {
      for (const u of Object.values(above.walls)) {
        if (!isVisible(u.phase, view) || !out[aboveId].get(u.id)?.bearing) continue;
        const s = wallSegment(above, u);
        if (s) bearingAbove.push(s);
      }
      for (const m of Object.values(above.members ?? {})) if (m.kind === 'post' && isVisible(m.phase, view)) postsAbove.push(m.at);
    }
    const beamEnds = Object.values(level.members ?? {}).flatMap((m) => (m.kind === 'beam' && isVisible(m.phase, view) ? [m.a, m.b] : []));
    for (const w of Object.values(level.walls)) {
      if (!isVisible(w.phase, view)) continue;
      if (w.bearing !== undefined) {
        map.set(w.id, { bearing: w.bearing, reason: w.bearing ? 'marked bearing' : 'marked not bearing', explicit: true });
        continue;
      }
      const set = (bearing: boolean, reason: string) => map.set(w.id, { bearing, reason, explicit: false });
      const seg = wallSegment(level, w);
      const poly = fps.get(w.id)?.poly;
      if (!seg || !poly) {
        set(false, 'not bearing');
        continue;
      }
      if (w.kind === 'exterior') {
        const joists = joistsAt(plan, levelId, scale(add(seg.a, seg.b), 0.5), view);
        if (!joists) {
          set(true, 'an exterior wall, the joists over it not set');
          continue;
        }
        if (crossesJoists(dirOf(seg), joistVector(joists.joists))) {
          set(true, 'an exterior wall the joists bear on');
          continue;
        }
      }
      if (bearingAbove.some((u) => standsOn(u, seg, depth))) {
        set(true, 'a bearing wall above stands on it');
        continue;
      }
      if (postsAbove.some((p) => pointInPolygon(p, poly))) {
        set(true, 'a post above stands on it');
        continue;
      }
      if (beamEnds.some((p) => pointInPolygon(p, poly))) {
        set(true, "a beam's end bears on it");
        continue;
      }
      if (w.kind === 'interior' && w.phase !== 'new' && collinearRun(level, w, view) >= MIN_BEARING_RUN) {
        const span = spanWithout(plan, levelId, w, view);
        if (span !== null && span > SPAN_LIMIT) {
          set(true, `the joists cross it mid-span (${Number.isFinite(span) ? fmt(span) : 'open'} without it)`);
          continue;
        }
      }
      set(false, w.kind === 'exterior' ? 'an exterior wall along the joists' : 'not bearing');
    }
  }
  byView[view] = out;
  return out;
}

/**
 * A wall's bearing as a view shows it: the house as it stands for a demolished wall or in the
 * Existing view, the house after the work otherwise.
 */
export function bearingOf(plan: Plan, levelId: Id, w: Wall, viewMode: ViewMode): WallBearing | undefined {
  const view: BearingView = viewMode === 'existing' || w.phase === 'demo' ? 'existing' : 'proposed';
  return wallBearings(plan, view)[levelId]?.get(w.id);
}
