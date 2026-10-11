import { boundsOf, pointInPolygon, projectPointToSegment } from '../model/geometry';
import type { Vec2 } from '../model/types';

// Pole of inaccessibility (Mapbox polylabel): the point inside a polygon farthest from its edges,
// the centre of the largest inscribed circle. Room labels go there (rooms.ts labelPoint), so an
// L-shaped room's label sits in the middle of its fatter arm instead of on the concave corner.
//
// Square cells cover the polygon; each knows the distance d from its centre to the boundary
// (negative outside) and the most any point in it could reach, d + half its diagonal. Cells come
// off a queue by that bound, best first; a cell that cannot beat the best centre so far by more
// than `precision` is dropped, any other is split in four. Pure.

/** Signed distance from p to the polygon's boundary: positive inside, negative outside. */
export function pointToPolygonDistance(p: Vec2, poly: readonly Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    d = Math.min(d, projectPointToSegment(p, a, b).distance);
  }
  if (!Number.isFinite(d)) return -Infinity;
  return pointInPolygon(p, poly) ? d : -d;
}

interface Cell {
  x: number;
  y: number;
  /** Half the cell's side. */
  h: number;
  /** Distance from the centre to the boundary (negative outside). */
  d: number;
  /** Best distance any point in the cell could have. */
  max: number;
}

function cell(x: number, y: number, h: number, poly: readonly Vec2[]): Cell {
  const d = pointToPolygonDistance({ x, y }, poly);
  return { x, y, h, d, max: d + h * Math.SQRT2 };
}

/** A binary max-heap of cells by `max`. */
class CellQueue {
  private items: Cell[] = [];
  get length(): number {
    return this.items.length;
  }
  push(c: Cell): void {
    const a = this.items;
    a.push(c);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].max >= a[i].max) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop(): Cell | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].max > a[m].max) m = l;
        if (r < a.length && a[r].max > a[m].max) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** The area-weighted centroid as the first guess (often already the answer for convex shapes). */
function centroidCell(poly: readonly Vec2[]): Cell {
  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const f = a.x * b.y - b.x * a.y;
    x += (a.x + b.x) * f;
    y += (a.y + b.y) * f;
    area += f * 3;
  }
  if (Math.abs(area) < 1e-12) return cell(poly[0].x, poly[0].y, 0, poly);
  return cell(x / area, y / area, 0, poly);
}

export interface Pole {
  point: Vec2;
  /** Distance from the point to the nearest edge (the inscribed circle's radius). */
  distance: number;
}

/**
 * The pole of inaccessibility of a simple polygon, to within `precision` inches. The search stops
 * after `maxCells` cells have been examined (a bail-out for small or awkward polygons; the best
 * point so far is returned, which is always inside when any examined centre was).
 */
export function polylabel(poly: readonly Vec2[], precision = 1, maxCells = 200): Pole {
  const b = boundsOf(poly);
  if (!b || poly.length < 3) return { point: poly[0] ?? { x: 0, y: 0 }, distance: 0 };
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  const size = Math.min(width, height);
  if (size <= 0) return { point: { x: b.minX, y: b.minY }, distance: 0 };
  const h = size / 2;

  const queue = new CellQueue();
  for (let x = b.minX; x < b.maxX; x += size) {
    for (let y = b.minY; y < b.maxY; y += size) queue.push(cell(x + h, y + h, h, poly));
  }
  let best = centroidCell(poly);
  const boxCentre = cell(b.minX + width / 2, b.minY + height / 2, 0, poly);
  if (boxCentre.d > best.d) best = boxCentre;

  let examined = 0;
  while (queue.length > 0 && examined < maxCells) {
    const c = queue.pop()!;
    examined++;
    if (c.d > best.d) best = c;
    // Nothing in this cell can beat the best by more than the precision: do not split it.
    if (c.max - best.d <= precision) continue;
    const q = c.h / 2;
    queue.push(cell(c.x - q, c.y - q, q, poly));
    queue.push(cell(c.x + q, c.y - q, q, poly));
    queue.push(cell(c.x - q, c.y + q, q, poly));
    queue.push(cell(c.x + q, c.y + q, q, poly));
  }
  return { point: { x: best.x, y: best.y }, distance: best.d };
}
