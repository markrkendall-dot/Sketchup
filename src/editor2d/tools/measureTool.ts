import { getFootprints } from '../../derive/footprint';
import { dist } from '../../model/geometry';
import type { Vec2 } from '../../model/types';
import { formatLength } from '../../model/units';
import type { SnapResult } from '../../store/uiStore';
import { faceSnapSources, snapFaceCorner, snapFaceEdge } from '../snap';
import type { Tool, ToolContext, ToolPointerEvent } from './index';

// Measure tool (M, docs/REVIEW-2.md B3): click two points; the overlay shows the distance and its
// x and y parts, and the status bar keeps "Measured ..." until Esc or the next measurement. Nothing
// in the plan changes.

/** `12'-6" (dx 10'-0", dy 7'-6")`. */
export function measureText(a: Vec2, b: Vec2, denom: number): string {
  return `${formatLength(dist(a, b), denom)} (dx ${formatLength(Math.abs(b.x - a.x), denom)}, dy ${formatLength(Math.abs(b.y - a.y), denom)})`;
}

/**
 * Snap for measuring: wall-face corners (the inside corners of rooms, what a tape measure reads)
 * and nodes, whichever is nearer; then midpoints, points on walls and the level below; then points
 * on wall faces; then guides and the grid. No ortho lock.
 */
export function measureSnap(ctx: ToolContext, raw: Vec2, shift: boolean): SnapResult {
  const ui = ctx.ui();
  const level = ctx.level();
  const k = ui.viewport.k;
  const src = faceSnapSources(getFootprints(level, ui.viewMode), level.walls);
  const corner = snapFaceCorner(raw, src, k);
  const std = ctx.snap(raw, { from: null, shift });
  const strong = std.kind === 'node' || std.kind === 'ghost-node';
  if (corner && !(strong && dist(std.point, raw) < dist(corner.point, raw))) return corner;
  if (std.kind !== 'grid' && std.kind !== 'guide' && std.kind !== 'none') return std;
  return snapFaceEdge(raw, src, k) ?? std;
}

function preview(ctx: ToolContext, e: ToolPointerEvent): SnapResult {
  const snap = measureSnap(ctx, e.world, e.shiftKey);
  ctx.ui().patchDraft({ cursor: e.world, snap });
  return snap;
}

export const measureTool: Tool = {
  onPointerDown(e, ctx) {
    const ui = ctx.ui();
    if (e.button === 2) {
      ui.patchDraft({ measure: null, message: null, error: false });
      return;
    }
    if (e.button !== 0) return;
    const p = preview(ctx, e).point;
    const m = ui.draft.measure;
    if (!m || m.b) {
      // First point (a third click starts a new measurement).
      ui.patchDraft({ measure: { a: p, b: null }, message: null, error: false });
      return;
    }
    if (dist(m.a, p) < 1e-6) return;
    ui.patchDraft({
      measure: { a: m.a, b: p },
      message: `Measured ${measureText(m.a, p, ctx.plan().settings.precisionDenominator)}`,
      error: false,
    });
  },

  onPointerMove(e, ctx) {
    preview(ctx, e);
  },

  onPointerUp() {},

  onDoubleClick() {},

  onKeyDown(e, ctx) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key !== 'Escape') return false;
    const ui = ctx.ui();
    if (!ui.draft.measure && !ui.draft.message) return false;
    ui.patchDraft({ measure: null, message: null, error: false });
    return true;
  },

  cancel(ctx) {
    ctx.ui().patchDraft({ measure: null, snap: null });
  },
};
