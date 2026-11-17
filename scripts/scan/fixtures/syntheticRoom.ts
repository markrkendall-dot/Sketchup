// A known room written out as a scan bundle (docs/scan/FORMAT.md), the fixture the converter's tests
// run on: scripts/scan/fixtures/makeSynthetic.ts writes it to synthetic-room/. Pure and
// deterministic: every bit of "noise" is a number written here, nothing is random.
//
// The truth, in plan inches (x right, y down, faces of the walls): the inside faces run x 0..156 and
// y 0..330 (13 ft by 27'6"), a 9 ft ceiling. The scan gets each wall a little wrong: turned up to
// 1.2 degrees about its middle, and its ends 1" to 2" long or short of the corners, its height a
// fraction off. Then the whole scan is turned 17 degrees about the vertical and moved, the floor 1.35 m
// below the phone's starting point, the way an ARKit session's frame lands anywhere.

export const TRUTH = { width: 156, depth: 330, ceiling: 108 } as const;
const M = 0.0254;
/** The scan's frame: turned TURN degrees about +Y, then moved by SHIFT metres (x, z), the floor at FLOOR. */
export const TURN = 17;
const SHIFT = { x: 0.92, z: -2.15 };
const FLOOR = -1.35;

type V3 = [number, number, number];
const crossV = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const r6 = (v: number): number => Math.round(v * 1e6) / 1e6 + 0;

/** World (metres, before the scan's turn) of a plan point (inches) at a height above the floor (inches). */
const local = (x: number, y: number, h: number): V3 => [x * M, FLOOR + h * M, y * M];
/** Turn about +Y by TURN and move: the frame the bundle is written in. */
function frame(p: V3, isDir = false): V3 {
  const t = (TURN * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const x = p[0] * c + p[2] * s;
  const z = -p[0] * s + p[2] * c;
  return isDir ? [x, p[1], z] : [x + SHIFT.x, p[1], z + SHIFT.z];
}
/** A column-major transform from a plan direction (the local right axis) at a world centre, up +Y, normal = right x up. */
function transform(rightPlan: { x: number; y: number }, center: V3): number[] {
  const l = Math.hypot(rightPlan.x, rightPlan.y);
  const right = frame([rightPlan.x / l, 0, rightPlan.y / l], true);
  const up: V3 = [0, 1, 0];
  const normal = crossV(right, up);
  const pos = frame(center);
  return [...right, 0, ...up, 0, ...normal, 0, ...pos, 1].map(r6);
}
const rot = (d: { x: number; y: number }, degrees: number) => {
  const t = (degrees * Math.PI) / 180;
  return { x: d.x * Math.cos(t) - d.y * Math.sin(t), y: d.x * Math.sin(t) + d.y * Math.cos(t) };
};

interface WallSpec {
  id: string;
  a: [number, number];
  b: [number, number];
  /** Turned about its middle (degrees). */
  turn: number;
  /** How far each end runs past (+) or short of (-) its corner. */
  extA: number;
  extB: number;
  height: number;
  confidence: 'low' | 'medium' | 'high';
}
/**
 * In an order and with directions that are not the tidy ones, as a scan would give them. The turns
 * are independent errors of both signs, so their length weighted mean (what the tidy squares the
 * room by) is near zero, as it is in a real scan; a mean error of e degrees shears positions along a
 * wall by about half the next wall's length times e (0.3" per 0.1 degree in this room).
 */
export const WALLS: WallSpec[] = [
  { id: 'W-NORTH', a: [0, 0], b: [156, 0], turn: 0.8, extA: 1.5, extB: -1, height: 108.25, confidence: 'high' },
  { id: 'W-SOUTH', a: [0, 330], b: [156, 330], turn: -0.5, extA: 1, extB: 1.75, height: 108, confidence: 'high' },
  { id: 'W-EAST', a: [156, 330], b: [156, 0], turn: -1.2, extA: -2, extB: 1.25, height: 107.5, confidence: 'medium' },
  { id: 'W-WEST', a: [0, 0], b: [0, 330], turn: 1, extA: -1.5, extB: -1.25, height: 108, confidence: 'high' },
];

/** The noisy wall as scanned: its middle, unit direction and length (plan inches). */
function scanned(w: WallSpec) {
  const d0 = { x: w.b[0] - w.a[0], y: w.b[1] - w.a[1] };
  const L = Math.hypot(d0.x, d0.y);
  const u = { x: d0.x / L, y: d0.y / L };
  const dir = rot(u, w.turn);
  // The true middle, moved along the wall by the uneven ends.
  const shiftAlong = (w.extB - w.extA) / 2;
  const mid = { x: (w.a[0] + w.b[0]) / 2 + dir.x * shiftAlong, y: (w.a[1] + w.b[1]) / 2 + dir.y * shiftAlong };
  return { mid, dir, length: L + w.extA + w.extB };
}
/** The point on a scanned wall nearest a true plan point. */
function onWall(w: WallSpec, p: { x: number; y: number }) {
  const s = scanned(w);
  const t = (p.x - s.mid.x) * s.dir.x + (p.y - s.mid.y) * s.dir.y;
  return { x: s.mid.x + s.dir.x * t, y: s.mid.y + s.dir.y * t, dir: s.dir };
}

interface OpeningSpec {
  id: string;
  category: 'door' | 'window' | 'opening';
  wall: string;
  at: { x: number; y: number };
  width: number;
  height: number;
  sill: number;
  confidence: 'low' | 'medium' | 'high';
}
export const OPENINGS: OpeningSpec[] = [
  // Top wall, its centre 100" from the left wall.
  { id: 'O-DOOR', category: 'door', wall: 'W-NORTH', at: { x: 100, y: 0 }, width: 32, height: 80, sill: 0, confidence: 'high' },
  // Left wall, over the sink, its centre 168" down from the top wall.
  { id: 'O-WINDOW', category: 'window', wall: 'W-WEST', at: { x: 0, y: 168 }, width: 36, height: 48, sill: 42, confidence: 'medium' },
  // Bottom wall, a cased opening centred 78" from the left wall.
  { id: 'O-CASED', category: 'opening', wall: 'W-SOUTH', at: { x: 78, y: 330 }, width: 36, height: 84, sill: 0, confidence: 'low' },
];

interface ObjectSpec {
  id: string;
  category: string;
  /** Centre on the plan, size, bottom above the floor. */
  at: { x: number; y: number };
  /** Local right axis on the plan (along `width`), before the box's own error. */
  right: { x: number; y: number };
  turn: number;
  width: number;
  depth: number;
  height: number;
  base: number;
  confidence: 'low' | 'medium' | 'high';
}
// The left wall's run, top to bottom: three storage boxes (24", 36", 30"), then the sink (36") under
// the window; each 24" deep, its back an inch off the wall. A wall cabinet over the 36" box. A tall
// cabinet in the top right corner. The right wall: the stove and the refrigerator. A table in the
// middle and a fireplace on the bottom wall, which have no cabinet kind.
const LEFT = { x: 0, y: -1 };
const RIGHT = { x: 0, y: 1 };
export const OBJECTS: ObjectSpec[] = [
  { id: 'B-1', category: 'storage', at: { x: 13, y: 72 }, right: LEFT, turn: 0.7, width: 24, depth: 24, height: 36, base: 0, confidence: 'high' },
  { id: 'B-2', category: 'storage', at: { x: 12.5, y: 102 }, right: LEFT, turn: -0.4, width: 36, depth: 24, height: 36, base: 0, confidence: 'high' },
  { id: 'B-3', category: 'storage', at: { x: 13, y: 135 }, right: LEFT, turn: 1, width: 30, depth: 24, height: 36, base: 0, confidence: 'medium' },
  { id: 'B-SINK', category: 'sink', at: { x: 12.75, y: 168 }, right: LEFT, turn: 0.3, width: 36, depth: 24, height: 36, base: 0, confidence: 'medium' },
  { id: 'B-UPPER', category: 'storage', at: { x: 7, y: 102 }, right: LEFT, turn: 0, width: 36, depth: 13, height: 30, base: 54, confidence: 'high' },
  // Its width along the top wall, but RoomPlan's right axis across it: the snap must swap them.
  { id: 'B-TALL', category: 'storage', at: { x: 136, y: 13 }, right: { x: 0, y: 1 }, turn: 0.5, width: 24, depth: 30, height: 84, base: 0, confidence: 'high' },
  { id: 'A-STOVE', category: 'stove', at: { x: 156 - 13, y: 75 }, right: RIGHT, turn: -0.8, width: 30, depth: 25, height: 36, base: 0, confidence: 'low' },
  { id: 'A-FRIDGE', category: 'refrigerator', at: { x: 156 - 17, y: 138 }, right: RIGHT, turn: 0.6, width: 36, depth: 30, height: 70, base: 0, confidence: 'high' },
  { id: 'X-TABLE', category: 'table', at: { x: 78, y: 250 }, right: { x: 1, y: 0 }, turn: 12, width: 48, depth: 36, height: 30, base: 0, confidence: 'high' },
  { id: 'X-FIRE', category: 'fireplace', at: { x: 130, y: 330 - 8.5 }, right: { x: -1, y: 0 }, turn: 0, width: 40, depth: 16, height: 40, base: 0, confidence: 'medium' },
];

/** The two keyframes: from the bottom of the room looking at the top wall, and from the left looking right. */
export const FRAMES = [
  { file: 'frames/0001.jpg', time: 1.25, at: { x: 78, y: 300 }, eye: 60, look: { x: 0, y: -1 }, pitch: -5 },
  { file: 'frames/0002.jpg', time: 6.5, at: { x: 40, y: 100 }, eye: 62, look: { x: 1, y: 0 }, pitch: 0 },
];

export interface SyntheticBundle {
  meta: Record<string, unknown>;
  room: Record<string, unknown>;
  frames: Record<string, unknown>;
}

/** The bundle's three JSON files. */
export function makeSyntheticBundle(): SyntheticBundle {
  const wallSpec = new Map(WALLS.map((w) => [w.id, w]));
  const surfaces: Record<string, unknown>[] = [];
  for (const w of WALLS) {
    const s = scanned(w);
    surfaces.push({
      id: w.id,
      category: 'wall',
      parentId: null,
      confidence: w.confidence,
      dimensions: [s.length * M, w.height * M, 0].map(r6),
      transform: transform(s.dir, local(s.mid.x, s.mid.y, w.height / 2)),
      curved: false,
    });
  }
  for (const o of OPENINGS) {
    const p = onWall(wallSpec.get(o.wall)!, o.at);
    const s: Record<string, unknown> = {
      id: o.id,
      category: o.category,
      parentId: o.wall,
      confidence: o.confidence,
      dimensions: [o.width * M, o.height * M, 0].map(r6),
      transform: transform(p.dir, local(p.x, p.y, o.sill + o.height / 2)),
      curved: false,
    };
    if (o.category === 'door') s.doorOpen = true;
    surfaces.push(s);
  }
  surfaces.push({
    id: 'F-FLOOR',
    category: 'floor',
    parentId: null,
    confidence: 'high',
    dimensions: [TRUTH.width * M, TRUTH.depth * M, 0].map(r6),
    transform: transform({ x: 1, y: 0 }, local(TRUTH.width / 2, TRUTH.depth / 2, 0)),
    curved: false,
  });
  const objects = OBJECTS.map((o) => ({
    id: o.id,
    category: o.category,
    parentId: null,
    confidence: o.confidence,
    dimensions: [o.width * M, o.height * M, o.depth * M].map(r6),
    transform: transform(rot(o.right, o.turn), local(o.at.x, o.at.y, o.base + o.height / 2)),
    attributes: [],
  }));
  const frames = FRAMES.map((f) => {
    const p = (f.pitch * Math.PI) / 180;
    const fwd: V3 = frame([f.look.x * Math.cos(p), Math.sin(p), f.look.y * Math.cos(p)], true);
    const right = crossV(fwd, [0, 1, 0]);
    const rl = Math.hypot(...right);
    const r: V3 = [right[0] / rl, right[1] / rl, right[2] / rl];
    const up = crossV(r, fwd);
    const back: V3 = [-fwd[0], -fwd[1], -fwd[2]];
    const pos = frame(local(f.at.x, f.at.y, f.eye));
    return {
      file: f.file,
      time: f.time,
      transform: [...r, 0, ...up, 0, ...back, 0, ...pos, 1].map(r6),
      intrinsics: [1450, 1450, 960, 720],
      imageSize: [1920, 1440],
    };
  });
  return {
    meta: { format: 1, kind: 'room', name: 'Synthetic kitchen', date: '2026-11-17T10:00:00Z', device: 'synthetic', os: 'none', app: 'makeSynthetic' },
    room: { format: 1, story: 0, surfaces, objects, sections: [{ label: 'kitchen', center: frame(local(78, 165, 0)).map(r6) }] },
    frames: { format: 1, frames },
  };
}
