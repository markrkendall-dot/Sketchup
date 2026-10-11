import { getFootprints } from '../../derive/footprint';
import { ROOF_DEFAULTS } from '../../derive/roofs';
import { selfIntersects } from '../../derive/rooms';
import { boundsOf, dist } from '../../model/geometry';
import type { Vec2 } from '../../model/types';
import { formatLengthCompact } from '../../model/units';
import { EMPTY_SELECTION, type SnapResult } from '../../store/uiStore';
import { faceSnapSources, snapFaceCorner, snapFaceEdge, SNAP_RADIUS_PX } from '../snap';
import type { Tool, ToolContext, ToolPointerEvent } from './index';

/**
 * Snap for roof outlines: wall-outline corners (the footprint fill points, so the outside corners
 * of exterior walls) first, then this level's nodes, then points on the wall faces, then the usual
 * snaps (midpoints, centerlines, level below, guides, grid) with the ortho lock from `from`.
 */
export function roofSnap(ctx: ToolContext, raw: Vec2, shift: boolean, from: Vec2 | null): SnapResult {
  const ui = ctx.ui();
  const level = ctx.level();
  const src = faceSnapSources(getFootprints(level, ui.viewMode), level.walls);
  const k = ui.viewport.k;
  const corner = snapFaceCorner(raw, src, k);
  if (corner) return corner;
  const std = ctx.snap(raw, { from, shift });
  if (std.kind === 'node') return std;
  return snapFaceEdge(raw, src, k) ?? std;
}

function preview(ctx: ToolContext, e: ToolPointerEvent): SnapResult {
  const pts = ctx.ui().draft.roofPoints;
  const snap = roofSnap(ctx, e.world, e.shiftKey, pts[pts.length - 1] ?? null);
  ctx.ui().patchDraft({ cursor: e.world, snap });
  return snap;
}

/** Ridge along the longer side of the outline's bounding box: 0 (along x) or 90 (along y). */
export function defaultRidgeAngle(outline: readonly Vec2[]): number {
  const b = boundsOf(outline);
  return b && b.maxY - b.minY > b.maxX - b.minX ? 90 : 0;
}

/** Close the outline drawn so far and add the roof with the defaults; false when it cannot be. */
function finish(ctx: ToolContext): boolean {
  const ui = ctx.ui();
  const outline = ui.draft.roofPoints;
  if (outline.length < 3) {
    ui.patchDraft({ error: true, message: 'A roof needs at least 3 corners.' });
    return false;
  }
  if (selfIntersects(outline)) {
    ui.patchDraft({ error: true, message: 'The outline crosses itself. Backspace removes the last corner.' });
    return false;
  }
  const id = ctx.actions.addRoof(ctx.levelId, {
    shape: ROOF_DEFAULTS.shape,
    outline,
    ridgeAngle: defaultRidgeAngle(outline),
    pitch: ROOF_DEFAULTS.pitch,
    overhang: ROOF_DEFAULTS.overhang,
    bearingOffset: ROOF_DEFAULTS.bearingOffset,
    thickness: ROOF_DEFAULTS.thickness,
    fascia: ROOF_DEFAULTS.fascia,
    phase: ui.drawPhase,
    finish: ROOF_DEFAULTS.finish,
  });
  if (!id) {
    ui.patchDraft({ error: true, message: 'That outline does not make a roof.' });
    return false;
  }
  const b = boundsOf(outline)!;
  const denom = ctx.plan().settings.precisionDenominator;
  ui.patchDraft({
    roofPoints: [],
    error: false,
    message: `Gable roof added over ${formatLengthCompact(b.maxX - b.minX, denom)} x ${formatLengthCompact(b.maxY - b.minY, denom)}. Set its shape and slope in the properties panel.`,
  });
  ui.setSelection({ ...EMPTY_SELECTION, roofs: [id] });
  return true;
}

/**
 * Roof tool (K): click the corners of the roof outline (they snap to the walls' outside faces),
 * close it by clicking the first corner, double-clicking or pressing Enter. Backspace removes the
 * last corner, Esc cancels. The roof is added as a gable with its ridge along the longer side.
 */
export const roofTool: Tool = {
  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    const ui = ctx.ui();
    const snap = preview(ctx, e);
    const pts = ui.draft.roofPoints;
    if (pts.length >= 3 && dist(snap.point, pts[0]) * ui.viewport.k <= SNAP_RADIUS_PX.node) {
      finish(ctx);
      return;
    }
    if (pts.length && dist(snap.point, pts[pts.length - 1]) < 1e-6) return;
    ui.patchDraft({
      roofPoints: [...pts, snap.point],
      error: false,
      message: pts.length >= 2 ? 'Click the first corner or press Enter to close the roof outline.' : null,
    });
  },

  onPointerMove(e, ctx) {
    preview(ctx, e);
  },

  onPointerUp() {},

  onDoubleClick(_e, ctx) {
    if (ctx.ui().draft.roofPoints.length >= 3) finish(ctx);
  },

  onKeyDown(e, ctx) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const ui = ctx.ui();
    const pts = ui.draft.roofPoints;
    if (e.key === 'Enter' && pts.length) {
      finish(ctx);
      return true;
    }
    if (e.key === 'Backspace' && pts.length) {
      ui.patchDraft({ roofPoints: pts.slice(0, -1), error: false, message: null });
      return true;
    }
    if (e.key === 'Escape') {
      if (!pts.length && !ui.draft.message) return false;
      ui.patchDraft({ roofPoints: [], error: false, message: null });
      return true;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selection.roofs.length) {
      ctx.actions.deleteRoofs(ctx.levelId, ui.selection.roofs);
      ui.clearSelection();
      return true;
    }
    return false;
  },

  cancel(ctx) {
    ctx.ui().patchDraft({ roofPoints: [], snap: null });
  },
};
