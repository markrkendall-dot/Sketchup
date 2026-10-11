import { getFootprints, type Footprint } from '../../derive/footprint';
import { coreInterval, displayCenter, jambDistances, liveFootprints, openingsOnWall, wallPoint } from '../../derive/openings';
import { isVisible, phasesCoexist } from '../../derive/phase';
import { dist, dot, sub } from '../../model/geometry';
import { clampOpeningOffset, OPENING_DEFAULTS, OPENING_LABEL, openingFitsHeight, wallHeightOf } from '../../model/openings';
import type { Id, Opening, Vec2 } from '../../model/types';
import { formatLength, tryParseLength } from '../../model/units';
import type { Draft, OpeningPreview, OpeningToolName } from '../../store/uiStore';
import type { Tool, ToolContext } from './index';
import { applyBufferKey } from './lengthBuffer';
import { MUST_BE_POSITIVE } from './wallTool';

/** A wall is hovered when the cursor is within this many screen px of its body. */
export const OPENING_HOVER_PX = 12;

/** Nearest visible wall whose body is within OPENING_HOVER_PX of p. */
export function findHoverWall(ctx: ToolContext, p: Vec2): Footprint | null {
  const level = ctx.level();
  const { viewport, viewMode } = ctx.ui();
  const fps = getFootprints(level, viewMode);
  let best: Footprint | null = null;
  let bestBody = OPENING_HOVER_PX / viewport.k;
  let bestCenter = Infinity;
  for (const w of Object.values(level.walls)) {
    if (!isVisible(w.phase, viewMode)) continue;
    const fp = fps.get(w.id);
    if (!fp || fp.length < 1e-6) continue;
    const s = Math.max(0, Math.min(fp.length, dot(sub(p, fp.a), fp.dir)));
    const dc = dist(p, wallPoint(fp, s, 0));
    const body = Math.max(0, dc - fp.thickness / 2);
    if (body < bestBody || (body === bestBody && dc < bestCenter)) {
      best = fp;
      bestBody = body;
      bestCenter = dc;
    }
  }
  return best;
}

function computePreview(ctx: ToolContext, type: OpeningToolName, d: Draft): OpeningPreview | null {
  const cursor = d.cursor;
  if (!cursor) return null;
  const fp = findHoverWall(ctx, cursor);
  if (!fp) return null;
  const ui = ctx.ui();
  const L = fp.length;
  const rel = sub(cursor, fp.a);
  // Position along the wall, rounded to the snap grid so click-placed offsets are clean numbers.
  const grid = ctx.plan().settings.snapGrid;
  const raw = Math.max(0, Math.min(L, dot(rel, fp.dir)));
  const s = grid > 0 ? Math.round(raw / grid) * grid : raw;
  const cursorSide: 1 | -1 = dot(rel, fp.normal) >= 0 ? 1 : -1;
  const def = OPENING_DEFAULTS[type];
  const w = def.width;
  const nearEnd = s <= L / 2 ? 'a' : 'b';
  const phase = ui.drawPhase;
  // Where the store will let the opening sit: the core interval between the corner joins in every
  // view the new opening shows in. Typed distances run from its ends, the inside faces of the
  // corners, which is what a tape measure along the wall gives.
  const interval = coreInterval(ctx.level(), fp.wallId, phase, liveFootprints(ctx.level())) ?? [fp.s0, fp.s1];
  const [s0, s1] = interval;

  let want = s;
  let typed = false;
  let problem: string | null = null;
  if (d.lengthBuffer) {
    const v = tryParseLength(d.lengthBuffer);
    if (v !== null && v > 0) {
      // Typed: distance from the nearer corner's inside face to the near jamb.
      want = nearEnd === 'a' ? s0 + v + w / 2 : s1 - v - w / 2;
      typed = true;
    }
  }
  const center = clampOpeningOffset(want, w, s0, s1);
  const denom = ctx.plan().settings.precisionDenominator;
  const wallHeight = wallHeightOf(ctx.level(), ctx.level().walls[fp.wallId]);
  if (!openingFitsHeight(def, wallHeight)) {
    problem = `Taller than the wall (${formatLength(wallHeight, denom)})`;
  } else if (s1 - s0 < w) {
    problem = `This wall is too short for a ${formatLength(w, denom)} ${type}.`;
  } else if (typed && Math.abs(center - want) > 1e-6) {
    problem = `Too far: at most ${formatLength(Math.max(0, s1 - s0 - w), denom)} from this corner.`;
  }

  if (!problem) {
    for (const o of openingsOnWall(ctx.level(), fp.wallId)) {
      if (!isVisible(o.phase, ui.viewMode) || !phasesCoexist(o.phase, phase)) continue;
      if (Math.abs(displayCenter(fp, o) - center) < (o.width + w) / 2 - 1e-6) {
        problem = 'Overlaps another opening on this wall.';
        break;
      }
    }
  }

  const opening: Omit<Opening, 'id'> = {
    wallId: fp.wallId,
    type,
    offset: center,
    width: w,
    height: def.height,
    sill: def.sill,
    phase,
  };
  if (type === 'door') {
    opening.swing = {
      hinge: d.hingeFlip ? 'b' : 'a',
      side: (cursorSide === 1) !== d.swingFlip ? 'left' : 'right',
    };
  }
  const { fromA, fromB } = jambDistances(center, w, interval);
  return {
    wallId: fp.wallId,
    geom: { a: fp.a, dir: fp.dir, normal: fp.normal, thickness: fp.thickness, length: L, s0, s1 },
    opening,
    fromA,
    fromB,
    nearEnd,
    cursorSide,
    typed,
    problem,
  };
}

/**
 * True when the end the distance is measured from is a node where three or more visible walls
 * meet: the reference is then the face of a partition (a T or a cross), not a corner.
 */
function referenceIsPartition(ctx: ToolContext, pv: OpeningPreview): boolean {
  const level = ctx.level();
  const wall = level.walls[pv.wallId];
  if (!wall) return false;
  const nodeId = pv.nearEnd === 'a' ? wall.a : wall.b;
  const vm = ctx.ui().viewMode;
  let degree = 0;
  for (const w of Object.values(level.walls)) {
    if ((w.a === nodeId || w.b === nodeId) && isVisible(w.phase, vm)) degree++;
  }
  return degree >= 3;
}

function makeOpeningTool(type: OpeningToolName): Tool {
  const label = OPENING_LABEL[type];

  /** Merge a draft patch and recompute the ghost from the stored cursor. */
  const refresh = (ctx: ToolContext, p: Partial<Draft>) => {
    const ui = ctx.ui();
    const next = { ...ui.draft, ...p };
    const openingPreview = computePreview(ctx, type, next);
    ui.patchDraft({ ...p, openingPreview });
    ui.setHover({ wallId: openingPreview?.wallId ?? null });
  };

  const place = (ctx: ToolContext): Id | null => {
    const d = ctx.ui().draft;
    const pv = d.openingPreview;
    if (!pv) {
      refresh(ctx, { error: true, message: `Point at a wall to place the ${type}.` });
      return null;
    }
    if (pv.problem) {
      refresh(ctx, { error: true, message: pv.problem });
      return null;
    }
    const id = ctx.actions.addOpening(ctx.levelId, pv.opening);
    const denom = ctx.plan().settings.precisionDenominator;
    const dist = formatLength(pv.nearEnd === 'a' ? pv.fromA : pv.fromB, denom);
    refresh(ctx, {
      lengthBuffer: '',
      error: id === null,
      message:
        id === null
          ? `Could not place the ${type} here.`
          : referenceIsPartition(ctx, pv)
            ? `${label} placed ${dist} from the partition face.`
            : `${label} placed ${dist} from the inside corner at the ${pv.nearEnd === 'a' ? 'start' : 'end'} of the wall.`,
    });
    return id;
  };

  return {
    onPointerDown(e, ctx) {
      if (e.button === 2) {
        refresh(ctx, { cursor: e.world, lengthBuffer: '', error: false, message: null });
        return;
      }
      if (e.button !== 0) return;
      refresh(ctx, { cursor: e.world, snap: null });
      place(ctx);
    },

    onPointerMove(e, ctx) {
      refresh(ctx, { cursor: e.world, snap: null });
    },

    onPointerUp() {},
    onDoubleClick() {},

    onKeyDown(e, ctx) {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      const d = ctx.ui().draft;
      const key = e.key;
      if (key === 'Tab') {
        if (type === 'door') {
          if (e.shiftKey) refresh(ctx, { hingeFlip: !d.hingeFlip, message: 'Hinge flipped.' });
          else refresh(ctx, { swingFlip: !d.swingFlip, message: 'Swing side flipped.' });
        }
        return true; // never move focus off the canvas
      }
      if (key === 'Escape') {
        if (!d.lengthBuffer) return false;
        refresh(ctx, { lengthBuffer: '', error: false, message: null });
        return true;
      }
      if (key === 'Enter') {
        if (!d.lengthBuffer) return d.openingPreview ? (place(ctx), true) : false;
        const v = tryParseLength(d.lengthBuffer);
        if (v === null) {
          refresh(ctx, { error: true, message: `Can't read "${d.lengthBuffer}" as a distance.` });
          return true;
        }
        if (v <= 0) {
          refresh(ctx, { error: true, message: MUST_BE_POSITIVE });
          return true;
        }
        place(ctx);
        return true;
      }
      // Typing starts only while a wall is targeted, so digits otherwise switch levels.
      if (!d.lengthBuffer && !d.openingPreview) return false;
      const next = applyBufferKey(d.lengthBuffer, key);
      if (next !== null) {
        refresh(ctx, { lengthBuffer: next, error: false, message: null });
        return true;
      }
      return key === 'Backspace';
    },

    cancel(ctx) {
      ctx.ui().patchDraft({ openingPreview: null, lengthBuffer: '', error: false, message: null });
      ctx.ui().setHover({});
    },
  };
}

export const doorTool = makeOpeningTool('door');
export const windowTool = makeOpeningTool('window');
export const passageTool = makeOpeningTool('passage');
