import { isOpeningVisible, isVisible, VIEW_MODES, visibleNodeIds } from '../../derive/phase';
import { getPlan, usePlanStore, type PlanState } from '../../store/planStore';
import {
  selectionSize,
  useUiStore,
  type SnapResult,
  type ToolName,
  type UiState,
  type UnderlayMode,
} from '../../store/uiStore';
import type { Id, Level, Plan, Vec2, ViewMode } from '../../model/types';
import { snapPoint } from '../snap';
import { doorTool, passageTool, windowTool } from './openingTool';
import { roomTool } from './roomTool';
import { selectTool } from './selectTool';
import { stairsTool } from './stairsTool';
import { requestUnderlayImage, underlayTool } from './underlayTool';
import { wallTool } from './wallTool';

export interface ToolPointerEvent {
  /** World point, inches. */
  world: Vec2;
  /** Screen point relative to the canvas, px. */
  screen: Vec2;
  button: number;
  shiftKey: boolean;
  altKey: boolean;
  /** Ctrl or Cmd. */
  modKey: boolean;
}

export interface SnapOptions {
  from?: Vec2 | null;
  shift: boolean;
  excludeNodeIds?: ReadonlySet<Id>;
}

export interface ToolContext {
  levelId: Id;
  plan: () => Plan;
  /** The active level; read fresh after mutations. */
  level: () => Level;
  /** Plan store actions (stable references). */
  actions: PlanState;
  ui: () => UiState;
  snap: (raw: Vec2, opts: SnapOptions) => SnapResult;
}

export interface Tool {
  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void;
  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void;
  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void;
  /** Return true when the key was consumed (the caller then calls preventDefault). */
  onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean;
  onDoubleClick(e: ToolPointerEvent, ctx: ToolContext): void;
  /** Abort any in-progress interaction (tool switch, level switch). */
  cancel(ctx: ToolContext): void;
}

const tools: Record<ToolName, Tool> = {
  select: selectTool,
  wall: wallTool,
  room: roomTool,
  door: doorTool,
  window: windowTool,
  passage: passageTool,
  stairs: stairsTool,
  underlay: underlayTool,
};

export const getTool = (name: ToolName): Tool => tools[name];

export function makeToolContext(): ToolContext | null {
  const levelId = useUiStore.getState().activeLevelId;
  if (!getPlan().levels[levelId]) return null;
  return {
    levelId,
    plan: getPlan,
    level: () => getPlan().levels[levelId],
    actions: usePlanStore.getState(),
    ui: useUiStore.getState,
    snap: (raw, opts) => {
      const plan = getPlan();
      return snapPoint(raw, {
        level: plan.levels[levelId],
        k: useUiStore.getState().viewport.k,
        snapGrid: plan.settings.snapGrid,
        orthoLock: useUiStore.getState().orthoLock,
        shift: opts.shift,
        from: opts.from,
        excludeNodeIds: opts.excludeNodeIds,
        viewMode: useUiStore.getState().viewMode,
      });
    },
  };
}

// The last pointer event over the canvas, so modifier changes (Shift) and keyboard commits can
// re-run the active tool's move logic without a new mouse event.
let lastPointer: ToolPointerEvent | null = null;

export const getLastPointer = (): ToolPointerEvent | null => lastPointer;

type PointerPhase = 'down' | 'move' | 'up' | 'dblclick';

export function dispatchPointer(phase: PointerPhase, e: ToolPointerEvent): void {
  lastPointer = e;
  const ctx = makeToolContext();
  if (!ctx) return;
  const tool = getTool(ctx.ui().activeTool);
  if (phase === 'down') tool.onPointerDown(e, ctx);
  else if (phase === 'move') tool.onPointerMove(e, ctx);
  else if (phase === 'up') tool.onPointerUp(e, ctx);
  else tool.onDoubleClick(e, ctx);
}

export function dispatchKey(e: KeyboardEvent): boolean {
  const ctx = makeToolContext();
  if (!ctx) return false;
  return getTool(ctx.ui().activeTool).onKeyDown(e, ctx);
}

/** Re-run the move handler with a new Shift state (Shift inverts ortho while held). */
export function dispatchShift(shiftKey: boolean): void {
  if (!lastPointer || lastPointer.shiftKey === shiftKey) return;
  dispatchPointer('move', { ...lastPointer, shiftKey });
}

/** Cancel the active tool and switch to another. */
export function switchTool(name: ToolName): void {
  const ctx = makeToolContext();
  if (ctx) getTool(ctx.ui().activeTool).cancel(ctx);
  useUiStore.getState().setTool(name);
  if (lastPointer) dispatchPointer('move', lastPointer);
}

export function cancelActiveTool(): void {
  const ctx = makeToolContext();
  if (ctx) getTool(ctx.ui().activeTool).cancel(ctx);
}

// ---------------------------------------------------------------------------------------------
// Commands that touch both stores.

/** Drop selected ids that no longer exist or are hidden in the current view mode. */
export function pruneSelection(): void {
  const ui = useUiStore.getState();
  const level = getPlan().levels[ui.activeLevelId];
  const sel = ui.selection;
  if (level && ui.underlaySelected && !level.underlay) ui.selectUnderlay(false);
  if (!level || selectionSize(sel) === 0) return;
  const vm = ui.viewMode;
  const shownNodes = visibleNodeIds(level, vm);
  const nodes = sel.nodes.filter((id) => level.nodes[id] && shownNodes.has(id));
  const walls = sel.walls.filter((id) => level.walls[id] && isVisible(level.walls[id].phase, vm));
  const openings = sel.openings.filter((id) => {
    const o = level.openings[id];
    return o && isOpeningVisible(o, level.walls[o.wallId], vm);
  });
  const rooms = sel.rooms.filter((id) => level.rooms[id]);
  const stairs = sel.stairs.filter((id) => level.stairs[id] && isVisible(level.stairs[id].phase, vm));
  if (nodes.length + walls.length + openings.length + rooms.length + stairs.length !== selectionSize(sel)) {
    ui.setSelection({ nodes, walls, openings, rooms, stairs });
  }
  // An inline rename of a room that undo removed has nothing left to edit.
  const edit = ui.roomEdit;
  if (edit?.roomId && !level.rooms[edit.roomId]) ui.setRoomEdit(null);
}

/** Switch the active level: keeps the viewport, clears selection and any draft. */
export function switchLevel(levelId: Id): void {
  const ui = useUiStore.getState();
  if (ui.activeLevelId === levelId || !getPlan().levels[levelId]) return;
  cancelActiveTool();
  ui.setActiveLevel(levelId);
  if (lastPointer) dispatchPointer('move', lastPointer);
}

/** Select a level by its position from the bottom (0 = lowest). */
export function switchLevelByIndex(index: number): void {
  const id = getPlan().levelOrder[index];
  if (id) switchLevel(id);
}

export function setViewMode(mode: ViewMode): void {
  const ui = useUiStore.getState();
  if (ui.viewMode === mode) return;
  ui.setViewMode(mode);
  pruneSelection();
  // Re-run hover / ghost logic: the hovered wall may have just been hidden.
  if (lastPointer) dispatchPointer('move', lastPointer);
}

export function cycleViewMode(): void {
  const i = VIEW_MODES.indexOf(useUiStore.getState().viewMode);
  setViewMode(VIEW_MODES[(i + 1) % VIEW_MODES.length]);
}

/**
 * Switch to the underlay tool in a mode and select the image. With no image on the active level,
 * opens the file picker instead (the "Place" step).
 */
export function activateUnderlayTool(mode: UnderlayMode = 'move'): void {
  const ui = useUiStore.getState();
  const level = getPlan().levels[ui.activeLevelId];
  if (!level) return;
  if (ui.activeTool !== 'underlay') switchTool('underlay');
  if (!level.underlay) {
    requestUnderlayImage(level.id);
    return;
  }
  const after = useUiStore.getState();
  after.setUnderlayMode(mode);
  after.selectUnderlay(true);
  if (mode !== 'move' && level.underlay.locked) {
    after.patchDraft({ error: true, message: 'The image is locked. Unlock it in the properties panel first.' });
  }
}
