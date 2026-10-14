import { floorOpeningSupportedEdges } from '../../derive/floorOpenings';
import { boundsOf } from '../../model/geometry';
import { formatLengthCompact } from '../../model/units';
import { makeOutlineTool } from './outlineTool';

/**
 * Floor opening tool (H): click the corners of the hole in this level's floor (they snap to the
 * walls' faces), close it by clicking the first corner, double-clicking or pressing Enter
 * (makeOutlineTool). Every edge gets a guard except those along a wall on the level.
 */
export const floorOpeningTool = makeOutlineTool({
  noun: 'floor opening',
  selectionKey: 'floorOpenings',
  create: (ctx, outline) => {
    const ui = ctx.ui();
    const supported = floorOpeningSupportedEdges(ctx.plan(), ctx.levelId, { outline, phase: ui.drawPhase }, ui.viewMode);
    return ctx.actions.addFloorOpening(ctx.levelId, { outline, railings: supported.map((s) => !s), phase: ui.drawPhase });
  },
  added: (ctx, outline) => {
    const b = boundsOf(outline)!;
    const denom = ctx.plan().settings.precisionDenominator;
    return `Floor opening added, ${formatLengthCompact(b.maxX - b.minX, denom)} x ${formatLengthCompact(b.maxY - b.minY, denom)}, open to the level below. Set its guards in the properties panel.`;
  },
  remove: (ctx, ids) => ctx.actions.deleteFloorOpenings(ctx.levelId, ids),
});
