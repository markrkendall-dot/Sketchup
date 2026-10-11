import { isOpeningVisible, isVisible, PHASE_LABEL, VIEW_MODE_LABEL } from '../derive/phase';
import { getFaces } from '../derive/rooms';
import { wallPreviewText } from '../editor2d/previewLabel';
import { MEASURE_RULE } from '../editor2d/tools/wallTool';
import { formatLength } from '../model/units';
import { usePlanStore } from '../store/planStore';
import { useUiStore, type SnapKind, type ToolName, type UnderlayMode } from '../store/uiStore';

const SNAP_LABEL: Record<SnapKind, string> = {
  node: 'corner',
  midpoint: 'midpoint',
  wall: 'on wall',
  'ghost-node': 'corner below',
  'ghost-wall': 'wall below',
  guide: 'aligned',
  angle: '15° step',
  grid: 'grid',
  none: 'free',
};

/**
 * Tool hints, about 60 characters so they fit the bar at 1280 px. The full text is the hint's
 * tooltip (FULL_HINTS) and the long forms are in the ? help (ui/keymap.ts).
 */
const HINTS: Record<ToolName, { idle: string; busy: string }> = {
  wall: {
    idle: 'Click to start a wall, or type a length. ? lists keys.',
    busy: 'Type a length; Enter or click commits at the cursor. Esc ends.',
  },
  select: {
    idle: 'Click to select, drag to move, drag empty space to box-select.',
    busy: 'Click to select, drag to move, drag empty space to box-select.',
  },
  room: {
    idle: 'Click a closed area to name it. Double-click a label to rename.',
    busy: 'Click a closed area to name it. Double-click a label to rename.',
  },
  door: {
    idle: 'Point at a wall, click or type the distance. Tab flips swing.',
    busy: 'Type the distance from the corner, Enter. Tab flips swing.',
  },
  window: {
    idle: 'Point at a wall, click or type the distance from the corner.',
    busy: 'Type the distance from the corner, then Enter.',
  },
  stairs: {
    idle: 'Move the way the stairs go up, click to place. Tab turns 90°.',
    busy: 'Move the way the stairs go up, click to place. Tab turns 90°.',
  },
  passage: {
    idle: 'Point at a wall, click or type the distance from the corner.',
    busy: 'Type the distance from the corner, then Enter.',
  },
  // Replaced by underlayHint(); kept for the Record type.
  underlay: { idle: '', busy: '' },
};

/** The same hints in full, shown as the tooltip. */
const FULL_HINTS: Record<ToolName, { idle: string; busy: string }> = {
  wall: {
    idle: "Click to start a wall. Or type a length like 12'6 or 150 then Enter. Esc to finish. ? lists all keys.",
    busy: "Move to aim, type a length like 12'6 or 150 then Enter, or click. Enter or click commits at the cursor. X: interior/exterior. Esc to finish.",
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
  underlay: { idle: '', busy: '' },
};

/** 3D layout: orbit hints in place of the 2D tool hints (the walk view has its own overlay hint). */
const ORBIT_HINT = 'Drag to orbit, right-drag to pan, wheel to zoom, F to walk';
const WALK_HINT = 'WASD to move, drag to look around, Esc or F to stop walking';

/** Status hint for the underlay tool's modes and calibration steps: [short, full]. */
function underlayHint(hasImage: boolean, locked: boolean, mode: UnderlayMode, points: number): [string, string] {
  if (!hasImage)
    return [
      'Click to load an image of a floor plan (JPEG, PNG, WebP).',
      'Click to load an image of a floor plan, sketch or photo (JPEG, PNG or WebP). PDF: export the page as an image first.',
    ];
  if (locked)
    return [
      'The image is locked. Unlock it in the panel to move it.',
      'The image is locked. Unlock it in the properties panel to move or calibrate it. Draw walls over it with W.',
    ];
  if (mode === 'scale') {
    if (points === 0)
      return [
        'Scale: click the first of two points a known distance apart.',
        'Scale: click the first of two points a known distance apart, e.g. the ends of a dimensioned wall.',
      ];
    if (points === 1) return ['Scale: click the second point. Esc starts over.', 'Scale: click the second point. Esc starts over.'];
    return [
      "Type the real distance, like 20' or 12'6, then Enter.",
      "Type the real distance between the two points, like 20' or 12'6, then Enter. Esc starts over.",
    ];
  }
  if (mode === 'rotate') {
    if (points === 0)
      return [
        'Rotate: click the first of two points that should line up.',
        'Rotate: click the first of two points that should line up horizontally (or vertically).',
      ];
    return [
      'Rotate: click the second point. Esc starts over.',
      'Rotate: click the second point. The image turns about the first point so the line is level. Esc starts over.',
    ];
  }
  return [
    'Drag the image to move it; arrows nudge 1" (Shift: 1\').',
    'Drag the image to move it; arrow keys nudge 1" (Shift: 1\'). Use Scale by two points in the properties panel, then lock it and trace with W.',
  ];
}

// The parts that change on every pointer move (cursor, snap, rubber band length) are their own
// small components, each selecting only its value, so a mouse move re-renders those and the
// overlay, not the whole bar.

/** Cursor position readout (the snapped point while snapping). */
function CursorCoords({ denom }: { denom: number }) {
  const p = useUiStore((s) => s.draft.snap?.point ?? s.draft.cursor);
  return (
    <span className="coords" title="Cursor position">
      {p ? `x ${formatLength(p.x, denom)}  y ${formatLength(p.y, denom)}` : ' '}
    </span>
  );
}

function SnapKindLabel() {
  const kind = useUiStore((s) => s.draft.snap?.kind);
  return kind ? <span className="snap">Snap: {SNAP_LABEL[kind]}</span> : null;
}

function PreviewLength({ denom }: { denom: number }) {
  const preview = useUiStore((s) => s.draft.wallPreview);
  return preview ? <span>Length: {wallPreviewText(preview, denom, false)}</span> : null;
}

export function StatusBar() {
  const tool = useUiStore((s) => s.activeTool);
  const lengthBuffer = useUiStore((s) => s.draft.lengthBuffer);
  const error = useUiStore((s) => s.draft.error);
  const message = useUiStore((s) => s.draft.message);
  const drawing = useUiStore((s) => s.draft.wallStart !== null || s.draft.lengthBuffer !== '');
  const underlayPoints = useUiStore((s) => s.draft.underlayPoints.length);
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
  const measureTo = useUiStore((s) => s.measureTo);
  const hasUnderlay = usePlanStore((s) => !!s.plan.levels[levelId]?.underlay);
  const underlayLocked = usePlanStore((s) => !!s.plan.levels[levelId]?.underlay?.locked);
  const underlayMode = useUiStore((s) => s.underlayMode);
  const notice = useUiStore((s) => s.notice);
  const layout = useUiStore((s) => s.layout);
  const walking = useUiStore((s) => s.cameraMode === 'walk');

  let hint: { text: string; full: string; error: boolean };
  if (layout === '3d') {
    const text = walking ? WALK_HINT : ORBIT_HINT;
    hint = { text, full: text, error: false };
  } else if (message) hint = { text: message, full: message, error };
  else if (tool === 'underlay') {
    const [text, full] = underlayHint(hasUnderlay, underlayLocked, underlayMode, underlayPoints);
    hint = { text, full, error };
  } else {
    const phase = drawing ? 'busy' : 'idle';
    hint = { text: HINTS[tool][phase], full: FULL_HINTS[tool][phase], error };
  }

  return (
    <footer className="statusbar">
      <CursorCoords denom={denom} />
      <SnapKindLabel />
      <PreviewLength denom={denom} />
      {lengthBuffer && (
        <span className={error ? 'buffer error' : 'buffer'}>
          Typed: <code>{lengthBuffer}</code>
        </span>
      )}
      <span className={hint.error ? 'hint error' : 'hint'} title={hint.full}>
        {hint.text}
      </span>
      <span className="spacer" />
      {notice && (
        <span className={`status-notice${notice.error ? ' error' : ''}`} role={notice.error ? 'alert' : 'status'} title={notice.text}>
          {notice.text}
        </span>
      )}
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
