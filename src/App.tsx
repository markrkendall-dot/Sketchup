import { useEffect } from 'react';
import { PlanCanvas } from './editor2d/PlanCanvas';
import { dispatchKey, dispatchShift, switchTool } from './editor2d/tools';
import { redo, undo, usePlanStore } from './store/planStore';
import { useUiStore } from './store/uiStore';
import { StatusBar } from './ui/StatusBar';
import { Toolbar } from './ui/Toolbar';

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * One keyboard entry point: the active tool sees keys first (length buffer, Esc, Delete), then
 * global hotkeys. While the wall tool is drawing, single-letter hotkeys other than W/S are
 * suppressed so typing a length never toggles anything.
 */
function onKeyDown(e: KeyboardEvent): void {
  if (isEditable(e.target)) return;
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
  if (key === 's' || key === 'w') {
    switchTool(key === 's' ? 'select' : 'wall');
    e.preventDefault();
    return;
  }
  const drawing = ui.activeTool === 'wall' && ui.draft.wallStart !== null;
  if (drawing) return;
  if (key === 'o') {
    const { plan, updateSettings } = usePlanStore.getState();
    updateSettings({ orthoLock: !plan.settings.orthoLock });
  } else if (key === 'g') ui.toggleGrid();
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
      <main className="canvas-host">
        <PlanCanvas />
      </main>
      <StatusBar />
    </div>
  );
}
