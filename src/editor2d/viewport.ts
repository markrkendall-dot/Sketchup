import { boundsOf, type Bounds } from '../model/geometry';
import { underlayCorners } from '../model/underlay';
import type { Level, Vec2 } from '../model/types';
import type { Viewport } from '../store/uiStore';

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 40;
/** Default scale: 0.5 px per inch (a 30' wall is 180 px). */
export const DEFAULT_ZOOM = 0.5;

export interface Size {
  width: number;
  height: number;
}

/** Screen point relative to the svg's top-left -> world inches. */
export function screenToWorld(v: Viewport, p: Vec2): Vec2 {
  return { x: (p.x - v.tx) / v.k, y: (p.y - v.ty) / v.k };
}

export function worldToScreen(v: Viewport, p: Vec2): Vec2 {
  return { x: p.x * v.k + v.tx, y: p.y * v.k + v.ty };
}

/** Zoom by `factor` keeping the world point under `screenPoint` fixed. */
export function zoomAt(v: Viewport, screenPoint: Vec2, factor: number): Viewport {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
  const f = k / v.k;
  return {
    k,
    tx: screenPoint.x - (screenPoint.x - v.tx) * f,
    ty: screenPoint.y - (screenPoint.y - v.ty) * f,
  };
}

/** Viewport that fits `bounds` (world) into a screen area of `size`, with padding in px. */
export function fitToBounds(bounds: Bounds, size: Size, padding = 60): Viewport {
  const w = Math.max(bounds.maxX - bounds.minX, 1);
  const h = Math.max(bounds.maxY - bounds.minY, 1);
  const availW = Math.max(size.width - 2 * padding, 1);
  const availH = Math.max(size.height - 2 * padding, 1);
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(availW / w, availH / h)));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { k, tx: size.width / 2 - cx * k, ty: size.height / 2 - cy * k };
}

/** Initial view: DEFAULT_ZOOM with the world origin a third of the way in from the top-left. */
export function initialViewport(size: Size): Viewport {
  return { k: DEFAULT_ZOOM, tx: Math.round(size.width / 3), ty: Math.round(size.height / 3) };
}

/** Visible world rectangle. */
export function visibleBounds(v: Viewport, size: Size): Bounds {
  const a = screenToWorld(v, { x: 0, y: 0 });
  const b = screenToWorld(v, { x: size.width, y: size.height });
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}

/**
 * Fit the nodes of a level, its door swings, and its image underlay (unless `withUnderlay` is
 * false), or null if there is nothing to fit. Never zooms in past 4 px/inch.
 */
export function fitLevel(level: Level, size: Size, withUnderlay = true): Viewport | null {
  const points: Vec2[] = Object.values(level.nodes);
  if (withUnderlay && level.underlay) points.push(...underlayCorners(level.underlay));
  // A door's swing can reach a door width beyond its wall (a front door opening outward).
  for (const o of Object.values(level.openings)) {
    const w = level.walls[o.wallId];
    const a = w && level.nodes[w.a];
    const b = w && level.nodes[w.b];
    if (o.type !== 'door' || !a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = { x: d.y, y: -d.x };
    const side = o.swing?.side === 'right' ? -1 : 1;
    const c = { x: a.x + d.x * o.offset, y: a.y + d.y * o.offset };
    const reach = (w.thickness / 2 + o.width) * side;
    points.push({ x: c.x + n.x * reach, y: c.y + n.y * reach });
  }
  const b = boundsOf(points);
  if (!b) return null;
  const v = fitToBounds(b, size);
  if (v.k <= 4) return v;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return { k: 4, tx: size.width / 2 - cx * 4, ty: size.height / 2 - cy * 4 };
}
