// The scan bundle parser (docs/scan/FORMAT.md): room.json, frames.json and meta.json in, the scan's
// walls, openings, objects and keyframes out, in inches and plan coordinates. Pure and free of
// dependencies: no file access, no store, nothing from the app.
//
// Frames. The bundle is one ARKit world frame: metres, right handed, +Y up. three.js is right handed
// and +Y up too, and the app maps plan (x, y) to three (x, elevation, y) (docs/DESIGN.md "Units and
// coordinates"). So the mapping is the identity in 3D: plan x = world x, plan y = world z, elevation
// = world y. Seen from above (looking down -Y, with world x to the right) world +Z points down the
// screen, the way plan y does, so nothing is mirrored: a room that runs clockwise on the screen in
// the app runs clockwise seen from above in the world.
//
// RoomPlan's walls are planes: a wall's transform sits on the face the phone saw, the room side.
// The parser keeps that face; scanToPlan.ts turns the faces into centerlines.

export type Confidence = 'low' | 'medium' | 'high';
export const CONFIDENCES: readonly Confidence[] = ['low', 'medium', 'high'];

/** Inches in a metre. */
export const IN_PER_M = 1 / 0.0254;

export interface Vec2 {
  x: number;
  y: number;
}
/** A direction or point in plan axes with its elevation: x and y on the plan, z up. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ScanMeta {
  format: 1;
  kind: 'room';
  name: string;
  date: string;
  device: string;
  os: string;
  app: string;
}

export interface ScanWall {
  id: string;
  confidence: Confidence;
  /** The room-side face: start and end on the plan (inches). */
  a: Vec2;
  b: Vec2;
  length: number;
  height: number;
  /** RoomPlan's depth of the wall (usually 0: a plane). */
  thickness: number;
  /** Bottom of the wall above the floor. */
  base: number;
  curved: boolean;
  /** Corners RoomPlan gave for a wall that is not a rectangle (local, inches), else absent. */
  polygon?: Vec3[];
}

export type ScanOpeningType = 'door' | 'window' | 'passage';

export interface ScanOpening {
  id: string;
  /** door, window or opening, as RoomPlan names it. */
  category: 'door' | 'window' | 'opening';
  /** The HomePlan Opening type it becomes (an opening is a passage). */
  type: ScanOpeningType;
  confidence: Confidence;
  wallId: string;
  /** Whether the wall was named by parentId (true) or picked as the nearest wall (false). */
  parentGiven: boolean;
  center: Vec2;
  /** From the wall's a end along it to the opening's centre (Opening.offset). */
  offset: number;
  width: number;
  height: number;
  /** Bottom of the hole above the floor. */
  sill: number;
  doorOpen?: boolean;
}

export interface ScanObject {
  id: string;
  category: string;
  confidence: Confidence;
  parentId: string | null;
  /** Centre of the box on the plan. */
  center: Vec2;
  /** Plan angle (degrees, atan2 on the plan: 0 = +x, 90 = +y) of the box's local right axis, along its width. */
  yaw: number;
  /** Plan angle of the box's local normal, along its depth. */
  normalAngle: number;
  width: number;
  depth: number;
  height: number;
  /** Bottom of the box above the floor. */
  base: number;
  attributes: string[];
}

export interface ScanFrame {
  file: string;
  time: number;
  /** Camera position on the plan. */
  position: Vec2;
  /** Camera height above the floor. */
  height: number;
  /** Unit view direction (the camera's -Z) in plan axes, z up. */
  forward: Vec3;
  /** The camera's +Y (up in the landscape right image) in plan axes, z up. */
  up: Vec3;
  intrinsics: { fx: number; fy: number; cx: number; cy: number };
  imageSize: { width: number; height: number };
}

export interface ScanSection {
  label: string;
  center: Vec2;
}

export interface ParsedScan {
  meta: ScanMeta | null;
  story: number;
  /** World elevation of the floor (inches): the floor surface's, else the median wall bottom. Everything else is above it. */
  floorElevation: number;
  walls: ScanWall[];
  openings: ScanOpening[];
  objects: ScanObject[];
  frames: ScanFrame[];
  sections: ScanSection[];
  /** Things the parser noticed and worked round. */
  notes: string[];
}

type Json = Record<string, unknown>;

class ScanFormatError extends Error {}

const fail = (where: string, what: string): never => {
  throw new ScanFormatError(`${where}: ${what}`);
};
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function obj(v: unknown, where: string): Json {
  if (!isObj(v)) fail(where, 'must be a JSON object');
  return v as Json;
}
function str(v: unknown, where: string): string {
  if (typeof v !== 'string' || !v) fail(where, 'must be a non-empty string');
  return v as string;
}
function nums(v: unknown, n: number, where: string): number[] {
  if (!Array.isArray(v) || v.length !== n || !v.every(isNum)) fail(where, `must be ${n} finite numbers`);
  return v as number[];
}
function confidence(v: unknown, where: string): Confidence {
  if (!CONFIDENCES.includes(v as Confidence)) fail(where, `must be low, medium or high (got ${JSON.stringify(v)})`);
  return v as Confidence;
}
function format1(v: unknown, where: string): void {
  if (v !== 1) fail(where, `unsupported format ${JSON.stringify(v)} (expected 1)`);
}

/** A column-major 4x4 transform read as its three axes and position, in world metres. */
interface Pose {
  right: [number, number, number];
  up: [number, number, number];
  normal: [number, number, number];
  pos: [number, number, number];
}
function pose(m: number[]): Pose {
  return { right: [m[0], m[1], m[2]], up: [m[4], m[5], m[6]], normal: [m[8], m[9], m[10]], pos: [m[12], m[13], m[14]] };
}

/** World point (metres) to the plan (inches). */
const planPoint = (p: readonly number[]): Vec2 => ({ x: p[0] * IN_PER_M, y: p[2] * IN_PER_M });
/** World direction to plan axes (z up), unit length. */
function planDir(d: readonly number[]): Vec3 {
  const len = Math.hypot(d[0], d[1], d[2]);
  return len === 0 ? { x: 0, y: 0, z: 0 } : { x: d[0] / len, y: d[2] / len, z: d[1] / len };
}
const deg = (rad: number): number => (rad * 180) / Math.PI;
const planAngle = (d: readonly number[]): number => deg(Math.atan2(d[2], d[0]));

function median(v: number[]): number {
  const s = [...v].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const SURFACE_CATEGORIES = ['wall', 'door', 'window', 'opening', 'floor'] as const;
type SurfaceCategory = (typeof SURFACE_CATEGORIES)[number];

interface RawSurface {
  id: string;
  category: SurfaceCategory;
  parentId: string | null;
  confidence: Confidence;
  dims: number[];
  pose: Pose;
  doorOpen?: boolean;
  curved: boolean;
  polygon?: number[][];
}

function readSurface(v: unknown, where: string): RawSurface {
  const s = obj(v, where);
  const id = str(s.id, `${where}.id`);
  const category = s.category as SurfaceCategory;
  if (!SURFACE_CATEGORIES.includes(category)) fail(`${where}.category`, `must be one of ${SURFACE_CATEGORIES.join(', ')} (got ${JSON.stringify(s.category)})`);
  if (s.parentId !== undefined && s.parentId !== null && typeof s.parentId !== 'string') fail(`${where}.parentId`, 'must be a string or null');
  const dims = nums(s.dimensions, 3, `${where}.dimensions`);
  if (dims.some((d) => d < 0)) fail(`${where}.dimensions`, 'must not be negative');
  const out: RawSurface = {
    id,
    category,
    parentId: typeof s.parentId === 'string' && s.parentId ? s.parentId : null,
    confidence: confidence(s.confidence, `${where}.confidence`),
    dims,
    pose: pose(nums(s.transform, 16, `${where}.transform`)),
    curved: s.curved === true,
  };
  if (s.doorOpen !== undefined) {
    if (typeof s.doorOpen !== 'boolean') fail(`${where}.doorOpen`, 'must be true or false');
    out.doorOpen = s.doorOpen as boolean;
  }
  if (s.polygon !== undefined) {
    if (!Array.isArray(s.polygon)) fail(`${where}.polygon`, 'must be a list of [x, y, z] points');
    out.polygon = (s.polygon as unknown[]).map((p, i) => nums(p, 3, `${where}.polygon[${i}]`));
  }
  return out;
}

/** Parse meta.json (a room bundle's). */
export function parseMeta(json: unknown): ScanMeta {
  const m = obj(json, 'meta.json');
  format1(m.format, 'meta.json format');
  if (m.kind !== 'room') fail('meta.json kind', `this is not a room bundle (kind ${JSON.stringify(m.kind)})`);
  const text = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : '');
  return { format: 1, kind: 'room', name: str(m.name, 'meta.json name'), date: text('date'), device: text('device'), os: text('os'), app: text('app') };
}

/** Parse frames.json against the floor's world elevation (inches). */
export function parseFrames(json: unknown, floorElevation: number): ScanFrame[] {
  const f = obj(json, 'frames.json');
  format1(f.format, 'frames.json format');
  if (!Array.isArray(f.frames)) fail('frames.json frames', 'must be a list');
  return (f.frames as unknown[]).map((v, i) => {
    const where = `frames.json frames[${i}]`;
    const fr = obj(v, where);
    const p = pose(nums(fr.transform, 16, `${where}.transform`));
    const [fx, fy, cx, cy] = nums(fr.intrinsics, 4, `${where}.intrinsics`);
    const [width, height] = nums(fr.imageSize, 2, `${where}.imageSize`);
    if (fx <= 0 || fy <= 0 || width <= 0 || height <= 0) fail(where, 'focal lengths and image size must be positive');
    if (fr.time !== undefined && !isNum(fr.time)) fail(`${where}.time`, 'must be a number');
    const back = p.normal;
    return {
      file: str(fr.file, `${where}.file`),
      time: isNum(fr.time) ? fr.time : 0,
      position: planPoint(p.pos),
      height: p.pos[1] * IN_PER_M - floorElevation,
      forward: planDir([-back[0], -back[1], -back[2]]),
      up: planDir(p.up),
      intrinsics: { fx, fy, cx, cy },
      imageSize: { width, height },
    };
  });
}

/** Project p onto the wall a->b: distance from a along it, and distance off its line. */
function along(w: Pick<ScanWall, 'a' | 'b' | 'length'>, p: Vec2): { t: number; off: number } {
  const dx = (w.b.x - w.a.x) / w.length;
  const dy = (w.b.y - w.a.y) / w.length;
  const rx = p.x - w.a.x;
  const ry = p.y - w.a.y;
  return { t: rx * dx + ry * dy, off: Math.abs(rx * dy - ry * dx) };
}

/**
 * Parse a room bundle's room.json, with its frames.json and meta.json when given. Throws an Error
 * naming the file, the element and what is wrong when the JSON is not the format.
 */
export function parseRoom(roomJson: unknown, framesJson?: unknown, metaJson?: unknown): ParsedScan {
  const r = obj(roomJson, 'room.json');
  format1(r.format, 'room.json format');
  if (!Array.isArray(r.surfaces)) fail('room.json surfaces', 'must be a list');
  if (r.objects !== undefined && !Array.isArray(r.objects)) fail('room.json objects', 'must be a list');
  const notes: string[] = [];
  const surfaces = (r.surfaces as unknown[]).map((s, i) => readSurface(s, `room.json surfaces[${i}]`));
  const ids = new Set<string>();
  for (const [i, s] of surfaces.entries()) {
    if (ids.has(s.id)) fail(`room.json surfaces[${i}].id`, `${s.id} is used twice`);
    ids.add(s.id);
  }
  const rawWalls = surfaces.filter((s) => s.category === 'wall');
  if (rawWalls.length === 0) fail('room.json surfaces', 'has no walls');

  const floors = surfaces.filter((s) => s.category === 'floor');
  const wallBases = rawWalls.map((s) => (s.pose.pos[1] - s.dims[1] / 2) * IN_PER_M);
  const floorElevation = floors.length ? median(floors.map((s) => s.pose.pos[1] * IN_PER_M)) : median(wallBases);
  if (!floors.length) notes.push('no floor surface: the floor is taken as the median wall bottom');

  const walls: ScanWall[] = rawWalls.map((s) => {
    const where = `room.json wall ${s.id}`;
    const h = Math.hypot(s.pose.right[0], s.pose.right[2]);
    if (h < 0.5) fail(where, 'its right axis (the wall direction) is not horizontal');
    const ux = s.pose.right[0] / h;
    const uz = s.pose.right[2] / h;
    const half = s.dims[0] / 2;
    if (s.dims[0] <= 0 || s.dims[1] <= 0) fail(`${where} dimensions`, 'a wall needs a positive width and height');
    const a = planPoint([s.pose.pos[0] - ux * half, 0, s.pose.pos[2] - uz * half]);
    const b = planPoint([s.pose.pos[0] + ux * half, 0, s.pose.pos[2] + uz * half]);
    const wall: ScanWall = {
      id: s.id,
      confidence: s.confidence,
      a,
      b,
      length: s.dims[0] * IN_PER_M,
      height: s.dims[1] * IN_PER_M,
      thickness: s.dims[2] * IN_PER_M,
      base: (s.pose.pos[1] - s.dims[1] / 2) * IN_PER_M - floorElevation,
      curved: s.curved,
    };
    if (s.polygon) wall.polygon = s.polygon.map((p) => ({ x: p[0] * IN_PER_M, y: p[2] * IN_PER_M, z: p[1] * IN_PER_M }));
    if (s.curved) notes.push(`wall ${s.id} is curved: drawn straight`);
    return wall;
  });
  const wallById = new Map(walls.map((w) => [w.id, w]));

  const openings: ScanOpening[] = surfaces
    .filter((s) => s.category === 'door' || s.category === 'window' || s.category === 'opening')
    .map((s) => {
      const where = `room.json ${s.category} ${s.id}`;
      if (s.dims[0] <= 0 || s.dims[1] <= 0) fail(`${where} dimensions`, 'needs a positive width and height');
      const center = planPoint(s.pose.pos);
      let wall: ScanWall | undefined;
      let parentGiven = true;
      if (s.parentId) {
        wall = wallById.get(s.parentId);
        if (!wall) fail(`${where} parentId`, ids.has(s.parentId) ? `${s.parentId} is not a wall` : `no surface ${s.parentId}`);
      } else {
        // No parent: the nearest wall it lies on (within 6" of its line, inside its length).
        parentGiven = false;
        let best: { w: ScanWall; off: number } | null = null;
        for (const w of walls) {
          const { t, off } = along(w, center);
          if (t < 0 || t > w.length || off > 6) continue;
          if (!best || off < best.off) best = { w, off };
        }
        if (!best) fail(where, 'has no parentId and lies on no wall');
        wall = best!.w;
        notes.push(`${s.category} ${s.id} has no parent wall: put on the nearest, ${wall.id}`);
      }
      const w = wall!;
      const bottom = (s.pose.pos[1] - s.dims[1] / 2) * IN_PER_M - floorElevation;
      const type: ScanOpeningType = s.category === 'opening' ? 'passage' : (s.category as 'door' | 'window');
      const o: ScanOpening = {
        id: s.id,
        category: s.category as ScanOpening['category'],
        type,
        confidence: s.confidence,
        wallId: w.id,
        parentGiven,
        center,
        offset: along(w, center).t,
        width: s.dims[0] * IN_PER_M,
        height: s.dims[1] * IN_PER_M,
        sill: s.category === 'door' ? Math.max(0, bottom) : bottom,
      };
      if (s.doorOpen !== undefined) o.doorOpen = s.doorOpen;
      return o;
    });

  const objects: ScanObject[] = ((r.objects as unknown[] | undefined) ?? []).map((v, i) => {
    const where = `room.json objects[${i}]`;
    const o = obj(v, where);
    const id = str(o.id, `${where}.id`);
    if (ids.has(id)) fail(`${where}.id`, `${id} is used twice`);
    ids.add(id);
    const dims = nums(o.dimensions, 3, `${where}.dimensions`);
    if (dims.some((d) => d <= 0)) fail(`${where}.dimensions`, 'must be positive');
    const p = pose(nums(o.transform, 16, `${where}.transform`));
    if (Math.hypot(p.right[0], p.right[2]) < 0.5) fail(`${where}.transform`, 'the box is tipped over (its right axis is not horizontal)');
    if (o.parentId !== undefined && o.parentId !== null && typeof o.parentId !== 'string') fail(`${where}.parentId`, 'must be a string or null');
    if (o.attributes !== undefined && (!Array.isArray(o.attributes) || !o.attributes.every((a) => typeof a === 'string'))) fail(`${where}.attributes`, 'must be a list of strings');
    return {
      id,
      category: str(o.category, `${where}.category`),
      confidence: confidence(o.confidence, `${where}.confidence`),
      parentId: typeof o.parentId === 'string' && o.parentId ? o.parentId : null,
      center: planPoint(p.pos),
      yaw: planAngle(p.right),
      normalAngle: planAngle(p.normal),
      width: dims[0] * IN_PER_M,
      depth: dims[2] * IN_PER_M,
      height: dims[1] * IN_PER_M,
      base: (p.pos[1] - dims[1] / 2) * IN_PER_M - floorElevation,
      attributes: ((o.attributes as string[] | undefined) ?? []).slice(),
    };
  });

  const sections: ScanSection[] = [];
  if (r.sections !== undefined) {
    if (!Array.isArray(r.sections)) fail('room.json sections', 'must be a list');
    (r.sections as unknown[]).forEach((v, i) => {
      const s = obj(v, `room.json sections[${i}]`);
      sections.push({ label: typeof s.label === 'string' ? s.label : '', center: planPoint(nums(s.center, 3, `room.json sections[${i}].center`)) });
    });
  }

  return {
    meta: metaJson === undefined ? null : parseMeta(metaJson),
    story: isNum(r.story) ? r.story : 0,
    floorElevation,
    walls,
    openings,
    objects,
    frames: framesJson === undefined ? [] : parseFrames(framesJson, floorElevation),
    sections,
    notes,
  };
}
