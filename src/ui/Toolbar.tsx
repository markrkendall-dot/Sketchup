import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { VIEW_MODE_LABEL, VIEW_MODES } from '../derive/phase';
import { activateUnderlayTool, setViewMode, switchTool } from '../editor2d/tools';
import { MEASURE_RULE } from '../editor2d/tools/wallTool';
import type { MeasureTo } from '../model/types';
import { getPlan, redo, undo, usePlanStore, useTemporal } from '../store/planStore';
import { isSiteModeTool, SITE_MODE_TOOL_HINT, useUiStore, type DrawPhase, type Layout, type ToolName } from '../store/uiStore';
import { visible3dLevels } from '../view3d/visibility';
import { choosePlanFile, newPlan, savePlan, zoomToFit } from './fileActions';
import { focusCanvas, releaseFocus } from './focus';

/** `short` replaces the label below 1100 px (index.css hides one of the two spans). */
const TOOLS: { name: ToolName; label: string; short?: string; key: string }[] = [
  { name: 'select', label: 'Select', key: 'S' },
  { name: 'wall', label: 'Wall', key: 'W' },
  { name: 'room', label: 'Room', key: 'R' },
  { name: 'door', label: 'Door', key: 'D' },
  { name: 'window', label: 'Window', key: 'N' },
  { name: 'passage', label: 'Passage', short: 'Opening', key: 'P' },
  { name: 'stairs', label: 'Stairs', key: 'T' },
  { name: 'roof', label: 'Roof', key: 'K' },
  { name: 'underlay', label: 'Underlay', short: 'Image', key: 'U' },
];

/** Only in site mode. */
const SITE_TOOL_BUTTONS: { name: ToolName; label: string; key: string; title: string }[] = [
  { name: 'gradePoint', label: 'Grade point', key: 'E', title: 'Grade point (E): click a spot on the ground, type its elevation, Enter' },
  { name: 'column', label: 'Column', key: 'C', title: 'Column (C): click to place a chimney; Tab switches to a post' },
];

const TOOL_TITLE: Partial<Record<ToolName, string>> = {
  roof: 'Roof (K): click the outline corners on the outside wall faces, close on the first corner or Enter',
  underlay: 'Underlay (U): load an image of a floor plan or sketch, scale it by two points, trace over it',
};

const LAYOUT_BUTTONS: { layout: Layout; label: string }[] = [
  { layout: '2d', label: '2D' },
  { layout: 'split', label: 'Split' },
  { layout: '3d', label: '3D' },
];

/**
 * Export menu: the 3D model as binary glTF (metres) or OBJ (inches), exactly as the 3D view shows
 * it (view mode and visible levels). The exporter and three load on first use.
 */
function ExportMenu() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const viewMode = useUiStore((s) => s.viewMode);
  const hidden = useUiStore((s) => s.hidden3dLevels);
  const only = useUiStore((s) => s.only3dActiveAndBelow);
  const active = useUiStore((s) => s.activeLevelId);
  const order = usePlanStore((s) => s.plan.levelOrder);
  const levels = usePlanStore((s) => s.plan.levels);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const run = async (format: 'glb' | 'obj') => {
    setBusy(true);
    try {
      const { downloadExport } = await import('../io/export3d');
      const ui = useUiStore.getState();
      await downloadExport(format, getPlan(), ui.viewMode, ui);
      setOpen(false);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const shown = visible3dLevels(order, { hidden3dLevels: hidden, only3dActiveAndBelow: only, activeLevelId: active })
    .map((id) => levels[id]?.name)
    .join(', ');

  return (
    <div
      className="menu-host"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button aria-haspopup="menu" aria-expanded={open} className={open ? 'active' : ''} onClick={() => setOpen((o) => !o)}>
        Export
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="Export">
          <button role="menuitem" disabled={busy} onClick={() => void run('glb')}>
            Export 3D (.glb)
            <small>glTF binary, in metres</small>
          </button>
          <button role="menuitem" disabled={busy} onClick={() => void run('obj')}>
            Export 3D (.obj)
            <small>Wavefront OBJ, in inches</small>
          </button>
          <p className="menu-note">
            Exports what the 3D view shows: the {VIEW_MODE_LABEL[viewMode]} view of {shown || 'no levels'}.
          </p>
          <p className="menu-note">
            Import in SketchUp: File &gt; Import, choose glTF; OBJ: set units to inches.
          </p>
        </div>
      )}
    </div>
  );
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
        if (e.key === 'Enter') releaseFocus(e.currentTarget);
        if (e.key === 'Escape') {
          setValue(name);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** Run a toolbar button's action, then give the keyboard back to the plan. */
const afterAction = (fn: () => void): void => {
  fn();
  focusCanvas();
};

/** Blur a select after a choice so the plan's hotkeys work again straight away. */
const blurAfter = (e: ChangeEvent<HTMLSelectElement>) => e.currentTarget.blur();

export function Toolbar() {
  const activeTool = useUiStore((s) => s.activeTool);
  const siteMode = useUiStore((s) => s.siteMode);
  const showGrid = useUiStore((s) => s.showGrid);
  const toggleGrid = useUiStore((s) => s.toggleGrid);
  const orthoLock = useUiStore((s) => s.orthoLock);
  const measureTo = useUiStore((s) => s.measureTo);
  const setOrthoLock = useUiStore((s) => s.setOrthoLock);
  const setMeasureTo = useUiStore((s) => s.setMeasureTo);
  const viewMode = useUiStore((s) => s.viewMode);
  const drawPhase = useUiStore((s) => s.drawPhase);
  const setDrawPhase = useUiStore((s) => s.setDrawPhase);
  const layout = useUiStore((s) => s.layout);
  const setLayout = useUiStore((s) => s.setLayout);
  const helpOpen = useUiStore((s) => s.helpOpen);
  const levelBarOpen = useUiStore((s) => s.levelBarOpen);
  const propertiesOpen = useUiStore((s) => s.propertiesOpen);
  const toggleLevelBar = useUiStore((s) => s.toggleLevelBar);
  const toggleProperties = useUiStore((s) => s.toggleProperties);
  const { canUndo, canRedo } = useTemporal();

  return (
    <header className="toolbar">
      <div className="toolbar-row">
        <span className="brand">HomePlan</span>
        <PlanName />
        <div className="group view-modes" role="group" aria-label="View mode">
          {VIEW_MODES.map((m) => (
            <button
              key={m}
              className={viewMode === m ? `active view-${m}` : `view-${m}`}
              aria-pressed={viewMode === m}
              title="View mode (V cycles): Existing shows existing + demolished, Proposed shows existing + new, All shows everything"
              onClick={() => {
                setViewMode(m);
                focusCanvas();
              }}
            >
              {VIEW_MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="group" role="group" aria-label="Layout">
          {LAYOUT_BUTTONS.map((b) => (
            <button
              key={b.layout}
              className={layout === b.layout ? 'active' : ''}
              aria-pressed={layout === b.layout}
              title="Layout: 2D plan, plan and 3D side by side, or 3D model (` cycles)"
              onClick={() => {
                setLayout(b.layout);
                focusCanvas();
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <div className="group" role="group" aria-label="History">
          <button
            disabled={!canUndo}
            onClick={() => {
              undo();
              focusCanvas();
            }}
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            disabled={!canRedo}
            onClick={() => {
              redo();
              focusCanvas();
            }}
            title="Redo (Ctrl+Shift+Z)"
          >
            Redo
          </button>
        </div>
        <div className="group" role="group" aria-label="File">
          <button onClick={() => afterAction(newPlan)} title="Start a new, empty plan">
            New
          </button>
          <button onClick={() => afterAction(choosePlanFile)} title="Open a plan file (Ctrl+O); replaces this plan">
            Open
          </button>
          <button onClick={() => afterAction(savePlan)} title="Download the plan as a JSON file (Ctrl+S)">
            Save
          </button>
        </div>
        <ExportMenu />
        <button
          className={`help-button${helpOpen ? ' active' : ''}`}
          aria-pressed={helpOpen}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          onClick={() => {
            useUiStore.getState().setHelpOpen(!helpOpen);
            focusCanvas();
          }}
        >
          ?
        </button>
      </div>
      <div className="toolbar-row">
        <div className="group" role="group" aria-label="Tools">
          {[...TOOLS, ...(siteMode ? SITE_TOOL_BUTTONS : [])].map((t) => {
            const off = siteMode && !isSiteModeTool(t.name);
            return (
              <button
                key={t.name}
                className={`${activeTool === t.name ? 'active' : ''}${off ? ' tool-off' : ''}`}
                aria-pressed={activeTool === t.name}
                aria-disabled={off || undefined}
                data-tool={t.name}
                title={off ? SITE_MODE_TOOL_HINT : ('title' in t ? t.title : TOOL_TITLE[t.name]) ?? `${t.label} (${t.key})`}
                onClick={() => {
                  if (t.name === 'underlay') activateUnderlayTool();
                  else switchTool(t.name);
                  focusCanvas();
                }}
              >
                {'short' in t && t.short ? (
                  <>
                    <span className="lbl-long">{t.label}</span>
                    <span className="lbl-short">{t.short}</span>
                  </>
                ) : (
                  t.label
                )}{' '}
                <kbd>{t.key}</kbd>
              </button>
            );
          })}
        </div>
        <label className="measure">
          Draw as
          <select
            aria-label="Phase for new elements"
            className={`phase-select phase-${drawPhase}`}
            value={drawPhase}
            onChange={(e) => {
              setDrawPhase(e.target.value as DrawPhase);
              blurAfter(e);
            }}
          >
            <option value="existing">existing</option>
            <option value="new">new</option>
          </select>
        </label>
        {!siteMode && (
          <label className="measure" title={MEASURE_RULE}>
            Lengths to
            <select
              aria-label="Typed wall lengths measure to"
              value={measureTo}
              onChange={(e) => {
                setMeasureTo(e.target.value as MeasureTo);
                blurAfter(e);
              }}
            >
              <option value="center">center</option>
              <option value="inside">inside face</option>
              <option value="outside">outside face</option>
            </select>
          </label>
        )}
        <div className="spacer" />
        <div className="group" role="group" aria-label="Plan view">
          <button
            className={showGrid ? 'active' : ''}
            aria-pressed={showGrid}
            onClick={() => afterAction(toggleGrid)}
            title="Grid (G)"
          >
            Grid
          </button>
          <button
            className={orthoLock ? 'active' : ''}
            aria-pressed={orthoLock}
            onClick={() => afterAction(() => setOrthoLock(!orthoLock))}
            title="Ortho lock (O); hold Shift to invert"
          >
            Ortho {orthoLock ? 'on' : 'off'}
          </button>
          <button onClick={() => afterAction(zoomToFit)} title="Zoom the plan to fit (Z)">
            Fit
          </button>
        </div>
        <div className="group narrow-only" role="group" aria-label="Panels">
          <button
            className={levelBarOpen ? 'active' : ''}
            aria-pressed={levelBarOpen}
            onClick={() => afterAction(toggleLevelBar)}
            title="Show or hide the level bar ([)"
          >
            Levels
          </button>
          <button
            className={propertiesOpen ? 'active' : ''}
            aria-pressed={propertiesOpen}
            onClick={() => afterAction(toggleProperties)}
            title="Show or hide the properties panel (])"
          >
            Properties
          </button>
        </div>
      </div>
    </header>
  );
}
