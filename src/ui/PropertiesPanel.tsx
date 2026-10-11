import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { getFootprints } from '../derive/footprint';
import { getLevelElevations } from '../derive/levels';
import { coreInterval, jambDistances, liveFootprints } from '../derive/openings';
import { PHASE_LABEL } from '../derive/phase';
import { facesBesideWall, getFaces, roomDimensions, slabOutlines, type Face, type FaceSet } from '../derive/rooms';
import { roofBearing, roofExtremes, ROOF_SHAPE_LABEL } from '../derive/roofs';
import { columnDefaults, groundAt } from '../derive/site';
import { floorToFloor, headroomHoleStart, STAIRS_HEADROOM, STAIRS_LIMITS, stairsHoleOutline, stairsHoleStart, stairsRunOk, stairsWidthOk, stairSteps } from '../derive/stairs';
import { activateUnderlayTool } from '../editor2d/tools';
import { confirmRemoveUnderlay, requestUnderlayImage } from '../editor2d/tools/underlayTool';
import { formatPxScale, rotateAbout, scaleAbout, underlayCenter } from '../model/underlay';
import { pointInPolygon } from '../model/geometry';
import { OPENING_DEFAULTS, OPENING_LABEL, openingFitsHeight, wallHeightOf, type OpeningType } from '../model/openings';
import { columnProblem, MAX_ROOF_PITCH, wallLength } from '../model/plan';
import { boundsOf } from '../model/geometry';
import { DEFAULT_TRIM, defaultWallColor, defaultWallFinish, litesOf, MAX_LITES, normalizeHex, ROOF_COLOR, roofColorOf, trimOf, WALL_FINISHES, WALL_FINISH_LABEL, wallColorOf, wallFinishOf } from '../model/finish';
import type { Column, GradePoint, Id, Level, Opening, Phase, Roof, RoofFinish, RoofShape, Room, Site, Stairs, Wall, WallFinish, WallKind } from '../model/types';
import { formatArea, formatLength, parseLength } from '../model/units';
import { pauseHistory, resumeHistory, usePlanStore, type LengthAnchor } from '../store/planStore';
import { EMPTY_SELECTION, selectionSize, useUiStore, type Selection } from '../store/uiStore';
import { noteDuplicateRoomName } from './fileActions';
import { roomNameOf, runWallMove, wallSideNames } from './wallMove';
import type { WallSide } from '../model/offset';
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
  // A rejected value's message belongs to the field while it is focused and holds that text; a new
  // bound value (an edit elsewhere, undo) makes it stale.
  useEffect(() => setError(null), [value]);

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
          // A value that does not commit is dropped on the way out, with its message.
          if (!skipBlur.current && !commit()) {
            setText(fmt(value));
            setError(null);
          }
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

const finishOptions = WALL_FINISHES.map((f) => ({ value: f, label: WALL_FINISH_LABEL[f] }));

/**
 * A colour: the browser's picker plus a hex field. The picker previews while it is open and commits
 * once when it closes (the native change event), so a drag through the spectrum is one undo step;
 * the hex field commits on Enter or blur and shows an error for a bad value. `onReset` adds a
 * "Default" button that clears the colour back to its default.
 */
function ColorField({ label, value, onCommit, onReset, hint }: { label: string; value: string; onCommit: (hex: string) => void; onReset?: () => void; hint?: ReactNode }) {
  const id = useId();
  const [text, setText] = useState(value);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const skipBlur = useRef(false);
  const latest = useRef(onCommit);
  latest.current = onCommit;
  useEffect(() => {
    setText(value);
    setPreview(null);
    setError(null);
  }, [value]);
  useEffect(() => {
    const el = picker.current;
    if (!el) return;
    const done = () => {
      const hex = normalizeHex(el.value);
      setPreview(null);
      if (hex) latest.current(hex);
    };
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, []);
  const commitText = (): boolean => {
    const hex = normalizeHex(text);
    if (!hex) {
      setError('Use a hex colour such as #5a3a35.');
      return false;
    }
    setError(null);
    if (hex !== value) onCommit(hex);
    else setText(value);
    return true;
  };
  return (
    <div className={`field color-field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="color-row">
        <input ref={picker} type="color" aria-label={`${label} picker`} value={preview ?? value} onChange={(e) => setPreview(e.target.value)} />
        <input
          id={id}
          aria-label={label}
          aria-invalid={!!error}
          value={preview ?? text}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onBlur={() => {
            if (!skipBlur.current && !commitText()) {
              setText(value);
              setError(null);
            }
            skipBlur.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (commitText()) {
                skipBlur.current = true;
                releaseFocus(e.currentTarget);
              }
            } else if (e.key === 'Escape') {
              setText(value);
              setError(null);
              skipBlur.current = true;
              releaseFocus(e.currentTarget);
            }
          }}
        />
        {onReset && (
          <button type="button" className="color-reset" title="Back to the default colour" onClick={onReset}>
            Default
          </button>
        )}
      </div>
      {error && <div className="field-error" role="alert">{error}</div>}
      {!error && hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

/** Shared value of a field across items, or null when they differ. */
function common<T, V>(items: T[], get: (t: T) => V): V | null {
  if (items.length === 0) return null;
  const first = get(items[0]);
  return items.every((t) => get(t) === first) ? first : null;
}

// ---------------------------------------------------------------------------------------------

function SelectionActions({
  levelId,
  walls,
  openings,
  stairs,
  roofs,
  columns,
}: {
  levelId: Id;
  walls: Wall[];
  openings: Opening[];
  stairs: Stairs[];
  roofs: Roof[];
  columns: Column[];
}) {
  const setPhase = usePlanStore((s) => s.setPhase);
  const deleteEntities = usePlanStore((s) => s.deleteEntities);
  const selection = useUiStore((s) => s.selection);
  const items = [...walls, ...openings, ...stairs, ...roofs, ...columns];
  if (items.length === 0 && selectionSize(selection) === 0) return null;
  const allDemo = items.length > 0 && items.every((i) => i.phase === 'demo');
  const ids = {
    walls: walls.map((w) => w.id),
    openings: openings.map((o) => o.id),
    stairs: stairs.map((st) => st.id),
    roofs: roofs.map((r) => r.id),
    columns: columns.map((c) => c.id),
  };
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

/**
 * Move a wall across by a typed distance, toward the room on either side (docs/REVIEW-2.md B1).
 * Its neighbours slide so they stay attached and straight; collinear walls move with it. The status
 * bar then gives the new net sizes of the rooms either side.
 */
function MoveWall({ level, wall }: { level: Level; wall: Wall }) {
  const id = useId();
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const viewMode = useUiStore((s) => s.viewMode);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const names = wallSideNames(level, getFaces(level, viewMode), wall);
  const move = (side: WallSide) => {
    let v: number;
    try {
      v = parseLength(text);
    } catch (e) {
      setError(text.trim() ? (e instanceof Error ? e.message : String(e)) : 'Type how far to move it.');
      return;
    }
    if (!(v > 0)) {
      setError('Must be greater than 0.');
      return;
    }
    const what = `Moved the wall ${formatLength(v, denom)} toward ${names[side]}`;
    const problem = runWallMove(level.id, wall.id, () => usePlanStore.getState().offsetWalls(level.id, [wall.id], v, side), what);
    setError(problem);
  };
  return (
    <div className={`field move-wall${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>Move</label>
      <input
        id={id}
        className="length-input"
        aria-label="Move"
        aria-invalid={!!error}
        value={text}
        placeholder={`e.g. 6 or 1'-2"`}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setText('');
            setError(null);
            releaseFocus(e.currentTarget);
          }
        }}
      />
      <div className="panel-buttons move-buttons">
        {(['left', 'right'] as const).map((side) => (
          <button key={side} type="button" onClick={() => move(side)} title={`Move the wall across, toward ${names[side]}`}>
            toward {names[side]}
          </button>
        ))}
      </div>
      {error && <div className="field-error" role="alert">{error}</div>}
      {!error && <div className="field-hint">Neighbouring walls stretch to stay attached. Roofs do not follow.</div>}
    </div>
  );
}

/**
 * Left and right face lengths of a wall, from its footprint's trimmed edge points (what a tape
 * measure along each face reads), each with the room on that side when a face names one.
 */
function WallFaceLengths({ level, wall }: { level: Level; wall: Wall }) {
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const viewMode = useUiStore((s) => s.viewMode);
  const fp = getFootprints(level, viewMode).get(wall.id);
  if (!fp) return null;
  const set = getFaces(level, viewMode);
  const sides = facesBesideWall(set, wall);
  const [leftA, leftB, rightB, rightA] = fp.edge;
  const rows = [
    { label: 'Left face', len: Math.hypot(leftB.x - leftA.x, leftB.y - leftA.y), room: roomNameOf(level, sides.left) },
    { label: 'Right face', len: Math.hypot(rightB.x - rightA.x, rightB.y - rightA.y), room: roomNameOf(level, sides.right) },
  ];
  return (
    <>
      {rows.map((r) => (
        <ReadOnly key={r.label} label={r.label}>
          {formatLength(r.len, denom)}
          {r.room && <span className="face-room"> to {r.room}</span>}
        </ReadOnly>
      ))}
    </>
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
      <SelectField label="Finish" value={wallFinishOf(wall)} options={finishOptions} onChange={(finish) => updateWalls(levelId, [wall.id], { finish })} />
      <ColorField
        label="Colour"
        value={wallColorOf(wall)}
        onCommit={(color) => updateWalls(levelId, [wall.id], { color })}
        onReset={wall.color || wall.finish ? () => updateWalls(levelId, [wall.id], { color: undefined, finish: undefined }) : undefined}
        hint={wall.kind === 'exterior' ? 'Both faces of an exterior wall show the siding.' : undefined}
      />
      <WallFaceLengths level={level} wall={wall} />
      <MoveWall level={level} wall={wall} />
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
      <SelectField label="Finish" value={common(walls, wallFinishOf)} options={finishOptions} onChange={(finish) => updateWalls(levelId, ids, { finish })} />
      <ColorField label="Colour" value={common(walls, wallColorOf) ?? defaultWallColor('exterior')} onCommit={(color) => updateWalls(levelId, ids, { color })} />
    </>
  );
}

/** Names of the rooms with a corner at a node, in the order the faces come. */
function roomsAtNode(level: Level, set: FaceSet, nodeId: Id): string[] {
  const names: string[] = [];
  for (const f of set.faces) {
    const name = roomNameOf(level, f);
    if (name && f.nodeIds.includes(nodeId) && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Door swing in a homeowner's words: the room each side of the wall opens into, and the room whose
 * corner each hinge end is near. A side with no named room says "Outside" on an exterior wall;
 * otherwise (and for hinges when no room tells the two ends apart) the caller keeps the plain
 * wording.
 */
function swingWording(
  level: Level,
  wall: Wall,
  set: FaceSet,
): { side: { left: string | null; right: string | null }; hinge: { a: string | null; b: string | null } } {
  const sides = facesBesideWall(set, wall);
  const sideLabel = (face: Face | null): string | null => {
    const name = roomNameOf(level, face);
    if (name) return name;
    return !face && wall.kind === 'exterior' ? 'Outside' : null;
  };
  // A room is "near" an end when it has a corner there and not at the other end. Both ends need
  // one; where the same rooms touch both ends (a wall between two rooms that both run its length),
  // nothing tells the ends apart and the plain Start side / End side wording stays.
  const atA = roomsAtNode(level, set, wall.a);
  const atB = roomsAtNode(level, set, wall.b);
  const nearA = atA.find((n) => !atB.includes(n));
  const nearB = atB.find((n) => !atA.includes(n));
  const hingeA = nearA && nearB ? `near the ${nearA} corner` : null;
  const hingeB = nearA && nearB ? `near the ${nearB} corner` : null;
  return { side: { left: sideLabel(sides.left), right: sideLabel(sides.right) }, hinge: { a: hingeA, b: hingeB } };
}

function OpeningProps({ level, opening }: { level: Level; opening: Opening }) {
  const levelId = level.id;
  const updateOpening = usePlanStore((s) => s.updateOpening);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const wall = level.walls[opening.wallId];
  const L = wall ? wallLength(level, wall) : 0;
  const wallH = wall ? wallHeightOf(level, wall) : level.wallHeight;
  const tooTall = `Taller than the wall (${formatLength(wallH, denom)})`;
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
  const viewMode = useUiStore((s) => s.viewMode);
  const wording = wall ? swingWording(level, wall, getFaces(level, viewMode)) : null;
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
          if (v === null) return null;
          if (!openingFitsHeight({ sill: opening.sill, height: v }, wallH)) return tooTall;
          updateOpening(levelId, opening.id, { height: v });
          return null;
        }}
      />
      {opening.type === 'window' && (
        <LengthField
          label="Sill"
          value={opening.sill}
          bound="nonnegative"
          onCommit={(v) => {
            if (v === null) return null;
            if (!openingFitsHeight({ sill: v, height: opening.height }, wallH)) return tooTall;
            updateOpening(levelId, opening.id, { sill: v });
            return null;
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
              { value: 'a', label: wording?.hinge.a ?? 'Start side' },
              { value: 'b', label: wording?.hinge.b ?? 'End side' },
            ]}
            onChange={(hinge) => updateOpening(levelId, opening.id, { swing: { side: opening.swing?.side ?? 'left', hinge } })}
          />
          <SelectField
            label="Swings into"
            value={opening.swing?.side ?? 'left'}
            options={[
              { value: 'left', label: wording?.side.left ?? 'Left of wall' },
              { value: 'right', label: wording?.side.right ?? 'Right of wall' },
            ]}
            onChange={(side) => updateOpening(levelId, opening.id, { swing: { hinge: opening.swing?.hinge ?? 'a', side } })}
          />
        </>
      )}
      {opening.type !== 'passage' && (
        <>
          <NumberField
            label={opening.type === 'door' ? 'Glazed columns' : 'Lites across'}
            value={litesOf(opening).cols}
            check={liteCheck}
            onCommit={(cols) => updateOpening(levelId, opening.id, { lites: { cols, rows: litesOf(opening).rows } })}
            hint={opening.type === 'door' ? 'A door is a solid panel at 1 x 1; more lites glaze its panel.' : undefined}
          />
          <NumberField
            label={opening.type === 'door' ? 'Glazed rows' : 'Lites down'}
            value={litesOf(opening).rows}
            check={liteCheck}
            onCommit={(rows) => updateOpening(levelId, opening.id, { lites: { cols: litesOf(opening).cols, rows } })}
          />
          <LengthField
            label="Trim width"
            value={trimOf(opening)}
            bound="nonnegative"
            onCommit={(v) => void (v !== null && updateOpening(levelId, opening.id, { trim: v }))}
            hint={`Outside face, default ${formatLength(DEFAULT_TRIM, denom)}.`}
          />
        </>
      )}
      {opening.type === 'window' && (
        <label className="check-row">
          <input
            type="checkbox"
            aria-label="Shutters"
            checked={!!opening.shutters}
            onChange={(e) => {
              updateOpening(levelId, opening.id, { shutters: e.target.checked ? true : undefined });
              releaseFocus(e.currentTarget);
            }}
          />
          Shutters (two boards flanking the trim)
        </label>
      )}
      <ReadOnly label="Wall length">{formatLength(L, denom)}</ReadOnly>
    </>
  );
}

const liteCheck = (v: number): string | null => (Number.isInteger(v) && v >= 1 && v <= MAX_LITES ? null : `A whole number from 1 to ${MAX_LITES}.`);

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
    if (v && v !== room.name) {
      noteDuplicateRoomName(level.id, v, room.id);
      updateRoom(level.id, room.id, { name: v });
    }
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
          if (v === null) return null;
          if (!stairsWidthOk(v)) return `Between ${formatLength(STAIRS_LIMITS.minWidth, denom)} and ${formatLength(STAIRS_LIMITS.maxWidth, denom)}`;
          updateStairs(level.id, stairs.id, { width: v });
          return null;
        }}
      />
      <LengthField
        label="Run"
        value={stairs.run}
        onCommit={(v) => {
          if (v === null) return null;
          if (!stairsRunOk(v)) return `Between ${formatLength(STAIRS_LIMITS.minRun, denom)} and ${formatLength(STAIRS_LIMITS.maxRun, denom)}`;
          updateStairs(level.id, stairs.id, { run: v });
          return null;
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
      {stairs.cutsFloorAbove && <StairsOpeningFields level={level} stairs={stairs} ftf={ftf} />}
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

/**
 * Where the stair's opening in the floor above starts: by default where the headroom under that
 * floor drops below `headroom` (80"), or a typed distance from the bottom. A flight with headroom
 * all the way up cuts nothing, and the panel says so.
 */
function StairsOpeningFields({ level, stairs, ftf }: { level: Level; stairs: Stairs; ftf: number }) {
  const updateStairs = usePlanStore((s) => s.updateStairs);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const byRule = headroomHoleStart(stairs, ftf);
  const start = stairsHoleStart(stairs, ftf);
  const hole = stairsHoleOutline(stairs, ftf);
  return (
    <>
      <LengthField
        label="Floor opening starts"
        value={stairs.holeStart}
        bound="nonnegative"
        allowEmpty
        placeholder={`${formatLength(byRule, denom)} (headroom rule)`}
        onCommit={(v) => {
          if (v !== null && v > stairs.run) return `At most the run, ${formatLength(stairs.run, denom)}`;
          updateStairs(level.id, stairs.id, { holeStart: v ?? undefined });
          return null;
        }}
        hint="From the bottom of the flight. Blank follows the headroom rule."
      />
      <LengthField
        label="Headroom"
        value={stairs.headroom}
        allowEmpty
        placeholder={`${formatLength(STAIRS_HEADROOM, denom)} (default)`}
        onCommit={(v) => {
          updateStairs(level.id, stairs.id, { headroom: v ?? undefined });
        }}
        hint="Clear height over the treads; the opening starts where the floor above comes lower."
      />
      <ReadOnly label="Floor opening">
        {hole ? (
          <>
            {formatLength(start, denom)} to {formatLength(stairs.run, denom)} up the run ({formatLength(stairs.run - start, denom)} long)
          </>
        ) : (
          'none: the floor above clears the flight'
        )}
      </ReadOnly>
    </>
  );
}

const roofShapeOptions = (['gable', 'shed', 'hip', 'flat'] as const).map((v) => ({ value: v, label: ROOF_SHAPE_LABEL[v] }));
const roofFinishOptions: { value: RoofFinish; label: string }[] = [
  { value: 'metal', label: 'Metal' },
  { value: 'shingle', label: 'Shingle' },
];

/** Ridge direction buttons: along x or y for a gable or hip, the four downhill directions for a shed. */
const RIDGE_BUTTONS: Record<RoofShape, { angle: number; label: string; title: string }[]> = {
  gable: [
    { angle: 0, label: '0° (along x)', title: 'Ridge runs left to right on the plan' },
    { angle: 90, label: '90° (along y)', title: 'Ridge runs top to bottom on the plan' },
  ],
  hip: [
    { angle: 0, label: '0° (along x)', title: 'Ridge runs left to right on the plan' },
    { angle: 90, label: '90° (along y)', title: 'Ridge runs top to bottom on the plan' },
  ],
  shed: [
    { angle: 0, label: '0° right', title: 'Slopes down toward +x (right on the plan)' },
    { angle: 90, label: '90° down', title: 'Slopes down toward +y (down the plan)' },
    { angle: 180, label: '180° left', title: 'Slopes down toward -x (left on the plan)' },
    { angle: 270, label: '270° up', title: 'Slopes down toward -y (up the plan)' },
  ],
  flat: [],
};

function RoofProps({ level, roof }: { level: Level; roof: Roof }) {
  const updateRoof = usePlanStore((s) => s.updateRoof);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const viewMode = useUiStore((s) => s.viewMode);
  const [fitNote, setFitNote] = useState<{ text: string; error: boolean } | null>(null);
  const set = (patch: Partial<Roof>) => updateRoof(level.id, roof.id, patch);
  const bearing = roofBearing(level.wallHeight, roof);
  const { ridge, eave } = roofExtremes(roof, bearing);
  const b = boundsOf(roof.outline);
  const fitToWalls = () => {
    const outlines = slabOutlines(getFaces(level, viewMode), true);
    if (outlines.length !== 1) {
      setFitNote({
        text: outlines.length === 0 ? 'No closed ring of walls on this level to fit to.' : `The walls make ${outlines.length} separate outlines; draw this roof's corners instead.`,
        error: true,
      });
      return;
    }
    set({ outline: outlines[0] });
    setFitNote({ text: `Fitted to the outside faces (${outlines[0].length} corners).`, error: false });
  };
  return (
    <>
      <h3>Roof</h3>
      <SelectField label="Shape" value={roof.shape} options={roofShapeOptions} onChange={(shape) => set({ shape })} />
      {roof.shape === 'hip' && <p className="panel-note">A hip roof is built over the outline's bounding rectangle (in the ridge direction).</p>}
      {roof.shape !== 'flat' && (
        <>
          <div className="field">
            <span className="label">{roof.shape === 'shed' ? 'Slopes down toward' : 'Ridge direction'}</span>
            <div className="panel-buttons ridge-buttons">
              {RIDGE_BUTTONS[roof.shape].map((r) => (
                <button key={r.angle} className={roof.ridgeAngle === r.angle ? 'active' : ''} aria-pressed={roof.ridgeAngle === r.angle} title={r.title} onClick={() => set({ ridgeAngle: r.angle })}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <NumberField
            label={roof.shape === 'shed' ? 'Downhill angle' : 'Ridge angle'}
            value={roof.ridgeAngle}
            onCommit={(v) => set({ ridgeAngle: v })}
            hint="Degrees: 0 along +x, 90 along +y (down the plan)."
          />
          <NumberField
            label="Pitch"
            value={roof.pitch}
            onCommit={(v) => set({ pitch: v })}
            check={(v) => (v < 0 || v > MAX_ROOF_PITCH ? `Between 0 and ${MAX_ROOF_PITCH}.` : null)}
            hint={`Rise per 12 of run (8 is 8:12).`}
          />
        </>
      )}
      <LengthField label="Overhang" value={roof.overhang} bound="nonnegative" onCommit={(v) => void (v !== null && set({ overhang: v }))} hint="Eaves and rakes, beyond the outline." />
      <LengthField
        label="Bearing offset"
        value={roof.bearingOffset}
        bound="any"
        onCommit={(v) => void (v !== null && set({ bearingOffset: v }))}
        hint="Where the roof sits above this level's ceiling (usually 0)."
      />
      <LengthField label="Thickness" value={roof.thickness} onCommit={(v) => void (v !== null && set({ thickness: v }))} hint="Measured vertically." />
      <LengthField label="Fascia" value={roof.fascia} bound="nonnegative" onCommit={(v) => void (v !== null && set({ fascia: v }))} hint="Depth of the fascia and rake boards." />
      <SelectField label="Finish" value={roof.finish} options={roofFinishOptions} onChange={(finish) => set({ finish })} />
      <ColorField
        label="Colour"
        value={roofColorOf(roof)}
        onCommit={(color) => set({ color })}
        onReset={roof.color ? () => set({ color: undefined }) : undefined}
        hint={`Default for ${roof.finish}: ${ROOF_COLOR[roof.finish]}. The fascia is tan.`}
      />
      <SelectField label="Phase" value={roof.phase} options={phaseOptions} onChange={(phase) => set({ phase })} />
      <ReadOnly label={roof.shape === 'shed' ? 'High side' : roof.shape === 'flat' ? 'Underside' : 'Ridge'}>{formatLength(ridge, denom)} above the floor</ReadOnly>
      <ReadOnly label="Eave">{formatLength(eave, denom)} above the floor</ReadOnly>
      {b && (
        <ReadOnly label="Outline">
          {roof.outline.length} corners, {formatLength(b.maxX - b.minX, denom)} x {formatLength(b.maxY - b.minY, denom)}
        </ReadOnly>
      )}
      <div className="panel-buttons">
        <button onClick={fitToWalls} title="Set the outline to the outside faces of this level's walls (when they close one ring)">
          Fit to walls
        </button>
      </div>
      {fitNote && <p className={`panel-note${fitNote.error ? ' warning' : ''}`}>{fitNote.text}</p>}
      <p className="panel-note">Heights are underside heights at the outline. Drag an outline corner with the select tool to move it.</p>
    </>
  );
}

const columnKindOptions: { value: Column['kind']; label: string }[] = [
  { value: 'chimney', label: 'Chimney' },
  { value: 'post', label: 'Post' },
];

function GradePointProps({ point }: { point: GradePoint }) {
  const updateGradePoint = usePlanStore((s) => s.updateGradePoint);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const firstTop = usePlanStore((s) => {
    const id = s.plan.levelOrder[1] ?? s.plan.levelOrder[0];
    return id ? getLevelElevations(s.plan)[id]?.floorTop : undefined;
  });
  return (
    <>
      <h3>Grade point</h3>
      <LengthField
        label="Elevation"
        value={point.elevation}
        bound="any"
        onCommit={(v) => void (v !== null && updateGradePoint(point.id, { elevation: v }))}
        hint="Height of the ground here, in feet and inches; a minus sign is allowed."
      />
      {firstTop !== undefined && (
        <ReadOnly label="Against the first floor">
          {point.elevation === firstTop ? 'level with it' : `${formatLength(Math.abs(point.elevation - firstTop), denom)} ${point.elevation < firstTop ? 'below' : 'above'}`}
        </ReadOnly>
      )}
      <ReadOnly label="Position">
        x {formatLength(point.at.x, denom)}, y {formatLength(point.at.y, denom)}
      </ReadOnly>
      <p className="panel-note">Drag it with the select tool to move it. The ground between grade points is interpolated.</p>
    </>
  );
}

function ColumnProps({ column }: { column: Column }) {
  const updateColumn = usePlanStore((s) => s.updateColumn);
  const ground = usePlanStore((s) => groundAt(s.plan, column.at));
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const set = (patch: Partial<Column>): string | null => {
    const problem = columnProblem({ ...column, ...patch });
    if (problem) return problem[0].toUpperCase() + problem.slice(1) + '.';
    updateColumn(column.id, patch);
    return null;
  };
  const length = (key: 'width' | 'depth' | 'base' | 'top', label: string, bound: 'positive' | 'any', hint?: string) => (
    <LengthField label={label} value={column[key]} bound={bound} onCommit={(v) => (v === null ? null : set({ [key]: v }))} hint={hint} />
  );
  const resetHeights = () => {
    const plan = usePlanStore.getState().plan;
    const def = columnDefaults(plan, column.kind, column.at, column.phase);
    updateColumn(column.id, { base: def.base, top: def.top });
  };
  return (
    <>
      <h3>{column.kind === 'chimney' ? 'Chimney' : 'Post'}</h3>
      <SelectField label="Kind" value={column.kind} options={columnKindOptions} onChange={(kind) => updateColumn(column.id, { kind })} />
      {length('width', 'Width', 'positive', 'Along the plan x axis before rotation.')}
      {length('depth', 'Depth', 'positive', 'Along the plan y axis before rotation.')}
      <NumberField label="Rotation" value={column.rotation} onCommit={(v) => updateColumn(column.id, { rotation: v })} hint="Degrees, clockwise on the plan." />
      {length('base', 'Base', 'any', 'Bottom, as an elevation (the ground here is shown below).')}
      {length('top', 'Top', 'any', 'Top, as an elevation.')}
      <SelectField label="Phase" value={column.phase} options={phaseOptions} onChange={(phase) => updateColumn(column.id, { phase })} />
      <ReadOnly label="Height">{formatLength(column.top - column.base, denom)}</ReadOnly>
      <ReadOnly label="Position">
        x {formatLength(column.at.x, denom)}, y {formatLength(column.at.y, denom)}
      </ReadOnly>
      <div className="panel-buttons">
        <button
          onClick={resetHeights}
          title={column.kind === 'chimney' ? 'Base 12" below the ground here, top 48" above the highest ridge' : 'Base on the ground here, top at the lowest roof underside over it'}
        >
          Reset heights
        </button>
      </div>
      <p className="panel-note">Ground here: {formatLength(ground, denom)}. Drag it with the select tool to move it.</p>
    </>
  );
}

/** Nothing selected in site mode: the north angle, the counts and the way to start over. */
function SiteProps({ site }: { site: Site }) {
  const setNorthAngle = usePlanStore((s) => s.setNorthAngle);
  const clearGradePoints = usePlanStore((s) => s.clearGradePoints);
  const points = Object.keys(site.gradePoints).length;
  const columns = Object.keys(site.columns).length;
  return (
    <>
      <h3>Site</h3>
      <NumberField
        label="North angle"
        value={site.northAngle}
        onCommit={(v) => setNorthAngle(v)}
        hint="Degrees clockwise from the top of the plan to true north. The 3D sun follows it."
      />
      <div className="panel-buttons">
        <button className={site.northAngle === 0 ? 'active' : ''} aria-pressed={site.northAngle === 0} onClick={() => setNorthAngle(0)} title="North is up the plan (the road side of the house)">
          Road is north
        </button>
      </div>
      <ReadOnly label="Grade points">{points}</ReadOnly>
      <ReadOnly label="Columns">{columns}</ReadOnly>
      <div className="panel-buttons">
        <button
          className="danger"
          disabled={points === 0}
          onClick={() => {
            if (window.confirm(`Remove all ${points} grade ${points === 1 ? 'point' : 'points'}? The ground goes flat again. (Undo brings them back.)`)) clearGradePoints();
          }}
        >
          Clear grade points
        </button>
      </div>
      <p className="panel-note">E places a grade point (click, type the elevation, Enter). C places a chimney or post. The ground is interpolated between grade points.</p>
    </>
  );
}

function MixedProps({
  levelId,
  sel,
  walls,
  openings,
  stairs,
  roofs,
  columns,
}: {
  levelId: Id;
  sel: Selection;
  walls: Wall[];
  openings: Opening[];
  stairs: Stairs[];
  roofs: Roof[];
  columns: Column[];
}) {
  const setPhase = usePlanStore((s) => s.setPhase);
  const parts: string[] = [];
  if (walls.length) parts.push(`${walls.length} ${walls.length === 1 ? 'wall' : 'walls'}`);
  if (openings.length) parts.push(`${openings.length} ${openings.length === 1 ? 'opening' : 'openings'}`);
  if (stairs.length) parts.push(`${stairs.length} stairs`);
  if (roofs.length) parts.push(`${roofs.length} ${roofs.length === 1 ? 'roof' : 'roofs'}`);
  if (columns.length) parts.push(`${columns.length} ${columns.length === 1 ? 'column' : 'columns'}`);
  if (sel.gradePoints.length) parts.push(`${sel.gradePoints.length} grade ${sel.gradePoints.length === 1 ? 'point' : 'points'}`);
  if (sel.nodes.length) parts.push(`${sel.nodes.length} ${sel.nodes.length === 1 ? 'corner' : 'corners'}`);
  if (sel.rooms.length) parts.push(`${sel.rooms.length} ${sel.rooms.length === 1 ? 'room' : 'rooms'}`);
  const items = [...walls, ...openings, ...stairs, ...roofs, ...columns];
  return (
    <>
      <h3>{parts.join(', ')}</h3>
      {items.length > 0 && (
        <SelectField
          label="Phase"
          value={common(items, (i) => i.phase)}
          options={phaseOptions}
          onChange={(p) =>
            setPhase(
              levelId,
              {
                walls: walls.map((w) => w.id),
                openings: openings.map((o) => o.id),
                stairs: stairs.map((st) => st.id),
                roofs: roofs.map((r) => r.id),
                columns: columns.map((c) => c.id),
              },
              p,
            )
          }
        />
      )}
      {items.length === 0 && <p className="panel-note">{sel.gradePoints.length ? 'Drag grade points with the select tool to move them.' : 'Drag corners with the select tool to move them.'}</p>}
    </>
  );
}

/** A number input in degrees: commits on Enter or blur, Escape reverts. */
function DegreesField(props: { label: string; value: number; onCommit: (v: number) => void; disabled?: boolean; hint?: ReactNode }) {
  return <NumberField hint="Clockwise, about the image centre." {...props} />;
}

/** A plain number input: commits on Enter or blur, Escape reverts; `check` returns an error or null. */
function NumberField({
  label,
  value,
  onCommit,
  disabled,
  hint,
  check,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  disabled?: boolean;
  hint?: ReactNode;
  check?: (v: number) => string | null;
}) {
  const fmt = (v: number) => String(Math.round(v * 100) / 100);
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  useEffect(() => {
    if (!focused) setText(fmt(value));
  }, [value, focused]);
  useEffect(() => setError(null), [value]);
  const skipBlur = useRef(false);
  const commit = (): boolean => {
    const v = Number(text.trim().replace(/°$/, ''));
    if (text.trim() === '' || !Number.isFinite(v)) {
      setError('Enter a number.');
      return false;
    }
    const bad = check?.(v) ?? null;
    if (bad) {
      setError(bad);
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
          if (!skipBlur.current && !commit()) {
            setText(fmt(value));
            setError(null);
          }
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
      {!error && hint && <div className="field-hint">{hint}</div>}
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

/** Finish and colour of every exterior wall on a level, set together (one undo step each). */
function ExteriorAppearance({ level }: { level: Level }) {
  const updateWalls = usePlanStore((s) => s.updateWalls);
  const exterior = Object.values(level.walls).filter((w) => w.kind === 'exterior');
  const ids = exterior.map((w) => w.id);
  const finish = common(exterior, wallFinishOf) ?? (exterior.length ? null : defaultWallFinish('exterior'));
  const color = common(exterior, wallColorOf) ?? defaultWallColor('exterior');
  return (
    <>
      <SelectField label="Exterior finish" value={finish as WallFinish | null} options={finishOptions} onChange={(f) => ids.length && updateWalls(level.id, ids, { finish: f })} />
      <ColorField
        label="Exterior colour"
        value={color}
        onCommit={(c) => ids.length && updateWalls(level.id, ids, { color: c })}
        hint={ids.length ? `Sets all ${ids.length} exterior walls on this level.` : 'No exterior walls on this level yet.'}
      />
    </>
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
      <ExteriorAppearance level={level} />
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
      <p className="panel-note">Select walls, openings, room labels or roofs to edit them. R names a room, K draws a roof.</p>
    </>
  );
}

export function PropertiesPanel() {
  const levelId = useUiStore((s) => s.activeLevelId);
  const sel = useUiStore((s) => s.selection);
  const underlaySelected = useUiStore((s) => s.underlaySelected);
  const underlayTool = useUiStore((s) => s.activeTool === 'underlay');
  const level = usePlanStore((s) => s.plan.levels[levelId]);
  const site = usePlanStore((s) => s.plan.site);
  const siteMode = useUiStore((s) => s.siteMode);
  if (!level) return <aside className="side-panel" />;
  const walls = sel.walls.map((id) => level.walls[id]).filter(Boolean);
  const openings = sel.openings.map((id) => level.openings[id]).filter(Boolean);
  const nodes = sel.nodes.filter((id) => level.nodes[id]);
  const rooms = sel.rooms.map((id) => level.rooms[id]).filter(Boolean);
  const stairs = sel.stairs.map((id) => level.stairs[id]).filter(Boolean);
  const roofs = sel.roofs.map((id) => level.roofs[id]).filter(Boolean);
  const gradePoints = sel.gradePoints.map((id) => site.gradePoints[id]).filter(Boolean);
  const columns = sel.columns.map((id) => site.columns[id]).filter(Boolean);
  const live: Selection = {
    nodes,
    walls: walls.map((w) => w.id),
    openings: openings.map((o) => o.id),
    rooms: rooms.map((r) => r.id),
    stairs: stairs.map((st) => st.id),
    roofs: roofs.map((r) => r.id),
    gradePoints: gradePoints.map((g) => g.id),
    columns: columns.map((c) => c.id),
  };
  const total = selectionSize(live);

  let body: ReactNode;
  if (total === 0 && siteMode) body = <SiteProps key="site" site={site} />;
  else if (total === 0 && (underlayTool || (underlaySelected && level.underlay))) body = <UnderlayProps key={level.id} level={level} />;
  else if (total === 0) body = <LevelProps key={level.id} level={level} />;
  else if (total === 1 && walls.length === 1) body = <WallProps key={walls[0].id} level={level} wall={walls[0]} />;
  else if (total === 1 && openings.length === 1)
    body = <OpeningProps key={openings[0].id} level={level} opening={openings[0]} />;
  else if (total === 1 && rooms.length === 1) body = <RoomProps key={rooms[0].id} level={level} room={rooms[0]} />;
  else if (total === 1 && stairs.length === 1) body = <StairsProps key={stairs[0].id} level={level} stairs={stairs[0]} />;
  else if (total === 1 && roofs.length === 1) body = <RoofProps key={roofs[0].id} level={level} roof={roofs[0]} />;
  else if (total === 1 && gradePoints.length === 1) body = <GradePointProps key={gradePoints[0].id} point={gradePoints[0]} />;
  else if (total === 1 && columns.length === 1) body = <ColumnProps key={columns[0].id} column={columns[0]} />;
  else if (total === walls.length) body = <MultiWallProps key={walls.map((w) => w.id).join(',')} levelId={level.id} walls={walls} />;
  else body = <MixedProps levelId={level.id} sel={live} walls={walls} openings={openings} stairs={stairs} roofs={roofs} columns={columns} />;

  return (
    <aside className="side-panel" aria-label="Properties">
      <div className="panel-title">Properties</div>
      <div className="panel-body">
        {body}
        {total > 0 && <SelectionActions levelId={level.id} walls={walls} openings={openings} stairs={stairs} roofs={roofs} columns={columns} />}
      </div>
    </aside>
  );
}
