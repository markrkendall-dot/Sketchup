import { useState } from 'react';
import { getLevelElevations } from '../derive/levels';
import { enterSiteMode, switchLevel } from '../editor2d/tools';
import type { Id } from '../model/types';
import { formatLength } from '../model/units';
import { getPlan, usePlanStore } from '../store/planStore';
import { EMPTY_SELECTION, useUiStore } from '../store/uiStore';
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

export function LevelBar() {
  const order = usePlanStore((s) => s.plan.levelOrder);
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
