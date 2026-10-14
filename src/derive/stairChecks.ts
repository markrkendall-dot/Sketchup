// Stairs against the code (checks.ts, model/codeLimits.ts): new flights, landings and platforms in
// the proposed view. Existing stairs are recorded as they are and not checked. Each piece is judged
// on its own (risers, treads, width, headroom, handrail, guards on its open edges) and as part of
// its stairway (stairChain.ts): risers matching from piece to piece, landings big enough for the
// flights they serve, and the last riser up to the floor above.

import { CODE, codeRef, type CodeKey } from '../model/codeLimits';
import { add, pointInPolygon, scale, sub } from '../model/geometry';
import type { Id, Plan, Stairs, Vec2 } from '../model/types';
import { formatLength } from '../model/units';
import { issueId, type Issue, type IssueCategory, type Severity } from './checks';
import { compassName, DECK, getDeckLayout } from './decks';
import { floorOpeningHoles } from './floorOpenings';
import { getFootprints } from './footprint';
import { getLevelElevations } from './levels';
import { isVisible } from './phase';
import { getFaces } from './rooms';
import { groundAt } from './site';
import { getStaircaseLayout } from './staircase';
import { flightLinks, stairChains, stairsTop } from './stairChain';
import { directionVector, flightSteps, floorToFloor, stairsBase, stairsFrame, stairsHoleOutline, stairsOutline, stairsPoint } from './stairs';

const VIEW = 'proposed';
/** Slack on every limit, so a number typed to the limit passes (rounding, not a tolerance). */
const TOL = 0.01;
/** Spacing of the points a check samples along a run or an edge, inches. */
const SAMPLE = 6;

const fmt = (v: number) => formatLength(v, 16);

/** Points from a to b at most SAMPLE apart, both ends inset by `inset`. */
function samples(a: Vec2, b: Vec2, inset = 1): Vec2[] {
  const d = sub(b, a);
  const len = Math.hypot(d.x, d.y);
  if (len <= 2 * inset) return [scale(add(a, b), 0.5)];
  const n = Math.max(1, Math.ceil((len - 2 * inset) / SAMPLE));
  const u = scale(d, 1 / len);
  return Array.from({ length: n + 1 }, (_, i) => add(a, scale(u, inset + ((len - 2 * inset) * i) / n)));
}

/** Where a piece of stairs is: "A flight climbing east" or "A landing". */
function pieceName(s: Stairs, risers: number, northAngle: number): string {
  if (risers <= 1) return 'A landing';
  return `A flight climbing ${compassName(directionVector(s.direction), northAngle)}`;
}

/** The height of the walking surface over the level's floor at distance `d` up the run. */
function surfaceAt(s: Stairs, risers: number, rise: number, d: number): number {
  const tread = s.run / risers;
  const k = Math.min(risers, Math.max(1, Math.ceil((d - 1e-6) / tread)));
  return stairsBase(s) + k * rise;
}

export function stairIssues(plan: Plan): Issue[] {
  const out: Issue[] = [];
  const north = plan.site.northAngle;
  const elev = getLevelElevations(plan);
  // Flights that reach a deck: they arrive at its boards, not at the floor above.
  const toDeck = new Set<Id>();
  for (const lid of plan.levelOrder) {
    for (const d of Object.values(plan.levels[lid]?.decks ?? {})) {
      if (!isVisible(d.phase, VIEW)) continue;
      for (const o of getDeckLayout(plan, lid, d.id, VIEW)?.openings ?? []) if (o.stairsId) toDeck.add(o.stairsId);
    }
  }

  plan.levelOrder.forEach((levelId, li) => {
    const level = plan.levels[levelId];
    const e = elev[levelId];
    if (!level || !e) return;
    const ftf = floorToFloor(plan, levelId);
    const lowest = li === 0;
    const all = Object.values(level.stairs).filter((s) => isVisible(s.phase, VIEW));
    const byId = new Map(all.map((s) => [s.id, s]));
    const isNew = (s: Stairs) => s.phase === 'new';
    if (!all.some(isNew)) return;
    const links = flightLinks(plan, levelId, VIEW);
    const steps = new Map(all.map((s) => [s.id, flightSteps(s, ftf)]));
    const push = (code: string, key: CodeKey, severity: Severity, s: Stairs | Stairs[], at: Vec2, message: string, category: IssueCategory = 'stair') => {
      const list = Array.isArray(s) ? s : [s];
      const target = { stairs: list.map((x) => x.id) };
      out.push({ id: issueId(code, levelId, target), code, severity, category, levelId, at, outline: stairsOutline(list[0]), message, ref: codeRef(key), target });
    };
    const centre = (s: Stairs) => stairsPoint(stairsFrame(s), s.run / 2, 0);

    // What is over the treads: the slab above, but for floor openings and the holes flights cut.
    const above = plan.levels[plan.levelOrder[li + 1]];
    const holes: Vec2[][] = above ? floorOpeningHoles(plan, above.id, VIEW) : [];
    for (const s of all) if (s.cutsFloorAbove) holes.push(...[stairsHoleOutline(s, ftf, level.wallHeight)].filter((h): h is Vec2[] => !!h));
    const ceiling = level.wallHeight;
    const underSlab = (p: Vec2) => !!above && !holes.some((h) => pointInPolygon(p, h));

    // Walls that stand beside an edge (a guard's work done by the wall).
    const fps = getFootprints(level, VIEW);
    const wallPolys = Object.values(level.walls).flatMap((w) => (isVisible(w.phase, VIEW) && fps.get(w.id) ? [fps.get(w.id)!.poly] : []));
    const inWall = (p: Vec2) => wallPolys.some((poly) => pointInPolygon(p, poly));
    const outer = getFaces(level, VIEW).outerFaces;
    /** The surface under a point beside the stairs, over the level's floor: the floor inside the house, the ground outside. */
    const below = (p: Vec2) => (outer.some((poly) => pointInPolygon(p, poly)) ? 0 : Math.min(lowest ? 0 : Infinity, groundAt(plan, p) - e.floorTop));

    for (const s of all) {
      if (!isNew(s)) continue;
      const { risers, rise } = steps.get(s.id)!;
      const name = pieceName(s, risers, north);
      const at = centre(s);
      const tread = s.run / risers;
      if (risers >= 2) {
        if (rise > CODE.riserMax.value + TOL) push('stair.riser-max', 'riserMax', 'error', s, at, `${name}: risers of ${fmt(rise)}, over the ${fmt(CODE.riserMax.value)} allowed.`);
        if (tread < CODE.treadMin.value - TOL) push('stair.tread-min', 'treadMin', 'error', s, at, `${name}: treads of ${fmt(tread)}, under the ${fmt(CODE.treadMin.value)} required.`);
        if (s.width < CODE.widthMin.value - TOL) push('stair.width', 'widthMin', 'error', s, at, `${name}: ${fmt(s.width)} wide, under the ${fmt(CODE.widthMin.value)} required.`);
        if (rise * risers > CODE.flightRiseMax.value + TOL) push('stair.flight-rise', 'flightRiseMax', 'error', s, at, `${name} rises ${fmt(rise * risers)} without a landing, over the ${fmt(CODE.flightRiseMax.value)} allowed.`);
        const railed = !!(s.railings?.left || s.railings?.right);
        if (risers >= CODE.handrailRisers.value && !railed)
          push('stair.handrail-missing', 'handrailRisers', 'warning', s, at, `${name} has ${risers} risers and no handrail drawn (a rail fixed to a wall counts, but is not drawn).`);
        // A flight on its own carries the deck's board as its rail; a staircase its style's rail.
        const sc = s.staircaseId ? level.staircases?.[s.staircaseId] : undefined;
        const board = sc ? sc.handrail === 'board' : true;
        if (railed && board)
          push('stair.handrail-grip', 'gripMax', 'warning', s, at, `${name}: its handrail is a ${fmt(DECK.cap)} x ${fmt(DECK.capThick)} board, not a graspable rail (1 1/4" to 2" round).`);
      }

      // Headroom: from the nosing line (the walking surface on a landing) to the slab above.
      const f = stairsFrame(s);
      let short = Infinity;
      // Up to an inch short of the top edge: past it is the floor above (or the next piece).
      for (let d = 1; d <= s.run - 1 + 1e-6; d += Math.min(SAMPLE, s.run - 2)) {
        const h = risers >= 2 ? stairsBase(s) + rise + (d * rise) / tread : stairsBase(s) + rise;
        for (const side of [-s.width / 2 + 1, 0, s.width / 2 - 1]) {
          if (underSlab(stairsPoint(f, d, side))) short = Math.min(short, ceiling - Math.min(h, stairsBase(s) + risers * rise));
        }
      }
      if (short < CODE.headroom.value - TOL) push('stair.headroom', 'headroom', 'error', s, at, `${name}: ${fmt(Math.max(0, short))} of headroom under the floor above, under the ${fmt(CODE.headroom.value)} required.`);

      // Guards: an edge with a drop over 30" beside it, no railing, no wall along it and no piece
      // of the stairway joined to it.
      const o = stairsOutline(s);
      const joined = new Set<number>(links.filter((l) => l.from === s.id).map((l) => l.edge));
      if (links.some((l) => l.to === s.id)) joined.add(3);
      const top = stairsTop(s, ftf);
      const arrives = Math.abs(top - ftf) <= CODE.uniformity.value || Math.abs(ftf - top - rise) <= CODE.uniformity.value || toDeck.has(s.id);
      if (arrives) joined.add(1);
      const railedEdge = [!!s.railings?.left, false, !!s.railings?.right, false];
      const open: number[] = [];
      for (let i = 0; i < 4; i++) {
        if (joined.has(i) || railedEdge[i]) continue;
        const outward = i === 0 ? scale(f.v, -1) : i === 2 ? f.v : i === 1 ? f.u : scale(f.u, -1);
        const exposed = samples(o[i], o[(i + 1) % 4]).some((p) => {
          const d = Math.max(0, Math.min(s.run, (p.x - f.origin.x) * f.u.x + (p.y - f.origin.y) * f.u.y));
          const h = i === 3 ? stairsBase(s) : surfaceAt(s, risers, rise, i === 1 ? s.run : d);
          const q = add(p, scale(outward, DECK.probe));
          if (inWall(q)) return false;
          // A lower piece of stairs beside it catches a fall from a riser's height, not the floor's.
          const beside = all.find((x) => x !== s && pointInPolygon(q, stairsOutline(x)));
          const floor = beside ? surfaceAt(beside, steps.get(beside.id)!.risers, steps.get(beside.id)!.rise, Math.max(0, (q.x - beside.origin.x) * stairsFrame(beside).u.x + (q.y - beside.origin.y) * stairsFrame(beside).u.y)) : below(q);
          return h - floor > CODE.guardDrop.value + TOL;
        });
        if (exposed) open.push(i);
      }
      if (open.length) {
        const sideName = (i: number) => (i === 0 ? 'left' : i === 2 ? 'right' : i === 1 ? 'far end' : 'bottom');
        push('stair.guard-missing', 'guardDrop', 'error', s, at, `${name}: its ${open.map(sideName).join(' and ')} ${open.length === 1 ? 'side is' : 'sides are'} more than 30" over the floor with no railing or wall.`, 'guard');
      }
    }

    // The stairways: matching risers, landings big enough, the last riser up to the floor.
    for (const chain of stairChains(plan, levelId, VIEW, links)) {
      const pieces = chain.map((id) => byId.get(id)!).filter(Boolean);
      if (!pieces.some(isNew)) continue;
      const last = pieces[pieces.length - 1];
      const rises = pieces.map((p) => steps.get(p.id)!.rise);
      const top = stairsTop(last, ftf);
      const gap = ftf - top;
      const arrivesFloor = Math.abs(gap) <= CODE.uniformity.value;
      // The floor's edge is the last riser when it is about a riser up; a stairway that stops
      // further down reaches something not drawn (a platform, a raised room) and is not judged here.
      const lastRiser = !arrivesFloor && !toDeck.has(last.id) && gap > 0 && gap <= CODE.riserMax.value + 1;
      if (lastRiser) rises.push(gap);
      const spread = Math.max(...rises) - Math.min(...rises);
      if (spread > CODE.uniformity.value + 1e-6) {
        push(
          'stair.uniformity',
          'uniformity',
          'error',
          pieces,
          centre(lastRiser ? last : pieces[0]),
          `A stairway's risers run from ${fmt(Math.min(...rises))} to ${fmt(Math.max(...rises))}${lastRiser ? ` (the last, up to the floor above, is ${fmt(gap)})` : ''}: more than ${fmt(CODE.uniformity.value)} apart.`,
        );
      }
      if (gap < -CODE.uniformity.value && !toDeck.has(last.id))
        push('stair.arrival', 'uniformity', 'warning', last, centre(last), `A stairway's top is ${fmt(-gap)} above the floor above.`);
    }
    // Staircases: their style against the code, walls rising into them, pieces not joined.
    for (const sc of Object.values(level.staircases ?? {})) {
      const layout = getStaircaseLayout(plan, levelId, sc.id, VIEW);
      if (!layout) continue;
      const pieces = layout.members.map((id) => byId.get(id)).filter((x): x is Stairs => !!x);
      if (!pieces.some(isNew)) continue;
      const st = layout.style;
      const name = sc.name ? `The ${sc.name}` : 'A staircase';
      const where = centre(pieces[0]);
      const railed = pieces.some((p) => p.railings?.left || p.railings?.right || p.railings?.end);
      if (railed && (st.handrailHeight < CODE.handrailMin.value - TOL || st.handrailHeight > CODE.handrailMax.value + TOL))
        push('stair.handrail-height', 'handrailMin', 'error', pieces, where, `${name}'s handrail is ${fmt(st.handrailHeight)} over the nosings, outside ${fmt(CODE.handrailMin.value)} to ${fmt(CODE.handrailMax.value)}.`);
      if (railed && st.balusterGap > CODE.guardOpeningStair.value + TOL)
        push('stair.baluster-gap', 'guardOpeningStair', 'error', pieces, where, `${name}'s balusters are up to ${fmt(st.balusterGap)} apart: a ${fmt(CODE.guardOpeningStair.value)} sphere must not pass.`, 'guard');
      const shallow = pieces.some((p) => steps.get(p.id)!.risers >= 2 && p.run / steps.get(p.id)!.risers < 11);
      if (shallow && (st.nosing < CODE.nosingMin.value - TOL || st.nosing > CODE.nosingMax.value + TOL))
        push('stair.nosing', 'nosingMin', 'error', pieces, where, `${name}'s nosings are ${fmt(st.nosing)}: treads under 11" want ${fmt(CODE.nosingMin.value)} to ${fmt(CODE.nosingMax.value)}.`);
      for (const w of layout.wallsThrough) {
        const p = byId.get(w.stairsId);
        if (!p) continue;
        const target = { stairs: [w.stairsId], walls: [w.wallId] };
        out.push({
          id: issueId('stair.wall-through', levelId, target),
          code: 'stair.wall-through',
          severity: 'error',
          category: 'stair',
          levelId,
          at: centre(p),
          outline: stairsOutline(p),
          message: `A wall rises into the underside of ${sc.name ? `the ${sc.name}` : 'a staircase'}: make it at most ${fmt(Math.max(0, w.room))} high there, or frame the stair's underside.`,
          ref: 'R318.7 (was R311.7)',
          target,
        });
      }
      if (layout.loose.length)
        push('stair.chain-broken', 'landingDepth', 'warning', layout.loose.map((id) => byId.get(id)!).filter(Boolean), where, `${name} has ${layout.loose.length === 1 ? 'a piece' : `${layout.loose.length} pieces`} not joined to the rest (its bottom edge along another piece's edge, at that piece's top).`);
    }

    // Landings: as wide as the flights they serve, 36" deep in the direction of travel.
    for (const l of links) {
      const a = byId.get(l.from)!;
      const b = byId.get(l.to)!;
      for (const [landing, flight] of [
        [a, b],
        [b, a],
      ] as const) {
        if (!isNew(landing) && !isNew(flight)) continue;
        if (steps.get(landing.id)!.risers !== 1 || steps.get(flight.id)!.risers < 2) continue;
        const u = stairsFrame(flight).u;
        const extent = (dir: Vec2) => {
          const ts = stairsOutline(landing).map((p) => p.x * dir.x + p.y * dir.y);
          return Math.max(...ts) - Math.min(...ts);
        };
        const along = extent(u);
        const across = extent({ x: -u.y, y: u.x });
        if (along < CODE.landingDepth.value - TOL || across < flight.width - TOL)
          push(
            'stair.landing-size',
            'landingDepth',
            'error',
            [landing, flight],
            centre(landing),
            `A landing is ${fmt(across)} wide and ${fmt(along)} deep for a ${fmt(flight.width)} flight: it needs the flight's width and ${fmt(CODE.landingDepth.value)} of depth.`,
          );
      }
    }
  });
  return out;
}
