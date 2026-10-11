import { add, cross, dist, dot, lineIntersection, normalize, perpLeft, scale, sub } from '../model/geometry';
import type { Id, Level, Vec2, ViewMode, Wall } from '../model/types';
import { isVisible } from './phase';

// Corner joins (DESIGN.md "Corner joins").
//
// Conventions: plan coordinates are y-down. For a wall a->b with unit direction d, "left" is
// perpLeft(d) = (d.y, -d.x): walking from a to b on screen, the left side is on your left (for a
// wall drawn to the right, left is up the screen). The left offset line is a + n*t/2 -> b + n*t/2.
//
// At a node N each incident wall has an outgoing direction u (away from N). Incident walls are
// sorted by atan2(u) ascending, which on a y-down screen is clockwise. Rotating u toward
// perpLeft(u) decreases the angle, so the wall's u-left edge faces the previous wall in that order
// and its u-right edge faces the next one. The corner of each sector between consecutive walls
// (i, i+1) is the intersection of rightEdge(i) and leftEdge(i+1); it is computed once per node and
// handed to both walls, so neighbours share bit-identical corner points (watertight 2D and 3D).
//
// Fallbacks: degree 1 -> square cap. Two opposite collinear walls form a "through" pair (a straight
// wall split by a T, or one arm pair of an X): both are square capped at the node and every other
// wall there lands its corners on their face lines. Other collinear neighbours -> square cap.
// An outer (reflex-sector) miter longer than 1.5 * max(t, t_neighbour) is beveled at that length.
// At nodes of degree >= 3 a quad alone leaves a hole around the node (a Y junction), so the cap of
// each non-through wall also runs through a hub point (the node, or the through wall's face line
// above it); those points are kept in `poly` and dropped when they are collinear with the cap.

/** Below this |cross| two directions count as collinear. */
export const COLLINEAR_EPS = 1e-6;
/** Outer miters longer than this times the thicker wall are beveled. */
export const MITER_LIMIT = 1.5;

export type Seg = [Vec2, Vec2];

export interface Footprint {
  wallId: Id;
  /** [leftA, leftB, rightB, rightA]: where the long edges end. "left" is the +perpLeft side of a->b. */
  quad: [Vec2, Vec2, Vec2, Vec2];
  /** Extra fill vertices at end a, in polygon order rightA -> ... -> leftA (bevels, junction hubs). */
  capA: Vec2[];
  /** Extra fill vertices at end b, in polygon order leftB -> ... -> rightB. */
  capB: Vec2[];
  /** Fill outline: [leftA, leftB, ...capB, rightB, rightA, ...capA]. Equals the quad in the usual case. */
  poly: Vec2[];
  /**
   * Stroke extents of the long edges, [leftA, leftB, rightB, rightA]. Same as `quad` except where
   * another wall butts against this wall's face at a T, where the edge starts at that wall's face.
   */
  edge: [Vec2, Vec2, Vec2, Vec2];
  /** End outline segments that are drawn: square caps at open (degree 1) ends and bevels. */
  capEdges: Seg[];
  /** Centerline endpoints. */
  a: Vec2;
  b: Vec2;
  /** Unit direction a->b and left normal. */
  dir: Vec2;
  normal: Vec2;
  length: number;
  thickness: number;
  /**
   * Core interval along the centerline, clear of corner joins: openings sit in [s0 + w/2, s1 - w/2].
   * s0 = max(0, proj(edge leftA), proj(edge rightA)), s1 likewise at b (DESIGN.md, with the edge
   * points so a T's butt wall mouth is excluded on the through wall too).
   */
  s0: number;
  s1: number;
  /** True when the end has no other visible wall. */
  openA: boolean;
  openB: boolean;
}

export type Footprints = ReadonlyMap<Id, Footprint>;

/** One wall end at a node, in the frame of the outgoing direction u. */
interface EndGeom {
  left: Vec2;
  right: Vec2;
  /** Extra outline points from the u-right corner to the u-left corner. */
  chain: Vec2[];
  edgeLeft: Vec2;
  edgeRight: Vec2;
  capEdges: Seg[];
  open: boolean;
}

interface Arm {
  wall: Wall;
  /** Outgoing unit direction. */
  u: Vec2;
  /** perpLeft(u). */
  n: Vec2;
  t: number;
  angle: number;
  /** This node is the wall's a end. */
  atA: boolean;
}

const leftLine = (N: Vec2, arm: Arm): Vec2 => add(N, scale(arm.n, arm.t / 2));
const rightLine = (N: Vec2, arm: Arm): Vec2 => sub(N, scale(arm.n, arm.t / 2));

const near = (p: Vec2, q: Vec2) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;

/** Drop chain points that duplicate or are collinear with their neighbours (from -> chain -> to). */
function cleanChain(from: Vec2, chain: Vec2[], to: Vec2): Vec2[] {
  const pts = [from, ...chain, to];
  let changed = true;
  while (changed && pts.length > 2) {
    changed = false;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i - 1];
      const q = pts[i];
      const r = pts[i + 1];
      const pr = sub(r, p);
      const len = Math.hypot(pr.x, pr.y);
      const off = len < 1e-9 ? dist(p, q) : Math.abs(cross(pr, sub(q, p))) / len;
      if (near(p, q) || near(q, r) || off < 1e-7) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts.slice(1, -1);
}

interface SectorCorner {
  /** Point where rightEdge(i) ends. */
  forRight: Vec2;
  /** Point where leftEdge(i+1) ends. */
  forLeft: Vec2;
  /** Bevel midpoint (shared extra outline point), if beveled. */
  mid: Vec2 | null;
  /** The sector is square capped on both sides (collinear neighbours). */
  square: boolean;
}

/** Compute every wall end at node N. `arms` must be sorted by angle ascending. */
function nodeEnds(N: Vec2, arms: Arm[], out: Map<string, EndGeom>): void {
  const k = arms.length;
  const key = (arm: Arm) => `${arm.wall.id}|${arm.atA ? 'a' : 'b'}`;
  if (k === 1) {
    const arm = arms[0];
    const left = leftLine(N, arm);
    const right = rightLine(N, arm);
    out.set(key(arm), { left, right, chain: [], edgeLeft: left, edgeRight: right, capEdges: [[left, right]], open: true });
    return;
  }

  // The through pair: two opposite collinear arms, preferring the thickest pair (deterministic).
  let through: [number, number] | null = null;
  let bestT = -1;
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const ui = arms[i].u;
      const uj = arms[j].u;
      if (Math.abs(cross(ui, uj)) < COLLINEAR_EPS && dot(ui, uj) < 0) {
        const t = arms[i].t + arms[j].t;
        if (t > bestT) {
          bestT = t;
          through = [i, j];
        }
      }
    }
  }
  const isThrough = (i: number) => through !== null && (through[0] === i || through[1] === i);

  // Sector corners, sector s lies between arms s and s+1 (ascending angle).
  const sectors: SectorCorner[] = [];
  for (let s = 0; s < k; s++) {
    const i = s;
    const j = (s + 1) % k;
    const A = arms[i];
    const B = arms[j];
    const squareA = rightLine(N, A);
    const squareB = leftLine(N, B);
    if ((isThrough(i) && isThrough(j)) || Math.abs(cross(A.u, B.u)) < COLLINEAR_EPS) {
      sectors.push({ forRight: squareA, forLeft: squareB, mid: null, square: true });
      continue;
    }
    const P = lineIntersection(squareA, A.u, squareB, B.u);
    if (!P) {
      sectors.push({ forRight: squareA, forLeft: squareB, mid: null, square: true });
      continue;
    }
    let sweep = B.angle - A.angle;
    if (sweep <= 0) sweep += 2 * Math.PI;
    const cap = MITER_LIMIT * Math.max(A.t, B.t);
    const miter = dist(N, P);
    // Through walls keep their square caps; only an outer corner between two mitering walls bevels.
    if (sweep > Math.PI && miter > cap && !isThrough(i) && !isThrough(j)) {
      const bdir = normalize(sub(P, N));
      const cutAt = add(N, scale(bdir, cap));
      const cutDir = perpLeft(bdir);
      const pa = lineIntersection(squareA, A.u, cutAt, cutDir) ?? squareA;
      const pb = lineIntersection(squareB, B.u, cutAt, cutDir) ?? squareB;
      const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
      sectors.push({ forRight: pa, forLeft: pb, mid, square: false });
    } else {
      sectors.push({ forRight: P, forLeft: P, mid: null, square: false });
    }
  }

  // Hub points for non-through walls at junctions of degree >= 3.
  const hubFor = (i: number): Vec2[] => {
    if (k < 3) return [];
    if (!through) return [{ x: N.x, y: N.y }];
    // Through halves reached going up (u-right side) and down (u-left side) in angle order.
    let up = (i + 1) % k;
    while (!isThrough(up)) up = (up + 1) % k;
    let down = (i - 1 + k) % k;
    while (!isThrough(down)) down = (down - 1 + k) % k;
    const side = (th: Arm) => {
      // Normal of the through arm pointing to the side where arm i lies.
      const s = cross(th.u, arms[i].u) < 0 ? 1 : -1; // cross<0: arm i is on th's perpLeft side
      return add(N, scale(th.n, (s * th.t) / 2));
    };
    return [side(arms[up]), side(arms[down])];
  };

  for (let i = 0; i < k; i++) {
    const arm = arms[i];
    const leftSector = sectors[(i - 1 + k) % k]; // between arm i-1 and arm i: arm i's left edge
    const rightSector = sectors[i]; // between arm i and arm i+1: arm i's right edge
    if (isThrough(i)) {
      const left = leftLine(N, arm);
      const right = rightLine(N, arm);
      // Trim stroked edges where a butt wall's face lands on this face.
      const edgeLeft = leftSector.square ? left : leftSector.forLeft;
      const edgeRight = rightSector.square ? right : rightSector.forRight;
      out.set(key(arm), { left, right, chain: [], edgeLeft, edgeRight, capEdges: [], open: false });
      continue;
    }
    const left = leftSector.forLeft;
    const right = rightSector.forRight;
    const raw: Vec2[] = [];
    const capEdges: Seg[] = [];
    if (rightSector.mid) {
      raw.push(rightSector.mid);
      capEdges.push([right, rightSector.mid]);
    }
    raw.push(...hubFor(i));
    if (leftSector.mid) {
      raw.push(leftSector.mid);
      capEdges.push([leftSector.mid, left]);
    }
    const chain = cleanChain(right, raw, left);
    out.set(key(arm), { left, right, chain, edgeLeft: left, edgeRight: right, capEdges, open: false });
  }
}

/**
 * Footprints of the walls visible in `viewMode`, mitered against each other only. Pure and not
 * memoized: safe on immer drafts (the store uses it to clamp openings). Use getFootprints in UI code.
 */
export function computeFootprints(level: Pick<Level, 'nodes' | 'walls'>, viewMode: ViewMode): Map<Id, Footprint> {
  const armsAt = new Map<Id, Arm[]>();
  const visible: Wall[] = [];
  for (const wall of Object.values(level.walls)) {
    if (!isVisible(wall.phase, viewMode)) continue;
    const a = level.nodes[wall.a];
    const b = level.nodes[wall.b];
    if (!a || !b || dist(a, b) < 1e-9) continue;
    visible.push(wall);
    const d = normalize(sub(b, a));
    const push = (nodeId: Id, u: Vec2, atA: boolean) => {
      const arm: Arm = { wall, u, n: perpLeft(u), t: wall.thickness, angle: Math.atan2(u.y, u.x), atA };
      const list = armsAt.get(nodeId);
      if (list) list.push(arm);
      else armsAt.set(nodeId, [arm]);
    };
    push(wall.a, d, true);
    push(wall.b, { x: -d.x, y: -d.y }, false);
  }

  const ends = new Map<string, EndGeom>();
  for (const [nodeId, arms] of armsAt) {
    arms.sort((p, q) => p.angle - q.angle || (p.wall.id < q.wall.id ? -1 : p.wall.id > q.wall.id ? 1 : 0));
    const n = level.nodes[nodeId];
    nodeEnds({ x: n.x, y: n.y }, arms, ends);
  }

  const out = new Map<Id, Footprint>();
  for (const wall of visible) {
    const an = level.nodes[wall.a];
    const bn = level.nodes[wall.b];
    const A: Vec2 = { x: an.x, y: an.y };
    const B: Vec2 = { x: bn.x, y: bn.y };
    const length = dist(A, B);
    const dir = normalize(sub(B, A));
    const normal = perpLeft(dir);
    const ea = ends.get(`${wall.id}|a`)!;
    const eb = ends.get(`${wall.id}|b`)!;
    // At b the outgoing direction is -dir, so its u-left side is the wall's right side.
    const quad: Footprint['quad'] = [ea.left, eb.right, eb.left, ea.right];
    const edge: Footprint['edge'] = [ea.edgeLeft, eb.edgeRight, eb.edgeLeft, ea.edgeRight];
    const capA = ea.chain;
    const capB = eb.chain;
    const proj = (p: Vec2) => dot(sub(p, A), dir);
    const s0 = Math.max(0, proj(edge[0]), proj(edge[3]));
    const s1 = Math.min(length, proj(edge[1]), proj(edge[2]));
    out.set(wall.id, {
      wallId: wall.id,
      quad,
      capA,
      capB,
      poly: [quad[0], quad[1], ...capB, quad[2], quad[3], ...capA],
      edge,
      capEdges: [...ea.capEdges, ...eb.capEdges],
      a: A,
      b: B,
      dir,
      normal,
      length,
      thickness: wall.thickness,
      s0,
      s1,
      openA: ea.open,
      openB: eb.open,
    });
  }
  return out;
}

const samePt = (p: Vec2, q: Vec2) => p.x === q.x && p.y === q.y;
const samePts = (p: readonly Vec2[], q: readonly Vec2[]) => p.length === q.length && p.every((pt, i) => samePt(pt, q[i]));

function sameFootprint(p: Footprint, q: Footprint): boolean {
  return (
    p.length === q.length &&
    p.thickness === q.thickness &&
    p.s0 === q.s0 &&
    p.s1 === q.s1 &&
    p.openA === q.openA &&
    p.openB === q.openB &&
    samePt(p.a, q.a) &&
    samePt(p.b, q.b) &&
    samePts(p.quad, q.quad) &&
    samePts(p.edge, q.edge) &&
    samePts(p.capA, q.capA) &&
    samePts(p.capB, q.capB) &&
    p.capEdges.length === q.capEdges.length &&
    p.capEdges.every((s, i) => samePt(s[0], q.capEdges[i][0]) && samePt(s[1], q.capEdges[i][1]))
  );
}

const cache = new WeakMap<Level, Map<ViewMode, Footprints>>();
/** Previous result per level id and view mode, used to keep footprint identity for unchanged walls. */
const previous = new Map<string, Footprints>();

/**
 * Footprints of the walls visible in `viewMode` on a level (hidden walls have none, and do not
 * affect the corners of visible ones). Memoized per Level object and view mode; a wall whose
 * footprint is value-equal to the previous computation keeps the previous object, so consumers can
 * memoize on footprint identity and rebuild only walls that actually changed. When nothing changed
 * at all the previous Map itself is returned.
 */
export function getFootprints(level: Level, viewMode: ViewMode): Footprints {
  let byMode = cache.get(level);
  const hit = byMode?.get(viewMode);
  if (hit) return hit;
  const prevKey = `${level.id}|${viewMode}`;
  const prev = previous.get(prevKey);
  const fresh = computeFootprints(level, viewMode);
  const next = new Map<Id, Footprint>();
  let allSame = prev !== undefined && prev.size === fresh.size;
  for (const [id, fp] of fresh) {
    const old = prev?.get(id);
    if (old && sameFootprint(old, fp)) next.set(id, old);
    else {
      next.set(id, fp);
      allSame = false;
    }
  }
  const result: Footprints = allSame && prev ? prev : next;
  if (!byMode) {
    byMode = new Map();
    cache.set(level, byMode);
  }
  byMode.set(viewMode, result);
  previous.set(prevKey, result);
  return result;
}
