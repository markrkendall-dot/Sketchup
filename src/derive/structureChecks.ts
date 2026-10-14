// Structure against the code (checks.ts, DESIGN.md "Structure"): what the work takes out or adds
// has to be carried down to the ground. The checks judge the house after the work against the house
// as it stands; untouched existing structure is assumed adequate. They draw no conclusions about
// sizes: the engineer sizes every beam, post, footing and header.
//
//   - a wall taken out that likely bears (structure.ts) needs its load picked up wherever what it
//     carried stays (the floor above, or a roof kept over it): a wall or beam on its line or within
//     the joists' depth of it (R502.4);
//   - each end of a new beam bears on a wall at least 1 1/2" (3" on block), on a post, or on another
//     beam (a hanger) (R502.6);
//   - the load from each end of a new beam, and from each new post, goes down through a wall, post
//     or beam on every level below to a foundation wall or a post on a footing (R301.1, R403.1);
//   - a new floor opening's edges across the joists need headers, unless a wall or beam carries
//     them (R502.10); a new opening in an existing bearing wall needs a header (R602.7) (notes);
//   - a level where a wall comes out and the joists over it are not set.

import { CODE, codeRef, type CodeKey } from '../model/codeLimits';
import { add, cross, dist, dot, normalize, pointInPolygon, scale, sub } from '../model/geometry';
import type { Beam, Id, Level, Member, Plan, Post, Vec2, Wall } from '../model/types';
import { formatLength } from '../model/units';
import { issueId, type Issue, type IssueTarget, type Severity } from './checks';
import { compassName, edgeOutward } from './decks';
import { floorOpeningSupportedEdges } from './floorOpenings';
import { getFootprints } from './footprint';
import { beamOutline, joistDepth, joistsAt, postOutline } from './members';
import { isVisible } from './phase';
import { roofOutlineWithOverhang } from './roofs';
import { getFaces } from './rooms';
import { floorToFloor, stairsHoleOutline } from './stairs';
import { isParallel, joistVector, wallBearings, wallSegment, type Segment } from './structure';

const VIEW = 'proposed';
const TOL = 0.01;
/** Spacing of the points sampled along a wall taken out, inches. */
const SAMPLE = 6;
/** A gap in the support of a wall taken out shorter than this is ignored, inches. */
const MIN_GAP = 12;
/** How many supports a load is followed through before the trace gives up. */
const MAX_TRACE = 24;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What carries a point on a level: a wall it stands in, a post, or a beam it hangs on. */
type Support = { kind: 'wall'; wall: Wall; poly: Vec2[] } | { kind: 'post'; post: Post } | { kind: 'beam'; beam: Beam };

/** The ray from p along unit d to the polygon's boundary (p inside), inches. */
function exitDistance(p: Vec2, d: Vec2, poly: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const e = sub(poly[(i + 1) % poly.length], a);
    const denom = cross(d, e);
    if (Math.abs(denom) < 1e-12) continue;
    const ap = sub(a, p);
    const t = cross(ap, e) / denom;
    const u = cross(ap, d) / denom;
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return best;
}

/** Whether a segment runs along `s` within `offset` of its line and over point q. */
function carries(s: Segment, q: Vec2, d: Vec2, offset: number): boolean {
  const sd = normalize(sub(s.b, s.a));
  if (!isParallel(sd, d)) return false;
  const n = { x: -sd.y, y: sd.x };
  if (Math.abs(dot(sub(q, s.a), n)) > offset + TOL) return false;
  const t = dot(sub(q, s.a), sd);
  return t >= -1 && t <= dist(s.a, s.b) + 1;
}

export function structureIssues(plan: Plan): Issue[] {
  const out: Issue[] = [];
  const fmt = (v: number) => formatLength(v, plan.settings.precisionDenominator);
  const north = plan.site.northAngle;
  const existing = wallBearings(plan, 'existing');
  const proposed = wallBearings(plan, VIEW);
  // One issue per id: a load traced from two places can meet the same missing footing.
  const ids = new Set<string>();
  const add1 = (i: Issue) => {
    if (ids.has(i.id)) return;
    ids.add(i.id);
    out.push(i);
  };
  /** `part` tells apart two issues of one code about one element (a beam's two ends, an opening's edges). */
  const push = (code: string, key: CodeKey, severity: Severity, levelId: Id, at: Vec2, target: IssueTarget, message: string, outline?: Vec2[], part = '') =>
    add1({ id: issueId(code, levelId, target) + part, code, severity, category: 'structure', levelId, at, ...(outline ? { outline } : {}), message, ref: codeRef(key), target });

  /** The support of a point on a level after the work: a wall it stands in, a post, a beam. */
  const supportAt = (levelId: Id, p: Vec2, skip?: Id): Support | null => {
    const level = plan.levels[levelId];
    if (!level) return null;
    const fps = getFootprints(level, VIEW);
    for (const w of Object.values(level.walls)) {
      if (!isVisible(w.phase, VIEW)) continue;
      const poly = fps.get(w.id)?.poly;
      if (poly && pointInPolygon(p, poly)) return { kind: 'wall', wall: w, poly };
    }
    const members = Object.values(level.members ?? {}).filter((m) => m.id !== skip && isVisible(m.phase, VIEW));
    for (const m of members) if (m.kind === 'post' && pointInPolygon(p, postOutline(m, m.width, m.depth))) return { kind: 'post', post: m };
    for (const m of members) if (m.kind === 'beam' && pointInPolygon(p, beamOutline(m))) return { kind: 'beam', beam: m };
    return null;
  };

  plan.levelOrder.forEach((levelId, li) => {
    const level = plan.levels[levelId];
    if (!level) return;
    const depth = joistDepth(plan, levelId);

    // ---- Walls taken out that likely bear.
    const supports: Segment[] = [];
    for (const w of Object.values(level.walls)) {
      if (!isVisible(w.phase, VIEW)) continue;
      const s = wallSegment(level, w);
      if (s) supports.push(s);
    }
    for (const m of Object.values(level.members ?? {})) if (m.kind === 'beam' && isVisible(m.phase, VIEW)) supports.push({ a: m.a, b: m.b });
    // What a wall taken out carried that stays: the floor above it, or a roof kept over it.
    const aboveId = plan.levelOrder[li + 1];
    const aboveFaces = aboveId && plan.levels[aboveId] ? getFaces(plan.levels[aboveId], VIEW).outerFaces : [];
    const keptRoofs = Object.values(level.roofs ?? {}).filter((r) => r.phase === 'existing').map(roofOutlineWithOverhang);
    const loaded = (q: Vec2) => aboveFaces.some((f) => pointInPolygon(q, f)) || keptRoofs.some((r) => pointInPolygon(q, r));
    const unknownJoists: Id[] = [];
    for (const w of Object.values(level.walls)) {
      if (w.phase !== 'demo') continue;
      const seg = wallSegment(level, w);
      if (!seg) continue;
      const b = existing[levelId]?.get(w.id);
      if (w.kind === 'interior' && w.bearing === undefined && !joistsAt(plan, levelId, scale(add(seg.a, seg.b), 0.5), 'existing')) unknownJoists.push(w.id);
      if (!b?.bearing) continue;
      const len = dist(seg.a, seg.b);
      const d = normalize(sub(seg.b, seg.a));
      const runs: [number, number][] = [];
      const n = Math.max(1, Math.ceil(len / SAMPLE));
      for (let k = 0; k <= n; k++) {
        const t = Math.min(Math.max((k / n) * len, 0.5), len - 0.5);
        const q = add(seg.a, scale(d, t));
        if (!loaded(q) || supports.some((s) => carries(s, q, d, depth))) continue;
        const last = runs[runs.length - 1];
        if (last && t - last[1] <= len / n + TOL) last[1] = t;
        else runs.push([t, t]);
      }
      for (const [t0, t1] of runs) {
        const gap = Math.min(len, t1 - t0 + len / n);
        if (gap < MIN_GAP) continue;
        const at = add(seg.a, scale(d, (t0 + t1) / 2));
        push(
          'structure.bearing-removed',
          'joistOffset',
          b.explicit ? 'error' : 'warning',
          levelId,
          at,
          { walls: [w.id] },
          `${w.kind === 'exterior' ? 'An exterior wall' : 'A wall'} taken out here is ${b.explicit ? '' : 'likely '}bearing (${b.reason}); nothing picks up its load over ${fmt(gap)}. Draw a beam (I) on its line or within ${fmt(depth)} of it, or keep the wall.`,
          getFootprints(level, 'existing').get(w.id)?.poly,
        );
      }
    }
    if (unknownJoists.length && !level.framing)
      push('structure.framing-unset', 'joistOffset', 'warning', levelId, wallSegment(level, level.walls[unknownJoists[0]])!.a, { walls: unknownJoists }, `Set the joists over the ${level.name} (Level panel): without them the checks cannot tell whether the walls taken out there bear.`);

    // ---- New beams: their ends, and the load from them down to the ground.
    for (const m of Object.values(level.members ?? {})) {
      if (m.phase !== 'new' || !isVisible(m.phase, VIEW)) continue;
      if (m.kind === 'post') {
        trace(li, m.at, { kind: 'post', post: m }, m, 'the post');
        continue;
      }
      for (const [end, other, part] of [
        [m.a, m.b, '|a'],
        [m.b, m.a, '|b'],
      ] as const) {
        const u = normalize(sub(other, end));
        const name = `the beam's ${compassName(scale(u, -1), north)} end`;
        const s = supportAt(levelId, end, m.id);
        if (!s) {
          push('structure.beam-end', 'bearingWood', 'error', levelId, end, { members: [m.id] }, `${capitalize(name)} has nothing under it: end it on a wall, a post or another beam.`, beamOutline(m), part);
          continue;
        }
        if (s.kind === 'wall') {
          const bearing = exitDistance(end, u, s.poly);
          const need = s.wall.finish === 'block' ? CODE.bearingMasonry.value : CODE.bearingWood.value;
          if (bearing < need - TOL)
            push('structure.beam-end', s.wall.finish === 'block' ? 'bearingMasonry' : 'bearingWood', 'error', levelId, end, { members: [m.id] }, `${capitalize(name)} bears ${fmt(bearing)} on the wall, under the ${fmt(need)} needed: run it further onto the wall.`, beamOutline(m), part);
        }
        if (s.kind !== 'beam') trace(li, end, s, m, name);
      }
    }

    // ---- Headers: new floor openings and holes cut in a floor, new openings in bearing walls.
    if (li > 0) {
      const below = plan.levelOrder[li - 1];
      const belowLevel = plan.levels[below];
      for (const fo of Object.values(level.floorOpenings ?? {})) {
        if (fo.phase !== 'new') continue;
        const supported = floorOpeningSupportedEdges(plan, levelId, fo, VIEW);
        headers(below, belowLevel, fo.outline, supported, { floorOpenings: [fo.id] }, 'floor opening');
      }
    }
    const above = plan.levelOrder[li + 1];
    if (above) {
      const ftf = floorToFloor(plan, levelId);
      for (const s of Object.values(level.stairs)) {
        if (s.phase !== 'new' || !s.cutsFloorAbove) continue;
        const hole = stairsHoleOutline(s, ftf, level.wallHeight);
        if (hole) headers(levelId, level, hole, hole.map(() => false), { stairs: [s.id] }, 'stair opening', above);
      }
    }
    const fps = getFootprints(level, VIEW);
    for (const o of Object.values(level.openings)) {
      const w = level.walls[o.wallId];
      if (o.phase !== 'new' || !w || w.phase !== 'existing') continue;
      const b = proposed[levelId]?.get(w.id);
      const fp = fps.get(w.id);
      if (!b?.bearing || !fp) continue;
      const at = add(fp.a, scale(normalize(sub(fp.b, fp.a)), o.offset));
      push('structure.wall-opening', 'wallHeader', 'info', levelId, at, { openings: [o.id] }, `HDR: the new ${o.type === 'window' ? 'window' : o.type === 'door' ? 'door' : 'opening'}, ${fmt(o.width)} wide, is in a ${b.explicit ? '' : 'likely '}bearing wall (${b.reason}): a header sized for the load over it.`);
    }
  });

  /**
   * Headers round a hole in the floor over level `framingId` (the joists over it): every edge across
   * the joists that no wall carries (`supported`) and no wall or beam of that level runs along.
   */
  function headers(framingId: Id, framing: Level, outline: Vec2[], supported: boolean[], target: IssueTarget, what: string, holeLevelId?: Id) {
    const centre = outline.reduce((acc, p) => add(acc, scale(p, 1 / outline.length)), { x: 0, y: 0 });
    const joists = joistsAt(plan, framingId, centre, VIEW);
    if (!joists) return;
    const j = joistVector(joists.joists);
    const depth = joistDepth(plan, framingId);
    const carriers: Segment[] = [];
    for (const w of Object.values(framing.walls)) {
      if (!isVisible(w.phase, VIEW)) continue;
      const s = wallSegment(framing, w);
      if (s) carriers.push(s);
    }
    for (const m of Object.values(framing.members ?? {})) if (m.kind === 'beam' && isVisible(m.phase, VIEW)) carriers.push({ a: m.a, b: m.b });
    outline.forEach((a, i) => {
      if (supported[i]) return;
      const b = outline[(i + 1) % outline.length];
      const len = dist(a, b);
      const d = normalize(sub(b, a));
      if (len < 1 || Math.abs(cross(d, j)) < Math.SQRT1_2) return;
      const mid = scale(add(a, b), 0.5);
      if ([0.1, 0.5, 0.9].every((t) => carriers.some((s) => carries(s, add(a, scale(d, t * len)), d, depth)))) return;
      const kind = len > CODE.headerHanger.value ? 'a doubled header on joist hangers' : len > CODE.headerDouble.value ? 'a doubled header' : 'a header';
      const levelId = holeLevelId ?? plan.levelOrder[plan.levelOrder.indexOf(framingId) + 1];
      push('structure.opening-header', 'headerDouble', 'info', levelId, mid, target, `HDR: the ${what}'s ${compassName(edgeOutward(outline, i), north)} edge cuts ${fmt(len)} of joists: ${kind}, and trimmers at its ends.`, undefined, `|${i}`);
    });
  }

  /**
   * Follow a point load from its support on a level down to the ground; push an issue where nothing
   * carries it, or where a post on the lowest level has no footing.
   */
  function trace(li: number, p: Vec2, s: Support, source: Member, name: string) {
    const seen = new Set<string>();
    const reported = new Set<string>();
    const target = { members: [source.id] };
    const missing = (lid: Id, q: Vec2, severity: Severity, message: string) => {
      const key = `${lid}|${Math.round(q.x)}|${Math.round(q.y)}`;
      if (reported.has(key)) return;
      reported.add(key);
      add1({ id: `${issueId('structure.load-path', lid, target)}|${key}`, code: 'structure.load-path', severity, category: 'structure', levelId: lid, at: q, message, ref: codeRef('loadPath'), target });
    };
    let steps = 0;
    const down = (lj: number, q: Vec2, sup: Support): void => {
      if (++steps > MAX_TRACE) return;
      const key = `${lj}|${sup.kind}|${sup.kind === 'wall' ? sup.wall.id : sup.kind === 'post' ? sup.post.id : sup.beam.id}|${Math.round(q.x * 4)}|${Math.round(q.y * 4)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const lid = plan.levelOrder[lj];
      if (sup.kind === 'beam') {
        // The load splits to the beam's ends, each on what carries it on this level.
        for (const e of [sup.beam.a, sup.beam.b]) {
          const s2 = supportAt(lid, e, sup.beam.id);
          if (!s2) missing(lid, e, 'error', `Nothing carries the end of the beam that ${name} loads, on the ${plan.levels[lid].name}: a wall or a post under it.`);
          else if (s2.kind !== 'beam') down(lj, e, s2);
        }
        return;
      }
      if (lj === 0) {
        if (sup.kind === 'post' && !sup.post.footing)
          add1({ id: issueId('structure.footing', lid, { members: [sup.post.id] }), code: 'structure.footing', severity: 'error', category: 'structure', levelId: lid, at: sup.post.at, message: `A post carrying ${name} stands on the slab with no footing under it.`, ref: codeRef('footing'), target: { members: [sup.post.id] } });
        return; // a wall on the lowest level stands on its footing
      }
      const belowId = plan.levelOrder[lj - 1];
      const below = plan.levels[belowId];
      const s2 = supportAt(belowId, q);
      if (s2) {
        down(lj - 1, q, s2);
        return;
      }
      const surveyed = Object.values(below?.walls ?? {}).some((w) => isVisible(w.phase, VIEW));
      if (surveyed) missing(belowId, q, 'error', `Nothing under the load from ${name} on the ${below.name}: a post or a wall under it, down to a footing.`);
      else missing(belowId, q, 'info', `The ${below?.name ?? 'level below'} is not drawn: follow the load from ${name} down to a footing on site.`);
    };
    down(li, p, s);
  }

  return out;
}
