import { create } from 'zustand';
import type { WallGeom } from '../derive/openings';
import type { Id, MeasureTo, Opening, Phase, Vec2, ViewMode, WallKind } from '../model/types';

export type OpeningToolName = Opening['type'];
export type ToolName = 'select' | 'wall' | 'room' | 'stairs' | 'roof' | 'underlay' | 'gradePoint' | 'column' | OpeningToolName;
/** Tools that work on the site (E, C); the others edit a level and are off in site mode. */
export const SITE_TOOLS: readonly ToolName[] = ['gradePoint', 'column'];
/** Tools allowed in site mode: select, the site tools. */
export const isSiteModeTool = (tool: ToolName): boolean => tool === 'select' || SITE_TOOLS.includes(tool);
/** Shown in the status bar when a level tool is asked for in site mode. */
export const SITE_MODE_TOOL_HINT = 'Choose a level to draw walls';
/** Underlay tool modes: drag the image, or calibrate its scale / rotation from two clicked points. */
export type UnderlayMode = 'move' | 'scale' | 'rotate';
/** Which views the workspace shows. */
export type Layout = '2d' | 'split' | '3d';
export const LAYOUTS: readonly Layout[] = ['2d', 'split', '3d'];
/** 3D camera: orbit around the model, or walk through it in first person. */
export type CameraMode = 'orbit' | 'walk';
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

export type SnapKind =
  | 'node'
  | 'midpoint'
  | 'wall'
  | 'ghost-node'
  | 'ghost-wall'
  | 'face-corner'
  | 'face-edge'
  | 'guide'
  | 'angle'
  | 'grid'
  | 'none';

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
  /**
   * While "Lengths to" is inside or outside and the new wall turns a square corner: the
   * face-to-face length that `length` (the centerline) corresponds to.
   */
  face?: { measureTo: Exclude<MeasureTo, 'center'>; length: number };
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
  /** Stairs tool: ghost of the flight about to be placed (origin = middle of the bottom edge). */
  stairsPreview: { origin: Vec2; direction: number } | null;
  /** Stairs tool: direction of travel chosen by the last mouse movement (0, 90, 180, 270). */
  stairsDirection: number;
  /** Underlay tool, scale / rotate modes: the calibration points clicked so far (world). */
  underlayPoints: Vec2[];
  /** Roof tool: the outline corners clicked so far (world). */
  roofPoints: Vec2[];
  /** Grade point tool: the spot clicked, waiting for its elevation (typed in the length buffer, Enter places). */
  gradePending: Vec2 | null;
  /** Column tool: what the next click places (Tab toggles). */
  columnKind: 'chimney' | 'post';
  /** Column tool: the column about to be placed, following the snapped cursor. */
  columnPreview: { at: Vec2; kind: 'chimney' | 'post'; width: number; depth: number } | null;
}

export interface Selection {
  nodes: Id[];
  walls: Id[];
  openings: Id[];
  rooms: Id[];
  stairs: Id[];
  roofs: Id[];
  /** Site elements (plan.site), selectable in site mode. */
  gradePoints: Id[];
  columns: Id[];
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

/** A message in the status bar that is not tied to a tool (autosave, file actions). */
export interface Notice {
  text: string;
  error: boolean;
}

/** localStorage keys of the editor preferences that are not plan data (so not undoable). */
export const ORTHO_LOCK_KEY = 'homeplan:orthoLock';
export const MEASURE_TO_KEY = 'homeplan:measureTo';
const MEASURE_TO_VALUES: readonly MeasureTo[] = ['center', 'inside', 'outside'];

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private window or blocked storage: the preference just lasts for this session.
  }
}

export function loadOrthoLock(): boolean {
  return readPref(ORTHO_LOCK_KEY) !== 'false';
}

export function loadMeasureTo(): MeasureTo {
  const v = readPref(MEASURE_TO_KEY);
  return MEASURE_TO_VALUES.find((m) => m === v) ?? 'center';
}

/** Below this window width the level bar and properties panel collapse and the 3D pane goes (index.css agrees). */
export const NARROW_QUERY = '(max-width: 899px)';

/** True while the window is narrow (see NARROW_QUERY). False where there is no window (tests). */
export function isNarrow(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches;
}

export interface UiState {
  /**
   * Narrow windows only (see NARROW_QUERY): the level bar and the properties panel are overlays
   * that start closed and are toggled with their toolbar buttons or the [ and ] keys. Wide windows
   * always show both and ignore these.
   */
  levelBarOpen: boolean;
  propertiesOpen: boolean;
  /** Ortho lock for the wall tool (O); Shift inverts it while held. Persisted, never in undo. */
  orthoLock: boolean;
  /** What a typed wall length refers to. Persisted, never in undo. */
  measureTo: MeasureTo;
  activeTool: ToolName;
  activeLevelId: Id;
  /**
   * The Site pseudo-level: the lowest level is active (for tools and the panel), the 2D view shows
   * the first floor as a ghost with the site layer, and only select and the site tools work.
   */
  siteMode: boolean;
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
  /** 2D plan, 3D model, or both side by side. */
  layout: Layout;
  /** Split layout: fraction of the width given to the 2D plan. */
  splitRatio: number;
  /** 3D view: levels the user unchecked. */
  hidden3dLevels: Id[];
  /** 3D view: show only the active level and the ones below it. */
  only3dActiveAndBelow: boolean;
  /** 3D view: the drei grid overlay on the ground. */
  show3dGrid: boolean;
  /** Bumped to ask the 3D view to re-fit the camera to the plan. */
  fit3dRequest: number;
  /** Draw the active level's image underlay (a temporary hide; the plan keeps it). */
  showUnderlay: boolean;
  /** The active level's underlay is selected (exclusive with the entity selection). */
  underlaySelected: boolean;
  underlayMode: UnderlayMode;
  /** 3D view camera: orbit, or first-person walk (only while the 3D view is shown). */
  cameraMode: CameraMode;
  /** Walk mode: the level the eye is on (its floor top + eye height). */
  walkLevelId: Id | null;
  /** Walk mode: the pointer is locked to the 3D canvas (mouse looks around). */
  walkLocked: boolean;
  /** The keyboard help overlay is open. */
  helpOpen: boolean;
  notice: Notice | null;
  toggleLevelBar: () => void;
  toggleProperties: () => void;
  setOrthoLock: (on: boolean) => void;
  setMeasureTo: (measureTo: MeasureTo) => void;
  setTool: (tool: ToolName) => void;
  /** Switching level always leaves site mode. */
  setActiveLevel: (id: Id) => void;
  /** Enter the Site pseudo-level on `levelId` (the lowest level); clears the selection and the draft. */
  enterSiteMode: (levelId: Id) => void;
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
  setLayout: (layout: Layout) => void;
  setSplitRatio: (ratio: number) => void;
  toggle3dLevel: (id: Id) => void;
  setOnly3dActiveAndBelow: (on: boolean) => void;
  requestFit3d: () => void;
  setShow3dGrid: (on: boolean) => void;
  toggleShowUnderlay: () => void;
  /** Select the underlay (clears the entity selection) or deselect it. */
  selectUnderlay: (on: boolean) => void;
  /** Change the underlay tool mode; drops any half-made calibration. */
  setUnderlayMode: (mode: UnderlayMode) => void;
  /** Leaving walk mode clears the walk state. */
  setCameraMode: (mode: CameraMode) => void;
  setWalkLevel: (id: Id | null) => void;
  setWalkLocked: (locked: boolean) => void;
  setHelpOpen: (open: boolean) => void;
  setNotice: (notice: Notice | null) => void;
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
  stairsPreview: null,
  stairsDirection: 0,
  underlayPoints: [],
  roofPoints: [],
  gradePending: null,
  columnKind: 'chimney',
  columnPreview: null,
});

export const EMPTY_SELECTION: Selection = { nodes: [], walls: [], openings: [], rooms: [], stairs: [], roofs: [], gradePoints: [], columns: [] };
const NO_HOVER: Hover = { nodeId: null, wallId: null, openingId: null };

export const selectionSize = (s: Selection): number =>
  s.nodes.length + s.walls.length + s.openings.length + s.rooms.length + s.stairs.length + s.roofs.length + s.gradePoints.length + s.columns.length;

/** Split ratio bounds, so neither view collapses. */
export const MIN_SPLIT = 0.2;
export const MAX_SPLIT = 0.8;

export const useUiStore = create<UiState>()((set) => ({
  levelBarOpen: false,
  propertiesOpen: false,
  orthoLock: loadOrthoLock(),
  measureTo: loadMeasureTo(),
  activeTool: 'wall',
  activeLevelId: '',
  siteMode: false,
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
  layout: '2d',
  splitRatio: 0.5,
  hidden3dLevels: [],
  only3dActiveAndBelow: false,
  show3dGrid: true,
  fit3dRequest: 0,
  showUnderlay: true,
  underlaySelected: false,
  underlayMode: 'move',
  cameraMode: 'orbit',
  walkLevelId: null,
  walkLocked: false,
  helpOpen: false,
  notice: null,
  toggleLevelBar: () => set((s) => ({ levelBarOpen: !s.levelBarOpen })),
  toggleProperties: () => set((s) => ({ propertiesOpen: !s.propertiesOpen })),
  setOrthoLock: (orthoLock) => {
    writePref(ORTHO_LOCK_KEY, String(orthoLock));
    set({ orthoLock });
  },
  setMeasureTo: (measureTo) => {
    writePref(MEASURE_TO_KEY, measureTo);
    set({ measureTo });
  },
  setTool: (activeTool) =>
    set((s) => ({
      activeTool,
      underlayMode: 'move',
      draft: { ...emptyDraft(), cursor: s.draft.cursor },
      hover: NO_HOVER,
      roomEdit: null,
    })),
  setActiveLevel: (activeLevelId) =>
    set((s) => ({
      activeLevelId,
      siteMode: false,
      // The site tools only exist in site mode.
      activeTool: SITE_TOOLS.includes(s.activeTool) ? 'select' : s.activeTool,
      selection: EMPTY_SELECTION,
      underlaySelected: false,
      draft: emptyDraft(),
      hover: NO_HOVER,
      roomEdit: null,
    })),
  enterSiteMode: (levelId) =>
    set((s) => ({
      activeLevelId: levelId,
      siteMode: true,
      activeTool: isSiteModeTool(s.activeTool) ? s.activeTool : 'select',
      selection: EMPTY_SELECTION,
      underlaySelected: false,
      draft: emptyDraft(),
      hover: NO_HOVER,
      roomEdit: null,
    })),
  setSelection: (selection) =>
    set((s) => ({ selection, underlaySelected: selectionSize(selection) ? false : s.underlaySelected })),
  clearSelection: () =>
    set((s) =>
      selectionSize(s.selection) || s.underlaySelected ? { selection: EMPTY_SELECTION, underlaySelected: false } : s,
    ),
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
  // The 2D layout has no 3D view to walk in.
  setLayout: (layout) =>
    set((s) => (layout === '2d' && s.cameraMode === 'walk' ? { layout, cameraMode: 'orbit', walkLevelId: null, walkLocked: false } : { layout })),
  setSplitRatio: (ratio) => set({ splitRatio: Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, ratio)) }),
  toggle3dLevel: (id) =>
    set((s) => ({
      hidden3dLevels: s.hidden3dLevels.includes(id) ? s.hidden3dLevels.filter((x) => x !== id) : [...s.hidden3dLevels, id],
    })),
  setOnly3dActiveAndBelow: (only3dActiveAndBelow) => set({ only3dActiveAndBelow }),
  requestFit3d: () => set((s) => ({ fit3dRequest: s.fit3dRequest + 1 })),
  setShow3dGrid: (show3dGrid) => set({ show3dGrid }),
  toggleShowUnderlay: () => set((s) => ({ showUnderlay: !s.showUnderlay })),
  selectUnderlay: (on) =>
    set((s) =>
      on ? { underlaySelected: true, selection: EMPTY_SELECTION } : s.underlaySelected ? { underlaySelected: false } : s,
    ),
  setUnderlayMode: (underlayMode) =>
    set((s) => ({
      underlayMode,
      draft: { ...s.draft, underlayPoints: [], lengthBuffer: '', error: false, message: null },
    })),
  setCameraMode: (cameraMode) =>
    set((s) =>
      s.cameraMode === cameraMode
        ? s
        : cameraMode === 'walk'
          ? { cameraMode, layout: s.layout === '2d' ? '3d' : s.layout }
          : { cameraMode, walkLevelId: null, walkLocked: false },
    ),
  setWalkLevel: (walkLevelId) => set({ walkLevelId }),
  setWalkLocked: (walkLocked) => set((s) => (s.walkLocked === walkLocked ? s : { walkLocked })),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setNotice: (notice) => set({ notice }),
}));

export const useViewport = () => useUiStore((s) => s.viewport);
export const useViewportScale = () => useUiStore((s) => s.viewport.k);
