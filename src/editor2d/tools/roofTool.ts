import { ROOF_DEFAULTS } from '../../derive/roofs';
import { boundsOf } from '../../model/geometry';
import type { Vec2 } from '../../model/types';
import { formatLengthCompact } from '../../model/units';
import { makeOutlineTool } from './outlineTool';

/** Ridge along the longer side of the outline's bounding box: 0 (along x) or 90 (along y). */
export function defaultRidgeAngle(outline: readonly Vec2[]): number {
  const b = boundsOf(outline);
  return b && b.maxY - b.minY > b.maxX - b.minX ? 90 : 0;
}

/**
 * Roof tool (K): click the corners of the roof outline (they snap to the walls' outside faces),
 * close it by clicking the first corner, double-clicking or pressing Enter. Backspace removes the
 * last corner, Esc cancels (makeOutlineTool). The roof is added as a gable with its ridge along the
 * longer side.
 */
export const roofTool = makeOutlineTool({
  noun: 'roof',
  selectionKey: 'roofs',
  create: (ctx, outline) =>
    ctx.actions.addRoof(ctx.levelId, {
      shape: ROOF_DEFAULTS.shape,
      outline,
      ridgeAngle: defaultRidgeAngle(outline),
      pitch: ROOF_DEFAULTS.pitch,
      overhang: ROOF_DEFAULTS.overhang,
      bearingOffset: ROOF_DEFAULTS.bearingOffset,
      thickness: ROOF_DEFAULTS.thickness,
      fascia: ROOF_DEFAULTS.fascia,
      phase: ctx.ui().drawPhase,
      finish: ROOF_DEFAULTS.finish,
    }),
  added: (ctx, outline) => {
    const b = boundsOf(outline)!;
    const denom = ctx.plan().settings.precisionDenominator;
    return `Gable roof added over ${formatLengthCompact(b.maxX - b.minX, denom)} x ${formatLengthCompact(b.maxY - b.minY, denom)}. Set its shape and slope in the properties panel.`;
  },
  remove: (ctx, ids) => ctx.actions.deleteRoofs(ctx.levelId, ids),
});
