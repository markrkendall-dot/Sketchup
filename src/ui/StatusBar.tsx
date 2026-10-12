import { isOpeningVisible, isVisible, PHASE_LABEL, VIEW_MODE_LABEL } from '../derive/phase';
import { getFaces } from '../derive/rooms';
import { wallPreviewText } from '../editor2d/previewLabel';
import { MEASURE_RULE } from '../editor2d/tools/wallTool';
import { formatLength } from '../model/units';
import { usePlanStore } from '../store/planStore';
import { selectionSize, useUiStore, type SnapKind, type ToolName, type UnderlayMode } from '../store/uiStore';
import { measureText } from '../editor2d/tools/measureTool';
import { OPENING_CYCLE_HINT } from '../editor2d/tools/selectTool';

const SNAP_LABEL: Record<SnapKind, string> = {
  node: 'corner',
  midpoint: 'midpoint',
  wall: 'on wall',
  'ghost-node': 'corner below',
  'ghost-wall': 'wall below',
  'face-corner': 'wall face corner',
  'face-edge': 'wall face',
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
  rect: {
    idle: 'Click a corner of the box, or snap to one.',
    busy: "Type 12' x 10' (or 12' Tab 10') and Enter, or click a corner.",
  },
  measure: {
    idle: 'Click the first point to measure from.',
    busy: 'Click the second point. Esc clears.',
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
  roof: {
    idle: 'Click the roof outline corners on the outside wall faces.',
    busy: 'Click the next corner; the first one or Enter closes. Esc cancels.',
  },
  // Replaced by underlayHint(); kept for the Record type.
  underlay: { idle: '', busy: '' },
  fixture: {
    idle: 'Point along a wall, click to place. Type a width to change it.',
    busy: 'Type the width, then click or Enter to place. Esc clears.',
  },
  gradePoint: {
    idle: 'Click a spot on the ground, then type its elevation.',
    busy: "Type the elevation (-4, -6'4), Enter places it. Esc cancels.",
  },
  column: {
    idle: 'Click to place; Tab switches chimney and post.',
    busy: 'Click to place; Tab switches chimney and post.',
  },
};

/** Site mode's select tool. */
const SITE_SELECT_HINT: [string, string] = [
  'Click a grade point or column, drag to move. E and C place them.',
  'Click a grade point or column to select it, drag to move, Delete removes. E places a grade point, C a chimney or post. Choose a level to draw walls.',
];

/** The same hints in full, shown as the tooltip. */
const FULL_HINTS: Record<ToolName, { idle: string; busy: string }> = {
  wall: {
    idle: "Click to start a wall. Or type a length like 12'6 or 150 then Enter. Esc to finish. ? lists all keys.",
    busy: "Move to aim, type a length like 12'6 or 150 then Enter, or click. Enter or click commits at the cursor. X: interior/exterior. Esc to finish.",
  },
  select: {
    idle: 'Click a wall, corner, opening or room label to select, drag to move, drag on empty space to box-select. Delete removes. Shift+arrows move the selected walls 1".',
    busy: 'Click a wall, corner, opening or room label to select, drag to move, drag on empty space to box-select. Delete removes. Shift+arrows move the selected walls 1".',
  },
  rect: {
    idle: 'Click the first corner of a box of four walls (it snaps like the wall tool, including the level below). X: interior/exterior.',
    busy: "Move toward the side the box goes, then type the two sizes (12' x 10', 12' by 10', or 12' Tab 10') and Enter, or click the opposite corner. Lengths to applies: inside face gives the room's inside size. Esc cancels.",
  },
  measure: {
    idle: 'Click two points to measure between them; corners of wall faces and walls snap. Nothing in the plan changes.',
    busy: 'Click the second point. The distance stays in the status bar until Esc or the next measurement.',
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
  roof: {
    idle: 'Click the corners of the roof outline; they snap to the outside corners and faces of the walls. Then set the shape, ridge and slope in the properties panel (or use Fit to walls there).',
    busy: 'Click the next corner. Click the first corner, double-click or press Enter to close the outline. Backspace removes the last corner, Esc cancels.',
  },
  underlay: { idle: '', busy: '' },
  fixture: {
    idle: 'The cabinet or appliance follows the cursor with its back on the nearest wall face and slides to abut the last one; click to place it. Type a width (36, 2\'6) to change it; pick the kind in the properties panel; hold Shift for free placement, Tab turns it.',
    busy: 'Type the width in feet and inches, then click or press Enter to place it. Esc clears the width.',
  },
  gradePoint: {
    idle: 'Click a spot on the ground. Then type its elevation in feet and inches (minus allowed, e.g. -4 or -6\'4) and press Enter; with nothing typed Enter uses the first floor level.',
    busy: "Type the elevation in feet and inches (-4, -6'4, 8'), then Enter places the grade point. Esc clears it, then cancels.",
  },
  column: {
    idle: 'Click to place a column. Tab switches between a chimney (24" x 40") and a post (6" x 6"); set the size and heights in the properties panel.',
    busy: 'Click to place a column. Tab switches between a chimney and a post.',
  },
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
  const box = useUiStore((s) => s.draft.rectPreview?.label);
  if (box) return <span>Box: {box}</span>;
  return preview ? <span>Length: {wallPreviewText(preview, denom, false)}</span> : null;
}

/** Select tool: how far the current wall or corner drag has moved. */
function DragReadout() {
  const text = useUiStore((s) => s.draft.dragReadout);
  return text ? <span className="drag-readout">{text}</span> : null;
}

/** Measure tool: the distance to the cursor while the second point is being chosen. */
function MeasureLive({ denom }: { denom: number }) {
  const a = useUiStore((s) => (s.activeTool === 'measure' && s.draft.measure && !s.draft.measure.b ? s.draft.measure.a : null));
  const b = useUiStore((s) => s.draft.snap?.point ?? null);
  return a && b ? <span className="measure-live">Distance {measureText(a, b, denom)}</span> : null;
}

export function StatusBar() {
  const tool = useUiStore((s) => s.activeTool);
  const lengthBuffer = useUiStore((s) => s.draft.lengthBuffer);
  const error = useUiStore((s) => s.draft.error);
  const message = useUiStore((s) => s.draft.message);
  const drawing = useUiStore(
    (s) =>
      s.draft.wallStart !== null ||
      s.draft.lengthBuffer !== '' ||
      s.draft.roofPoints.length > 0 ||
      s.draft.gradePending !== null ||
      s.draft.rectStart !== null ||
      (s.draft.measure !== null && s.draft.measure.b === null),
  );
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
  const siteMode = useUiStore((s) => s.siteMode);
  const roofCount = usePlanStore((s) => {
    let n = 0;
    for (const r of Object.values(s.plan.levels[levelId]?.roofs ?? {})) if (isVisible(r.phase, viewMode)) n++;
    return n;
  });
  const fixtureCount = usePlanStore((s) => {
    let n = 0;
    for (const f of Object.values(s.plan.levels[levelId]?.fixtures ?? {})) if (isVisible(f.phase, viewMode)) n++;
    return n;
  });
  const gradeCount = usePlanStore((s) => Object.keys(s.plan.site.gradePoints).length);
  const columnCount = usePlanStore((s) => {
    let n = 0;
    for (const c of Object.values(s.plan.site.columns)) if (isVisible(c.phase, viewMode)) n++;
    return n;
  });
  const hasUnderlay = usePlanStore((s) => !!s.plan.levels[levelId]?.underlay);
  const underlayLocked = usePlanStore((s) => !!s.plan.levels[levelId]?.underlay?.locked);
  const underlayMode = useUiStore((s) => s.underlayMode);
  const notice = useUiStore((s) => s.notice);
  const layout = useUiStore((s) => s.layout);
  const walking = useUiStore((s) => s.cameraMode === 'walk');
  // One opening selected (and nothing else): a second click on it selects its wall.
  const oneOpening = useUiStore((s) => s.selection.openings.length === 1 && selectionSize(s.selection) === 1);

  let hint: { text: string; full: string; error: boolean };
  if (layout === '3d') {
    const text = walking ? WALK_HINT : ORBIT_HINT;
    hint = { text, full: text, error: false };
  } else if (message) hint = { text: message, full: message, error };
  else if (tool === 'underlay') {
    const [text, full] = underlayHint(hasUnderlay, underlayLocked, underlayMode, underlayPoints);
    hint = { text, full, error };
  } else if (siteMode && tool === 'select') {
    hint = { text: SITE_SELECT_HINT[0], full: SITE_SELECT_HINT[1], error };
  } else if (tool === 'select' && oneOpening) {
    hint = { text: OPENING_CYCLE_HINT, full: `${OPENING_CYCLE_HINT}: a second click on the selected opening selects the wall it is in; dragging it slides it along the wall.`, error };
  } else {
    const phase = drawing ? 'busy' : 'idle';
    hint = { text: HINTS[tool][phase], full: FULL_HINTS[tool][phase], error };
  }

  return (
    <footer className="statusbar">
      <CursorCoords denom={denom} />
      <SnapKindLabel />
      <PreviewLength denom={denom} />
      <DragReadout />
      <MeasureLive denom={denom} />
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
      <span className={`status-phase phase-${drawPhase}`} title="Phase for new walls, openings, roofs and columns">
        Drawing: {PHASE_LABEL[drawPhase].toLowerCase()}
      </span>
      <span className="status-counts">
        {siteMode ? (
          <>
            Site: {gradeCount} {gradeCount === 1 ? 'grade point' : 'grade points'}, {columnCount} {columnCount === 1 ? 'column' : 'columns'}
          </>
        ) : (
          <>
            {levelName}: {wallCount} {wallCount === 1 ? 'wall' : 'walls'}, {openingCount} {openingCount === 1 ? 'opening' : 'openings'}
            {roofCount > 0 && (
              <>
                , {roofCount} {roofCount === 1 ? 'roof' : 'roofs'}
              </>
            )}
            {fixtureCount > 0 && (
              <>
                , {fixtureCount} {fixtureCount === 1 ? 'fixture' : 'fixtures'}
              </>
            )}
          </>
        )}
      </span>
    </footer>
  );
}
