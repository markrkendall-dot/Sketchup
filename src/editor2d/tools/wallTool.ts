import { add, cross, dist, length, normalize, scale, sub } from '../../model/geometry';
import { MERGE_EPS } from '../../model/plan';
import type { Id, MeasureTo, PlanSettings, Vec2, WallKind } from '../../model/types';
import { tryParseLength } from '../../model/units';
import type { Draft, WallPreview, WallStart } from '../../store/uiStore';
import { SNAP_RADIUS_PX } from '../snap';
import type { Tool, ToolContext, ToolPointerEvent } from './index';

/** Characters that start or extend the typed length buffer. */
const BUFFER_START = /^[0-9'"/.-]$/;
/** Extra characters accepted once the buffer is non-empty (`12 6`, `12ft`, `6in`). */
const BUFFER_CONTINUE = /^[ ftin]$/;

export function thicknessFor(kind: WallKind, settings: PlanSettings): number {
  return kind === 'exterior' ? settings.defaultExteriorThickness : settings.defaultInteriorThickness;
}

/**
 * Convert a typed length to a centerline length according to `measureTo`.
 * Inside/outside faces: the typed number is face-to-face, so add (inside) or subtract (outside)
 * half a thickness at each end, approximated as one full thickness of the new wall.
 * Applied only where the new wall turns a square corner from the previous wall of the chain
 * (or starts a chain, assuming a square corner will close it).
 * TODO(M3): use the real thickness of the neighbouring walls at each end once mitred joins exist.
 */
export function adjustTypedLength(
  typed: number,
  measureTo: MeasureTo,
  thickness: number,
  dir: Vec2,
  prevDir: Vec2 | null,
): number {
  if (measureTo === 'center') return typed;
  const square = !prevDir || Math.abs(cross(prevDir, dir)) > 0.99;
  if (!square) return typed;
  const sign = typed < 0 ? -1 : 1;
  const mag = Math.abs(typed) + (measureTo === 'inside' ? thickness : -thickness);
  return sign * mag;
}

function startRef(ctx: ToolContext, start: WallStart): Vec2 | Id {
  return start.nodeId && ctx.level().nodes[start.nodeId] ? start.nodeId : start.point;
}

function computePreview(ctx: ToolContext, d: Draft): WallPreview | null {
  const start = d.wallStart;
  if (!start) return null;
  const { settings } = ctx.plan();
  const thickness = thicknessFor(ctx.ui().nextWallKind, settings);
  if (d.lengthBuffer) {
    const typed = tryParseLength(d.lengthBuffer);
    if (typed === null || typed === 0) return null;
    const len = adjustTypedLength(typed, settings.measureTo, thickness, d.direction, d.prevDirection);
    return { a: start.point, b: add(start.point, scale(d.direction, len)), thickness, length: Math.abs(len), typed: true };
  }
  if (!d.snap) return null;
  const len = dist(start.point, d.snap.point);
  if (len < MERGE_EPS) return null;
  return { a: start.point, b: d.snap.point, thickness, length: len, typed: false };
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
    lengthBuffer: '',
    error: false,
    message,
  });
}

function updateCursor(e: ToolPointerEvent, ctx: ToolContext): void {
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
  const result = ctx.actions.addWall(ctx.levelId, startRef(ctx, start), end, {
    kind,
    thickness: thicknessFor(kind, ctx.plan().settings),
    phase: 'existing',
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
  const { settings } = ctx.plan();
  const thickness = thicknessFor(ctx.ui().nextWallKind, settings);
  const len =
    typed === null ? 0 : adjustTypedLength(typed, settings.measureTo, thickness, d.direction, d.prevDirection);
  if (typed === null || Math.abs(len) < MERGE_EPS || Math.sign(len) !== Math.sign(typed)) {
    patch(ctx, { error: true, message: `Can't read "${d.lengthBuffer}" as a length.` });
    return;
  }
  const end = add(start.point, scale(d.direction, len));
  // Close onto an existing node within the node-snap radius (tape error tolerance).
  const radius = SNAP_RADIUS_PX.node / ctx.ui().viewport.k;
  let best: Id | null = null;
  let bestD = radius;
  for (const n of Object.values(ctx.level().nodes)) {
    if (n.id === start.nodeId) continue;
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
    if (key === 'Backspace') {
      if (d.lengthBuffer) patch(ctx, { lengthBuffer: d.lengthBuffer.slice(0, -1), error: false });
      return true;
    }
    if (key.length === 1) {
      const ch = key.toLowerCase();
      if (BUFFER_START.test(ch) || (d.lengthBuffer && BUFFER_CONTINUE.test(ch))) {
        patch(ctx, { lengthBuffer: d.lengthBuffer + ch, error: false, message: null });
        return true;
      }
    }
    return false;
  },

  cancel(ctx) {
    endChain(ctx);
  },
};
