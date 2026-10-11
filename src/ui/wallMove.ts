// Moving walls by a distance (docs/REVIEW-2.md B1): the panel's Move buttons and the select tool's
// Shift+arrow nudges run the store action through here, which then says in the status bar what the
// rooms either side of the wall measure now.
import { faceOfRoom, facesBesideWall, getFaces, roomDimensions, type Face, type FaceSet } from '../derive/rooms';
import type { WallSide } from '../model/offset';
import type { Id, Level, Wall } from '../model/types';
import { formatArea, formatLength } from '../model/units';
import { getPlan } from '../store/planStore';
import { useUiStore } from '../store/uiStore';

/** Name of the room a face belongs to, or null (no face, or a face no room names). */
export function roomNameOf(level: Level, face: Face | null): string | null {
  const room = face?.roomId ? level.rooms[face.roomId] : undefined;
  const name = room?.name.trim();
  return name ? name : null;
}

/**
 * How the panel names each side of a wall: the room there, "outside" for the open side of an
 * exterior wall, else "left of wall" / "right of wall".
 */
export function wallSideNames(level: Level, set: FaceSet, wall: Wall): Record<WallSide, string> {
  const sides = facesBesideWall(set, wall);
  const name = (side: WallSide): string => {
    const face = sides[side];
    const room = roomNameOf(level, face);
    if (room) return room;
    if (!face && wall.kind === 'exterior') return 'outside';
    return side === 'left' ? 'left of wall' : 'right of wall';
  };
  return { left: name('left'), right: name('right') };
}

/** A room's net size: width x depth for a rectangle, else its net area. */
function sizeText(face: Face, denom: number): string {
  const rect = roomDimensions(face.netPolygon).rect;
  return rect ? `${formatLength(rect.width, denom)} x ${formatLength(rect.depth, denom)}` : `${formatArea(face.netArea)} net`;
}

/**
 * Run a wall move (`run` returns null when done, else why not) and put the outcome in the status
 * bar: the refusal, or `what` followed by the new net sizes of the rooms either side of `wallId`.
 * Returns the refusal, or null.
 */
export function runWallMove(levelId: Id, wallId: Id | null, run: () => string | null, what: string): string | null {
  const ui = useUiStore.getState();
  const before = getPlan().levels[levelId];
  const wall = wallId ? before?.walls[wallId] : undefined;
  const vm = ui.viewMode;
  const sides = before && wall ? facesBesideWall(getFaces(before, vm), wall) : null;
  const rooms = { left: sides?.left?.roomId ?? null, right: sides?.right?.roomId ?? null };
  const problem = run();
  if (problem) {
    ui.patchDraft({ message: problem, error: true });
    return problem;
  }
  const after = getPlan().levels[levelId];
  const parts: string[] = [];
  if (after && wallId) {
    const set = getFaces(after, vm);
    const denom = getPlan().settings.precisionDenominator;
    const now = after.walls[wallId] ? facesBesideWall(set, after.walls[wallId]) : { left: null, right: null };
    for (const side of ['left', 'right'] as const) {
      const roomId = rooms[side];
      const face = roomId ? faceOfRoom(set, roomId) : now[side];
      if (!face) continue;
      parts.push(`${roomNameOf(after, face) ?? (side === 'left' ? 'left side' : 'right side')} ${sizeText(face, denom)}`);
    }
  }
  ui.patchDraft({ message: parts.length ? `${what}. Now ${parts.join(', ')}.` : `${what}.`, error: false });
  return null;
}
