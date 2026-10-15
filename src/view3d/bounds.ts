import { DECK } from '../derive/decks';
import { getLevelElevations } from '../derive/levels';
import { roofBearing, roofExtremes, roofOutlineWithOverhang } from '../derive/roofs';
import { chimneyPartBoxes, columnOutline, columnPeak, fallbackElevation, terrainHeightAt } from '../derive/site';
import { getFaces } from '../derive/rooms';
import type { Id, Level, Plan, Vec2 } from '../model/types';

export interface Box3d {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * The nodes of the walls that close the level's main building: its faces joined into buildings by
 * the nodes they share, the one with the most floor area. A free-standing wall (a retaining wall, a
 * garden wall running off across the site) closes nothing and an outbuilding (a shed across the
 * lawn) is another building, so neither zooms the house out of the frame or stretches the sun's
 * shadow map; a level whose walls close nothing gives all its nodes.
 */
function houseNodes(level: Level): Vec2[] {
  const faces = getFaces(level, 'all').faces;
  if (!faces.length) return Object.values(level.nodes);
  const parent = faces.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const firstFace = new Map<Id, number>();
  faces.forEach((f, i) => {
    for (const n of f.nodeIds) {
      const j = firstFace.get(n);
      if (j === undefined) firstFace.set(n, i);
      else parent[find(i)] = find(j);
    }
  });
  const area = new Map<number, number>();
  faces.forEach((f, i) => area.set(find(i), (area.get(find(i)) ?? 0) + f.grossArea));
  let main = find(0);
  for (const [root, a] of area) if (a > (area.get(main) ?? 0)) main = root;
  const ids = new Set<Id>();
  faces.forEach((f, i) => {
    if (find(i) !== main) return;
    for (const wid of f.wallIds) {
      const w = level.walls[wid];
      if (w) ids.add(w.a).add(w.b);
    }
  });
  return [...ids].flatMap((id) => (level.nodes[id] ? [level.nodes[id]] : []));
}

/**
 * Bounding box of the given levels in three coordinates (x, Y up, plan y): the nodes of the walls
 * that close the main building's rooms (houseNodes), the roof overhangs and decks that reach that
 * building's extent in plan (not an outbuilding's roof) and the site's columns, from the lowest slab
 * bottom to the highest ceiling, roof top or deck railing (a capped chimney's cap, 2" proud, and its
 * spark arrestor, 12" above the top, included), and the terrain's height over the house area
 * (never its 100' margin). An empty plan gives a 20' box at the origin.
 */
export function planBox(plan: Plan, levelIds: readonly Id[] = plan.levelOrder): Box3d {
  const elev = getLevelElevations(plan);
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  // The main building's walls first: a roof or deck whose plan extent misses them belongs to an
  // outbuilding and is left out too. Without walls everything counts.
  const house: Vec2[] = [];
  for (const id of levelIds) {
    const level = plan.levels[id];
    if (level && elev[id]) house.push(...houseNodes(level));
  }
  const houseMin = { x: Math.min(...house.map((p) => p.x)), y: Math.min(...house.map((p) => p.y)) };
  const houseMax = { x: Math.max(...house.map((p) => p.x)), y: Math.max(...house.map((p) => p.y)) };
  const near = (pts: readonly Vec2[]): boolean =>
    !house.length || (Math.max(...pts.map((p) => p.x)) >= houseMin.x && Math.min(...pts.map((p) => p.x)) <= houseMax.x && Math.max(...pts.map((p) => p.y)) >= houseMin.y && Math.min(...pts.map((p) => p.y)) <= houseMax.y);
  const grow = (p: Vec2) => {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.y);
    maxZ = Math.max(maxZ, p.y);
  };
  house.forEach(grow);
  for (const id of levelIds) {
    const level = plan.levels[id];
    const e = elev[id];
    if (!level || !e) continue;
    minY = Math.min(minY, e.slabBottom);
    maxY = Math.max(maxY, e.ceiling);
    for (const roof of Object.values(level.roofs ?? {})) {
      const pts = roofOutlineWithOverhang(roof);
      if (!near(pts)) continue;
      pts.forEach(grow);
      maxY = Math.max(maxY, e.floorTop + roofExtremes(roof, roofBearing(level.wallHeight, roof)).ridge + roof.thickness);
    }
    for (const deck of Object.values(level.decks ?? {})) {
      if (!near(deck.outline)) continue;
      deck.outline.forEach(grow);
      maxY = Math.max(maxY, e.floorTop + deck.elevation + DECK.railHeight);
    }
  }
  for (const c of Object.values(plan.site.columns)) {
    [...columnOutline(c), ...chimneyPartBoxes(c).flatMap((b) => b.outline)].forEach(grow);
    minY = Math.min(minY, c.base);
    maxY = Math.max(maxY, columnPeak(c));
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minZ = 0;
    maxX = 240;
    maxZ = 240;
  }
  if (!Number.isFinite(minY)) {
    minY = 0;
    maxY = 96;
  }
  // The ground over the house area, sampled on a coarse grid (terrain, not its margin).
  if (Object.keys(plan.site.gradePoints).length) {
    const fallback = fallbackElevation(plan);
    const N = 6;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const h = terrainHeightAt(plan.site, { x: minX + ((maxX - minX) * i) / N, y: minZ + ((maxZ - minZ) * j) / N }, fallback);
        minY = Math.min(minY, h);
        maxY = Math.max(maxY, h);
      }
    }
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

type Xyz = [number, number, number];

/** A directional light's orthographic shadow camera fitted round a box (Scene3D's sun). */
export interface ShadowFit {
  /** The light's target: the box centre. */
  target: Xyz;
  /** The light: twice the box's radius from the centre, toward the sun. */
  position: Xyz;
  /** Half the side of the square frustum, across the light's axis. */
  half: number;
  /** Depth range of the frustum, measured from the light. */
  near: number;
  far: number;
}

/**
 * Fit the sun's shadow camera round a box: target at the box centre, the light 2r out along the
 * sun direction (r the radius of the box's bounding sphere), a square frustum 1.1r either side of
 * the axis. Everything that casts a shadow is inside the sphere, so from r/2 deep; to the far side
 * of the sphere plus how far down the sun's ray a shadow can fall past it (twice the radius over
 * the sine of the sun's elevation, which is clamped so a low sun stays finite), so the house's
 * shadow on ground lower than the box is kept.
 */
export function sunShadowFit(box: Box3d, sun: readonly [number, number, number]): ShadowFit {
  const target: Xyz = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
  const r = Math.max(1, 0.5 * Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]));
  const len = Math.hypot(sun[0], sun[1], sun[2]) || 1;
  const dir: Xyz = [sun[0] / len, sun[1] / len, sun[2] / len];
  const half = 1.1 * r;
  return {
    target,
    position: [target[0] + dir[0] * 2 * r, target[1] + dir[1] * 2 * r, target[2] + dir[2] * 2 * r],
    half,
    near: r / 2,
    far: 2 * r + half + (2 * r) / Math.max(0.25, dir[1]),
  };
}
