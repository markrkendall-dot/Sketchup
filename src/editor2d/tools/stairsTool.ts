import { normalizeDegrees, orthoDirection, STAIRS_DEFAULTS } from '../../derive/stairs';
import { dist, sub } from '../../model/geometry';
import type { Vec2 } from '../../model/types';
import { EMPTY_SELECTION } from '../../store/uiStore';
import type { Tool, ToolContext, ToolPointerEvent } from './index';

/** Screen distance the pointer has to travel before its heading sets the stairs direction. */
const AIM_PX = 8;

const DIRECTION_NAME: Record<number, string> = { 0: 'right', 90: 'down', 180: 'left', 270: 'up' };

// Where the last heading was measured from (screen px), so slow moves still accumulate.
let aimFrom: Vec2 | null = null;

function preview(ctx: ToolContext, e: ToolPointerEvent | null, direction: number): void {
  const ui = ctx.ui();
  const cursor = e?.world ?? ui.draft.cursor;
  if (!cursor) {
    ui.patchDraft({ stairsPreview: null, stairsDirection: direction });
    return;
  }
  const snap = ctx.snap(cursor, { shift: e?.shiftKey ?? false });
  ui.patchDraft({
    cursor,
    snap,
    stairsDirection: direction,
    stairsPreview: { origin: snap.point, direction },
  });
}

/**
 * Stairs tool (T): the ghost follows the snapped cursor with its bottom edge centered on it, running
 * in the direction the mouse last moved (one of the four axes). Click places a 36" x 10' flight in
 * the toolbar's phase that cuts the floor above; Tab / Shift+Tab turn it by 90 degrees.
 */
export const stairsTool: Tool = {
  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    const ui = ctx.ui();
    preview(ctx, e, ui.draft.stairsDirection);
    const pv = ctx.ui().draft.stairsPreview;
    if (!pv) return;
    const id = ctx.actions.addStairs(ctx.levelId, {
      origin: pv.origin,
      direction: pv.direction,
      width: STAIRS_DEFAULTS.width,
      run: STAIRS_DEFAULTS.run,
      phase: ui.drawPhase,
      cutsFloorAbove: true,
    });
    if (id) {
      ui.setSelection({ ...EMPTY_SELECTION, stairs: [id] });
      ui.patchDraft({ error: false, message: `Stairs placed, going up to the ${DIRECTION_NAME[pv.direction] ?? 'side'}.` });
    } else ui.patchDraft({ error: true, message: 'Could not place stairs here.' });
  },

  onPointerMove(e, ctx) {
    let direction = ctx.ui().draft.stairsDirection;
    if (!aimFrom) aimFrom = e.screen;
    else if (dist(e.screen, aimFrom) >= AIM_PX) {
      direction = orthoDirection(sub(e.screen, aimFrom));
      aimFrom = e.screen;
    }
    preview(ctx, e, direction);
  },

  onPointerUp() {},
  onDoubleClick() {},

  onKeyDown(e, ctx) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const ui = ctx.ui();
    if (e.key === 'Tab') {
      const direction = normalizeDegrees(ui.draft.stairsDirection + (e.shiftKey ? -90 : 90));
      preview(ctx, null, direction);
      return true;
    }
    if (e.key === 'Escape' && ui.draft.message) {
      ui.patchDraft({ error: false, message: null });
      return true;
    }
    return false;
  },

  cancel(ctx) {
    aimFrom = null;
    ctx.ui().patchDraft({ stairsPreview: null, snap: null });
  },
};
