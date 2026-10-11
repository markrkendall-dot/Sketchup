import { create } from 'zustand';
import type { WallGeom } from '../derive/openings';
import type { Id, Opening, Phase, Vec2, ViewMode, WallKind } from '../model/types';

export type OpeningToolName = Opening['type'];
export type ToolName = 'select' | 'wall' | 'room' | OpeningToolName;
/** Phases the drawing tools can create; demo is applied to existing elements instead. */
export type DrawPhase = Extract<Phase, 'existing' | 'new'>;

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

export interface OpeningPreview {
  wallId: Id;
  geom: WallGeom;
  opening: Omit<Opening, 'id'>;
  /** Distances from the a and b ends (nodes) to the nearer jamb. */
  fromA: number;
  fromB: number;
  /** End the typed distance is measured from. */
  nearEnd: 'a' | 'b';
  /** Side of the wall the cursor is on: 1 = left (+normal), -1 = right. */
  cursorSide: 1 | -1;
  /** Position follows the typed length buffer. */
  typed: boolean;
  /** Null when the opening can be placed, else why not. */
  problem: string | null;
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
  /** Wall tool: thickness of the wall the next one starts from (for inside/outside lengths). */
  prevThickness: number | null;
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
  /** Opening tools: ghost of the opening about to be placed. */
  openingPreview: OpeningPreview | null;
  /** Opening tools: Tab flips the door swing side relative to the cursor side. */
  swingFlip: boolean;
  /** Opening tools: Shift+Tab flips the hinge from the a side to the b side. */
  hingeFlip: boolean;
}

export interface Selection {
  nodes: Id[];
  walls: Id[];
  openings: Id[];
  rooms: Id[];
}

/** The inline room name editor (RoomNameEditor). */
export interface RoomEdit {
  /** Room being renamed, or null for a room that is created on commit. */
  roomId: Id | null;
  /** World point the editor is centered on. */
  at: Vec2;
  /** Anchor of a new room. */
  anchor: Vec2;
  initial: string;
}

export interface Hover {
  nodeId: Id | null;
  wallId: Id | null;
  openingId: Id | null;
}

export interface UiState {
  activeTool: ToolName;
  activeLevelId: Id;
  selection: Selection;
  hover: Hover;
  viewport: Viewport;
  draft: Draft;
  roomEdit: RoomEdit | null;
  showGrid: boolean;
  nextWallKind: WallKind;
  /** Which phases are shown (DESIGN.md ViewMode). */
  viewMode: ViewMode;
  /** Phase given to walls and openings drawn from now on. */
  drawPhase: DrawPhase;
  /** Draw the level below the active one as a faint ghost. */
  showLevelBelow: boolean;
  spaceHeld: boolean;
  /** Size of the plan canvas in px, kept by PlanCanvas. */
  canvasSize: { width: number; height: number };
  setTool: (tool: ToolName) => void;
  setActiveLevel: (id: Id) => void;
  setSelection: (sel: Selection) => void;
  clearSelection: () => void;
  /** Missing fields are null. */
  setHover: (hover: Partial<Hover>) => void;
  setViewport: (v: Viewport) => void;
  patchDraft: (patch: Partial<Draft>) => void;
  setRoomEdit: (edit: RoomEdit | null) => void;
  resetDraft: () => void;
  toggleGrid: () => void;
  toggleWallKind: () => void;
  setSpaceHeld: (held: boolean) => void;
  setCanvasSize: (size: { width: number; height: number }) => void;
  /** The existing view only documents what is there: it also resets drawPhase to existing. */
  setViewMode: (mode: ViewMode) => void;
  /** Drawing new elements while in the existing view switches to the proposed view. */
  setDrawPhase: (phase: DrawPhase) => void;
  toggleShowLevelBelow: () => void;
}

export const emptyDraft = (): Draft => ({
  cursor: null,
  snap: null,
  wallStart: null,
  chainFirstNodeId: null,
  prevDirection: null,
  prevThickness: null,
  direction: { x: 1, y: 0 },
  wallPreview: null,
  lengthBuffer: '',
  error: false,
  message: null,
  box: null,
  openingPreview: null,
  swingFlip: false,
  hingeFlip: false,
});

export const EMPTY_SELECTION: Selection = { nodes: [], walls: [], openings: [], rooms: [] };
const NO_HOVER: Hover = { nodeId: null, wallId: null, openingId: null };

export const selectionSize = (s: Selection): number =>
  s.nodes.length + s.walls.length + s.openings.length + s.rooms.length;

export const useUiStore = create<UiState>()((set) => ({
  activeTool: 'wall',
  activeLevelId: '',
  selection: EMPTY_SELECTION,
  hover: NO_HOVER,
  viewport: { tx: 300, ty: 200, k: 0.5 },
  draft: emptyDraft(),
  roomEdit: null,
  showGrid: true,
  nextWallKind: 'exterior',
  viewMode: 'all',
  drawPhase: 'existing',
  showLevelBelow: false,
  spaceHeld: false,
  canvasSize: { width: 0, height: 0 },
  setTool: (activeTool) =>
    set((s) => ({
      activeTool,
      draft: { ...emptyDraft(), cursor: s.draft.cursor },
      hover: NO_HOVER,
      roomEdit: null,
    })),
  setActiveLevel: (activeLevelId) =>
    set({ activeLevelId, selection: EMPTY_SELECTION, draft: emptyDraft(), hover: NO_HOVER, roomEdit: null }),
  setSelection: (selection) => set({ selection }),
  clearSelection: () => set((s) => (selectionSize(s.selection) ? { selection: EMPTY_SELECTION } : s)),
  setHover: (h) =>
    set((s) => {
      const hover: Hover = { nodeId: h.nodeId ?? null, wallId: h.wallId ?? null, openingId: h.openingId ?? null };
      return s.hover.nodeId === hover.nodeId &&
        s.hover.wallId === hover.wallId &&
        s.hover.openingId === hover.openingId
        ? s
        : { hover };
    }),
  setViewport: (viewport) => set({ viewport }),
  patchDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
  setRoomEdit: (roomEdit) => set({ roomEdit }),
  resetDraft: () => set((s) => ({ draft: { ...emptyDraft(), cursor: s.draft.cursor } })),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleWallKind: () =>
    set((s) => ({ nextWallKind: s.nextWallKind === 'exterior' ? 'interior' : 'exterior' })),
  setSpaceHeld: (spaceHeld) => set((s) => (s.spaceHeld === spaceHeld ? s : { spaceHeld })),
  setCanvasSize: (canvasSize) => set({ canvasSize }),
  setViewMode: (viewMode) =>
    set((s) => ({ viewMode, drawPhase: viewMode === 'existing' ? 'existing' : s.drawPhase })),
  setDrawPhase: (drawPhase) =>
    set((s) => ({
      drawPhase,
      viewMode: drawPhase === 'new' && s.viewMode === 'existing' ? 'proposed' : s.viewMode,
    })),
  toggleShowLevelBelow: () => set((s) => ({ showLevelBelow: !s.showLevelBelow })),
}));

export const useViewport = () => useUiStore((s) => s.viewport);
export const useViewportScale = () => useUiStore((s) => s.viewport.k);
