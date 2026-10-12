import { sunPosition, type TerrainGrid } from '../derive/site';
import type { ElevationFace, View3dPreset } from '../store/uiStore';
import type { Box3d } from './bounds';

// Elevation views (DESIGN.md "3D"): a straight-on orthographic view of one side of the house, the
// sun that lights it, and the ground cut in front of it. Pure (no three, no React), so the maths
// is tested in node.

type Xyz = [number, number, number];

/**
 * Unit vector from the house toward the viewer of each elevation, in three coordinates (x east,
 * Y up, z = plan y, south). The north elevation is seen from the road side (plan y < 0) looking
 * south (+z), the east one from larger x looking west.
 */
const AXIS: Record<ElevationFace, Xyz> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
};

/** The face takes 1 / ELEVATION_MARGIN of the canvas along its tighter dimension. */
export const ELEVATION_MARGIN = 1.1;
/** The camera stands this far (inches) in front of the box: orthographic, so only the near plane cares. */
export const ELEVATION_STANDOFF = 100;
/** An elevation never shows more than this many inches across (zooming out stops there): inside the sky. */
export const ELEVATION_MAX_SPAN = 24000;
/** The ground cut stands this far (inches) in front of the elevation camera: just past its near plane (1"). */
export const GROUND_CUT_OFFSET = 2;
/** The cut's top is this far above the ground it follows, so no sliver of the underground shows along it. */
export const GROUND_CUT_LIFT = 0.5;
/** The elevation sun: this many degrees to the viewer's left of straight behind them, and this high. */
export const ELEVATION_SUN_LEFT = 30;
export const ELEVATION_SUN_ALTITUDE = 45;
/** As far from the house as the plan's sun (`sunPosition`), in inches. */
const SUN_DISTANCE = Math.hypot(...sunPosition(0));

export interface ElevationFit {
  /** Unit vector from the target toward the camera (horizontal). */
  axis: Xyz;
  position: Xyz;
  /** The box centre, which the camera looks at. */
  target: Xyz;
  /** drei's orthographic zoom: CSS pixels per inch (its frustum is the canvas size in CSS pixels). */
  zoom: number;
  /** The face's size: the box's extents across the view axis (inches). */
  width: number;
  height: number;
}

/**
 * Frame one side of a box straight on in a canvas of `size` CSS pixels: the camera on the box's
 * centre line, `ELEVATION_STANDOFF` in front of the box's near side, looking at the centre with +Y
 * up, zoomed so the face takes 1 / ELEVATION_MARGIN of the canvas width or height, whichever is
 * tighter.
 */
export function elevationFit(box: Box3d, face: ElevationFace, size: { width: number; height: number }): ElevationFit {
  const axis = AXIS[face];
  const target: Xyz = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
  const dx = box.max[0] - box.min[0];
  const dz = box.max[2] - box.min[2];
  const alongX = axis[0] !== 0;
  const width = alongX ? dz : dx;
  const height = box.max[1] - box.min[1];
  const depth = alongX ? dx : dz;
  const zoom = Math.min(
    Math.max(size.width, 1) / (Math.max(width, 1) * ELEVATION_MARGIN),
    Math.max(size.height, 1) / (Math.max(height, 1) * ELEVATION_MARGIN),
  );
  const d = depth / 2 + ELEVATION_STANDOFF;
  return {
    axis: [...axis],
    position: [target[0] + axis[0] * d, target[1], target[2] + axis[2] * d],
    target,
    zoom,
    width,
    height,
  };
}

/**
 * The sun for an elevation (a position like `sunPosition`'s, in inches from the house): behind the
 * viewer, turned ELEVATION_SUN_LEFT degrees to their left and ELEVATION_SUN_ALTITUDE degrees up, so
 * the face is lit and its eaves and reveals throw shadows down and to the right, whichever way the
 * face points.
 */
export function elevationSun(face: ElevationFace): Xyz {
  const [ax, , az] = AXIS[face];
  // The viewer looks along -axis; with +Y up their left is (-az, 0, ax).
  const turn = (ELEVATION_SUN_LEFT * Math.PI) / 180;
  const up = (ELEVATION_SUN_ALTITUDE * Math.PI) / 180;
  const hx = Math.cos(turn) * ax - Math.sin(turn) * az;
  const hz = Math.cos(turn) * az + Math.sin(turn) * ax;
  const flat = Math.cos(up) * SUN_DISTANCE;
  return [hx * flat, Math.sin(up) * SUN_DISTANCE, hz * flat];
}

/** The sun the 3D view uses: the plan's (`sunPosition`, turned with the north angle) in perspective, else the elevation's. */
export function viewSun(preset: View3dPreset, northAngle: number): Xyz {
  return preset === 'perspective' ? sunPosition(northAngle) : elevationSun(preset);
}

/** A vertical strip in three coordinates: positions (x, Y, z), UVs in inches (along it, elevation), triangles. */
export interface GroundCut {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/**
 * The ground of an elevation, cut where the camera stands. The orthographic camera is inside the
 * terrain's area, so the rays of the pixels below the ground line start underground and would show
 * the buried basement walls and the sky under the ground. This strip stands GROUND_CUT_OFFSET in
 * front of the camera (`fit.position`), facing it, from the rendered terrain's height along that
 * line (the grid's two triangles per cell, sampled at every grid line and diagonal it crosses, so
 * the top follows the drawn ground exactly; plus GROUND_CUT_LIFT) down to `reach` below the
 * target, and `reach` to either side (flat past the grid's edge). Like a section through the
 * ground: what is below grade at the camera's plane is hidden, and the ground rising toward the
 * house beyond it still shows.
 */
export function elevationGroundCut(grid: TerrainGrid, fit: Pick<ElevationFit, 'axis' | 'position' | 'target'>, reach = ELEVATION_MAX_SPAN): GroundCut {
  const [ax, , az] = fit.axis;
  // The viewer's right (look x up, look = -axis), and the line the strip stands on.
  const rx = az;
  const rz = -ax;
  const ox = fit.position[0] - ax * GROUND_CUT_OFFSET;
  const oz = fit.position[2] - az * GROUND_CUT_OFFSET;
  const { bounds, step, cellsX, cellsY, positions } = grid;
  const nx = cellsX + 1;
  const height = (i: number, j: number) => positions[(j * nx + i) * 3 + 1];
  // Height on cell (i, j) at fractions (s along x, t along plan y): triangles (a, b, c) for
  // s + t <= 1 and (c, b, d) beyond, a = (i, j), b = (i, j + 1), c = (i + 1, j), as terrainGrid.
  const cellHeight = (i: number, j: number, s: number, t: number) => {
    const ha = height(i, j);
    const hb = height(i, j + 1);
    const hc = height(i + 1, j);
    const hd = height(i + 1, j + 1);
    return s + t <= 1 ? ha + (hc - ha) * s + (hb - ha) * t : hd + (hb - hd) * (1 - s) + (hc - hd) * (1 - t);
  };
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  // The profile along the line, as (offset along the grid axis it runs on, height).
  const profile: { w: number; h: number }[] = [];
  const alongX = rx !== 0;
  if (alongX) {
    // A line of constant plan y across the cells of one row.
    const f = clamp((oz - bounds.minY) / step, 0, cellsY);
    const j = Math.min(cellsY - 1, Math.floor(f));
    const t = f - j;
    for (let i = 0; i < cellsX; i++) {
      profile.push({ w: bounds.minX + i * step, h: cellHeight(i, j, 0, t) });
      if (t > 0 && t < 1) profile.push({ w: bounds.minX + (i + 1 - t) * step, h: cellHeight(i, j, 1 - t, t) });
    }
    profile.push({ w: bounds.minX + cellsX * step, h: cellHeight(cellsX - 1, j, 1, t) });
  } else {
    // A line of constant x down the cells of one column.
    const f = clamp((ox - bounds.minX) / step, 0, cellsX);
    const i = Math.min(cellsX - 1, Math.floor(f));
    const s = f - i;
    for (let j = 0; j < cellsY; j++) {
      profile.push({ w: bounds.minY + j * step, h: cellHeight(i, j, s, 0) });
      if (s > 0 && s < 1) profile.push({ w: bounds.minY + (j + 1 - s) * step, h: cellHeight(i, j, s, 1 - s) });
    }
    profile.push({ w: bounds.minY + cellsY * step, h: cellHeight(i, cellsY - 1, s, 1) });
  }
  // To the viewer's left-to-right offset u from the camera's line of sight, and out to `reach`.
  const sign = alongX ? rx : rz;
  const centre = alongX ? fit.target[0] : fit.target[2];
  const pts = profile.map((p) => ({ u: (p.w - centre) * sign, h: p.h })).sort((a, b) => a.u - b.u);
  if (pts[0].u > -reach) pts.unshift({ u: -reach, h: pts[0].h });
  if (pts[pts.length - 1].u < reach) pts.push({ u: reach, h: pts[pts.length - 1].h });
  const bottom = Math.min(fit.target[1], ...pts.map((p) => p.h)) - reach;
  // Along the line, u measures from the camera's line of sight (the target's lateral position).
  const cx = alongX ? fit.target[0] : ox;
  const cz = alongX ? oz : fit.target[2];
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const { u, h } of pts) {
    const k = pos.length / 3;
    const x = cx + rx * u;
    const z = cz + rz * u;
    pos.push(x, h + GROUND_CUT_LIFT, z, x, bottom, z);
    uv.push(u, h + GROUND_CUT_LIFT, u, bottom);
    // Top and bottom of this point to those of the next, counter-clockwise as the camera sees them.
    if (k) idx.push(k - 2, k - 1, k + 1, k - 2, k + 1, k);
  }
  return { positions: new Float32Array(pos), uvs: new Float32Array(uv), indices: new Uint32Array(idx) };
}
