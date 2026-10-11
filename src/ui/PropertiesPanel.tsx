import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { getLevelElevations } from '../derive/levels';
import { coreInterval, jambDistances, liveFootprints } from '../derive/openings';
import { PHASE_LABEL } from '../derive/phase';
import { getFaces, roomDimensions, type Face } from '../derive/rooms';
import { floorToFloor, stairSteps } from '../derive/stairs';
import { activateUnderlayTool } from '../editor2d/tools';
import { confirmRemoveUnderlay, requestUnderlayImage } from '../editor2d/tools/underlayTool';
import { formatPxScale, rotateAbout, scaleAbout, underlayCenter } from '../model/underlay';
import { pointInPolygon } from '../model/geometry';
import { OPENING_DEFAULTS, OPENING_LABEL, type OpeningType } from '../model/openings';
import { wallLength } from '../model/plan';
import type { Id, Level, Opening, Phase, Room, Stairs, Wall, WallKind } from '../model/types';
import { formatArea, formatLength, parseLength } from '../model/units';
import { pauseHistory, resumeHistory, usePlanStore, type LengthAnchor } from '../store/planStore';
import { EMPTY_SELECTION, selectionSize, useUiStore, type Selection } from '../store/uiStore';
import { releaseFocus } from './focus';

const PHASES: Phase[] = ['existing', 'demo', 'new'];
const EPS = 1e-9;

type Bound = 'positive' | 'nonnegative' | 'any';

function checkBound(v: number, bound: Bound): string | null {
  if (bound === 'positive' && !(v > 0)) return 'Must be greater than 0.';
  if (bound === 'nonnegative' && v < 0) return 'Must not be negative.';
  return null;
}

interface LengthFieldProps {
  label: string;
  /** undefined shows the field blank (mixed values, or "use the default"). */
  value: number | undefined;
  onCommit: (v: number | null) => string | null | void;
  bound?: Bound;
  /** Blank commits null (e.g. clear a height override); otherwise blank reverts. */
  allowEmpty?: boolean;
  placeholder?: string;
  hint?: ReactNode;
}

/**
 * A feet-inch input: parses with the units parser on Enter or blur, shows parse and range errors
 * inline and leaves the plan untouched on error. Escape reverts.
 */
function LengthField({ label, value, onCommit, bound = 'positive', allowEmpty, placeholder, hint }: LengthFieldProps) {
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const fmt = (v: number | undefined) => (v === undefined ? '' : formatLength(v, denom));
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  // Set when Enter or Escape already handled the field, so the blur that follows does not commit.
  const skipBlur = useRef(false);

  useEffect(() => {
    if (!focused) setText(value === undefined ? '' : formatLength(value, denom));
  }, [value, denom, focused]);

  /** Returns true when the field holds a committed (or unchanged) value. */
  const commit = (): boolean => {
    const t = text.trim();
    if (t === '') {
      if (allowEmpty && value !== undefined) {
        const err = onCommit(null);
        setError(err || null);
        return !err;
      }
      setText(fmt(value));
      setError(null);
      return true;
    }
    let v: number;
    try {
      v = parseLength(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
    const rangeErr = checkBound(v, bound);
    if (rangeErr) {
      setError(rangeErr);
      return false;
    }
    if (value !== undefined && Math.abs(v - value) < EPS) {
      setText(fmt(value));
      setError(null);
      return true;
    }
    const err = onCommit(v);
    if (err) {
      setError(err);
      return false;
    }
    setError(null);
    setText(fmt(v));
    return true;
  };

  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="length-input"
        aria-label={label}
        aria-invalid={!!error}
        value={text}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          if (!skipBlur.current) commit();
          skipBlur.current = false;
          setFocused(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // A good value hands the keyboard back to the plan (Ctrl+Z then undoes the edit);
            // a bad one keeps the field focused with its error.
            if (commit()) {
              skipBlur.current = true;
              releaseFocus(e.currentTarget);
            }
          } else if (e.key === 'Escape') {
            setText(fmt(value));
            setError(null);
            skipBlur.current = true;
            releaseFocus(e.currentTarget);
          }
        }}
      />
      {error && <div className="field-error" role="alert">{error}</div>}
      {!error && hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  /** null = mixed */
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => {
          onChange(e.target.value as T);
          releaseFocus(e.currentTarget);
        }}
      >
        {value === null && (
          <option value="" disabled>
            mixed
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ReadOnly({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field readonly">
      <span className="label">{label}</span>
      <span className="value">{children}</span>
    </div>
  );
}

const phaseOptions = PHASES.map((p) => ({ value: p, label: PHASE_LABEL[p] }));
const kindOptions: { value: WallKind; label: string }[] = [
  { value: 'exterior', label: 'Exterior' },
  { value: 'interior', label: 'Interior' },
];

/** Shared value of a field across items, or null when they differ. */
function common<T, V>(items: T[], get: (t: T) => V): V | null {
  if (items.length === 0) return null;
  const first = get(items[0]);
  return items.every((t) => get(t) === first) ? first : null;
}

// ---------------------------------------------------------------------------------------------

function SelectionActions({ levelId, walls, openings, stairs }: { levelId: Id; walls: Wall[]; openings: Opening[]; stairs: Stairs[] }) {
  const setPhase = usePlanStore((s) => s.setPhase);
  const deleteEntities = usePlanStore((s) => s.deleteEntities);
  const selection = useUiStore((s) => s.selection);
  const items = [...walls, ...openings, ...stairs];
  if (items.length === 0 && selectionSize(selection) === 0) return null;
  const allDemo = items.length > 0 && items.every((i) => i.phase === 'demo');
  const ids = { walls: walls.map((w) => w.id), openings: openings.map((o) => o.id), stairs: stairs.map((st) => st.id) };
  return (
    <div className="panel-actions">
      {items.length > 0 && (
        <button
          className={allDemo ? '' : 'danger'}
          title={allDemo ? 'Mark the selection as existing again' : 'Mark the selection for demolition'}
          onClick={() => setPhase(levelId, ids, allDemo ? 'existing' : 'demo')}
        >
          {allDemo ? 'Keep (existing)' : 'Mark demolish'}
        </button>
      )}
      <button
        onClick={() => {
          deleteEntities(levelId, selection);
          useUiStore.getState().setSelection(EMPTY_SELECTION);
        }}
        title="Delete (Del)"
      >
        Delete
      </button>
    </div>
  );
}

function WallProps({ level, wall }: { level: Level; wall: Wall }) {
  const levelId = level.id;
  const [anchor, setAnchor] = useState<LengthAnchor>('start');
  const { setWallLength, updateWalls, setWallKind } = usePlanStore.getState();
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const len = wallLength(level, wall);
  const openingCount = Object.values(level.openings).filter((o) => o.wallId === wall.id).length;
  return (
    <>
      <h3>Wall</h3>
      <LengthField
        label="Length"
        value={len}
        onCommit={(v) => (v !== null && setWallLength(levelId, wall.id, v, anchor) ? null : 'That length does not work here.')}
        hint="Centerline length."
      />
      <fieldset className="radio-row">
        <legend>Anchor</legend>
        {(['start', 'end'] as const).map((a) => (
          <label key={a}>
            <input type="radio" name={`anchor-${wall.id}`} checked={anchor === a} onChange={() => setAnchor(a)} />
            {a}
          </label>
        ))}
        <span className="field-hint">{anchor === 'start' ? 'end corner moves' : 'start corner moves'}</span>
      </fieldset>
      <LengthField
        label="Thickness"
        value={wall.thickness}
        onCommit={(v) => {
          if (v !== null) updateWalls(levelId, [wall.id], { thickness: v });
        }}
      />
      <SelectField label="Kind" value={wall.kind} options={kindOptions} onChange={(k) => setWallKind(levelId, [wall.id], k)} />
      <SelectField label="Phase" value={wall.phase} options={phaseOptions} onChange={(p) => updateWalls(levelId, [wall.id], { phase: p })} />
      <LengthField
        label="Height"
        value={wall.heightOverride}
        allowEmpty
        placeholder={`level default (${formatLength(level.wallHeight, denom)})`}
        onCommit={(v) => {
          updateWalls(levelId, [wall.id], { heightOverride: v ?? undefined });
        }}
        hint="Blank uses the level's wall height."
      />
      <ReadOnly label="Openings">{openingCount}</ReadOnly>
    </>
  );
}

function MultiWallProps({ levelId, walls }: { levelId: Id; walls: Wall[] }) {
  const { updateWalls, setWallKind } = usePlanStore.getState();
  const ids = walls.map((w) => w.id);
  const thickness = common(walls, (w) => w.thickness);
  return (
    <>
      <h3>{walls.length} walls</h3>
      <SelectField label="Phase" value={common(walls, (w) => w.phase)} options={phaseOptions} onChange={(p) => updateWalls(levelId, ids, { phase: p })} />
      <SelectField label="Kind" value={common(walls, (w) => w.kind)} options={kindOptions} onChange={(k) => setWallKind(levelId, ids, k)} />
      <LengthField
        label="Thickness"
        value={thickness ?? undefined}
        placeholder="mixed"
        onCommit={(v) => {
          if (v !== null) updateWalls(levelId, ids, { thickness: v });
        }}
      />
    </>
  );
}

function OpeningProps({ level, opening }: { level: Level; opening: Opening }) {
  const levelId = level.id;
  const updateOpening = usePlanStore((s) => s.updateOpening);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const wall = level.walls[opening.wallId];
  const L = wall ? wallLength(level, wall) : 0;
  // Jamb distances run from the core interval ends (the inside faces of the corners), as a tape
  // measure along the wall would; the interval is the one the store clamps to.
  const interval = coreInterval(level, opening.wallId, opening.phase, liveFootprints(level)) ?? [0, L];
  const [s0, s1] = interval;
  const clear = Math.max(0, s1 - s0);
  const { fromA, fromB } = jambDistances(opening.offset, opening.width, interval);
  const maxJamb = Math.max(0, clear - opening.width);
  const setJamb = (end: 'a' | 'b', v: number | null): string | null => {
    if (v === null) return null;
    if (v > maxJamb + EPS) return `At most ${formatLength(maxJamb, denom)} here (${formatLength(clear, denom)} between corners).`;
    const offset = end === 'a' ? s0 + v + opening.width / 2 : s1 - v - opening.width / 2;
    updateOpening(levelId, opening.id, { offset });
    return null;
  };
  const changeType = (type: OpeningType) => {
    if (type === opening.type) return;
    const def = OPENING_DEFAULTS[type];
    updateOpening(levelId, opening.id, {
      type,
      height: def.height,
      sill: def.sill,
      swing: type === 'door' ? (opening.swing ?? { hinge: 'a', side: 'left' }) : undefined,
    });
  };
  return (
    <>
      <h3>{OPENING_LABEL[opening.type]}</h3>
      <SelectField
        label="Type"
        value={opening.type}
        options={(['door', 'window', 'passage'] as const).map((t) => ({ value: t, label: OPENING_LABEL[t] }))}
        onChange={changeType}
      />
      <LengthField
        label="Width"
        value={opening.width}
        onCommit={(v) => {
          if (v === null) return null;
          if (v > clear + EPS) return `Wider than the wall between its corners (${formatLength(clear, denom)}).`;
          updateOpening(levelId, opening.id, { width: v });
          return null;
        }}
      />
      <LengthField
        label="Height"
        value={opening.height}
        onCommit={(v) => {
          if (v !== null) updateOpening(levelId, opening.id, { height: v });
        }}
      />
      {opening.type === 'window' && (
        <LengthField
          label="Sill"
          value={opening.sill}
          bound="nonnegative"
          onCommit={(v) => {
            if (v !== null) updateOpening(levelId, opening.id, { sill: v });
          }}
          hint="Above the floor."
        />
      )}
      <LengthField
        label="From start"
        value={fromA}
        bound="nonnegative"
        onCommit={(v) => setJamb('a', v)}
        hint="Inside face of the start corner to the near jamb."
      />
      <LengthField
        label="From end"
        value={fromB}
        bound="nonnegative"
        onCommit={(v) => setJamb('b', v)}
        hint="Inside face of the end corner to the near jamb."
      />
      <SelectField
        label="Phase"
        value={opening.phase}
        options={phaseOptions}
        onChange={(p) => updateOpening(levelId, opening.id, { phase: p })}
      />
      {opening.type === 'door' && (
        <>
          <SelectField
            label="Hinge"
            value={opening.swing?.hinge ?? 'a'}
            options={[
              { value: 'a', label: 'Start side' },
              { value: 'b', label: 'End side' },
            ]}
            onChange={(hinge) => updateOpening(levelId, opening.id, { swing: { side: opening.swing?.side ?? 'left', hinge } })}
          />
          <SelectField
            label="Swings to"
            value={opening.swing?.side ?? 'left'}
            options={[
              { value: 'left', label: 'Left of wall' },
              { value: 'right', label: 'Right of wall' },
            ]}
            onChange={(side) => updateOpening(levelId, opening.id, { swing: { hinge: opening.swing?.hinge ?? 'a', side } })}
          />
        </>
      )}
      <ReadOnly label="Wall length">{formatLength(L, denom)}</ReadOnly>
    </>
  );
}

/**
 * The room's sides measured face to face (the net outline), so typed lengths can be checked against
 * the tape: width x depth for a rectangle, and every side clockwise from the top-left corner.
 */
function RoomDimensionsReadout({ face }: { face: Face }) {
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const dims = roomDimensions(face.netPolygon);
  if (dims.edges.length === 0) return null;
  const centerline = face.netPolygon === face.polygon;
  return (
    <div className="room-dims">
      {dims.rect && (
        <ReadOnly label="Net size">
          <span className="room-dims-rect">
            <span className="nowrap">{formatLength(dims.rect.width, denom)}</span> x{' '}
            <span className="nowrap">{formatLength(dims.rect.depth, denom)}</span>
          </span>
        </ReadOnly>
      )}
      <div className="field readonly">
        <span className="label">Sides</span>
        <ol className="room-dims-edges" aria-label="Room sides, face to face">
          {dims.edges.map((len, i) => (
            <li key={i}>{formatLength(len, denom)}</li>
          ))}
        </ol>
      </div>
      <p className="panel-note">
        {centerline
          ? 'Measured to the wall centerlines (the wall faces could not be traced here).'
          : 'Face to face, clockwise from the top-left corner: check these against your tape.'}
      </p>
    </div>
  );
}

function RoomProps({ level, room }: { level: Level; room: Room }) {
  const updateRoom = usePlanStore((s) => s.updateRoom);
  const viewMode = useUiStore((s) => s.viewMode);
  const set = usePlanStore((s) => {
    const l = s.plan.levels[level.id];
    return l ? getFaces(l, viewMode) : null;
  });
  const face = set?.faces.find((f) => f.roomId === room.id) ?? null;
  // An orphan whose anchor is in a face that an earlier room already names.
  const sharing = !face && set ? set.faces.find((f) => f.roomId && f.roomId !== room.id && pointInPolygon(room.anchor, f.polygon)) : null;
  const [name, setName] = useState(room.name);
  const skipBlur = useRef(false);
  useEffect(() => setName(room.name), [room.name]);
  const commitName = () => {
    const v = name.trim();
    if (v && v !== room.name) updateRoom(level.id, room.id, { name: v });
    else setName(room.name);
  };
  return (
    <>
      <h3>Room</h3>
      <div className="field">
        <label htmlFor="room-name-input">Name</label>
        <input
          id="room-name-input"
          aria-label="Room name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (!skipBlur.current) commitName();
            skipBlur.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitName();
              skipBlur.current = true;
              releaseFocus(e.currentTarget);
            }
            if (e.key === 'Escape') {
              setName(room.name);
              skipBlur.current = true;
              releaseFocus(e.currentTarget);
            }
          }}
        />
      </div>
      {face ? (
        <>
          <ReadOnly label="Net area">{formatArea(face.netArea)}</ReadOnly>
          <ReadOnly label="Gross area">{formatArea(face.grossArea)}</ReadOnly>
          <RoomDimensionsReadout face={face} />
          <p className="panel-note">Net is inside the wall faces; gross is to the wall centerlines.</p>
        </>
      ) : (
        <p className="panel-note warning">
          {sharing
            ? `Shares an area with "${level.rooms[sharing.roomId!]?.name}" in this view. Drag the label into its own room.`
            : 'Not inside an area closed in by walls in this view. Drag the label into a room, or close the walls around it.'}
        </p>
      )}
    </>
  );
}

const DIRECTION_OPTIONS: { value: string; label: string }[] = [
  { value: '0', label: 'Right (+x)' },
  { value: '90', label: 'Down (+y)' },
  { value: '180', label: 'Left (-x)' },
  { value: '270', label: 'Up (-y)' },
];

function StairsProps({ level, stairs }: { level: Level; stairs: Stairs }) {
  const updateStairs = usePlanStore((s) => s.updateStairs);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const ftf = usePlanStore((s) => floorToFloor(s.plan, level.id));
  const aboveName = usePlanStore((s) => {
    const i = s.plan.levelOrder.indexOf(level.id);
    return s.plan.levels[s.plan.levelOrder[i + 1]]?.name ?? null;
  });
  const { risers, rise } = stairSteps(ftf);
  const tread = stairs.run / risers;
  const dir = String(stairs.direction);
  const options = DIRECTION_OPTIONS.some((o) => o.value === dir)
    ? DIRECTION_OPTIONS
    : [...DIRECTION_OPTIONS, { value: dir, label: `${dir}°` }];
  return (
    <>
      <h3>Stairs</h3>
      <LengthField
        label="Width"
        value={stairs.width}
        onCommit={(v) => {
          if (v !== null) updateStairs(level.id, stairs.id, { width: v });
        }}
      />
      <LengthField
        label="Run"
        value={stairs.run}
        onCommit={(v) => {
          if (v !== null) updateStairs(level.id, stairs.id, { run: v });
        }}
        hint="Horizontal length of the flight."
      />
      <SelectField
        label="Goes up toward"
        value={dir}
        options={options}
        onChange={(v) => updateStairs(level.id, stairs.id, { direction: Number(v) })}
      />
      <SelectField
        label="Phase"
        value={stairs.phase}
        options={phaseOptions}
        onChange={(p) => updateStairs(level.id, stairs.id, { phase: p })}
      />
      <label className="check-row">
        <input
          type="checkbox"
          aria-label="Cuts the floor above"
          checked={stairs.cutsFloorAbove}
          onChange={(e) => updateStairs(level.id, stairs.id, { cutsFloorAbove: e.target.checked })}
        />
        Cuts the floor above{aboveName ? ` (${aboveName})` : ''}
      </label>
      <ReadOnly label="Risers">
        {risers} x {formatLength(rise, denom)}
      </ReadOnly>
      <ReadOnly label="Step depth">{formatLength(tread, denom)}</ReadOnly>
      <p className="panel-note">
        Rises {formatLength(ftf, denom)}, floor top to floor top. Drag with the select tool to move.
      </p>
    </>
  );
}

function MixedProps({
  levelId,
  sel,
  walls,
  openings,
  stairs,
}: {
  levelId: Id;
  sel: Selection;
  walls: Wall[];
  openings: Opening[];
  stairs: Stairs[];
}) {
  const setPhase = usePlanStore((s) => s.setPhase);
  const parts: string[] = [];
  if (walls.length) parts.push(`${walls.length} ${walls.length === 1 ? 'wall' : 'walls'}`);
  if (openings.length) parts.push(`${openings.length} ${openings.length === 1 ? 'opening' : 'openings'}`);
  if (stairs.length) parts.push(`${stairs.length} stairs`);
  if (sel.nodes.length) parts.push(`${sel.nodes.length} ${sel.nodes.length === 1 ? 'corner' : 'corners'}`);
  if (sel.rooms.length) parts.push(`${sel.rooms.length} ${sel.rooms.length === 1 ? 'room' : 'rooms'}`);
  const items = [...walls, ...openings, ...stairs];
  return (
    <>
      <h3>{parts.join(', ')}</h3>
      {items.length > 0 && (
        <SelectField
          label="Phase"
          value={common(items, (i) => i.phase)}
          options={phaseOptions}
          onChange={(p) =>
            setPhase(levelId, { walls: walls.map((w) => w.id), openings: openings.map((o) => o.id), stairs: stairs.map((st) => st.id) }, p)
          }
        />
      )}
      {items.length === 0 && <p className="panel-note">Drag corners with the select tool to move them.</p>}
    </>
  );
}

/** A number input in degrees: commits on Enter or blur, Escape reverts. */
function DegreesField({ label, value, onCommit, disabled }: { label: string; value: number; onCommit: (v: number) => void; disabled?: boolean }) {
  const fmt = (v: number) => String(Math.round(v * 100) / 100);
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  useEffect(() => {
    if (!focused) setText(fmt(value));
  }, [value, focused]);
  const skipBlur = useRef(false);
  const commit = (): boolean => {
    const v = Number(text.trim().replace(/°$/, ''));
    if (text.trim() === '' || !Number.isFinite(v)) {
      setError('Enter an angle in degrees.');
      return false;
    }
    setError(null);
    if (Math.abs(v - value) > 1e-9) onCommit(v);
    return true;
  };
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-label={label}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          if (!skipBlur.current) commit();
          skipBlur.current = false;
          setFocused(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (commit()) {
              skipBlur.current = true;
              releaseFocus(e.currentTarget);
            }
          } else if (e.key === 'Escape') {
            setText(fmt(value));
            setError(null);
            skipBlur.current = true;
            releaseFocus(e.currentTarget);
          }
        }}
      />
      {error && <div className="field-error" role="alert">{error}</div>}
      {!error && <div className="field-hint">Clockwise, about the image centre.</div>}
    </div>
  );
}

/**
 * Opacity slider. A drag (or a run of arrow keys) is one undo step: the first change is tracked,
 * the rest are folded into it until the pointer or key is released.
 */
function OpacitySlider({ levelId, value }: { levelId: Id; value: number }) {
  const updateUnderlay = usePlanStore((s) => s.updateUnderlay);
  const grouping = useRef(false);
  const end = () => {
    if (!grouping.current) return;
    grouping.current = false;
    resumeHistory();
  };
  useEffect(() => end, []);
  return (
    <div className="field">
      <label htmlFor="underlay-opacity">Opacity</label>
      <div className="slider-row">
        <input
          id="underlay-opacity"
          type="range"
          aria-label="Opacity"
          min={0.1}
          max={1}
          step={0.05}
          value={value}
          onChange={(e) => {
            updateUnderlay(levelId, { opacity: Number(e.target.value) });
            if (!grouping.current) {
              grouping.current = true;
              pauseHistory();
            }
          }}
          onPointerUp={end}
          onKeyUp={end}
          onBlur={end}
        />
        <span className="slider-value">{Math.round(value * 100)}%</span>
      </div>
    </div>
  );
}

function UnderlayProps({ level }: { level: Level }) {
  const u = level.underlay;
  const updateUnderlay = usePlanStore((s) => s.updateUnderlay);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const tool = useUiStore((s) => s.activeTool);
  const mode = useUiStore((s) => s.underlayMode);
  if (!u) {
    return (
      <>
        <h3>Underlay</h3>
        <p className="panel-note">
          No image under {level.name}. Load a photo or scan of a floor plan or sketch (JPEG, PNG or WebP), scale it by
          two points of known distance, then trace the walls over it.
        </p>
        <div className="panel-buttons">
          <button className="primary" onClick={() => requestUnderlayImage(level.id)}>
            Load image...
          </button>
        </div>
        <p className="panel-note">PDF? Export the page as an image first.</p>
      </>
    );
  }
  const center = underlayCenter(u);
  const width = u.pixelWidth * u.scale;
  const active = (m: string) => tool === 'underlay' && mode === m;
  return (
    <>
      <h3>Underlay</h3>
      <div className="panel-buttons calibrate-buttons">
        <button
          className={active('scale') ? 'active' : ''}
          aria-pressed={active('scale')}
          disabled={u.locked}
          title="Click two points on the image, then type the real distance between them"
          onClick={() => activateUnderlayTool(active('scale') ? 'move' : 'scale')}
        >
          Scale by two points
        </button>
        <button
          className={active('rotate') ? 'active' : ''}
          aria-pressed={active('rotate')}
          disabled={u.locked}
          title="Click two points that should line up horizontally (or vertically)"
          onClick={() => activateUnderlayTool(active('rotate') ? 'move' : 'rotate')}
        >
          Rotate by two points
        </button>
      </div>
      <ReadOnly label="Image">
        {u.pixelWidth} x {u.pixelHeight} px
      </ReadOnly>
      <ReadOnly label="Scale">{formatPxScale(u.scale)}</ReadOnly>
      {u.locked ? (
        <ReadOnly label="Image width">{formatLength(width, denom)}</ReadOnly>
      ) : (
        <LengthField
          label="Image width"
          value={width}
          onCommit={(v) => {
            if (v !== null) updateUnderlay(level.id, scaleAbout(u, v / u.pixelWidth, center));
          }}
          hint="Width the whole image spans on the plan."
        />
      )}
      <DegreesField
        label="Rotation"
        value={u.rotation}
        disabled={u.locked}
        onCommit={(v) => updateUnderlay(level.id, rotateAbout(u, v, center))}
      />
      <OpacitySlider levelId={level.id} value={u.opacity} />
      <label className="check-row">
        <input
          type="checkbox"
          aria-label="Locked"
          checked={u.locked}
          onChange={(e) => {
            updateUnderlay(level.id, { locked: e.target.checked });
            if (e.target.checked && useUiStore.getState().underlayMode !== 'move') useUiStore.getState().setUnderlayMode('move');
          }}
        />
        Locked (can't be moved or picked)
      </label>
      <div className="panel-actions">
        <button onClick={() => requestUnderlayImage(level.id, true)}>Replace image...</button>
        <button className="danger" onClick={() => confirmRemoveUnderlay(level.id)}>
          Remove
        </button>
      </div>
      <p className="panel-note">
        {u.locked
          ? 'Locked: trace walls over it with the wall tool (W). Unlock to move or recalibrate it.'
          : 'Drag the image to move it; arrow keys nudge 1" (Shift: 1\'). Lock it before tracing.'}
      </p>
    </>
  );
}

function UnderlayRow({ level }: { level: Level }) {
  const u = level.underlay;
  return (
    <div className="field readonly underlay-row">
      <span className="label">Underlay</span>
      <span className="value">
        {u ? `loaded (${u.locked ? 'locked' : 'unlocked'})` : 'none'}
        <button
          className="inline-button"
          onClick={() => (u ? useUiStore.getState().selectUnderlay(true) : requestUnderlayImage(level.id))}
        >
          {u ? 'Select' : 'Load image...'}
        </button>
      </span>
    </div>
  );
}

function LevelProps({ level }: { level: Level }) {
  const { updateLevel, setBaseFloorElevation, updateSettings } = usePlanStore.getState();
  const extThickness = usePlanStore((s) => s.plan.settings.defaultExteriorThickness);
  const intThickness = usePlanStore((s) => s.plan.settings.defaultInteriorThickness);
  const base = usePlanStore((s) => s.plan.baseFloorElevation);
  // Select primitives: an object built in a selector would never compare equal.
  const floorTop = usePlanStore((s) => getLevelElevations(s.plan)[level.id]?.floorTop);
  const ceiling = usePlanStore((s) => getLevelElevations(s.plan)[level.id]?.ceiling);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const viewMode = useUiStore((s) => s.viewMode);
  const faces = usePlanStore((s) => {
    const l = s.plan.levels[level.id];
    return l ? getFaces(l, viewMode) : null;
  });
  const roomCount = Object.keys(level.rooms).length;
  const unlabeled = faces ? faces.faces.filter((f) => !f.roomId).length : 0;
  const [name, setName] = useState(level.name);
  const skipBlur = useRef(false);
  useEffect(() => setName(level.name), [level.name]);
  const commitName = () => {
    const v = name.trim();
    if (v && v !== level.name) updateLevel(level.id, { name: v });
    else setName(level.name);
  };
  return (
    <>
      <h3>Level</h3>
      <div className="field">
        <label htmlFor="level-name-input">Name</label>
        <input
          id="level-name-input"
          aria-label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (!skipBlur.current) commitName();
            skipBlur.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitName();
              skipBlur.current = true;
              releaseFocus(e.currentTarget);
            } else if (e.key === 'Escape') {
              setName(level.name);
              skipBlur.current = true;
              releaseFocus(e.currentTarget);
            }
          }}
        />
      </div>
      <LengthField label="Wall height" value={level.wallHeight} onCommit={(v) => void (v !== null && updateLevel(level.id, { wallHeight: v }))} hint="Floor top to the underside of the floor above." />
      <LengthField
        label="Floor thickness"
        value={level.floorThickness}
        bound="nonnegative"
        onCommit={(v) => void (v !== null && updateLevel(level.id, { floorThickness: v }))}
        hint="Slab or framing under this level."
      />
      <LengthField
        label="Base floor elevation"
        value={base}
        bound="any"
        onCommit={(v) => void (v !== null && setBaseFloorElevation(v))}
        hint="Floor top of the lowest level (plan setting)."
      />
      <LengthField
        label="New exterior walls"
        value={extThickness}
        onCommit={(v) => void (v !== null && updateSettings({ defaultExteriorThickness: v }))}
        hint="For exterior walls drawn from now on."
      />
      <LengthField
        label="New interior walls"
        value={intThickness}
        onCommit={(v) => void (v !== null && updateSettings({ defaultInteriorThickness: v }))}
        hint="For interior walls (X). To change drawn walls, select them."
      />
      {floorTop !== undefined && ceiling !== undefined && (
        <>
          <ReadOnly label="Floor top">{formatLength(floorTop, denom)}</ReadOnly>
          <ReadOnly label="Ceiling">{formatLength(ceiling, denom)}</ReadOnly>
        </>
      )}
      <UnderlayRow level={level} />
      <ReadOnly label="Rooms">{roomCount}</ReadOnly>
      <ReadOnly label="Unlabeled areas">{unlabeled}</ReadOnly>
      {faces && faces.openEnds.length > 0 && (
        <p className="panel-note warning">
          {faces.openEnds.length} open wall {faces.openEnds.length === 1 ? 'end' : 'ends'} (red dots): areas are
          only found where walls close a loop.
        </p>
      )}
      <p className="panel-note">Select walls, openings or room labels to edit them. R names a room.</p>
    </>
  );
}

export function PropertiesPanel() {
  const levelId = useUiStore((s) => s.activeLevelId);
  const sel = useUiStore((s) => s.selection);
  const underlaySelected = useUiStore((s) => s.underlaySelected);
  const underlayTool = useUiStore((s) => s.activeTool === 'underlay');
  const level = usePlanStore((s) => s.plan.levels[levelId]);
  if (!level) return <aside className="side-panel" />;
  const walls = sel.walls.map((id) => level.walls[id]).filter(Boolean);
  const openings = sel.openings.map((id) => level.openings[id]).filter(Boolean);
  const nodes = sel.nodes.filter((id) => level.nodes[id]);
  const rooms = sel.rooms.map((id) => level.rooms[id]).filter(Boolean);
  const stairs = sel.stairs.map((id) => level.stairs[id]).filter(Boolean);
  const live: Selection = {
    nodes,
    walls: walls.map((w) => w.id),
    openings: openings.map((o) => o.id),
    rooms: rooms.map((r) => r.id),
    stairs: stairs.map((st) => st.id),
  };
  const total = selectionSize(live);

  let body: ReactNode;
  if (total === 0 && (underlayTool || (underlaySelected && level.underlay))) body = <UnderlayProps key={level.id} level={level} />;
  else if (total === 0) body = <LevelProps key={level.id} level={level} />;
  else if (total === 1 && walls.length === 1) body = <WallProps key={walls[0].id} level={level} wall={walls[0]} />;
  else if (total === 1 && openings.length === 1)
    body = <OpeningProps key={openings[0].id} level={level} opening={openings[0]} />;
  else if (total === 1 && rooms.length === 1) body = <RoomProps key={rooms[0].id} level={level} room={rooms[0]} />;
  else if (total === 1 && stairs.length === 1) body = <StairsProps key={stairs[0].id} level={level} stairs={stairs[0]} />;
  else if (total === walls.length) body = <MultiWallProps levelId={level.id} walls={walls} />;
  else body = <MixedProps levelId={level.id} sel={live} walls={walls} openings={openings} stairs={stairs} />;

  return (
    <aside className="side-panel" aria-label="Properties">
      <div className="panel-title">Properties</div>
      <div className="panel-body">
        {body}
        {total > 0 && <SelectionActions levelId={level.id} walls={walls} openings={openings} stairs={stairs} />}
      </div>
    </aside>
  );
}
