import { create } from 'zustand';
import type { Id, Vec2, WallKind } from '../model/types';

export type ToolName = 'select' | 'wall';

export interface Viewport {
  /** Screen x of world origin, px. */
  tx: number;
  /** Screen y of world origin, px. */
  ty: number;
  /** Pixels per inch. */
  k: number;
}

export type SnapKind = 'node' | 'midpoint' | 'wall' | 'guide' | 'angle' | 'grid' | 'none';

export interface Guide {
  from: Vec2;
  to: Vec2;
}

export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
  nodeId?: Id;
  wallId?: Id;
  guides: Guide[];
}

export interface WallStart {
  point: Vec2;
  nodeId?: Id;
}

export interface WallPreview {
  a: Vec2;
  b: Vec2;
  thickness: number;
  length: number;
  /** True when the preview follows a typed length rather than the cursor. */
  typed: boolean;
}

export interface Draft {
  /** World point under the pointer (raw, unsnapped). */
  cursor: Vec2 | null;
  snap: SnapResult | null;
  /** Wall tool: start of the wall being drawn, null when idle. */
  wallStart: WallStart | null;
  /** Wall tool: id of the first node of the current chain (closing onto it ends the chain). */
  chainFirstNodeId: Id | null;
  /** Wall tool: the previous wall's unit direction in this chain. */
  prevDirection: Vec2 | null;
  /** Wall tool: current unit direction. */
  direction: Vec2;
  wallPreview: WallPreview | null;
  lengthBuffer: string;
  /** Last parse of the length buffer failed. */
  error: boolean;
  /** Transient status message, e.g. "Closed onto existing corner". */
  message: string | null;
  /** Select tool: box selection rectangle in world coordinates. */
  box: { a: Vec2; b: Vec2 } | null;
}

export interface Selection {
  nodes: Id[];
  walls: Id[];
}

export interface UiState {
  activeTool: ToolName;
  activeLevelId: Id;
  selection: Selection;
  hover: { nodeId: Id | null; wallId: Id | null };
  viewport: Viewport;
  draft: Draft;
  showGrid: boolean;
  nextWallKind: WallKind;
  spaceHeld: boolean;
  /** Size of the plan canvas in px, kept by PlanCanvas. */
  canvasSize: { width: number; height: number };
  setTool: (tool: ToolName) => void;
  setActiveLevel: (id: Id) => void;
  setSelection: (sel: Selection) => void;
  clearSelection: () => void;
  setHover: (hover: { nodeId: Id | null; wallId: Id | null }) => void;
  setViewport: (v: Viewport) => void;
  patchDraft: (patch: Partial<Draft>) => void;
  resetDraft: () => void;
  toggleGrid: () => void;
  toggleWallKind: () => void;
  setSpaceHeld: (held: boolean) => void;
  setCanvasSize: (size: { width: number; height: number }) => void;
}

export const emptyDraft = (): Draft => ({
  cursor: null,
  snap: null,
  wallStart: null,
  chainFirstNodeId: null,
  prevDirection: null,
  direction: { x: 1, y: 0 },
  wallPreview: null,
  lengthBuffer: '',
  error: false,
  message: null,
  box: null,
});

const EMPTY_SELECTION: Selection = { nodes: [], walls: [] };

export const useUiStore = create<UiState>()((set) => ({
  activeTool: 'wall',
  activeLevelId: '',
  selection: EMPTY_SELECTION,
  hover: { nodeId: null, wallId: null },
  viewport: { tx: 300, ty: 200, k: 0.5 },
  draft: emptyDraft(),
  showGrid: true,
  nextWallKind: 'exterior',
  spaceHeld: false,
  canvasSize: { width: 0, height: 0 },
  setTool: (activeTool) =>
    set((s) => ({
      activeTool,
      draft: { ...emptyDraft(), cursor: s.draft.cursor },
      hover: { nodeId: null, wallId: null },
    })),
  setActiveLevel: (activeLevelId) =>
    set({ activeLevelId, selection: EMPTY_SELECTION, draft: emptyDraft() }),
  setSelection: (selection) => set({ selection }),
  clearSelection: () =>
    set((s) =>
      s.selection.nodes.length || s.selection.walls.length ? { selection: EMPTY_SELECTION } : s,
    ),
  setHover: (hover) =>
    set((s) =>
      s.hover.nodeId === hover.nodeId && s.hover.wallId === hover.wallId ? s : { hover },
    ),
  setViewport: (viewport) => set({ viewport }),
  patchDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
  resetDraft: () => set((s) => ({ draft: { ...emptyDraft(), cursor: s.draft.cursor } })),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleWallKind: () =>
    set((s) => ({ nextWallKind: s.nextWallKind === 'exterior' ? 'interior' : 'exterior' })),
  setSpaceHeld: (spaceHeld) => set((s) => (s.spaceHeld === spaceHeld ? s : { spaceHeld })),
  setCanvasSize: (canvasSize) => set({ canvasSize }),
}));

export const useViewport = () => useUiStore((s) => s.viewport);
export const useViewportScale = () => useUiStore((s) => s.viewport.k);
