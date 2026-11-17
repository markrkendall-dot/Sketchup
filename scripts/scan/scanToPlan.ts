// A parsed scan (roomplan.ts) to a tidy draft, and the draft to the two things the rest of the repo
// uses: a generated TypeScript data module (emitScanModule) and a real plan to open in the app
// (buildDraftPlan, through scripts/planLib.ts like the other plan scripts).
//
// The draft is plain data (JSON safe): the walls as their room-side faces with shared corners, the
// openings on their walls, the objects as HomePlan fixtures, the ceiling, the keyframes as saved
// views, each with its confidence and the numbers the scan read before tidying ("raw"). Tidying:
//   1. turn the whole scan so the walls are square to the plan's axes (the length weighted mean of
//      the walls' angles off the nearest axis, taken over the walls near the longest wall's, so the
//      longest wall comes out axis aligned and one bent wall does not tip the rest);
//   2. square each wall within 3 degrees of an axis, turning it about its middle;
//   3. merge wall ends within 6" into shared corners: where two walls meet near square, at the
//      crossing of their lines; where they run on in line, at the average of the ends;
//   4. move it so the faces start at x 0 and y 0 (the plan scripts' convention: x from the left
//      wall's inside face, y from the top wall's) and round to 1/8";
//   5. walls are numbered round the room, clockwise on the plan from the top wall.
// The floor is elevation 0 and the ceiling is the median wall height.
import type { FixtureKind, FurniturePiece, Id, Plan } from '../../src/model/types';
import { createEmptyPlan } from '../../src/model/plan';
import { firstStructure } from '../../src/model/structures';
import { getPlan, type NewFixture } from '../../src/store/planStore';
import { addOpeningAt, drawWalls, fixture, label, stableIds, store, win, workIn } from '../planLib';
import type { Confidence, ParsedScan, ScanOpeningType, Vec2 } from './roomplan';

export type { Confidence, Vec2 } from './roomplan';

export interface DraftWall {
  /** wall-1, wall-2, ... round the room. */
  id: string;
  scanId: string;
  /** Which side of the room it is on, as the plan shows it: top, right, bottom, left (or between, as "top right"). */
  side: string;
  /** The room-side face, tidied: a to b runs clockwise round the room on the plan. */
  a: Vec2;
  b: Vec2;
  length: number;
  height: number;
  /** The thickness drawn: RoomPlan's when it gave one, else the default. */
  thickness: number;
  thicknessScanned: boolean;
  /** Unit normal from the face into the room. */
  inward: Vec2;
  confidence: Confidence;
  /** Its direction was squared to an axis. */
  squared: boolean;
  /** As scanned (turned and moved with the room, before squaring and merging). */
  raw: { a: Vec2; b: Vec2; length: number; height: number; angleOffAxis: number };
}

export interface DraftCorner {
  id: string;
  at: Vec2;
  walls: string[];
  how: 'intersect' | 'average';
  /** How far the merge moved the farthest scanned end. */
  moved: number;
}

export interface DraftChain {
  walls: string[];
  closed: boolean;
}

export interface DraftOpening {
  /** door-1, window-1, opening-1, ... */
  id: string;
  scanId: string;
  type: ScanOpeningType;
  wallId: string;
  /** From the wall's a end along its face to the centre (Opening.offset, on the face). */
  offset: number;
  width: number;
  height: number;
  sill: number;
  /** The nearer end of the wall and the distance from that corner to the near edge of the hole. */
  nearCorner: { end: 'a' | 'b'; distance: number };
  confidence: Confidence;
  doorOpen?: boolean;
  raw: { center: Vec2; offset: number; width: number; height: number; sill: number };
}

export interface DraftFixture {
  /** <kind>-1, <kind>-2, ... (a wall cabinet's wallCabinet-1, apart from the walls' ids). */
  id: string;
  scanId: string;
  /** RoomPlan's category (storage, refrigerator, ...). */
  category: string;
  kind: FixtureKind;
  label?: string;
  piece?: FurniturePiece;
  /** Fixture.origin: the middle of the back edge. */
  origin: Vec2;
  /** Fixture.direction: the plan angle the front faces, degrees. */
  direction: number;
  width: number;
  depth: number;
  height: number;
  elevation: number;
  /** The wall its back was snapped to, else null. */
  wallId: string | null;
  confidence: Confidence;
  note?: string;
  raw: { center: Vec2; yaw: number; width: number; depth: number; height: number; base: number };
}

export interface DraftRun {
  id: string;
  wallId: string;
  /** On the floor (base cabinets, sinks, appliances in the counter line) or the wall cabinets above. */
  tier: 'base' | 'wall';
  fixtures: string[];
  /** Along the wall's face from its a end. */
  start: number;
  end: number;
  length: number;
  /** The lowest of its pieces'. */
  confidence: Confidence;
}

export interface DraftView {
  name: string;
  file: string;
  time: number;
  /** SavedView.at, .yaw (0 looks along -y, positive turns toward -x) and .pitch (up positive), radians. */
  at: Vec2;
  yaw: number;
  pitch: number;
  /** What SavedView cannot hold: the camera's height above the floor, its tilt from level and the photo's field of view (degrees). */
  eyeHeight: number;
  roll: number;
  fov: { horizontal: number; vertical: number };
}

export interface ScanDraft {
  format: 1;
  name: string;
  scan: { date: string; device: string; os: string; app: string };
  /** How the scan was moved: plan = rotate(scan, rotation degrees) + shift; floorElevation is the scan's floor in its own frame. */
  tidy: { rotation: number; shift: Vec2; floorElevation: number };
  /** The faces' extent and the ceiling. */
  room: { width: number; depth: number; ceiling: number; closed: boolean };
  walls: DraftWall[];
  corners: DraftCorner[];
  chains: DraftChain[];
  openings: DraftOpening[];
  fixtures: DraftFixture[];
  runs: DraftRun[];
  views: DraftView[];
  notes: string[];
}

export interface TidyOptions {
  /** Square a wall within this many degrees of an axis (3). */
  squareDegrees?: number;
  /** Merge wall ends closer than this (6"). */
  cornerMerge?: number;
  /** Snap an object's back to a wall face within this (4"). */
  wallSnap?: number;
  /** The wall thickness drawn when the scan gives none (6.5"). */
  thickness?: number;
}

// Small geometry

const r8 = (v: number): number => Math.round(v * 8) / 8 + 0;
const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;
const r4 = (v: number): number => Math.round(v * 10000) / 10000 + 0;
const p8 = (p: Vec2): Vec2 => ({ x: r8(p.x), y: r8(p.y) });
const p2 = (p: Vec2): Vec2 => ({ x: r2(p.x), y: r2(p.y) });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
const len = (a: Vec2): number => Math.hypot(a.x, a.y);
const unit = (a: Vec2): Vec2 => mul(a, 1 / len(a));
const RAD = Math.PI / 180;
const QUARTER = Math.PI / 2;
/** An angle less the nearest multiple of 90 degrees: in [-45, 45] degrees (radians). */
const offAxis = (a: number): number => a - QUARTER * Math.round(a / QUARTER);
/** Plan degrees in [0, 360). */
const deg360 = (d: number): number => {
  const v = r4(((d % 360) + 360) % 360);
  return v === 360 ? 0 : v;
};
/** A unit vector with values within 1e-9 of 0 or 1 made exact (so squared walls stay exact). */
const clean = (v: Vec2): Vec2 => {
  const c = (n: number) => (Math.abs(n) < 1e-9 ? 0 : Math.abs(Math.abs(n) - 1) < 1e-9 ? Math.sign(n) : n);
  return { x: c(v.x), y: c(v.y) };
};
/** Where the lines p + s u and q + t v cross, or null when they are (near) parallel. */
function crossing(p: Vec2, u: Vec2, q: Vec2, v: Vec2): Vec2 | null {
  const d = cross(u, v);
  if (Math.abs(d) < 1e-9) return null;
  return add(p, mul(u, cross(sub(q, p), v) / d));
}
function median(v: number[]): number {
  const s = [...v].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const lowest = (cs: Confidence[]): Confidence => cs.reduce((m, c) => (RANK[c] < RANK[m] ? c : m), 'high' as Confidence);

const SIDE_NAMES = ['right', 'bottom right', 'bottom', 'bottom left', 'left', 'top left', 'top', 'top right'];
/** The side of the room a wall with this outward normal is on, as the plan shows it (y down). */
function sideName(out: Vec2): string {
  const a = Math.atan2(out.y, out.x) / RAD;
  const axis = Math.round(a / 90) * 90;
  if (Math.abs(a - axis) <= 10) return SIDE_NAMES[(((axis / 45) % 8) + 8) % 8];
  return SIDE_NAMES[(((Math.round(a / 45) % 8) + 8) % 8)];
}

// Objects to fixtures

const FURNITURE: Record<string, FurniturePiece> = { bed: 'bed', sofa: 'sofa', chair: 'diningChair', table: 'diningTable' };
/** Kinds that stand in the counter line of a base run, and the wall cabinets' tier. */
const BASE_RUN: readonly FixtureKind[] = ['base', 'cornerBase', 'sink', 'dishwasher', 'range', 'tall', 'wallOven'];
const CABINETS: readonly FixtureKind[] = ['base', 'cornerBase', 'sink', 'tall', 'wall'];
/** The appliances the tape list asks the width of. */
export const APPLIANCE_KINDS: readonly FixtureKind[] = ['fridge', 'range', 'dishwasher', 'wallOven', 'cooktop', 'microwave', 'hood', 'washer', 'dryer'];

const titleCase = (s: string): string => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/**
 * The HomePlan kind for a RoomPlan object: storage by where it stands and how tall it is (on the
 * floor up to 42" a base cabinet, taller a tall cabinet; its bottom 24" or more up a wall cabinet),
 * the appliances and fixtures by name, bed, sofa, chair and table as furniture, anything else a
 * labelled box.
 */
export function fixtureKindFor(category: string, elevation: number, height: number): { kind: FixtureKind; label?: string; piece?: FurniturePiece } {
  switch (category) {
    case 'storage':
      if (elevation >= 24) return { kind: 'wall' };
      return { kind: elevation <= 12 && height > 42 ? 'tall' : 'base' };
    case 'refrigerator':
      return { kind: 'fridge' };
    case 'stove':
      return { kind: 'range' };
    case 'oven':
      return { kind: height >= 48 ? 'wallOven' : 'range' };
    case 'dishwasher':
      return { kind: 'dishwasher' };
    case 'sink':
      return { kind: 'sink' };
    case 'washerDryer':
      return { kind: 'washer' };
    case 'toilet':
      return { kind: 'toilet' };
    case 'bathtub':
      return { kind: 'bathtub' };
  }
  const piece = FURNITURE[category];
  if (piece) return { kind: 'furniture', piece };
  return { kind: 'box', label: `${titleCase(category)} (scanned)` };
}

// Tidy

interface WorkWall {
  scanId: string;
  a: Vec2;
  b: Vec2;
  dir: Vec2;
  height: number;
  thickness: number;
  thicknessScanned: boolean;
  confidence: Confidence;
  squared: boolean;
  raw: DraftWall['raw'];
  corner: [number | null, number | null];
}

/** The tidy draft of a parsed scan. `name`: the room's name (default the bundle's). */
export function scanToDraft(scan: ParsedScan, name?: string, opts: TidyOptions = {}): ScanDraft {
  const squareRad = (opts.squareDegrees ?? 3) * RAD;
  const merge = opts.cornerMerge ?? 6;
  const snapGap = opts.wallSnap ?? 4;
  const defaultT = opts.thickness ?? 6.5;
  const notes = [...scan.notes];
  const angleOf = (w: { a: Vec2; b: Vec2 }) => Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x);

  // 1. The turn that squares the room.
  const longest = scan.walls.reduce((m, w) => (w.length > m.length ? w : m));
  const ref = offAxis(angleOf(longest));
  let sw = 0;
  let sa = 0;
  for (const w of scan.walls) {
    const d = offAxis(offAxis(angleOf(w)) - ref);
    if (Math.abs(d) > 10 * RAD) continue;
    sw += w.length;
    sa += w.length * d;
  }
  const phi = -(ref + sa / sw);
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const turn = (p: Vec2): Vec2 => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });

  // 2. Square the walls.
  const work: WorkWall[] = scan.walls.map((w) => {
    const a = turn(w.a);
    const b = turn(w.b);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const off = offAxis(ang);
    const squared = Math.abs(off) <= squareRad;
    const dir = squared ? clean({ x: Math.cos(ang - off), y: Math.sin(ang - off) }) : { x: Math.cos(ang), y: Math.sin(ang) };
    const mid = mul(add(a, b), 0.5);
    const half = len(sub(b, a)) / 2;
    const scannedT = w.thickness >= 1;
    if (!squared) notes.push(`wall ${w.id} is ${r2(off / RAD)} degrees off square: left as scanned`);
    return {
      scanId: w.id,
      a: sub(mid, mul(dir, half)),
      b: add(mid, mul(dir, half)),
      dir,
      height: w.height,
      thickness: scannedT ? r8(w.thickness) : defaultT,
      thicknessScanned: scannedT,
      confidence: w.confidence,
      squared,
      raw: { a, b, length: w.length, height: w.height, angleOffAxis: off / RAD },
      corner: [null, null],
    };
  });

  // 3. Shared corners.
  const ends = work.flatMap((w, i) => [0, 1].map((e) => ({ wall: i, end: e as 0 | 1, p: e === 0 ? w.a : w.b })));
  const parent = ends.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      if (ends[i].wall === ends[j].wall || len(sub(ends[i].p, ends[j].p)) > merge) continue;
      parent[find(j)] = find(i);
    }
  }
  const clusters = new Map<number, number[]>();
  ends.forEach((_, i) => clusters.set(find(i), [...(clusters.get(find(i)) ?? []), i]));
  const rawCorners: { at: Vec2; ends: number[]; how: DraftCorner['how']; moved: number }[] = [];
  for (const members of clusters.values()) {
    const walls = [...new Set(members.map((m) => ends[m].wall))];
    if (walls.length < 2) continue;
    const hits: Vec2[] = [];
    for (let i = 0; i < walls.length; i++) {
      for (let j = i + 1; j < walls.length; j++) {
        const p = work[walls[i]];
        const q = work[walls[j]];
        if (Math.abs(cross(p.dir, q.dir)) < Math.sin(30 * RAD)) continue;
        const x = crossing(p.a, p.dir, q.a, q.dir);
        if (x) hits.push(x);
      }
    }
    const pts = hits.length ? hits : members.map((m) => ends[m].p);
    const at = mul(pts.reduce(add, { x: 0, y: 0 }), 1 / pts.length);
    rawCorners.push({ at, ends: members, how: hits.length ? 'intersect' : 'average', moved: Math.max(...members.map((m) => len(sub(ends[m].p, at)))) });
  }
  rawCorners.forEach((c, ci) => {
    for (const m of c.ends) {
      const w = work[ends[m].wall];
      if (ends[m].end === 0) w.a = c.at;
      else w.b = c.at;
      w.corner[ends[m].end] = ci;
    }
  });
  for (const w of work) {
    if (w.corner[0] === null || w.corner[1] === null) notes.push(`wall ${w.scanId} has a free end: no other wall ends within ${merge}" of it`);
  }

  // 4. Chains round the room: walls joined at corners of exactly two walls.
  const wallsAt = rawCorners.map((c) => [...new Set(c.ends.map((m) => ends[m].wall))]);
  const link = (wi: number, end: 0 | 1): { wall: number; end: 0 | 1 } | null => {
    const c = work[wi].corner[end];
    if (c === null || wallsAt[c].length !== 2) return null;
    const other = wallsAt[c][0] === wi ? wallsAt[c][1] : wallsAt[c][0];
    return { wall: other, end: work[other].corner[0] === c ? 0 : 1 };
  };
  const seen = new Set<number>();
  const chains: { walls: number[]; closed: boolean }[] = [];
  const walk = (start: number, entry: 0 | 1): { walls: number[]; closed: boolean } => {
    const out: number[] = [];
    let cur: { wall: number; end: 0 | 1 } | null = { wall: start, end: entry };
    while (cur && !seen.has(cur.wall)) {
      seen.add(cur.wall);
      out.push(cur.wall);
      // Enter at `end`; the wall runs from there to its other end.
      if (cur.end === 1) {
        const w = work[cur.wall];
        [w.a, w.b] = [w.b, w.a];
        w.corner = [w.corner[1], w.corner[0]];
        w.dir = mul(w.dir, -1);
        w.raw = { ...w.raw, a: w.raw.b, b: w.raw.a };
      }
      cur = link(cur.wall, 1);
    }
    return { walls: out, closed: cur !== null && cur.wall === start };
  };
  // Open chains first, from a free end.
  work.forEach((_, i) => {
    if (seen.has(i)) return;
    if (!link(i, 0)) chains.push(walk(i, 0));
    else if (!link(i, 1)) chains.push(walk(i, 1));
  });
  work.forEach((_, i) => {
    if (!seen.has(i)) chains.push(walk(i, 0));
  });
  // Closed loops clockwise on the plan (positive shoelace area with y down), from the top wall.
  const mid = (i: number) => mul(add(work[i].a, work[i].b), 0.5);
  const centroid = mul(work.map((_, i) => mid(i)).reduce(add, { x: 0, y: 0 }), 1 / work.length);
  for (const ch of chains) {
    if (!ch.closed) continue;
    const area = ch.walls.reduce((s, i) => s + cross(work[i].a, work[i].b), 0);
    if (area < 0) {
      ch.walls.reverse();
      for (const i of ch.walls) {
        const w = work[i];
        [w.a, w.b] = [w.b, w.a];
        w.corner = [w.corner[1], w.corner[0]];
        w.dir = mul(w.dir, -1);
        w.raw = { ...w.raw, a: w.raw.b, b: w.raw.a };
      }
    }
    const top = ch.walls.reduce((m, i) => (mid(i).y < mid(m).y - 1e-6 || (Math.abs(mid(i).y - mid(m).y) <= 1e-6 && mid(i).x < mid(m).x) ? i : m), ch.walls[0]);
    const k = ch.walls.indexOf(top);
    ch.walls = [...ch.walls.slice(k), ...ch.walls.slice(0, k)];
  }
  chains.sort((p, q) => Number(q.closed) - Number(p.closed) || Math.min(...p.walls.map((i) => mid(i).y)) - Math.min(...q.walls.map((i) => mid(i).y)));
  const closedRoom = chains.length === 1 && chains[0].closed;
  if (!closedRoom) notes.push(`the walls do not close into one room (${chains.length} chain${chains.length === 1 ? '' : 's'})`);
  const inward = (i: number, closed: boolean): Vec2 => {
    const d = work[i].dir;
    const n = clean({ x: -d.y, y: d.x });
    if (closed) return n;
    return dot(sub(centroid, mid(i)), n) >= 0 ? n : mul(n, -1);
  };

  // 5. Move to x 0, y 0 and round.
  const all = work.flatMap((w) => [w.a, w.b]);
  const shift = { x: -Math.min(...all.map((p) => p.x)), y: -Math.min(...all.map((p) => p.y)) };
  const place = (p: Vec2): Vec2 => add(turn(p), shift);
  const order = chains.flatMap((c) => c.walls.map((i) => ({ i, closed: c.closed })));
  const wallId = new Map<number, string>(order.map(({ i }, k) => [i, `wall-${k + 1}`]));
  const walls: DraftWall[] = order.map(({ i, closed }) => {
    const w = work[i];
    const a = p8(add(w.a, shift));
    const b = p8(add(w.b, shift));
    const n = inward(i, closed);
    return {
      id: wallId.get(i)!,
      scanId: w.scanId,
      side: sideName(mul(n, -1)),
      a,
      b,
      length: r8(len(sub(b, a))),
      height: r8(w.height),
      thickness: w.thickness,
      thicknessScanned: w.thicknessScanned,
      inward: { x: r4(n.x), y: r4(n.y) },
      confidence: w.confidence,
      squared: w.squared,
      raw: { a: p2(add(w.raw.a, shift)), b: p2(add(w.raw.b, shift)), length: r2(w.raw.length), height: r2(w.raw.height), angleOffAxis: r2(w.raw.angleOffAxis) },
    };
  });
  const byScan = new Map(walls.map((w) => [w.scanId, w]));
  const corners: DraftCorner[] = rawCorners
    .map((c) => ({ at: p8(add(c.at, shift)), walls: [...new Set(c.ends.map((m) => wallId.get(ends[m].wall)!))].sort(), how: c.how, moved: r2(c.moved) }))
    .sort((p, q) => p.at.y - q.at.y || p.at.x - q.at.x)
    .map((c, k) => ({ id: `corner-${k + 1}`, ...c }));
  const xs = walls.flatMap((w) => [w.a.x, w.b.x]);
  const ys = walls.flatMap((w) => [w.a.y, w.b.y]);
  const ceiling = r8(median(scan.walls.map((w) => w.height)));

  // Openings, on their tidied walls.
  const counts = new Map<string, number>();
  const nextId = (k: string) => {
    counts.set(k, (counts.get(k) ?? 0) + 1);
    return `${k}-${counts.get(k)}`;
  };
  const openingWord: Record<ScanOpeningType, string> = { door: 'door', window: 'window', passage: 'opening' };
  const openings: DraftOpening[] = scan.openings
    .map((o) => {
      const w = byScan.get(o.wallId)!;
      const c = place(o.center);
      const dir = unit(sub(w.b, w.a));
      const offset = r8(dot(sub(c, w.a), dir));
      const width = r8(o.width);
      const fromA = r8(offset - width / 2);
      const fromB = r8(w.length - offset - width / 2);
      const out: DraftOpening = {
        id: '',
        scanId: o.id,
        type: o.type,
        wallId: w.id,
        offset,
        width,
        height: r8(o.height),
        sill: o.type === 'window' ? r8(o.sill) : 0,
        nearCorner: fromA <= fromB ? { end: 'a', distance: fromA } : { end: 'b', distance: fromB },
        confidence: o.confidence,
        raw: { center: p2(c), offset: r2(o.offset), width: r2(o.width), height: r2(o.height), sill: r2(o.sill) },
      };
      if (o.doorOpen !== undefined) out.doorOpen = o.doorOpen;
      if (o.type !== 'window' && Math.abs(o.sill) > 2) notes.push(`${o.category} ${o.id} starts ${r2(o.sill)}" off the floor: drawn from the floor`);
      return out;
    })
    .sort((p, q) => walls.findIndex((w) => w.id === p.wallId) - walls.findIndex((w) => w.id === q.wallId) || p.offset - q.offset)
    .map((o) => ({ ...o, id: nextId(openingWord[o.type]) }));

  // Objects to fixtures, their backs snapped to a wall face where one is near and parallel.
  const parallel = Math.sin(10 * RAD);
  const fixtures: DraftFixture[] = scan.objects.map((ob) => {
    const c = place(ob.center);
    const yaw = ob.yaw + phi / RAD;
    const u = { x: Math.cos(yaw * RAD), y: Math.sin(yaw * RAD) };
    const v = { x: -u.y, y: u.x };
    const base = Math.max(0, ob.base);
    const mapped = fixtureKindFor(ob.category, base, ob.height);
    let elevation = r8(base);
    let height = r8(ob.height);
    let note: string | undefined;
    if (mapped.kind === 'sink' && base > 12) {
      height = r8(base + ob.height);
      elevation = 0;
      note = 'the scan saw only the basin: drawn as a sink base to the floor';
    }
    let best: { w: DraftWall; t: number; gap: number; width: number; depth: number } | null = null;
    for (const option of [
      { along: u, width: ob.width, depth: ob.depth },
      { along: v, width: ob.depth, depth: ob.width },
    ]) {
      for (const w of walls) {
        const d = unit(sub(w.b, w.a));
        if (Math.abs(cross(option.along, d)) > parallel) continue;
        const t = dot(sub(c, w.a), d);
        if (t < 0 || t > w.length) continue;
        const gap = dot(sub(c, w.a), w.inward) - option.depth / 2;
        if (gap < -2 || gap > snapGap) continue;
        if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { w, t, gap, width: option.width, depth: option.depth };
      }
    }
    const f: Omit<DraftFixture, 'id'> = best
      ? {
          scanId: ob.id,
          category: ob.category,
          kind: mapped.kind,
          origin: p8(add(best.w.a, mul(unit(sub(best.w.b, best.w.a)), best.t))),
          direction: deg360(Math.atan2(best.w.inward.y, best.w.inward.x) / RAD),
          width: r8(best.width),
          depth: r8(best.depth),
          height,
          elevation,
          wallId: best.w.id,
          confidence: ob.confidence,
          raw: { center: p2(c), yaw: r2(yaw), width: r2(ob.width), depth: r2(ob.depth), height: r2(ob.height), base: r2(ob.base) },
        }
      : {
          scanId: ob.id,
          category: ob.category,
          kind: mapped.kind,
          origin: p8(sub(c, mul({ x: Math.cos((ob.normalAngle + phi / RAD) * RAD), y: Math.sin((ob.normalAngle + phi / RAD) * RAD) }, ob.depth / 2))),
          direction: deg360(r2(ob.normalAngle + phi / RAD)),
          width: r8(ob.width),
          depth: r8(ob.depth),
          height,
          elevation,
          wallId: null,
          confidence: ob.confidence,
          raw: { center: p2(c), yaw: r2(yaw), width: r2(ob.width), depth: r2(ob.depth), height: r2(ob.height), base: r2(ob.base) },
        };
    if (mapped.label) f.label = mapped.label;
    if (mapped.piece) f.piece = mapped.piece;
    if (note) f.note = note;
    return f as DraftFixture;
  });
  const fixtureCounts = new Map<string, number>();
  for (const f of fixtures) {
    fixtureCounts.set(f.kind, (fixtureCounts.get(f.kind) ?? 0) + 1);
    f.id = `${f.kind === 'wall' ? 'wallCabinet' : f.kind}-${fixtureCounts.get(f.kind)}`;
  }

  // Runs: pieces on the same wall and tier with gaps of at most 3", holding at least one cabinet.
  const runs: DraftRun[] = [];
  for (const w of walls) {
    for (const tier of ['base', 'wall'] as const) {
      const pieces = fixtures
        .filter((f) => f.wallId === w.id && (tier === 'base' ? BASE_RUN.includes(f.kind) : f.kind === 'wall'))
        .map((f) => {
          const t = dot(sub(f.origin, w.a), unit(sub(w.b, w.a)));
          return { f, start: t - f.width / 2, end: t + f.width / 2 };
        })
        .sort((p, q) => p.start - q.start);
      let cur: typeof pieces = [];
      const flush = () => {
        if (cur.some((p) => CABINETS.includes(p.f.kind))) {
          const start = r8(Math.min(...cur.map((p) => p.start)));
          const end = r8(Math.max(...cur.map((p) => p.end)));
          runs.push({ id: `run-${runs.length + 1}`, wallId: w.id, tier, fixtures: cur.map((p) => p.f.id), start, end, length: r8(end - start), confidence: lowest(cur.map((p) => p.f.confidence)) });
        }
        cur = [];
      };
      for (const p of pieces) {
        if (cur.length && p.start - Math.max(...cur.map((q) => q.end)) > 3) flush();
        cur.push(p);
      }
      flush();
    }
  }

  // Keyframes as saved views.
  const views: DraftView[] = scan.frames.map((fr, i) => {
    const f = turn({ x: fr.forward.x, y: fr.forward.y });
    const level = { x: -fr.forward.z * fr.forward.x, y: -fr.forward.z * fr.forward.y, z: 1 - fr.forward.z * fr.forward.z };
    const ll = Math.hypot(level.x, level.y, level.z);
    const cosRoll = ll < 1e-9 ? 1 : (fr.up.x * level.x + fr.up.y * level.y + fr.up.z * level.z) / ll;
    const file = fr.file.split('/').pop() ?? fr.file;
    return {
      name: `Keyframe ${i + 1} (${file})`,
      file: fr.file,
      time: r2(fr.time),
      at: p2(place(fr.position)),
      yaw: r4(Math.atan2(-f.x, -f.y)),
      pitch: r4(Math.asin(Math.max(-1, Math.min(1, fr.forward.z)))),
      eyeHeight: r2(fr.height),
      roll: r2(Math.acos(Math.max(-1, Math.min(1, cosRoll))) / RAD),
      fov: { horizontal: r2((2 * Math.atan(fr.imageSize.width / 2 / fr.intrinsics.fx)) / RAD), vertical: r2((2 * Math.atan(fr.imageSize.height / 2 / fr.intrinsics.fy)) / RAD) },
    };
  });

  return {
    format: 1,
    name: name ?? scan.meta?.name ?? 'Scanned room',
    scan: { date: scan.meta?.date ?? '', device: scan.meta?.device ?? '', os: scan.meta?.os ?? '', app: scan.meta?.app ?? '' },
    tidy: { rotation: r4(phi / RAD), shift: p2(shift), floorElevation: r2(scan.floorElevation) },
    room: { width: r8(Math.max(...xs) - Math.min(...xs)), depth: r8(Math.max(...ys) - Math.min(...ys)), ceiling, closed: closedRoom },
    walls,
    corners,
    chains: chains.map((c) => ({ walls: c.walls.map((i) => wallId.get(i)!), closed: c.closed })),
    openings,
    fixtures,
    runs,
    views,
    notes,
  };
}

// The generated data module

/** The text of scripts/<name>-scan.ts: the draft as a typed const. */
export function emitScanModule(draft: ScanDraft, name: string): string {
  return [
    `// GENERATED from a scan by scripts/scan/cli.ts (npm run scan, named ${name}): ${draft.name}${draft.scan.date ? `, scanned ${draft.scan.date}` : ''}.`,
    '// Do not edit by hand: scan again and rerun to change it. Tape corrections belong in the hand',
    '// edited plan script that imports this, not here.',
    "import type { ScanDraft } from './scan/scanToPlan';",
    '',
    `export const SCAN: ScanDraft = ${JSON.stringify(draft, null, 2)};`,
    '',
  ].join('\n');
}

// The draft plan

export interface DraftPlanResult {
  /** The plan JSON text (stable ids, fixed date), what docs/scan/<name>/draft.json holds. */
  json: string;
  plan: Plan;
  /** Openings, fixtures and views the store refused or moved, one line each. */
  skipped: string[];
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'room';

/**
 * Centerline points of a chain of faces: each face moved out by half its thickness, neighbours
 * meeting where their lines cross (in line: halfway between their ends).
 */
function centerlines(walls: DraftWall[], closed: boolean): Vec2[] {
  const lines = walls.map((w) => {
    const out = mul(w.inward, -w.thickness / 2);
    return { a: add(w.a, out), b: add(w.b, out), d: unit(sub(w.b, w.a)) };
  });
  const joint = (p: (typeof lines)[number], q: (typeof lines)[number]): Vec2 => {
    if (Math.abs(cross(p.d, q.d)) < Math.sin(10 * RAD)) return mul(add(p.b, q.a), 0.5);
    return crossing(p.a, p.d, q.a, q.d) ?? mul(add(p.b, q.a), 0.5);
  };
  const n = lines.length;
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) pts.push(i === 0 && !closed ? lines[0].a : joint(lines[(i - 1 + n) % n], lines[i]));
  if (!closed) pts.push(lines[n - 1].b);
  return pts.map((p) => ({ x: Math.round(p.x * 16) / 16 + 0, y: Math.round(p.y * 16) / 16 + 0 }));
}


/**
 * Build the draft as a plan in the store (one storey, every element existing) and return its JSON:
 * the walls on their centerlines, the openings, the fixtures, a room label and a saved view per
 * keyframe. The store is left holding the plan.
 */
export function buildDraftPlan(draft: ScanDraft): DraftPlanResult {
  const skipped: string[] = [];
  store().setPlan(createEmptyPlan(`${draft.name} (scan draft)`, 'single'));
  workIn(getPlan().options[0].id);
  const [lid] = firstStructure(getPlan()).levelOrder;
  store().updateLevel(lid, { name: 'Scanned floor', wallHeight: draft.room.ceiling });
  if (draft.walls.length) store().updateSettings({ defaultExteriorThickness: draft.walls[0].thickness });

  const byId = new Map(draft.walls.map((w) => [w.id, w]));
  for (const chain of draft.chains) {
    const walls = chain.walls.map((id) => byId.get(id)!);
    const pts = centerlines(walls, chain.closed);
    const t = walls[0].thickness;
    if (walls.every((w) => w.thickness === t)) drawWalls(lid, pts, t, chain.closed);
    else walls.forEach((w, i) => drawWalls(lid, [pts[i], pts[(i + 1) % pts.length]], w.thickness));
  }

  for (const o of draft.openings) {
    const w = byId.get(o.wallId)!;
    // The centre on the face, moved out to the wall's centerline.
    const p = add(add(w.a, mul(unit(sub(w.b, w.a)), o.offset)), mul(w.inward, -w.thickness / 2));
    try {
      if (o.type === 'window') win(lid, p, o.width, o.height, 1, 1, { sill: o.sill });
      else if (o.type === 'door') addOpeningAt(lid, p, { type: 'door', width: o.width, height: o.height, into: w.inward });
      else addOpeningAt(lid, p, { type: 'passage', width: o.width, height: o.height, sill: 0 });
    } catch (e) {
      // addOpeningAt adds an opening that overruns its wall and then says it moved: it stays, moved.
      skipped.push(`${o.id}: ${(e as Error).message}`);
    }
  }

  for (const f of draft.fixtures) {
    const spec: NewFixture = { kind: f.kind, origin: f.origin, direction: f.direction, width: f.width, depth: f.depth, height: f.height, elevation: f.elevation, phase: 'existing' };
    if (f.label) spec.label = f.label;
    if (f.piece) spec.piece = f.piece;
    try {
      fixture(lid, spec);
    } catch (e) {
      skipped.push(`${f.id}: ${(e as Error).message}`);
    }
  }

  const xs = draft.walls.flatMap((w) => [w.a.x, w.b.x]);
  const ys = draft.walls.flatMap((w) => [w.a.y, w.b.y]);
  if (xs.length) label(lid, draft.name, { x: r8((Math.min(...xs) + Math.max(...xs)) / 2), y: r8((Math.min(...ys) + Math.max(...ys)) / 2) });

  for (const v of draft.views) {
    if (!store().addView({ name: v.name, levelId: lid, at: v.at, yaw: v.yaw, pitch: v.pitch })) skipped.push(`${v.name}: the view was refused`);
  }
  const plan = getPlan();
  return { json: stableIds(plan, `plan-${slug(draft.name)}-scan`), plan, skipped };
}

/** The level id a draft plan's walls are on (its one level), for callers holding the plan. */
export const draftLevelId = (plan: Plan): Id => firstStructure(plan).levelOrder[0];
