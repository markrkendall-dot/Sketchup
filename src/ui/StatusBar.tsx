import { formatLength } from '../model/units';
import { usePlanStore } from '../store/planStore';
import { useUiStore, type SnapKind, type ToolName } from '../store/uiStore';

const SNAP_LABEL: Record<SnapKind, string> = {
  node: 'corner',
  midpoint: 'midpoint',
  wall: 'on wall',
  guide: 'aligned',
  angle: '15° step',
  grid: 'grid',
  none: 'free',
};

const HINTS: Record<ToolName, { idle: string; busy: string }> = {
  wall: {
    idle: "Click to start. Type a length like 12'6 or 150 then Enter. Esc to finish.",
    busy: "Move to aim, type a length like 12'6 or 150 then Enter, or click. X: interior/exterior. Esc to finish.",
  },
  select: {
    idle: 'Click a wall or corner to select, drag to move, drag on empty space to box-select. Delete removes.',
    busy: 'Click a wall or corner to select, drag to move, drag on empty space to box-select. Delete removes.',
  },
};

export function StatusBar() {
  const tool = useUiStore((s) => s.activeTool);
  const draft = useUiStore((s) => s.draft);
  const kind = useUiStore((s) => s.nextWallKind);
  const levelId = useUiStore((s) => s.activeLevelId);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const levelName = usePlanStore((s) => s.plan.levels[levelId]?.name ?? '');
  const wallCount = usePlanStore((s) => {
    const walls = s.plan.levels[levelId]?.walls;
    return walls ? Object.keys(walls).length : 0;
  });
  const p = draft.snap?.point ?? draft.cursor;
  const drawing = draft.wallStart !== null;

  return (
    <footer className="statusbar">
      <span className="coords" title="Cursor position">
        {p ? `x ${formatLength(p.x, denom)}  y ${formatLength(p.y, denom)}` : ' '}
      </span>
      {draft.snap && <span className="snap">Snap: {SNAP_LABEL[draft.snap.kind]}</span>}
      {draft.wallPreview && <span>Length: {formatLength(draft.wallPreview.length, denom)}</span>}
      {draft.lengthBuffer && (
        <span className={draft.error ? 'buffer error' : 'buffer'}>
          Typed: <code>{draft.lengthBuffer}</code>
        </span>
      )}
      <span className={draft.error ? 'hint error' : 'hint'}>
        {draft.message ?? (drawing ? HINTS[tool].busy : HINTS[tool].idle)}
      </span>
      <span className="spacer" />
      {tool === 'wall' && (
        <span className={`wall-kind wall-kind-${kind}`} title="Press X to toggle">
          Next wall: {kind} (X)
        </span>
      )}
      <span>
        {levelName}: {wallCount} {wallCount === 1 ? 'wall' : 'walls'}
      </span>
    </footer>
  );
}
