import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { VIEW_MODE_LABEL, VIEW_MODES } from '../derive/phase';
import { setViewMode, switchTool } from '../editor2d/tools';
import { MEASURE_RULE } from '../editor2d/tools/wallTool';
import { fitLevel, initialViewport } from '../editor2d/viewport';
import { downloadPlan, readPlanFile } from '../io/file';
import { createEmptyPlan, defaultLevelId } from '../model/plan';
import type { MeasureTo, Plan } from '../model/types';
import { getPlan, redo, undo, usePlanStore, useTemporal } from '../store/planStore';
import { useUiStore, type DrawPhase, type Layout, type ToolName } from '../store/uiStore';

const TOOLS: { name: ToolName; label: string; key: string }[] = [
  { name: 'select', label: 'Select', key: 'S' },
  { name: 'wall', label: 'Wall', key: 'W' },
  { name: 'room', label: 'Room', key: 'R' },
  { name: 'door', label: 'Door', key: 'D' },
  { name: 'window', label: 'Window', key: 'N' },
  { name: 'passage', label: 'Passage', key: 'P' },
  { name: 'stairs', label: 'Stairs', key: 'T' },
];

const LAYOUT_BUTTONS: { layout: Layout; label: string }[] = [
  { layout: '2d', label: '2D' },
  { layout: 'split', label: 'Split' },
  { layout: '3d', label: '3D' },
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
  const viewMode = useUiStore((s) => s.viewMode);
  const drawPhase = useUiStore((s) => s.drawPhase);
  const setDrawPhase = useUiStore((s) => s.setDrawPhase);
  const layout = useUiStore((s) => s.layout);
  const setLayout = useUiStore((s) => s.setLayout);
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
      <div className="group view-modes" role="group" aria-label="View mode">
        {VIEW_MODES.map((m) => (
          <button
            key={m}
            className={viewMode === m ? `active view-${m}` : `view-${m}`}
            aria-pressed={viewMode === m}
            title="View mode (V cycles): Existing shows existing + demolished, Proposed shows existing + new, All shows everything"
            onClick={() => setViewMode(m)}
          >
            {VIEW_MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <label className="measure">
        Draw as
        <select
          aria-label="Phase for new elements"
          className={`phase-select phase-${drawPhase}`}
          value={drawPhase}
          onChange={(e) => setDrawPhase(e.target.value as DrawPhase)}
        >
          <option value="existing">existing</option>
          <option value="new">new</option>
        </select>
      </label>
      <label className="measure" title={MEASURE_RULE}>
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
      <div className="group" role="group" aria-label="Layout">
        {LAYOUT_BUTTONS.map((b) => (
          <button
            key={b.layout}
            className={layout === b.layout ? 'active' : ''}
            aria-pressed={layout === b.layout}
            title="Layout: 2D plan, plan and 3D side by side, or 3D model (` cycles)"
            onClick={() => setLayout(b.layout)}
          >
            {b.label}
          </button>
        ))}
      </div>
      <div className="group" role="group" aria-label="File">
        <button onClick={onNew}>New</button>
        <button onClick={() => fileInput.current?.click()}>Open</button>
        <button onClick={() => downloadPlan(getPlan())}>Save</button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={onOpen} />
      </div>
    </header>
  );
}
