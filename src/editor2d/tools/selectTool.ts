import { getFootprints } from '../../derive/footprint';
import { hitOpening } from '../../derive/openings';
import { isOpeningVisible, isVisible, visibleNodeIds } from '../../derive/phase';
import { add, dist, dot, projectPointToSegment, sub } from '../../model/geometry';
import type { Id, Level, Vec2, ViewMode } from '../../model/types';
import { pauseHistory, resumeHistory } from '../../store/planStore';
import { EMPTY_SELECTION, selectionSize, type Selection } from '../../store/uiStore';
import { hitRoomLabel } from '../roomLabels';
import { SNAP_RADIUS_PX } from '../snap';
import type { Tool, ToolContext } from './index';
import { endRoomDrag, moveRoomDrag, startRename, startRoomDrag, type RoomDrag } from './roomTool';

const DRAG_THRESHOLD_PX = 3;
/** Minimum half-width of a wall's pick area, in screen px. */
const WALL_PICK_PX = 4;
/** Pick radius around opening symbols (door leaf and arc), in screen px. */
const OPENING_PICK_PX = 4;

export type Hit =
  | { kind: 'node'; id: Id }
  | { kind: 'opening'; id: Id }
  | { kind: 'wall'; id: Id }
  | { kind: 'room'; id: Id }
  | null;

const SEL_KEY = { node: 'nodes', wall: 'walls', opening: 'openings', room: 'rooms' } as const;

/**
 * Priority: nodes within 10px, then opening symbols, then walls, then room labels. Elements
 * hidden in `viewMode` are never hit.
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
  for (const o of Object.values(level.openings)) {
    if (!isOpeningVisible(o, level.walls[o.wallId], viewMode)) continue;
    const fp = fps.get(o.wallId);
    if (fp && hitOpening(fp, o, p, OPENING_PICK_PX / k)) return { kind: 'opening', id: o.id };
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
  const room = hitRoomLabel(level, viewMode, p, k);
  return room ? { kind: 'room', id: room } : null;
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
    }
  | {
      kind: 'opening';
      id: Id;
      startScreen: Vec2;
      /** Opening offset minus the cursor's position along the wall at grab time. */
      grabDelta: number;
      started: boolean;
    }
  | ({ kind: 'room' } & RoomDrag)
  | { kind: 'box'; a: Vec2; additive: boolean };

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
  if (nodes.length + walls.length + openings.length + rooms.length !== selectionSize(sel)) {
    ctx.ui().setSelection({ nodes, walls, openings, rooms });
  }
}

function finishDrag(ctx: ToolContext): void {
  if (drag?.kind === 'move' && drag.started) {
    // Still paused: the normalize pass belongs to the same undo step as the drag.
    ctx.actions.normalize(ctx.levelId, Object.keys(drag.origins));
    resumeHistory();
    pruneSelection(ctx);
  } else if (drag?.kind === 'opening' && drag.started) {
    resumeHistory();
  } else if (drag?.kind === 'room') {
    endRoomDrag(drag);
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
    if (e.button !== 0) return;
    const ui = ctx.ui();
    const level = ctx.level();
    const hit = hitTest(level, e.world, ui.viewport.k, ui.viewMode);
    const sel = ui.selection;

    if (!hit) {
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
    if (hit.kind === 'opening') {
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
    drag = { kind: 'move', startScreen: e.screen, grab: e.world, origins, single, started: false };
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
    ctx.actions.moveNodes(ctx.levelId, positions, { normalize: false });
    if (!drag.started) {
      // First set of the drag is tracked; the rest are folded into it.
      drag.started = true;
      pauseHistory();
    }
  },

  onPointerUp(e, ctx) {
    const ui = ctx.ui();
    if (drag?.kind === 'move' || drag?.kind === 'opening' || drag?.kind === 'room') finishDrag(ctx);
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
    const hit = hitTest(ctx.level(), e.world, ui.viewport.k, ui.viewMode);
    if (hit?.kind === 'room') startRename(ctx, hit.id);
  },

  onKeyDown(e, ctx) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const ui = ctx.ui();
    const sel = ui.selection;
    if ((e.key === 'Enter' || e.key === 'F2') && selectionSize(sel) === 1 && sel.rooms.length === 1) {
      startRename(ctx, sel.rooms[0]);
      return true;
    }
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
      if (!selectionSize(sel)) return false;
      ui.clearSelection();
      return true;
    }
    return false;
  },

  cancel(ctx) {
    finishDrag(ctx);
    drag = null;
    ctx.ui().patchDraft({ box: null, snap: null });
  },
};
