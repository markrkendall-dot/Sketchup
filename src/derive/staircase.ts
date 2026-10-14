// A staircase's parts (DESIGN.md "Staircases"): its pieces' treads, carcass and framing, its rails,
// newels and balusters, a bullnose first step, posts under a framed landing, and panels that close
// the gap over a wall that stands under it. Pure (no three.js): every part is a vertical prism over a
// plan polygon between two height fields (meshes.ts builds them with slopedPrismPositions), in the
// level's own heights (0 at its floor top).
//
// A piece's surface (its treads, a landing's top) is the one stairs.ts and the checks use; the tread
// boards sit on a carcass lowered by their thickness and overhang each riser by the nosing, so no two
// faces lie on each other facing the same way.

import { add, clipHalfPlane, dot, pointInPolygon, polygonSignedArea, scale, sub } from '../model/geometry';
import { wallHeightOf } from '../model/openings';
import { staircaseStyleOf, type StairStyle } from '../model/stairStyle';
import type { Id, Level, Plan, Stairs, Vec2, ViewMode } from '../model/types';
import { getFootprints } from './footprint';
import { isVisible, phasesCoexist } from './phase';
import { flightLinks, stairChains, stairsTop } from './stairChain';
import { flightSteps, floorToFloor, stairsBase, stairsFrame, stairsOutline, stairsPoint, type StairsFrame } from './stairs';

/** Sizes, inches. */
export const STAIRCASE = {
  /** Box newel: body and its cap; a square newel is the deck rail's post, capped flush. */
  boxNewel: 5.5,
  boxCap: 7,
  squareNewel: 3.5,
  capThick: 1.5,
  /** How far a newel stands over the handrail it takes. */
  newelAbove: 4,
  /** Round handrail (Type I, drawn square): 2"; a board: 3 1/2" x 1 1/2". */
  roundRail: 2,
  boardRail: 3.5,
  boardRailThick: 1.5,
  baluster: 1.25,
  /** A framed underside: the framing under the treads, square to the slope, and a landing's frame. */
  frame: 9.25,
  landingPost: 3.5,
  /** A piece this high or less stays solid whatever the style (a platform, a first step). */
  solidUnder: 12,
  /** The bullnose's radius round the starting newel's centre (the tread's, plus the nosing). */
  bullnose: 8,
  /** A spandrel thinner than this over a wall's top is left out. */
  minPanel: 0.1,
} as const;

/** A height field: z = max(min, c + g . p). */
export interface HeightFn {
  c: number;
  g: Vec2;
  min?: number;
}
export const heightAt = (h: HeightFn, p: Vec2): number => Math.max(h.min ?? -Infinity, h.c + h.g.x * p.x + h.g.y * p.y);
const level = (z: number): HeightFn => ({ c: z, g: { x: 0, y: 0 } });

/** What a part is painted: tread colour (treads, handrail, newel caps) or the paint (the rest). */
export type StairPartMat = 'tread' | 'paint';
/** Which group a part belongs to: the stair itself, its framing and panels, or its railing. */
export type StairPartGroup = 'stair' | 'frame' | 'rail';

export interface StairSolid {
  poly: Vec2[];
  zb: HeightFn;
  zt: HeightFn;
  mat: StairPartMat;
  group: StairPartGroup;
}

export interface StairNewelPart {
  at: Vec2;
  bottom: number;
  top: number;
  size: number;
}

/** A handrail between two newels' faces: its top line (for the plan and the walk). */
export interface StairRail {
  a: Vec2;
  b: Vec2;
  za: number;
  zb: number;
}

export interface StaircaseLayout {
  sig: string;
  style: StairStyle;
  /** The pieces in stairway order (stairChain.ts), then any that do not chain. */
  members: Id[];
  /** Pieces not joined to another piece of the staircase (a staircase of more than one). */
  loose: Id[];
  solids: StairSolid[];
  newels: StairNewelPart[];
  rails: StairRail[];
  /** The bullnose's plan outline, when the first step is one. */
  bullnose: Vec2[] | null;
  landingPosts: Vec2[];
  /** Walls under a piece that rise into it (the stair or the wall must change). */
  wallsThrough: { wallId: Id; stairsId: Id; room: number }[];
  /** Each piece's underside over the level's floor: null when it is solid to the floor. */
  undersides: Record<Id, HeightFn | null>;
}

const EPS = 1e-6;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** A rectangle in a piece's frame: along [a0, a1], to the right of travel [l0, l1]. */
const frameRect = (f: StairsFrame, a0: number, a1: number, l0: number, l1: number): Vec2[] => [
  stairsPoint(f, a0, l0),
  stairsPoint(f, a1, l0),
  stairsPoint(f, a1, l1),
  stairsPoint(f, a0, l1),
];

/** A plane in a piece's frame: z = z0 + slope * along. */
function alongPlane(f: StairsFrame, z0: number, slope: number, min?: number): HeightFn {
  const h: HeightFn = { c: z0 - slope * dot(f.origin, f.u), g: scale(f.u, slope) };
  if (min !== undefined) h.min = min;
  return h;
}

const square = (at: Vec2, u: Vec2, size: number): Vec2[] => {
  const v = { x: -u.y, y: u.x };
  const h = size / 2;
  return [add(add(at, scale(u, -h)), scale(v, -h)), add(add(at, scale(u, h)), scale(v, -h)), add(add(at, scale(u, h)), scale(v, h)), add(add(at, scale(u, -h)), scale(v, h))];
};

/** A disc as a polygon of `n` sides. */
const disc = (at: Vec2, r: number, n = 24): Vec2[] => Array.from({ length: n }, (_, i) => ({ x: at.x + r * Math.cos((2 * Math.PI * i) / n), y: at.y + r * Math.sin((2 * Math.PI * i) / n) }));

/** A polygon clipped to a convex one (each of its edges a half-plane). */
function clipToConvex(poly: Vec2[], window: readonly Vec2[]): Vec2[] {
  const ccw = polygonSignedArea(window) > 0;
  let out = poly;
  for (let i = 0; i < window.length && out.length >= 3; i++) {
    const a = window[i];
    const b = window[(i + 1) % window.length];
    const d = sub(b, a);
    // Outward normal of edge a -> b; keep dot(n, p) <= dot(n, a).
    const n = ccw ? { x: d.y, y: -d.x } : { x: -d.y, y: d.x };
    out = clipHalfPlane(out, n, dot(n, a));
  }
  return out;
}

interface Piece {
  s: Stairs;
  f: StairsFrame;
  risers: number;
  rise: number;
  tread: number;
  base: number;
  top: number;
  w: number;
  outline: Vec2[];
}

/** The walking surface of a piece at plan point p (its tread there; a landing's top). */
function surfaceOf(pc: Piece, p: Vec2): number {
  const d = Math.max(0, Math.min(pc.s.run, dot(sub(p, pc.f.origin), pc.f.u)));
  const k = Math.min(pc.risers, Math.max(1, Math.ceil((d - EPS) / pc.tread)));
  return pc.base + k * pc.rise;
}

const layoutCache = new Map<string, { plan: Plan; layout: StaircaseLayout }>();

/**
 * A staircase's parts in a view mode, memoized: the same object while the plan is the same object,
 * and while its pieces, style, floor to floor and the walls under it are unchanged. Null when it is
 * not there or no piece of it is shown.
 */
export function getStaircaseLayout(plan: Plan, levelId: Id, staircaseId: Id, viewMode: ViewMode): StaircaseLayout | null {
  const key = `${levelId}|${staircaseId}|${viewMode}`;
  const hit = layoutCache.get(key);
  if (hit && hit.plan === plan) return hit.layout;
  const lvl = plan.levels[levelId];
  const sc = lvl?.staircases?.[staircaseId];
  if (!lvl || !sc) {
    layoutCache.delete(key);
    return null;
  }
  const ftf = floorToFloor(plan, levelId);
  const stairs = Object.values(lvl.stairs).filter((s) => s.staircaseId === staircaseId && isVisible(s.phase, viewMode) && s.width > 0 && s.run > 0);
  if (!stairs.length) {
    layoutCache.delete(key);
    return null;
  }
  // The walls whose footprint could reach under the staircase.
  const fps = getFootprints(lvl, viewMode);
  const outlines = stairs.map((s) => stairsOutline(s));
  const near = Object.values(lvl.walls).flatMap((w) => {
    const fp = fps.get(w.id);
    if (!fp || !isVisible(w.phase, viewMode) || !stairs.some((s) => phasesCoexist(w.phase, s.phase))) return [];
    return outlines.some((o) => clipToConvex(fp.poly, o).length >= 3) ? [{ id: w.id, poly: fp.poly, top: wallHeightOf(lvl, w) }] : [];
  });
  // A wall that could stand at a landing's corner (for its posts).
  const wallPolys = Object.values(lvl.walls).flatMap((w) => (isVisible(w.phase, viewMode) && fps.get(w.id) ? [fps.get(w.id)!.poly] : []));
  const sig = JSON.stringify([
    sc,
    stairs.map((s) => [s.id, s.origin.x, s.origin.y, s.direction, s.width, s.run, s.base, s.rise, s.risers, s.open, s.railings, s.phase]),
    ftf,
    near.map((w) => [w.id, w.top, w.poly.map((p) => [r4(p.x), r4(p.y)])]),
    // Landing corners look for walls anywhere on the level.
    wallPolys.length,
  ]);
  if (hit && hit.layout.sig === sig) {
    hit.plan = plan;
    return hit.layout;
  }
  const layout = buildLayout(plan, lvl, levelId, sc.id, stairs, ftf, near, wallPolys, sig, viewMode);
  layoutCache.set(key, { plan, layout });
  return layout;
}

/** Forget every memoized layout (tests). */
export function clearStaircaseLayouts(): void {
  layoutCache.clear();
}

function buildLayout(
  plan: Plan,
  lvl: Level,
  levelId: Id,
  scId: Id,
  stairs: Stairs[],
  ftf: number,
  near: { id: Id; poly: Vec2[]; top: number }[],
  wallPolys: Vec2[][],
  sig: string,
  viewMode: ViewMode,
): StaircaseLayout {
  const style = staircaseStyleOf(lvl.staircases[scId]);
  const T = style.treadThickness;
  const N = style.nosing;
  // Pieces in stairway order.
  const ids = new Set(stairs.map((s) => s.id));
  const links = flightLinks(plan, levelId, viewMode).filter((l) => ids.has(l.from) && ids.has(l.to));
  const order = stairChains(plan, levelId, viewMode, links)
    .flat()
    .filter((id) => ids.has(id));
  const byId = new Map(stairs.map((s) => [s.id, s]));
  const pieces: Piece[] = order.map((id) => {
    const s = byId.get(id)!;
    const { risers, rise } = flightSteps(s, ftf);
    return { s, f: stairsFrame(s), risers, rise, tread: s.run / risers, base: stairsBase(s), top: stairsTop(s, ftf), w: s.width / 2, outline: stairsOutline(s) };
  });
  const loose = pieces.length > 1 ? pieces.filter((pc) => !links.some((l) => l.from === pc.s.id || l.to === pc.s.id)).map((pc) => pc.s.id) : [];
  const solids: StairSolid[] = [];
  const undersides: Record<Id, HeightFn | null> = {};
  const landingPosts: Vec2[] = [];
  const inWall = (p: Vec2) => wallPolys.some((poly) => pointInPolygon(p, poly));

  for (const pc of pieces) {
    const { s, f, risers, rise, tread, base, top, w } = pc;
    const open = !!s.open || style.underside === 'open';
    const solid = !open && (style.underside === 'solid' || top <= STAIRCASE.solidUnder);
    const floor = Math.min(0, base);
    // Treads: each overhangs the riser in front of it by the nosing.
    for (let k = 1; k <= risers; k++) {
      const z = base + k * rise;
      solids.push({ poly: frameRect(f, (k - 1) * tread - N, k * tread, -w, w), zb: level(z - T), zt: level(z), mat: 'tread', group: 'stair' });
    }
    if (open) {
      // Two stringers, nothing else under the treads.
      const slope = risers > 1 ? (risers * rise) / s.run : 0;
      const deep = risers > 1 ? (STAIRCASE.frame * Math.hypot(s.run, risers * rise)) / s.run : STAIRCASE.frame;
      const t = Math.min(1.5, w / 4);
      for (const [l0, l1] of [
        [-w, -w + t],
        [w - t, w],
      ] as const) {
        solids.push({ poly: frameRect(f, 0, s.run, l0, l1), zb: alongPlane(f, base - deep + rise - T, slope, floor), zt: alongPlane(f, base + rise - T, slope), mat: 'paint', group: 'frame' });
      }
      undersides[s.id] = alongPlane(f, base + rise - T - deep, slope, floor);
      continue;
    }
    if (solid) {
      // The carcass: each step's block from the floor to the underside of its tread.
      for (let k = 1; k <= risers; k++) solids.push({ poly: frameRect(f, (k - 1) * tread, k * tread, -w, w), zb: level(floor), zt: level(base + k * rise - T), mat: 'paint', group: 'stair' });
      undersides[s.id] = null;
      continue;
    }
    // Framed: the carcass is the framing under the treads, a soffit square to the slope below it.
    if (risers > 1) {
      const slope = (risers * rise) / s.run;
      const deep = (STAIRCASE.frame * Math.hypot(s.run, risers * rise)) / s.run;
      // The soffit follows the nosing line, `deep` under the treads' undersides.
      const soffit = alongPlane(f, base + rise - T - deep, slope, floor);
      for (let k = 1; k <= risers; k++) solids.push({ poly: frameRect(f, (k - 1) * tread, k * tread, -w, w), zb: soffit, zt: level(base + k * rise - T), mat: 'paint', group: 'stair' });
      undersides[s.id] = soffit;
    } else {
      // A landing on its frame, posts at the corners no wall holds.
      const under = top - T - STAIRCASE.frame;
      solids.push({ poly: frameRect(f, 0, s.run, -w, w), zb: level(under), zt: level(top - T), mat: 'paint', group: 'stair' });
      undersides[s.id] = level(under);
      const o = pc.outline;
      o.forEach((corner, i) => {
        const prev = o[(i + 3) % 4];
        const next = o[(i + 1) % 4];
        const out1 = scale(sub(corner, next), 1 / Math.max(EPS, Math.hypot(corner.x - next.x, corner.y - next.y)));
        const out2 = scale(sub(corner, prev), 1 / Math.max(EPS, Math.hypot(corner.x - prev.x, corner.y - prev.y)));
        if (inWall(add(corner, out1)) || inWall(add(corner, out2)) || inWall(add(corner, add(out1, out2)))) return;
        // A lower piece of the stairway under the corner carries it.
        const p = add(corner, scale(add(out1, out2), -STAIRCASE.landingPost / 2));
        if (inWall(p) || pieces.some((q) => q !== pc && pointInPolygon(add(corner, scale(add(out1, out2), 0.5)), q.outline))) return;
        landingPosts.push(p);
        solids.push({ poly: square(p, f.u, STAIRCASE.landingPost), zb: level(floor), zt: level(under), mat: 'paint', group: 'frame' });
      });
    }
  }

  // Walls under the pieces: a panel closes the gap from the wall's top to a framed underside; a wall
  // rising into the stair is reported.
  const wallsThrough: StaircaseLayout['wallsThrough'] = [];
  for (const pc of pieces) {
    const u = undersides[pc.s.id];
    for (const wl of near) {
      const area = clipToConvex(wl.poly, pc.outline);
      if (area.length < 3 || Math.abs(polygonSignedArea(area)) < 1) continue;
      const lowest = u ? Math.min(...area.map((p) => heightAt(u, p))) : Math.min(0, pc.base);
      if (wl.top > lowest + 0.01) {
        wallsThrough.push({ wallId: wl.id, stairsId: pc.s.id, room: lowest });
        continue;
      }
      if (u && Math.max(...area.map((p) => heightAt(u, p))) - wl.top > STAIRCASE.minPanel) {
        solids.push({ poly: area, zb: level(wl.top), zt: u, mat: 'paint', group: 'frame' });
      }
    }
  }

  // Rails: each railed side a run between two newels' centres (half a newel in from the edge), with
  // its height line; newels that fall together are one.
  const NW = style.newel === 'box' ? STAIRCASE.boxNewel : STAIRCASE.squareNewel;
  const c = NW / 2;
  const H = style.handrailHeight;
  const railW = style.handrail === 'round' ? STAIRCASE.roundRail : STAIRCASE.boardRail;
  const railT = style.handrail === 'round' ? STAIRCASE.roundRail : STAIRCASE.boardRailThick;
  interface Run {
    pc: Piece;
    /** Newel centres at its ends, and the rail top over each (along the run's own line). */
    p0: Vec2;
    p1: Vec2;
    z0: number;
    z1: number;
  }
  const runs: Run[] = [];
  for (const pc of pieces) {
    const { s, f, risers, rise, tread, base, top, w } = pc;
    if (risers > 1) {
      const slope = rise / tread;
      const railTop = (a: number) => base + rise + a * slope + H;
      for (const [side, sign] of [
        ['left', -1],
        ['right', 1],
      ] as const) {
        if (!s.railings?.[side]) continue;
        const l = sign * (w - c);
        runs.push({ pc, p0: stairsPoint(f, -c, l), p1: stairsPoint(f, s.run + c, l), z0: railTop(-c), z1: railTop(s.run + c) });
      }
    } else {
      const z = top + H;
      for (const [side, sign] of [
        ['left', -1],
        ['right', 1],
      ] as const) {
        if (!s.railings?.[side]) continue;
        const l = sign * (w - c);
        runs.push({ pc, p0: stairsPoint(f, c, l), p1: stairsPoint(f, s.run - c, l), z0: z, z1: z });
      }
      if (s.railings?.end) runs.push({ pc, p0: stairsPoint(f, s.run - c, -(w - c)), p1: stairsPoint(f, s.run - c, w - c), z0: z, z1: z });
    }
  }
  // The newels at the runs' ends, merged when within an inch.
  const last = pieces[pieces.length - 1];
  const arrives = !!last && (Math.abs(ftf - last.top - last.rise) <= 0.375 + EPS || Math.abs(ftf - last.top) <= 0.375 + EPS);
  const newelSpots: { at: Vec2; rails: number[] }[] = [];
  const addSpot = (at: Vec2, z: number) => {
    const found = newelSpots.find((n) => Math.hypot(n.at.x - at.x, n.at.y - at.y) <= 1);
    if (found) found.rails.push(z);
    else newelSpots.push({ at, rails: [z] });
  };
  for (const r of runs) {
    addSpot(r.p0, r.z0);
    addSpot(r.p1, r.z1);
  }
  const floorUnder = (p: Vec2): number => {
    const on = pieces.filter((q) => pointInPolygon(p, q.outline));
    if (on.length) return Math.max(...on.map((q) => surfaceOf(q, p)));
    // Past the top of a stairway that arrives at the floor above: on that floor.
    if (arrives && last) {
      const d = dot(sub(p, last.f.origin), last.f.u);
      if (d >= last.s.run - EPS) return ftf;
    }
    return 0;
  };
  const newels: StairNewelPart[] = newelSpots.map((n) => ({ at: n.at, bottom: floorUnder(n.at), top: Math.max(...n.rails) + STAIRCASE.newelAbove, size: NW }));
  const axis = pieces[0]?.f.u ?? { x: 1, y: 0 };
  for (const n of newels) {
    const cap = style.newel === 'box' ? STAIRCASE.boxCap : NW;
    solids.push({ poly: square(n.at, axis, NW), zb: level(n.bottom), zt: level(n.top - STAIRCASE.capThick), mat: 'paint', group: 'rail' });
    solids.push({ poly: square(n.at, axis, cap), zb: level(n.top - STAIRCASE.capThick), zt: level(n.top), mat: 'tread', group: 'rail' });
  }
  // The handrail between the newels' faces, and balusters under it at most balusterGap apart.
  const rails: StairRail[] = [];
  for (const r of runs) {
    const d = sub(r.p1, r.p0);
    const len = Math.hypot(d.x, d.y);
    if (len <= NW + EPS) continue;
    const u = scale(d, 1 / len);
    const v = { x: -u.y, y: u.x };
    const slope = (r.z1 - r.z0) / len;
    const a = add(r.p0, scale(u, c));
    const b = add(r.p1, scale(u, -c));
    const zt: HeightFn = { c: r.z0 - slope * dot(r.p0, u), g: scale(u, slope) };
    const zbRail: HeightFn = { c: zt.c - railT, g: zt.g };
    const side = (p: Vec2, off: number) => add(p, scale(v, off));
    solids.push({ poly: [side(a, -railW / 2), side(b, -railW / 2), side(b, railW / 2), side(a, railW / 2)], zb: zbRail, zt, mat: 'tread', group: 'rail' });
    rails.push({ a, b, za: heightAt(zt, a), zb: heightAt(zt, b) });
    const span = len - NW;
    const bw = STAIRCASE.baluster;
    const count = Math.max(0, Math.ceil((span - style.balusterGap) / (style.balusterGap + bw) - 1e-9));
    const gap = (span - count * bw) / (count + 1);
    for (let m = 0; m < count; m++) {
      const mid = add(a, scale(u, gap * (m + 1) + bw * m + bw / 2));
      const foot = floorUnder(mid);
      solids.push({ poly: square(mid, u, bw), zb: level(foot), zt: zbRail, mat: 'paint', group: 'rail' });
    }
  }

  // The bullnose: round the starting newel, in front of the first piece's bottom edge.
  let bullnose: Vec2[] | null = null;
  const first = pieces[0];
  if (style.startStep === 'bullnose' && first) {
    // The starting newel: the one on or just in front of the first piece nearest its bottom edge.
    const along = (p: Vec2) => dot(sub(p, first.f.origin), first.f.u);
    const across = (p: Vec2) => Math.abs(dot(sub(p, first.f.origin), first.f.v));
    const n = newels
      .filter((x) => along(x.at) >= -NW && along(x.at) <= Math.min(first.s.run, NW) && across(x.at) <= first.w + NW)
      .sort((x, y) => Math.abs(along(x.at)) - Math.abs(along(y.at)))[0];
    if (n) {
      const z = first.base + first.rise;
      // In front of the bottom edge (along <= 0); the tread's part in front of the piece's own nosing.
      const nu = first.f.u;
      const edge = dot(nu, first.f.origin);
      const body = clipHalfPlane(disc(n.at, STAIRCASE.bullnose), nu, edge);
      const cap = clipHalfPlane(disc(n.at, STAIRCASE.bullnose + N), nu, edge - N);
      if (body.length >= 3) solids.push({ poly: body, zb: level(Math.min(0, first.base)), zt: level(z - T), mat: 'paint', group: 'stair' });
      if (cap.length >= 3) solids.push({ poly: cap, zb: level(z - T), zt: level(z), mat: 'tread', group: 'stair' });
      bullnose = cap.length >= 3 ? cap : null;
    }
  }

  return { sig, style, members: order, loose, solids, newels, rails, bullnose, landingPosts, wallsThrough, undersides };
}
