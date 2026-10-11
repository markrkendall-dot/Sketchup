import { getPlan, usePlanStore, type PlanState } from '../../store/planStore';
import { useUiStore, type SnapResult, type ToolName, type UiState } from '../../store/uiStore';
import type { Id, Level, Plan, Vec2 } from '../../model/types';
import { snapPoint } from '../snap';
import { selectTool } from './selectTool';
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

const tools: Record<ToolName, Tool> = { select: selectTool, wall: wallTool };

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
        orthoLock: plan.settings.orthoLock,
        shift: opts.shift,
        from: opts.from,
        excludeNodeIds: opts.excludeNodeIds,
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
