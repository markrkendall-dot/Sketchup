import { lazy, Suspense, useEffect, useRef, useState, type RefObject } from 'react';
import { PlanCanvas } from './editor2d/PlanCanvas';
import { RoomNameEditor } from './editor2d/RoomNameEditor';
import { activateUnderlayTool, cycleViewMode, dispatchKey, dispatchShift, switchLevelByIndex, switchTool } from './editor2d/tools';
import { redo, undo, usePlanStore } from './store/planStore';
import { LAYOUTS, useUiStore, type ToolName } from './store/uiStore';
import { LevelBar } from './ui/LevelBar';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { StatusBar } from './ui/StatusBar';
import { Toolbar } from './ui/Toolbar';
import { UnderlayFileInput } from './ui/UnderlayImport';

// The 3D view (three, fiber, drei) loads on first use, so the 2D editor starts fast.
const Scene3D = lazy(() => import('./view3d/Scene3D'));

function cycleLayout(): void {
  const ui = useUiStore.getState();
  ui.setLayout(LAYOUTS[(LAYOUTS.indexOf(ui.layout) + 1) % LAYOUTS.length]);
}

const TOOL_KEYS: Record<string, ToolName> = {
  s: 'select',
  w: 'wall',
  r: 'room',
  d: 'door',
  n: 'window',
  p: 'passage',
  t: 'stairs',
  u: 'underlay',
};

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * One keyboard entry point: the active tool sees keys first (length buffer, Esc, Delete), then
 * global hotkeys. While the wall tool is drawing, single-letter hotkeys other than the tool keys
 * are suppressed so typing a length never toggles anything. Digits reach the level hotkeys only
 * when no tool took them for a length buffer.
 */
function onKeyDown(e: KeyboardEvent): void {
  if (isEditable(e.target)) return;
  // Walk mode owns the keyboard (view3d/FirstPerson.tsx captures keys before they get here).
  if (document.pointerLockElement || useUiStore.getState().cameraMode === 'walk') return;
  if (e.key === 'Shift') dispatchShift(true);
  if (dispatchKey(e)) {
    e.preventDefault();
    return;
  }
  const ui = useUiStore.getState();
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && !e.altKey) {
    if (key === 'z' && e.shiftKey) redo();
    else if (key === 'z') undo();
    else if (key === 'y') redo();
    else return;
    e.preventDefault();
    return;
  }
  if (e.key === ' ') {
    ui.setSpaceHeld(true);
    e.preventDefault();
    return;
  }
  if (e.altKey || mod || e.repeat) return;
  if (e.key === '`') {
    cycleLayout();
    e.preventDefault();
    return;
  }
  if (Object.hasOwn(TOOL_KEYS, key)) {
    // The underlay tool opens the image picker when the level has no image yet.
    if (TOOL_KEYS[key] === 'underlay') activateUnderlayTool();
    else switchTool(TOOL_KEYS[key]);
    e.preventDefault();
    return;
  }
  const drawing =
    (ui.activeTool === 'wall' && ui.draft.wallStart !== null) ||
    (ui.activeTool === 'underlay' && ui.draft.underlayPoints.length > 0);
  if (drawing) return;
  if (key === 'o') {
    const { plan, updateSettings } = usePlanStore.getState();
    updateSettings({ orthoLock: !plan.settings.orthoLock });
  } else if (key === 'g') ui.toggleGrid();
  else if (key === 'v') cycleViewMode();
  else if (key === 'f' && ui.layout !== '2d') ui.setCameraMode('walk');
  else if (/^[1-9]$/.test(key)) switchLevelByIndex(Number(key) - 1);
  else return;
  e.preventDefault();
}

function onKeyUp(e: KeyboardEvent): void {
  if (e.key === 'Shift') dispatchShift(false);
  if (e.key === ' ') useUiStore.getState().setSpaceHeld(false);
}

function onBlur(): void {
  useUiStore.getState().setSpaceHeld(false);
  dispatchShift(false);
}

/** Drag handle between the 2D plan and the 3D view; double-click resets to half and half. */
function SplitHandle({ container }: { container: RefObject<HTMLDivElement | null> }) {
  const [dragging, setDragging] = useState(false);
  const setRatio = (clientX: number) => {
    const el = container.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width > 0) useUiStore.getState().setSplitRatio((clientX - r.left) / r.width);
  };
  return (
    <div
      className={`split-handle${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the 2D and 3D views"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={(e) => dragging && setRatio(e.clientX)}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        setDragging(false);
      }}
      onDoubleClick={() => useUiStore.getState().setSplitRatio(0.5)}
    />
  );
}

/**
 * The 2D plan and/or the 3D model. The plan stays mounted (hidden in the 3D layout) so its
 * viewport and tool state survive layout switches; the 3D canvas mounts only when shown.
 */
function Views() {
  const layout = useUiStore((s) => s.layout);
  const ratio = useUiStore((s) => s.splitRatio);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className={`views layout-${layout}`}>
      <main className="canvas-host" style={layout === 'split' ? { flex: `0 0 ${ratio * 100}%` } : undefined}>
        <PlanCanvas />
        <RoomNameEditor />
      </main>
      {layout === 'split' && <SplitHandle container={ref} />}
      {layout !== '2d' && (
        <Suspense fallback={<section className="view3d-host" aria-label="3D view" aria-busy="true" />}>
          <Scene3D />
        </Suspense>
      )}
    </div>
  );
}

export function App() {
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <LevelBar />
        <Views />
        <PropertiesPanel />
      </div>
      <StatusBar />
      <UnderlayFileInput />
    </div>
  );
}
