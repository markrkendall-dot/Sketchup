// How the flights of one level join into stairways (DESIGN.md "Checks"): a flight, a landing (a
// one-riser piece) or a platform leads on to the next where the next one's bottom edge lies along
// any edge of it (a turn leaves a landing by its side) and starts at its top height. Pure.

import { projectPointToSegment } from '../model/geometry';
import type { Id, Plan, Stairs, ViewMode } from '../model/types';
import { isVisible, phasesCoexist } from './phase';
import { floorToFloor, stairsBase, stairsOutline, stairsRise } from './stairs';

/** How far a flight's bottom corners may lie from the edge it leaves, inches. */
export const LINK_TOL = 1;
/** How far its base may be from the top of the piece it leaves, inches. */
export const LINK_HEIGHT_TOL = 0.5;

export interface FlightLink {
  /** The lower piece. */
  from: Id;
  /** The piece that starts on it. */
  to: Id;
  /** The edge of `from`'s outline (stairsOutline order: 0 left, 1 top, 2 right, 3 bottom) it leaves by. */
  edge: number;
}

/** The top of a piece over its level's floor: base plus climb. */
export const stairsTop = (s: Pick<Stairs, 'base' | 'rise'>, ftf: number): number => stairsBase(s) + stairsRise(s, ftf);

/** The edge of `a`'s outline that `b`'s bottom edge lies along, or -1. */
export function linkEdge(a: Stairs, b: Stairs): number {
  const ao = stairsOutline(a);
  const bo = stairsOutline(b);
  const [p, q] = [bo[0], bo[3]];
  for (let i = 0; i < 4; i++) {
    const s0 = ao[i];
    const s1 = ao[(i + 1) % 4];
    if (projectPointToSegment(p, s0, s1).distance <= LINK_TOL && projectPointToSegment(q, s0, s1).distance <= LINK_TOL) return i;
  }
  return -1;
}

/** The visible pieces of a level that can be seen together. */
const visibleStairs = (plan: Plan, levelId: Id, viewMode: ViewMode): Stairs[] =>
  Object.values(plan.levels[levelId]?.stairs ?? {}).filter((s) => isVisible(s.phase, viewMode));

/** Every link between the level's visible pieces, by plan order of `from` then `to`. */
export function flightLinks(plan: Plan, levelId: Id, viewMode: ViewMode): FlightLink[] {
  const ftf = floorToFloor(plan, levelId);
  const all = visibleStairs(plan, levelId, viewMode);
  const out: FlightLink[] = [];
  for (const a of all) {
    const top = stairsTop(a, ftf);
    for (const b of all) {
      if (a === b || !phasesCoexist(a.phase, b.phase)) continue;
      if (Math.abs(stairsBase(b) - top) > LINK_HEIGHT_TOL) continue;
      const edge = linkEdge(a, b);
      if (edge >= 0) out.push({ from: a.id, to: b.id, edge });
    }
  }
  return out;
}

/**
 * The level's stairways: chains of linked pieces, bottom first. A piece nothing leads to starts a
 * chain, which follows the first link out of each piece; a piece left over (a loop) is a chain of
 * its own. Every visible piece is in exactly one chain.
 */
export function stairChains(plan: Plan, levelId: Id, viewMode: ViewMode, links = flightLinks(plan, levelId, viewMode)): Id[][] {
  const ids = visibleStairs(plan, levelId, viewMode).map((s) => s.id);
  const next = new Map<Id, Id>();
  const hasPrev = new Set<Id>();
  for (const l of links) {
    if (!next.has(l.from)) next.set(l.from, l.to);
    hasPrev.add(l.to);
  }
  const used = new Set<Id>();
  const chains: Id[][] = [];
  const walk = (start: Id) => {
    const chain: Id[] = [];
    for (let id: Id | undefined = start; id && !used.has(id); id = next.get(id)) {
      used.add(id);
      chain.push(id);
    }
    chains.push(chain);
  };
  for (const id of ids) if (!hasPrev.has(id)) walk(id);
  for (const id of ids) if (!used.has(id)) walk(id);
  return chains;
}
