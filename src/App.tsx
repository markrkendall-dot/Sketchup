import { lazy, Suspense, useEffect, useRef, useState, type RefObject } from 'react';
import { PlanCanvas } from './editor2d/PlanCanvas';
import { PlanContextMenu } from './editor2d/PlanContextMenu';
import { RoomNameEditor } from './editor2d/RoomNameEditor';
import { dispatchKey, dispatchShift } from './editor2d/tools';
import { useUiStore } from './store/uiStore';
import { HelpOverlay } from './ui/HelpOverlay';
import { bindingFor } from './ui/keymap';
import { LevelBar } from './ui/LevelBar';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { StatusBar } from './ui/StatusBar';
import { Toolbar } from './ui/Toolbar';
import { UnderlayFileInput } from './ui/UnderlayImport';
import { useNarrow } from './ui/useNarrow';

// The 3D view (three, fiber, drei) loads on first use, so the 2D editor starts fast.
const Scene3D = lazy(() => import('./view3d/Scene3D'));

/** Inputs that do not take typed text: hotkeys still work while one of them has focus. */
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color', 'image']);

/** A focused element that takes typed keys: text fields, selects, text areas, sliders. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  return target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type);
}

/**
 * One keyboard entry point. Keys typed into a text field, select or text area never reach the
 * plan; neither do keys while walking (FirstPerson.tsx captures them) or while the help is open
 * (Esc or ? closes it). Otherwise the active tool sees keys first (length buffer, Esc, Delete),
 * then the keyboard map (ui/keymap.ts). While a typed length is being entered every other plain
 * key is swallowed, and while a wall chain or calibration is in progress only the bindings marked
 * whileDrawing run (tool switches, layout, undo, save), so typing never toggles anything.
 */
function onKeyDown(e: KeyboardEvent): void {
  const mod = e.ctrlKey || e.metaKey;
  if (isEditable(e.target)) {
    // Save and Open still work from a text field (committing it first), instead of the browser's
    // own Save page / Open file dialogs. Everything else belongs to the field.
    const binding = mod ? bindingFor(e) : undefined;
    if (binding && (binding.combos?.includes('mod+s') || binding.combos?.includes('mod+o'))) {
      e.preventDefault();
      if (!e.repeat) {
        (e.target as HTMLElement).blur();
        binding.run?.(e);
      }
    }
    return;
  }
  const ui = useUiStore.getState();
  // Walk mode owns the keyboard (view3d/FirstPerson.tsx captures keys before they get here).
  if (document.pointerLockElement || ui.cameraMode === 'walk') return;
  if (ui.helpOpen && !mod) {
    if (e.key === 'Escape' || e.key === '?') ui.setHelpOpen(false);
    e.preventDefault();
    return;
  }
  if (e.key === 'Shift') dispatchShift(true);
  if (dispatchKey(e)) {
    e.preventDefault();
    return;
  }
  const after = useUiStore.getState();
  if (after.draft.lengthBuffer !== '' && !mod) {
    // A half-typed length: a stray letter must not switch tools or levels and lose it.
    if (e.key.length === 1) e.preventDefault();
    return;
  }
  if (e.key === ' ' && !mod) {
    after.setSpaceHeld(true);
    e.preventDefault();
    return;
  }
  const binding = bindingFor(e);
  if (!binding?.run) return;
  if (e.repeat && !binding.repeat) {
    if (mod) e.preventDefault();
    return;
  }
  const drawing =
    (after.activeTool === 'wall' && after.draft.wallStart !== null) ||
    (after.activeTool === 'rect' && after.draft.rectStart !== null) ||
    (after.activeTool === 'underlay' && after.draft.underlayPoints.length > 0) ||
    ((after.activeTool === 'roof' || after.activeTool === 'deck' || after.activeTool === 'floorOpening') && after.draft.outlinePoints.length > 0);
  if (drawing && !binding.whileDrawing) return;
  if (binding.run(e) === false) return;
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
  const narrow = useNarrow();
  const ref = useRef<HTMLDivElement>(null);
  // Under 900 px the 3D pane has no room: the split layout keeps the plan, says why, and does not
  // mount the 3D canvas at all.
  const split = layout === 'split' && !narrow;
  return (
    <div ref={ref} className={`views layout-${layout}${layout === 'split' && narrow ? ' split-narrow' : ''}`}>
      <main className="canvas-host" style={split ? { flex: `0 0 ${ratio * 100}%` } : undefined}>
        <PlanCanvas />
        <RoomNameEditor />
        <PlanContextMenu />
        {layout === 'split' && narrow && (
          <p className="split-hint" role="status">
            The 3D view needs a window at least 900 px wide. Use the 3D button to see it full size.
          </p>
        )}
      </main>
      {split && <SplitHandle container={ref} />}
      {(layout === '3d' || split) && (
        <Suspense fallback={<section className="view3d-host" aria-label="3D view" aria-busy="true" />}>
          <Scene3D />
        </Suspense>
      )}
    </div>
  );
}

export function App() {
  const levelBarOpen = useUiStore((s) => s.levelBarOpen);
  const propertiesOpen = useUiStore((s) => s.propertiesOpen);
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
    <div className={`app${levelBarOpen ? '' : ' levels-collapsed'}${propertiesOpen ? '' : ' properties-collapsed'}`}>
      <Toolbar />
      <div className="workspace">
        <LevelBar />
        <Views />
        <PropertiesPanel />
      </div>
      <StatusBar />
      <UnderlayFileInput />
      <HelpOverlay />
    </div>
  );
}
