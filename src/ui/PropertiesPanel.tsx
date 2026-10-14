import { useShallow } from 'zustand/react/shallow';
import { issuesFor, type IssueTarget } from '../derive/checks';
import { stairChains } from '../derive/stairChain';
import { staircaseFieldProblem, staircaseStyleOf } from '../model/stairStyle';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { getFootprints } from '../derive/footprint';
import { compassName, deckTopWords, edgeOutward, getDeckLayout } from '../derive/decks';
import { getFloorOpeningLayout } from '../derive/floorOpenings';
import { getLevelElevations } from '../derive/levels';
import { coreInterval, jambDistances, liveFootprints } from '../derive/openings';
import { isVisible, PHASE_LABEL } from '../derive/phase';
import { facesBesideWall, getFaces, roomDimensions, slabOutlines, type Face, type FaceSet } from '../derive/rooms';
import { RAFTER_WIDTH, roofBearing, roofExtremes, ROOF_SHAPE_LABEL } from '../derive/roofs';
import { columnDefaults, groundAt } from '../derive/site';
import { directionVector, flightSteps, floorToFloor, headroomHoleStart, STAIRS_HEADROOM, STAIRS_LIMITS, stairsBase, stairsHeightProblem, stairsHoleOutline, stairsHoleStart, stairsRise, stairsRunOk, stairsWidthOk, stairSteps } from '../derive/stairs';
import { activateUnderlayTool, makeToolContext, switchTool } from '../editor2d/tools';
import { beamHeights, joistDepth, memberBoxes } from '../derive/members';
import { bearingOf } from '../derive/structure';
import { isLog, isTimber, joistWords, MEMBER_COLOR, MEMBER_DEFAULTS, normalizeJoists } from '../model/structure';
import { setFixtureKind } from '../editor2d/tools/fixtureTool';
import { COLUMN_KIND_NAME } from '../editor2d/tools/siteTools';
import { confirmRemoveUnderlay, requestUnderlayImage } from '../editor2d/tools/underlayTool';
import {
  counterColorOf,
  counterOverhangOf,
  counterTopOf,
  DEFAULT_CABINET_COLOR,
  DEFAULT_COUNTER_COLOR,
  FIXTURE_DEFAULTS,
  FIXTURE_KINDS,
  FIXTURE_LABEL,
  FRONT_STYLE_LABEL,
  FRONT_STYLES,
  frontColorOf,
  frontStyleOf,
  hasCounter,
  isCabinet,
  TALL_CABINET_HEIGHTS,
  WALL_CABINET_HEIGHTS,
} from '../model/casework';
import { formatPxScale, rotateAbout, scaleAbout, underlayCenter } from '../model/underlay';
import { dist, pointInPolygon, polygonSignedArea } from '../model/geometry';
import { OPENING_DEFAULTS, OPENING_LABEL, openingFitsHeight, wallHeightOf, type OpeningType } from '../model/openings';
import { columnProblem, MAX_DECK_ELEVATION, MAX_ROOF_PITCH, wallLength } from '../model/plan';
import { boundsOf } from '../model/geometry';
import { BAND_FINISHES, DEFAULT_LEAF_COLOR, DEFAULT_SASH_COLOR, DEFAULT_SASHES, DEFAULT_TRIM, defaultWallColor, defaultWallFinish, GLAZING_LABEL, glazingOf, GLAZINGS, isSlidingDoor, leafColorOf, leavesOf, litesOf, MAX_LEAVES, MAX_LITES, MAX_SASHES, normalizeHex, ROOF_COLOR, roofColorOf, sashesOf, SIDING_FINISHES, trimOf, WALL_FINISH_LABEL, WALL_FINISHES, wallColorOf, wallFinishOf } from '../model/finish';
import { boardColorOf, COLUMN_COLOR, columnColorOf, DECK_COLOR, deckColorOf, DEFAULT_RAFTER, DEFAULT_WEATHERING, rafterOf, ROOF_EAVE_LABEL, ROOF_EAVES, roofEaveOf, TRIM_COLOR, weatheringOf } from '../model/finish';
import { FLOOR_FINISH_LABEL, FLOOR_FINISHES, floorLookOf, ROOM_WALL_COLOR, ROOM_WALL_FINISH_LABEL, ROOM_WALL_FINISHES, roomWallLookOf } from '../model/finish';
import type { Beam, Column, Deck, Fixture, FloorOpening, FrontStyle, GradePoint, Id, JoistZone, Level, Member, Opening, Phase, Roof, RoofFinish, RoofShape, Room, Site, Staircase, StairHandrail, StairNewel, StairStartStep, StairStringer, StairUnderside, Stairs, Wall, WallFinish, WallKind } from '../model/types';
import { formatArea, formatLength, parseLength } from '../model/units';
import { pauseHistory, resumeHistory, usePlanStore, type DeckPatch, type FloorOpeningPatch, type JoistZonePatch, type LengthAnchor, type MemberPatch, type RoomPatch, type StaircasePatch } from '../store/planStore';
import { EMPTY_SELECTION, selectionSize, useUiStore, type Selection } from '../store/uiStore';
import { duplicateRoomNotice, showNotice } from './fileActions';
import { requestWallMove, roomNameOf, wallSideNames } from './wallMove';
import { wallShift, type WallSide } from '../model/offset';
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
type BandChoice = 'none' | WallFinish;
const bandOptions: { value: BandChoice; label: string }[] = [{ value: 'none', label: 'None' }, ...BAND_FINISHES.map((f) => ({ value: f, label: WALL_FINISH_LABEL[f] }))];
/** A new lower band's height: a knee wall's. */
const DEFAULT_BAND = 36;

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

/** Phases of the selected items that have one; a room label without a phase is existing. */
function phasesOf(items: { phase?: Phase }[]): Phase[] {
  return items.map((i) => i.phase ?? 'existing');
}

function SelectionActions({
  levelId,
  walls,
  openings,
  stairs,
  roofs,
  fixtures,
  decks,
  floorOpenings,
  members,
  joistZones,
  columns,
  rooms,
}: {
  levelId: Id;
  walls: Wall[];
  openings: Opening[];
  stairs: Stairs[];
  roofs: Roof[];
  fixtures: Fixture[];
  decks: Deck[];
  floorOpenings: FloorOpening[];
  members: Member[];
  joistZones: JoistZone[];
  columns: Column[];
  rooms: Room[];
}) {
  const setPhase = usePlanStore((s) => s.setPhase);
  const deleteEntities = usePlanStore((s) => s.deleteEntities);
  const selection = useUiStore((s) => s.selection);
  const phases = phasesOf([...walls, ...openings, ...stairs, ...roofs, ...fixtures, ...decks, ...floorOpenings, ...members, ...joistZones, ...columns, ...rooms]);
  if (phases.length === 0 && selectionSize(selection) === 0) return null;
  const allDemo = phases.length > 0 && phases.every((p) => p === 'demo');
  const ids = {
    walls: walls.map((w) => w.id),
    openings: openings.map((o) => o.id),
    stairs: stairs.map((st) => st.id),
    roofs: roofs.map((r) => r.id),
    fixtures: fixtures.map((f) => f.id),
    decks: decks.map((d) => d.id),
    floorOpenings: floorOpenings.map((o) => o.id),
    members: members.map((m) => m.id),
    joistZones: joistZones.map((z) => z.id),
    columns: columns.map((c) => c.id),
    rooms: rooms.map((r) => r.id),
  };
  return (
    <div className="panel-actions">
      {phases.length > 0 && (
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
 * Move a wall across by a typed distance, toward the room on either side (docs/history/REVIEW-2.md B1).
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
    const problem = requestWallMove({
      levelId: level.id,
      wallId: wall.id,
      shifts: { [wall.id]: wallShift(level, wall.id, v, side) },
      what,
      correct: () => usePlanStore.getState().offsetWalls(level.id, [wall.id], v, side),
    });
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
  const viewMode = useUiStore((s) => s.viewMode);
  // What the tool makes of it when it is not marked (derive/structure.ts), as a string (a stable selection).
  const inferred = usePlanStore((s) => {
    const w = s.plan.levels[levelId]?.walls[wall.id];
    const b = w && w.bearing === undefined ? bearingOf(s.plan, levelId, w, viewMode) : undefined;
    return b ? `Auto: ${b.bearing ? `likely bearing, ${b.reason}` : b.reason === 'not bearing' ? 'not bearing, as far as the tool can tell' : `not bearing, ${b.reason}`}.` : null;
  });
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
      <SelectField
        label="Bearing"
        value={wall.bearing === undefined ? 'auto' : wall.bearing ? 'yes' : 'no'}
        options={bearingOptions}
        onChange={(v) => updateWalls(levelId, [wall.id], { bearing: v === 'auto' ? undefined : v === 'yes' })}
      />
      {inferred && <p className="field-hint">{inferred}</p>}
      <IssueNotes levelId={levelId} target={{ walls: [wall.id] }} />
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
        hint={
          wall.kind === 'exterior'
            ? 'Both faces of an exterior wall show the siding, except a face on the side of a room that sets its own wall finish.'
            : 'A face on the side of a room that sets its own wall finish shows that instead.'
        }
      />
      <WallBandFields levelId={levelId} wall={wall} wallHeight={wall.heightOverride ?? level.wallHeight} />
      <WallFaceLengths level={level} wall={wall} />
      <MoveWall level={level} wall={wall} />
      <ReadOnly label="Openings">{openingCount}</ReadOnly>
    </>
  );
}

/**
 * A wall's lower band (Wall.band): its outside face below a height in another finish, like a
 * wainscot outside (a stone base, a half-log knee wall). Each change is one undo step.
 */
function WallBandFields({ levelId, wall, wallHeight }: { levelId: Id; wall: Wall; wallHeight: number }) {
  const updateWalls = usePlanStore((s) => s.updateWalls);
  const set = (band: Wall['band']) => updateWalls(levelId, [wall.id], { band });
  const b = wall.band;
  return (
    <>
      <SelectField
        label="Lower band"
        value={b?.finish ?? 'none'}
        options={bandOptions}
        onChange={(v) => set(v === 'none' ? undefined : { ...b, finish: v, height: b?.height ?? Math.min(DEFAULT_BAND, wallHeight / 2) })}
      />
      {b && (
        <>
          <LengthField
            label="Band height"
            value={b.height}
            onCommit={(h) => {
              if (h === null) return;
              if (h >= wallHeight) return 'Must be lower than the wall.';
              set({ ...b, height: h });
            }}
          />
          <ColorField
            label="Band colour"
            value={b.color ?? wallColorOf(wall)}
            onCommit={(color) => set({ ...b, color })}
            onReset={b.color ? () => set({ finish: b.finish, height: b.height }) : undefined}
            hint="Default: the wall's own colour."
          />
          <div className="panel-buttons">
            <button onClick={() => set(undefined)} title="Remove the lower band: the whole face shows the wall's finish">
              Clear band
            </button>
          </div>
          <p className="panel-note">In 3D the outside face shows this finish below the band's height. A proposed look re-sides only the part above.</p>
        </>
      )}
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
  const door = opening.type === 'door';
  const sliding = isSlidingDoor(opening);
  const screened = glazingOf(opening) === 'screen';
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
      {door && (
        <label className="check-row">
          <input
            type="checkbox"
            aria-label="Sliding"
            checked={sliding}
            onChange={(e) => {
              updateOpening(levelId, opening.id, { sliding: e.target.checked ? true : undefined });
              releaseFocus(e.currentTarget);
            }}
          />
          Sliding (two glazed panels in tracks, no swing)
        </label>
      )}
      {door && !sliding && (
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
          {!sliding && (
            <NumberField
              label={door ? 'Leaves' : 'Sashes'}
              value={door ? leavesOf(opening) : sashesOf(opening)}
              check={door ? leafCheck : sashCheck}
              onCommit={(n) => updateOpening(levelId, opening.id, { sashes: n === DEFAULT_SASHES ? undefined : n })}
              hint={door ? 'Two makes a double door.' : 'Side by side, with 2" mullions between them.'}
            />
          )}
          {opening.type === 'window' && sashesOf(opening) === 3 && (
            <label className="check-row">
              <input
                type="checkbox"
                aria-label="Fixed centre pane"
                checked={!!opening.fixedCenter}
                onChange={(e) => {
                  updateOpening(levelId, opening.id, { fixedCenter: e.target.checked ? true : undefined });
                  releaseFocus(e.currentTarget);
                }}
              />
              Fixed centre pane (side sashes at most 24" wide)
            </label>
          )}
          <SelectField
            label="Glazing"
            value={glazingOf(opening)}
            options={glazingOptions}
            onChange={(g) => updateOpening(levelId, opening.id, { glazing: g === 'glass' ? undefined : g })}
          />
          {!screened && (
            <>
              <NumberField
                label={sliding ? 'Lites across per panel' : door ? 'Glazed columns per leaf' : 'Lites across per sash'}
                value={litesOf(opening).cols}
                check={liteCheck}
                onCommit={(cols) => updateOpening(levelId, opening.id, { lites: { cols, rows: litesOf(opening).rows } })}
                hint={
                  sliding
                    ? 'Each panel is glass; 1 x 1 is one pane.'
                    : door
                      ? opening.halfLite
                        ? 'The grid glazes the upper part of the leaf.'
                        : 'A leaf is a solid panel at 1 x 1; more lites glaze its panel.'
                      : undefined
                }
              />
              <NumberField
                label={sliding ? 'Lites down per panel' : door ? 'Glazed rows per leaf' : 'Lites down per sash'}
                value={litesOf(opening).rows}
                check={liteCheck}
                onCommit={(rows) => updateOpening(levelId, opening.id, { lites: { cols: litesOf(opening).cols, rows } })}
              />
            </>
          )}
          {door && !sliding && !screened && (
            <label className="check-row">
              <input
                type="checkbox"
                aria-label="Half lite"
                checked={!!opening.halfLite}
                onChange={(e) => {
                  updateOpening(levelId, opening.id, { halfLite: e.target.checked ? true : undefined });
                  releaseFocus(e.currentTarget);
                }}
              />
              Half lite (glass above, two panels below)
            </label>
          )}
          <LengthField
            label="Trim width"
            value={trimOf(opening)}
            bound="nonnegative"
            onCommit={(v) => void (v !== null && updateOpening(levelId, opening.id, { trim: v }))}
            hint={`Outside face, default ${formatLength(DEFAULT_TRIM, denom)}.`}
          />
          {door && !sliding && (
            <ColorField
              label="Leaf colour"
              value={leafColorOf(opening)}
              onCommit={(leafColor) => updateOpening(levelId, opening.id, { leafColor })}
              onReset={opening.leafColor ? () => updateOpening(levelId, opening.id, { leafColor: undefined }) : undefined}
              hint={screened ? 'The screen door frame.' : `Default ${DEFAULT_LEAF_COLOR}.`}
            />
          )}
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
          Shutters (a board each side, one sash wide)
        </label>
      )}
      <ReadOnly label="Wall length">{formatLength(L, denom)}</ReadOnly>
    </>
  );
}

const liteCheck = (v: number): string | null => (Number.isInteger(v) && v >= 1 && v <= MAX_LITES ? null : `A whole number from 1 to ${MAX_LITES}.`);
const sashCheck = (v: number): string | null => (Number.isInteger(v) && v >= 1 && v <= MAX_SASHES ? null : `A whole number from 1 to ${MAX_SASHES}.`);
const leafCheck = (v: number): string | null => (v === 1 || v === MAX_LEAVES ? null : 'One leaf, or two for a double door.');
const glazingOptions = GLAZINGS.map((g) => ({ value: g, label: GLAZING_LABEL[g] }));

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
      const dup = duplicateRoomNotice(level.id, v, room.id);
      updateRoom(level.id, room.id, { name: v });
      // After the edit, which clears the status bar's notice.
      if (dup) showNotice(dup);
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
      <SelectField
        label="Phase"
        value={room.phase ?? 'existing'}
        options={phaseOptions}
        onChange={(p) => updateRoom(level.id, room.id, { phase: p === 'existing' ? undefined : p })}
      />
      <RoomFinishes levelId={level.id} room={room} wallHeight={level.wallHeight} />
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

type RoomWallChoice = 'default' | (typeof ROOM_WALL_FINISHES)[number];
const roomWallOptions: { value: RoomWallChoice; label: string }[] = [{ value: 'default', label: 'Default (the wall\'s own)' }, ...ROOM_WALL_FINISHES.map((f) => ({ value: f, label: ROOM_WALL_FINISH_LABEL[f] }))];
type WainscotChoice = 'none' | (typeof ROOM_WALL_FINISHES)[number];
const wainscotOptions: { value: WainscotChoice; label: string }[] = [{ value: 'none', label: 'None' }, ...ROOM_WALL_FINISHES.map((f) => ({ value: f, label: ROOM_WALL_FINISH_LABEL[f] }))];
type FloorChoice = 'default' | (typeof FLOOR_FINISHES)[number];
const floorOptions: { value: FloorChoice; label: string }[] = [{ value: 'default', label: 'Default (the slab)' }, ...FLOOR_FINISHES.map((f) => ({ value: f, label: FLOOR_FINISH_LABEL[f] }))];
/** A new wainscot's height: a common chair-rail height. */
const DEFAULT_WAINSCOT = 36;

/**
 * A room's interior finishes (DESIGN.md "Interior finishes"): its walls' finish and colour, a
 * wainscot, and its floor. Each is one undo step; "Default" clears it.
 */
function RoomFinishes({ levelId, room, wallHeight }: { levelId: Id; room: Room; wallHeight: number }) {
  const updateRoom = usePlanStore((s) => s.updateRoom);
  const set = (patch: RoomPatch) => updateRoom(levelId, room.id, patch);
  const wall = roomWallLookOf(room);
  const floor = floorLookOf(room);
  const w = room.wainscot;
  return (
    <>
      <SelectField
        label="Walls"
        value={wall?.finish ?? 'default'}
        options={roomWallOptions}
        onChange={(v) => set(v === 'default' ? { wallFinish: undefined, wallColor: undefined } : { wallFinish: v })}
      />
      {wall && (
        <ColorField
          label="Wall colour"
          value={wall.color}
          onCommit={(color) => set({ wallColor: color })}
          onReset={room.wallColor ? () => set({ wallColor: undefined }) : undefined}
          hint={wall.finish === 'check' ? 'The check, on a white ground.' : undefined}
        />
      )}
      <SelectField
        label="Wainscot"
        value={w?.finish ?? 'none'}
        options={wainscotOptions}
        onChange={(v) => set({ wainscot: v === 'none' ? undefined : { height: w?.height ?? Math.min(DEFAULT_WAINSCOT, wallHeight / 2), finish: v } })}
      />
      {w && (
        <>
          <LengthField
            label="Wainscot height"
            value={w.height}
            onCommit={(h) => {
              if (h === null) return;
              if (h >= wallHeight) return 'Must be lower than the ceiling.';
              set({ wainscot: { ...w, height: h } });
            }}
          />
          <ColorField
            label="Wainscot colour"
            value={w.color ?? ROOM_WALL_COLOR[w.finish]}
            onCommit={(color) => set({ wainscot: { ...w, color } })}
            onReset={w.color ? () => set({ wainscot: { height: w.height, finish: w.finish } }) : undefined}
          />
        </>
      )}
      <SelectField
        label="Floor"
        value={floor?.finish ?? 'default'}
        options={floorOptions}
        onChange={(v) => set(v === 'default' ? { floorFinish: undefined, floorColor: undefined } : { floorFinish: v })}
      />
      {floor && (
        <ColorField label="Floor colour" value={floor.color} onCommit={(color) => set({ floorColor: color })} onReset={room.floorColor ? () => set({ floorColor: undefined }) : undefined} />
      )}
      {(wall || w || floor) && <p className="panel-note">They dress the faces of the walls round the room, and its floor, in 3D; each wall keeps its own finish on its other side.</p>}
    </>
  );
}

const DIRECTION_OPTIONS: { value: string; label: string }[] = [
  { value: '0', label: 'Right (+x)' },
  { value: '90', label: 'Down (+y)' },
  { value: '180', label: 'Left (-x)' },
  { value: '270', label: 'Up (-y)' },
];

/** A piece's staircase, or a button making one of the stairway it is part of (stairChain.ts). */
function StaircaseMembership({ level, stairs }: { level: Level; stairs: Stairs }) {
  const groupStairs = usePlanStore((s) => s.groupStairs);
  const viewMode = useUiStore((s) => s.viewMode);
  const sc = stairs.staircaseId ? level.staircases?.[stairs.staircaseId] : undefined;
  const select = (id: Id) => {
    const ui = useUiStore.getState();
    ui.setOpenStaircase(null);
    ui.setSelection({ ...EMPTY_SELECTION, staircases: [id] });
  };
  if (sc) {
    return (
      <div className="panel-buttons">
        <button onClick={() => select(sc.id)} title="Select the whole staircase (Esc)">
          Select the staircase{sc.name ? ` (${sc.name})` : ''}
        </button>
      </div>
    );
  }
  return (
    <div className="panel-buttons">
      <button
        title="Join this piece and the pieces of the stairway it is part of into one staircase, selected, moved and styled together"
        onClick={() => {
          const chain = stairChains(usePlanStore.getState().plan, level.id, viewMode).find((c) => c.includes(stairs.id)) ?? [stairs.id];
          const id = groupStairs(level.id, chain);
          if (id) select(id);
        }}
      >
        Make one staircase
      </button>
    </div>
  );
}

const STRINGER_OPTIONS: { value: StairStringer; label: string }[] = [
  { value: 'closed', label: 'Closed (skirt boards)' },
  { value: 'open', label: 'Open (cut stringer)' },
];
const UNDERSIDE_OPTIONS: { value: StairUnderside; label: string }[] = [
  { value: 'solid', label: 'Solid to the floor' },
  { value: 'framed', label: 'Framed (room under it)' },
  { value: 'open', label: 'Open (stringers only)' },
];
const NEWEL_OPTIONS: { value: StairNewel; label: string }[] = [
  { value: 'box', label: 'Box newels, capped' },
  { value: 'square', label: 'Square posts' },
];
const HANDRAIL_OPTIONS: { value: StairHandrail; label: string }[] = [
  { value: 'round', label: 'Round, 2" (graspable)' },
  { value: 'board', label: 'Board, 3 1/2" (not graspable)' },
];
const START_OPTIONS: { value: StairStartStep; label: string }[] = [
  { value: 'square', label: 'Square' },
  { value: 'bullnose', label: 'Bullnose round the newel' },
];

/** A staircase's style (model/stairStyle.ts): each field at its default until set; Default clears it. */
function StaircaseStyleFields({ level, staircase }: { level: Level; staircase: Staircase }) {
  const updateStaircase = usePlanStore((s) => s.updateStaircase);
  const st = staircaseStyleOf(staircase);
  const set = (patch: StaircasePatch) => updateStaircase(level.id, staircase.id, patch);
  const length = (key: 'nosing' | 'treadThickness' | 'handrailHeight' | 'balusterGap', label: string, hint: string) => (
    <LengthField
      label={label}
      value={st[key]}
      bound="nonnegative"
      onCommit={(v) => {
        if (v === null) return null;
        const problem = staircaseFieldProblem(key, v);
        if (problem) return problem[0].toUpperCase() + problem.slice(1) + '.';
        set({ [key]: v });
        return null;
      }}
      hint={hint}
    />
  );
  return (
    <>
      <ColorField label="Treads" value={st.treadColor} onCommit={(treadColor) => set({ treadColor })} onReset={staircase.treadColor ? () => set({ treadColor: undefined }) : undefined} hint="Treads, handrail and newel caps." />
      <ColorField label="Risers" value={st.riserColor} onCommit={(riserColor) => set({ riserColor })} onReset={staircase.riserColor ? () => set({ riserColor: undefined }) : undefined} hint="Risers, skirts, balusters, newels and the underside." />
      {length('nosing', 'Nosing', 'How far each tread stands past the riser under it (3/4" to 1 1/4" on treads under 11").')}
      {length('treadThickness', 'Tread thickness', 'The tread boards.')}
      <SelectField label="Stringer" value={st.stringer} options={STRINGER_OPTIONS} onChange={(stringer) => set({ stringer })} />
      <SelectField label="Underside" value={st.underside} options={UNDERSIDE_OPTIONS} onChange={(underside) => set({ underside })} />
      <SelectField label="Newels" value={st.newel} options={NEWEL_OPTIONS} onChange={(newel) => set({ newel })} />
      <SelectField label="Handrail" value={st.handrail} options={HANDRAIL_OPTIONS} onChange={(handrail) => set({ handrail })} />
      {length('handrailHeight', 'Handrail height', 'Over the nosings: 34" to 38".')}
      {length('balusterGap', 'Baluster gap', 'The most room between balusters: under 4 3/8" on a stair.')}
      <SelectField label="First step" value={st.startStep} options={START_OPTIONS} onChange={(startStep) => set({ startStep })} />
    </>
  );
}

/**
 * A staircase (types.ts Staircase): its name, phase and style, its pieces (each one a button that
 * selects it alone), their issues, and ungrouping.
 */
function StaircaseProps({ level, staircase }: { level: Level; staircase: Staircase }) {
  const updateStaircase = usePlanStore((s) => s.updateStaircase);
  const ungroupStaircase = usePlanStore((s) => s.ungroupStaircase);
  const setPhase = usePlanStore((s) => s.setPhase);
  const ftf = usePlanStore((s) => floorToFloor(s.plan, level.id));
  const northAngle = usePlanStore((s) => s.plan.site.northAngle);
  const viewMode = useUiStore((s) => s.viewMode);
  const plan = usePlanStore((s) => s.plan);
  const chains = useMemo(() => stairChains(plan, level.id, viewMode), [plan, level.id, viewMode]);
  const pieces = Object.values(level.stairs).filter((st) => st.staircaseId === staircase.id);
  // In stairway order where they chain, the rest after.
  const order = chains.flat();
  pieces.sort((a, b) => (order.indexOf(a.id) + 1 || 1e9) - (order.indexOf(b.id) + 1 || 1e9));
  const phases = [...new Set(pieces.map((p) => p.phase))];
  const pieceName = (st: Stairs) => {
    const { risers } = flightSteps(st, ftf);
    return risers <= 1 ? `Landing at ${formatLength(stairsBase(st) + stairsRise(st, ftf))}` : `Flight up ${compassName(directionVector(st.direction), northAngle)}, ${risers} risers`;
  };
  return (
    <>
      <h3>Staircase</h3>
      <div className="field">
        <label htmlFor={`staircase-name-${staircase.id}`}>Name</label>
        <input
          id={`staircase-name-${staircase.id}`}
          aria-label="Name"
          defaultValue={staircase.name ?? ''}
          placeholder="none"
          onBlur={(e) => updateStaircase(level.id, staircase.id, { name: e.target.value.trim() || undefined })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') releaseFocus(e.currentTarget);
          }}
        />
      </div>
      {phases.length === 1 && (
        <SelectField
          label="Phase"
          value={phases[0]}
          options={phaseOptions}
          onChange={(phase) => setPhase(level.id, { walls: [], openings: [], staircases: [staircase.id] }, phase)}
        />
      )}
      <StaircaseStyleFields level={level} staircase={staircase} />
      <div className="field">
        <span className="label">Pieces</span>
      </div>
      <ul className="staircase-pieces">
        {pieces.map((st) => (
          <li key={st.id}>
            <button
              title="Select this piece alone (double-click it on the plan)"
              onClick={() => {
                const ui = useUiStore.getState();
                ui.setOpenStaircase(staircase.id);
                ui.setSelection({ ...EMPTY_SELECTION, stairs: [st.id] });
              }}
            >
              {pieceName(st)}
            </button>
          </li>
        ))}
      </ul>
      <IssueNotes levelId={level.id} target={{ stairs: pieces.map((p) => p.id) }} />
      <div className="panel-buttons">
        <button onClick={() => ungroupStaircase(level.id, staircase.id)} title="Back to separate flights and landings">
          Ungroup
        </button>
      </div>
      <p className="panel-note">Drag it on the plan to move every piece. Double-click a piece to edit it alone; Esc goes back to the staircase.</p>
    </>
  );
}

function StairsProps({ level, stairs }: { level: Level; stairs: Stairs }) {
  const updateStairs = usePlanStore((s) => s.updateStairs);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const ftf = usePlanStore((s) => floorToFloor(s.plan, level.id));
  const aboveName = usePlanStore((s) => {
    const i = s.plan.levelOrder.indexOf(level.id);
    return s.plan.levels[s.plan.levelOrder[i + 1]]?.name ?? null;
  });
  // Only the lowest level's flights may start below the floor (outdoor steps down a slope).
  const lowest = usePlanStore((s) => s.plan.levelOrder[0] === level.id);
  const base = stairsBase(stairs);
  const climb = stairsRise(stairs, ftf);
  const { risers, rise } = flightSteps(stairs, ftf);
  const ruleRisers = stairSteps(climb).risers;
  const tread = stairs.run / risers;
  // Base, climb and riser count, checked together (derive/stairs.ts stairsHeightProblem).
  const setHeights = (patch: Pick<Partial<Stairs>, 'base' | 'rise' | 'risers'>): string | null => {
    const problem = stairsHeightProblem({ ...stairs, ...patch }, ftf, lowest);
    if (problem) return problem[0].toUpperCase() + problem.slice(1) + ` (floor to floor here is ${formatLength(ftf, denom)}).`;
    updateStairs(level.id, stairs.id, patch);
    return null;
  };
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
      <LengthField
        label="Starts at"
        value={stairs.base}
        bound={lowest ? 'any' : 'nonnegative'}
        allowEmpty
        placeholder={`${formatLength(0, denom)} (the floor)`}
        onCommit={(v) => setHeights({ base: v ?? undefined })}
        hint={
          lowest
            ? 'Height of the bottom of the flight above the floor, e.g. on a landing; negative for outdoor steps that go on down a slope.'
            : 'Height of the bottom of the flight above the floor, e.g. on a landing.'
        }
      />
      <LengthField
        label="Climbs"
        value={stairs.rise}
        allowEmpty
        placeholder={`${formatLength(ftf - base, denom)} (to the floor above)`}
        onCommit={(v) => setHeights({ rise: v ?? undefined })}
        hint="Height the flight goes up. Blank climbs to the floor above."
      />
      <CountField
        label="Risers"
        value={stairs.risers}
        placeholder={`${ruleRisers} (about 7 1/2" each)`}
        onCommit={(v) => setHeights({ risers: v ?? undefined })}
        hint={`${risers} x ${formatLength(rise, denom)}. Blank follows the 7 1/2" rule; 1 makes a landing.`}
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
      <label className="check-row">
        <input
          type="checkbox"
          aria-label="Open"
          checked={!!stairs.open}
          onChange={(e) => {
            updateStairs(level.id, stairs.id, { open: e.target.checked ? true : undefined });
            releaseFocus(e.currentTarget);
          }}
        />
        Open (treads on stringers, for outdoor steps)
      </label>
      {(['left', 'right'] as const).map((side) => (
        <label key={side} className="check-row">
          <input
            type="checkbox"
            aria-label={`Railing on the ${side}`}
            checked={!!stairs.railings?.[side]}
            onChange={(e) => {
              updateStairs(level.id, stairs.id, { railings: { ...stairs.railings, [side]: e.target.checked } });
              releaseFocus(e.currentTarget);
            }}
          />
          Railing on the {side} (as you climb)
        </label>
      ))}
      {stairs.cutsFloorAbove && <StairsOpeningFields level={level} stairs={stairs} ftf={ftf} />}
      <IssueNotes levelId={level.id} target={{ stairs: [stairs.id] }} />
      <StaircaseMembership level={level} stairs={stairs} />
      <ReadOnly label="Step depth">{formatLength(tread, denom)}</ReadOnly>
      <p className="panel-note">
        {base !== 0 || stairs.rise !== undefined
          ? `Climbs ${formatLength(climb, denom)}, from ${formatLength(base, denom)} to ${formatLength(base + climb, denom)} above the floor (${formatLength(ftf, denom)} floor top to floor top).`
          : `Rises ${formatLength(ftf, denom)}, floor top to floor top.`}{' '}
        Drag with the select tool to move.
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
  const byRule = headroomHoleStart(stairs, ftf, level.wallHeight);
  const start = stairsHoleStart(stairs, ftf, level.wallHeight);
  const hole = stairsHoleOutline(stairs, ftf, level.wallHeight);
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

const fixtureKindOptions = FIXTURE_KINDS.map((k) => ({ value: k, label: FIXTURE_LABEL[k] }));
const frontStyleOptions = FRONT_STYLES.map((s) => ({ value: s, label: FRONT_STYLE_LABEL[s] }));
const FACING_OPTIONS: { value: string; label: string }[] = [
  { value: '0', label: 'Right (+x)' },
  { value: '90', label: 'Down (+y)' },
  { value: '180', label: 'Left (-x)' },
  { value: '270', label: 'Up (-y)' },
];

/** The fixture tool is active and nothing is selected: the kind the next click places. */
function FixtureToolProps() {
  const kind = useUiStore((s) => s.draft.fixtureKind);
  const def = FIXTURE_DEFAULTS[kind];
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  return (
    <>
      <h3>Cabinet tool</h3>
      <SelectField label="Kind" value={kind} options={fixtureKindOptions} onChange={(k) => setFixtureKind(makeToolContext(), k)} />
      <ReadOnly label="Stock size">
        {formatLength(def.width, denom)} wide, {formatLength(def.depth, denom)} deep, {formatLength(def.height, denom)} high
        {def.elevation > 0 ? `, bottom at ${formatLength(def.elevation, denom)}` : ''}
      </ReadOnly>
      <p className="panel-note">
        The {FIXTURE_LABEL[kind].toLowerCase()} follows the cursor with its back on the nearest wall and slides up to the last one placed.
        Click to place it; type a width first (36, 2'6) to change it. Hold Shift to place it away from the walls, Tab turns it. Edit the
        size, fronts and colour after placing by selecting it.
      </p>
    </>
  );
}

function FixtureProps({ level, fixture }: { level: Level; fixture: Fixture }) {
  const updateFixture = usePlanStore((s) => s.updateFixture);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const set = (patch: Partial<Fixture>) => updateFixture(level.id, fixture.id, patch);
  const dir = String(fixture.direction);
  const facing = FACING_OPTIONS.some((o) => o.value === dir) ? FACING_OPTIONS : [...FACING_OPTIONS, { value: dir, label: `${dir}°` }];
  const over = counterOverhangOf(fixture);
  const style = frontStyleOf(fixture, level.finishes);
  const color = frontColorOf(fixture, level.finishes);
  const heightChoices = fixture.kind === 'wall' ? WALL_CABINET_HEIGHTS : fixture.kind === 'tall' ? TALL_CABINET_HEIGHTS : null;
  return (
    <>
      <h3>{FIXTURE_LABEL[fixture.kind]}</h3>
      <SelectField
        label="Kind"
        value={fixture.kind}
        options={fixtureKindOptions}
        onChange={(kind) => {
          // A new kind brings its stock size unless the size was changed by hand.
          const old = FIXTURE_DEFAULTS[fixture.kind];
          const stock = fixture.width === old.width && fixture.depth === old.depth && fixture.height === old.height && fixture.elevation === old.elevation;
          set(stock ? { kind, ...FIXTURE_DEFAULTS[kind] } : { kind });
        }}
      />
      <LengthField label="Width" value={fixture.width} onCommit={(v) => void (v !== null && set({ width: v }))} hint="Along the wall." />
      <LengthField label="Depth" value={fixture.depth} onCommit={(v) => void (v !== null && set({ depth: v }))} hint="Back to front." />
      <LengthField
        label="Height"
        value={fixture.height}
        onCommit={(v) => void (v !== null && set({ height: v }))}
        hint={heightChoices ? `Usual: ${heightChoices.map((h) => formatLength(h, denom)).join(', ')}.` : hasCounter(fixture.kind) ? `The counter top sits at ${formatLength(counterTopOf(fixture), denom)}.` : undefined}
      />
      <LengthField
        label="Bottom"
        value={fixture.elevation}
        bound="nonnegative"
        onCommit={(v) => void (v !== null && set({ elevation: v }))}
        hint="Above the floor: 0 on the floor, 54 for a wall cabinet."
      />
      <SelectField label="Facing" value={dir} options={facing} onChange={(v) => set({ direction: Number(v) })} />
      <SelectField label="Phase" value={fixture.phase} options={phaseOptions} onChange={(p) => set({ phase: p })} />
      <div className="field">
        <label htmlFor={`fixture-label-${fixture.id}`}>Label</label>
        <input
          id={`fixture-label-${fixture.id}`}
          aria-label="Label"
          defaultValue={fixture.label ?? ''}
          placeholder={fixture.kind === 'box' ? 'BOX' : 'none'}
          onBlur={(e) => set({ label: e.target.value.trim() || undefined })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') releaseFocus(e.currentTarget);
          }}
        />
      </div>
      {isCabinet(fixture.kind) || fixture.kind === 'wallOven' ? (
        <>
          <SelectField label="Fronts" value={style} options={frontStyleOptions} onChange={(s) => set({ frontStyle: s })} />
          <ColorField
            label="Front colour"
            value={color}
            onCommit={(c) => set({ frontColor: c })}
            onReset={fixture.frontColor || fixture.frontStyle ? () => set({ frontColor: undefined, frontStyle: undefined }) : undefined}
            hint="Blank fields follow the level's casework defaults."
          />
        </>
      ) : null}
      {hasCounter(fixture.kind) && (
        <>
          <ReadOnly label="Counter top">{formatLength(counterTopOf(fixture), denom)}</ReadOnly>
          {(['front', 'back', 'left', 'right'] as const).map((side) => (
            <LengthField
              key={side}
              label={`Overhang ${side}`}
              value={over[side]}
              bound="nonnegative"
              onCommit={(v) => void (v !== null && set({ counterOverhang: { ...over, [side]: v } }))}
            />
          ))}
        </>
      )}
      <p className="panel-note">Drag with the select tool to move. Touching counter cabinets share one counter top.</p>
    </>
  );
}

/** A level's casework defaults: the cabinet and counter colours and the front style its fixtures use unless they set their own. */
function CaseworkDefaults({ level }: { level: Level }) {
  const updateFinishes = usePlanStore((s) => s.updateFinishes);
  const f = level.finishes;
  const count = Object.keys(level.fixtures ?? {}).length;
  return (
    <>
      <ColorField
        label="Cabinet colour"
        value={f?.cabinetColor ?? DEFAULT_CABINET_COLOR}
        onCommit={(c) => updateFinishes(level.id, { cabinetColor: c })}
        onReset={f?.cabinetColor ? () => updateFinishes(level.id, { cabinetColor: undefined }) : undefined}
      />
      <ColorField
        label="Counter colour"
        value={counterColorOf(f)}
        onCommit={(c) => updateFinishes(level.id, { counterColor: c })}
        onReset={f?.counterColor ? () => updateFinishes(level.id, { counterColor: undefined }) : undefined}
        hint={f?.counterColor === undefined ? `Default ${DEFAULT_COUNTER_COLOR}.` : undefined}
      />
      <SelectField label="Cabinet fronts" value={(f?.frontStyle ?? 'slab') as FrontStyle} options={frontStyleOptions} onChange={(s) => updateFinishes(level.id, { frontStyle: s })} />
      <ReadOnly label="Fixtures">{count}</ReadOnly>
    </>
  );
}

const roofShapeOptions = (['gable', 'shed', 'hip', 'flat'] as const).map((v) => ({ value: v, label: ROOF_SHAPE_LABEL[v] }));
const roofFinishOptions: { value: RoofFinish; label: string }[] = [
  { value: 'metal', label: 'Corrugated metal' },
  { value: 'seam', label: 'Standing seam metal' },
  { value: 'shingle', label: 'Shingle' },
];
const roofEaveOptions = ROOF_EAVES.map((e) => ({ value: e, label: ROOF_EAVE_LABEL[e] }));

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
  const open = roofEaveOf(roof) === 'open';
  const rafter = rafterOf(roof);
  // The default rafter is stored as no field, so a file only carries what was changed.
  const setRafter = (patch: Partial<{ depth: number; spacing: number }>) => {
    const next = { ...rafter, ...patch };
    set({ rafter: next.depth === DEFAULT_RAFTER.depth && next.spacing === DEFAULT_RAFTER.spacing ? undefined : next });
  };
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
      <SelectField label="Eaves" value={roofEaveOf(roof)} options={roofEaveOptions} onChange={(eave) => set({ eave: eave === 'fascia' ? undefined : eave })} />
      {open && (
        <>
          <LengthField label="Rafter depth" value={rafter.depth} onCommit={(v) => void (v !== null && setRafter({ depth: v }))} hint="The tails hang this far below the roof's underside." />
          <LengthField
            label="Rafter spacing"
            value={rafter.spacing}
            onCommit={(v) => {
              if (v === null) return null;
              if (v < 2 * RAFTER_WIDTH) return `At least ${formatLength(2 * RAFTER_WIDTH, denom)} (the tails are ${formatLength(RAFTER_WIDTH, denom)} wide).`;
              setRafter({ spacing: v });
              return null;
            }}
            hint="On centre, along the eave."
          />
        </>
      )}
      <LengthField
        label="Fascia"
        value={roof.fascia}
        bound="nonnegative"
        onCommit={(v) => void (v !== null && set({ fascia: v }))}
        hint={open ? 'Depth of the rake boards (open eaves have no fascia).' : 'Depth of the fascia and rake boards.'}
      />
      <ColorField
        label="Board colour"
        value={boardColorOf(roof)}
        onCommit={(boardColor) => set({ boardColor })}
        onReset={roof.boardColor ? () => set({ boardColor: undefined }) : undefined}
        hint={`Fascia, rake boards and rafter tails. Default tan ${TRIM_COLOR}.`}
      />
      <SelectField label="Finish" value={roof.finish} options={roofFinishOptions} onChange={(finish) => set({ finish })} />
      <ColorField
        label="Colour"
        value={roofColorOf(roof)}
        onCommit={(color) => set({ color })}
        onReset={roof.color ? () => set({ color: undefined }) : undefined}
        hint={`Default for ${roof.finish}: ${ROOF_COLOR[roof.finish]}.`}
      />
      {roof.finish === 'metal' && (
        <NumberField
          label="Weathering"
          value={weatheringOf(roof)}
          check={(v) => (v < 0 || v > 1 ? 'Between 0 and 1.' : null)}
          onCommit={(weathering) => set({ weathering })}
          hint={`Rust streaks, 0 (none) to 1. Default ${DEFAULT_WEATHERING}.`}
        />
      )}
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

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A deck (DESIGN.md "Decks"): its top against the floor, a railing checkbox per edge (named by the
 * way it faces, with its length and how high it stands over the ground, or that a wall backs it), a
 * warning for an open edge more than 30" up, the colour and phase, and what it comes to.
 */
/**
 * The code checks about an element (derive/checks.ts, judged in the proposed view), as warnings
 * under its fields; each one's code section beside it.
 */
function IssueNotes({ levelId, target }: { levelId: Id; target: IssueTarget }) {
  const issues = useUiStore(useShallow((s) => issuesFor(s.issues, levelId, target)));
  return (
    <>
      {issues.map((i) => (
        <p key={i.id} className={`panel-note warning severity-${i.severity}`}>
          {i.message} <span className="check-ref">{i.ref}</span>
        </p>
      ))}
    </>
  );
}

function DeckProps({ level, deck }: { level: Level; deck: Deck }) {
  const updateDeck = usePlanStore((s) => s.updateDeck);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const northAngle = usePlanStore((s) => s.plan.site.northAngle);
  const floorTop = usePlanStore((s) => getLevelElevations(s.plan)[level.id]?.floorTop ?? 0);
  const viewMode = useUiStore((s) => s.viewMode);
  const layout = usePlanStore((s) => getDeckLayout(s.plan, level.id, deck.id, viewMode));
  const set = (patch: DeckPatch) => updateDeck(level.id, deck.id, patch);
  const n = deck.outline.length;
  const lens = deck.outline.map((p, i) => dist(p, deck.outline[(i + 1) % n]));
  const names = deck.outline.map((_, i) => compassName(edgeOutward(deck.outline, i), northAngle));
  const b = boundsOf(deck.outline);
  return (
    <>
      <h3>Deck</h3>
      <LengthField
        label="Top"
        value={deck.elevation}
        bound="any"
        onCommit={(v) => {
          if (v === null) return null;
          if (Math.abs(v) > MAX_DECK_ELEVATION) return `Keep it within ${formatLength(MAX_DECK_ELEVATION, denom)} of the floor.`;
          set({ elevation: v });
          return null;
        }}
        hint={`Above this level's floor top; negative is below it (${deckTopWords(deck.elevation, denom)}, elevation ${formatLength(floorTop + deck.elevation, denom)}).`}
      />
      <div className="field">
        <span className="label">Railings</span>
      </div>
      {deck.outline.map((_, i) => (
        <label key={i} className="check-row">
          <input
            type="checkbox"
            aria-label={`Railing on the ${names[i]} edge`}
            checked={deck.railings[i]}
            onChange={(e) => {
              set({ railings: deck.railings.map((r, j) => (j === i ? e.target.checked : r)) });
              releaseFocus(e.currentTarget);
            }}
          />
          {capitalize(names[i])} edge, {formatLength(lens[i], denom)}
          {layout && (layout.supported[i] ? ', against a wall' : `, ${formatLength(Math.max(0, layout.edgeDrops[i]), denom)} above the ground`)}
        </label>
      ))}
      <IssueNotes levelId={level.id} target={{ decks: [deck.id] }} />
      {layout && (
        <div className="panel-buttons">
          <button onClick={() => set({ railings: layout.supported.map((s) => !s) })} title="A railing on every edge that no wall backs">
            Reset railings
          </button>
        </div>
      )}
      <ColorField label="Colour" value={deckColorOf(deck)} onCommit={(color) => set({ color })} onReset={deck.color ? () => set({ color: undefined }) : undefined} hint={`Boards, framing and railing. Default ${DECK_COLOR}.`} />
      <SelectField label="Phase" value={deck.phase} options={phaseOptions} onChange={(phase) => set({ phase })} />
      {b && (
        <ReadOnly label="Outline">
          {n} corners, {formatLength(b.maxX - b.minX, denom)} x {formatLength(b.maxY - b.minY, denom)}, {formatArea(Math.abs(polygonSignedArea(deck.outline)))}
        </ReadOnly>
      )}
      {layout && (
        <ReadOnly label="Posts">
          {layout.posts.length} to the ground{layout.openings.length ? `; ${layout.openings.length} ${layout.openings.length === 1 ? 'stair opening' : 'stair openings'} in the railing` : ''}
        </ReadOnly>
      )}
      <p className="panel-note">
        Drag a corner with the select tool to move it. A flight of stairs drawn up to an edge (its top within 8" below the boards) opens the railing there.
      </p>
    </>
  );
}

function FloorOpeningProps({ level, opening }: { level: Level; opening: FloorOpening }) {
  const updateFloorOpening = usePlanStore((s) => s.updateFloorOpening);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const northAngle = usePlanStore((s) => s.plan.site.northAngle);
  const viewMode = useUiStore((s) => s.viewMode);
  const layout = usePlanStore((s) => getFloorOpeningLayout(s.plan, level.id, opening.id, viewMode));
  const set = (patch: FloorOpeningPatch) => updateFloorOpening(level.id, opening.id, patch);
  const n = opening.outline.length;
  const lens = opening.outline.map((p, i) => dist(p, opening.outline[(i + 1) % n]));
  const names = opening.outline.map((_, i) => compassName(edgeOutward(opening.outline, i), northAngle));
  const b = boundsOf(opening.outline);
  return (
    <>
      <h3>Floor opening</h3>
      <p className="panel-note">A hole in this level's floor, open to the level below.</p>
      <div className="field">
        <span className="label">Guards</span>
      </div>
      {opening.outline.map((_, i) => (
        <label key={i} className="check-row">
          <input
            type="checkbox"
            aria-label={`Guard on the ${names[i]} edge`}
            checked={opening.railings[i]}
            disabled={!!layout?.supported[i]}
            onChange={(e) => {
              set({ railings: opening.railings.map((r, j) => (j === i ? e.target.checked : r)) });
              releaseFocus(e.currentTarget);
            }}
          />
          {capitalize(names[i])} edge, {formatLength(lens[i], denom)}
          {layout?.supported[i] ? ', along a wall' : ''}
        </label>
      ))}
      <IssueNotes levelId={level.id} target={{ floorOpenings: [opening.id] }} />
      {layout && (
        <div className="panel-buttons">
          <button onClick={() => set({ railings: layout.supported.map((s) => !s) })} title="A guard on every edge that no wall runs along">
            Reset guards
          </button>
        </div>
      )}
      <SelectField label="Phase" value={opening.phase} options={phaseOptions} onChange={(phase) => set({ phase })} />
      {b && (
        <ReadOnly label="Outline">
          {n} corners, {formatLength(b.maxX - b.minX, denom)} x {formatLength(b.maxY - b.minY, denom)}, {formatArea(Math.abs(polygonSignedArea(opening.outline)))}
        </ReadOnly>
      )}
      {layout && layout.openings.length > 0 && (
        <ReadOnly label="Stairs">
          {layout.openings.length} {layout.openings.length === 1 ? 'flight arrives' : 'flights arrive'} at an edge; the guard is open there
        </ReadOnly>
      )}
      <p className="panel-note">
        Drag a corner with the select tool to move it. A flight from the level below whose top is one riser under this floor at an edge opens the guard there.
      </p>
    </>
  );
}

const mountOptions: { value: Beam['mount']; label: string }[] = [
  { value: 'flush', label: 'Flush (in the floor framing)' },
  { value: 'dropped', label: 'Dropped (under the ceiling)' },
];

/** A member's or zone's label: commits on blur or Enter; blank clears it. */
function LabelField({ id, value, placeholder, onCommit }: { id: string; value: string | undefined; placeholder: string; onCommit: (v: string | undefined) => void }) {
  return (
    <div className="field">
      <label htmlFor={`label-${id}`}>Label</label>
      <input
        id={`label-${id}`}
        key={value ?? ''}
        aria-label="Label"
        defaultValue={value ?? ''}
        placeholder={placeholder}
        onBlur={(e) => onCommit(e.target.value.trim() || undefined)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') releaseFocus(e.currentTarget);
        }}
      />
    </div>
  );
}

/** A beam or a post (DESIGN.md "Structure"): sizes are placeholders for the engineer. */
function MemberProps({ level, member }: { level: Level; member: Member }) {
  const updateMember = usePlanStore((s) => s.updateMember);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const plan = usePlanStore((s) => s.plan);
  const viewMode = useUiStore((s) => s.viewMode);
  const lowest = plan.levelOrder[0] === level.id;
  const set = (patch: MemberPatch) => updateMember(level.id, member.id, patch);
  const boxes = memberBoxes(plan, level.id, member, viewMode);
  const size = (key: 'width' | 'depth', label: string, hint: string) => (
    <LengthField label={label} value={member[key]} onCommit={(v) => void (v !== null && set({ [key]: v }))} hint={hint} />
  );
  const timber = isTimber(member);
  const log = isLog(member);
  // A round log: its width is its diameter (the depth follows it), drawn round in 3D and, as a post, on the plan.
  const logField = (
    <label className="check-row">
      <input
        type="checkbox"
        aria-label="Round log"
        checked={log}
        onChange={(e) => {
          set(e.target.checked ? { profile: 'log', depth: member.width } : { profile: undefined });
          releaseFocus(e.currentTarget);
        }}
      />
      Round log (its width is the diameter)
    </label>
  );
  const diameter = size('width', 'Diameter', 'Across the log.');
  // A timber at set heights: a sloped or freestanding member the checks do not follow (a gable's truss).
  const timberFields = (
    <>
      <label className="check-row">
        <input
          type="checkbox"
          aria-label="Set heights"
          checked={timber}
          onChange={(e) => {
            const on = e.target.checked;
            if (member.kind === 'beam') set(on ? { za: boxes.body.top, zb: boxes.body.top } : { za: undefined, zb: undefined, color: undefined });
            else set(on ? { base: boxes.body.bottom, top: boxes.body.top, footing: undefined } : { base: undefined, top: undefined, color: undefined });
            releaseFocus(e.currentTarget);
          }}
        />
        Set heights (a timber: drawn as set, not followed by the checks)
      </label>
      {timber && member.kind === 'beam' && (
        <>
          <LengthField label="Top at its first end" value={member.za} bound="any" onCommit={(v) => void (v !== null && set({ za: v }))} hint="Over this level's floor." />
          <LengthField label="Top at its other end" value={member.zb} bound="any" onCommit={(v) => void (v !== null && set({ zb: v }))} hint="It slopes between the two; its depth is square to it." />
        </>
      )}
      {timber && member.kind === 'post' && (
        <>
          <LengthField label="Base" value={member.base} bound="any" onCommit={(v) => void (v !== null && set({ base: v }))} hint="Over this level's floor." />
          <LengthField label="Top" value={member.top} bound="any" onCommit={(v) => void (v !== null && set({ top: v }))} />
        </>
      )}
      {timber && (
        <ColorField
          label="Colour"
          value={member.color ?? (member.kind === 'beam' ? MEMBER_COLOR.beam : MEMBER_COLOR.post)}
          onCommit={(color) => set({ color })}
          onReset={member.color ? () => set({ color: undefined }) : undefined}
          hint="A timber left showing, e.g. in the stain."
        />
      )}
    </>
  );
  if (member.kind === 'beam') {
    const h = timber ? { bottom: boxes.body.bottom, top: boxes.body.top } : beamHeights(plan, level.id, member);
    return (
      <>
        <h3>{timber ? 'Timber' : 'Beam'}</h3>
        <LabelField id={member.id} value={member.label} placeholder={MEMBER_DEFAULTS.beam.label} onCommit={(label) => set({ label })} />
        {logField}
        {log ? (
          diameter
        ) : (
          <>
            {size('width', 'Width', timber ? 'Across it.' : 'Across the beam: 3 1/2" for two 1 3/4" LVLs.')}
            {size('depth', 'Depth', timber ? 'Square to it.' : 'Top to bottom.')}
          </>
        )}
        {!timber && <SelectField label="Mount" value={member.mount} options={mountOptions} onChange={(mount) => set({ mount })} />}
        {timberFields}
        <SelectField label="Phase" value={member.phase} options={phaseOptions} onChange={(phase) => set({ phase })} />
        <ReadOnly label="Length">{formatLength(dist(member.a, member.b), denom)}{timber ? ' in plan' : ''}</ReadOnly>
        <ReadOnly label="Over the floor">
          {formatLength(h.bottom, denom)} to {formatLength(h.top, denom)}
          {!timber && member.mount === 'flush' && h.bottom < level.wallHeight ? `, ${formatLength(level.wallHeight - h.bottom, denom)} below the ceiling` : ''}
        </ReadOnly>
        <IssueNotes levelId={level.id} target={{ members: [member.id] }} />
        <p className="panel-note">
          {timber
            ? 'A timber at set heights: it slopes from one end to the other and may stand above the ceiling (a truss in a gable). The structure checks do not follow it.'
            : "A placeholder size for the engineer to set. A flush beam sits in the floor framing over this level, its top at the joists' top; a dropped one hangs under the ceiling. Drag an end with the select tool to move it."}
        </p>
      </>
    );
  }
  return (
    <>
      <h3>Post</h3>
      <LabelField id={member.id} value={member.label} placeholder={MEMBER_DEFAULTS.post.label} onCommit={(label) => set({ label })} />
      {logField}
      {log ? (
        diameter
      ) : (
        <>
          {size('width', 'Width', 'Along the plan x axis before rotation.')}
          {size('depth', 'Depth', 'Along the plan y axis before rotation.')}
          <NumberField label="Rotation" value={member.rotation} onCommit={(v) => set({ rotation: v })} hint="Degrees, clockwise on the plan." />
        </>
      )}
      <SelectField label="Phase" value={member.phase} options={phaseOptions} onChange={(phase) => set({ phase })} />
      {timberFields}
      {lowest && !timber && (
        <>
          <label className="check-row">
            <input
              type="checkbox"
              aria-label="Footing"
              checked={!!member.footing}
              onChange={(e) => {
                set({ footing: e.target.checked ? { ...MEMBER_DEFAULTS.footing } : undefined });
                releaseFocus(e.currentTarget);
              }}
            />
            On a concrete footing under the slab
          </label>
          {member.footing && (
            <>
              <LengthField label="Footing width" value={member.footing.width} onCommit={(v) => void (v !== null && set({ footing: { ...member.footing!, width: v } }))} hint="A square pad." />
              <LengthField label="Footing thickness" value={member.footing.thickness} onCommit={(v) => void (v !== null && set({ footing: { ...member.footing!, thickness: v } }))} />
            </>
          )}
        </>
      )}
      <ReadOnly label="Height">
        {formatLength(boxes.body.top - boxes.body.bottom, denom)}
        {timber ? '' : `, up to ${boxes.body.top < level.wallHeight ? 'the beam over it' : 'the ceiling'}`}
      </ReadOnly>
      <ReadOnly label="Position">
        x {formatLength(member.at.x, denom)}, y {formatLength(member.at.y, denom)}
      </ReadOnly>
      <IssueNotes levelId={level.id} target={{ members: [member.id] }} />
      <p className="panel-note">A placeholder size for the engineer to set. Drag it with the select tool to move it.</p>
    </>
  );
}

/** The joist axis as a choice: north-south, east-west or another angle (plan degrees). */
function joistOptions(current: number | null, northAngle: number): { value: string; label: string }[] {
  const ns = String(normalizeJoists(90 + northAngle));
  const ew = String(normalizeJoists(northAngle));
  const out = [
    { value: ns, label: 'North-south' },
    { value: ew, label: 'East-west' },
  ];
  if (current !== null && String(current) !== ns && String(current) !== ew) out.push({ value: String(current), label: `${joistWords(current, northAngle)} on the plan` });
  return out;
}

function JoistZoneProps({ level, zone }: { level: Level; zone: JoistZone }) {
  const updateJoistZone = usePlanStore((s) => s.updateJoistZone);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const northAngle = usePlanStore((s) => s.plan.site.northAngle);
  const set = (patch: JoistZonePatch) => updateJoistZone(level.id, zone.id, patch);
  const b = boundsOf(zone.outline);
  return (
    <>
      <h3>Joist zone</h3>
      <p className="panel-note">An area over this level whose joists run another way than the level's (a part built in another stage).</p>
      <SelectField label="Joists" value={String(zone.joists)} options={joistOptions(zone.joists, northAngle)} onChange={(v) => set({ joists: Number(v) })} />
      <NumberField label="Joist angle" value={zone.joists} onCommit={(v) => set({ joists: v })} hint="Degrees on the plan, 0 along x." />
      <SelectField label="Phase" value={zone.phase} options={phaseOptions} onChange={(phase) => set({ phase })} />
      {b && (
        <ReadOnly label="Outline">
          {zone.outline.length} corners, {formatLength(b.maxX - b.minX, denom)} x {formatLength(b.maxY - b.minY, denom)}
        </ReadOnly>
      )}
      <IssueNotes levelId={level.id} target={{ joistZones: [zone.id] }} />
      <p className="panel-note">Drag a corner with the select tool to move it. Y shows the joists on the plan.</p>
    </>
  );
}

/** The Level panel's framing: the joists over this level, their depth, and joist zones. */
function LevelFramingFields({ level }: { level: Level }) {
  const setLevelFraming = usePlanStore((s) => s.setLevelFraming);
  const northAngle = usePlanStore((s) => s.plan.site.northAngle);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const derivedDepth = usePlanStore((s) => {
    const l = s.plan.levels[level.id];
    return l ? joistDepth({ ...s.plan, levels: { ...s.plan.levels, [level.id]: { ...l, framing: undefined } } }, level.id) : 0;
  });
  const f = level.framing;
  const zones = Object.keys(level.joistZones ?? {}).length;
  const options = [{ value: '', label: 'Not set' }, ...joistOptions(f ? f.joists : null, northAngle)];
  return (
    <>
      <SelectField
        label="Joists over this level"
        value={f ? String(f.joists) : ''}
        options={options}
        onChange={(v) => setLevelFraming(level.id, v === '' ? undefined : { joists: Number(v), ...(f?.depth !== undefined ? { depth: f.depth } : {}) })}
      />
      {f && (
        <LengthField
          label="Joist depth"
          value={f.depth}
          allowEmpty
          placeholder={`from the floor above (${formatLength(derivedDepth, denom)})`}
          onCommit={(v) => setLevelFraming(level.id, { joists: f.joists, ...(v !== null ? { depth: v } : {}) })}
          hint={'Blank: the floor thickness above less the 3/4" subfloor (an attic: 5 1/2").'}
        />
      )}
      <div className="panel-buttons">
        <button onClick={() => switchTool('joistZone')} title="Click the corners of an area over this level framed another way">
          Draw a joist zone
        </button>
      </div>
      {zones > 0 && <ReadOnly label="Joist zones">{zones}</ReadOnly>}
    </>
  );
}

const bearingOptions: { value: 'auto' | 'yes' | 'no'; label: string }[] = [
  { value: 'auto', label: 'Auto (inferred)' },
  { value: 'yes', label: 'Bearing' },
  { value: 'no', label: 'Not bearing' },
];

const columnKindOptions: { value: Column['kind']; label: string }[] = [
  { value: 'chimney', label: 'Chimney' },
  { value: 'post', label: 'Post' },
  { value: 'flue', label: 'Flue (round metal pipe)' },
  { value: 'pier', label: 'Pier (fieldstone)' },
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
      <h3>{COLUMN_KIND_NAME[column.kind]}</h3>
      <SelectField label="Kind" value={column.kind} options={columnKindOptions} onChange={(kind) => updateColumn(column.id, { kind })} />
      {column.kind === 'flue' ? (
        length('width', 'Diameter', 'positive', 'Outside diameter of the pipe (an insulated 6" chimney pipe is about 8").')
      ) : (
        <>
          {length('width', 'Width', 'positive', 'Along the plan x axis before rotation.')}
          {length('depth', 'Depth', 'positive', 'Along the plan y axis before rotation.')}
          <NumberField label="Rotation" value={column.rotation} onCommit={(v) => updateColumn(column.id, { rotation: v })} hint="Degrees, clockwise on the plan." />
        </>
      )}
      {length('base', 'Base', 'any', 'Bottom, as an elevation (the ground here is shown below).')}
      {length('top', 'Top', 'any', column.kind === 'chimney' && column.cap ? 'Top of the cap, as an elevation; the spark arrestor stands 12" above it.' : column.kind === 'flue' && column.cap ? 'Top of the pipe, as an elevation; the rain cap is 3" above it.' : 'Top, as an elevation.')}
      <ColorField
        label="Colour"
        value={columnColorOf(column)}
        onCommit={(color) => updateColumn(column.id, { color })}
        onReset={column.color ? () => updateColumn(column.id, { color: undefined }) : undefined}
        hint={`Default for a ${column.kind}: ${COLUMN_COLOR[column.kind]}.${column.kind === 'chimney' ? ' The 3D view draws it as brick.' : column.kind === 'flue' ? ' The 3D view draws it as metal.' : column.kind === 'pier' ? ' The 3D view draws it as fieldstone.' : ''}`}
      />
      {column.kind === 'chimney' && (
        <label className="check-row">
          <input
            type="checkbox"
            aria-label="Cap and spark arrestor"
            checked={!!column.cap}
            onChange={(e) => {
              updateColumn(column.id, { cap: e.target.checked ? true : undefined });
              releaseFocus(e.currentTarget);
            }}
          />
          Cap and spark arrestor (a 4" concrete cap, a 12" wire box above it)
        </label>
      )}
      {column.kind === 'flue' && (
        <label className="check-row">
          <input
            type="checkbox"
            aria-label="Rain cap"
            checked={!!column.cap}
            onChange={(e) => {
              updateColumn(column.id, { cap: e.target.checked ? true : undefined });
              releaseFocus(e.currentTarget);
            }}
          />
          Rain cap (a disc twice the pipe's width, 3" above its top)
        </label>
      )}
      <SelectField label="Phase" value={column.phase} options={phaseOptions} onChange={(phase) => updateColumn(column.id, { phase })} />
      <ReadOnly label="Height">{formatLength(column.top - column.base, denom)}</ReadOnly>
      <ReadOnly label="Position">
        x {formatLength(column.at.x, denom)}, y {formatLength(column.at.y, denom)}
      </ReadOnly>
      <div className="panel-buttons">
        <button
          onClick={resetHeights}
          title={
            column.kind === 'chimney'
              ? 'Base 12" below the ground here, top 48" above the highest ridge'
              : column.kind === 'flue'
                ? 'Base 30" over the first floor (a stove top), top 24" above the highest ridge'
                : column.kind === 'pier'
                  ? 'Base on the ground here, top at the first floor'
                  : 'Base on the ground here, top at the lowest roof underside over it'
          }
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
  fixtures,
  decks,
  floorOpenings,
  members,
  joistZones,
  columns,
  rooms,
}: {
  levelId: Id;
  sel: Selection;
  walls: Wall[];
  openings: Opening[];
  stairs: Stairs[];
  roofs: Roof[];
  fixtures: Fixture[];
  decks: Deck[];
  floorOpenings: FloorOpening[];
  members: Member[];
  joistZones: JoistZone[];
  columns: Column[];
  rooms: Room[];
}) {
  const setPhase = usePlanStore((s) => s.setPhase);
  const updateFixture = usePlanStore((s) => s.updateFixture);
  const parts: string[] = [];
  if (walls.length) parts.push(`${walls.length} ${walls.length === 1 ? 'wall' : 'walls'}`);
  if (openings.length) parts.push(`${openings.length} ${openings.length === 1 ? 'opening' : 'openings'}`);
  if (sel.staircases.length) parts.push(`${sel.staircases.length} ${sel.staircases.length === 1 ? 'staircase' : 'staircases'}`);
  const loose = stairs.filter((st) => !st.staircaseId || !sel.staircases.includes(st.staircaseId)).length;
  if (loose) parts.push(`${loose} stairs`);
  if (roofs.length) parts.push(`${roofs.length} ${roofs.length === 1 ? 'roof' : 'roofs'}`);
  if (fixtures.length) parts.push(`${fixtures.length} ${fixtures.length === 1 ? 'fixture' : 'fixtures'}`);
  if (decks.length) parts.push(`${decks.length} ${decks.length === 1 ? 'deck' : 'decks'}`);
  if (floorOpenings.length) parts.push(`${floorOpenings.length} ${floorOpenings.length === 1 ? 'floor opening' : 'floor openings'}`);
  const beams = members.filter((m) => m.kind === 'beam').length;
  if (beams) parts.push(`${beams} ${beams === 1 ? 'beam' : 'beams'}`);
  if (members.length - beams) parts.push(`${members.length - beams} ${members.length - beams === 1 ? 'post' : 'posts'}`);
  if (joistZones.length) parts.push(`${joistZones.length} joist ${joistZones.length === 1 ? 'zone' : 'zones'}`);
  if (columns.length) parts.push(`${columns.length} ${columns.length === 1 ? 'column' : 'columns'}`);
  if (sel.gradePoints.length) parts.push(`${sel.gradePoints.length} grade ${sel.gradePoints.length === 1 ? 'point' : 'points'}`);
  if (sel.nodes.length) parts.push(`${sel.nodes.length} ${sel.nodes.length === 1 ? 'corner' : 'corners'}`);
  if (sel.rooms.length) parts.push(`${sel.rooms.length} ${sel.rooms.length === 1 ? 'room' : 'rooms'}`);
  const phases = phasesOf([...walls, ...openings, ...stairs, ...roofs, ...fixtures, ...decks, ...floorOpenings, ...members, ...joistZones, ...columns, ...rooms]);
  const onlyFixtures = fixtures.length > 0 && phases.length === fixtures.length;
  const groupStairs = usePlanStore((s) => s.groupStairs);
  return (
    <>
      <h3>{parts.join(', ')}</h3>
      {stairs.length >= 2 && (
        <div className="panel-buttons">
          <button
            title="Join the selected flights and landings into one staircase, selected, moved and styled together"
            onClick={() => {
              const id = groupStairs(levelId, stairs.map((st) => st.id));
              if (id) useUiStore.getState().setSelection({ ...EMPTY_SELECTION, staircases: [id] });
            }}
          >
            Make one staircase
          </button>
        </div>
      )}
      {phases.length > 0 && (
        <SelectField
          label="Phase"
          value={common(phases, (p) => p)}
          options={phaseOptions}
          onChange={(p) =>
            setPhase(
              levelId,
              {
                walls: walls.map((w) => w.id),
                openings: openings.map((o) => o.id),
                stairs: stairs.map((st) => st.id),
                roofs: roofs.map((r) => r.id),
                fixtures: fixtures.map((f) => f.id),
                decks: decks.map((d) => d.id),
                floorOpenings: floorOpenings.map((o) => o.id),
                members: members.map((m) => m.id),
                joistZones: joistZones.map((z) => z.id),
                columns: columns.map((c) => c.id),
                rooms: rooms.map((r) => r.id),
              },
              p,
            )
          }
        />
      )}
      {onlyFixtures && (
        <>
          <SelectField
            label="Fronts"
            value={common(fixtures, (f) => f.frontStyle ?? null)}
            options={frontStyleOptions}
            onChange={(s) => fixtures.forEach((f) => updateFixture(levelId, f.id, { frontStyle: s }))}
          />
          <ColorField
            label="Front colour"
            value={common(fixtures, (f) => f.frontColor ?? DEFAULT_CABINET_COLOR) ?? DEFAULT_CABINET_COLOR}
            onCommit={(c) => fixtures.forEach((f) => updateFixture(levelId, f.id, { frontColor: c }))}
            onReset={fixtures.some((f) => f.frontColor || f.frontStyle) ? () => fixtures.forEach((f) => updateFixture(levelId, f.id, { frontColor: undefined, frontStyle: undefined })) : undefined}
          />
        </>
      )}
      {phases.length === 0 && <p className="panel-note">{sel.gradePoints.length ? 'Drag grade points with the select tool to move them.' : 'Drag corners with the select tool to move them.'}</p>}
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
 * An optional whole number (blank: the default, shown as the placeholder): commits on Enter or blur,
 * Escape reverts; blank clears a set value (onCommit(null)). `onCommit` returns an error or null.
 */
function CountField({
  label,
  value,
  placeholder,
  hint,
  onCommit,
}: {
  label: string;
  value: number | undefined;
  placeholder?: string;
  hint?: ReactNode;
  onCommit: (v: number | null) => string | null;
}) {
  const fmt = (v: number | undefined) => (v === undefined ? '' : String(v));
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
    const t = text.trim();
    if (t === '') {
      if (value === undefined) return true;
      const err = onCommit(null);
      setError(err);
      return !err;
    }
    const v = Number(t);
    if (!Number.isInteger(v) || v < 1) {
      setError('Enter a whole number, at least 1.');
      return false;
    }
    if (v === value) return true;
    const err = onCommit(v);
    setError(err);
    return !err;
  };
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-label={label}
        aria-invalid={!!error}
        inputMode="numeric"
        value={text}
        placeholder={placeholder}
        autoComplete="off"
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

type SidingChoice = 'default' | WallFinish;
const sidingOptions: { value: SidingChoice; label: string }[] = [
  { value: 'default', label: 'As today' },
  ...SIDING_FINISHES.map((f) => ({ value: f as SidingChoice, label: WALL_FINISH_LABEL[f] })),
];
type RoofChoice = 'default' | RoofFinish;
const proposedRoofOptions: { value: RoofChoice; label: string }[] = [{ value: 'default', label: 'As today' }, ...roofFinishOptions];
type ShutterChoice = 'keep' | 'remove';
const shutterOptions: { value: ShutterChoice; label: string }[] = [
  { value: 'keep', label: 'Keep' },
  { value: 'remove', label: 'Remove' },
];

/**
 * The plan's proposed look (types.ts ProposedLook): the siding, roof and windows after the work,
 * shown in the Proposed view only. Each field has "As today" or a reset to clear it.
 */
function ProposedExterior() {
  const look = usePlanStore((s) => s.plan.proposedLook);
  const update = usePlanStore((s) => s.updateProposedLook);
  const color = (label: string, key: 'wallColor' | 'roofColor' | 'boardColor' | 'trimColor' | 'sashColor', fallback: string, hint?: string) => (
    <ColorField label={label} value={look?.[key] ?? fallback} onCommit={(c) => update({ [key]: c })} onReset={look?.[key] ? () => update({ [key]: undefined }) : undefined} hint={hint} />
  );
  return (
    <>
      <SelectField label="Proposed siding" value={look?.wallFinish ?? 'default'} options={sidingOptions} onChange={(v) => update({ wallFinish: v === 'default' ? undefined : v })} />
      {color('Proposed siding colour', 'wallColor', defaultWallColor('exterior'))}
      <SelectField label="Proposed roof" value={look?.roofFinish ?? 'default'} options={proposedRoofOptions} onChange={(v) => update({ roofFinish: v === 'default' ? undefined : v })} />
      {color('Proposed roof colour', 'roofColor', ROOF_COLOR[look?.roofFinish ?? 'metal'])}
      {color('Proposed roof boards', 'boardColor', TRIM_COLOR, 'Fascia, rake boards and rafter tails.')}
      {color('Proposed window trim', 'trimColor', TRIM_COLOR)}
      {color('Proposed window sashes', 'sashColor', DEFAULT_SASH_COLOR, 'Window sashes and door frames.')}
      <SelectField label="Proposed shutters" value={look?.shutters === false ? 'remove' : 'keep'} options={shutterOptions} onChange={(v) => update({ shutters: v === 'remove' ? false : undefined })} />
      <p className="panel-note">The whole house after the work, in the Proposed view only; Existing and All keep today's look.</p>
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
  const roomCount = Object.values(level.rooms).filter((r) => isVisible(r.phase ?? 'existing', viewMode)).length;
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
      <LevelFramingFields level={level} />
      <ExteriorAppearance level={level} />
      <ProposedExterior />
      <CaseworkDefaults level={level} />
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
      <p className="panel-note">Select walls, openings, room labels, roofs, decks, floor openings, beams, posts or cabinets to edit them. R names a room, K draws a roof, J a deck, H a floor opening, I a beam, L a post, C places cabinets; Y shows the structure.</p>
    </>
  );
}

export function PropertiesPanel() {
  const levelId = useUiStore((s) => s.activeLevelId);
  const sel = useUiStore((s) => s.selection);
  const underlaySelected = useUiStore((s) => s.underlaySelected);
  const underlayTool = useUiStore((s) => s.activeTool === 'underlay');
  const fixtureTool = useUiStore((s) => s.activeTool === 'fixture');
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
  const fixtures = sel.fixtures.map((id) => level.fixtures?.[id]).filter(Boolean);
  const decks = sel.decks.map((id) => level.decks?.[id]).filter(Boolean);
  const floorOpenings = sel.floorOpenings.map((id) => level.floorOpenings?.[id]).filter(Boolean);
  const staircases = sel.staircases.map((id) => level.staircases?.[id]).filter(Boolean);
  // A staircase's pieces take its phase and go with it (SelectionActions).
  const scIds = new Set(staircases.map((sc) => sc.id));
  const withPieces = [...stairs, ...Object.values(level.stairs).filter((st) => st.staircaseId && scIds.has(st.staircaseId) && !sel.stairs.includes(st.id))];
  const gradePoints = sel.gradePoints.map((id) => site.gradePoints[id]).filter(Boolean);
  const columns = sel.columns.map((id) => site.columns[id]).filter(Boolean);
  const members = sel.members.map((id) => level.members?.[id]).filter(Boolean);
  const joistZones = sel.joistZones.map((id) => level.joistZones?.[id]).filter(Boolean);
  const live: Selection = {
    nodes,
    walls: walls.map((w) => w.id),
    openings: openings.map((o) => o.id),
    rooms: rooms.map((r) => r.id),
    stairs: stairs.map((st) => st.id),
    roofs: roofs.map((r) => r.id),
    fixtures: fixtures.map((f) => f.id),
    decks: decks.map((d) => d.id),
    floorOpenings: floorOpenings.map((o) => o.id),
    staircases: staircases.map((sc) => sc.id),
    members: members.map((m) => m.id),
    joistZones: joistZones.map((z) => z.id),
    gradePoints: gradePoints.map((g) => g.id),
    columns: columns.map((c) => c.id),
  };
  const total = selectionSize(live);

  let body: ReactNode;
  if (total === 0 && siteMode) body = <SiteProps key="site" site={site} />;
  else if (total === 0 && (underlayTool || (underlaySelected && level.underlay))) body = <UnderlayProps key={level.id} level={level} />;
  else if (total === 0 && fixtureTool) body = <FixtureToolProps key="fixture-tool" />;
  else if (total === 0) body = <LevelProps key={level.id} level={level} />;
  else if (total === 1 && walls.length === 1) body = <WallProps key={walls[0].id} level={level} wall={walls[0]} />;
  else if (total === 1 && openings.length === 1)
    body = <OpeningProps key={openings[0].id} level={level} opening={openings[0]} />;
  else if (total === 1 && rooms.length === 1) body = <RoomProps key={rooms[0].id} level={level} room={rooms[0]} />;
  else if (total === 1 && stairs.length === 1) body = <StairsProps key={stairs[0].id} level={level} stairs={stairs[0]} />;
  else if (total === 1 && staircases.length === 1) body = <StaircaseProps key={staircases[0].id} level={level} staircase={staircases[0]} />;
  else if (total === 1 && roofs.length === 1) body = <RoofProps key={roofs[0].id} level={level} roof={roofs[0]} />;
  else if (total === 1 && decks.length === 1) body = <DeckProps key={decks[0].id} level={level} deck={decks[0]} />;
  else if (total === 1 && floorOpenings.length === 1) body = <FloorOpeningProps key={floorOpenings[0].id} level={level} opening={floorOpenings[0]} />;
  else if (total === 1 && members.length === 1) body = <MemberProps key={members[0].id} level={level} member={members[0]} />;
  else if (total === 1 && joistZones.length === 1) body = <JoistZoneProps key={joistZones[0].id} level={level} zone={joistZones[0]} />;
  else if (total === 1 && fixtures.length === 1) body = <FixtureProps key={fixtures[0].id} level={level} fixture={fixtures[0]} />;
  else if (total === 1 && gradePoints.length === 1) body = <GradePointProps key={gradePoints[0].id} point={gradePoints[0]} />;
  else if (total === 1 && columns.length === 1) body = <ColumnProps key={columns[0].id} column={columns[0]} />;
  else if (total === walls.length) body = <MultiWallProps key={walls.map((w) => w.id).join(',')} levelId={level.id} walls={walls} />;
  else body = <MixedProps levelId={level.id} sel={live} walls={walls} openings={openings} stairs={withPieces} roofs={roofs} fixtures={fixtures} decks={decks} floorOpenings={floorOpenings} members={members} joistZones={joistZones} columns={columns} rooms={rooms} />;

  return (
    <aside className="side-panel" aria-label="Properties">
      <div className="panel-title">Properties</div>
      <div className="panel-body">
        {body}
        {total > 0 && <SelectionActions levelId={level.id} walls={walls} openings={openings} stairs={withPieces} roofs={roofs} fixtures={fixtures} decks={decks} floorOpenings={floorOpenings} members={members} joistZones={joistZones} columns={columns} rooms={rooms} />}
      </div>
    </aside>
  );
}
