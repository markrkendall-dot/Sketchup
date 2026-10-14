import { getFootprints } from '../../derive/footprint';
import { selfIntersects } from '../../derive/rooms';
import { dist } from '../../model/geometry';
import type { Id, Vec2 } from '../../model/types';
import { EMPTY_SELECTION, type SnapResult } from '../../store/uiStore';
import { faceSnapSources, snapFaceCorner, snapFaceEdge, SNAP_RADIUS_PX } from '../snap';
import type { Tool, ToolContext, ToolPointerEvent } from './index';

/**
 * Snap for drawn outlines (roofs, decks, floor openings): wall-outline corners (the footprint fill points, so the
 * outside corners of exterior walls) first, then this level's nodes, then points on the wall faces,
 * then the usual snaps (midpoints, centerlines, level below, guides, grid) with the ortho lock from
 * `from`.
 */
export function outlineSnap(ctx: ToolContext, raw: Vec2, shift: boolean, from: Vec2 | null): SnapResult {
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

/** What an outline tool adds and how it talks about it. */
export interface OutlineToolSpec {
  /** "roof", "deck", "floor opening": in the tool's messages. */
  noun: string;
  /** The selection kind the new element is selected as, and Delete removes. */
  selectionKey: 'roofs' | 'decks' | 'floorOpenings' | 'joistZones';
  /** Add the element over the closed outline; its id, or null when the store refuses it. */
  create(ctx: ToolContext, outline: Vec2[]): Id | null;
  /** The status line once it is added. */
  added(ctx: ToolContext, outline: Vec2[]): string;
  /** Delete the selected elements (Delete or Backspace with no corners drawn). */
  remove(ctx: ToolContext, ids: Id[]): void;
}

/**
 * A tool that draws a closed outline (draft.outlinePoints): click the corners (they snap to the
 * walls' outside faces), close by clicking the first corner, double-clicking or pressing Enter.
 * Backspace removes the last corner, Esc cancels; with no corners, Delete or Backspace removes the
 * selected elements of the tool's kind. The new element is selected and the tool stays active.
 */
export function makeOutlineTool(spec: OutlineToolSpec): Tool {
  const preview = (ctx: ToolContext, e: ToolPointerEvent): SnapResult => {
    const pts = ctx.ui().draft.outlinePoints;
    const snap = outlineSnap(ctx, e.world, e.shiftKey, pts[pts.length - 1] ?? null);
    ctx.ui().patchDraft({ cursor: e.world, snap });
    return snap;
  };

  /** Close the outline drawn so far and add the element; false when it cannot be. */
  const finish = (ctx: ToolContext): boolean => {
    const ui = ctx.ui();
    const outline = ui.draft.outlinePoints;
    if (outline.length < 3) {
      ui.patchDraft({ error: true, message: `A ${spec.noun} needs at least 3 corners.` });
      return false;
    }
    if (selfIntersects(outline)) {
      ui.patchDraft({ error: true, message: 'The outline crosses itself. Backspace removes the last corner.' });
      return false;
    }
    const id = spec.create(ctx, outline);
    if (!id) {
      ui.patchDraft({ error: true, message: `That outline does not make a ${spec.noun}.` });
      return false;
    }
    ui.patchDraft({ outlinePoints: [], error: false, message: spec.added(ctx, outline) });
    ui.setSelection({ ...EMPTY_SELECTION, [spec.selectionKey]: [id] });
    return true;
  };

  return {
    onPointerDown(e, ctx) {
      if (e.button !== 0) return;
      const ui = ctx.ui();
      const snap = preview(ctx, e);
      const pts = ui.draft.outlinePoints;
      if (pts.length >= 3 && dist(snap.point, pts[0]) * ui.viewport.k <= SNAP_RADIUS_PX.node) {
        finish(ctx);
        return;
      }
      if (pts.length && dist(snap.point, pts[pts.length - 1]) < 1e-6) return;
      ui.patchDraft({
        outlinePoints: [...pts, snap.point],
        error: false,
        message: pts.length >= 2 ? `Click the first corner or press Enter to close the ${spec.noun} outline.` : null,
      });
    },

    onPointerMove(e, ctx) {
      preview(ctx, e);
    },

    onPointerUp() {},

    onDoubleClick(_e, ctx) {
      if (ctx.ui().draft.outlinePoints.length >= 3) finish(ctx);
    },

    onKeyDown(e, ctx) {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      const ui = ctx.ui();
      const pts = ui.draft.outlinePoints;
      if (e.key === 'Enter' && pts.length) {
        finish(ctx);
        return true;
      }
      if (e.key === 'Backspace' && pts.length) {
        ui.patchDraft({ outlinePoints: pts.slice(0, -1), error: false, message: null });
        return true;
      }
      if (e.key === 'Escape') {
        if (!pts.length && !ui.draft.message) return false;
        ui.patchDraft({ outlinePoints: [], error: false, message: null });
        return true;
      }
      const selected = ui.selection[spec.selectionKey];
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) {
        spec.remove(ctx, selected);
        ui.clearSelection();
        return true;
      }
      return false;
    },

    cancel(ctx) {
      ctx.ui().patchDraft({ outlinePoints: [], snap: null });
    },
  };
}
