import { useState } from 'react';
import { getLevelElevations } from '../derive/levels';
import { cancelActiveTool, enterSiteMode, switchLevel } from '../editor2d/tools';
import { levelContentCount, type LevelEdit, type LevelPosition } from '../model/levelOps';
import { groundLevelId } from '../model/plan';
import { STRUCTURE_KIND_LABEL, STRUCTURE_KINDS, firstStructure, stackOf, structureOf } from '../model/structures';
import { freshStructureName } from '../model/structureOps';
import type { Id, StructureKind } from '../model/types';
import { formatLength } from '../model/units';
import { getPlan, usePlanStore } from '../store/planStore';
import { activeStructureId, EMPTY_SELECTION, useUiStore } from '../store/uiStore';
import { focusCanvas } from './focus';

function LevelTab({ levelId, index }: { levelId: Id; index: number }) {
  const name = usePlanStore((s) => s.plan.levels[levelId]?.name ?? '');
  const wallCount = usePlanStore((s) => Object.keys(s.plan.levels[levelId]?.walls ?? {}).length);
  const floorTop = usePlanStore((s) => getLevelElevations(s.plan)[levelId]?.floorTop ?? 0);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const active = useUiStore((s) => s.activeLevelId === levelId && !s.siteMode);
  const updateLevel = usePlanStore((s) => s.updateLevel);
  const [editing, setEditing] = useState<string | null>(null);

  const commit = () => {
    const v = editing?.trim();
    if (v && v !== name) updateLevel(levelId, { name: v });
    setEditing(null);
  };

  if (editing !== null) {
    return (
      <div className="level-tab editing">
        <input
          autoFocus
          aria-label="Level name"
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(null);
          }}
        />
      </div>
    );
  }
  const hotkey = index < 9 ? String(index + 1) : null;
  return (
    <button
      className={`level-tab${active ? ' active' : ''}`}
      aria-pressed={active}
      data-level-id={levelId}
      title={`${name}${hotkey ? ` (${hotkey})` : ''}. Double-click to rename.`}
      onClick={() => {
        switchLevel(levelId);
        focusCanvas();
      }}
      onDoubleClick={() => setEditing(name)}
    >
      <span className="level-name">{name}</span>
      {hotkey && <kbd>{hotkey}</kbd>}
      <span className="level-meta">
        floor {formatLength(floorTop, denom)} · {wallCount} {wallCount === 1 ? 'wall' : 'walls'}
      </span>
    </button>
  );
}

/**
 * The Site pseudo-level, below the lowest level: grade points, chimney and posts, ground surfaces,
 * fences, the north angle.
 * The 2D view shows the first floor as a ghost under the site layer.
 */
function SiteTab() {
  const active = useUiStore((s) => s.siteMode);
  const points = usePlanStore((s) => Object.keys(s.plan.site.gradePoints).length);
  const columns = usePlanStore((s) => Object.keys(s.plan.site.columns).length);
  return (
    <button
      className={`level-tab site-tab${active ? ' active' : ''}`}
      aria-pressed={active}
      data-site-tab
      title="Site: grade points (the ground), chimney and posts, ground surfaces and fences, north. Pick any level to go back to editing it."
      onClick={() => {
        enterSiteMode();
        focusCanvas();
      }}
    >
      <span className="level-name">Site</span>
      <span className="level-meta">
        {points} grade {points === 1 ? 'point' : 'points'} · {columns} {columns === 1 ? 'column' : 'columns'}
      </span>
    </button>
  );
}

function copyWallsFromBelow(activeId: Id, belowId: Id): void {
  const plan = getPlan();
  const active = plan.levels[activeId];
  const below = plan.levels[belowId];
  const existing = Object.keys(active.walls).length;
  if (
    existing > 0 &&
    !window.confirm(
      `${active.name} already has ${existing} ${existing === 1 ? 'wall' : 'walls'}. ` +
        `Add the walls from ${below.name} to it? (Undo reverts the copy.)`,
    )
  ) {
    return;
  }
  const { copied, skipped } = usePlanStore.getState().copyWallsFromLevel(belowId, activeId);
  useUiStore.getState().setSelection(EMPTY_SELECTION);
  if (skipped > 0) {
    const n = (k: number) => `${k} ${k === 1 ? 'wall' : 'walls'}`;
    useUiStore.getState().setNotice({
      text: `Copied ${n(copied)} from ${below.name}; skipped ${n(skipped)} that would lie on top of walls already on ${active.name}.`,
      error: false,
    });
  }
}

/** Say in the status bar what a level edit had to change elsewhere (model/levelOps.ts fitLevelsToOrder). */
function reportAdjusted(edit: LevelEdit | null, done: string): void {
  if (!edit) return;
  const extra = edit.adjusted.length ? ` ${edit.adjusted.join('; ')}.` : '';
  useUiStore.getState().setNotice({ text: `${done}.${extra}`, error: false });
}

function addLevel(position: LevelPosition): void {
  cancelActiveTool();
  const edit = usePlanStore.getState().addLevel(position, undefined, structureOf(getPlan(), useUiStore.getState().activeLevelId)?.id);
  if (!edit) return;
  switchLevel(edit.id);
  reportAdjusted(edit, `Added ${getPlan().levels[edit.id]?.name ?? 'a level'} (double-click its tab to rename it)`);
}

function deleteLevel(levelId: Id): void {
  const plan = getPlan();
  const level = plan.levels[levelId];
  if (!level || stackOf(plan, levelId).length < 2) return;
  const n = levelContentCount(plan, levelId);
  if (n > 0 && !window.confirm(`Delete ${level.name} and the ${n} ${n === 1 ? 'thing' : 'things'} drawn on it? (Undo brings it back.)`)) return;
  cancelActiveTool();
  reportAdjusted(usePlanStore.getState().deleteLevel(levelId), `Deleted ${level.name}`);
}

function moveLevel(levelId: Id, direction: 'up' | 'down'): void {
  cancelActiveTool();
  const name = getPlan().levels[levelId]?.name ?? 'the level';
  reportAdjusted(usePlanStore.getState().moveLevel(levelId, direction), `Moved ${name} ${direction}`);
}

/** Add, move and delete levels: they work on the active level (not in site mode). */
function LevelActions({ activeId, index, count }: { activeId: Id; index: number; count: number }) {
  const siteMode = useUiStore((s) => s.siteMode);
  const name = usePlanStore((s) => s.plan.levels[activeId]?.name ?? '');
  const off = siteMode || index < 0;
  const act = (fn: () => void) => () => {
    fn();
    focusCanvas();
  };
  return (
    <div className="level-actions" role="group" aria-label="Level actions">
      <button disabled={off} title={off ? 'Pick a level first' : `Add an empty level just above ${name}`} onClick={act(() => addLevel({ above: activeId }))}>
        Add above
      </button>
      <button
        disabled={off}
        title={off ? 'Pick a level first' : index === 0 ? `Add an empty level under ${name}; the levels above keep their heights` : `Add an empty level just below ${name}`}
        onClick={act(() => addLevel({ below: activeId }))}
      >
        Add below
      </button>
      <button disabled={off || index >= count - 1} title={`Move ${name} up past the level above it`} onClick={act(() => moveLevel(activeId, 'up'))}>
        Move up
      </button>
      <button disabled={off || index <= 0} title={`Move ${name} down past the level below it`} onClick={act(() => moveLevel(activeId, 'down'))}>
        Move down
      </button>
      <button
        className="level-delete"
        disabled={off || count < 2}
        title={count < 2 ? 'A building keeps at least one level' : `Delete ${name} and everything on it`}
        onClick={act(() => deleteLevel(activeId))}
      >
        Delete level
      </button>
    </div>
  );
}

/** The structure being edited: the active level's (the main one in site mode, which parks there). */
function useActiveStructureId(): Id | undefined {
  const activeId = useUiStore((s) => s.activeLevelId);
  return usePlanStore((s) => activeStructureId(s.plan, { activeLevelId: activeId }));
}

/** Open a structure: its ground floor becomes the active level. */
function openStructure(id: Id): void {
  const s = getPlan().structures[id];
  const levelId = s && (groundLevelId(s) ?? s.levelOrder[0]);
  if (levelId) switchLevel(levelId);
}

function deleteStructure(id: Id): void {
  const plan = getPlan();
  const s = plan.structures[id];
  if (!s || plan.structureOrder.length < 2) return;
  const n = s.levelOrder.reduce((k, lid) => k + levelContentCount(plan, lid), 0);
  const levels = `${s.levelOrder.length} ${s.levelOrder.length === 1 ? 'level' : 'levels'}`;
  if (n > 0 && !window.confirm(`Delete ${s.name}, its ${levels} and the ${n} ${n === 1 ? 'thing' : 'things'} drawn on them? (Undo brings it back.)`)) return;
  cancelActiveTool();
  // Leave the structure first, so the level bar does not hand over to a level that is going.
  const ui = useUiStore.getState();
  if (structureOf(plan, ui.activeLevelId)?.id === id) openStructure(plan.structureOrder.find((x) => x !== id)!);
  if (usePlanStore.getState().deleteStructure(id)) useUiStore.getState().setNotice({ text: `Deleted ${s.name}`, error: false });
}

/**
 * The buildings on the site (DESIGN.md "Structures"): pick the one to edit, add a garage, shed or
 * other building beside the others, rename or delete it. Its levels are listed under it.
 */
function StructureBar() {
  const ids = usePlanStore((s) => s.plan.structureOrder);
  const names = usePlanStore((s) => s.plan.structureOrder.map((id) => s.plan.structures[id]?.name ?? '').join('\u0000')).split('\u0000');
  const activeId = useActiveStructureId();
  const activeName = usePlanStore((s) => (activeId ? s.plan.structures[activeId]?.name : '') ?? '');
  const siteMode = useUiStore((s) => s.siteMode);
  const [adding, setAdding] = useState<{ kind: StructureKind; name: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const commitRename = () => {
    const v = renaming?.trim();
    if (v && activeId && v !== activeName) usePlanStore.getState().renameStructure(activeId, v);
    setRenaming(null);
  };
  const commitAdd = () => {
    if (!adding) return;
    cancelActiveTool();
    const id = usePlanStore.getState().addStructure({ kind: adding.kind, name: adding.name.trim() || undefined, phase: useUiStore.getState().drawPhase });
    setAdding(null);
    openStructure(id);
    const s = getPlan().structures[id];
    if (s) useUiStore.getState().setNotice({ text: `Added ${s.name} beside the others: move or turn it in the properties panel (Building).`, error: false });
  };
  return (
    <div className="structure-bar" role="group" aria-label="Buildings">
      <div className="panel-title">Buildings</div>
      {renaming !== null ? (
        <input
          autoFocus
          className="structure-name"
          aria-label="Building name"
          value={renaming}
          onChange={(e) => setRenaming(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setRenaming(null);
          }}
        />
      ) : (
        <select
          className="structure-select"
          aria-label="Building to edit"
          value={siteMode ? '' : (activeId ?? '')}
          onChange={(e) => {
            openStructure(e.target.value);
            focusCanvas();
          }}
        >
          {siteMode && <option value="">Site</option>}
          {ids.map((id, i) => (
            <option key={id} value={id}>
              {names[i]}
            </option>
          ))}
        </select>
      )}
      {adding ? (
        <div className="structure-add">
          <select aria-label="Kind of building" value={adding.kind} onChange={(e) => setAdding({ kind: e.target.value as StructureKind, name: '' })}>
            {STRUCTURE_KINDS.map((k) => (
              <option key={k} value={k}>
                {STRUCTURE_KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <input
            aria-label="New building name"
            placeholder={freshStructureName(getPlan(), STRUCTURE_KIND_LABEL[adding.kind])}
            value={adding.name}
            onChange={(e) => setAdding({ ...adding, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitAdd();
              if (e.key === 'Escape') setAdding(null);
            }}
          />
          <div className="level-actions">
            <button onClick={commitAdd} title="Add it beside the other buildings">
              Add
            </button>
            <button onClick={() => setAdding(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="level-actions">
          <button title="Add a garage, shed or other building to the site" onClick={() => setAdding({ kind: 'garage', name: '' })}>
            Add building
          </button>
          <button disabled={siteMode || !activeId} title={`Rename ${activeName}`} onClick={() => setRenaming(activeName)}>
            Rename
          </button>
          <button
            className="level-delete"
            disabled={siteMode || ids.length < 2 || !activeId}
            title={ids.length < 2 ? 'A plan keeps at least one building' : `Delete ${activeName}, its levels and everything on them`}
            onClick={() => {
              if (activeId) deleteStructure(activeId);
              focusCanvas();
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function LevelBar() {
  const activeStructure = useActiveStructureId();
  const order = usePlanStore((s) => (activeStructure && s.plan.structures[activeStructure]?.levelOrder) || firstStructure(s.plan).levelOrder);
  const activeId = useUiStore((s) => s.activeLevelId);
  const showBelow = useUiStore((s) => s.showLevelBelow);
  const toggleShowBelow = useUiStore((s) => s.toggleShowLevelBelow);
  const index = order.indexOf(activeId);
  const belowId = index > 0 ? order[index - 1] : null;
  const belowName = usePlanStore((s) => (belowId ? s.plan.levels[belowId]?.name : null));
  const belowWalls = usePlanStore((s) => (belowId ? Object.keys(s.plan.levels[belowId]?.walls ?? {}).length : 0));
  const hasUnderlay = usePlanStore((s) => !!s.plan.levels[activeId]?.underlay);
  const showUnderlay = useUiStore((s) => s.showUnderlay);
  const toggleShowUnderlay = useUiStore((s) => s.toggleShowUnderlay);

  return (
    <nav className="level-bar" aria-label="Levels">
      <StructureBar />
      <div className="panel-title">Levels</div>
      <div className="level-tabs">
        {order
          .map((id, i) => ({ id, i }))
          .reverse()
          .map(({ id, i }) => (
            <LevelTab key={id} levelId={id} index={i} />
          ))}
        <SiteTab />
      </div>
      <LevelActions activeId={activeId} index={index} count={order.length} />
      <label className="level-option" title={belowName ? `Draw ${belowName} faintly under this level` : 'No level below'}>
        <input type="checkbox" checked={showBelow} disabled={!belowId} onChange={toggleShowBelow} />
        Show level below
      </label>
      <label
        className="level-option"
        title={hasUnderlay ? 'Hide the image under this level for a moment (it stays in the plan)' : 'No image under this level (Underlay tool, U)'}
      >
        <input type="checkbox" checked={showUnderlay} disabled={!hasUnderlay} onChange={toggleShowUnderlay} />
        Show underlay
      </label>
      <button
        className="level-copy"
        disabled={!belowId || belowWalls === 0}
        title={belowName ? `Copy the walls of ${belowName} onto this level (openings are not copied)` : 'No level below'}
        onClick={() => {
          if (belowId) copyWallsFromBelow(activeId, belowId);
          focusCanvas();
        }}
      >
        Copy walls from level below
      </button>
    </nav>
  );
}
