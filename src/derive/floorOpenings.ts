import { add, pointInPolygon, polygonSignedArea, projectPointToSegment, scale } from '../model/geometry';
import { staircaseStyleOf } from '../model/stairStyle';
import type { FloorOpening, Id, Plan, Vec2, ViewMode } from '../model/types';
import { DECK, DECK_RAIL, deckStairOpenings, edgeOutward, railingParts, railingRuns, type DeckBox, type DeckOpening, type RailSizes, type RunEnds } from './decks';
import { STAIRCASE } from './staircase';
import { stairsOutline } from './stairs';
import { getFootprints } from './footprint';
import { isVisible, phasesCoexist } from './phase';
import { insetPolygon } from './rooms';

// Floor openings (DESIGN.md "Floor openings"): a hole in a level's own floor, open to the level
// below, with a guard on the floor round it. Pure, like derive/decks.ts, whose railing and stair
// arrival code it shares. Heights are level-local (0 = the level's floor top).

/** How far the slab hole stays inside the drawn outline, so an opening drawn flush to a wall's face lies strictly inside the slab. */
export const FLOOR_OPENING_HOLE_INSET = 0.25;

export interface FloorOpeningLayout {
  /** Everything the layout was built from (the memo's key). */
  sig: string;
  /** Per edge: a wall on the level runs along it, so it needs no guard. */
  supported: boolean[];
  /** Where a flight from below arrives at an edge: the guard is cut there. */
  openings: DeckOpening[];
  /**
   * The guard's posts, bottom rails, balusters and caps, standing on the floor round the hole. When a
   * staircase arrives (`style`) the guard is in its style and its caps are in `rail` instead.
   */
  railing: DeckBox[];
  rail: DeckBox[];
  /** The arriving staircase's colours: the rail in the tread colour, the rest in the paint. */
  style?: { treadColor: string; paintColor: string };
  /** The caps' plan polygons (the plan draws the guard with them). */
  caps: Vec2[][];
}

/**
 * Per edge: whether a wall on the opening's own level runs along it (the point DECK.probe outside the
 * edge's middle, on the floor side, lies in a visible wall footprint that can be seen with the
 * opening). Such an edge needs no guard.
 */
export function floorOpeningSupportedEdges(plan: Plan, levelId: Id, opening: Pick<FloorOpening, 'outline' | 'phase'>, viewMode: ViewMode): boolean[] {
  const level = plan.levels[levelId];
  const outline = opening.outline;
  if (!level || outline.length < 3) return outline.map(() => false);
  const fps = getFootprints(level, viewMode);
  const polys = Object.values(level.walls).flatMap((w) => {
    if (!isVisible(w.phase, viewMode) || !phasesCoexist(w.phase, opening.phase)) return [];
    const fp = fps.get(w.id);
    return fp ? [fp.poly] : [];
  });
  return outline.map((p, i) => {
    const q = outline[(i + 1) % outline.length];
    const probe = add({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, scale(edgeOutward(outline, i), DECK.probe));
    return polys.some((poly) => pointInPolygon(probe, poly));
  });
}

/** The hole a floor opening cuts in its level's slab: the outline moved in by FLOOR_OPENING_HOLE_INSET on every edge. */
export function floorOpeningHole(opening: Pick<FloorOpening, 'outline'>): Vec2[] {
  const poly = polygonSignedArea(opening.outline) >= 0 ? [...opening.outline] : [...opening.outline].reverse();
  return insetPolygon(
    poly,
    poly.map(() => FLOOR_OPENING_HOLE_INSET),
  );
}

/** The holes the visible floor openings of a level cut in its slab. */
export function floorOpeningHoles(plan: Plan, levelId: Id, viewMode: ViewMode): Vec2[][] {
  const level = plan.levels[levelId];
  if (!level) return [];
  return Object.values(level.floorOpenings ?? {})
    .filter((o) => isVisible(o.phase, viewMode))
    .map(floorOpeningHole);
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * The guard's style when a staircase arrives at the opening: its newels as the posts, its handrail
 * as the cap (at least 36" up), its balusters standing on the floor; and at each railed side of an
 * arriving flight, the guard's run reaches on to that newel (which the staircase draws) instead of
 * ending on a post of its own beside it.
 */
interface GuardStyle {
  sizes: RailSizes;
  colors: { treadColor: string; paintColor: string };
  /** Per arrival: the edge, the run end to carry on past (`from` or `to`), the newel's width. */
  reach: { edge: number; at: number; dir: 1 | -1; by: number }[];
}

function guardStyle(plan: Plan, opening: FloorOpening, openings: DeckOpening[]): GuardStyle | null {
  let out: GuardStyle | null = null;
  for (const o of openings) {
    const st = o.levelId && o.stairsId ? plan.levels[o.levelId]?.stairs[o.stairsId] : undefined;
    const sc = st?.staircaseId ? plan.levels[o.levelId!]?.staircases?.[st.staircaseId] : undefined;
    if (!st || !sc) continue;
    const style = staircaseStyleOf(sc);
    const post = style.newel === 'box' ? STAIRCASE.boxNewel : STAIRCASE.squareNewel;
    if (!out) {
      out = {
        sizes: {
          height: Math.max(DECK.railHeight, style.handrailHeight),
          post,
          postSpacing: 96,
          cap: style.handrail === 'round' ? STAIRCASE.roundRail : STAIRCASE.boardRail,
          capThick: style.handrail === 'round' ? STAIRCASE.roundRail : STAIRCASE.boardRailThick,
          bottomRail: false,
          baluster: STAIRCASE.baluster,
          gap: style.balusterGap,
        },
        colors: { treadColor: style.treadColor, paintColor: style.riserColor },
        reach: [],
      };
    }
    // The flight's railed sides' top corners: the newel stands just inside each.
    const [, tl, tr] = stairsOutline(st);
    const a = opening.outline[o.edge];
    const b = opening.outline[(o.edge + 1) % opening.outline.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (const [side, corner] of [
      ['left', tl],
      ['right', tr],
    ] as const) {
      if (!st.railings?.[side]) continue;
      const s = projectPointToSegment(corner, a, b).t * len;
      if (Math.abs(s - o.from) < 0.5) out.reach.push({ edge: o.edge, at: o.from, dir: 1, by: post });
      else if (Math.abs(s - o.to) < 0.5) out.reach.push({ edge: o.edge, at: o.to, dir: -1, by: post });
    }
  }
  return out;
}

function buildLayout(opening: FloorOpening, supported: boolean[], openings: DeckOpening[], style: GuardStyle | null): FloorOpeningLayout {
  const sig = JSON.stringify([opening.outline.map((p) => [r4(p.x), r4(p.y)]), opening.railings, supported, openings.map((o) => [o.edge, r4(o.from), r4(o.to)]), style]);
  // A wall along an edge is the guard there.
  const railings = opening.railings.map((r, i) => r && !supported[i]);
  const runs = railingRuns({ outline: opening.outline, railings }, openings).map((rs) => rs.map(([s0, s1]) => [s0, s1] as [number, number]));
  const ends: RunEnds[][] = runs.map((rs) => rs.map(() => ({})));
  const lens = opening.outline.map((p, i) => {
    const q = opening.outline[(i + 1) % opening.outline.length];
    return Math.hypot(q.x - p.x, q.y - p.y);
  });
  for (const r of style?.reach ?? []) {
    runs[r.edge]?.forEach((run, k) => {
      if (r.dir === 1 && Math.abs(run[1] - r.at) < 0.5) {
        run[1] = Math.min(lens[r.edge], run[1] + r.by);
        ends[r.edge][k].noEndPost = true;
      } else if (r.dir === -1 && Math.abs(run[0] - r.at) < 0.5) {
        run[0] = Math.max(0, run[0] - r.by);
        ends[r.edge][k].noStartPost = true;
      }
    });
  }
  const { railing, caps, capBoxes } = railingParts(opening.outline, runs, 0, -1, style?.sizes ?? DECK_RAIL, ends, !!style);
  return { sig, supported, openings, railing, rail: style ? capBoxes : [], caps, ...(style ? { style: style.colors } : {}) };
}

const layoutCache = new Map<string, { plan: Plan; layout: FloorOpeningLayout }>();

/**
 * A floor opening's layout in a view mode, memoized: the same object while the plan is the same
 * object, and while its outline, railings, supported edges and stair arrivals are unchanged (its
 * phase is not part of it). Null when the opening is not there.
 */
export function getFloorOpeningLayout(plan: Plan, levelId: Id, openingId: Id, viewMode: ViewMode): FloorOpeningLayout | null {
  const key = `${levelId}|${openingId}|${viewMode}`;
  const hit = layoutCache.get(key);
  if (hit && hit.plan === plan) return hit.layout;
  const opening = plan.levels[levelId]?.floorOpenings?.[openingId];
  if (!opening) {
    layoutCache.delete(key);
    return null;
  }
  for (const [k, v] of layoutCache) {
    if (v.plan === plan) continue;
    const [lid, oid] = k.split('|');
    if (!plan.levels[lid]?.floorOpenings?.[oid]) layoutCache.delete(k);
  }
  const supported = floorOpeningSupportedEdges(plan, levelId, opening, viewMode);
  // A flight arrives at an edge when its top is one riser or less below this floor (a deck at the floor's top).
  const openings = deckStairOpenings(plan, levelId, { outline: opening.outline, elevation: 0, phase: opening.phase }, viewMode);
  const layout = buildLayout(opening, supported, openings, guardStyle(plan, opening, openings));
  if (hit && hit.layout.sig === layout.sig) {
    hit.plan = plan;
    return hit.layout;
  }
  layoutCache.set(key, { plan, layout });
  return layout;
}

/** Forget every memoized layout (tests). */
export function clearFloorOpeningLayouts(): void {
  layoutCache.clear();
}
