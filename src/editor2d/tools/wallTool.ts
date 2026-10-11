import { isVisible, visibleNodeIds } from '../../derive/phase';
import { add, cross, dist, length, normalize, scale, sub } from '../../model/geometry';
import { MERGE_EPS } from '../../model/plan';
import type { Id, MeasureTo, PlanSettings, Vec2, WallKind } from '../../model/types';
import { tryParseLength } from '../../model/units';
import { onHistoryStep } from '../../store/planStore';
import { useUiStore, type Draft, type WallPreview, type WallStart } from '../../store/uiStore';
import { SNAP_RADIUS_PX } from '../snap';
import { makeToolContext, type Tool, type ToolContext, type ToolPointerEvent } from './index';
import { applyBufferKey } from './lengthBuffer';

/** What a typed length of zero or less gets, here and in the panel's size fields. */
export const MUST_BE_POSITIVE = 'Must be greater than 0.';

/** Shown when undo takes away the wall a chain was drawn from. */
export const UNDID_CHAIN_MESSAGE = 'Undid the last wall. Click to start again.';

export function thicknessFor(kind: WallKind, settings: PlanSettings): number {
  return kind === 'exterior' ? settings.defaultExteriorThickness : settings.defaultInteriorThickness;
}

/** Shown as the tooltip of the measure setting; keep in sync with adjustTypedLength. */
export const MEASURE_RULE =
  'Inside/outside face lengths: where the new wall turns a square corner from the wall it starts at, ' +
  'the centerline is the typed face-to-face length plus (inside) or minus (outside) half that wall\'s ' +
  'thickness plus half the new wall\'s own thickness (standing in for the wall that will meet its far end). ' +
  'A chain that starts in open space assumes square corners of the new wall\'s thickness at both ends. ' +
  'Straight runs and other angles are not adjusted.';

/**
 * Convert a typed length to a centerline length according to `measureTo` (see MEASURE_RULE).
 * The typed number is face to face. At a square corner (|cross| > 0.99) the inside face of the new
 * wall starts prevThickness/2 past the start node's centerline and ends `thickness`/2 short of the
 * far one, so inside adds prevThickness/2 + thickness/2 and outside subtracts the same. The far
 * wall is unknown while drawing, so the new wall's own thickness stands in for it. With no
 * previous wall (a chain started in open space) prevThickness defaults to the new wall's own.
 */
export function adjustTypedLength(
  typed: number,
  measureTo: MeasureTo,
  thickness: number,
  dir: Vec2,
  prevDir: Vec2 | null,
  prevThickness: number = thickness,
): number {
  if (measureTo === 'center') return typed;
  const square = !prevDir || Math.abs(cross(prevDir, dir)) > 0.99;
  if (!square) return typed;
  const delta = prevThickness / 2 + thickness / 2;
  const sign = typed < 0 ? -1 : 1;
  const mag = Math.abs(typed) + (measureTo === 'inside' ? delta : -delta);
  return sign * mag;
}

/**
 * The wall the new one starts from, for inside/outside lengths: the previous wall of the chain,
 * or when a chain starts on an existing corner, a visible wall there that is square to `dir`.
 */
function startJoin(ctx: ToolContext, d: Draft): { dir: Vec2 | null; thickness: number | undefined } {
  if (d.prevDirection) return { dir: d.prevDirection, thickness: d.prevThickness ?? undefined };
  const nodeId = d.wallStart?.nodeId;
  const level = ctx.level();
  if (!nodeId || !level.nodes[nodeId]) return { dir: null, thickness: undefined };
  const vm = ctx.ui().viewMode;
  let best: { dir: Vec2; thickness: number } | null = null;
  for (const w of Object.values(level.walls)) {
    if ((w.a !== nodeId && w.b !== nodeId) || !isVisible(w.phase, vm)) continue;
    const wd = normalize(sub(level.nodes[w.b], level.nodes[w.a]));
    if (Math.abs(cross(wd, d.direction)) > 0.99 && (!best || w.thickness > best.thickness)) {
      best = { dir: wd, thickness: w.thickness };
    }
  }
  return best ?? { dir: null, thickness: undefined };
}

/**
 * The face-to-face length a centerline length stands for under the `measureTo` rule: the inverse of
 * adjustTypedLength (inside added the half thicknesses to the typed length, so subtract them here).
 */
export function centerlineToFace(
  center: number,
  measureTo: MeasureTo,
  thickness: number,
  dir: Vec2,
  prevDir: Vec2 | null,
  prevThickness: number = thickness,
): number {
  if (measureTo === 'center') return center;
  return adjustTypedLength(center, measureTo === 'inside' ? 'outside' : 'inside', thickness, dir, prevDir, prevThickness);
}

function typedToCenterline(ctx: ToolContext, d: Draft, typed: number): number {
  const { settings } = ctx.plan();
  const thickness = thicknessFor(ctx.ui().nextWallKind, settings);
  const join = startJoin(ctx, d);
  return adjustTypedLength(typed, ctx.ui().measureTo, thickness, d.direction, join.dir, join.thickness);
}

function startRef(ctx: ToolContext, start: WallStart): Vec2 | Id {
  return start.nodeId && ctx.level().nodes[start.nodeId] ? start.nodeId : start.point;
}

function computePreview(ctx: ToolContext, d: Draft): WallPreview | null {
  const start = d.wallStart;
  if (!start) return null;
  const { settings } = ctx.plan();
  const thickness = thicknessFor(ctx.ui().nextWallKind, settings);
  const measureTo = ctx.ui().measureTo;
  if (d.lengthBuffer) {
    const typed = tryParseLength(d.lengthBuffer);
    if (typed === null || typed <= 0) return null;
    const len = typedToCenterline(ctx, d, typed);
    const preview: WallPreview = {
      a: start.point,
      b: add(start.point, scale(d.direction, len)),
      thickness,
      length: Math.abs(len),
      typed: true,
    };
    if (measureTo !== 'center') preview.face = { measureTo, length: typed };
    return preview;
  }
  if (!d.snap) return null;
  const len = dist(start.point, d.snap.point);
  if (len < MERGE_EPS) return null;
  const preview: WallPreview = { a: start.point, b: d.snap.point, thickness, length: len, typed: false };
  if (measureTo !== 'center') {
    const join = startJoin(ctx, { ...d, direction: normalize(sub(d.snap.point, start.point)) });
    const face = centerlineToFace(len, measureTo, thickness, normalize(sub(d.snap.point, start.point)), join.dir, join.thickness);
    if (face > 0) preview.face = { measureTo, length: face };
  }
  return preview;
}

function patch(ctx: ToolContext, p: Partial<Draft>): void {
  const ui = ctx.ui();
  const next = { ...ui.draft, ...p };
  ui.patchDraft({ ...p, wallPreview: computePreview(ctx, next) });
}

function endChain(ctx: ToolContext, message: string | null = null): void {
  patch(ctx, {
    wallStart: null,
    chainFirstNodeId: null,
    prevDirection: null,
    prevThickness: null,
    lengthBuffer: '',
    error: false,
    message,
  });
}

/**
 * End the chain when the node it continues from is gone (undo removed the wall that made it).
 * Returns true when it did.
 */
function endChainIfStartGone(ctx: ToolContext): boolean {
  const start = ctx.ui().draft.wallStart;
  if (!start?.nodeId || ctx.level().nodes[start.nodeId]) return false;
  endChain(ctx, UNDID_CHAIN_MESSAGE);
  return true;
}

/** Undo / redo run while the wall tool is mid-chain: do not leave a rubber band anchored to nothing. */
export function checkChainAfterHistory(): void {
  if (useUiStore.getState().activeTool !== 'wall') return;
  const ctx = makeToolContext();
  if (ctx) endChainIfStartGone(ctx);
}

onHistoryStep(checkChainAfterHistory);

function updateCursor(e: ToolPointerEvent, ctx: ToolContext): void {
  endChainIfStartGone(ctx);
  const d = ctx.ui().draft;
  const start = d.wallStart;
  const snap = ctx.snap(e.world, { from: start?.point ?? null, shift: e.shiftKey });
  let direction = d.direction;
  if (start) {
    const v = sub(snap.point, start.point);
    if (length(v) > 1e-6) direction = normalize(v);
  }
  patch(ctx, { cursor: e.world, snap, direction });
}

/** Add a wall from the current start to `end`, then chain or finish. */
function commit(ctx: ToolContext, end: Vec2 | Id): void {
  const ui = ctx.ui();
  const d = ui.draft;
  const start = d.wallStart;
  if (!start) return;
  const endPoint = typeof end === 'string' ? ctx.level().nodes[end] : end;
  if (!endPoint || dist(endPoint, start.point) < MERGE_EPS) return;
  const dir = normalize(sub(endPoint, start.point));
  const kind = ui.nextWallKind;
  const thickness = thicknessFor(kind, ctx.plan().settings);
  const result = ctx.actions.addWall(ctx.levelId, startRef(ctx, start), end, {
    kind,
    thickness,
    phase: ui.drawPhase,
  });
  if (!result) return;
  const chainFirst = d.chainFirstNodeId ?? result.a;
  if (result.b === chainFirst) {
    endChain(ctx, 'Closed the loop onto the first corner.');
    return;
  }
  const node = ctx.level().nodes[result.b];
  patch(ctx, {
    wallStart: { point: { x: node.x, y: node.y }, nodeId: node.id },
    chainFirstNodeId: chainFirst,
    prevDirection: dir,
    prevThickness: thickness,
    direction: dir,
    lengthBuffer: '',
    error: false,
    message: result.bWasExisting ? 'Joined an existing corner.' : null,
    // Direction persists until the mouse moves; drop the stale rubber band.
    snap: null,
  });
}

function commitTyped(ctx: ToolContext): void {
  const d = ctx.ui().draft;
  const start = d.wallStart;
  if (!start) return;
  const typed = tryParseLength(d.lengthBuffer);
  if (typed !== null && typed <= 0) {
    patch(ctx, { error: true, message: MUST_BE_POSITIVE });
    return;
  }
  const len = typed === null ? 0 : typedToCenterline(ctx, d, typed);
  if (typed === null || len < MERGE_EPS) {
    patch(ctx, { error: true, message: `Can't read "${d.lengthBuffer}" as a length.` });
    return;
  }
  const end = add(start.point, scale(d.direction, len));
  // Close onto an existing (visible) node within the node-snap radius (tape error tolerance).
  const radius = SNAP_RADIUS_PX.node / ctx.ui().viewport.k;
  const shown = visibleNodeIds(ctx.level(), ctx.ui().viewMode);
  let best: Id | null = null;
  let bestD = radius;
  for (const n of Object.values(ctx.level().nodes)) {
    if (n.id === start.nodeId || !shown.has(n.id)) continue;
    const dd = dist(n, end);
    if (dd <= bestD) {
      bestD = dd;
      best = n.id;
    }
  }
  commit(ctx, best ?? end);
}

export const wallTool: Tool = {
  onPointerDown(e, ctx) {
    if (e.button === 2) {
      endChain(ctx);
      return;
    }
    if (e.button !== 0) return;
    updateCursor(e, ctx);
    const d = ctx.ui().draft;
    const snap = d.snap;
    if (!snap) return;
    if (!d.wallStart) {
      patch(ctx, {
        wallStart: { point: snap.point, nodeId: snap.nodeId },
        chainFirstNodeId: snap.nodeId ?? null,
        prevDirection: null,
        prevThickness: null,
        lengthBuffer: '',
        error: false,
        message: null,
      });
      return;
    }
    if (d.lengthBuffer) commitTyped(ctx);
    else commit(ctx, snap.nodeId ?? snap.point);
  },

  onPointerMove(e, ctx) {
    updateCursor(e, ctx);
  },

  onPointerUp() {},

  onDoubleClick(_e, ctx) {
    endChain(ctx);
  },

  onKeyDown(e, ctx) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    endChainIfStartGone(ctx);
    const d = ctx.ui().draft;
    const drawing = d.wallStart !== null;
    const key = e.key;

    if (key === 'x' || key === 'X') {
      ctx.ui().toggleWallKind();
      patch(ctx, {});
      return true;
    }
    if (key === 'Escape') {
      if (d.lengthBuffer) patch(ctx, { lengthBuffer: '', error: false, message: null });
      else if (drawing) endChain(ctx);
      else return false;
      return true;
    }
    if (!drawing) return false;

    if (key === 'Enter' || key === 'Tab') {
      if (d.lengthBuffer) commitTyped(ctx);
      return true;
    }
    const next = applyBufferKey(d.lengthBuffer, key);
    if (next !== null) {
      patch(ctx, { lengthBuffer: next, error: false, message: null });
      return true;
    }
    // Backspace on an empty buffer is swallowed so it never deletes a selection mid-draw.
    return key === 'Backspace';
  },

  cancel(ctx) {
    endChain(ctx);
  },
};
