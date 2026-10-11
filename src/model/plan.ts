import { nanoid } from 'nanoid';
import { dist, projectPointToSegment } from './geometry';
import { clampOpeningOffset, openingInterval } from './openings';
import type { Id, Level, Plan, PlanSettings, Vec2, Wall } from './types';

export const SCHEMA_VERSION = 1 as const;
/** Nodes closer than this are the same node; see docs/DESIGN.md "Walls are a graph". */
export const MERGE_EPS = 0.5;

export const newId = (): Id => nanoid(10);

export const DEFAULT_SETTINGS: PlanSettings = {
  snapGrid: 1,
  displayGrid: 12,
  precisionDenominator: 16,
  defaultExteriorThickness: 6.5,
  defaultInteriorThickness: 4.5,
  orthoLock: true,
  measureTo: 'center',
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
  };
}

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

/** Clamp the offsets of every opening on a wall (or on all walls when wallId is omitted). */
export function clampOpenings(level: Level, wallId?: Id): void {
  for (const o of Object.values(level.openings)) {
    if (wallId !== undefined && o.wallId !== wallId) continue;
    const wall = level.walls[o.wallId];
    if (!wall) continue;
    const [s0, s1] = openingInterval(wallLength(level, wall));
    const next = clampOpeningOffset(o.offset, o.width, s0, s1);
    // Assign only on change so immer keeps untouched openings' identity.
    if (Math.abs(next - o.offset) > 1e-9) o.offset = next;
  }
}

function deleteWallInPlace(level: Level, wallId: Id): void {
  delete level.walls[wallId];
  for (const o of Object.values(level.openings)) if (o.wallId === wallId) delete level.openings[o.id];
}

/**
 * Restore the planar-graph invariant on a (draft) level, in place:
 * merge nodes within MERGE_EPS, drop zero-length and duplicate walls, split walls at nodes lying
 * on their interior, and remove nodes with no walls. Nodes in `moved` are absorbed into
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
      const keepWall = level.walls[prev];
      const len = wallLength(level, keepWall);
      for (const o of Object.values(level.openings)) {
        if (o.wallId !== w.id) continue;
        o.wallId = prev;
        if (keepWall.a !== w.a) o.offset = len - o.offset;
      }
      delete level.walls[w.id];
      clampOpenings(level, prev);
    } else seen.set(key, w.id);
  }

  // 3. Split walls at nodes lying on their interior.
  for (let guard = 0; guard < 1000; guard++) {
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
        if (headExists && tailExists) {
          deleteWallInPlace(level, w.id);
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

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function fail(msg: string): never {
  throw new Error(`Not a valid HomePlan file: ${msg}`);
}

function record(v: unknown, where: string): Json {
  if (v === undefined) return {};
  if (!isObject(v)) fail(`${where} must be an object`);
  return v;
}

function migrateLevel(raw: unknown, id: string): Level {
  if (!isObject(raw)) fail(`level ${id} is not an object`);
  const nodes = record(raw.nodes, `level ${id} nodes`);
  const walls = record(raw.walls, `level ${id} walls`);
  for (const [nid, n] of Object.entries(nodes)) {
    if (!isObject(n) || !isNum(n.x) || !isNum(n.y)) fail(`node ${nid} needs numeric x and y`);
  }
  for (const [wid, w] of Object.entries(walls)) {
    if (!isObject(w) || typeof w.a !== 'string' || typeof w.b !== 'string')
      fail(`wall ${wid} needs node ids a and b`);
    if (!(w.a in nodes) || !(w.b in nodes)) fail(`wall ${wid} references a missing node`);
    if (!isNum(w.thickness) || w.thickness <= 0) fail(`wall ${wid} needs a positive thickness`);
  }
  return {
    ...(raw as unknown as Level),
    id,
    name: typeof raw.name === 'string' ? raw.name : 'Level',
    wallHeight: isNum(raw.wallHeight) ? raw.wallHeight : 96,
    floorThickness: isNum(raw.floorThickness) ? raw.floorThickness : 12,
    nodes: nodes as Level['nodes'],
    walls: walls as Level['walls'],
    openings: record(raw.openings, `level ${id} openings`) as Level['openings'],
    rooms: record(raw.rooms, `level ${id} rooms`) as Level['rooms'],
    stairs: record(raw.stairs, `level ${id} stairs`) as Level['stairs'],
  };
}

/** Validate (loosely) and upgrade a parsed JSON document to the current Plan schema. */
export function migrate(json: unknown): Plan {
  if (!isObject(json)) fail('expected a JSON object');
  if (json.schemaVersion === undefined) fail('missing schemaVersion');
  if (json.schemaVersion !== SCHEMA_VERSION) {
    fail(`unsupported schemaVersion ${String(json.schemaVersion)} (expected ${SCHEMA_VERSION})`);
  }
  if (!Array.isArray(json.levelOrder) || json.levelOrder.length === 0)
    fail('levelOrder must be a non-empty array');
  const rawLevels = record(json.levels, 'levels');
  const levels: Record<string, Level> = {};
  for (const id of json.levelOrder) {
    if (typeof id !== 'string') fail('levelOrder must contain level ids');
    if (!(id in rawLevels)) fail(`level ${id} is listed in levelOrder but missing`);
    levels[id] = migrateLevel(rawLevels[id], id);
  }
  const settings = record(json.settings, 'settings');
  return {
    schemaVersion: SCHEMA_VERSION,
    id: typeof json.id === 'string' ? json.id : newId(),
    name: typeof json.name === 'string' ? json.name : 'Untitled plan',
    levelOrder: [...(json.levelOrder as string[])],
    levels,
    baseFloorElevation: isNum(json.baseFloorElevation) ? json.baseFloorElevation : 0,
    settings: { ...DEFAULT_SETTINGS, ...(settings as Partial<PlanSettings>) },
    modifiedAt: typeof json.modifiedAt === 'string' ? json.modifiedAt : new Date().toISOString(),
  };
}
