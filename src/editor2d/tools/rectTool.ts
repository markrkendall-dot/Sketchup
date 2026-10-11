import { isVisible } from '../../derive/phase';
import { add, dist, dot, scale, sub } from '../../model/geometry';
import { collinearOverlap, MERGE_EPS } from '../../model/plan';
import type { MeasureTo, Vec2 } from '../../model/types';
import { formatLength, tryParseLength } from '../../model/units';
import type { Draft, RectPreview } from '../../store/uiStore';
import type { Tool, ToolContext, ToolPointerEvent } from './index';
import { applyBufferKey, SIZE_SEPARATOR, splitSizePair } from './lengthBuffer';
import { MUST_BE_POSITIVE, thicknessFor } from './wallTool';

// Rectangle tool (B, docs/REVIEW-2.md B2): click a corner, then type the two sizes (`12' x 10'`,
// `12'x10'`, `12' by 10'`, or `12'` Tab `10'`) and Enter, or click the opposite corner. Four walls
// of the next wall kind, its thickness and the "Draw as" phase, added in one undo step.

export const BOTH_SIZES_MESSAGE = "Type both sizes, like 12' x 10'.";

/** How far a side's centerline is from the typed face-to-face size: the half thicknesses at its two ends. */
function measureAdjust(measureTo: MeasureTo, near: number, far: number): number {
  if (measureTo === 'inside') return near / 2 + far / 2;
  if (measureTo === 'outside') return -(near / 2 + far / 2);
  return 0;
}

/**
 * The thickness of a visible wall that runs from `p` in direction `dir` (the side of the box that
 * starts there lies along it and reuses it), or null.
 */
function existingThicknessAlong(ctx: ToolContext, p: Vec2, dir: Vec2): number | null {
  const level = ctx.level();
  const vm = ctx.ui().viewMode;
  const probe = add(p, scale(dir, 2));
  let best: number | null = null;
  for (const w of Object.values(level.walls)) {
    const a = level.nodes[w.a];
    const b = level.nodes[w.b];
    if (!a || !b || !isVisible(w.phase, vm)) continue;
    if (collinearOverlap(a, b, p, probe) > 1 && (best === null || w.thickness > best)) best = w.thickness;
  }
  return best;
}

interface RectGeometry extends RectPreview {
  /** The parts of each side not already covered by a visible wall (those are reused). */
  segments: { a: Vec2; b: Vec2 }[];
  reused: boolean;
}

/** The parts of p-q that no visible wall of the level already lies along (collinear, > MERGE_EPS). */
function uncovered(ctx: ToolContext, p: Vec2, q: Vec2): { pieces: { a: Vec2; b: Vec2 }[]; covered: boolean } {
  const level = ctx.level();
  const vm = ctx.ui().viewMode;
  const L = dist(p, q);
  const u = scale(sub(q, p), 1 / L);
  const spans: [number, number][] = [];
  for (const w of Object.values(level.walls)) {
    const a = level.nodes[w.a];
    const b = level.nodes[w.b];
    if (!a || !b || !isVisible(w.phase, vm) || collinearOverlap(a, b, p, q) <= MERGE_EPS) continue;
    const s0 = dot(sub(a, p), u);
    const s1 = dot(sub(b, p), u);
    spans.push([Math.max(0, Math.min(s0, s1)), Math.min(L, Math.max(s0, s1))]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  const pieces: { a: Vec2; b: Vec2 }[] = [];
  let from = 0;
  for (const [s0, s1] of spans) {
    if (s0 - from > MERGE_EPS) pieces.push({ a: add(p, scale(u, from)), b: add(p, scale(u, s0)) });
    from = Math.max(from, s1);
  }
  if (L - from > MERGE_EPS) pieces.push({ a: add(p, scale(u, from)), b: q });
  return { pieces, covered: spans.length > 0 };
}

/** Sizes typed so far: each a number, null when absent or unreadable. */
function typedSizes(buffer: string): { w: number | null; h: number | null } {
  if (!buffer) return { w: null, h: null };
  const { first, second } = splitSizePair(buffer);
  return { w: first ? tryParseLength(first) : null, h: second ? tryParseLength(second) : null };
}

/**
 * The box from the first corner toward the cursor's quadrant: typed sizes (face to face under
 * "Lengths to", the sides that lie along an existing wall taking that wall's thickness) or the
 * cursor's corner. Null without a first corner or with no area.
 */
function rectGeometry(ctx: ToolContext, d: Draft): RectGeometry | null {
  const start = d.rectStart;
  if (!start) return null;
  const S = start.point;
  const C = d.snap?.point ?? d.cursor ?? S;
  const sx = C.x - S.x < 0 ? -1 : 1;
  const sy = C.y - S.y < 0 ? -1 : 1;
  const ui = ctx.ui();
  const t = thicknessFor(ui.nextWallKind, ctx.plan().settings);
  const measureTo = ui.measureTo;
  // The side along y through S, and the one along x through S, may be existing walls.
  const tV = existingThicknessAlong(ctx, S, { x: 0, y: sy }) ?? t;
  const tH = existingThicknessAlong(ctx, S, { x: sx, y: 0 }) ?? t;
  const adjW = measureAdjust(measureTo, tV, t);
  const adjH = measureAdjust(measureTo, tH, t);
  const typed = typedSizes(d.lengthBuffer);
  const W = typed.w !== null && typed.w > 0 ? typed.w + adjW : Math.abs(C.x - S.x);
  const H = typed.h !== null && typed.h > 0 ? typed.h + adjH : Math.abs(C.y - S.y);
  if (!(W > MERGE_EPS) || !(H > MERGE_EPS)) return null;
  const corners: RectPreview['corners'] = [
    { x: S.x, y: S.y },
    { x: S.x + sx * W, y: S.y },
    { x: S.x + sx * W, y: S.y + sy * H },
    { x: S.x, y: S.y + sy * H },
  ];
  const denom = ctx.plan().settings.precisionDenominator;
  const label =
    measureTo === 'center'
      ? `${formatLength(W, denom)} x ${formatLength(H, denom)}`
      : `${formatLength(W - adjW, denom)} x ${formatLength(H - adjH, denom)} ${measureTo}`;
  const segments: { a: Vec2; b: Vec2 }[] = [];
  let reused = false;
  corners.forEach((p, i) => {
    const r = uncovered(ctx, p, corners[(i + 1) % 4]);
    segments.push(...r.pieces);
    reused ||= r.covered;
  });
  return { corners, thickness: t, label, typed: typed.w !== null && typed.h !== null, segments, reused };
}

function patch(ctx: ToolContext, p: Partial<Draft>): void {
  const ui = ctx.ui();
  const next = { ...ui.draft, ...p };
  const g = rectGeometry(ctx, next);
  ui.patchDraft({ ...p, rectPreview: g && { corners: g.corners, thickness: g.thickness, label: g.label, typed: g.typed } });
}

function updateCursor(e: ToolPointerEvent, ctx: ToolContext): void {
  const snap = ctx.snap(e.world, { from: null, shift: e.shiftKey });
  patch(ctx, { cursor: e.world, snap });
}

function cancel(ctx: ToolContext, message: string | null = null): void {
  patch(ctx, { rectStart: null, lengthBuffer: '', error: false, message });
}

/** Add the box's walls (one undo step); keep the first corner when the store refuses them. */
function commit(ctx: ToolContext): void {
  const ui = ctx.ui();
  const d = ui.draft;
  if (!d.rectStart) return;
  if (d.lengthBuffer) {
    const { first, second } = splitSizePair(d.lengthBuffer);
    const w = tryParseLength(first);
    if (w === null) {
      patch(ctx, { error: true, message: `Can't read "${first}" as a length.` });
      return;
    }
    if (second === null || second === '') {
      patch(ctx, { error: true, message: BOTH_SIZES_MESSAGE });
      return;
    }
    const h = tryParseLength(second);
    if (h === null) {
      patch(ctx, { error: true, message: `Can't read "${second}" as a length.` });
      return;
    }
    if (w <= 0 || h <= 0) {
      patch(ctx, { error: true, message: MUST_BE_POSITIVE });
      return;
    }
  }
  const g = rectGeometry(ctx, d);
  if (!g) {
    patch(ctx, { error: true, message: d.lengthBuffer ? 'Those sizes leave no room inside the walls.' : null });
    return;
  }
  if (g.segments.length === 0) {
    patch(ctx, { error: true, message: 'Walls are already there all round.' });
    return;
  }
  const kind = ui.nextWallKind;
  const result = ctx.actions.addWalls(ctx.levelId, g.segments, { kind, thickness: g.thickness, phase: ui.drawPhase });
  // Refused (a side would lie on top of a hidden wall): the store said so; keep the first corner.
  if (!result) return;
  patch(ctx, {
    rectStart: null,
    lengthBuffer: '',
    error: false,
    message: `Drew a ${g.label} box${g.reused ? ', reusing the wall already there' : ''}. Name the room with R.`,
  });
}

export const rectTool: Tool = {
  onPointerDown(e, ctx) {
    if (e.button === 2) {
      cancel(ctx);
      return;
    }
    if (e.button !== 0) return;
    updateCursor(e, ctx);
    const d = ctx.ui().draft;
    if (!d.snap) return;
    if (!d.rectStart) {
      patch(ctx, { rectStart: { point: d.snap.point, nodeId: d.snap.nodeId }, lengthBuffer: '', error: false, message: null });
      return;
    }
    commit(ctx);
  },

  onPointerMove(e, ctx) {
    updateCursor(e, ctx);
  },

  onPointerUp() {},

  onDoubleClick() {},

  onKeyDown(e, ctx) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const ui = ctx.ui();
    const d = ui.draft;
    const key = e.key;
    if ((key === 'x' || key === 'X') && !d.lengthBuffer) {
      ui.toggleWallKind();
      patch(ctx, {});
      return true;
    }
    if (key === 'Escape') {
      if (d.lengthBuffer) patch(ctx, { lengthBuffer: '', error: false, message: null });
      else if (d.rectStart) cancel(ctx);
      else if (d.message) patch(ctx, { message: null, error: false });
      else return false;
      return true;
    }
    if (!d.rectStart) return false;
    if (key === 'Enter') {
      if (d.lengthBuffer) commit(ctx);
      return true;
    }
    if (key === 'Tab') {
      // Tab moves on to the second size.
      if (d.lengthBuffer && splitSizePair(d.lengthBuffer).second === null) {
        patch(ctx, { lengthBuffer: d.lengthBuffer.trimEnd() + SIZE_SEPARATOR, error: false, message: null });
      }
      return true;
    }
    const next = applyBufferKey(d.lengthBuffer, key);
    if (next !== null) {
      patch(ctx, { lengthBuffer: next, error: false, message: null });
      return true;
    }
    return key === 'Backspace';
  },

  cancel(ctx) {
    ctx.ui().patchDraft({ rectStart: null, rectPreview: null, lengthBuffer: '', snap: null });
  },
};
