import { fixtureFrame, fixtureLocal } from '../../derive/casework';
import { getFootprints, type Footprint } from '../../derive/footprint';
import { isVisible } from '../../derive/phase';
import { normalizeDegrees } from '../../derive/stairs';
import { FIXTURE_DEFAULTS, FIXTURE_LABEL } from '../../model/casework';
import { add, dot, projectPointToSegment, scale, sub } from '../../model/geometry';
import type { Fixture, FixtureKind, Id, Level, Vec2, ViewMode } from '../../model/types';
import { formatLengthCompact, tryParseLength } from '../../model/units';
import { EMPTY_SELECTION, type FixturePreview } from '../../store/uiStore';
import type { Tool, ToolContext, ToolPointerEvent } from './index';
import { applyBufferKey } from './lengthBuffer';

// The fixture tool (C; DESIGN.md "Casework"): the cabinet or appliance of the chosen kind follows
// the cursor with its back on the nearest wall face, its front facing into the room, and slides
// to abut a fixture already on that wall; away from any wall it is free and Tab turns it. Typing a
// width sets the next one's width; click (or Enter) places it in the toolbar's "Draw as" phase.

/** A wall face within this many screen px catches the fixture's back. */
const FACE_SNAP_PX = 12;
/** A fixture end within this many screen px of another fixture's end on the same line abuts it. */
const ABUT_PX = 12;

export interface FaceHit {
  wallId: Id;
  /** The back's middle on the face line. */
  point: Vec2;
  /** The way the front faces: away from the wall. */
  direction: number;
  /** The face line's unit tangent and its extent along it (from the face's start). */
  tangent: Vec2;
  faceStart: Vec2;
  faceLength: number;
}

const angleOf = (v: Vec2): number => normalizeDegrees((Math.atan2(v.y, v.x) * 180) / Math.PI);

/**
 * The nearest visible wall face to `raw` within the radius: the fixture's back lies on it and its
 * front faces away from the wall. Null when no face is near.
 */
export function nearestFace(level: Level, viewMode: ViewMode, raw: Vec2, radius: number): FaceHit | null {
  let best: FaceHit | null = null;
  let bestD = radius;
  const consider = (fp: Footprint, a: Vec2, b: Vec2, outward: Vec2) => {
    const pr = projectPointToSegment(raw, a, b);
    if (pr.distance > bestD) return;
    bestD = pr.distance;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    best = {
      wallId: fp.wallId,
      point: pr.point,
      direction: angleOf(outward),
      tangent: len > 1e-9 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 1, y: 0 },
      faceStart: a,
      faceLength: len,
    };
  };
  for (const fp of getFootprints(level, viewMode).values()) {
    const [leftA, leftB, rightB, rightA] = fp.edge;
    consider(fp, leftA, leftB, fp.normal); // the left face: outward is the left normal
    consider(fp, rightA, rightB, scale(fp.normal, -1));
  }
  return best;
}

/**
 * Slide the back's middle along the face so the fixture abuts a visible fixture already on the same
 * line (same facing, back on the same line), when an end of it comes within `reach` of that
 * fixture's end. Returns the new middle and the fixture abutted, or the input unchanged.
 */
export function abutOnLine(level: Level, viewMode: ViewMode, face: FaceHit, point: Vec2, width: number, reach: number): { point: Vec2; abuts: Id | null } {
  const t = face.tangent;
  const s = dot(sub(point, face.faceStart), t);
  const hw = width / 2;
  let bestS = s;
  let bestD = reach;
  let abuts: Id | null = null;
  for (const f of Object.values(level.fixtures ?? {})) {
    if (!isVisible(f.phase, viewMode)) continue;
    if (Math.abs(normalizeDegrees(f.direction - face.direction)) > 1e-6 && Math.abs(normalizeDegrees(f.direction - face.direction) - 360) > 1e-6) continue;
    // Its back must lie on this face line (within half an inch across it).
    const { d } = fixtureLocal({ origin: face.faceStart, direction: face.direction }, f.origin);
    if (Math.abs(d) > 0.5) continue;
    const c = dot(sub(f.origin, face.faceStart), t);
    const h = f.width / 2;
    // Our left end to its right end, or our right end to its left end.
    const candidates: [number, number][] = [
      [Math.abs(s - hw - (c + h)), c + h + hw],
      [Math.abs(s + hw - (c - h)), c - h - hw],
    ];
    for (const [dist, at] of candidates) {
      if (dist < bestD) {
        bestD = dist;
        bestS = at;
        abuts = f.id;
      }
    }
  }
  return { point: add(face.faceStart, scale(t, bestS)), abuts };
}

/** The width the buffer asks for, or null when it is empty or unreadable. */
function typedWidth(buffer: string): number | null {
  if (buffer.trim() === '') return null;
  const v = tryParseLength(buffer);
  return v !== null && v > 0 ? v : null;
}

function preview(ctx: ToolContext, e: ToolPointerEvent | null): FixturePreview | null {
  const ui = ctx.ui();
  const cursor = e?.world ?? ui.draft.cursor;
  if (!cursor) {
    ui.patchDraft({ fixturePreview: null });
    return null;
  }
  const kind = ui.draft.fixtureKind;
  const def = FIXTURE_DEFAULTS[kind];
  const typed = typedWidth(ui.draft.lengthBuffer);
  const width = typed ?? def.width;
  const k = ui.viewport.k;
  const level = ctx.level();
  const shift = e?.shiftKey ?? false;
  let pv: FixturePreview;
  const face = shift ? null : nearestFace(level, ui.viewMode, cursor, FACE_SNAP_PX / k);
  if (face) {
    const { point, abuts } = abutOnLine(level, ui.viewMode, face, face.point, width, ABUT_PX / k);
    pv = { kind, origin: point, direction: face.direction, width, depth: def.depth, wallId: face.wallId, abuts, typed: typed !== null };
    ui.patchDraft({ cursor, snap: { point, kind: 'face-edge', wallId: face.wallId, guides: [] }, fixturePreview: pv });
  } else {
    const snap = ctx.snap(cursor, { shift: false });
    // Free placement: the cursor is the middle of the fixture, so the back is half the depth behind it.
    const fr = fixtureFrame({ origin: snap.point, direction: ui.draft.fixtureDirection });
    const origin = sub(snap.point, scale(fr.u, def.depth / 2));
    pv = { kind, origin, direction: ui.draft.fixtureDirection, width, depth: def.depth, wallId: null, abuts: null, typed: typed !== null };
    ui.patchDraft({ cursor, snap, fixturePreview: pv });
  }
  return pv;
}

function place(ctx: ToolContext, e: ToolPointerEvent | null): void {
  const pv = preview(ctx, e);
  if (!pv) return;
  const ui = ctx.ui();
  if (ui.draft.lengthBuffer.trim() !== '' && typedWidth(ui.draft.lengthBuffer) === null) {
    ui.patchDraft({ error: true, message: `Can't read "${ui.draft.lengthBuffer}" as a width.` });
    return;
  }
  const def = FIXTURE_DEFAULTS[pv.kind];
  const fixture: Omit<Fixture, 'id'> = {
    kind: pv.kind,
    origin: pv.origin,
    direction: pv.direction,
    width: pv.width,
    depth: def.depth,
    height: def.height,
    elevation: def.elevation,
    phase: ui.drawPhase,
  };
  const id = ctx.actions.addFixture(ctx.levelId, fixture);
  if (!id) {
    ui.patchDraft({ error: true, message: 'Could not place that here.' });
    return;
  }
  ui.setSelection({ ...EMPTY_SELECTION, fixtures: [id] });
  const denom = ctx.plan().settings.precisionDenominator;
  const where = pv.wallId ? (pv.abuts ? ' against the wall, beside the last one' : ' against the wall') : '';
  ui.patchDraft({
    lengthBuffer: '',
    error: false,
    message: `${FIXTURE_LABEL[pv.kind]} ${formatLengthCompact(pv.width, denom)} placed${where}. Click to place the next one; type a width first to change it.`,
  });
  preview(ctx, e);
}

export const fixtureTool: Tool = {
  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    place(ctx, e);
  },

  onPointerMove(e, ctx) {
    preview(ctx, e);
  },

  onPointerUp() {},
  onDoubleClick() {},

  onKeyDown(e, ctx) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const ui = ctx.ui();
    const d = ui.draft;
    if (e.key === 'Tab') {
      const direction = normalizeDegrees(d.fixtureDirection + (e.shiftKey ? -90 : 90));
      ui.patchDraft({ fixtureDirection: direction, message: d.fixturePreview?.wallId ? 'Turned the free direction; hold Shift to place away from the wall.' : null, error: false });
      preview(ctx, null);
      return true;
    }
    if (e.key === 'Enter') {
      place(ctx, null);
      return true;
    }
    if (e.key === 'Escape') {
      if (d.lengthBuffer) ui.patchDraft({ lengthBuffer: '', error: false, message: null });
      else if (d.message) ui.patchDraft({ message: null, error: false });
      else return false;
      preview(ctx, null);
      return true;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !d.lengthBuffer && ui.selection.fixtures.length) {
      ctx.actions.deleteFixtures(ctx.levelId, ui.selection.fixtures);
      ui.clearSelection();
      return true;
    }
    const next = applyBufferKey(d.lengthBuffer, e.key);
    if (next !== null) {
      ui.patchDraft({ lengthBuffer: next, error: false, message: null });
      preview(ctx, null);
      return true;
    }
    return e.key === 'Backspace';
  },

  cancel(ctx) {
    ctx.ui().patchDraft({ fixturePreview: null, snap: null, lengthBuffer: '', error: false });
  },
};

/** Change the kind the tool places (the panel's picker); the ghost follows at once. */
export function setFixtureKind(ctx: ToolContext | null, kind: FixtureKind): void {
  const ui = (ctx?.ui ?? (() => null))();
  if (!ui) return;
  ui.patchDraft({ fixtureKind: kind });
  if (ctx) preview(ctx, null);
}
