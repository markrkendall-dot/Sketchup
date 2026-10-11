import { nanoid } from 'nanoid';
import { coreInterval, draftFootprints, type FootprintSource } from '../derive/openings';
import { cross, dist, projectPointToSegment, segmentIntersection, sub } from './geometry';
import { isHexColor, MAX_LITES, WALL_FINISHES } from './finish';
import { clampOpeningOffset, OPENING_DEFAULTS } from './openings';
import type { Column, GradePoint, Id, Level, Opening, Phase, Plan, PlanSettings, Roof, RoofShape, Room, Site, Stairs, Underlay, Vec2, Wall, WallFinish } from './types';
import { isValidUnderlay, normalizeRotation } from './underlay';

export const SCHEMA_VERSION = 2 as const;
/** Nodes closer than this are the same node; see docs/DESIGN.md "Walls are a graph". */
export const MERGE_EPS = 0.5;

export const newId = (): Id => nanoid(10);

export const DEFAULT_SETTINGS: PlanSettings = {
  snapGrid: 1,
  displayGrid: 12,
  precisionDenominator: 16,
  defaultExteriorThickness: 6.5,
  defaultInteriorThickness: 4.5,
};

export function createLevel(name: string, wallHeight: number, floorThickness: number): Level {
  return {
    id: newId(),
    name,
    wallHeight,
    floorThickness,
    nodes: {},
    walls: {},
    openings: {},
    rooms: {},
    stairs: {},
    roofs: {},
  };
}

/** The site of a new plan (and of files from before schema version 2). */
export const defaultSite = (): Site => ({ northAngle: 0, gradePoints: {}, columns: {} });

export function createEmptyPlan(name = 'Untitled plan'): Plan {
  const levels = [
    createLevel('Basement', 96, 4),
    createLevel('First Floor', 96, 12),
    createLevel('Second Floor', 96, 12),
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name,
    levelOrder: levels.map((l) => l.id),
    levels: Object.fromEntries(levels.map((l) => [l.id, l])),
    baseFloorElevation: -100,
    settings: { ...DEFAULT_SETTINGS },
    site: defaultSite(),
    modifiedAt: new Date().toISOString(),
  };
}

/** The level the editor opens on: First Floor (levelOrder[1]) when present. */
export function defaultLevelId(plan: Plan): Id {
  return plan.levelOrder[1] ?? plan.levelOrder[0];
}

/** Floor-top elevation of each level, bottom to top (see DESIGN.md elevation rule). */
export function floorTops(plan: Plan): number[] {
  const tops: number[] = [];
  plan.levelOrder.forEach((id, i) => {
    if (i === 0) tops.push(plan.baseFloorElevation);
    else {
      const below = plan.levels[plan.levelOrder[i - 1]];
      tops.push(tops[i - 1] + below.wallHeight + plan.levels[id].floorThickness);
    }
  });
  return tops;
}

export function wallLength(level: Level, wall: Wall): number {
  const a = level.nodes[wall.a];
  const b = level.nodes[wall.b];
  return a && b ? dist(a, b) : 0;
}

/** Existing node within `eps` of p (closest), if any. */
export function findNodeNear(level: Level, p: Vec2, eps = MERGE_EPS, exclude?: Id): Id | null {
  let best: Id | null = null;
  let bestD = eps;
  for (const n of Object.values(level.nodes)) {
    if (n.id === exclude) continue;
    const d = dist(n, p);
    if (d <= bestD) {
      bestD = d;
      best = n.id;
    }
  }
  return best;
}

export function findWallBetween(level: Level, a: Id, b: Id): Wall | null {
  for (const w of Object.values(level.walls)) {
    if ((w.a === a && w.b === b) || (w.a === b && w.b === a)) return w;
  }
  return null;
}

/**
 * Clamp the offsets of every opening on a wall (or on all walls when wallId is omitted) to the
 * wall's core interval between corner joins (derive/openings.ts coreInterval). Footprints are
 * computed fresh: `level` is usually an immer draft.
 */
export function clampOpenings(level: Level, wallId?: Id, source?: FootprintSource): void {
  let fps = source;
  for (const o of Object.values(level.openings)) {
    if (wallId !== undefined && o.wallId !== wallId) continue;
    if (!level.walls[o.wallId]) continue;
    fps ??= draftFootprints(level);
    const [s0, s1] = coreInterval(level, o.wallId, o.phase, fps)!;
    const next = clampOpeningOffset(o.offset, o.width, s0, s1);
    // Assign only on change so immer keeps untouched openings' identity.
    if (Math.abs(next - o.offset) > 1e-9) o.offset = next;
  }
}

/**
 * Length along which segments p0-p1 and q0-q1 lie on top of each other: 0 unless one segment's
 * ends are both within MERGE_EPS of the other's line (collinear), then the overlap of their
 * intervals measured along p (projectPointToSegment on p0-p1). Ends that only touch give 0.
 */
export function collinearOverlap(p0: Vec2, p1: Vec2, q0: Vec2, q1: Vec2): number {
  const lp = dist(p0, p1);
  const lq = dist(q0, q1);
  if (lp < 1e-9 || lq < 1e-9) return 0;
  const offLine = (p: Vec2, a: Vec2, b: Vec2, len: number) => Math.abs(cross(sub(b, a), sub(p, a))) / len;
  const qOnP = offLine(q0, p0, p1, lp) <= MERGE_EPS && offLine(q1, p0, p1, lp) <= MERGE_EPS;
  const pOnQ = offLine(p0, q0, q1, lq) <= MERGE_EPS && offLine(p1, q0, q1, lq) <= MERGE_EPS;
  if (!qOnP && !pOnQ) return 0;
  const s0 = projectPointToSegment(q0, p0, p1).tRaw * lp;
  const s1 = projectPointToSegment(q1, p0, p1).tRaw * lp;
  return Math.max(0, Math.min(lp, Math.max(s0, s1)) - Math.max(0, Math.min(s0, s1)));
}

/** Shown when a new wall (or a copied or dragged one) would lie on top of a wall already there. */
export const WALL_OVERLAP_MESSAGE = 'A wall is already there. Select it and Mark demolish, or draw the new wall beside it.';

/**
 * The first wall of the level (any phase: hidden demolished walls are still there) that the
 * segment a-b would lie on top of for more than MERGE_EPS, or null. Walls it only touches end to
 * end, crosses or meets in a T are fine.
 */
export function wallOverlapping(level: Level, a: Vec2, b: Vec2, skip?: (w: Wall) => boolean): Wall | null {
  for (const w of Object.values(level.walls)) {
    if (skip?.(w)) continue;
    const p = level.nodes[w.a];
    const q = level.nodes[w.b];
    if (p && q && collinearOverlap(p, q, a, b) > MERGE_EPS) return w;
  }
  return null;
}

/**
 * True when moving the nodes to `positions` would lay one of their walls on top of another wall
 * (a collinear overlap longer than MERGE_EPS that was not there before the move).
 */
export function movesCreateOverlap(level: Level, positions: Record<Id, Vec2>): boolean {
  const moved = (id: Id) => id in positions && !!level.nodes[id];
  const touched = Object.values(level.walls).filter((w) => moved(w.a) || moved(w.b));
  if (touched.length === 0) return false;
  const after = (id: Id): Vec2 => (moved(id) ? positions[id] : level.nodes[id]);
  const all = Object.values(level.walls);
  for (const w of touched) {
    const wa = after(w.a);
    const wb = after(w.b);
    for (const o of all) {
      if (o === w || !level.nodes[o.a] || !level.nodes[o.b]) continue;
      if (collinearOverlap(wa, wb, after(o.a), after(o.b)) <= MERGE_EPS) continue;
      if (collinearOverlap(level.nodes[w.a], level.nodes[w.b], level.nodes[o.a], level.nodes[o.b]) > MERGE_EPS) continue;
      return true;
    }
  }
  return false;
}

/**
 * Which of two walls between the same two nodes survives the duplicate drop: an `existing` wall
 * over a new or demolished one, then a wall with openings over one without. Lower wins; equal
 * ranks keep the wall that was there first.
 */
function survivorRank(level: Level, w: Wall): number {
  const hasOpenings = Object.values(level.openings).some((o) => o.wallId === w.id);
  return (w.phase === 'existing' ? 0 : 2) + (hasOpenings ? 0 : 1);
}

/** Drop wall `dropId` in favour of `keepId` (same two nodes): its openings move over, then clamp. */
function mergeDuplicateInto(level: Level, keepId: Id, dropId: Id): void {
  const keep = level.walls[keepId];
  const drop = level.walls[dropId];
  const len = wallLength(level, keep);
  for (const o of Object.values(level.openings)) {
    if (o.wallId !== dropId) continue;
    o.wallId = keepId;
    if (keep.a !== drop.a) o.offset = len - o.offset;
  }
  delete level.walls[dropId];
  clampOpenings(level, keepId);
}

function deleteWallInPlace(level: Level, wallId: Id): void {
  delete level.walls[wallId];
  for (const o of Object.values(level.openings)) if (o.wallId === wallId) delete level.openings[o.id];
}

/**
 * Find one pair of walls that cross strictly inside both (farther than MERGE_EPS from every end,
 * not parallel, no shared node) and add a node at the crossing, so the node-on-wall pass splits
 * both. Pairs whose crossing lands on an existing node are remembered in `skip` and not retried.
 * Returns true when a node was added.
 */
function insertCrossingNode(level: Level, skip: Set<string>): boolean {
  const walls = Object.values(level.walls);
  const boxes = walls.map((w) => {
    const a = level.nodes[w.a];
    const b = level.nodes[w.b];
    return { a, b, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) };
  });
  for (let i = 0; i < walls.length; i++) {
    const p = walls[i];
    const P = boxes[i];
    for (let j = i + 1; j < walls.length; j++) {
      const q = walls[j];
      const Q = boxes[j];
      if (P.maxX < Q.minX || Q.maxX < P.minX || P.maxY < Q.minY || Q.maxY < P.minY) continue;
      if (p.a === q.a || p.a === q.b || p.b === q.a || p.b === q.b) continue;
      const key = p.id < q.id ? `${p.id}|${q.id}` : `${q.id}|${p.id}`;
      if (skip.has(key)) continue;
      const hit = segmentIntersection(P.a, P.b, Q.a, Q.b);
      if (!hit) continue;
      const lp = dist(P.a, P.b);
      const lq = dist(Q.a, Q.b);
      const sp = hit.t * lp;
      const sq = hit.u * lq;
      if (sp <= MERGE_EPS || sp >= lp - MERGE_EPS || sq <= MERGE_EPS || sq >= lq - MERGE_EPS) continue;
      if (findNodeNear(level, hit.point)) {
        skip.add(key);
        continue;
      }
      const id = newId();
      level.nodes[id] = { id, x: hit.point.x, y: hit.point.y };
      return true;
    }
  }
  return false;
}

/**
 * Restore the planar-graph invariant on a (draft) level, in place:
 * merge nodes within MERGE_EPS, drop zero-length and duplicate walls, split walls at nodes lying
 * on their interior, split walls that cross each other at a new shared node, and remove nodes with
 * no walls. Nodes in `moved` are absorbed into
 * stationary neighbours when merging. Returns a map from absorbed node ids to survivors.
 */
export function normalizeLevel(level: Level, moved?: ReadonlySet<Id>): Map<Id, Id> {
  const remap = new Map<Id, Id>();
  const resolve = (id: Id): Id => {
    let cur = id;
    while (remap.has(cur)) cur = remap.get(cur)!;
    return cur;
  };

  // 1. Merge close nodes.
  const ids = Object.keys(level.nodes);
  if (moved) ids.sort((p, q) => Number(moved.has(p)) - Number(moved.has(q)));
  for (let i = 0; i < ids.length; i++) {
    const keep = level.nodes[ids[i]];
    if (!keep) continue;
    for (let j = i + 1; j < ids.length; j++) {
      const other = level.nodes[ids[j]];
      if (other && dist(keep, other) <= MERGE_EPS) {
        remap.set(other.id, keep.id);
        delete level.nodes[other.id];
      }
    }
  }
  if (remap.size > 0) {
    for (const w of Object.values(level.walls)) {
      const a = resolve(w.a);
      const b = resolve(w.b);
      if (w.a !== a) w.a = a;
      if (w.b !== b) w.b = b;
    }
  }

  // 2. Drop degenerate and duplicate walls (simple graph).
  const seen = new Map<string, Id>();
  for (const w of Object.values(level.walls)) {
    if (w.a === w.b || !level.nodes[w.a] || !level.nodes[w.b]) {
      deleteWallInPlace(level, w.id);
      continue;
    }
    const key = w.a < w.b ? `${w.a}|${w.b}` : `${w.b}|${w.a}`;
    const prev = seen.get(key);
    if (prev) {
      // Keep the existing wall (then the one with openings, then the first) and move the other's
      // openings onto it, so drawing over a wall never silently replaces the original.
      if (survivorRank(level, w) < survivorRank(level, level.walls[prev])) {
        mergeDuplicateInto(level, w.id, prev);
        seen.set(key, w.id);
      } else mergeDuplicateInto(level, prev, w.id);
    } else seen.set(key, w.id);
  }

  // 3. Split walls at nodes lying on their interior; then insert a node where two walls cross
  // (strictly inside both) and let the next pass split both at it. Each pass changes one thing, so
  // the guard grows with the size of the level.
  const skipCrossing = new Set<string>();
  const passes = 1000 + 4 * Object.keys(level.walls).length ** 2;
  for (let guard = 0; guard < passes; guard++) {
    let split = false;
    outer: for (const n of Object.values(level.nodes)) {
      for (const w of Object.values(level.walls)) {
        if (w.a === n.id || w.b === n.id) continue;
        const a = level.nodes[w.a];
        const b = level.nodes[w.b];
        const len = dist(a, b);
        const pr = projectPointToSegment(n, a, b);
        const s = pr.tRaw * len;
        if (pr.distance > MERGE_EPS || s <= MERGE_EPS || s >= len - MERGE_EPS) continue;
        const tailExists = findWallBetween(level, n.id, w.b);
        const headExists = findWallBetween(level, w.a, n.id);
        const rank = survivorRank(level, w);
        const headWins = !!headExists && rank < survivorRank(level, headExists);
        const tailWins = !!tailExists && rank < survivorRank(level, tailExists);
        if ((headExists && tailExists) || headWins || tailWins) {
          // Split, then resolve each duplicate piece by the survivor rule (an existing wall is not
          // replaced by a new one lying on top of it; openings move to whichever piece stays).
          const tail: Wall = { ...w, id: newId(), a: n.id, b: w.b };
          w.b = n.id;
          level.walls[tail.id] = tail;
          for (const o of Object.values(level.openings)) {
            if (o.wallId === w.id && o.offset > s) {
              o.wallId = tail.id;
              o.offset -= s;
            }
          }
          clampOpenings(level, w.id);
          clampOpenings(level, tail.id);
          if (headExists) {
            if (headWins) mergeDuplicateInto(level, w.id, headExists.id);
            else mergeDuplicateInto(level, headExists.id, w.id);
          }
          if (tailExists) {
            if (tailWins) mergeDuplicateInto(level, tail.id, tailExists.id);
            else mergeDuplicateInto(level, tailExists.id, tail.id);
          }
          split = true;
          break outer;
        }
        if (headExists) {
          // Only the n->b half is new: shorten from the a end.
          w.a = n.id;
          for (const o of Object.values(level.openings)) if (o.wallId === w.id) o.offset -= s;
          clampOpenings(level, w.id);
          split = true;
          break outer;
        }
        const tail: Wall = { ...w, id: newId(), a: n.id, b: w.b };
        w.b = n.id;
        if (!tailExists) level.walls[tail.id] = tail;
        for (const o of Object.values(level.openings)) {
          if (o.wallId === w.id && o.offset > s) {
            if (tailExists) {
              o.wallId = tailExists.id;
              o.offset = tailExists.a === n.id ? o.offset - s : len - o.offset;
            } else {
              o.wallId = tail.id;
              o.offset -= s;
            }
          }
        }
        clampOpenings(level, w.id);
        clampOpenings(level, tailExists ? tailExists.id : tail.id);
        split = true;
        break outer;
      }
    }
    if (!split) split = insertCrossingNode(level, skipCrossing);
    if (!split) break;
  }

  // 4. Remove orphan nodes.
  const used = new Set<Id>();
  for (const w of Object.values(level.walls)) {
    used.add(w.a);
    used.add(w.b);
  }
  for (const id of Object.keys(level.nodes)) if (!used.has(id)) delete level.nodes[id];

  // 5. Openings: drop any whose wall is gone, clamp the rest (walls may have been shortened by a
  // node move that preceded this pass).
  for (const o of Object.values(level.openings)) if (!level.walls[o.wallId]) delete level.openings[o.id];
  clampOpenings(level);

  return remap;
}

// ---------------------------------------------------------------------------------------------
// Loading / migration
//
// A file is upgraded one schema version at a time by MIGRATIONS (version N -> N + 1), then read
// into a Plan built from known fields only: unknown keys in the file are dropped, missing optional
// values get defaults, and broken entities are dropped (or the load fails with a readable message
// when nothing sensible can be made of it). Known keys keep the order they have in the file, so a
// current file round-trips byte for byte through JSON.stringify.

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPoint = (v: unknown): v is Vec2 => isObject(v) && isNum(v.x) && isNum(v.y);

function fail(msg: string): never {
  throw new Error(`Not a valid HomePlan file: ${msg}`);
}

function record(v: unknown, where: string): Json {
  if (v === undefined) return {};
  if (!isObject(v)) fail(`${where} must be an object`);
  return v;
}

/**
 * The keys of `raw` that are in `keys`, in raw's order. Values that need checking are assigned
 * afterwards: an existing key keeps its position, a missing one is appended.
 */
function pick(raw: Json, keys: readonly string[]): Json {
  const out: Json = {};
  for (const k of Object.keys(raw)) if (keys.includes(k)) out[k] = raw[k];
  return out;
}

/** Set (or, for undefined, remove) a key on a picked object. */
function put(out: Json, key: string, value: unknown): void {
  if (value === undefined) delete out[key];
  else out[key] = value;
}

/** Previous-version upgrades: MIGRATIONS[n] turns a version n document into version n + 1. */
export const MIGRATIONS: Record<number, (doc: Json) => Json> = {
  /**
   * Version 0 (pre-release files): levels, and the nodes, walls, openings, rooms and stairs of each
   * level, could be arrays of objects with ids instead of records keyed by id; levelOrder could be
   * missing (the order of the levels array); settings could lack later fields (filled on load).
   */
  0: (doc) => {
    const toRecord = (v: unknown, where: string): unknown => {
      if (!Array.isArray(v)) return v;
      const out: Json = {};
      v.forEach((item, i) => {
        if (!isObject(item)) fail(`${where}[${i}] is not an object`);
        const id = typeof item.id === 'string' && item.id ? item.id : `${where}-${i}`;
        out[id] = { ...item, id };
      });
      return out;
    };
    const next: Json = { ...doc };
    if (Array.isArray(doc.levels) && doc.levelOrder === undefined) {
      next.levelOrder = doc.levels.map((l, i) => (isObject(l) && typeof l.id === 'string' && l.id ? l.id : `levels-${i}`));
    }
    const levels = toRecord(doc.levels, 'levels');
    if (isObject(levels)) {
      const upgraded: Json = {};
      for (const [id, raw] of Object.entries(levels)) {
        if (!isObject(raw)) {
          upgraded[id] = raw;
          continue;
        }
        const level: Json = { ...raw };
        for (const k of ['nodes', 'walls', 'openings', 'rooms', 'stairs']) level[k] = toRecord(raw[k], `${id}.${k}`);
        upgraded[id] = level;
      }
      next.levels = upgraded;
    }
    next.settings = { ...DEFAULT_SETTINGS, ...(isObject(doc.settings) ? doc.settings : {}) };
    next.schemaVersion = 1;
    return next;
  },
  /** Version 1: levels have no roofs and the plan has no site; add empty ones. */
  1: (doc) => {
    const next: Json = { ...doc };
    if (isObject(doc.levels)) {
      const upgraded: Json = {};
      for (const [id, raw] of Object.entries(doc.levels)) upgraded[id] = isObject(raw) ? { ...raw, roofs: {} } : raw;
      next.levels = upgraded;
    }
    next.site = defaultSite();
    next.schemaVersion = 2;
    return next;
  },
};

const PHASES = new Set(['existing', 'demo', 'new']);
const phaseOf = (v: unknown): Phase => (typeof v === 'string' && PHASES.has(v) ? (v as Phase) : 'existing');
const OPENING_TYPES = new Set(['door', 'window', 'passage']);

const NODE_KEYS = ['id', 'x', 'y'] as const;
const WALL_KEYS = ['id', 'a', 'b', 'thickness', 'kind', 'phase', 'heightOverride', 'finish', 'color'] as const;
const OPENING_KEYS = ['id', 'wallId', 'type', 'offset', 'width', 'height', 'sill', 'phase', 'swing', 'lites', 'shutters', 'trim'] as const;
const ROOM_KEYS = ['id', 'name', 'anchor', 'ceilingOverride'] as const;
const STAIRS_KEYS = ['id', 'origin', 'direction', 'width', 'run', 'phase', 'cutsFloorAbove', 'headroom', 'holeStart'] as const;
const ROOF_KEYS = ['id', 'shape', 'outline', 'ridgeAngle', 'pitch', 'overhang', 'bearingOffset', 'thickness', 'fascia', 'phase', 'finish', 'color'] as const;
const ROOF_SHAPES = new Set<string>(['gable', 'shed', 'hip', 'flat']);
const SITE_KEYS = ['northAngle', 'gradePoints', 'columns'] as const;
const GRADE_POINT_KEYS = ['id', 'at', 'elevation'] as const;
const COLUMN_KEYS = ['id', 'at', 'width', 'depth', 'rotation', 'base', 'top', 'kind', 'phase'] as const;
const UNDERLAY_KEYS = ['image', 'pixelWidth', 'pixelHeight', 'origin', 'scale', 'rotation', 'opacity', 'locked'] as const;
const LEVEL_KEYS = ['id', 'name', 'wallHeight', 'floorThickness', 'nodes', 'walls', 'openings', 'rooms', 'stairs', 'roofs', 'underlay'] as const;
const PLAN_KEYS = ['schemaVersion', 'id', 'name', 'levelOrder', 'levels', 'baseFloorElevation', 'settings', 'site', 'modifiedAt'] as const;
const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);

function migrateNodes(raw: Json, where: string): Level['nodes'] {
  const out: Level['nodes'] = {};
  for (const [nid, n] of Object.entries(raw)) {
    if (!isObject(n) || !isNum(n.x) || !isNum(n.y)) fail(`${where}: node ${nid} needs numeric x and y`);
    const node = pick(n, NODE_KEYS);
    node.id = nid;
    out[nid] = node as unknown as Level['nodes'][Id];
  }
  return out;
}

function migrateWalls(raw: Json, nodes: Level['nodes'], where: string): Level['walls'] {
  const out: Level['walls'] = {};
  for (const [wid, w] of Object.entries(raw)) {
    if (!isObject(w) || typeof w.a !== 'string' || typeof w.b !== 'string') fail(`${where}: wall ${wid} needs node ids a and b`);
    if (!(w.a in nodes) || !(w.b in nodes)) fail(`${where}: wall ${wid} references a missing node`);
    if (!isNum(w.thickness) || w.thickness <= 0) fail(`${where}: wall ${wid} needs a positive thickness`);
    const wall = pick(w, WALL_KEYS);
    wall.id = wid;
    wall.kind = w.kind === 'exterior' || w.kind === 'interior' ? w.kind : w.thickness >= 6 ? 'exterior' : 'interior';
    wall.phase = phaseOf(w.phase);
    put(wall, 'heightOverride', isNum(w.heightOverride) && w.heightOverride > 0 ? w.heightOverride : undefined);
    // Optional appearance fields: an unknown finish or a malformed colour is dropped (the defaults apply).
    put(wall, 'finish', typeof w.finish === 'string' && WALL_FINISHES.includes(w.finish as WallFinish) ? w.finish : undefined);
    put(wall, 'color', isHexColor(w.color) ? w.color.toLowerCase() : undefined);
    out[wid] = wall as unknown as Wall;
  }
  return out;
}

/** Openings on an existing wall with a usable size; the rest are dropped. */
function migrateOpenings(raw: Json, walls: Level['walls']): Level['openings'] {
  const out: Level['openings'] = {};
  for (const [oid, o] of Object.entries(raw)) {
    if (!isObject(o) || typeof o.wallId !== 'string' || !walls[o.wallId]) continue;
    if (typeof o.type !== 'string' || !OPENING_TYPES.has(o.type) || !isNum(o.offset) || !isNum(o.width) || o.width <= 0) continue;
    const type = o.type as Opening['type'];
    const def = OPENING_DEFAULTS[type];
    const opening = pick(o, OPENING_KEYS);
    opening.id = oid;
    opening.height = isNum(o.height) && o.height > 0 ? o.height : def.height;
    opening.sill = isNum(o.sill) && o.sill >= 0 ? o.sill : def.sill;
    opening.phase = phaseOf(o.phase);
    const sw = o.swing;
    put(
      opening,
      'swing',
      type === 'door'
        ? {
            hinge: isObject(sw) && sw.hinge === 'b' ? 'b' : 'a',
            side: isObject(sw) && sw.side === 'right' ? 'right' : 'left',
          }
        : undefined,
    );
    const lites = o.lites;
    const liteCount = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v >= 1 && v <= MAX_LITES;
    put(opening, 'lites', isObject(lites) && liteCount(lites.cols) && liteCount(lites.rows) ? { cols: lites.cols, rows: lites.rows } : undefined);
    put(opening, 'shutters', typeof o.shutters === 'boolean' ? o.shutters : undefined);
    put(opening, 'trim', isNum(o.trim) && o.trim >= 0 && o.trim <= 24 ? o.trim : undefined);
    out[oid] = opening as unknown as Opening;
  }
  return out;
}

function migrateRooms(raw: Json): Level['rooms'] {
  const out: Level['rooms'] = {};
  for (const [rid, r] of Object.entries(raw)) {
    if (!isObject(r) || !isPoint(r.anchor)) continue;
    const room = pick(r, ROOM_KEYS);
    room.id = rid;
    room.name = typeof r.name === 'string' && r.name.trim() ? r.name : 'Room';
    room.anchor = { x: r.anchor.x, y: r.anchor.y };
    put(room, 'ceilingOverride', isNum(r.ceilingOverride) && r.ceilingOverride > 0 ? r.ceilingOverride : undefined);
    out[rid] = room as unknown as Room;
  }
  return out;
}

/**
 * Keep stairs with a usable position and size; fill in phase and cutsFloorAbove when missing; keep
 * headroom (positive) and holeStart (not negative) only when valid.
 */
function migrateStairs(raw: Json): Level['stairs'] {
  const out: Level['stairs'] = {};
  for (const [sid, st] of Object.entries(raw)) {
    if (!isObject(st) || !isPoint(st.origin)) continue;
    if (!isNum(st.width) || st.width <= 0 || !isNum(st.run) || st.run <= 0) continue;
    const stairs = pick(st, STAIRS_KEYS);
    stairs.id = sid;
    stairs.origin = { x: st.origin.x, y: st.origin.y };
    stairs.direction = isNum(st.direction) ? st.direction : 0;
    stairs.phase = phaseOf(st.phase);
    stairs.cutsFloorAbove = typeof st.cutsFloorAbove === 'boolean' ? st.cutsFloorAbove : true;
    // Optional floor-opening fields: kept when usable, dropped otherwise (the defaults apply).
    put(stairs, 'headroom', isNum(st.headroom) && st.headroom > 0 ? st.headroom : undefined);
    put(stairs, 'holeStart', isNum(st.holeStart) && st.holeStart >= 0 ? st.holeStart : undefined);
    out[sid] = stairs as unknown as Stairs;
  }
  return out;
}

/** Largest roof pitch the editor accepts (rise per 12). */
export const MAX_ROOF_PITCH = 24;

/** Why a stored roof cannot be used, or null when it can (also used by the store). */
export function roofProblem(r: Pick<Roof, 'outline' | 'pitch' | 'overhang' | 'thickness' | 'fascia' | 'ridgeAngle' | 'bearingOffset'>): string | null {
  if (!Array.isArray(r.outline) || r.outline.length < 3 || !r.outline.every(isPoint)) return 'needs an outline of at least 3 points';
  let area = 0;
  for (let i = 0; i < r.outline.length; i++) {
    const p = r.outline[i];
    const q = r.outline[(i + 1) % r.outline.length];
    area += p.x * q.y - q.x * p.y;
  }
  if (!(Math.abs(area / 2) >= 1)) return 'outline encloses no area';
  if (!isNum(r.pitch) || r.pitch < 0 || r.pitch > MAX_ROOF_PITCH) return `pitch must be 0 to ${MAX_ROOF_PITCH}`;
  if (!isNum(r.overhang) || r.overhang < 0) return 'overhang must not be negative';
  if (!isNum(r.thickness) || r.thickness <= 0) return 'thickness must be positive';
  if (!isNum(r.fascia) || r.fascia < 0) return 'fascia must not be negative';
  if (!isNum(r.ridgeAngle) || !isNum(r.bearingOffset)) return 'needs a numeric ridge angle and bearing offset';
  return null;
}

/** Why a column cannot be used (a non-positive size, top not above base, a non-finite number), or null. */
export function columnProblem(c: Pick<Column, 'at' | 'width' | 'depth' | 'rotation' | 'base' | 'top'>): string | null {
  if (!isPoint(c.at)) return 'needs a position';
  if (!isNum(c.width) || c.width <= 0 || !isNum(c.depth) || c.depth <= 0) return 'width and depth must be positive';
  if (!isNum(c.rotation)) return 'needs a rotation';
  if (!isNum(c.base) || !isNum(c.top)) return 'needs a base and a top';
  if (!(c.top > c.base)) return 'the top must be above the base';
  return null;
}

/**
 * Roofs read field by field: an unknown shape, an unusable outline or an out-of-range size drops
 * the roof (with a console warning naming it); a missing phase or finish gets its default.
 */
function migrateRoofs(raw: Json, where: string): Level['roofs'] {
  const out: Level['roofs'] = {};
  for (const [rid, r] of Object.entries(raw)) {
    const drop = (why: string) => console.warn(`HomePlan: ${where}: dropped roof ${rid}: ${why}`);
    if (!isObject(r)) {
      drop('not an object');
      continue;
    }
    if (typeof r.shape !== 'string' || !ROOF_SHAPES.has(r.shape)) {
      drop(`unknown shape ${String(r.shape)}`);
      continue;
    }
    const problem = roofProblem(r as unknown as Roof);
    if (problem) {
      drop(problem);
      continue;
    }
    const roof = pick(r, ROOF_KEYS);
    roof.id = rid;
    roof.shape = r.shape as RoofShape;
    roof.outline = (r.outline as Vec2[]).map((p) => ({ x: p.x, y: p.y }));
    roof.phase = phaseOf(r.phase);
    roof.finish = r.finish === 'shingle' ? 'shingle' : 'metal';
    put(roof, 'color', isHexColor(r.color) ? r.color.toLowerCase() : undefined);
    out[rid] = roof as unknown as Roof;
  }
  return out;
}

/** The plan's site: north angle, grade points and columns (broken entries are dropped). */
function migrateSite(raw: unknown): Site {
  const src = isObject(raw) ? raw : {};
  const site = pick(src, SITE_KEYS);
  site.northAngle = isNum(src.northAngle) ? src.northAngle : 0;
  const points: Record<Id, GradePoint> = {};
  for (const [id, g] of Object.entries(isObject(src.gradePoints) ? src.gradePoints : {})) {
    if (!isObject(g) || !isPoint(g.at) || !isNum(g.elevation)) continue;
    const gp = pick(g, GRADE_POINT_KEYS);
    gp.id = id;
    gp.at = { x: g.at.x, y: g.at.y };
    points[id] = gp as unknown as GradePoint;
  }
  site.gradePoints = points;
  const columns: Record<Id, Column> = {};
  for (const [id, c] of Object.entries(isObject(src.columns) ? src.columns : {})) {
    if (!isObject(c) || !isPoint(c.at) || !isNum(c.width) || c.width <= 0 || !isNum(c.depth) || c.depth <= 0) continue;
    if (!isNum(c.base) || !isNum(c.top) || c.top <= c.base) continue;
    const col = pick(c, COLUMN_KEYS);
    col.id = id;
    col.at = { x: c.at.x, y: c.at.y };
    col.rotation = isNum(c.rotation) ? c.rotation : 0;
    col.kind = c.kind === 'chimney' ? 'chimney' : 'post';
    col.phase = phaseOf(c.phase);
    columns[id] = col as unknown as Column;
  }
  site.columns = columns;
  return site as unknown as Site;
}

/**
 * An underlay with a usable image and placement; missing opacity, rotation and lock get defaults.
 * A broken one is dropped rather than failing the whole file.
 */
function migrateUnderlay(raw: unknown): Underlay | undefined {
  if (!isObject(raw) || !isPoint(raw.origin)) return undefined;
  const u = pick(raw, UNDERLAY_KEYS);
  u.origin = { x: raw.origin.x, y: raw.origin.y };
  u.rotation = isNum(raw.rotation) ? normalizeRotation(raw.rotation) : 0;
  u.opacity = isNum(raw.opacity) ? Math.min(1, Math.max(0, raw.opacity)) : 0.6;
  u.locked = typeof raw.locked === 'boolean' ? raw.locked : false;
  return isValidUnderlay(u as unknown as Underlay) ? (u as unknown as Underlay) : undefined;
}

function migrateLevel(raw: unknown, id: string): Level {
  if (!isObject(raw)) fail(`level ${id} is not an object`);
  const where = `level ${id}`;
  const nodes = migrateNodes(record(raw.nodes, `${where} nodes`), where);
  const walls = migrateWalls(record(raw.walls, `${where} walls`), nodes, where);
  const level = pick(raw, LEVEL_KEYS);
  level.id = id;
  level.name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Level';
  level.wallHeight = isNum(raw.wallHeight) && raw.wallHeight > 0 ? raw.wallHeight : 96;
  level.floorThickness = isNum(raw.floorThickness) && raw.floorThickness >= 0 ? raw.floorThickness : 12;
  level.nodes = nodes;
  level.walls = walls;
  level.openings = migrateOpenings(record(raw.openings, `${where} openings`), walls);
  level.rooms = migrateRooms(record(raw.rooms, `${where} rooms`));
  level.stairs = migrateStairs(record(raw.stairs, `${where} stairs`));
  level.roofs = migrateRoofs(record(raw.roofs, `${where} roofs`), where);
  put(level, 'underlay', migrateUnderlay(raw.underlay));
  return level as unknown as Level;
}

function migrateSettings(raw: Json): PlanSettings {
  const out = pick(raw, SETTINGS_KEYS);
  const d = DEFAULT_SETTINGS;
  const num = (k: keyof PlanSettings, ok: (v: number) => boolean) => {
    const v = raw[k];
    out[k] = isNum(v) && ok(v) ? v : d[k];
  };
  num('snapGrid', (v) => v >= 0);
  num('displayGrid', (v) => v > 0);
  num('precisionDenominator', (v) => [1, 2, 4, 8, 16].includes(v));
  num('defaultExteriorThickness', (v) => v > 0);
  num('defaultInteriorThickness', (v) => v > 0);
  // Older files also carry orthoLock and measureTo; those are editor preferences now (uiStore),
  // so they are not in SETTINGS_KEYS and drop out here.
  return out as unknown as PlanSettings;
}

/** Validate (loosely) and upgrade a parsed JSON document to the current Plan schema. */
export function migrate(json: unknown): Plan {
  if (!isObject(json)) fail('expected a JSON object');
  if (json.schemaVersion === undefined) fail('missing schemaVersion');
  let doc: Json = json;
  let version = doc.schemaVersion;
  if (!isNum(version) || !Number.isInteger(version) || version < 0 || version > SCHEMA_VERSION) {
    fail(`unsupported schemaVersion ${String(version)} (expected ${SCHEMA_VERSION} or older)`);
  }
  while ((version as number) < SCHEMA_VERSION) {
    const step = MIGRATIONS[version as number];
    if (!step) fail(`no upgrade from schemaVersion ${String(version)}`);
    doc = step(doc);
    version = doc.schemaVersion;
  }
  if (!Array.isArray(doc.levelOrder) || doc.levelOrder.length === 0) fail('levelOrder must be a non-empty array');
  const rawLevels = record(doc.levels, 'levels');
  const levels: Record<string, Level> = {};
  for (const id of doc.levelOrder) {
    if (typeof id !== 'string') fail('levelOrder must contain level ids');
    if (!(id in rawLevels)) fail(`level ${id} is listed in levelOrder but missing`);
    if (id in levels) fail(`level ${id} is listed twice in levelOrder`);
    levels[id] = migrateLevel(rawLevels[id], id);
  }
  const plan = pick(doc, PLAN_KEYS);
  plan.schemaVersion = SCHEMA_VERSION;
  plan.id = typeof doc.id === 'string' && doc.id ? doc.id : newId();
  plan.name = typeof doc.name === 'string' && doc.name.trim() ? doc.name : 'Untitled plan';
  plan.levelOrder = [...(doc.levelOrder as string[])];
  plan.levels = levels;
  plan.baseFloorElevation = isNum(doc.baseFloorElevation) ? doc.baseFloorElevation : 0;
  plan.settings = migrateSettings(record(doc.settings, 'settings'));
  plan.site = migrateSite(doc.site);
  plan.modifiedAt = typeof doc.modifiedAt === 'string' ? doc.modifiedAt : new Date().toISOString();
  return plan as unknown as Plan;
}
