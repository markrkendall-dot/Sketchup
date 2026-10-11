import { faceAt, getFaces, type Face, type FaceSet } from '../derive/rooms';
import type { Id, Level, Room, Vec2, ViewMode } from '../model/types';

// Room labels are drawn at constant screen size (scale(1/k)), so their layout and hit boxes are in
// screen px around a world anchor point. Shared by PlanLayers (drawing) and the tools (picking).

/** Baseline offsets of the name and area lines from the label point, screen px. */
export const ROOM_NAME_DY = -7;
export const ROOM_AREA_DY = 9;
/** Spacing of the lines of a wrapped room name, screen px; the first line moves up by this much. */
export const ROOM_NAME_LINE_PX = 15;
/** Names longer than this wrap onto a second line (REVIEW-2 C2). */
export const ROOM_NAME_WRAP = 18;

/**
 * A room name as one or two lines: up to ROOM_NAME_WRAP characters stay on one line. Longer names
 * break before a parenthesis when both parts then fit ("Guest" / "(11'5\" adjusted)"), else at the
 * last space that keeps the first line within the limit, with the rest on the second line. A name
 * with no space to break at stays on one line.
 */
export function roomNameLines(name: string, max = ROOM_NAME_WRAP): string[] {
  const text = name.trim();
  if (text.length <= max) return [text];
  const paren = text.indexOf(' (');
  if (paren > 0) {
    const a = text.slice(0, paren).trim();
    const b = text.slice(paren + 1).trim();
    if (a.length <= max && b.length <= max) return [a, b];
  }
  let cut = text.lastIndexOf(' ', max);
  if (cut <= 0) cut = text.indexOf(' ');
  if (cut <= 0) return [text];
  return [text.slice(0, cut).trim(), text.slice(cut + 1).trim()];
}
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

/** Width of a face's net polygon's bounding box, inches (cached per face). */
const faceWidths = new WeakMap<Face, number>();
export function faceWidth(face: Face): number {
  let w = faceWidths.get(face);
  if (w === undefined) {
    const xs = face.netPolygon.map((p) => p.x);
    faceWidths.set(face, (w = Math.max(...xs) - Math.min(...xs)));
  }
  return w;
}

/**
 * Where a room name wraps in a face `width` inches wide (null: no face) at zoom k: after ROOM_NAME_WRAP characters, or sooner when one
 * line would be wider than the room on screen (a closet's "Master closet" becomes two lines).
 */
export function nameWrapFor(width: number | null, k: number): number {
  if (width === null) return ROOM_NAME_WRAP;
  const fit = Math.floor((width * k - 8) / NAME_CHAR_PX);
  return Math.max(1, Math.min(ROOM_NAME_WRAP, fit));
}

/** Half extents of a label's hit box in screen px (two lines: name, then area or warning). */
function labelBox(label: RoomLabel, k: number): { half: number; up: number; down: number } {
  const lines = label.room ? roomNameLines(label.room.name, nameWrapFor(label.face ? faceWidth(label.face) : null, k)) : [];
  const nameW = Math.max(0, ...lines.map((l) => l.length * NAME_CHAR_PX));
  const second = label.face ? 10 : 14; // "1,234 sq ft" / "shares an area"
  const half = Math.max(nameW, second * AREA_CHAR_PX, 24) / 2 + 4;
  return { half, up: 16 + Math.max(0, lines.length - 1) * ROOM_NAME_LINE_PX, down: 16 };
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
    const box = labelBox(label, k);
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
