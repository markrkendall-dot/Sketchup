import { useEffect, useId, useState, type ReactNode } from 'react';
import { getLevelElevations } from '../derive/levels';
import { PHASE_LABEL } from '../derive/phase';
import { jambDistances, OPENING_DEFAULTS, OPENING_LABEL, type OpeningType } from '../model/openings';
import { wallLength } from '../model/plan';
import type { Id, Level, Opening, Phase, Wall, WallKind } from '../model/types';
import { formatLength, parseLength } from '../model/units';
import { usePlanStore, type LengthAnchor } from '../store/planStore';
import { EMPTY_SELECTION, selectionSize, useUiStore, type Selection } from '../store/uiStore';

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

  useEffect(() => {
    if (!focused) setText(value === undefined ? '' : formatLength(value, denom));
  }, [value, denom, focused]);

  const commit = () => {
    const t = text.trim();
    if (t === '') {
      if (allowEmpty && value !== undefined) {
        const err = onCommit(null);
        setError(err || null);
      } else {
        setText(fmt(value));
        setError(null);
      }
      return;
    }
    let v: number;
    try {
      v = parseLength(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const rangeErr = checkBound(v, bound);
    if (rangeErr) {
      setError(rangeErr);
      return;
    }
    if (value !== undefined && Math.abs(v - value) < EPS) {
      setText(fmt(value));
      setError(null);
      return;
    }
    const err = onCommit(v);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setText(fmt(v));
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
          commit();
          setFocused(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') {
            setText(fmt(value));
            setError(null);
            e.currentTarget.blur();
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
      <select id={id} aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value as T)}>
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

function SelectionActions({ levelId, walls, openings }: { levelId: Id; walls: Wall[]; openings: Opening[] }) {
  const setPhase = usePlanStore((s) => s.setPhase);
  const deleteEntities = usePlanStore((s) => s.deleteEntities);
  const selection = useUiStore((s) => s.selection);
  const items = [...walls, ...openings];
  if (items.length === 0) return null;
  const allDemo = items.every((i) => i.phase === 'demo');
  const ids = { walls: walls.map((w) => w.id), openings: openings.map((o) => o.id) };
  return (
    <div className="panel-actions">
      <button
        className={allDemo ? '' : 'danger'}
        title={allDemo ? 'Mark the selection as existing again' : 'Mark the selection for demolition'}
        onClick={() => setPhase(levelId, ids, allDemo ? 'existing' : 'demo')}
      >
        {allDemo ? 'Keep (existing)' : 'Mark demolish'}
      </button>
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
  const { fromA, fromB } = jambDistances(opening.offset, opening.width, L);
  const maxJamb = Math.max(0, L - opening.width);
  const setJamb = (end: 'a' | 'b', v: number | null): string | null => {
    if (v === null) return null;
    if (v > maxJamb + EPS) return `At most ${formatLength(maxJamb, denom)} on this ${formatLength(L, denom)} wall.`;
    const offset = end === 'a' ? v + opening.width / 2 : L - v - opening.width / 2;
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
          if (v > L + EPS) return `Wider than the wall (${formatLength(L, denom)}).`;
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
      <LengthField label="From start" value={fromA} bound="nonnegative" onCommit={(v) => setJamb('a', v)} hint="Wall start corner to the near jamb." />
      <LengthField label="From end" value={fromB} bound="nonnegative" onCommit={(v) => setJamb('b', v)} hint="Wall end corner to the near jamb." />
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

function MixedProps({ levelId, sel, walls, openings }: { levelId: Id; sel: Selection; walls: Wall[]; openings: Opening[] }) {
  const setPhase = usePlanStore((s) => s.setPhase);
  const parts: string[] = [];
  if (walls.length) parts.push(`${walls.length} ${walls.length === 1 ? 'wall' : 'walls'}`);
  if (openings.length) parts.push(`${openings.length} ${openings.length === 1 ? 'opening' : 'openings'}`);
  if (sel.nodes.length) parts.push(`${sel.nodes.length} ${sel.nodes.length === 1 ? 'corner' : 'corners'}`);
  const items = [...walls, ...openings];
  return (
    <>
      <h3>{parts.join(', ')}</h3>
      {items.length > 0 && (
        <SelectField
          label="Phase"
          value={common(items, (i) => i.phase)}
          options={phaseOptions}
          onChange={(p) => setPhase(levelId, { walls: walls.map((w) => w.id), openings: openings.map((o) => o.id) }, p)}
        />
      )}
      {items.length === 0 && <p className="panel-note">Drag corners with the select tool to move them.</p>}
    </>
  );
}

function LevelProps({ level }: { level: Level }) {
  const { updateLevel, setBaseFloorElevation } = usePlanStore.getState();
  const base = usePlanStore((s) => s.plan.baseFloorElevation);
  // Select primitives: an object built in a selector would never compare equal.
  const floorTop = usePlanStore((s) => getLevelElevations(s.plan)[level.id]?.floorTop);
  const ceiling = usePlanStore((s) => getLevelElevations(s.plan)[level.id]?.ceiling);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const [name, setName] = useState(level.name);
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
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && commitName()}
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
      {floorTop !== undefined && ceiling !== undefined && (
        <>
          <ReadOnly label="Floor top">{formatLength(floorTop, denom)}</ReadOnly>
          <ReadOnly label="Ceiling">{formatLength(ceiling, denom)}</ReadOnly>
        </>
      )}
      <p className="panel-note">Select walls or openings to edit them.</p>
    </>
  );
}

export function PropertiesPanel() {
  const levelId = useUiStore((s) => s.activeLevelId);
  const sel = useUiStore((s) => s.selection);
  const level = usePlanStore((s) => s.plan.levels[levelId]);
  if (!level) return <aside className="side-panel" />;
  const walls = sel.walls.map((id) => level.walls[id]).filter(Boolean);
  const openings = sel.openings.map((id) => level.openings[id]).filter(Boolean);
  const nodes = sel.nodes.filter((id) => level.nodes[id]);
  const live: Selection = { nodes, walls: walls.map((w) => w.id), openings: openings.map((o) => o.id) };
  const total = selectionSize(live);

  let body: ReactNode;
  if (total === 0) body = <LevelProps key={level.id} level={level} />;
  else if (total === 1 && walls.length === 1) body = <WallProps key={walls[0].id} level={level} wall={walls[0]} />;
  else if (total === 1 && openings.length === 1)
    body = <OpeningProps key={openings[0].id} level={level} opening={openings[0]} />;
  else if (total === walls.length) body = <MultiWallProps levelId={level.id} walls={walls} />;
  else body = <MixedProps levelId={level.id} sel={live} walls={walls} openings={openings} />;

  return (
    <aside className="side-panel" aria-label="Properties">
      <div className="panel-title">Properties</div>
      <div className="panel-body">
        {body}
        {total > 0 && <SelectionActions levelId={level.id} walls={walls} openings={openings} />}
      </div>
    </aside>
  );
}
