import { faceAt, getFaces } from '../../derive/rooms';
import { add, dist, sub } from '../../model/geometry';
import type { Id, Vec2 } from '../../model/types';
import { pauseHistory, resumeHistory } from '../../store/planStore';
import { EMPTY_SELECTION } from '../../store/uiStore';
import { hitRoomLabel, roomLabelPoint } from '../roomLabels';
import type { Tool, ToolContext, ToolPointerEvent } from './index';

const DRAG_THRESHOLD_PX = 3;

// Dragging a room label moves the room's anchor (shared with the select tool). The label itself
// sits at its face's centroid, so it jumps when the anchor crosses into another face.
export interface RoomDrag {
  id: Id;
  grab: Vec2;
  origin: Vec2;
  startScreen: Vec2;
  started: boolean;
}

export function startRoomDrag(ctx: ToolContext, id: Id, e: ToolPointerEvent): RoomDrag | null {
  const room = ctx.level().rooms[id];
  if (!room) return null;
  return { id, grab: e.world, origin: { ...room.anchor }, startScreen: e.screen, started: false };
}

/** Move the anchor with the pointer once it has moved past the drag threshold. */
export function moveRoomDrag(ctx: ToolContext, drag: RoomDrag, e: ToolPointerEvent): void {
  if (!drag.started && dist(e.screen, drag.startScreen) < DRAG_THRESHOLD_PX) return;
  const grid = ctx.plan().settings.snapGrid;
  const round = (v: number) => (grid > 0 ? Math.round(v / grid) * grid : v);
  const d = sub(e.world, drag.grab);
  ctx.actions.updateRoom(ctx.levelId, drag.id, { anchor: add(drag.origin, { x: round(d.x), y: round(d.y) }) });
  if (!drag.started) {
    // First set of the drag is tracked; the rest fold into it.
    drag.started = true;
    pauseHistory();
  }
}

export function endRoomDrag(drag: RoomDrag | null): void {
  if (drag?.started) resumeHistory();
}

/** Open the inline name editor on an existing room, over its label. */
export function startRename(ctx: ToolContext, id: Id): void {
  const level = ctx.level();
  const room = level.rooms[id];
  const at = roomLabelPoint(level, ctx.ui().viewMode, id);
  if (!room || !at) return;
  ctx.ui().setSelection({ ...EMPTY_SELECTION, rooms: [id] });
  ctx.ui().setRoomEdit({ roomId: id, at, anchor: room.anchor, initial: room.name });
}

let drag: RoomDrag | null = null;

export const roomTool: Tool = {
  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    const ui = ctx.ui();
    const level = ctx.level();
    ui.patchDraft({ cursor: e.world, snap: null });
    const hit = hitRoomLabel(level, ui.viewMode, e.world, ui.viewport.k);
    if (hit) {
      ui.setSelection({ ...EMPTY_SELECTION, rooms: [hit] });
      ui.patchDraft({ error: false, message: null });
      drag = startRoomDrag(ctx, hit, e);
      return;
    }
    const face = faceAt(getFaces(level, ui.viewMode), e.world);
    if (!face) {
      ui.clearSelection();
      ui.patchDraft({ error: true, message: 'Click inside an area closed in by walls to name it.' });
      return;
    }
    if (face.roomId) {
      const name = level.rooms[face.roomId]?.name ?? '';
      ui.setSelection({ ...EMPTY_SELECTION, rooms: [face.roomId] });
      ui.patchDraft({ error: true, message: `This area is already named "${name}". Double-click its label to rename it.` });
      return;
    }
    ui.clearSelection();
    ui.patchDraft({ error: false, message: null });
    ui.setRoomEdit({ roomId: null, at: e.world, anchor: e.world, initial: '' });
  },

  onPointerMove(e, ctx) {
    if (drag) moveRoomDrag(ctx, drag, e);
    ctx.ui().patchDraft({ cursor: e.world, snap: null });
  },

  onPointerUp() {
    endRoomDrag(drag);
    drag = null;
  },

  onDoubleClick(e, ctx) {
    const ui = ctx.ui();
    const hit = hitRoomLabel(ctx.level(), ui.viewMode, e.world, ui.viewport.k);
    if (hit) startRename(ctx, hit);
  },

  onKeyDown(e, ctx) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const ui = ctx.ui();
    const rooms = ui.selection.rooms;
    if ((e.key === 'Delete' || e.key === 'Backspace') && rooms.length) {
      ctx.actions.deleteRooms(ctx.levelId, rooms);
      ui.clearSelection();
      return true;
    }
    if ((e.key === 'Enter' || e.key === 'F2') && rooms.length === 1) {
      startRename(ctx, rooms[0]);
      return true;
    }
    if (e.key === 'Escape') {
      if (drag) {
        roomTool.cancel(ctx);
        return true;
      }
      if (!rooms.length && !ui.draft.message) return false;
      ui.clearSelection();
      ui.patchDraft({ error: false, message: null });
      return true;
    }
    return false;
  },

  cancel(ctx) {
    endRoomDrag(drag);
    drag = null;
    ctx.ui().patchDraft({ error: false, message: null });
  },
};
