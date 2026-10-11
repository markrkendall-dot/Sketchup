import { useEffect } from 'react';
import { PlanCanvas } from './editor2d/PlanCanvas';
import { RoomNameEditor } from './editor2d/RoomNameEditor';
import { cycleViewMode, dispatchKey, dispatchShift, switchLevelByIndex, switchTool } from './editor2d/tools';
import { redo, undo, usePlanStore } from './store/planStore';
import { useUiStore, type ToolName } from './store/uiStore';
import { LevelBar } from './ui/LevelBar';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { StatusBar } from './ui/StatusBar';
import { Toolbar } from './ui/Toolbar';

const TOOL_KEYS: Record<string, ToolName> = { s: 'select', w: 'wall', r: 'room', d: 'door', n: 'window', p: 'passage' };

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
  if (Object.hasOwn(TOOL_KEYS, key)) {
    switchTool(TOOL_KEYS[key]);
    e.preventDefault();
    return;
  }
  const drawing = ui.activeTool === 'wall' && ui.draft.wallStart !== null;
  if (drawing) return;
  if (key === 'o') {
    const { plan, updateSettings } = usePlanStore.getState();
    updateSettings({ orthoLock: !plan.settings.orthoLock });
  } else if (key === 'g') ui.toggleGrid();
  else if (key === 'v') cycleViewMode();
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
        <main className="canvas-host">
          <PlanCanvas />
          <RoomNameEditor />
        </main>
        <PropertiesPanel />
      </div>
      <StatusBar />
    </div>
  );
}
