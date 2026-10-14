import { isOpeningVisible, isVisible, VIEW_MODES, visibleNodeIds } from '../../derive/phase';
import { getPlan, usePlanStore, type PlanState } from '../../store/planStore';
import {
  isSiteModeTool,
  selectionSize,
  SITE_MODE_TOOL_HINT,
  SITE_TOOLS,
  useUiStore,
  type SnapResult,
  type ToolName,
  type UiState,
  type UnderlayMode,
} from '../../store/uiStore';
import type { Id, Level, Plan, Vec2, ViewMode } from '../../model/types';
import { snapPoint, type GhostWall } from '../snap';
import { fixtureTool } from './fixtureTool';
import { doorTool, passageTool, windowTool } from './openingTool';
import { measureTool } from './measureTool';
import { rectTool } from './rectTool';
import { deckTool } from './deckTool';
import { roofTool } from './roofTool';
import { roomTool } from './roomTool';
import { selectTool } from './selectTool';
import { columnTool, gradePointTool, siteSelectTool } from './siteTools';
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
  rect: rectTool,
  measure: measureTool,
  room: roomTool,
  door: doorTool,
  window: windowTool,
  passage: passageTool,
  stairs: stairsTool,
  roof: roofTool,
  deck: deckTool,
  underlay: underlayTool,
  fixture: fixtureTool,
  gradePoint: gradePointTool,
  column: columnTool,
};

/** The tool object for a name; in site mode the select tool is the site one (grade points and columns). */
export const getTool = (name: ToolName): Tool => (name === 'select' && useUiStore.getState().siteMode ? siteSelectTool : tools[name]);

interface GhostSnapSources {
  nodes: Vec2[];
  walls: GhostWall[];
}

const ghostCache = new WeakMap<Level, Map<ViewMode, GhostSnapSources>>();

/** The level below's corners and wall centerlines that the ghost shows in a view mode (cached per level). */
function ghostSources(below: Level, viewMode: ViewMode): GhostSnapSources {
  let byMode = ghostCache.get(below);
  if (!byMode) ghostCache.set(below, (byMode = new Map()));
  let hit = byMode.get(viewMode);
  if (!hit) {
    const shown = visibleNodeIds(below, viewMode);
    const nodes: Vec2[] = [];
    for (const id of shown) {
      const n = below.nodes[id];
      if (n) nodes.push({ x: n.x, y: n.y });
    }
    const walls: GhostWall[] = [];
    for (const w of Object.values(below.walls)) {
      const a = below.nodes[w.a];
      const b = below.nodes[w.b];
      if (a && b && isVisible(w.phase, viewMode)) walls.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } });
    }
    byMode.set(viewMode, (hit = { nodes, walls }));
  }
  return hit;
}

/** Ghost snap sources while "Show level below" is on and the active level has one under it. */
function ghostFor(plan: Plan, levelId: Id): GhostSnapSources | null {
  const ui = useUiStore.getState();
  if (!ui.showLevelBelow) return null;
  const i = plan.levelOrder.indexOf(levelId);
  const below = i > 0 ? plan.levels[plan.levelOrder[i - 1]] : undefined;
  return below ? ghostSources(below, ui.viewMode) : null;
}

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
      const ghost = ghostFor(plan, levelId);
      return snapPoint(raw, {
        level: plan.levels[levelId],
        k: useUiStore.getState().viewport.k,
        snapGrid: plan.settings.snapGrid,
        orthoLock: useUiStore.getState().orthoLock,
        shift: opts.shift,
        from: opts.from,
        excludeNodeIds: opts.excludeNodeIds,
        viewMode: useUiStore.getState().viewMode,
        ghostNodes: ghost?.nodes,
        ghostWalls: ghost?.walls,
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

/**
 * Cancel the active tool and switch to another. In site mode the level tools (wall, room, openings,
 * stairs, roof, underlay) are off and say why in the status bar; outside it the site tools are off.
 */
export function switchTool(name: ToolName): void {
  const ui = useUiStore.getState();
  if (ui.siteMode && !isSiteModeTool(name)) {
    ui.patchDraft({ message: SITE_MODE_TOOL_HINT, error: false });
    return;
  }
  if (!ui.siteMode && SITE_TOOLS.includes(name)) return;
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
  const rooms = sel.rooms.filter((id) => level.rooms[id] && isVisible(level.rooms[id].phase ?? 'existing', vm));
  const stairs = sel.stairs.filter((id) => level.stairs[id] && isVisible(level.stairs[id].phase, vm));
  const roofs = sel.roofs.filter((id) => level.roofs[id] && isVisible(level.roofs[id].phase, vm));
  const fixtures = sel.fixtures.filter((id) => level.fixtures[id] && isVisible(level.fixtures[id].phase, vm));
  const decks = sel.decks.filter((id) => level.decks?.[id] && isVisible(level.decks[id].phase, vm));
  const site = getPlan().site;
  const gradePoints = sel.gradePoints.filter((id) => site.gradePoints[id]);
  const columns = sel.columns.filter((id) => site.columns[id] && isVisible(site.columns[id].phase, vm));
  if (nodes.length + walls.length + openings.length + rooms.length + stairs.length + roofs.length + fixtures.length + decks.length + gradePoints.length + columns.length !== selectionSize(sel)) {
    ui.setSelection({ nodes, walls, openings, rooms, stairs, roofs, fixtures, decks, gradePoints, columns });
  }
  // An inline rename of a room that undo removed has nothing left to edit.
  const edit = ui.roomEdit;
  if (edit?.roomId && !level.rooms[edit.roomId]) ui.setRoomEdit(null);
}

/**
 * Switch the active level: keeps the viewport, clears selection and any draft. Choosing any level
 * (the lowest one too) leaves site mode.
 */
export function switchLevel(levelId: Id): void {
  const ui = useUiStore.getState();
  if ((ui.activeLevelId === levelId && !ui.siteMode) || !getPlan().levels[levelId]) return;
  cancelActiveTool();
  ui.setActiveLevel(levelId);
  if (lastPointer) dispatchPointer('move', lastPointer);
}

/**
 * Open the Site pseudo-level: the lowest level becomes active (so the panel and store actions have
 * a level), the 2D view shows the first floor as a ghost under the site layer, and only select and
 * the site tools work. Entering it again does nothing.
 */
export function enterSiteMode(): void {
  const ui = useUiStore.getState();
  const id = getPlan().levelOrder[0];
  if (!id || ui.siteMode) return;
  cancelActiveTool();
  ui.enterSiteMode(id);
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
  if (ui.siteMode) {
    switchTool('underlay'); // says why not
    return;
  }
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
