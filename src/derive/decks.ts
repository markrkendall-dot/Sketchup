import { add, dot, lineIntersection, normalize, pointInPolygon, polygonSignedArea, projectPointToSegment, scale, sub } from '../model/geometry';
import { wallHeightOf } from '../model/openings';
import type { Deck, Id, Phase, Plan, Vec2, ViewMode } from '../model/types';
import { formatLengthCompact } from '../model/units';
import { getFootprints } from './footprint';
import { getLevelElevations } from './levels';
import { isVisible, phasesCoexist } from './phase';
import { wallExtensions } from './platform';
import { insetPolygon } from './rooms';
import { groundAt } from './site';
import { floorToFloor, stairsBase, stairsOutline, stairsRise } from './stairs';

// Decks (DESIGN.md "Decks"). Pure: no three, no React, so the 2D plan, the 3D meshes and the panel
// share one layout. Heights are level-local (0 = the deck's level's floor top), like the level's
// other elements; the ground (groundAt) and other levels' walls and stairs are converted with
// getLevelElevations.

/** Sizes, in inches. */
export const DECK = {
  /** Boards' thickness, and how far they overhang the framing on a free edge. */
  board: 1.5,
  overhang: 1,
  /** Framing under the boards: a rim of 1.5" boards round joists 1.5" wide every 16". */
  joist: 9.25,
  band: 1.5,
  joistWidth: 1.5,
  joistSpacing: 16,
  /** Support posts: 5.5" square, 3" in from a free edge, at most 96" apart, 6" into the ground. */
  post: 5.5,
  postInset: 3,
  postSpacing: 96,
  postEmbed: 6,
  /** Railing: 36" high; 3.5" posts at most 72" apart; a 3.5" x 1.5" cap; a 3.5" x 1.5" bottom rail 3" up; 1.5" balusters with at most 4" between them. */
  railHeight: 36,
  railPost: 3.5,
  railPostSpacing: 72,
  cap: 3.5,
  capThick: 1.5,
  bottomRailUp: 3,
  bottomRailHeight: 3.5,
  bottomRailThick: 1.5,
  baluster: 1.5,
  balusterGap: 4,
  /** A railing run shorter than this is left out. */
  minRun: 3.5,
  /** Board lines on the plan, this far apart. */
  boardLine: 6,
  /** How far outside an edge the wall and ground are looked for. */
  probe: 1,
  /** A stair's top corners within this of an edge, its top this far below (or above) the boards. */
  openingTol: 1,
  openingBelow: 8,
  openingAbove: 1,
  /** A new deck's top: one step below the floor. */
  defaultElevation: -6,
} as const;

/** "6" below floor": a deck's top against its level's floor. */
export function deckTopWords(elevation: number, denom: number): string {
  if (Math.abs(elevation) < 1e-9) return 'at floor';
  return `${formatLengthCompact(Math.abs(elevation), denom)} ${elevation < 0 ? 'below' : 'above'} floor`;
}

/** A box of the deck: a plan polygon (with holes) extruded from `bottom` to `top`. */
export interface DeckBox {
  poly: Vec2[];
  holes?: Vec2[][];
  bottom: number;
  top: number;
}

/** Where a flight of stairs reaches an edge: the railing is cut from `from` to `to` along it. */
export interface DeckOpening {
  edge: number;
  from: number;
  to: number;
  levelId: Id;
  stairsId: Id;
}

export interface DeckPost extends DeckBox {
  at: Vec2;
}

export interface DeckLayout {
  /** Everything the layout was built from (the memo's key). */
  sig: string;
  /** The boards' top, level-local. */
  top: number;
  /** Per edge: a wall (on any level) backs it, so it has no posts. */
  supported: boolean[];
  openings: DeckOpening[];
  /** Per edge: the most the boards stand above the ground just outside it. */
  edgeDrops: number[];
  boards: DeckBox;
  /** The rim and the joists. */
  frame: DeckBox[];
  posts: DeckPost[];
  /** Railing posts, bottom rails, balusters and caps. */
  railing: DeckBox[];
  /** The caps' plan polygons (the plan draws the railing with them). */
  caps: Vec2[][];
  /** Board joints on the plan, parallel to the longest edge. */
  boardLines: [Vec2, Vec2][];
}

const EPS = 1e-6;

/** Unit direction of edge i (outline[i] to outline[i + 1]). */
const edgeDir = (outline: readonly Vec2[], i: number): Vec2 => normalize(sub(outline[(i + 1) % outline.length], outline[i]));

/** Unit normal of edge i pointing out of the deck, whatever the outline's winding. */
export function edgeOutward(outline: readonly Vec2[], i: number): Vec2 {
  const d = edgeDir(outline, i);
  const s = polygonSignedArea(outline) >= 0 ? 1 : -1;
  return { x: d.y * s, y: -d.x * s };
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

/** The compass name of a plan direction (plan up is north when `northAngle` is 0). */
export function compassName(v: Vec2, northAngle = 0): string {
  const bearing = (Math.atan2(v.x, -v.y) * 180) / Math.PI - northAngle;
  const i = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return COMPASS[i];
}

/** The deck outline's edge lengths. */
const edgeLengths = (outline: readonly Vec2[]): number[] => outline.map((p, i) => Math.hypot(outline[(i + 1) % outline.length].x - p.x, outline[(i + 1) % outline.length].y - p.y));

/** The index of the longest edge (the first of equals). */
function longestEdge(outline: readonly Vec2[]): number {
  const lens = edgeLengths(outline);
  let best = 0;
  lens.forEach((l, i) => {
    if (l > lens[best] + EPS) best = i;
  });
  return best;
}

/**
 * Lines parallel to `dir`, `spacing` apart across the polygon (the first half a spacing in from
 * its extreme), each clipped to the polygon: one segment per stretch inside it, so a concave outline
 * gets several.
 */
export function scanSegments(poly: readonly Vec2[], dir: Vec2, spacing: number): [Vec2, Vec2][] {
  const d = normalize(dir);
  const n = { x: -d.y, y: d.x };
  if (poly.length < 3 || !(spacing > 0)) return [];
  const across = poly.map((p) => dot(p, n));
  const lo = Math.min(...across);
  const hi = Math.max(...across);
  const out: [Vec2, Vec2][] = [];
  for (let c = lo + spacing / 2; c < hi - EPS; c += spacing) {
    const hits: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = across[i];
      const b = across[(i + 1) % poly.length];
      // Half-open in the across direction, so a vertex on the line counts once.
      if ((a <= c && b > c) || (b <= c && a > c)) {
        const t = (c - a) / (b - a);
        const p = add(poly[i], scale(sub(poly[(i + 1) % poly.length], poly[i]), t));
        hits.push(dot(p, d));
      }
    }
    hits.sort((p, q) => p - q);
    for (let k = 0; k + 1 < hits.length; k += 2) {
      if (hits[k + 1] - hits[k] < EPS) continue;
      out.push([add(scale(d, hits[k]), scale(n, c)), add(scale(d, hits[k + 1]), scale(n, c))]);
    }
  }
  return out;
}

/**
 * Per edge: whether a wall backs it, so a ledger carries the deck there (no posts, no railing by
 * default). A wall backs an edge when the point DECK.probe outside the edge's middle lies in its
 * footprint, the wall is on any level, is visible in the view and can be seen with the deck
 * (phasesCoexist), and its height (slab bottom to top, run-through included) overlaps the framing.
 */
export function deckSupportedEdges(plan: Plan, levelId: Id, outline: readonly Vec2[], elevation: number, viewMode: ViewMode, phase: Phase = 'existing'): boolean[] {
  const elev = getLevelElevations(plan);
  const at = elev[levelId];
  if (!at || outline.length < 3) return outline.map(() => false);
  const topAbs = at.floorTop + elevation;
  const frameBottomAbs = topAbs - DECK.board - DECK.joist;
  const walls = plan.levelOrder.flatMap((lid) => {
    const level = plan.levels[lid];
    const e = elev[lid];
    if (!level || !e) return [];
    const fps = getFootprints(level, viewMode);
    const ext = wallExtensions(plan, lid, viewMode);
    return Object.values(level.walls).flatMap((w) => {
      if (!isVisible(w.phase, viewMode) || !phasesCoexist(w.phase, phase)) return [];
      const fp = fps.get(w.id);
      const top = e.floorTop + wallHeightOf(level, w) + (ext.get(w.id) ?? 0);
      if (!fp || !(top > frameBottomAbs + EPS) || !(e.slabBottom < topAbs - EPS)) return [];
      return [fp.poly];
    });
  });
  return outline.map((p, i) => {
    const q = outline[(i + 1) % outline.length];
    const probe = add({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, scale(edgeOutward(outline, i), DECK.probe));
    return walls.some((poly) => pointInPolygon(probe, poly));
  });
}

/**
 * Where flights of stairs reach the deck: a flight on any level, visible and able to be seen with
 * the deck, whose top is within DECK.openingBelow below (or DECK.openingAbove above) the boards and
 * whose two top corners lie within DECK.openingTol of an edge. Merged per edge, sorted.
 */
export function deckStairOpenings(plan: Plan, levelId: Id, deck: Pick<Deck, 'outline' | 'elevation' | 'phase'>, viewMode: ViewMode): DeckOpening[] {
  const elev = getLevelElevations(plan);
  const at = elev[levelId];
  const outline = deck.outline;
  if (!at || outline.length < 3) return [];
  const topAbs = at.floorTop + deck.elevation;
  const lens = edgeLengths(outline);
  const raw: DeckOpening[] = [];
  for (const lid of plan.levelOrder) {
    const level = plan.levels[lid];
    const e = elev[lid];
    if (!level || !e) continue;
    const ftf = floorToFloor(plan, lid);
    for (const s of Object.values(level.stairs)) {
      if (!isVisible(s.phase, viewMode) || !phasesCoexist(s.phase, deck.phase)) continue;
      const sTop = e.floorTop + stairsBase(s) + stairsRise(s, ftf);
      if (sTop < topAbs - DECK.openingBelow - EPS || sTop > topAbs + DECK.openingAbove + EPS) continue;
      const [, tl, tr] = stairsOutline(s);
      outline.forEach((a, i) => {
        const b = outline[(i + 1) % outline.length];
        const pa = projectPointToSegment(tl, a, b);
        const pb = projectPointToSegment(tr, a, b);
        if (pa.distance > DECK.openingTol + EPS || pb.distance > DECK.openingTol + EPS) return;
        const ta = pa.t * lens[i];
        const tb = pb.t * lens[i];
        const from = Math.max(0, Math.min(ta, tb));
        const to = Math.min(lens[i], Math.max(ta, tb));
        if (to - from > EPS) raw.push({ edge: i, from, to, levelId: lid, stairsId: s.id });
      });
    }
  }
  raw.sort((p, q) => p.edge - q.edge || p.from - q.from);
  const out: DeckOpening[] = [];
  for (const o of raw) {
    const last = out[out.length - 1];
    if (last && last.edge === o.edge && o.from <= last.to + EPS) last.to = Math.max(last.to, o.to);
    else out.push({ ...o });
  }
  return out;
}

/** Corner `j` moved in by `w` from both edges that meet there (the intersection of the moved lines). */
function insetCorner(outline: readonly Vec2[], j: number, w: number): Vec2 {
  const n = outline.length;
  const prev = (j - 1 + n) % n;
  const dp = edgeDir(outline, prev);
  const dn = edgeDir(outline, j);
  const lp = add(outline[j], scale(edgeOutward(outline, prev), -w));
  const ln = add(outline[j], scale(edgeOutward(outline, j), -w));
  return lineIntersection(lp, dp, ln, dn) ?? ln;
}

/** A square of side `size` centred at `c`, turned to direction `d`. */
function square(c: Vec2, d: Vec2, size: number): Vec2[] {
  const h = size / 2;
  const n = { x: -d.y, y: d.x };
  return [add(add(c, scale(d, -h)), scale(n, -h)), add(add(c, scale(d, h)), scale(n, -h)), add(add(c, scale(d, h)), scale(n, h)), add(add(c, scale(d, -h)), scale(n, h))];
}

/** A band along edge i from `s0` to `s1`, between `in0` and `in1` inside the edge. */
function band(outline: readonly Vec2[], i: number, s0: number, s1: number, in0: number, in1: number): Vec2[] {
  const a = outline[i];
  const d = edgeDir(outline, i);
  const inward = scale(edgeOutward(outline, i), -1);
  const at = (s: number, off: number) => add(add(a, scale(d, s)), scale(inward, off));
  return [at(s0, in0), at(s1, in0), at(s1, in1), at(s0, in1)];
}

/** The outline as a positive polygon, and the original edge of each of its edges. */
function positive(outline: readonly Vec2[]): { poly: Vec2[]; edgeOf: (k: number) => number } {
  const n = outline.length;
  if (polygonSignedArea(outline) >= 0) return { poly: [...outline], edgeOf: (k) => k };
  return { poly: [...outline].reverse(), edgeOf: (k) => (((n - 2 - k) % n) + n) % n };
}

interface LayoutInputs {
  top: number;
  supported: boolean[];
  openings: DeckOpening[];
  postAt: { at: Vec2; dir: Vec2 }[];
  postGround: number[];
  edgeDrops: number[];
}

/** Support posts: on free edges, at corners between two free edges and evenly between, at most DECK.postSpacing apart. */
function postPositions(outline: readonly Vec2[], supported: readonly boolean[]): { at: Vec2; dir: Vec2 }[] {
  const n = outline.length;
  const lens = edgeLengths(outline);
  const c = DECK.postInset + DECK.post / 2;
  const out: { at: Vec2; dir: Vec2 }[] = [];
  for (let i = 0; i < n; i++) {
    if (supported[i]) continue;
    const d = edgeDir(outline, i);
    const prev = (i - 1 + n) % n;
    if (!supported[prev]) out.push({ at: insetCorner(outline, i, c), dir: d });
    const spans = Math.max(1, Math.ceil(lens[i] / DECK.postSpacing - EPS));
    const inward = scale(edgeOutward(outline, i), -c);
    for (let k = 1; k < spans; k++) out.push({ at: add(add(outline[i], scale(d, (lens[i] * k) / spans)), inward), dir: d });
  }
  return out;
}

function layoutInputs(plan: Plan, levelId: Id, deck: Deck, viewMode: ViewMode): LayoutInputs {
  const floorTop = getLevelElevations(plan)[levelId]?.floorTop ?? 0;
  const outline = deck.outline;
  const supported = deckSupportedEdges(plan, levelId, outline, deck.elevation, viewMode, deck.phase);
  const openings = deckStairOpenings(plan, levelId, deck, viewMode);
  const postAt = postPositions(outline, supported);
  const ground = (p: Vec2) => groundAt(plan, p) - floorTop;
  const lens = edgeLengths(outline);
  const edgeDrops = outline.map((a, i) => {
    const d = edgeDir(outline, i);
    const out = scale(edgeOutward(outline, i), DECK.probe);
    let drop = -Infinity;
    const steps = Math.max(1, Math.ceil(lens[i] / 12));
    for (let k = 0; k <= steps; k++) drop = Math.max(drop, deck.elevation - ground(add(add(a, scale(d, (lens[i] * k) / steps)), out)));
    return drop;
  });
  return { top: deck.elevation, supported, openings, postAt, postGround: postAt.map((p) => ground(p.at)), edgeDrops };
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

function signature(deck: Deck, inp: LayoutInputs): string {
  return JSON.stringify([
    deck.outline.map((p) => [r4(p.x), r4(p.y)]),
    r4(deck.elevation),
    deck.railings,
    inp.supported,
    inp.openings.map((o) => [o.edge, r4(o.from), r4(o.to)]),
    inp.postGround.map(r4),
    inp.edgeDrops.map(r4),
  ]);
}

/** Railing runs per edge: the railed edge minus its stair openings, runs shorter than DECK.minRun left out. */
function railingRuns(deck: Deck, openings: readonly DeckOpening[]): [number, number][][] {
  const lens = edgeLengths(deck.outline);
  return deck.outline.map((_, i) => {
    if (!deck.railings[i]) return [];
    const runs: [number, number][] = [];
    let from = 0;
    for (const o of openings.filter((x) => x.edge === i)) {
      if (o.from - from >= DECK.minRun) runs.push([from, o.from]);
      from = Math.max(from, o.to);
    }
    if (lens[i] - from >= DECK.minRun) runs.push([from, lens[i]]);
    return runs;
  });
}

function buildLayout(deck: Deck, inp: LayoutInputs, sig: string): DeckLayout {
  const outline = deck.outline;
  const n = outline.length;
  const lens = edgeLengths(outline);
  const top = inp.top;
  const boardBottom = top - DECK.board;
  const frameBottom = boardBottom - DECK.joist;
  const free = (i: number) => !inp.supported[i];

  // Boards over the whole outline; their joints on the plan parallel to the longest edge.
  const boards: DeckBox = { poly: outline.map((p) => ({ ...p })), bottom: boardBottom, top };
  const along = edgeDir(outline, longestEdge(outline));
  const boardLines = scanSegments(outline, along, DECK.boardLine);

  // Framing: the rim (the boards overhang it on free edges) and joists square to the boards.
  const pos = positive(outline);
  const rimOuter = insetPolygon(pos.poly, pos.poly.map((_, k) => (free(pos.edgeOf(k)) ? DECK.overhang : 0)));
  const rimInner = insetPolygon(pos.poly, pos.poly.map((_, k) => (free(pos.edgeOf(k)) ? DECK.overhang : 0) + DECK.band));
  const frame: DeckBox[] = [{ poly: rimOuter, holes: [rimInner], bottom: frameBottom, top: boardBottom }];
  const across = { x: -along.y, y: along.x };
  for (const [p, q] of scanSegments(rimInner, across, DECK.joistSpacing)) {
    const side = scale(along, DECK.joistWidth / 2);
    frame.push({ poly: [sub(p, side), sub(q, side), add(q, side), add(p, side)], bottom: frameBottom, top: boardBottom });
  }

  // Support posts from 6" below the ground to the framing's underside; none where the ground is up there.
  const posts: DeckPost[] = [];
  inp.postAt.forEach(({ at, dir }, k) => {
    const g = inp.postGround[k];
    if (!(g < frameBottom - 1)) return;
    posts.push({ at, poly: square(at, dir, DECK.post), bottom: g - DECK.postEmbed, top: frameBottom });
  });

  // Railings.
  const runs = railingRuns(deck, inp.openings);
  const railing: DeckBox[] = [];
  const caps: Vec2[][] = [];
  const c = DECK.railPost / 2;
  const capBottom = top + DECK.railHeight - DECK.capThick;
  const capTop = top + DECK.railHeight;
  const railBottom = top + DECK.bottomRailUp;
  const railTop = railBottom + DECK.bottomRailHeight;
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;
    const d = edgeDir(outline, i);
    const inward = scale(edgeOutward(outline, i), -1);
    const pointAt = (s: number, off: number) => add(add(outline[i], scale(d, s)), scale(inward, off));
    for (const [s0, s1] of runs[i]) {
      // A corner shared with the previous or next edge's railing: one post there, the caps mitred.
      const cornerStart = s0 <= EPS && runs[prev].some(([, e]) => e >= lens[prev] - EPS);
      const cornerEnd = s1 >= lens[i] - EPS && runs[next].some(([b]) => b <= EPS);
      const capPoly = [
        pointAt(s0, 0),
        pointAt(s1, 0),
        cornerEnd ? insetCorner(outline, next, DECK.cap) : pointAt(s1, DECK.cap),
        cornerStart ? insetCorner(outline, i, DECK.cap) : pointAt(s0, DECK.cap),
      ];
      caps.push(capPoly);
      railing.push({ poly: capPoly, bottom: capBottom, top: capTop });
      // Posts along the run: at its ends (a shared corner's post is placed by the edge it starts)
      // and evenly between, at most DECK.railPostSpacing apart.
      const a = s0 + c;
      const b = s1 - c;
      const stations: number[] = [];
      if (b - a < EPS) stations.push((s0 + s1) / 2);
      else {
        const spans = Math.max(1, Math.ceil((b - a) / DECK.railPostSpacing - EPS));
        for (let k = 0; k <= spans; k++) stations.push(a + ((b - a) * k) / spans);
      }
      stations.forEach((s, k) => {
        if (k === stations.length - 1 && cornerEnd && stations.length > 1) return;
        const at = k === 0 && cornerStart ? insetCorner(outline, i, c) : pointAt(s, c);
        railing.push({ poly: square(at, d, DECK.railPost), bottom: top, top: capBottom });
      });
      // Bottom rail and balusters between neighbouring posts' faces.
      for (let k = 0; k + 1 < stations.length; k++) {
        const g0 = stations[k] + c;
        const g1 = stations[k + 1] - c;
        if (g1 - g0 < EPS) continue;
        const t = DECK.bottomRailThick / 2;
        railing.push({ poly: band(outline, i, g0, g1, c - t, c + t), bottom: railBottom, top: railTop });
        const w = DECK.baluster;
        const count = Math.max(0, Math.ceil((g1 - g0 - DECK.balusterGap) / (DECK.balusterGap + w) - EPS));
        const gap = (g1 - g0 - count * w) / (count + 1);
        for (let m = 0; m < count; m++) {
          const s = g0 + gap * (m + 1) + w * m + w / 2;
          railing.push({ poly: square(pointAt(s, c), d, w), bottom: railTop, top: capBottom });
        }
      }
    }
  }

  return { sig, top, supported: inp.supported, openings: inp.openings, edgeDrops: inp.edgeDrops, boards, frame, posts, railing, caps, boardLines };
}

const layoutCache = new Map<string, { plan: Plan; sig: string; layout: DeckLayout }>();

/**
 * A deck's layout in a view mode, memoized: the same object while the plan is the same object, and
 * while everything it is built from (outline, top, railings, supported edges, stair openings, the
 * ground under the posts and outside the edges) is unchanged; phase and colour are not part of it.
 * Null when the deck is not there.
 */
export function getDeckLayout(plan: Plan, levelId: Id, deckId: Id, viewMode: ViewMode): DeckLayout | null {
  const key = `${levelId}|${deckId}|${viewMode}`;
  const hit = layoutCache.get(key);
  if (hit && hit.plan === plan) return hit.layout;
  const deck = plan.levels[levelId]?.decks?.[deckId];
  if (!deck) {
    layoutCache.delete(key);
    return null;
  }
  // Forget the layouts of decks this plan no longer has.
  for (const [k, v] of layoutCache) {
    if (v.plan === plan) continue;
    const [lid, did] = k.split('|');
    if (!plan.levels[lid]?.decks?.[did]) layoutCache.delete(k);
  }
  const inp = layoutInputs(plan, levelId, deck, viewMode);
  const sig = signature(deck, inp);
  if (hit && hit.sig === sig) {
    hit.plan = plan;
    return hit.layout;
  }
  const layout = buildLayout(deck, inp, sig);
  layoutCache.set(key, { plan, sig, layout });
  return layout;
}

/** Forget every memoized layout (tests). */
export function clearDeckLayouts(): void {
  layoutCache.clear();
}
