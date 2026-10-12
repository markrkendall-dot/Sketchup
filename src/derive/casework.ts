import {
  BASIN,
  counterOverhangOf,
  counterTopOf,
  FIXTURE_PLAN_LABEL,
  FRONT,
  frontStyleOf,
  hasCounter,
  isCabinet,
  isOverhead,
  PANEL,
  TOE_KICK,
  type CounterOverhang,
} from '../model/casework';
import { add, cross, dot, polygonSignedArea, scale, sub } from '../model/geometry';
import type { Fixture, FrontStyle, Id, LevelFinishes, Vec2 } from '../model/types';
import { directionVector, normalizeDegrees } from './stairs';

// Casework geometry (DESIGN.md "Casework"). Pure: no three, no React. A fixture is a plan
// rectangle in its own frame: `origin` is the middle of its back edge, `u` the unit direction its
// front faces, `v` the lateral direction to the right of `u` on screen. Local coordinates are
// (s, d, y): s along the back from its middle (positive toward v), d from the back toward the
// front, y above the level's floor top.

export interface FixtureFrame {
  origin: Vec2;
  /** Unit direction the front faces (from the back toward the front). */
  u: Vec2;
  /** Unit lateral direction, to the right of u on screen. */
  v: Vec2;
}

export function fixtureFrame(f: Pick<Fixture, 'origin' | 'direction'>): FixtureFrame {
  const u = directionVector(f.direction);
  return { origin: f.origin, u, v: { x: -u.y, y: u.x } };
}

/** Plan point at `d` from the back and `s` to the right of the back's middle. */
export const fixturePoint = (fr: FixtureFrame, s: number, d: number): Vec2 => add(add(fr.origin, scale(fr.u, d)), scale(fr.v, s));

/** Footprint rectangle: back-left, front-left, front-right, back-right (left is -v). */
export function fixtureOutline(f: Pick<Fixture, 'origin' | 'direction' | 'width' | 'depth'>): Vec2[] {
  const fr = fixtureFrame(f);
  const h = f.width / 2;
  return [fixturePoint(fr, -h, 0), fixturePoint(fr, -h, f.depth), fixturePoint(fr, h, f.depth), fixturePoint(fr, h, 0)];
}

/** The fixture's rectangle grown by its counter overhang (back-left, front-left, front-right, back-right). */
export function counterOutline(f: Pick<Fixture, 'origin' | 'direction' | 'width' | 'depth' | 'kind' | 'counterOverhang'>, over: CounterOverhang = counterOverhangOf(f)): Vec2[] {
  const fr = fixtureFrame(f);
  const h = f.width / 2;
  return [
    fixturePoint(fr, -h - over.left, -over.back),
    fixturePoint(fr, -h - over.left, f.depth + over.front),
    fixturePoint(fr, h + over.right, f.depth + over.front),
    fixturePoint(fr, h + over.right, -over.back),
  ];
}

/** (s, d) of a plan point in the fixture's frame. */
export function fixtureLocal(f: Pick<Fixture, 'origin' | 'direction'>, p: Vec2): { s: number; d: number } {
  const fr = fixtureFrame(f);
  const rel = sub(p, fr.origin);
  return { s: dot(rel, fr.v), d: dot(rel, fr.u) };
}

/** True when p lies on the fixture's footprint grown by `pad`. */
export function hitFixture(f: Pick<Fixture, 'origin' | 'direction' | 'width' | 'depth'>, p: Vec2, pad = 0): boolean {
  const { s, d } = fixtureLocal(f, p);
  return d >= -pad && d <= f.depth + pad && Math.abs(s) <= f.width / 2 + pad;
}

/** The sink basin's rectangle in the fixture's frame: centred across, centred in the cabinet's depth. */
export function basinLocal(f: Pick<Fixture, 'width' | 'depth'>): { s0: number; s1: number; d0: number; d1: number } {
  const w = Math.min(BASIN.width, f.width - 2);
  const dp = Math.min(BASIN.depth, f.depth - 1);
  return { s0: -w / 2, s1: w / 2, d0: (f.depth - dp) / 2, d1: (f.depth + dp) / 2 };
}

/** The basin's plan rectangle (same order as fixtureOutline). */
export function basinOutline(f: Pick<Fixture, 'origin' | 'direction' | 'width' | 'depth'>): Vec2[] {
  const fr = fixtureFrame(f);
  const b = basinLocal(f);
  return [fixturePoint(fr, b.s0, b.d0), fixturePoint(fr, b.s0, b.d1), fixturePoint(fr, b.s1, b.d1), fixturePoint(fr, b.s1, b.d0)];
}

// ---------------------------------------------------------------------------------------------
// Boxes: a fixture as axis-aligned boxes in its own frame, one material part each.

/** What a box is made of (view3d/materials.ts picks the material). */
export type CasePart = 'carcass' | 'front' | 'kick' | 'appliance' | 'basin';

export interface CaseBox {
  part: CasePart;
  /** Lateral extent, from the back's middle (negative to the left). */
  s0: number;
  s1: number;
  /** From the back toward the front. */
  d0: number;
  d1: number;
  /** Above the floor top. */
  y0: number;
  y1: number;
}

const box = (part: CasePart, s0: number, s1: number, d0: number, d1: number, y0: number, y1: number): CaseBox | null =>
  s1 - s0 > 1e-6 && d1 - d0 > 1e-6 && y1 - y0 > 1e-6 ? { part, s0, s1, d0, d1, y0, y1 } : null;

function pushBox(out: CaseBox[], b: CaseBox | null): void {
  if (b) out.push(b);
}

/** How many door fronts a width takes: one per 18", at least one. */
export const doorCount = (width: number): number => Math.max(1, Math.round(width / FRONT.doorWidth));

/** The lateral spans of `n` fronts across [-w/2, w/2] with a reveal between them and at the ends. */
export function frontSpans(width: number, n: number): [number, number][] {
  const inner = width - FRONT.reveal * (n + 1);
  const each = inner / n;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const s0 = -width / 2 + FRONT.reveal + i * (each + FRONT.reveal);
    out.push([s0, s0 + each]);
  }
  return out;
}

/**
 * One door or drawer front over the lateral span [s0, s1] and the height [y0, y1], at the front
 * face `dFront` (the boxes end at d = dFront). A slab is one box; a panel front is four frame
 * boards round a recessed panel.
 */
function front(out: CaseBox[], style: FrontStyle, part: CasePart, s0: number, s1: number, y0: number, y1: number, dFront: number): void {
  const d0 = dFront - FRONT.thickness;
  const w = s1 - s0;
  const h = y1 - y0;
  if (style === 'slab' || w < 2 * PANEL.frame + 1 || h < 2 * PANEL.frame + 1) {
    pushBox(out, box(part, s0, s1, d0, dFront, y0, y1));
    return;
  }
  const f = PANEL.frame;
  pushBox(out, box(part, s0, s0 + f, d0, dFront, y0, y1)); // left stile
  pushBox(out, box(part, s1 - f, s1, d0, dFront, y0, y1)); // right stile
  pushBox(out, box(part, s0 + f, s1 - f, d0, dFront, y1 - f, y1)); // top rail
  pushBox(out, box(part, s0 + f, s1 - f, d0, dFront, y0, y0 + f)); // bottom rail
  pushBox(out, box(part, s0 + f, s1 - f, d0, dFront - PANEL.recess, y0 + f, y1 - f)); // recessed panel
}

/**
 * The boxes of a fixture in its own frame. Cabinets: a carcass behind the fronts, a toe kick under
 * a floor-standing one, `doorCount` fronts with reveals (base, island and sink cabinets get a 6"
 * drawer front across the top of each door). Appliances are steel boxes with a few details (a
 * range's cooktop and backguard, a fridge's door reveal, an oven's panels). A sink is a base
 * cabinet with an open basin let into the counter.
 */
export function fixtureBoxes(f: Fixture, finishes?: LevelFinishes): CaseBox[] {
  const out: CaseBox[] = [];
  const w = f.width;
  const h = w / 2;
  const D = f.depth;
  const y0 = f.elevation;
  const y1 = f.elevation + f.height;
  const style = frontStyleOf(f, finishes);
  const standing = f.elevation < 1e-9;
  const kickTop = standing && f.height > TOE_KICK.height * 2 ? y0 + TOE_KICK.height : y0;

  const cabinet = (drawers: boolean) => {
    pushBox(out, box('carcass', -h, h, 0, D - FRONT.thickness, kickTop, y1));
    if (kickTop > y0) pushBox(out, box('kick', -h, h, TOE_KICK.setback, D - FRONT.thickness, y0, kickTop));
    for (const [s0, s1] of frontSpans(w, doorCount(w))) {
      const top = y1 - FRONT.reveal;
      const bottom = kickTop + FRONT.reveal;
      if (drawers && top - bottom > FRONT.drawer * 2) {
        front(out, style, 'front', s0, s1, top - FRONT.drawer, top, D);
        front(out, style, 'front', s0, s1, bottom, top - FRONT.drawer - FRONT.reveal, D);
      } else front(out, style, 'front', s0, s1, bottom, top, D);
    }
  };

  switch (f.kind) {
    case 'base':
    case 'island':
      cabinet(true);
      break;
    case 'wall':
    case 'tall':
      cabinet(false);
      break;
    case 'sink': {
      cabinet(true);
      const b = basinLocal(f);
      const top = counterTopOf(f);
      const bottom = Math.max(kickTop + 1, top - BASIN.deep);
      const t = BASIN.wall;
      pushBox(out, box('basin', b.s0, b.s1, b.d0, b.d1, bottom, bottom + t)); // bowl bottom
      pushBox(out, box('basin', b.s0, b.s0 + t, b.d0, b.d1, bottom, top)); // left wall
      pushBox(out, box('basin', b.s1 - t, b.s1, b.d0, b.d1, bottom, top)); // right wall
      pushBox(out, box('basin', b.s0 + t, b.s1 - t, b.d0, b.d0 + t, bottom, top)); // back wall
      pushBox(out, box('basin', b.s0 + t, b.s1 - t, b.d1 - t, b.d1, bottom, top)); // front wall
      break;
    }
    case 'range': {
      pushBox(out, box('appliance', -h, h, 0, D, y0, y1 - 1));
      pushBox(out, box('kick', -h, h, 0, D, y1 - 1, y1)); // the cooktop, dark
      pushBox(out, box('appliance', -h, h, 0, 2, y1, y1 + 8)); // backguard
      break;
    }
    case 'fridge': {
      const split = y0 + f.height * 0.7;
      pushBox(out, box('appliance', -h, h, 0, D - FRONT.thickness, y0, y1));
      pushBox(out, box('appliance', -h + FRONT.reveal, h - FRONT.reveal, D - FRONT.thickness, D, y0 + FRONT.reveal, split - FRONT.reveal));
      pushBox(out, box('appliance', -h + FRONT.reveal, h - FRONT.reveal, D - FRONT.thickness, D, split + FRONT.reveal, y1 - FRONT.reveal));
      break;
    }
    case 'dishwasher': {
      pushBox(out, box('appliance', -h, h, 0, D - FRONT.thickness, kickTop, y1));
      if (kickTop > y0) pushBox(out, box('kick', -h, h, TOE_KICK.setback, D - FRONT.thickness, y0, kickTop));
      pushBox(out, box('appliance', -h + FRONT.reveal, h - FRONT.reveal, D - FRONT.thickness, D, kickTop + FRONT.reveal, y1 - FRONT.reveal));
      break;
    }
    case 'wallOven': {
      pushBox(out, box('carcass', -h, h, 0, D - FRONT.thickness, kickTop, y1));
      if (kickTop > y0) pushBox(out, box('kick', -h, h, TOE_KICK.setback, D - FRONT.thickness, y0, kickTop));
      // A cabinet door below and above, the ovens between: two steel panels with a reveal.
      const ovenBottom = Math.max(kickTop + 12, y0 + 28);
      const ovenTop = Math.min(y1 - 6, ovenBottom + 48);
      const [span] = frontSpans(w, 1);
      front(out, style, 'front', span[0], span[1], kickTop + FRONT.reveal, ovenBottom - FRONT.reveal, D);
      const mid = (ovenBottom + ovenTop) / 2;
      pushBox(out, box('appliance', span[0], span[1], D - FRONT.thickness, D, ovenBottom, mid - FRONT.reveal));
      pushBox(out, box('appliance', span[0], span[1], D - FRONT.thickness, D, mid + FRONT.reveal, ovenTop));
      front(out, style, 'front', span[0], span[1], ovenTop + FRONT.reveal, y1 - FRONT.reveal, D);
      break;
    }
    case 'hood': {
      // A canopy the full depth, with a flue up the wall above it.
      const canopy = Math.min(6, f.height);
      pushBox(out, box('appliance', -h, h, 0, D, y0, y0 + canopy));
      pushBox(out, box('appliance', -Math.min(6, h), Math.min(6, h), 0, Math.min(12, D), y0 + canopy, y1));
      break;
    }
    case 'microwave':
      pushBox(out, box('appliance', -h, h, 0, D, y0, y1));
      break;
    case 'box':
      pushBox(out, box('carcass', -h, h, 0, D, y0, y1));
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Counter runs: one slab per group of touching counter fixtures.

export interface CounterRun {
  /** The fixtures under this slab, in id order. */
  fixtureIds: Id[];
  /** Plan outline (positive: clockwise on screen) and the basin holes in it. */
  outline: Vec2[];
  holes: Vec2[][];
  /** Level-local bottom and top of the slab. */
  y0: number;
  y1: number;
}

type Rect = { fixture: Fixture; poly: Vec2[]; basin: Vec2[] | null; minX: number; minY: number; maxX: number; maxY: number };

const EPS = 1e-6;
/** Rectangles closer than this touch (fixtures placed by the tool abut exactly). */
const TOUCH = 0.5;

const bbox = (poly: readonly Vec2[]) => ({
  minX: Math.min(...poly.map((p) => p.x)),
  minY: Math.min(...poly.map((p) => p.y)),
  maxX: Math.max(...poly.map((p) => p.x)),
  maxY: Math.max(...poly.map((p) => p.y)),
});

const isAxisAligned = (f: Pick<Fixture, 'direction'>): boolean => Math.abs(normalizeDegrees(f.direction) % 90) < 1e-9;

/** Drop the middle vertex of every straight run (and duplicates) of a ring. */
export function simplifyRing(ring: readonly Vec2[]): Vec2[] {
  const pts: Vec2[] = [];
  for (const p of ring) {
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last.x - p.x) > EPS || Math.abs(last.y - p.y) > EPS) pts.push(p);
  }
  while (pts.length > 1 && Math.abs(pts[0].x - pts[pts.length - 1].x) < EPS && Math.abs(pts[0].y - pts[pts.length - 1].y) < EPS) pts.pop();
  const out: Vec2[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    if (Math.abs(cross(sub(b, a), sub(c, b))) > EPS) out.push(b);
  }
  return out;
}

/**
 * The union of axis-aligned rectangles minus the basins, as rings: the covered cells of the
 * compressed grid, their uncovered-neighbour sides chained into closed rings, clockwise on screen
 * round the covered area (so the outer ring is positive and the holes are negative).
 */
export function rectilinearUnion(rects: readonly (readonly Vec2[])[], holes: readonly (readonly Vec2[])[] = []): Vec2[][] {
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const r of [...rects, ...holes]) {
    for (const p of r) {
      xs.add(p.x);
      ys.add(p.y);
    }
  }
  const X = [...xs].sort((p, q) => p - q);
  const Y = [...ys].sort((p, q) => p - q);
  const boxes = rects.map(bbox);
  const hs = holes.map(bbox);
  const covered = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i + 1 >= X.length || j + 1 >= Y.length) return false;
    const cx = (X[i] + X[i + 1]) / 2;
    const cy = (Y[j] + Y[j + 1]) / 2;
    const inside = (b: { minX: number; minY: number; maxX: number; maxY: number }) => cx > b.minX && cx < b.maxX && cy > b.minY && cy < b.maxY;
    return boxes.some(inside) && !hs.some(inside);
  };
  // Directed edges with the covered cell on their right (clockwise on screen round the area).
  const key = (p: Vec2) => `${p.x},${p.y}`;
  const edges = new Map<string, { from: Vec2; to: Vec2 }[]>();
  const addEdge = (from: Vec2, to: Vec2) => {
    const k = key(from);
    const list = edges.get(k);
    if (list) list.push({ from, to });
    else edges.set(k, [{ from, to }]);
  };
  for (let i = 0; i + 1 < X.length; i++) {
    for (let j = 0; j + 1 < Y.length; j++) {
      if (!covered(i, j)) continue;
      const x0 = X[i];
      const x1 = X[i + 1];
      const y0 = Y[j];
      const y1 = Y[j + 1];
      if (!covered(i, j - 1)) addEdge({ x: x0, y: y0 }, { x: x1, y: y0 });
      if (!covered(i + 1, j)) addEdge({ x: x1, y: y0 }, { x: x1, y: y1 });
      if (!covered(i, j + 1)) addEdge({ x: x1, y: y1 }, { x: x0, y: y1 });
      if (!covered(i - 1, j)) addEdge({ x: x0, y: y1 }, { x: x0, y: y0 });
    }
  }
  const rings: Vec2[][] = [];
  for (const list of edges.values()) {
    while (list.length) {
      const start = list.shift()!;
      const ring = [start.from];
      let cur = start;
      let guard = 0;
      while (guard++ < 100000) {
        const next = edges.get(key(cur.to));
        if (!next || next.length === 0) break;
        // At a vertex with several ways on, take the sharpest right turn so rings stay simple.
        let pick = 0;
        if (next.length > 1) {
          const d = sub(cur.to, cur.from);
          let best = -Infinity;
          next.forEach((e, idx) => {
            const e2 = sub(e.to, e.from);
            const turn = Math.atan2(cross(d, e2), dot(d, e2)); // positive = clockwise on screen
            if (turn > best) {
              best = turn;
              pick = idx;
            }
          });
        }
        const [e] = next.splice(pick, 1);
        if (key(e.to) === key(start.from)) {
          ring.push(e.from);
          break;
        }
        ring.push(e.from);
        cur = e;
      }
      const simple = simplifyRing(ring);
      if (simple.length >= 3) rings.push(simple);
    }
  }
  return rings;
}

/**
 * The counter slabs over a level's counter-bearing fixtures: touching rectangles (each fixture's
 * outline grown by its overhang) become one slab, mitred at corners, with the sink basins as
 * holes, when every fixture in the group is turned by a multiple of 90 degrees; otherwise each
 * fixture carries its own slab. A slab spans from the top of its highest cabinet up
 * COUNTER_THICKNESS.
 */
export function counterRuns(fixtures: readonly Fixture[]): CounterRun[] {
  const rects: Rect[] = fixtures
    .filter((f) => hasCounter(f.kind))
    .map((f) => {
      const poly = counterOutline(f);
      return { fixture: f, poly, basin: f.kind === 'sink' ? basinOutline(f) : null, ...bbox(poly) };
    });
  // Union-find over touching rectangles.
  const parent = rects.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (a.maxX < b.minX - TOUCH || b.maxX < a.minX - TOUCH || a.maxY < b.minY - TOUCH || b.maxY < a.minY - TOUCH) continue;
      parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Rect[]>();
  rects.forEach((r, i) => {
    const g = find(i);
    const list = groups.get(g);
    if (list) list.push(r);
    else groups.set(g, [r]);
  });
  const runs: CounterRun[] = [];
  const slab = (members: Rect[], outline: Vec2[], holes: Vec2[][]) => {
    const top = Math.max(...members.map((m) => m.fixture.elevation + m.fixture.height));
    runs.push({
      fixtureIds: members.map((m) => m.fixture.id).sort(),
      outline: polygonSignedArea(outline) < 0 ? [...outline].reverse() : outline,
      holes,
      y0: top,
      y1: counterTopOf({ elevation: top, height: 0 }),
    });
  };
  for (const members of groups.values()) {
    if (members.length > 1 && members.every((m) => isAxisAligned(m.fixture))) {
      const rings = rectilinearUnion(
        members.map((m) => m.poly),
        members.flatMap((m) => (m.basin ? [m.basin] : [])),
      );
      if (rings.length) {
        // Connected members give one outer ring (the largest); the rest are holes.
        const sorted = [...rings].sort((p, q) => Math.abs(polygonSignedArea(q)) - Math.abs(polygonSignedArea(p)));
        slab(members, sorted[0], sorted.slice(1));
        continue;
      }
    }
    for (const m of members) slab([m], m.poly, m.basin ? [m.basin] : []);
  }
  return runs.sort((p, q) => (p.fixtureIds[0] < q.fixtureIds[0] ? -1 : p.fixtureIds[0] > q.fixtureIds[0] ? 1 : 0));
}

// ---------------------------------------------------------------------------------------------
// Plan symbol

type Seg = [Vec2, Vec2];

export interface FixtureSymbol {
  outline: Vec2[];
  /** The front edge, drawn heavier. */
  front: Seg;
  /** Short lines on the front edge where the door fronts meet. */
  ticks: Seg[];
  /** Drawn dashed: the fixture hangs above the counter. */
  dashed: boolean;
  /** Text at `labelAt`, upright, or null. */
  label: string | null;
  labelAt: Vec2;
  labelAngle: number;
  /** A range's burners (centre and radius). */
  burners: { at: Vec2; r: number }[];
  /** A sink's basin rectangle. */
  basin: Vec2[] | null;
}

/** The fixture's plan symbol: outline, a heavier front edge, door ticks, an appliance word, burners or the basin. */
export function fixtureSymbol(f: Fixture): FixtureSymbol {
  const fr = fixtureFrame(f);
  const outline = fixtureOutline(f);
  const h = f.width / 2;
  const ticks: Seg[] = [];
  if (isCabinet(f.kind) && f.kind !== 'island') {
    const n = doorCount(f.width);
    const tick = Math.min(4, f.depth / 3);
    for (let i = 1; i < n; i++) {
      const s = -h + (f.width * i) / n;
      ticks.push([fixturePoint(fr, s, f.depth), fixturePoint(fr, s, f.depth - tick)]);
    }
  }
  let labelAngle = (Math.atan2(fr.v.y, fr.v.x) * 180) / Math.PI;
  if (labelAngle > 90 || labelAngle <= -90) labelAngle += 180;
  const burners: { at: Vec2; r: number }[] = [];
  if (f.kind === 'range') {
    const r = Math.min(4, f.width / 8, f.depth / 8);
    const ds = f.width / 4;
    const dd = f.depth / 4;
    for (const [ss, dd2] of [
      [-ds, dd],
      [ds, dd],
      [-ds, 3 * dd],
      [ds, 3 * dd],
    ]) {
      burners.push({ at: fixturePoint(fr, ss, dd2), r });
    }
  }
  const word = f.label?.trim() || (f.kind === 'box' ? FIXTURE_PLAN_LABEL.box! : FIXTURE_PLAN_LABEL[f.kind]) || null;
  return {
    outline,
    front: [outline[1], outline[2]],
    ticks,
    dashed: isOverhead(f.kind),
    label: f.kind === 'range' || f.kind === 'sink' ? (f.label?.trim() || null) : word,
    labelAt: fixturePoint(fr, 0, f.depth / 2),
    labelAngle,
    burners,
    basin: f.kind === 'sink' ? basinOutline(f) : null,
  };
}

/** Plan bounds contributors: the fixture's outline, grown by its counter overhang when it has one. */
export function fixtureExtent(f: Fixture): Vec2[] {
  return hasCounter(f.kind) ? counterOutline(f) : fixtureOutline(f);
}
