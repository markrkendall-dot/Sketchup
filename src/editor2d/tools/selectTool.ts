import { hitFixture } from '../../derive/casework';
import { getFootprints } from '../../derive/footprint';
import { roofOutlineWithOverhang } from '../../derive/roofs';
import { selfIntersects } from '../../derive/rooms';
import { hitOpeningRect, hitOpeningSwing } from '../../derive/openings';
import { hitStairs } from '../../derive/stairs';
import { isOpeningVisible, isVisible, visibleNodeIds } from '../../derive/phase';
import { add, dist, dot, pointInPolygon, projectPointToSegment, sub } from '../../model/geometry';
import { WALL_OVERLAP_MESSAGE } from '../../model/plan';
import { nudgeShifts } from '../../model/offset';
import type { Id, Level, Plan, Vec2, ViewMode } from '../../model/types';
import { formatLength } from '../../model/units';
import { needsRenovationChoice, perpendicularShift, requestWallMove } from '../../ui/wallMove';
import { pauseHistory, resumeHistory, usePlanStore } from '../../store/planStore';
import { EMPTY_SELECTION, selectionSize, type Selection } from '../../store/uiStore';
import { hitRoomLabel } from '../roomLabels';
import { SNAP_RADIUS_PX } from '../snap';
import type { Tool, ToolContext } from './index';
import { outlineSnap } from './outlineTool';
import { endRoomDrag, moveRoomDrag, startRename, startRoomDrag, type RoomDrag } from './roomTool';
import { confirmRemoveUnderlay, endUnderlayDrag, moveUnderlayDrag, nudgeUnderlay, startUnderlayDrag } from './underlayTool';

const DRAG_THRESHOLD_PX = 3;
/** Minimum half-width of a wall's pick area, in screen px. */
const WALL_PICK_PX = 4;
/** Pick radius around opening symbols (door leaf and arc), in screen px. */
const OPENING_PICK_PX = 4;
/** An opening's own rectangle (the hole across the wall) picks this much past its edges, screen px. */
const OPENING_RECT_PX = 2;
/** Shown while one opening is selected: a second click on it selects its wall. */
export const OPENING_CYCLE_HINT = 'Click again for the wall';

export type Hit =
  | { kind: 'node'; id: Id }
  | { kind: 'opening'; id: Id }
  | { kind: 'wall'; id: Id }
  | { kind: 'room'; id: Id }
  | { kind: 'stairs'; id: Id }
  | { kind: 'fixture'; id: Id }
  | { kind: 'roof'; id: Id }
  | { kind: 'deck'; id: Id }
  | { kind: 'floorOpening'; id: Id }
  | { kind: 'staircase'; id: Id }
  | null;

const SEL_KEY = { node: 'nodes', wall: 'walls', opening: 'openings', room: 'rooms', stairs: 'stairs', fixture: 'fixtures', roof: 'roofs', deck: 'decks', floorOpening: 'floorOpenings', staircase: 'staircases' } as const;

/**
 * A click on a piece of a staircase picks the staircase, unless that staircase is open (a
 * double-click on one of its pieces opened it): then the piece alone.
 */
export function liftToStaircase(level: Level, hit: Hit, openStaircaseId: Id | null): Hit {
  if (hit?.kind !== 'stairs') return hit;
  const sc = level.stairs[hit.id]?.staircaseId;
  return sc && level.staircases?.[sc] && sc !== openStaircaseId ? { kind: 'staircase', id: sc } : hit;
}

/** Pick radius of a selected roof's or deck's outline corner handles, in screen px. */
const OUTLINE_HANDLE_PX = 8;

/** The outline corner under p of one of the given outlines (the nearest within the handle radius). */
function hitOutlineHandle(items: Iterable<{ id: Id; outline: readonly Vec2[] } | undefined>, p: Vec2, k: number): { id: Id; index: number } | null {
  let best: { id: Id; index: number } | null = null;
  let bestD = OUTLINE_HANDLE_PX / k;
  for (const item of items) {
    if (!item) continue;
    item.outline.forEach((q, index) => {
      const d = dist(q, p);
      if (d <= bestD) {
        bestD = d;
        best = { id: item.id, index };
      }
    });
  }
  return best;
}

/** The outline corner of one of the selected roofs under p (handles win over everything else). */
export const hitRoofHandle = (level: Level, roofIds: readonly Id[], p: Vec2, k: number): { id: Id; index: number } | null =>
  hitOutlineHandle(
    roofIds.map((id) => level.roofs[id]),
    p,
    k,
  );

/** The outline corner of one of the selected decks under p. */
export const hitDeckHandle = (level: Level, deckIds: readonly Id[], p: Vec2, k: number): { id: Id; index: number } | null =>
  hitOutlineHandle(
    deckIds.map((id) => level.decks?.[id]),
    p,
    k,
  );

/** The outline corner of one of the selected floor openings under p. */
export const hitFloorOpeningHandle = (level: Level, openingIds: readonly Id[], p: Vec2, k: number): { id: Id; index: number } | null =>
  hitOutlineHandle(
    openingIds.map((id) => level.floorOpenings?.[id]),
    p,
    k,
  );

/** Inside a plan outline, or within `tol` of one of its edges. */
const nearOutline = (outline: readonly Vec2[], p: Vec2, tol: number): boolean =>
  pointInPolygon(p, outline) || outline.some((q, i) => projectPointToSegment(p, q, outline[(i + 1) % outline.length]).distance <= tol);

/**
 * Priority: nodes within 10px, then an opening's own rectangle (the hole between its jambs across
 * the wall, plus 2 px), then walls (so the wall either side of a window is the wall), then door
 * leaves and swings, then room labels, then fixtures, then stairs, then decks (inside the outline
 * or within 2 px of it), then floor openings (the same), then roofs (inside the outline grown by the overhang); the most recently
 * added on top. Elements hidden in `viewMode` are never hit.
 */
export function hitTest(level: Level, p: Vec2, k: number, viewMode: ViewMode = 'all'): Hit {
  let best: Hit = null;
  let bestD = SNAP_RADIUS_PX.node / k;
  const shownNodes = visibleNodeIds(level, viewMode);
  for (const n of Object.values(level.nodes)) {
    if (!shownNodes.has(n.id)) continue;
    const d = dist(n, p);
    if (d <= bestD) {
      bestD = d;
      best = { kind: 'node', id: n.id };
    }
  }
  if (best) return best;

  const fps = getFootprints(level, viewMode);
  const openings = Object.values(level.openings).filter((o) => isOpeningVisible(o, level.walls[o.wallId], viewMode));
  for (const o of openings) {
    const fp = fps.get(o.wallId);
    if (fp && hitOpeningRect(fp, o, p, OPENING_RECT_PX / k)) return { kind: 'opening', id: o.id };
  }

  bestD = Infinity;
  for (const w of Object.values(level.walls)) {
    if (!isVisible(w.phase, viewMode)) continue;
    const a = level.nodes[w.a];
    const b = level.nodes[w.b];
    if (!a || !b) continue;
    const pr = projectPointToSegment(p, a, b);
    const reach = Math.max(w.thickness / 2, WALL_PICK_PX / k);
    if (pr.distance <= reach && pr.distance < bestD) {
      bestD = pr.distance;
      best = { kind: 'wall', id: w.id };
    }
  }
  if (best) return best;
  for (const o of openings) {
    const fp = fps.get(o.wallId);
    if (fp && hitOpeningSwing(fp, o, p, OPENING_PICK_PX / k)) return { kind: 'opening', id: o.id };
  }
  const room = hitRoomLabel(level, viewMode, p, k);
  if (room) return { kind: 'room', id: room };
  // Topmost (last placed) fixture first.
  const fixture = Object.values(level.fixtures ?? {})
    .reverse()
    .find((f) => isVisible(f.phase, viewMode) && hitFixture(f, p, 2 / k));
  if (fixture) return { kind: 'fixture', id: fixture.id };
  // Topmost (last drawn) stairs first.
  const stairs = Object.values(level.stairs).reverse();
  const st = stairs.find((s) => isVisible(s.phase, viewMode) && hitStairs(s, p, 2 / k));
  if (st) return { kind: 'stairs', id: st.id };
  const deck = Object.values(level.decks ?? {})
    .reverse()
    .find((d) => isVisible(d.phase, viewMode) && nearOutline(d.outline, p, 2 / k));
  if (deck) return { kind: 'deck', id: deck.id };
  const fo = Object.values(level.floorOpenings ?? {})
    .reverse()
    .find((o) => isVisible(o.phase, viewMode) && nearOutline(o.outline, p, 2 / k));
  if (fo) return { kind: 'floorOpening', id: fo.id };
  const roof = Object.values(level.roofs ?? {})
    .reverse()
    .find((r) => isVisible(r.phase, viewMode) && pointInPolygon(p, roofOutlineWithOverhang(r)));
  return roof ? { kind: 'roof', id: roof.id } : null;
}

type DragState =
  | {
      kind: 'move';
      startScreen: Vec2;
      grab: Vec2;
      origins: Record<Id, Vec2>;
      /** When dragging one node directly, it snaps like a cursor. */
      single: Id | null;
      started: boolean;
      /**
       * Walls of the house as it stands, moved while drawing new work: the drag is shown live but
       * kept out of the history, and at the end the plan goes back to `startPlan` and the move is
       * asked about (ui/wallMove.ts requestWallMove), so whichever way it goes is one undo step.
       */
      ask: boolean;
      startPlan: Plan;
      walls: Id[];
      step: Vec2;
      paused: boolean;
    }
  | {
      kind: 'opening';
      id: Id;
      startScreen: Vec2;
      /** Opening offset minus the cursor's position along the wall at grab time. */
      grabDelta: number;
      started: boolean;
      /** The opening was already the only thing selected: a click (no drag) selects this wall. */
      cycleTo: Id | null;
    }
  | ({ kind: 'room' } & RoomDrag)
  | { kind: 'stairs'; id: Id; grab: Vec2; origin: Vec2; startScreen: Vec2; started: boolean }
  /** A staircase's pieces, moved together. */
  | { kind: 'staircase'; grab: Vec2; origins: Record<Id, Vec2>; startScreen: Vec2; started: boolean }
  /** The selected fixtures, moved together. */
  | { kind: 'fixtures'; grab: Vec2; origins: Record<Id, Vec2>; startScreen: Vec2; started: boolean }
  /** An outline corner of a selected roof, deck or floor opening. */
  | { kind: 'outline-vertex'; target: 'roofs' | 'decks' | 'floorOpenings'; id: Id; index: number; startScreen: Vec2; started: boolean }
  | { kind: 'box'; a: Vec2; additive: boolean }
  /** Moving the image underlay (state kept by underlayTool.ts). */
  | { kind: 'underlay' };

let drag: DragState | null = null;

const toggle = (list: Id[], id: Id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

function nodesToMove(level: Level, sel: Selection): Record<Id, Vec2> {
  const ids = new Set(sel.nodes);
  for (const wid of sel.walls) {
    const w = level.walls[wid];
    if (w) {
      ids.add(w.a);
      ids.add(w.b);
    }
  }
  const out: Record<Id, Vec2> = {};
  for (const id of ids) {
    const n = level.nodes[id];
    if (n) out[id] = { x: n.x, y: n.y };
  }
  return out;
}

function pruneSelection(ctx: ToolContext): void {
  const level = ctx.level();
  const sel = ctx.ui().selection;
  const nodes = sel.nodes.filter((id) => level.nodes[id]);
  const walls = sel.walls.filter((id) => level.walls[id]);
  const openings = sel.openings.filter((id) => level.openings[id]);
  const rooms = sel.rooms.filter((id) => level.rooms[id]);
  const stairs = sel.stairs.filter((id) => level.stairs[id]);
  const roofs = sel.roofs.filter((id) => level.roofs[id]);
  const fixtures = sel.fixtures.filter((id) => level.fixtures[id]);
  const decks = sel.decks.filter((id) => level.decks?.[id]);
  const floorOpenings = sel.floorOpenings.filter((id) => level.floorOpenings?.[id]);
  const staircases = sel.staircases.filter((id) => level.staircases?.[id]);
  if (nodes.length + walls.length + openings.length + rooms.length + stairs.length + roofs.length + fixtures.length + decks.length + floorOpenings.length + staircases.length + sel.gradePoints.length + sel.columns.length !== selectionSize(sel)) {
    ctx.ui().setSelection({ ...sel, nodes, walls, openings, rooms, stairs, roofs, fixtures, decks, floorOpenings, staircases });
  }
}

/** A drag's displacement in words, e.g. `moved 6 1/2" east` or `moved 2" east, 1'-0" south`. */
export function displacementText(d: Vec2, denom: number): string {
  const parts: string[] = [];
  const tiny = 0.5 / denom;
  if (Math.abs(d.x) >= tiny) parts.push(`${formatLength(Math.abs(d.x), denom)} ${d.x > 0 ? 'east' : 'west'}`);
  if (Math.abs(d.y) >= tiny) parts.push(`${formatLength(Math.abs(d.y), denom)} ${d.y > 0 ? 'south' : 'north'}`);
  return parts.length ? `moved ${parts.join(', ')}` : 'moved 0"';
}

/** Screen directions of the arrow keys on the plan (y down). */
const ARROW_DIRS: Record<string, { v: Vec2; name: string }> = {
  ArrowUp: { v: { x: 0, y: -1 }, name: 'north' },
  ArrowDown: { v: { x: 0, y: 1 }, name: 'south' },
  ArrowLeft: { v: { x: -1, y: 0 }, name: 'west' },
  ArrowRight: { v: { x: 1, y: 0 }, name: 'east' },
};

/** Shift+arrow with walls selected: move them 1" across, the way the arrow points. True when handled. */
function nudgeWalls(ctx: ToolContext, e: KeyboardEvent): boolean {
  const arrow = ARROW_DIRS[e.key];
  const ui = ctx.ui();
  const walls = ui.selection.walls.filter((id) => ctx.level().walls[id]);
  if (!arrow || !e.shiftKey || ui.underlaySelected || walls.length === 0) return false;
  const shifts = nudgeShifts(ctx.level(), walls, arrow.v, 1);
  if (shifts.size === 0) {
    const along = arrow.v.x === 0 ? 'north-south' : 'east-west';
    ui.patchDraft({ message: `The selected ${walls.length === 1 ? 'wall runs' : 'walls run'} ${along}: use an arrow across ${walls.length === 1 ? 'it' : 'them'}.`, error: true });
    return true;
  }
  const n = shifts.size;
  const all = Object.fromEntries(shifts);
  requestWallMove({ levelId: ctx.levelId, wallId: n === 1 ? [...shifts.keys()][0] : null, shifts: all, what: `Moved ${n === 1 ? 'the wall' : `${n} walls`} 1" ${arrow.name}`, correct: () => ctx.actions.shiftWalls(ctx.levelId, all) });
  return true;
}

function finishDrag(ctx: ToolContext): void {
  if (ctx.ui().draft.dragReadout) ctx.ui().patchDraft({ dragReadout: null });
  if (drag?.kind === 'move' && drag.ask) {
    // Back to where the drag began (still paused, so no step is recorded), then ask.
    const d = drag;
    if (d.paused) {
      usePlanStore.setState({ plan: d.startPlan });
      resumeHistory();
    }
    if (!d.started) return;
    const level = d.startPlan.levels[ctx.levelId];
    if (!level) return;
    const shifts: Record<Id, Vec2> = {};
    for (const id of d.walls) if (level.walls[id]) shifts[id] = perpendicularShift(level, id, d.step);
    const positions: Record<Id, Vec2> = {};
    for (const [id, o] of Object.entries(d.origins)) positions[id] = add(o, d.step);
    const denom = d.startPlan.settings.precisionDenominator;
    requestWallMove({
      levelId: ctx.levelId,
      wallId: d.walls.length === 1 ? d.walls[0] : null,
      shifts,
      what: `${d.walls.length === 1 ? 'The wall' : `${d.walls.length} walls`} ${displacementText(d.step, denom)}`,
      correct: () => {
        const before = ctx.plan();
        ctx.actions.moveNodes(ctx.levelId, positions);
        return ctx.plan() === before ? WALL_OVERLAP_MESSAGE : null;
      },
    });
    pruneSelection(ctx);
  } else if (drag?.kind === 'move' && drag.started) {
    // Still paused: the normalize pass belongs to the same undo step as the drag.
    ctx.actions.normalize(ctx.levelId, Object.keys(drag.origins));
    resumeHistory();
    pruneSelection(ctx);
  } else if ((drag?.kind === 'opening' || drag?.kind === 'stairs' || drag?.kind === 'staircase' || drag?.kind === 'fixtures' || drag?.kind === 'outline-vertex') && drag.started) {
    resumeHistory();
  } else if (drag?.kind === 'room') {
    endRoomDrag(drag);
  } else if (drag?.kind === 'underlay') {
    endUnderlayDrag();
  }
}

/** Position of p along an opening's wall, or null if the wall is gone. */
function alongWall(ctx: ToolContext, openingId: Id, p: Vec2): number | null {
  const level = ctx.level();
  const o = level.openings[openingId];
  const fp = o && getFootprints(level, ctx.ui().viewMode).get(o.wallId);
  return fp ? dot(sub(p, fp.a), fp.dir) : null;
}

function selectHit(sel: Selection, hit: NonNullable<Hit>): Selection {
  const key = SEL_KEY[hit.kind];
  return sel[key].includes(hit.id) ? sel : { ...EMPTY_SELECTION, [key]: [hit.id] };
}

export const selectTool: Tool = {
  onPointerDown(e, ctx) {
    // Right-click: the canvas menu ("Walk from here", "Split wall here", PlanContextMenu.tsx) at the clicked point.
    if (e.button === 2) {
      const under = hitTest(ctx.level(), e.world, ctx.ui().viewport.k, ctx.ui().viewMode);
      ctx.ui().setContextMenu({ screen: e.screen, world: e.world, levelId: ctx.levelId, ...(under?.kind === 'wall' ? { wallId: under.id } : {}) });
      return;
    }
    if (e.button !== 0) return;
    const ui = ctx.ui();
    const level = ctx.level();
    const sel = ui.selection;
    // Messages from the last action (a refused drag, a wall move) last until the next click.
    if (ui.draft.message) ui.patchDraft({ message: null, error: false });
    // A selected roof's, deck's or floor opening's corner handle: drag it (snapping like the tool that drew it).
    const roofHandle = e.shiftKey ? null : hitRoofHandle(level, sel.roofs, e.world, ui.viewport.k);
    const deckHandle = e.shiftKey || roofHandle ? null : hitDeckHandle(level, sel.decks, e.world, ui.viewport.k);
    const foHandle = e.shiftKey || roofHandle || deckHandle ? null : hitFloorOpeningHandle(level, sel.floorOpenings, e.world, ui.viewport.k);
    const handle = roofHandle ?? deckHandle ?? foHandle;
    if (handle) {
      drag = { kind: 'outline-vertex', target: roofHandle ? 'roofs' : deckHandle ? 'decks' : 'floorOpenings', id: handle.id, index: handle.index, startScreen: e.screen, started: false };
      return;
    }
    const hit = liftToStaircase(level, hitTest(level, e.world, ui.viewport.k, ui.viewMode), ui.openStaircaseId);
    // A click off the open staircase's pieces closes it.
    if (ui.openStaircaseId && !(hit?.kind === 'stairs' && level.stairs[hit.id]?.staircaseId === ui.openStaircaseId)) ui.setOpenStaircase(null);

    if (!hit) {
      // An unlocked underlay under the cursor is selected and dragged; Shift still box-selects.
      if (!e.shiftKey && startUnderlayDrag(ctx, e)) {
        drag = { kind: 'underlay' };
        return;
      }
      if (!e.shiftKey) ui.clearSelection();
      drag = { kind: 'box', a: e.world, additive: e.shiftKey };
      return;
    }
    if (e.shiftKey) {
      const key = SEL_KEY[hit.kind];
      ui.setSelection({ ...sel, [key]: toggle(sel[key], hit.id) });
      drag = null;
      return;
    }
    const next = selectHit(sel, hit);
    if (next !== sel) ui.setSelection(next);
    if (hit.kind === 'room') {
      const rd = startRoomDrag(ctx, hit.id, e);
      drag = rd ? { kind: 'room', ...rd } : null;
      return;
    }
    if (hit.kind === 'roof' || hit.kind === 'deck' || hit.kind === 'floorOpening') {
      drag = null;
      return;
    }
    if (hit.kind === 'stairs') {
      const st = level.stairs[hit.id];
      drag = { kind: 'stairs', id: hit.id, grab: e.world, origin: { ...st.origin }, startScreen: e.screen, started: false };
      return;
    }
    if (hit.kind === 'staircase') {
      const origins: Record<Id, Vec2> = {};
      for (const st of Object.values(level.stairs)) if (st.staircaseId === hit.id) origins[st.id] = { ...st.origin };
      drag = { kind: 'staircase', grab: e.world, origins, startScreen: e.screen, started: false };
      return;
    }
    if (hit.kind === 'fixture') {
      // Every selected fixture moves with the one grabbed.
      const origins: Record<Id, Vec2> = {};
      for (const id of next.fixtures) if (level.fixtures[id]) origins[id] = { ...level.fixtures[id].origin };
      drag = { kind: 'fixtures', grab: e.world, origins, startScreen: e.screen, started: false };
      return;
    }
    if (hit.kind === 'opening') {
      // Already the only thing selected: a click (not a drag) goes on to its wall.
      const sole = selectionSize(sel) === 1 && sel.openings[0] === hit.id;
      const s = alongWall(ctx, hit.id, e.world);
      drag =
        s === null
          ? null
          : {
              kind: 'opening',
              id: hit.id,
              startScreen: e.screen,
              grabDelta: level.openings[hit.id].offset - s,
              started: false,
              cycleTo: sole ? level.openings[hit.id].wallId : null,
            };
      return;
    }
    let origins: Record<Id, Vec2>;
    let single: Id | null = null;
    if (hit.kind === 'node') {
      const n = level.nodes[hit.id];
      origins = { [hit.id]: { x: n.x, y: n.y } };
      single = hit.id;
    } else {
      origins = nodesToMove(level, next);
    }
    const walls = single ? [] : next.walls.filter((id) => level.walls[id]);
    drag = { kind: 'move', startScreen: e.screen, grab: e.world, origins, single, started: false, ask: walls.length > 0 && needsRenovationChoice(ctx.levelId, walls), startPlan: ctx.plan(), walls, step: { x: 0, y: 0 }, paused: false };
  },

  onPointerMove(e, ctx) {
    const ui = ctx.ui();
    if (!drag) {
      const hit = hitTest(ctx.level(), e.world, ui.viewport.k, ui.viewMode);
      ui.setHover({
        nodeId: hit?.kind === 'node' ? hit.id : null,
        wallId: hit?.kind === 'wall' ? hit.id : null,
        openingId: hit?.kind === 'opening' ? hit.id : null,
      });
      ctx.ui().patchDraft({ cursor: e.world, snap: null });
      return;
    }
    if (drag.kind === 'underlay') {
      moveUnderlayDrag(ctx, e);
      return;
    }
    if (drag.kind === 'room') {
      moveRoomDrag(ctx, drag, e);
      ui.patchDraft({ cursor: e.world, snap: null });
      return;
    }
    if (drag.kind === 'box') {
      ui.patchDraft({ cursor: e.world, box: { a: drag.a, b: e.world } });
      return;
    }
    if (!drag.started && dist(e.screen, drag.startScreen) < DRAG_THRESHOLD_PX) return;

    if (drag.kind === 'stairs') {
      const grid = ctx.plan().settings.snapGrid;
      const round = (v: number) => (grid > 0 ? Math.round(v / grid) * grid : v);
      const d = sub(e.world, drag.grab);
      ui.patchDraft({ cursor: e.world, snap: null });
      ctx.actions.updateStairs(ctx.levelId, drag.id, { origin: add(drag.origin, { x: round(d.x), y: round(d.y) }) });
      if (!drag.started) {
        drag.started = true;
        pauseHistory();
      }
      return;
    }

    if (drag.kind === 'staircase') {
      const grid = ctx.plan().settings.snapGrid;
      const round = (v: number) => (grid > 0 ? Math.round(v / grid) * grid : v);
      const d = sub(e.world, drag.grab);
      const step = { x: round(d.x), y: round(d.y) };
      const positions: Record<Id, Vec2> = {};
      for (const [id, o] of Object.entries(drag.origins)) positions[id] = add(o, step);
      ui.patchDraft({ cursor: e.world, snap: null, dragReadout: displacementText(step, ctx.plan().settings.precisionDenominator) });
      const before = ctx.plan();
      ctx.actions.moveStairs(ctx.levelId, positions);
      if (!drag.started && ctx.plan() !== before) {
        drag.started = true;
        pauseHistory();
      }
      return;
    }

    if (drag.kind === 'fixtures') {
      const grid = ctx.plan().settings.snapGrid;
      const round = (v: number) => (grid > 0 ? Math.round(v / grid) * grid : v);
      const d = sub(e.world, drag.grab);
      const step = { x: round(d.x), y: round(d.y) };
      const positions: Record<Id, Vec2> = {};
      for (const [id, o] of Object.entries(drag.origins)) positions[id] = add(o, step);
      ui.patchDraft({ cursor: e.world, snap: null, dragReadout: displacementText(step, ctx.plan().settings.precisionDenominator) });
      ctx.actions.moveFixtures(ctx.levelId, positions);
      if (!drag.started) {
        drag.started = true;
        pauseHistory();
      }
      return;
    }

    if (drag.kind === 'outline-vertex') {
      const lv = ctx.level();
      const item = drag.target === 'roofs' ? lv.roofs[drag.id] : drag.target === 'decks' ? lv.decks?.[drag.id] : lv.floorOpenings?.[drag.id];
      if (!item) return;
      const n = item.outline.length;
      // Ortho from the previous corner, like drawing it.
      const snap = outlineSnap(ctx, e.world, e.shiftKey, item.outline[(drag.index + n - 1) % n]);
      ui.patchDraft({ cursor: e.world, snap });
      const index = drag.index;
      const outline = item.outline.map((p, i) => (i === index ? snap.point : p));
      const before = ctx.plan();
      if (drag.target === 'roofs') ctx.actions.updateRoof(ctx.levelId, drag.id, { outline });
      // A deck's or floor opening's outline may not cross itself (its railings follow its edges).
      else if (selfIntersects(outline)) {
        // Refused: the corner stays where it was.
      } else if (drag.target === 'decks') ctx.actions.updateDeck(ctx.levelId, drag.id, { outline });
      else ctx.actions.updateFloorOpening(ctx.levelId, drag.id, { outline });
      // The first step that changes the outline is the tracked one (the corner snap can hold the
      // first few moves in place; pausing before a change would leave the drag out of the history).
      if (!drag.started && ctx.plan() !== before) {
        drag.started = true;
        pauseHistory();
      }
      return;
    }

    if (drag.kind === 'opening') {
      const s = alongWall(ctx, drag.id, e.world);
      if (s === null) return;
      const grid = ctx.plan().settings.snapGrid;
      const raw = s + drag.grabDelta;
      const offset = grid > 0 ? Math.round(raw / grid) * grid : raw;
      ui.patchDraft({ cursor: e.world, snap: null });
      // The store clamps the offset to the wall.
      ctx.actions.updateOpening(ctx.levelId, drag.id, { offset });
      if (!drag.started) {
        drag.started = true;
        pauseHistory();
      }
      return;
    }

    const positions: Record<Id, Vec2> = {};
    if (drag.single) {
      const origin = drag.origins[drag.single];
      const snap = ctx.snap(add(origin, sub(e.world, drag.grab)), {
        shift: e.shiftKey,
        excludeNodeIds: new Set([drag.single]),
      });
      positions[drag.single] = snap.point;
      ui.patchDraft({ cursor: e.world, snap });
    } else {
      const grid = ctx.plan().settings.snapGrid;
      const round = (v: number) => (grid > 0 ? Math.round(v / grid) * grid : v);
      const delta = sub(e.world, drag.grab);
      const step = { x: round(delta.x), y: round(delta.y) };
      for (const [id, o] of Object.entries(drag.origins)) positions[id] = add(o, step);
      ui.patchDraft({ cursor: e.world, snap: null });
    }
    // A move to be asked about is kept out of the history from its first step.
    if (drag.ask && !drag.paused) {
      pauseHistory();
      drag.paused = true;
    }
    const before = ctx.plan();
    ctx.actions.moveNodes(ctx.levelId, positions, { normalize: false });
    if (ctx.plan() === before) {
      // Refused (a wall would land on top of another): the nodes stay at the last good position.
      ui.patchDraft({ message: WALL_OVERLAP_MESSAGE, error: true });
      return;
    }
    if (ui.draft.message === WALL_OVERLAP_MESSAGE) ui.patchDraft({ message: null, error: false });
    // Live displacement of the drag in the status bar (REVIEW-2 B3).
    const key = drag.single ?? Object.keys(positions)[0];
    if (key) ui.patchDraft({ dragReadout: displacementText(sub(positions[key], drag.origins[key]), ctx.plan().settings.precisionDenominator) });
    if (key) drag.step = sub(positions[key], drag.origins[key]);
    if (!drag.started) {
      // First set of the drag that changes the plan is tracked; the rest are folded into it.
      drag.started = true;
      if (!drag.paused) pauseHistory();
    }
  },

  onPointerUp(e, ctx) {
    const ui = ctx.ui();
    if (drag?.kind === 'opening' && !drag.started && drag.cycleTo && ctx.level().walls[drag.cycleTo]) {
      ui.setSelection({ ...EMPTY_SELECTION, walls: [drag.cycleTo] });
    }
    if (drag && drag.kind !== 'box') finishDrag(ctx);
    else if (drag?.kind === 'box') {
      const a = drag.a;
      const b = e.world;
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      const inside = (p: Vec2) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
      const level = ctx.level();
      const walls = Object.values(level.walls)
        .filter((w) => isVisible(w.phase, ui.viewMode) && inside(level.nodes[w.a]) && inside(level.nodes[w.b]))
        .map((w) => w.id);
      const sel = ui.selection;
      if (Math.max(maxX - minX, maxY - minY) * ui.viewport.k > DRAG_THRESHOLD_PX) {
        ui.setSelection(
          drag.additive
            ? { ...sel, walls: [...new Set([...sel.walls, ...walls])] }
            : { ...EMPTY_SELECTION, walls },
        );
      }
      ui.patchDraft({ box: null });
    }
    drag = null;
  },

  onDoubleClick(e, ctx) {
    const ui = ctx.ui();
    const level = ctx.level();
    const hit = hitTest(level, e.world, ui.viewport.k, ui.viewMode);
    if (hit?.kind === 'room') startRename(ctx, hit.id);
    // A piece of a staircase: open the staircase and select the piece alone.
    if (hit?.kind === 'stairs') {
      const sc = level.stairs[hit.id]?.staircaseId;
      if (sc && level.staircases?.[sc]) {
        ui.setOpenStaircase(sc);
        ui.setSelection({ ...EMPTY_SELECTION, stairs: [hit.id] });
      }
    }
  },

  onKeyDown(e, ctx) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const ui = ctx.ui();
    const sel = ui.selection;
    if ((e.key === 'Enter' || e.key === 'F2') && selectionSize(sel) === 1 && sel.rooms.length === 1) {
      startRename(ctx, sel.rooms[0]);
      return true;
    }
    if (ui.underlaySelected) {
      if (nudgeUnderlay(ctx, e)) return true;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        confirmRemoveUnderlay(ctx.levelId);
        return true;
      }
      if (e.key === 'Escape' && !drag) {
        ui.selectUnderlay(false);
        return true;
      }
    }
    if (!drag && nudgeWalls(ctx, e)) return true;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!selectionSize(sel)) return false;
      ctx.actions.deleteEntities(ctx.levelId, sel);
      ui.clearSelection();
      ui.setHover({});
      return true;
    }
    if (e.key === 'Escape') {
      if (drag) {
        selectTool.cancel(ctx);
        return true;
      }
      // An open staircase closes back to the staircase selected.
      if (ui.openStaircaseId) {
        const sc = ui.openStaircaseId;
        ui.setOpenStaircase(null);
        if (ctx.level().staircases?.[sc]) ui.setSelection({ ...EMPTY_SELECTION, staircases: [sc] });
        return true;
      }
      if (!selectionSize(sel)) return false;
      ui.clearSelection();
      return true;
    }
    return false;
  },

  cancel(ctx) {
    finishDrag(ctx);
    drag = null;
    ctx.ui().patchDraft({ box: null, snap: null, dragReadout: null });
  },
};
