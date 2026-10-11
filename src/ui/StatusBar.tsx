import { isOpeningVisible, isVisible, PHASE_LABEL, VIEW_MODE_LABEL } from '../derive/phase';
import { getFaces } from '../derive/rooms';
import { MEASURE_RULE } from '../editor2d/tools/wallTool';
import { formatLength } from '../model/units';
import { usePlanStore } from '../store/planStore';
import { useUiStore, type SnapKind, type ToolName, type UnderlayMode } from '../store/uiStore';

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
    idle: 'Click a wall, corner, opening or room label to select, drag to move, drag on empty space to box-select. Delete removes.',
    busy: 'Click a wall, corner, opening or room label to select, drag to move, drag on empty space to box-select. Delete removes.',
  },
  room: {
    idle: 'Click inside a closed area to name it. Click a label to select, drag to move it, double-click to rename. Delete removes.',
    busy: 'Click inside a closed area to name it. Click a label to select, drag to move it, double-click to rename. Delete removes.',
  },
  door: {
    idle: "Point at a wall. Click to place, or type the distance from the nearer corner's inside face and Enter. Tab: swing side, Shift+Tab: hinge.",
    busy: "Type the distance from the nearer corner's inside face to the door edge, then Enter. Tab: swing side, Shift+Tab: hinge.",
  },
  window: {
    idle: "Point at a wall. Click to place, or type the distance from the nearer corner's inside face and Enter.",
    busy: "Type the distance from the nearer corner's inside face to the window edge, then Enter.",
  },
  stairs: {
    idle: 'Move the mouse the way the stairs go up, then click to place the bottom step. Tab turns 90°. Edit the size in the properties panel.',
    busy: 'Move the mouse the way the stairs go up, then click to place the bottom step. Tab turns 90°. Edit the size in the properties panel.',
  },
  passage: {
    idle: "Point at a wall. Click to place, or type the distance from the nearer corner's inside face and Enter.",
    busy: "Type the distance from the nearer corner's inside face to the opening edge, then Enter.",
  },
  // Replaced by underlayHint(); kept for the Record type.
  underlay: { idle: '', busy: '' },
};

/** Status hint for the underlay tool's modes and calibration steps. */
function underlayHint(hasImage: boolean, locked: boolean, mode: UnderlayMode, points: number): string {
  if (!hasImage) return 'Click to load an image of a floor plan, sketch or photo (JPEG, PNG or WebP). PDF: export the page as an image first.';
  if (locked) return 'The image is locked. Unlock it in the properties panel to move or calibrate it. Draw walls over it with W.';
  if (mode === 'scale') {
    if (points === 0) return 'Scale: click the first of two points a known distance apart, e.g. the ends of a dimensioned wall.';
    if (points === 1) return 'Scale: click the second point. Esc starts over.';
    return "Type the real distance between the two points, like 20' or 12'6, then Enter. Esc starts over.";
  }
  if (mode === 'rotate') {
    if (points === 0) return 'Rotate: click the first of two points that should line up horizontally (or vertically).';
    return 'Rotate: click the second point. The image turns about the first point so the line is level. Esc starts over.';
  }
  return 'Drag the image to move it; arrow keys nudge 1" (Shift: 1\'). Use Scale by two points in the panel, then lock it and trace with W.';
}

export function StatusBar() {
  const tool = useUiStore((s) => s.activeTool);
  const draft = useUiStore((s) => s.draft);
  const kind = useUiStore((s) => s.nextWallKind);
  const levelId = useUiStore((s) => s.activeLevelId);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const levelName = usePlanStore((s) => s.plan.levels[levelId]?.name ?? '');
  const viewMode = useUiStore((s) => s.viewMode);
  const drawPhase = useUiStore((s) => s.drawPhase);
  const wallCount = usePlanStore((s) => {
    const walls = s.plan.levels[levelId]?.walls;
    let n = 0;
    for (const w of Object.values(walls ?? {})) if (isVisible(w.phase, viewMode)) n++;
    return n;
  });
  const openingCount = usePlanStore((s) => {
    const level = s.plan.levels[levelId];
    let n = 0;
    for (const o of Object.values(level?.openings ?? {})) {
      if (isOpeningVisible(o, level.walls[o.wallId], viewMode)) n++;
    }
    return n;
  });
  const openEnds = usePlanStore((s) => {
    const level = s.plan.levels[levelId];
    return level ? getFaces(level, viewMode).openEnds.length : 0;
  });
  const measureTo = usePlanStore((s) => s.plan.settings.measureTo);
  const hasUnderlay = usePlanStore((s) => !!s.plan.levels[levelId]?.underlay);
  const underlayLocked = usePlanStore((s) => !!s.plan.levels[levelId]?.underlay?.locked);
  const underlayMode = useUiStore((s) => s.underlayMode);
  const p = draft.snap?.point ?? draft.cursor;
  const drawing = draft.wallStart !== null || draft.lengthBuffer !== '';

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
        {draft.message ??
          (tool === 'underlay'
            ? underlayHint(hasUnderlay, underlayLocked, underlayMode, draft.underlayPoints.length)
            : drawing
              ? HINTS[tool].busy
              : HINTS[tool].idle)}
      </span>
      <span className="spacer" />
      {openEnds > 0 && (
        <span className="status-open-ends" title="Wall ends that join nothing (red dots). Rooms are only found where walls close a loop.">
          {openEnds} open wall {openEnds === 1 ? 'end' : 'ends'}
        </span>
      )}
      {tool === 'wall' && measureTo !== 'center' && (
        <span className="status-measure" title={MEASURE_RULE}>
          Lengths to {measureTo} face
        </span>
      )}
      {tool === 'wall' && (
        <span className={`wall-kind wall-kind-${kind}`} title="Press X to toggle">
          Next wall: {kind} (X)
        </span>
      )}
      <span className="status-view" title="View mode (V)">
        View: {VIEW_MODE_LABEL[viewMode]}
      </span>
      <span className={`status-phase phase-${drawPhase}`} title="Phase for new walls and openings">
        Drawing: {PHASE_LABEL[drawPhase].toLowerCase()}
      </span>
      <span className="status-counts">
        {levelName}: {wallCount} {wallCount === 1 ? 'wall' : 'walls'}, {openingCount}{' '}
        {openingCount === 1 ? 'opening' : 'openings'}
      </span>
    </footer>
  );
}
