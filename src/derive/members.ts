// Beams, posts and footings as boxes, and the joists over a level (DESIGN.md "Structure"). Pure.
//
// A level's framing is the floor above it (or, on the top level, the ceiling under the roof): its
// joists' top is under the subfloor, `floorThickness - 0.75` over the level's wall height, and their
// depth is that, unless the framing sets one; an attic's ceiling joists are ATTIC_JOIST_DEPTH deep on
// the walls' tops. A flush beam's top is the joists' top; a dropped one's is the wall height.

import { add, pointInPolygon, scale } from '../model/geometry';
import { ATTIC_JOIST_DEPTH, isTimber } from '../model/structure';
import type { Beam, Id, Level, Member, Plan, Post, Vec2, ViewMode } from '../model/types';
import type { DeckBox } from './decks';
import { isVisible, phasesCoexist } from './phase';

/** The subfloor over the joists, inches. */
export const SUBFLOOR = 0.75;

/** The level above, if any. */
const levelAbove = (plan: Plan, levelId: Id): Level | undefined => {
  const i = plan.levelOrder.indexOf(levelId);
  return i >= 0 ? plan.levels[plan.levelOrder[i + 1]] : undefined;
};

/** How deep the joists over a level are. */
export function joistDepth(plan: Plan, levelId: Id): number {
  const lvl = plan.levels[levelId];
  if (lvl?.framing?.depth) return lvl.framing.depth;
  const above = levelAbove(plan, levelId);
  return above ? Math.max(1, above.floorThickness - SUBFLOOR) : ATTIC_JOIST_DEPTH;
}

/** The joists' top over a level, over its floor (level-local). */
export function joistTop(plan: Plan, levelId: Id): number {
  const lvl = plan.levels[levelId];
  if (!lvl) return 0;
  return lvl.wallHeight + joistDepth(plan, levelId);
}

/**
 * The joists over a point of a level in a view: the last zone shown there, else the level's
 * framing; null when neither says.
 */
export function joistsAt(plan: Plan, levelId: Id, p: Vec2, viewMode: ViewMode): { joists: number; depth: number } | null {
  const lvl = plan.levels[levelId];
  if (!lvl) return null;
  const depth = joistDepth(plan, levelId);
  const zones = Object.values(lvl.joistZones ?? {}).filter((z) => isVisible(z.phase, viewMode) && pointInPolygon(p, z.outline));
  if (zones.length) return { joists: zones[zones.length - 1].joists, depth };
  return lvl.framing ? { joists: lvl.framing.joists, depth } : null;
}

/** A beam's plan rectangle. */
export function beamOutline(b: Pick<Beam, 'a' | 'b' | 'width'>): Vec2[] {
  const dx = b.b.x - b.a.x;
  const dy = b.b.y - b.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const n = { x: (-dy / len) * (b.width / 2), y: (dx / len) * (b.width / 2) };
  return [add(b.a, n), add(b.b, n), add(b.b, scale(n, -1)), add(b.a, scale(n, -1))];
}

/** A post's (or footing's) plan square, turned by its rotation. */
export function postOutline(p: Pick<Post, 'at' | 'rotation'>, width: number, depth: number): Vec2[] {
  const r = (p.rotation * Math.PI) / 180;
  const u = { x: Math.cos(r), y: Math.sin(r) };
  const v = { x: -u.y, y: u.x };
  const hw = width / 2;
  const hd = depth / 2;
  return [
    add(add(p.at, scale(u, -hw)), scale(v, -hd)),
    add(add(p.at, scale(u, hw)), scale(v, -hd)),
    add(add(p.at, scale(u, hw)), scale(v, hd)),
    add(add(p.at, scale(u, -hw)), scale(v, hd)),
  ];
}

/** A beam's bottom and top over its level's floor. */
export function beamHeights(plan: Plan, levelId: Id, b: Pick<Beam, 'mount' | 'depth'>): { bottom: number; top: number } {
  const lvl = plan.levels[levelId];
  const top = b.mount === 'flush' ? joistTop(plan, levelId) : (lvl?.wallHeight ?? 0);
  return { bottom: top - b.depth, top };
}

export interface MemberBoxes {
  /** The member itself (a sloped timber: the box round it). */
  body: DeckBox;
  /** A post's footing. */
  footing?: DeckBox;
  /** A sloped timber beam's underside and top over the floor, at a plan point. */
  slope?: { bottom: (p: Vec2) => number; top: (p: Vec2) => number };
}

/**
 * A timber beam's top over the floor at a plan point (linear from za at a to zb at b) and its
 * vertical depth (`depth` square to its slope).
 */
export function timberTop(b: Pick<Beam, 'a' | 'b' | 'za' | 'zb' | 'depth'>): { top: (p: Vec2) => number; vertical: number } {
  const dx = b.b.x - b.a.x;
  const dy = b.b.y - b.a.y;
  const len2 = dx * dx + dy * dy || 1;
  const za = b.za ?? 0;
  const zb = b.zb ?? za;
  const run = Math.sqrt(len2);
  const vertical = (b.depth * Math.hypot(run, zb - za)) / run;
  return { top: (p) => za + ((zb - za) * ((p.x - b.a.x) * dx + (p.y - b.a.y) * dy)) / len2, vertical };
}

/**
 * A member's boxes over its level's floor: a beam between its heights (beamHeights); a post from
 * the floor up to the underside of the lowest beam over it that can be seen with it (else the
 * level's wall height); a footing under the slab.
 */
export function memberBoxes(plan: Plan, levelId: Id, m: Member, viewMode: ViewMode = 'all'): MemberBoxes {
  const lvl = plan.levels[levelId];
  if (m.kind === 'beam' && isTimber(m)) {
    const t = timberTop(m);
    const za = m.za!;
    const zb = m.zb!;
    return {
      body: { poly: beamOutline(m), bottom: Math.min(za, zb) - t.vertical, top: Math.max(za, zb) },
      slope: { top: t.top, bottom: (p) => t.top(p) - t.vertical },
    };
  }
  if (m.kind === 'beam') {
    const h = beamHeights(plan, levelId, m);
    return { body: { poly: beamOutline(m), bottom: h.bottom, top: h.top } };
  }
  if (isTimber(m)) return { body: { poly: postOutline(m, m.width, m.depth), bottom: m.base!, top: m.top! } };
  let top = lvl?.wallHeight ?? 96;
  for (const o of Object.values(lvl?.members ?? {})) {
    if (o.kind !== 'beam' || isTimber(o) || !isVisible(o.phase, viewMode) || !phasesCoexist(o.phase, m.phase)) continue;
    if (pointInPolygon(m.at, beamOutline(o))) top = Math.min(top, beamHeights(plan, levelId, o).bottom);
  }
  const out: MemberBoxes = { body: { poly: postOutline(m, m.width, m.depth), bottom: 0, top } };
  if (m.footing) {
    const slab = lvl?.floorThickness ?? 0;
    out.footing = { poly: postOutline(m, m.footing.width, m.footing.width), bottom: -slab - m.footing.thickness, top: -slab };
  }
  return out;
}
