import { isVisible } from '../../derive/phase';
import { dist } from '../../model/geometry';
import { MEMBER_DEFAULTS, joistWords } from '../../model/structure';
import type { Vec2 } from '../../model/types';
import { formatLength } from '../../model/units';
import { EMPTY_SELECTION } from '../../store/uiStore';
import type { Tool, ToolContext, ToolPointerEvent } from './index';
import { makeOutlineTool } from './outlineTool';

/** The snapped point for a member: corners, wall centerlines, the level below, the grid. */
const memberSnap = (ctx: ToolContext, e: ToolPointerEvent, from: Vec2 | null) => ctx.snap(e.world, { from, shift: e.shiftKey });

/** Delete the selected members (Delete or Backspace while the tool is idle). */
function deleteSelectedMembers(ctx: ToolContext): boolean {
  const ids = ctx.ui().selection.members;
  if (!ids.length) return false;
  ctx.actions.deleteEntities(ctx.levelId, { nodes: [], walls: [], members: ids });
  ctx.ui().clearSelection();
  return true;
}

/**
 * Beam tool (I): click one end, then the other (they snap like walls, with the ortho lock); a flush
 * beam of two 1 3/4" x 11 7/8" LVLs (a placeholder for the engineer to size) in the framing over this
 * level, selected. Esc drops the first end.
 */
export const beamTool: Tool = {
  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    const ui = ctx.ui();
    const start = ui.draft.measure?.a ?? null;
    const snap = memberSnap(ctx, e, start);
    if (!start) {
      ui.patchDraft({ measure: { a: snap.point, b: null }, snap, cursor: e.world, message: 'Click the beam\'s other end. Esc cancels.', error: false });
      return;
    }
    if (dist(start, snap.point) < 1) return;
    const d = MEMBER_DEFAULTS.beam;
    const id = ctx.actions.addMember(ctx.levelId, { kind: 'beam', a: start, b: snap.point, width: d.width, depth: d.depth, mount: d.mount, label: d.label, phase: ui.drawPhase });
    if (!id) {
      ui.patchDraft({ error: true, message: 'Could not place a beam here.' });
      return;
    }
    ui.setSelection({ ...EMPTY_SELECTION, members: [id] });
    const denom = ctx.plan().settings.precisionDenominator;
    ui.patchDraft({ measure: null, snap, error: false, message: `Beam placed, ${formatLength(dist(start, snap.point), denom)} long: ${d.label}, flush in the floor framing (a placeholder size). Set it in the properties panel.` });
  },
  onPointerMove(e, ctx) {
    const ui = ctx.ui();
    ui.patchDraft({ cursor: e.world, snap: memberSnap(ctx, e, ui.draft.measure?.a ?? null) });
  },
  onPointerUp() {},
  onDoubleClick() {},
  onKeyDown(e, ctx) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const ui = ctx.ui();
    if (e.key === 'Escape' && (ui.draft.measure || ui.draft.message)) {
      ui.patchDraft({ measure: null, message: null, error: false });
      return true;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !ui.draft.measure) return deleteSelectedMembers(ctx);
    return false;
  },
  cancel(ctx) {
    ctx.ui().patchDraft({ measure: null });
  },
};

/**
 * Post tool (L): click to place a 6x6 post on this level's floor, up to the beam over it (else the
 * ceiling); on the lowest level it stands on a 24" x 12" footing. It snaps to beam ends, corners,
 * wall centerlines and the grid.
 */
export const postTool: Tool = {
  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    const ui = ctx.ui();
    const snap = snapToBeamEnds(ctx, e) ?? memberSnap(ctx, e, null);
    const d = MEMBER_DEFAULTS.post;
    const lowest = ctx.plan().levelOrder[0] === ctx.levelId;
    const id = ctx.actions.addMember(ctx.levelId, {
      kind: 'post',
      at: snap.point,
      width: d.width,
      depth: d.depth,
      rotation: 0,
      label: d.label,
      phase: ui.drawPhase,
      ...(lowest ? { footing: { width: MEMBER_DEFAULTS.footing.width, thickness: MEMBER_DEFAULTS.footing.thickness } } : {}),
    });
    if (!id) {
      ui.patchDraft({ error: true, message: 'Could not place a post here.' });
      return;
    }
    ui.setSelection({ ...EMPTY_SELECTION, members: [id] });
    ui.patchDraft({ snap, error: false, message: `Post placed${lowest ? ' on a 24" footing' : ''}. Set it in the properties panel.` });
  },
  onPointerMove(e, ctx) {
    ctx.ui().patchDraft({ cursor: e.world, snap: snapToBeamEnds(ctx, e) ?? memberSnap(ctx, e, null) });
  },
  onPointerUp() {},
  onDoubleClick() {},
  onKeyDown(e, ctx) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') return deleteSelectedMembers(ctx);
    return false;
  },
  cancel() {},
};

/** A beam's end (on this level or the level above, where the post would carry it) within 10 px. */
function snapToBeamEnds(ctx: ToolContext, e: ToolPointerEvent) {
  const ui = ctx.ui();
  const plan = ctx.plan();
  const i = plan.levelOrder.indexOf(ctx.levelId);
  const levels = [plan.levels[ctx.levelId], plan.levels[plan.levelOrder[i + 1]]].filter(Boolean);
  const r = 10 / ui.viewport.k;
  let best: Vec2 | null = null;
  let bestD = r;
  for (const lvl of levels) {
    for (const m of Object.values(lvl.members ?? {})) {
      if (m.kind !== 'beam' || !isVisible(m.phase, ui.viewMode)) continue;
      for (const p of [m.a, m.b]) {
        const d = dist(p, e.world);
        if (d <= bestD) {
          bestD = d;
          best = p;
        }
      }
    }
  }
  return best ? { point: best, kind: 'node' as const, guides: [] } : null;
}

/**
 * Joist zone tool (from the Level panel): click the corners of an area over this level framed
 * another way (a part built in another stage); its joists start square to the level's.
 */
export const joistZoneTool = makeOutlineTool({
  noun: 'joist zone',
  selectionKey: 'joistZones',
  create: (ctx, outline) => {
    const lvl = ctx.level();
    const joists = lvl.framing ? (lvl.framing.joists + 90) % 180 : 0;
    return ctx.actions.addJoistZone(ctx.levelId, { outline, joists, phase: ctx.ui().drawPhase });
  },
  added: (ctx, _outline) => {
    const lvl = ctx.level();
    const joists = lvl.framing ? (lvl.framing.joists + 90) % 180 : 0;
    return `Joist zone added, its joists ${joistWords(joists, ctx.plan().site.northAngle)}. Set them in the properties panel.`;
  },
  remove: (ctx, ids) => ctx.actions.deleteEntities(ctx.levelId, { nodes: [], walls: [], joistZones: ids }),
});
