import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { switchTool } from '../editor2d/tools';
import { fitLevel, initialViewport } from '../editor2d/viewport';
import { downloadPlan, readPlanFile } from '../io/file';
import { createEmptyPlan, defaultLevelId } from '../model/plan';
import type { MeasureTo, Plan } from '../model/types';
import { getPlan, redo, undo, usePlanStore, useTemporal } from '../store/planStore';
import { useUiStore, type ToolName } from '../store/uiStore';

const TOOLS: { name: ToolName; label: string; key: string }[] = [
  { name: 'select', label: 'Select', key: 'S' },
  { name: 'wall', label: 'Wall', key: 'W' },
];

function zoomToFit(): void {
  const ui = useUiStore.getState();
  const level = getPlan().levels[ui.activeLevelId];
  if (!level || ui.canvasSize.width === 0) return;
  ui.setViewport(fitLevel(level, ui.canvasSize) ?? initialViewport(ui.canvasSize));
}

/** Replace the whole plan (New/Open); undoable like any other edit. */
function loadPlan(plan: Plan): void {
  usePlanStore.getState().setPlan(plan);
  useUiStore.getState().setActiveLevel(defaultLevelId(plan));
  zoomToFit();
}

function PlanName() {
  const name = usePlanStore((s) => s.plan.name);
  const renamePlan = usePlanStore((s) => s.renamePlan);
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  const commit = () => {
    const v = value.trim();
    if (v && v !== name) renamePlan(v);
    else setValue(name);
  };
  return (
    <input
      className="plan-name"
      aria-label="Plan name"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setValue(name);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function Toolbar() {
  const activeTool = useUiStore((s) => s.activeTool);
  const showGrid = useUiStore((s) => s.showGrid);
  const toggleGrid = useUiStore((s) => s.toggleGrid);
  const orthoLock = usePlanStore((s) => s.plan.settings.orthoLock);
  const measureTo = usePlanStore((s) => s.plan.settings.measureTo);
  const updateSettings = usePlanStore((s) => s.updateSettings);
  const { canUndo, canRedo } = useTemporal();
  const fileInput = useRef<HTMLInputElement>(null);

  const onOpen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      loadPlan(await readPlanFile(file));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  };

  const onNew = () => {
    if (window.confirm('Start a new, empty plan? The current plan can be restored with Undo.')) {
      loadPlan(createEmptyPlan());
    }
  };

  return (
    <header className="toolbar">
      <span className="brand">HomePlan</span>
      <PlanName />
      <div className="group" role="group" aria-label="Tools">
        {TOOLS.map((t) => (
          <button
            key={t.name}
            className={activeTool === t.name ? 'active' : ''}
            aria-pressed={activeTool === t.name}
            title={`${t.label} (${t.key})`}
            onClick={() => switchTool(t.name)}
          >
            {t.label} <kbd>{t.key}</kbd>
          </button>
        ))}
      </div>
      <div className="group" role="group" aria-label="History">
        <button disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">
          Redo
        </button>
      </div>
      <div className="group" role="group" aria-label="View">
        <button className={showGrid ? 'active' : ''} aria-pressed={showGrid} onClick={toggleGrid} title="Grid (G)">
          Grid
        </button>
        <button
          className={orthoLock ? 'active' : ''}
          aria-pressed={orthoLock}
          onClick={() => updateSettings({ orthoLock: !orthoLock })}
          title="Ortho lock (O); hold Shift to invert"
        >
          Ortho {orthoLock ? 'on' : 'off'}
        </button>
        <button onClick={zoomToFit} title="Zoom to fit">
          Fit
        </button>
      </div>
      <label className="measure">
        Lengths to
        <select
          value={measureTo}
          onChange={(e) => updateSettings({ measureTo: e.target.value as MeasureTo })}
        >
          <option value="center">center</option>
          <option value="inside">inside face</option>
          <option value="outside">outside face</option>
        </select>
      </label>
      <div className="spacer" />
      <div className="group" role="group" aria-label="File">
        <button onClick={onNew}>New</button>
        <button onClick={() => fileInput.current?.click()}>Open</button>
        <button onClick={() => downloadPlan(getPlan())}>Save</button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={onOpen} />
      </div>
    </header>
  );
}
