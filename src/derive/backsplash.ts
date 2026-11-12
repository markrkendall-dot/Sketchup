import {
  BACKSPLASH,
  backsplashSpecOf,
  counterOverhangOf,
  counterSpecOf,
  fixtureTop,
  hasCounter,
  takesBacksplash,
  type BacksplashSpec,
} from '../model/casework';
import { dot, sub } from '../model/geometry';
import { wallHeightOf } from '../model/openings';
import type { BacksplashFinish, CounterMaterial, Fixture, Id, Level, Opening, Phase, Vec2, ViewMode } from '../model/types';
import { counterRects, fixtureFrame, fixturePoint } from './casework';
import type { Footprint, Footprints } from './footprint';
import { displayCenter } from './openings';
import { isOpeningVisible } from './phase';

// Backsplashes (DESIGN.md "Casework"). Pure: no three. A backsplash is thin geometry on a wall face
// behind a base run (and behind a range), from the counter top up to its height, cut round the
// windows and doors in that wall. It is worked out per wall face: each fixture side that lies on a
// face (its back, or an end against a wall) gives an interval along the face; backs come before
// ends, and an interval never overlaps one already placed on that face, so no two pieces share a
// face (no z-fighting) and an inside corner is covered once.

export interface BacksplashBox {
  /** Along the face from the frame's origin (s), out from the wall (d), above the floor top (y). */
  s0: number;
  s1: number;
  d0: number;
  d1: number;
  y0: number;
  y1: number;
}

export interface BacksplashPiece {
  /** The fixture it is behind. */
  fixtureId: Id;
  phase: Phase;
  /** The frame: origin on the wall face (where the face line meets the wall's start), facing into the room. */
  origin: Vec2;
  direction: number;
  boxes: BacksplashBox[];
  finish: BacksplashFinish;
  /** A tile's colour, or a slab's (the counter's unless it has its own). */
  color: string;
  /** A slab's material: the counter's. */
  material: CounterMaterial;
}

interface Face {
  wallId: Id;
  /** A point on the face line, the outward unit normal (into the room), the unit tangent. */
  origin: Vec2;
  normal: Vec2;
  tangent: Vec2;
  /** The face's extent along the tangent from origin. */
  t0: number;
  t1: number;
  /** The wall's footprint (openings are placed along its centerline, from its start). */
  fp: Footprint;
}

/** A wall face's interval for one fixture side. */
interface Span {
  fixture: Fixture;
  t0: number;
  t1: number;
  y0: number;
  y1: number;
  thick: number;
  spec: BacksplashSpec;
  counterColor: string;
  material: CounterMaterial;
  /** Backs are placed before ends. */
  back: boolean;
  /** "Up to the wall cabinets": the top follows the bottoms of what hangs above (uppersOn), up to `cap`. */
  toUppers: boolean;
  cap: number;
}

/** What hangs on the wall over a counter (a backsplash "up to the wall cabinets" stops under it). */
const UPPER_KINDS: readonly Fixture['kind'][] = ['wall', 'cornerWall', 'hood', 'microwave'];

/** A side within this of a face line, and facing the way the face does, lies on it. */
const ON_FACE = 1;

const angleOf = (v: Vec2): number => {
  const a = (Math.atan2(v.y, v.x) * 180) / Math.PI;
  return a < 0 ? a + 360 : a;
};

/** Each visible wall's two faces (as the Cabinet tool snaps to them: footprint edges, normal outward). */
function wallFaces(fps: Footprints): Face[] {
  const out: Face[] = [];
  for (const fp of fps.values()) {
    const [leftA, leftB, rightB, rightA] = fp.edge;
    for (const [p, q, n] of [
      [leftA, leftB, fp.normal],
      [rightA, rightB, { x: -fp.normal.x, y: -fp.normal.y }],
    ] as [Vec2, Vec2, Vec2][]) {
      const tangent = fp.dir;
      const origin = { x: fp.a.x + n.x * (fp.thickness / 2), y: fp.a.y + n.y * (fp.thickness / 2) };
      const tp = dot(sub(p, origin), tangent);
      const tq = dot(sub(q, origin), tangent);
      out.push({ wallId: fp.wallId, origin, normal: n, tangent, t0: Math.min(tp, tq), t1: Math.max(tp, tq), fp });
    }
  }
  return out;
}

/** The face a plan segment lies on (both ends within ON_FACE of the line, inside its extent, facing `out`), or null. */
function faceUnder(faces: readonly Face[], p: Vec2, q: Vec2, out: Vec2): { face: Face; t0: number; t1: number } | null {
  for (const face of faces) {
    if (dot(face.normal, out) < 0.999) continue;
    const dp = dot(sub(p, face.origin), face.normal);
    const dq = dot(sub(q, face.origin), face.normal);
    if (Math.abs(dp) > ON_FACE || Math.abs(dq) > ON_FACE) continue;
    const tp = dot(sub(p, face.origin), face.tangent);
    const tq = dot(sub(q, face.origin), face.tangent);
    const t0 = Math.max(Math.min(tp, tq), face.t0);
    const t1 = Math.min(Math.max(tp, tq), face.t1);
    if (t1 - t0 > 0.5) return { face, t0, t1 };
  }
  return null;
}

/** [a0, a1] less the intervals in `cuts` (any order), as the pieces left. */
function subtract(a0: number, a1: number, cuts: readonly [number, number][]): [number, number][] {
  let pieces: [number, number][] = [[a0, a1]];
  for (const [c0, c1] of cuts) {
    const next: [number, number][] = [];
    for (const [p0, p1] of pieces) {
      if (c1 <= p0 || c0 >= p1) next.push([p0, p1]);
      else {
        if (c0 > p0) next.push([p0, c0]);
        if (c1 < p1) next.push([c1, p1]);
      }
    }
    pieces = next;
  }
  return pieces.filter(([p0, p1]) => p1 - p0 > 1e-6);
}

/**
 * The backsplash pieces of a level: behind each visible base, corner base, sink, dishwasher and
 * range whose back (or end) lies on a visible wall face, by its setting (model/casework.ts
 * backsplashSpecOf: its own, else the level's; a range's own, else that of a counter fixture it
 * touches, else the level's). An island, or a cabinet away from the walls, gets none; nor does a
 * vanity. Bottom: the counter's top (a range's top); top: 4" above it, `backsplashHeight` above it
 * (to the wall cabinets, 18" unless set) or the wall's height, never above the wall. Each piece is
 * cut round the visible windows, doors and passages in its wall.
 */
export function backsplashPieces(level: Pick<Level, 'fixtures' | 'finishes' | 'walls' | 'openings' | 'wallHeight'>, fps: Footprints, viewMode: ViewMode, visible: (f: Fixture) => boolean): BacksplashPiece[] {
  const finishes = level.finishes;
  const fixtures = Object.values(level.fixtures ?? {}).filter(visible);
  const counters = fixtures.filter((f) => hasCounter(f.kind));
  const faces = wallFaces(fps);
  const spans = new Map<Face, Span[]>();
  // The wall cabinets, hoods and microwaves hung on each face: their interval along it and their bottom.
  const uppers = new Map<Face, { t0: number; t1: number; bottom: number }[]>();
  for (const f of fixtures) {
    if (!UPPER_KINDS.includes(f.kind)) continue;
    const fr = fixtureFrame(f);
    const h = f.width / 2;
    for (const side of [
      { p: fixturePoint(fr, -h, 0), q: fixturePoint(fr, h, 0), out: fr.u },
      { p: fixturePoint(fr, -h, 0), q: fixturePoint(fr, -h, f.depth), out: fr.v },
      { p: fixturePoint(fr, h, 0), q: fixturePoint(fr, h, f.depth), out: { x: -fr.v.x, y: -fr.v.y } },
    ]) {
      const hit = faceUnder(faces, side.p, side.q, side.out);
      if (!hit) continue;
      const list = uppers.get(hit.face) ?? [];
      list.push({ t0: hit.t0, t1: hit.t1, bottom: f.elevation });
      uppers.set(hit.face, list);
    }
  }
  const touches = (a: Fixture, b: Fixture): boolean => {
    const box = (f: Fixture) => {
      const pts = counterRects(f).flat();
      return { x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) };
    };
    const p = box(a);
    const q = box(b);
    return !(p.x1 < q.x0 - 0.5 || q.x1 < p.x0 - 0.5 || p.y1 < q.y0 - 0.5 || q.y1 < p.y0 - 0.5);
  };
  for (const f of fixtures) {
    if (!takesBacksplash(f.kind)) continue;
    // A range takes its neighbours' setting when it has none of its own.
    const neighbour = f.kind === 'range' ? counters.filter((c) => touches(f, c)).sort((p, q) => (p.id < q.id ? -1 : 1)) : [];
    const spec = backsplashSpecOf([f, ...neighbour], finishes);
    if (spec.backsplash === 'none') continue;
    const counter = counterSpecOf(hasCounter(f.kind) ? [f] : neighbour, finishes);
    const bottom = hasCounter(f.kind) ? fixtureTop(f) + counter.thickness : fixtureTop(f);
    const thick = spec.finish === 'tile' ? BACKSPLASH.tile : BACKSPLASH.slab;
    const fr = fixtureFrame(f);
    const h = f.width / 2;
    const over = hasCounter(f.kind) ? counterOverhangOf(f) : { front: 0, back: 0, left: 0, right: 0 };
    // An end runs to the counter's front (a corner unit's side leg has no overhang at its end).
    const endDepth = f.kind === 'cornerBase' ? f.depth : f.depth + over.front;
    const sides: { p: Vec2; q: Vec2; out: Vec2; back: boolean }[] = [
      { p: fixturePoint(fr, -h - over.left, 0), q: fixturePoint(fr, h + over.right, 0), out: fr.u, back: true },
      { p: fixturePoint(fr, -h, 0), q: fixturePoint(fr, -h, endDepth), out: fr.v, back: false },
      { p: fixturePoint(fr, h, 0), q: fixturePoint(fr, h, endDepth), out: { x: -fr.v.x, y: -fr.v.y }, back: false },
    ];
    for (const side of sides) {
      const hit = faceUnder(faces, side.p, side.q, side.out);
      if (!hit) continue;
      const wall = level.walls[hit.face.wallId];
      const wallTop = wall ? wallHeightOf(level, wall) : level.wallHeight;
      const top = Math.min(wallTop, spec.backsplash === 'upstand' ? bottom + BACKSPLASH.upstand : spec.backsplash === 'toWall' ? bottom + spec.height : wallTop);
      if (top - bottom < 0.25) continue;
      const list = spans.get(hit.face) ?? [];
      list.push({ fixture: f, t0: hit.t0, t1: hit.t1, y0: bottom, y1: top, thick, spec, counterColor: counter.color, material: counter.material, back: side.back, toUppers: spec.backsplash === 'toWall', cap: wallTop });
      spans.set(hit.face, list);
    }
  }
  // Whether a back's piece stands at a face's end (an inside corner): a back on another face whose
  // interval reaches the point, not cut away there by an opening at the counter.
  const standsAt = (face: Face, t: number): boolean => {
    const p = { x: face.origin.x + face.tangent.x * t, y: face.origin.y + face.tangent.y * t };
    for (const [other, list] of spans) {
      if (other === face || Math.abs(dot(sub(p, other.origin), other.normal)) > ON_FACE) continue;
      const u = dot(sub(p, other.origin), other.tangent);
      const cuts = openingCuts(level, other, viewMode);
      for (const sp of list) {
        if (!sp.back || u < sp.t0 - ON_FACE || u > sp.t1 + ON_FACE) continue;
        if (cuts.some((c) => c.t0 <= u + 1e-6 && c.t1 >= u - 1e-6 && c.y0 <= sp.y0 + 1e-6 && c.y1 >= sp.y1 - 1e-6)) continue;
        return true;
      }
    }
    return false;
  };
  const pieces: BacksplashPiece[] = [];
  for (const [face, list] of spans) {
    // Backs first, then ends; each in fixture id order. An inside corner: the end on the other wall
    // starts where the back's piece (on this wall's neighbour) stands proud of its face.
    list.sort((p, q) => (p.back === q.back ? (p.fixture.id < q.fixture.id ? -1 : 1) : p.back ? -1 : 1));
    const placed: [number, number][] = [];
    const cuts = openingCuts(level, face, viewMode);
    const above = uppers.get(face) ?? [];
    for (const sp of list) {
      let t0 = sp.t0;
      let t1 = sp.t1;
      // An end piece stops short of the face it meets at an inside corner by the thickness of the
      // piece standing there (a back's, on the other wall); with none there it runs into the corner.
      if (!sp.back) {
        if (t0 - face.t0 < ON_FACE) t0 = face.t0;
        if (face.t1 - t1 < ON_FACE) t1 = face.t1;
        if (standsAt(face, t0)) t0 += sp.thick;
        if (standsAt(face, t1)) t1 -= sp.thick;
      }
      const boxes: BacksplashBox[] = [];
      for (const [a0, a1] of subtract(t0, t1, placed)) {
        // Along the piece, the openings' edges split it (and, up to the wall cabinets, the ends of
        // what hangs above); in each part the height less the openings there.
        const marks = [...cuts.flatMap((c) => [c.t0, c.t1]), ...(sp.toUppers ? above.flatMap((u) => [u.t0, u.t1]) : [])];
        const edges = [...new Set([a0, a1, ...marks.filter((t) => t > a0 && t < a1)])].sort((p, q) => p - q);
        for (let i = 0; i + 1 < edges.length; i++) {
          const m = (edges[i] + edges[i + 1]) / 2;
          // Up to the wall cabinets: the lowest bottom of what hangs over this part (above the
          // counter), else the set height.
          let top = sp.y1;
          if (sp.toUppers) {
            const bottoms = above.filter((u) => u.t0 < m && u.t1 > m && u.bottom > sp.y0 + 0.25).map((u) => u.bottom);
            if (bottoms.length) top = Math.min(sp.cap, Math.min(...bottoms));
          }
          const over = cuts.filter((c) => c.t0 < m && c.t1 > m).map((c) => [c.y0, c.y1] as [number, number]);
          for (const [y0, y1] of subtract(sp.y0, top, over)) boxes.push({ s0: edges[i], s1: edges[i + 1], d0: 0, d1: sp.thick, y0, y1 });
        }
        placed.push([a0, a1]);
      }
      if (!boxes.length) continue;
      // The frame's s runs along the face's tangent: its v (right of the normal) is the tangent or
      // its reverse, so s is the tangent distance or its negative.
      const sign = dot({ x: -face.normal.y, y: face.normal.x }, face.tangent) > 0 ? 1 : -1;
      pieces.push({
        fixtureId: sp.fixture.id,
        phase: sp.fixture.phase,
        origin: face.origin,
        direction: angleOf(face.normal),
        boxes: boxes.map((b) => (sign > 0 ? b : { ...b, s0: -b.s1, s1: -b.s0 })),
        finish: sp.spec.finish,
        color: sp.spec.color ?? sp.counterColor,
        material: sp.material,
      });
    }
  }
  return pieces.sort((p, q) => (p.fixtureId < q.fixtureId ? -1 : p.fixtureId > q.fixtureId ? 1 : 0));
}

/**
 * The backsplashes on the plan (DESIGN.md "Casework"): per piece, a line along its face, its
 * thickness off the wall, one segment per stretch along the face (a stretch a window splits into
 * heights is drawn once).
 */
export function backsplashPlanLines(pieces: readonly BacksplashPiece[]): { fixtureId: Id; phase: Phase; segs: [Vec2, Vec2][] }[] {
  return pieces.map((p) => {
    const fr = fixtureFrame(p);
    const seen = new Set<string>();
    const segs: [Vec2, Vec2][] = [];
    for (const b of p.boxes) {
      const k = `${b.s0.toFixed(4)}|${b.s1.toFixed(4)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      segs.push([fixturePoint(fr, b.s0, b.d1), fixturePoint(fr, b.s1, b.d1)]);
    }
    return { fixtureId: p.fixtureId, phase: p.phase, segs };
  });
}

/** The openings in a face's wall as rectangles along the face (t) and up it (y). */
function openingCuts(level: Pick<Level, 'openings' | 'walls'>, face: Face, viewMode: ViewMode): { t0: number; t1: number; y0: number; y1: number }[] {
  const wall = level.walls[face.wallId];
  if (!wall) return [];
  const out: { t0: number; t1: number; y0: number; y1: number }[] = [];
  // The face's origin is beside the wall's start, so a distance along the centerline is one along the face.
  for (const o of Object.values(level.openings ?? {}) as Opening[]) {
    if (o.wallId !== face.wallId || !isOpeningVisible(o, wall, viewMode)) continue;
    const c = displayCenter(face.fp, o);
    out.push({ t0: c - o.width / 2, t1: c + o.width / 2, y0: o.sill, y1: o.sill + o.height });
  }
  return out;
}
