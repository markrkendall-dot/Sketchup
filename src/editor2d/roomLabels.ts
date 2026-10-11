import { faceAt, getFaces, type Face, type FaceSet } from '../derive/rooms';
import type { Id, Level, Room, Vec2, ViewMode } from '../model/types';

// Room labels are drawn at constant screen size (scale(1/k)), so their layout and hit boxes are in
// screen px around a world anchor point. Shared by PlanLayers (drawing) and the tools (picking).

/** Baseline offsets of the name and area lines from the label point, screen px. */
export const ROOM_NAME_DY = -7;
export const ROOM_AREA_DY = 9;
/** Approximate glyph widths for the hit box, px per character. */
const NAME_CHAR_PX = 7.6;
const AREA_CHAR_PX = 6.6;

export interface RoomLabel {
  /** Room shown, if any (faces without a room show only their area). */
  room: Room | null;
  face: Face | null;
  /** World position of the label. */
  at: Vec2;
  /** Why a room has no face of its own: its anchor is in no face, or in one an earlier room names. */
  orphan: false | 'outside' | 'shared';
}

/** Every label of a level in a view: one per face, plus one per orphan room at its anchor. */
export function roomLabels(level: Level, set: FaceSet): RoomLabel[] {
  const out: RoomLabel[] = set.faces.map((face) => ({
    room: face.roomId ? (level.rooms[face.roomId] ?? null) : null,
    face,
    at: face.labelPoint,
    orphan: false,
  }));
  for (const id of set.orphanRoomIds) {
    const room = level.rooms[id];
    if (room) out.push({ room, face: null, at: room.anchor, orphan: faceAt(set, room.anchor) ? 'shared' : 'outside' });
  }
  return out;
}

/** Half extents of a label's hit box in screen px (two lines: name, then area or warning). */
function labelBox(label: RoomLabel): { half: number; up: number; down: number } {
  const nameW = label.room ? label.room.name.length * NAME_CHAR_PX : 0;
  const second = label.face ? 10 : 14; // "1,234 sq ft" / "shares an area"
  const half = Math.max(nameW, second * AREA_CHAR_PX, 24) / 2 + 4;
  return { half, up: 16, down: 16 };
}

/**
 * The room whose label is under world point p (zoom k px/inch), or null. Labels of faces without
 * a room are not hit.
 */
export function hitRoomLabel(level: Level, viewMode: ViewMode, p: Vec2, k: number): Id | null {
  let best: Id | null = null;
  let bestD = Infinity;
  for (const label of roomLabels(level, getFaces(level, viewMode))) {
    if (!label.room) continue;
    const dx = (p.x - label.at.x) * k;
    const dy = (p.y - label.at.y) * k;
    const box = labelBox(label);
    if (Math.abs(dx) <= box.half && dy >= -box.up && dy <= box.down) {
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = label.room.id;
      }
    }
  }
  return best;
}

/** World position of a room's label in a view (its face's label point, or its anchor). */
export function roomLabelPoint(level: Level, viewMode: ViewMode, roomId: Id): Vec2 | null {
  const room = level.rooms[roomId];
  if (!room) return null;
  const face = getFaces(level, viewMode).faces.find((f) => f.roomId === roomId);
  return face ? face.labelPoint : room.anchor;
}
