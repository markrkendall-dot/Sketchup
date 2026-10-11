import { add, cross, dist, dot, midpoint, projectPointToSegment, scale, sub } from '../model/geometry';
import { isVisible, visibleNodeIds } from '../derive/phase';
import type { Id, Level, Vec2, ViewMode } from '../model/types';
import type { Guide, SnapResult } from '../store/uiStore';

/** Snap radii in screen pixels (divided by the zoom to get inches). */
export const SNAP_RADIUS_PX = { node: 10, midpoint: 8, wall: 8, guide: 6 } as const;
/** With ortho/angle lock, node and wall snaps must lie within this many inches of the axis. */
export const AXIS_TOLERANCE = 1;
export const ANGLE_STEP_DEG = 15;

export interface SnapContext {
  level: Pick<Level, 'nodes' | 'walls'>;
  /** Zoom, px per inch. */
  k: number;
  snapGrid: number;
  orthoLock: boolean;
  /** Shift held: inverts ortho lock; with ortho off, snaps to 15 degree steps. */
  shift: boolean;
  /** Start point of the segment being drawn, enabling ortho/angle constraints. */
  from?: Vec2 | null;
  excludeNodeIds?: ReadonlySet<Id>;
  excludeWallIds?: ReadonlySet<Id>;
  /** When given, walls hidden in this view (and nodes touching only hidden walls) never snap. */
  viewMode?: ViewMode;
  /**
   * Nodes of the level below that are visible in the ghost (the caller applies the view mode).
   * They snap after this level's own node, midpoint and on-wall snaps and before alignment guides,
   * and always give a new point on this level: the result carries no node id.
   */
  ghostNodes?: readonly Vec2[];
  /** Centerlines of the level below's visible walls, for ghost-wall snaps (same ranking). */
  ghostWalls?: readonly GhostWall[];
}

/** A wall of the level below, by its end points. */
export interface GhostWall {
  a: Vec2;
  b: Vec2;
}

interface Line {
  origin: Vec2;
  dir: Vec2; // unit
}

function constraintLine(raw: Vec2, ctx: SnapContext): { line: Line; kind: 'ortho' | 'angle' } | null {
  const from = ctx.from;
  if (!from) return null;
  // Ortho lock on: Shift frees the cursor. Ortho lock off: Shift snaps to 15 degree steps
  // (a superset of the ortho directions).
  const d = sub(raw, from);
  if (ctx.orthoLock && !ctx.shift) {
    return {
      line: { origin: from, dir: Math.abs(d.x) >= Math.abs(d.y) ? { x: 1, y: 0 } : { x: 0, y: 1 } },
      kind: 'ortho',
    };
  }
  if (!ctx.orthoLock && ctx.shift) {
    const step = (ANGLE_STEP_DEG * Math.PI) / 180;
    const ang = Math.round(Math.atan2(d.y, d.x) / step) * step;
    // Snap tiny float noise so 90/180 degrees give exact axes.
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);
    return { line: { origin: from, dir: { x: clean(c), y: clean(s) } }, kind: 'angle' };
  }
  return null;
}

const projectOnLine = (p: Vec2, l: Line): Vec2 => add(l.origin, scale(l.dir, dot(sub(p, l.origin), l.dir)));
const distToLine = (p: Vec2, l: Line): number => Math.abs(cross(l.dir, sub(p, l.origin)));

/** Intersection of an infinite line with segment a-b (closed), or null. */
function lineSegment(l: Line, a: Vec2, b: Vec2): Vec2 | null {
  const s = sub(b, a);
  const denom = cross(l.dir, s);
  if (Math.abs(denom) < 1e-12) return null;
  // Solve origin + dir*t = a + s*u for the segment parameter u.
  const u = cross(l.dir, sub(l.origin, a)) / denom;
  if (u < 0 || u > 1) return null;
  return add(a, scale(s, u));
}

const roundTo = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v);

/**
 * Snap a raw world point. Priority: node > wall midpoint > on-wall > level-below node > level-below wall > alignment guide > grid.
 * Pure function of its inputs (see docs/DESIGN.md "Snapping").
 */
export function snapPoint(raw: Vec2, ctx: SnapContext): SnapResult {
  const r = (px: number) => px / ctx.k;
  const c = constraintLine(raw, ctx);
  const line = c?.line ?? null;
  const target = line ? projectOnLine(raw, line) : raw;
  const onLine = (p: Vec2) => !line || distToLine(p, line) <= AXIS_TOLERANCE;
  const viewMode = ctx.viewMode;
  const shownNodes = viewMode ? visibleNodeIds(ctx.level, viewMode) : null;
  const nodes = Object.values(ctx.level.nodes).filter(
    (n) => !ctx.excludeNodeIds?.has(n.id) && (!shownNodes || shownNodes.has(n.id)),
  );
  const walls = Object.values(ctx.level.walls).filter(
    (w) =>
      (!viewMode || isVisible(w.phase, viewMode)) &&
      !ctx.excludeWallIds?.has(w.id) &&
      !ctx.excludeNodeIds?.has(w.a) &&
      !ctx.excludeNodeIds?.has(w.b) &&
      ctx.level.nodes[w.a] &&
      ctx.level.nodes[w.b],
  );

  // 1. Nodes.
  let bestD = r(SNAP_RADIUS_PX.node);
  let nodeHit: (typeof nodes)[number] | null = null;
  for (const n of nodes) {
    const d = dist(n, target);
    if (d <= bestD && onLine(n)) {
      bestD = d;
      nodeHit = n;
    }
  }
  if (nodeHit) {
    return { point: { x: nodeHit.x, y: nodeHit.y }, kind: 'node', nodeId: nodeHit.id, guides: [] };
  }

  // 2. Wall midpoints.
  bestD = r(SNAP_RADIUS_PX.midpoint);
  let mid: { p: Vec2; wallId: Id } | null = null;
  for (const w of walls) {
    const m = midpoint(ctx.level.nodes[w.a], ctx.level.nodes[w.b]);
    const d = dist(m, target);
    if (d <= bestD && onLine(m)) {
      bestD = d;
      mid = { p: m, wallId: w.id };
    }
  }
  if (mid) return { point: mid.p, kind: 'midpoint', wallId: mid.wallId, guides: [] };

  // 3. On-wall projection (or, when constrained, where the axis crosses the wall).
  bestD = r(SNAP_RADIUS_PX.wall);
  let onWall: { p: Vec2; wallId: Id } | null = null;
  for (const w of walls) {
    const a = ctx.level.nodes[w.a];
    const b = ctx.level.nodes[w.b];
    const pr = projectPointToSegment(target, a, b);
    let p: Vec2 | null = pr.tRaw > 0 && pr.tRaw < 1 && onLine(pr.point) ? pr.point : null;
    if (!p && line) {
      const x = lineSegment(line, a, b);
      if (x && dist(x, a) > 1e-6 && dist(x, b) > 1e-6) p = x;
    }
    if (!p) continue;
    const d = dist(p, target);
    if (d <= bestD) {
      bestD = d;
      onWall = { p, wallId: w.id };
    }
  }
  if (onWall) return { point: onWall.p, kind: 'wall', wallId: onWall.wallId, guides: [] };

  // 3b. The level below (ghost): its corners, then its wall centerlines. Same radii as the
  // level's own; the point is new on this level, never a reference to the other level's ids.
  if (ctx.ghostNodes && ctx.ghostNodes.length > 0) {
    bestD = r(SNAP_RADIUS_PX.node);
    let ghost: Vec2 | null = null;
    for (const n of ctx.ghostNodes) {
      const d = dist(n, target);
      if (d <= bestD && onLine(n)) {
        bestD = d;
        ghost = n;
      }
    }
    if (ghost) return { point: { x: ghost.x, y: ghost.y }, kind: 'ghost-node', guides: [] };
  }
  if (ctx.ghostWalls && ctx.ghostWalls.length > 0) {
    bestD = r(SNAP_RADIUS_PX.wall);
    let ghostOnWall: Vec2 | null = null;
    for (const w of ctx.ghostWalls) {
      const pr = projectPointToSegment(target, w.a, w.b);
      let p: Vec2 | null = pr.tRaw > 0 && pr.tRaw < 1 && onLine(pr.point) ? pr.point : null;
      if (!p && line) {
        const x = lineSegment(line, w.a, w.b);
        if (x && dist(x, w.a) > 1e-6 && dist(x, w.b) > 1e-6) p = x;
      }
      if (!p) continue;
      const d = dist(p, target);
      if (d <= bestD) {
        bestD = d;
        ghostOnWall = p;
      }
    }
    if (ghostOnWall) return { point: ghostOnWall, kind: 'ghost-wall', guides: [] };
  }

  // 4. Alignment guides to any node's x or y.
  const sources: Vec2[] = nodes.map((n) => ({ x: n.x, y: n.y }));
  const guideR = r(SNAP_RADIUS_PX.guide);
  if (line) {
    let best: { p: Vec2; guide: Guide; d: number } | null = null;
    for (const s of sources) {
      if (line.dir.x !== 0) {
        const t = (s.x - line.origin.x) / line.dir.x;
        const p = add(line.origin, scale(line.dir, t));
        const d = dist(p, target);
        if (d <= guideR && (!best || d < best.d) && Math.abs(p.y - s.y) > 1e-9)
          best = { p, guide: { from: s, to: p }, d };
      }
      if (line.dir.y !== 0) {
        const t = (s.y - line.origin.y) / line.dir.y;
        const p = add(line.origin, scale(line.dir, t));
        const d = dist(p, target);
        if (d <= guideR && (!best || d < best.d) && Math.abs(p.x - s.x) > 1e-9)
          best = { p, guide: { from: s, to: p }, d };
      }
    }
    if (best) return { point: best.p, kind: 'guide', guides: [best.guide] };
  } else {
    if (ctx.from) sources.push(ctx.from);
    let bx: Vec2 | null = null;
    let by: Vec2 | null = null;
    for (const s of sources) {
      const dx = Math.abs(s.x - raw.x);
      const dy = Math.abs(s.y - raw.y);
      if (dx <= guideR && (!bx || dx < Math.abs(bx.x - raw.x))) bx = s;
      if (dy <= guideR && (!by || dy < Math.abs(by.y - raw.y))) by = s;
    }
    if (bx || by) {
      const point = {
        x: bx ? bx.x : roundTo(raw.x, ctx.snapGrid),
        y: by ? by.y : roundTo(raw.y, ctx.snapGrid),
      };
      const guides: Guide[] = [];
      if (bx) guides.push({ from: bx, to: point });
      if (by) guides.push({ from: by, to: point });
      return { point, kind: 'guide', guides };
    }
  }

  // 5. Grid (along the constraint when there is one).
  if (line && c) {
    if (c.kind === 'ortho') {
      const point =
        line.dir.x !== 0
          ? { x: roundTo(target.x, ctx.snapGrid), y: line.origin.y }
          : { x: line.origin.x, y: roundTo(target.y, ctx.snapGrid) };
      return { point, kind: ctx.snapGrid > 0 ? 'grid' : 'none', guides: [] };
    }
    const t = roundTo(dot(sub(target, line.origin), line.dir), ctx.snapGrid);
    return { point: add(line.origin, scale(line.dir, t)), kind: 'angle', guides: [] };
  }
  if (ctx.snapGrid > 0) {
    return {
      point: { x: roundTo(raw.x, ctx.snapGrid), y: roundTo(raw.y, ctx.snapGrid) },
      kind: 'grid',
      guides: [],
    };
  }
  return { point: { ...raw }, kind: 'none', guides: [] };
}
