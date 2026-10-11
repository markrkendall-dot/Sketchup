import { dist, sub } from '../../model/geometry';
import type { Id, Vec2 } from '../../model/types';
import {
  calibrateRotation,
  calibrateScale,
  formatPxScale,
  hitUnderlay,
  MIN_CALIBRATION_PX,
  nearestAxis,
  pixelDistance,
} from '../../model/underlay';
import { formatLength, parseLength } from '../../model/units';
import { getPlan, pauseHistory, resumeHistory, usePlanStore } from '../../store/planStore';
import { useUiStore } from '../../store/uiStore';
import { applyBufferKey } from './lengthBuffer';
import type { Tool, ToolContext, ToolPointerEvent } from './index';

const DRAG_THRESHOLD_PX = 3;
/** Arrow-key nudge, inches (Shift: one foot). */
const NUDGE = 1;
const NUDGE_SHIFT = 12;

// ---------------------------------------------------------------------------------------------
// Image picker. The hidden file input lives in the UI (UnderlayImport.tsx), which registers how to
// open it, so tools can ask for an image without importing React code.

export interface PickRequest {
  levelId: Id;
  /** Swap the image of an existing underlay instead of placing a new one. */
  replace: boolean;
}

let picker: ((req: PickRequest) => void) | null = null;

export function registerUnderlayPicker(fn: ((req: PickRequest) => void) | null): void {
  picker = fn;
}

/** Open the file picker to load (or replace) the image under a level. */
export function requestUnderlayImage(levelId: Id, replace = false): void {
  picker?.({ levelId, replace });
}

// ---------------------------------------------------------------------------------------------
// Moving the image: shared by the underlay tool (move mode) and the select tool.

interface UnderlayDrag {
  grab: Vec2;
  origin: Vec2;
  startScreen: Vec2;
  started: boolean;
}

let drag: UnderlayDrag | null = null;

/** The active level's underlay when it is shown and can be moved. */
function movableUnderlay(ctx: ToolContext) {
  const u = ctx.level().underlay;
  return u && !u.locked && ctx.ui().showUnderlay ? u : null;
}

/** Select the underlay and start a drag if the pointer is on it. Returns false otherwise. */
export function startUnderlayDrag(ctx: ToolContext, e: ToolPointerEvent): boolean {
  const u = movableUnderlay(ctx);
  if (!u || !hitUnderlay(u, e.world)) return false;
  ctx.ui().selectUnderlay(true);
  drag = { grab: e.world, origin: { ...u.origin }, startScreen: e.screen, started: false };
  return true;
}

/** Follow the pointer; returns false when no underlay drag is in progress. */
export function moveUnderlayDrag(ctx: ToolContext, e: ToolPointerEvent): boolean {
  if (!drag) return false;
  ctx.ui().patchDraft({ cursor: e.world, snap: null });
  if (!drag.started && dist(e.screen, drag.startScreen) < DRAG_THRESHOLD_PX) return true;
  const grid = ctx.plan().settings.snapGrid;
  const round = (v: number) => (grid > 0 ? Math.round(v / grid) * grid : v);
  const d = sub(e.world, drag.grab);
  ctx.actions.updateUnderlay(ctx.levelId, { origin: { x: drag.origin.x + round(d.x), y: drag.origin.y + round(d.y) } });
  if (!drag.started) {
    // The first set of the drag is tracked; the rest fold into it (one undo step).
    drag.started = true;
    pauseHistory();
  }
  return true;
}

export function endUnderlayDrag(): void {
  if (drag?.started) resumeHistory();
  drag = null;
}

/** Arrow keys move the image 1" (Shift: 12"). Returns true when the key was used. */
export function nudgeUnderlay(ctx: ToolContext, e: KeyboardEvent): boolean {
  const dir: Record<string, Vec2> = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
  };
  const d = dir[e.key];
  if (!d) return false;
  const u = ctx.level().underlay;
  if (!u) return false;
  if (u.locked) {
    ctx.ui().patchDraft({ error: true, message: 'The image is locked. Unlock it in the panel to move it.' });
    return true;
  }
  const step = e.shiftKey ? NUDGE_SHIFT : NUDGE;
  ctx.actions.updateUnderlay(ctx.levelId, { origin: { x: u.origin.x + d.x * step, y: u.origin.y + d.y * step } });
  return true;
}

/** Remove the active level's underlay after asking. */
export function confirmRemoveUnderlay(levelId: Id): void {
  const level = getPlan().levels[levelId];
  if (!level?.underlay) return;
  if (!window.confirm(`Remove the image under ${level.name}? (Undo brings it back.)`)) return;
  usePlanStore.getState().setUnderlay(levelId, undefined);
  useUiStore.getState().selectUnderlay(false);
}

// ---------------------------------------------------------------------------------------------
// Underlay tool

const LOCKED_MESSAGE = 'The image is locked. Unlock it in the properties panel to move or calibrate it.';

function commitScale(ctx: ToolContext): void {
  const ui = ctx.ui();
  const d = ui.draft;
  const u = ctx.level().underlay;
  const [p1, p2] = d.underlayPoints;
  if (!u || !p1 || !p2) return;
  let real: number;
  try {
    real = parseLength(d.lengthBuffer);
  } catch {
    ui.patchDraft({ error: true, message: `Could not read "${d.lengthBuffer}" as a length. Try 20' or 12'6.` });
    return;
  }
  const next = real > 0 ? calibrateScale(u, p1, p2, real) : null;
  if (!next) {
    ui.patchDraft({ error: true, message: 'Type a distance greater than zero.' });
    return;
  }
  ctx.actions.updateUnderlay(ctx.levelId, { scale: next.scale, origin: next.origin });
  const denom = ctx.plan().settings.precisionDenominator;
  ui.setUnderlayMode('move');
  ui.patchDraft({
    error: false,
    message: `Scale set: ${formatPxScale(next.scale)}, image ${formatLength(u.pixelWidth * next.scale, denom)} wide. Lock it, trace with W.`,
  });
}

export const underlayTool: Tool = {
  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    const ui = ctx.ui();
    const u = ctx.level().underlay;
    if (!u) {
      requestUnderlayImage(ctx.levelId);
      return;
    }
    if (u.locked) {
      ui.patchDraft({ error: true, message: LOCKED_MESSAGE });
      return;
    }
    const mode = ui.underlayMode;
    if (mode === 'move') {
      if (!startUnderlayDrag(ctx, e)) ui.patchDraft({ error: false, message: 'Drag the image to move it. Arrow keys nudge 1" (Shift: 1\').' });
      return;
    }
    const pts = ui.draft.underlayPoints;
    if (pts.length !== 1) {
      ui.patchDraft({ underlayPoints: [e.world], lengthBuffer: '', error: false, message: null, cursor: e.world });
      return;
    }
    const p1 = pts[0];
    if (pixelDistance(u, p1, e.world) < MIN_CALIBRATION_PX) {
      ui.patchDraft({ error: true, message: 'Click a second point farther from the first.' });
      return;
    }
    if (mode === 'scale') {
      ui.patchDraft({ underlayPoints: [p1, e.world], lengthBuffer: '', error: false, message: null });
      return;
    }
    const next = calibrateRotation(u, p1, e.world);
    if (!next) return;
    const { turn, target } = nearestAxis(p1, e.world);
    ctx.actions.updateUnderlay(ctx.levelId, { rotation: next.rotation, origin: next.origin });
    ui.setUnderlayMode('move');
    const axis = target % 180 === 0 ? 'horizontal' : 'vertical';
    ui.patchDraft({
      error: false,
      message: `Rotated ${turn >= 0 ? '' : '-'}${Math.abs(turn).toFixed(1)}° so the line is ${axis}. Rotation is now ${next.rotation.toFixed(1)}°.`,
    });
  },

  onPointerMove(e, ctx) {
    if (moveUnderlayDrag(ctx, e)) return;
    ctx.ui().patchDraft({ cursor: e.world, snap: null });
  },

  onPointerUp() {
    endUnderlayDrag();
  },

  onDoubleClick() {},

  onKeyDown(e, ctx) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const ui = ctx.ui();
    const d = ui.draft;
    const key = e.key;
    const pts = d.underlayPoints;
    if (key === 'Escape') {
      if (d.lengthBuffer) ui.patchDraft({ lengthBuffer: '', error: false, message: null });
      else if (pts.length) ui.patchDraft({ underlayPoints: [], error: false, message: null });
      else if (ui.underlayMode !== 'move') ui.setUnderlayMode('move');
      else if (d.message) ui.patchDraft({ error: false, message: null });
      else return false;
      return true;
    }
    if (ui.underlayMode === 'scale' && pts.length === 2) {
      if (key === 'Enter' || key === 'Tab') {
        if (d.lengthBuffer) commitScale(ctx);
        return true;
      }
      const next = applyBufferKey(d.lengthBuffer, key);
      if (next !== null) {
        ui.patchDraft({ lengthBuffer: next, error: false, message: null });
        return true;
      }
      // Backspace on an empty buffer is swallowed so it never removes the image mid-calibration.
      if (key === 'Backspace') return true;
    }
    if (pts.length === 0 && nudgeUnderlay(ctx, e)) return true;
    if ((key === 'Delete' || key === 'Backspace') && pts.length === 0 && ctx.level().underlay) {
      confirmRemoveUnderlay(ctx.levelId);
      return true;
    }
    return false;
  },

  cancel(ctx) {
    endUnderlayDrag();
    ctx.ui().patchDraft({ underlayPoints: [], lengthBuffer: '', snap: null });
  },
};
