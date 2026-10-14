import { memo, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { counterRuns, fixtureSymbol, type FixtureSymbol } from '../derive/casework';
import { deckTopWords, getDeckLayout } from '../derive/decks';
import { getFloorOpeningLayout } from '../derive/floorOpenings';
import { getFootprints, type Footprint } from '../derive/footprint';
import { arcPath, getOpeningsByWall, openingSymbol, wallPieces, type WallPieces } from '../derive/openings';
import { isOpeningVisible, isVisible, shownPhase } from '../derive/phase';
import { faceAt, getFaces, interiorPoint, type Face, type FaceSet } from '../derive/rooms';
import { roofOutlineWithOverhang, roofRidgeLines } from '../derive/roofs';
import { siteGhostLevelId } from '../derive/site';
import { getStaircaseLayout } from '../derive/staircase';
import { flightSteps, floorToFloor, stairsHoleOutline, stairsHoleStart, stairsSymbol, type StairsSymbol } from '../derive/stairs';
import { add, polygonSignedArea, scale } from '../model/geometry';
import type { Id, Level, Opening, Roof, Vec2, ViewMode, Wall } from '../model/types';
import { formatArea, formatLengthCompact } from '../model/units';
import { useLayerPlan, useLayerUi } from './layerStores';
import { outlinePath } from './outline';
import { faceWidth, nameWrapFor, ROOM_AREA_DY, ROOM_NAME_DY, ROOM_NAME_LINE_PX, ROOM_NAME_WRAP, roomNameLines } from './roomLabels';

/**
 * A short wall of a small room has no dimension label (REVIEW-2 C2): under 4' long, and a face it
 * bounds under 60 sq ft net (a closet's "3'" and "3'-2\"" would sit on its name). Any such face,
 * not every one: a closet's partitions also bound the bigger room next door.
 */
const SMALL_WALL_LENGTH = 48;
const SMALL_ROOM_AREA = 60 * 144;
/** Gap between a wall face and its dimension label, in screen px. */
const LABEL_GAP_PX = 11;
/** Hide labels on walls shorter than this on screen. */
const MIN_LABEL_WALL_PX = 34;
/** Estimated width of one character of a dimension label, screen px; a longer label is hidden. */
const LABEL_CHAR_PX = 6.5;
/** A room whose bounding box is smaller than this on screen (either side) loses its area text... */
const MIN_ROOM_AREA_PX = 60;
/** ... and smaller than this its name too. */
const MIN_ROOM_NAME_PX = 40;
/** Spacing of the demolition hatch, in screen px. */
const HATCH_PX = 7;
/** Radius of the open wall end markers, screen px. */
const OPEN_END_PX = 4.5;
/** Room tints cycle through this many classes. */
const ROOM_TINTS = 4;
export const HATCH_DEMO_ID = 'hp-hatch-demo';
export const HATCH_CHIMNEY_ID = 'hp-hatch-chimney';

const viewportScale = (s: { viewport: { k: number } }) => s.viewport.k;
const pt = (p: Vec2) => `${p.x},${p.y}`;
const segPath = (segs: readonly (readonly [Vec2, Vec2])[]) => segs.map(([p, q]) => `M${pt(p)}L${pt(q)}`).join('');
const polyPath = (poly: readonly Vec2[]) => `M${poly.map(pt).join('L')}Z`;

/** A wall's footprint in the current view mode (undefined while the wall is hidden). */
function useFootprint(levelId: Id, wallId: Id | undefined): Footprint | undefined {
  const viewMode = useLayerUi((s) => s.viewMode);
  return useLayerPlan((s) => {
    const level = s.plan.levels[levelId];
    return level && wallId ? getFootprints(level, viewMode).get(wallId) : undefined;
  });
}

/** Faces, open ends and room labels of a level in the current view mode (memoized). */
function useFaceSet(levelId: Id): FaceSet | null {
  const viewMode = useLayerUi((s) => s.viewMode);
  return useLayerPlan((s) => {
    const level = s.plan.levels[levelId];
    return level ? getFaces(level, viewMode) : null;
  });
}

/** Hatch pattern for demolished walls; sized in world units so it stays constant on screen. */
const PatternDefs = memo(function PatternDefs() {
  const k = useLayerUi(viewportScale);
  const size = HATCH_PX / k;
  return (
    <defs>
      <pattern
        id={HATCH_DEMO_ID}
        patternUnits="userSpaceOnUse"
        width={size}
        height={size}
        patternTransform="rotate(45)"
      >
        <rect className="hatch-bg" width={size} height={size} />
        <line className="hatch-line" x1={0} y1={0} x2={0} y2={size} strokeWidth={1.5 / k} />
      </pattern>
      <pattern id={HATCH_CHIMNEY_ID} patternUnits="userSpaceOnUse" width={size} height={size} patternTransform="rotate(-45)">
        <rect className="hatch-chimney-bg" width={size} height={size} />
        <line className="hatch-chimney-line" x1={0} y1={0} x2={0} y2={size} strokeWidth={1.5 / k} />
      </pattern>
    </defs>
  );
});

/**
 * A wall's solid pieces (mitred outline cut around its visible openings), cached per footprint
 * object so unchanged walls are not re-cut when another wall or the selection changes.
 */
const piecesCache = new WeakMap<Footprint, { wall: Wall; openings: readonly Opening[] | undefined; viewMode: ViewMode; pieces: WallPieces }>();
function wallPiecesFor(fp: Footprint, wall: Wall, openings: readonly Opening[] | undefined, viewMode: ViewMode): WallPieces {
  const hit = piecesCache.get(fp);
  if (hit && hit.wall === wall && hit.openings === openings && hit.viewMode === viewMode) return hit.pieces;
  const gaps: [number, number][] = [];
  for (const o of openings ?? []) {
    if (!isOpeningVisible(o, wall, viewMode)) continue;
    const sym = openingSymbol(fp, o);
    gaps.push([sym.j0, sym.j1]);
  }
  const pieces = wallPieces(fp, fp, gaps);
  piecesCache.set(fp, { wall, openings, viewMode, pieces });
  return pieces;
}

/** The class of a wall's paths: its kind and the phase it is drawn in (phase.ts shownPhase: red and green only in All). */
const wallClass = (wall: Wall, viewMode: ViewMode) => `wall wall-${wall.kind} phase-${shownPhase(wall.phase, viewMode)}`;

/** Paint order of fill groups: where two styles meet, the later one's hairline wins consistently. */
const fillRank = (wall: Wall, viewMode: ViewMode) => {
  const phase = shownPhase(wall.phase, viewMode);
  return (phase === 'demo' ? 0 : phase === 'new' ? 10 : 20) + (wall.kind === 'interior' ? 0 : 1);
};

/** A positive (consistently wound) polygon path, so same-style pieces merge without seams. */
const orientedPath = (poly: readonly Vec2[]) => polyPath(polygonSignedArea(poly) < 0 ? [...poly].reverse() : poly);

interface StyleGroup {
  cls: string;
  rank: number;
  ids: Id[];
  fill: string;
  segs: [Vec2, Vec2][];
  /** Outline segments chained into polylines (outline.ts). */
  edge: string;
}

/** A level's walls, footprints and openings by wall in the current view mode, each by reference. */
function useWallSources(levelId: Id) {
  const viewMode = useLayerUi((s) => s.viewMode);
  const walls = useLayerPlan((s) => s.plan.levels[levelId]?.walls);
  const fps = useLayerPlan((s) => {
    const level = s.plan.levels[levelId];
    return level ? getFootprints(level, viewMode) : undefined;
  });
  const byWall = useLayerPlan((s) => {
    const level = s.plan.levels[levelId];
    return level ? getOpeningsByWall(level) : undefined;
  });
  return { viewMode, walls, fps, byWall };
}

/** A wall's fill path (its pieces, consistently wound), cached with the pieces. */
const fillCache = new WeakMap<WallPieces, string>();

/** Add a wall's pieces to the style group `cls` (created on first use). */
function addToGroup(
  map: Map<string, StyleGroup>,
  cls: string,
  rank: number,
  wall: Wall,
  fp: Footprint,
  byWall: ReadonlyMap<Id, readonly Opening[]>,
  viewMode: ViewMode,
) {
  const pieces = wallPiecesFor(fp, wall, byWall.get(wall.id), viewMode);
  let fill = fillCache.get(pieces);
  if (fill === undefined) fillCache.set(pieces, (fill = pieces.fills.map(orientedPath).join('')));
  const g = map.get(cls);
  if (g) {
    g.ids.push(wall.id);
    g.fill += fill;
    g.segs.push(...pieces.edges);
  } else map.set(cls, { cls, rank, ids: [wall.id], fill, segs: [...pieces.edges], edge: '' });
}

function finishGroups(map: Map<string, StyleGroup>): StyleGroup[] {
  for (const g of map.values()) g.edge = outlinePath(g.segs);
  return [...map.values()].sort((p, q) => p.rank - q.rank);
}

/**
 * Wall fills and outlines, merged into one path per style (kind and phase).
 *
 * Separate shapes that share an edge leave a faint anti-aliasing seam (or a doubled dot where two
 * strokes end) however they are drawn. One fill path with consistent winding has no internal edges,
 * and outline segments chained into polylines meet in line joins, so mitred corners and the two
 * halves of a wall split by a T read as one solid with one outline. The outline is the long edges (trimmed
 * where a T's butt wall meets the face), opening jambs, and end caps only at open ends and bevels:
 * never at joins. All fills are painted before all outlines.
 *
 * Each group lists its walls in data-wall-ids. The merged paths depend only on the level's walls,
 * footprints and openings in the view mode, never on hover or selection (WallHighlightLayer draws
 * those on top), so pointing at a wall does not rebuild them. Per-wall pieces are cached on the
 * footprint object, which keeps its identity while the wall is unchanged.
 */
function useWallGroups(levelId: Id): StyleGroup[] {
  const { viewMode, walls, fps, byWall } = useWallSources(levelId);
  return useMemo(() => {
    if (!walls || !fps || !byWall) return [];
    const map = new Map<string, StyleGroup>();
    for (const wall of Object.values(walls)) {
      const fp = fps.get(wall.id);
      if (fp) addToGroup(map, wallClass(wall, viewMode), fillRank(wall, viewMode), wall, fp, byWall, viewMode);
    }
    return finishGroups(map);
  }, [walls, fps, byWall, viewMode]);
}

/**
 * The hovered and selected walls, drawn again over the merged paths with the is-hovered /
 * is-selected styles. Same pieces as the plain wall, so opening gaps and the outline match. The
 * fills go between the merged fills and the merged outlines (where the highlight style group used
 * to paint), the outlines on top, and only for selected walls: a hovered wall's outline is the
 * plain one, already drawn. Subscribes to hover and the wall selection; the plan layers do not, so
 * a hover change re-renders only this and repaints only the highlighted walls.
 */
function useHighlightGroups(levelId: Id): StyleGroup[] {
  const { viewMode, walls, fps, byWall } = useWallSources(levelId);
  // Replaced only when the selection changes, so selecting it by reference is stable.
  const selected = useLayerUi((s) => s.selection.walls);
  const hovered = useLayerUi((s) => s.hover.wallId);
  return useMemo(() => {
    if (!walls || !fps || !byWall || (selected.length === 0 && !hovered)) return [];
    const map = new Map<string, StyleGroup>();
    const add = (id: Id) => {
      const wall = walls[id];
      const fp = fps.get(id);
      if (!wall || !fp) return;
      const sel = selected.includes(id);
      const hov = hovered === id;
      const cls = `${wallClass(wall, viewMode)}${sel ? ' is-selected' : ''}${hov ? ' is-hovered' : ''}`;
      addToGroup(map, cls, (sel ? 200 : 100) + fillRank(wall, viewMode), wall, fp, byWall, viewMode);
    };
    for (const id of selected) add(id);
    if (hovered && !selected.includes(hovered)) add(hovered);
    return finishGroups(map);
  }, [walls, fps, byWall, viewMode, selected, hovered]);
}

const WallHighlightLayer = memo(function WallHighlightLayer({ levelId, part }: { levelId: Id; part: 'fill' | 'edge' }) {
  const groups = useHighlightGroups(levelId);
  const shown = part === 'fill' ? groups : groups.filter((g) => g.cls.includes(' is-selected'));
  if (shown.length === 0) return null;
  return (
    <g className={`layer-wall-highlight-${part}s`} pointerEvents="none">
      {shown.map((g) => (
        <g key={g.cls} className={g.cls} data-highlight-wall-ids={g.ids.join(' ')}>
          <path
            className={part === 'fill' ? 'wall-fill' : 'wall-edge'}
            d={part === 'fill' ? g.fill : g.edge}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ))}
    </g>
  );
});

const WallsLayer = memo(function WallsLayer({ levelId }: { levelId: Id }) {
  const groups = useWallGroups(levelId);
  return (
    <>
      <g className="layer-walls" pointerEvents="none">
        {groups.map((g) => (
          <g key={g.cls} className={g.cls}>
            <path className="wall-fill" d={g.fill} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </g>
      <WallHighlightLayer levelId={levelId} part="fill" />
      <g className="layer-wall-edges" pointerEvents="none">
        {groups.map((g) => (
          <g key={g.cls} className={g.cls} data-wall-ids={g.ids.join(' ')}>
            <path className="wall-edge" d={g.edge} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </g>
      <WallHighlightLayer levelId={levelId} part="edge" />
    </>
  );
});

const OpeningShape = memo(function OpeningShape({ levelId, openingId }: { levelId: Id; openingId: Id }) {
  const o = useLayerPlan((s) => s.plan.levels[levelId]?.openings[openingId]);
  const wall = useLayerPlan((s) => (o ? s.plan.levels[levelId]?.walls[o.wallId] : undefined));
  const fp = useFootprint(levelId, o?.wallId);
  const viewMode = useLayerUi((s) => s.viewMode);
  const selected = useLayerUi((s) => s.selection.openings.includes(openingId));
  const hovered = useLayerUi((s) => s.hover.openingId === openingId);
  const sym = useMemo(() => (fp && o ? openingSymbol(fp, o) : null), [fp, o]);
  if (!o || !sym || !isOpeningVisible(o, wall, viewMode)) return null;
  const cls = `opening opening-${o.type} phase-${shownPhase(o.phase, viewMode)}${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}`;
  return (
    <g className={cls} data-opening-id={openingId}>
      <polygon className="opening-gap" points={sym.gap.map(pt).join(' ')} />
      {sym.lines.length > 0 && <path className="opening-line" d={segPath(sym.lines)} vectorEffect="non-scaling-stroke" />}
      {sym.dashed.length > 0 && (
        <path className="opening-dashed" d={segPath(sym.dashed)} vectorEffect="non-scaling-stroke" />
      )}
      {sym.arc && <path className="opening-arc" d={arcPath(sym.arc)} vectorEffect="non-scaling-stroke" />}
      {sym.leaf && <path className="opening-leaf" d={segPath([sym.leaf])} vectorEffect="non-scaling-stroke" />}
    </g>
  );
});

/** Bit 1: a face lies on the wall's left (+normal) side; bit 2: on its right. Per face set, per wall. */
const sideCache = new WeakMap<FaceSet, Map<Id, number>>();
function faceSides(set: FaceSet, level: Level): Map<Id, number> {
  let m = sideCache.get(set);
  if (!m) {
    sideCache.set(set, (m = new Map()));
    for (const f of set.faces) {
      for (let i = 0; i < f.wallIds.length; i++) {
        const wall = level.walls[f.wallIds[i]];
        if (!wall) continue;
        // The interior is on the right of the half-edge: tracing a->b puts the face on the wall's right.
        const bit = f.nodeIds[i] === wall.a ? 2 : 1;
        m.set(wall.id, (m.get(wall.id) ?? 0) | bit);
      }
    }
  }
  return m;
}

/** Smallest net area of the faces each wall bounds (walls bounding no face are absent). Per face set. */
const wallAreaCache = new WeakMap<FaceSet, Map<Id, number>>();
function smallestFaceBeside(set: FaceSet): Map<Id, number> {
  let m = wallAreaCache.get(set);
  if (!m) {
    wallAreaCache.set(set, (m = new Map()));
    for (const f of set.faces) for (const id of f.wallIds) m.set(id, Math.min(m.get(id) ?? Infinity, f.netArea));
  }
  return m;
}

/**
 * Where along a wall (distance from its a end) the dimension label goes, and how much room it has:
 * the middle of the longest stretch not crossed by the swing of a door that opens to the label's
 * side (a sliding door has none), or the middle of the wall when no such door is there.
 */
function labelSpan(fp: Footprint, wall: Wall, openings: readonly Opening[] | undefined, viewMode: ViewMode, side: 1 | -1): { at: number; room: number } {
  const swings: [number, number][] = [];
  for (const o of openings ?? []) {
    if (o.type !== 'door' || o.sliding || !isOpeningVisible(o, wall, viewMode)) continue;
    if ((o.swing?.side ?? 'left') !== (side === 1 ? 'left' : 'right')) continue;
    const sym = openingSymbol(fp, o);
    swings.push([sym.j0, sym.j1]);
  }
  if (swings.length === 0) return { at: fp.length / 2, room: fp.length };
  swings.sort((p, q) => p[0] - q[0]);
  let best = { at: fp.length / 2, room: 0 };
  let from = 0;
  for (const [j0, j1] of [...swings, [fp.length, fp.length] as [number, number]]) {
    if (j0 - from > best.room) best = { at: (from + j0) / 2, room: j0 - from };
    from = Math.max(from, j1);
  }
  return best;
}

const DimensionLabel = memo(function DimensionLabel({ levelId, wallId }: { levelId: Id; wallId: Id }) {
  const fp = useFootprint(levelId, wallId);
  const wall = useLayerPlan((s) => s.plan.levels[levelId]?.walls[wallId]);
  const openings = useLayerPlan((s) => {
    const level = s.plan.levels[levelId];
    return level ? getOpeningsByWall(level).get(wallId) : undefined;
  });
  const viewMode = useLayerUi((s) => s.viewMode);
  const visible = !!wall && isVisible(wall.phase, viewMode);
  const k = useLayerUi(viewportScale);
  const denom = useLayerPlan((s) => s.plan.settings.precisionDenominator);
  // An exterior wall with a face on exactly one side is labeled on the other (outside) side: +1
  // is the left (+normal) side, the default; -1 the right.
  const side = useLayerPlan((s): 1 | -1 => {
    const level = s.plan.levels[levelId];
    if (!level || level.walls[wallId]?.kind !== 'exterior') return 1;
    const bits = faceSides(getFaces(level, viewMode), level).get(wallId) ?? 0;
    return bits === 1 ? -1 : 1;
  });
  // Beside a small room: a short wall's label would crowd the room's name.
  const besideSmallRoom = useLayerPlan((s) => {
    const level = s.plan.levels[levelId];
    if (!level) return false;
    const area = smallestFaceBeside(getFaces(level, viewMode)).get(wallId);
    return area !== undefined && area < SMALL_ROOM_AREA;
  });
  if (!fp || !wall || !visible || fp.length * k < MIN_LABEL_WALL_PX) return null;
  if (besideSmallRoom && fp.length < SMALL_WALL_LENGTH) return null;
  const text = formatLengthCompact(fp.length, denom);
  const width = text.length * LABEL_CHAR_PX;
  // Drop a label that would be wider than the wall it belongs to.
  if (width > fp.length * k) return null;
  // Slide it clear of the swing of a door on its side; hide it when no clear stretch is wide enough.
  const span = labelSpan(fp, wall, openings, viewMode, side);
  if (width > span.room * k) return null;
  // Just outside the wall face, on the left of a->b unless the outside is on the right.
  const pos = add(add(fp.a, scale(fp.dir, span.at)), scale(fp.normal, side * (fp.thickness / 2 + LABEL_GAP_PX / k)));
  let angle = (Math.atan2(fp.dir.y, fp.dir.x) * 180) / Math.PI;
  if (angle > 90 || angle <= -90) angle += 180; // never upside down
  return (
    <g transform={`translate(${pos.x} ${pos.y}) rotate(${angle}) scale(${1 / k})`} data-dim-wall-id={wallId}>
      <text className="dim-label" textAnchor="middle" dominantBaseline="central">
        {text}
      </text>
    </g>
  );
});

const NodeDot = memo(function NodeDot({ levelId, nodeId }: { levelId: Id; nodeId: Id }) {
  const visible = useLayerUi((s) => s.selection.nodes.includes(nodeId) || s.hover.nodeId === nodeId);
  const selected = useLayerUi((s) => s.selection.nodes.includes(nodeId));
  const node = useLayerPlan((s) => s.plan.levels[levelId]?.nodes[nodeId]);
  const k = useLayerUi(viewportScale);
  if (!visible || !node) return null;
  return (
    <circle
      className={`node${selected ? ' is-selected' : ''}`}
      cx={node.x}
      cy={node.y}
      r={4 / k}
      vectorEffect="non-scaling-stroke"
    />
  );
});

const NO_RECORD: Readonly<Record<Id, unknown>> = {};

/**
 * Ids of one kind of entity on a level, as the same array while the set of ids is unchanged, so a
 * layer of per-entity components does not re-render (and re-create every child) when an entity
 * only changes, e.g. on every step of a corner drag. The children select their own entity.
 */
function useEntityIds(levelId: Id, kind: 'walls' | 'nodes' | 'openings' | 'stairs' | 'roofs' | 'fixtures' | 'decks' | 'floorOpenings' | 'staircases'): Id[] {
  return useLayerPlan(useShallow((s) => Object.keys(s.plan.levels[levelId]?.[kind] ?? NO_RECORD)));
}

/**
 * Casework symbol (DESIGN.md "Casework"): the outline with a heavier front edge and door ticks,
 * dashed for what hangs above the counter, an appliance's word, a range's burners, a sink's basin.
 */
export function FixtureGlyph({ sym, k, className, id }: { sym: FixtureSymbol; k: number; className: string; id?: Id }) {
  return (
    <g className={`${className}${sym.dashed ? ' fixture-overhead' : ''}`} data-fixture-id={id}>
      <path className="fixture-body" d={polyPath(sym.outline)} vectorEffect="non-scaling-stroke" />
      <path className="fixture-front" d={segPath([sym.front])} vectorEffect="non-scaling-stroke" />
      {sym.ticks.length > 0 && <path className="fixture-tick" d={segPath(sym.ticks)} vectorEffect="non-scaling-stroke" />}
      {sym.basin && <path className="fixture-basin" d={polyPath(sym.basin)} vectorEffect="non-scaling-stroke" />}
      {sym.burners.map((b, i) => (
        <circle key={i} className="fixture-burner" cx={b.at.x} cy={b.at.y} r={b.r} vectorEffect="non-scaling-stroke" />
      ))}
      {sym.label && (
        <g transform={`translate(${sym.labelAt.x} ${sym.labelAt.y}) rotate(${sym.labelAngle}) scale(${1 / k})`}>
          <text className="fixture-label" textAnchor="middle" dominantBaseline="central">
            {sym.label}
          </text>
        </g>
      )}
    </g>
  );
}

const FixtureShape = memo(function FixtureShape({ levelId, fixtureId }: { levelId: Id; fixtureId: Id }) {
  const f = useLayerPlan((s) => s.plan.levels[levelId]?.fixtures?.[fixtureId]);
  const viewMode = useLayerUi((s) => s.viewMode);
  const selected = useLayerUi((s) => s.selection.fixtures.includes(fixtureId));
  const k = useLayerUi(viewportScale);
  const sym = useMemo(() => (f ? fixtureSymbol(f) : null), [f]);
  if (!f || !sym || !isVisible(f.phase, viewMode)) return null;
  return <FixtureGlyph sym={sym} k={k} id={fixtureId} className={`fixture fixture-${f.kind} phase-${shownPhase(f.phase, viewMode)}${selected ? ' is-selected' : ''}`} />;
});

/** The counter slabs' outlines (one path per run, so an L-shaped counter reads as one top). */
const CounterLayer = memo(function CounterLayer({ levelId }: { levelId: Id }) {
  const fixtures = useLayerPlan((s) => s.plan.levels[levelId]?.fixtures);
  const viewMode = useLayerUi((s) => s.viewMode);
  const runs = useMemo(() => {
    if (!fixtures) return [];
    const shown = Object.values(fixtures).filter((f) => isVisible(f.phase, viewMode));
    return counterRuns(shown).map((r) => ({
      id: r.fixtureIds.join('+'),
      d: polyPath(r.outline) + r.holes.map(polyPath).join(''),
      phase: shownPhase(shown.filter((f) => r.fixtureIds.includes(f.id)).every((f) => f.phase === 'demo') ? 'demo' : shown.some((f) => r.fixtureIds.includes(f.id) && f.phase === 'new') ? 'new' : 'existing', viewMode),
    }));
  }, [fixtures, viewMode]);
  if (runs.length === 0) return null;
  return (
    <g className="layer-counters" pointerEvents="none">
      {runs.map((r) => (
        <path key={r.id} className={`counter phase-${r.phase}`} d={r.d} fillRule="evenodd" vectorEffect="non-scaling-stroke" data-counter={r.id} />
      ))}
    </g>
  );
});

/** Cabinets, appliances and sinks, under the walls (their backs sit against the wall faces). */
const FixturesLayer = memo(function FixturesLayer({ levelId }: { levelId: Id }) {
  const ids = useEntityIds(levelId, 'fixtures');
  if (ids.length === 0) return null;
  return (
    <>
      <CounterLayer levelId={levelId} />
      <g className="layer-fixtures" pointerEvents="none">
        {ids.map((id) => (
          <FixtureShape key={id} levelId={levelId} fixtureId={id} />
        ))}
      </g>
    </>
  );
});

/**
 * Stairs symbol: outline, nosing lines, and an UP arrow pointing the way the flight climbs. A landing
 * (one riser) is its outline only.
 */
export function StairsGlyph({ sym, k, className, id }: { sym: StairsSymbol; k: number; className: string; id?: Id }) {
  return (
    <g className={`${className}${sym.landing ? ' stairs-landing' : ''}`} data-stairs-id={id}>
      <path className="stairs-body" d={polyPath(sym.outline)} vectorEffect="non-scaling-stroke" />
      {sym.treads.length > 0 && <path className="stairs-tread" d={segPath(sym.treads)} vectorEffect="non-scaling-stroke" />}
      {sym.rails.length > 0 && <path className="stairs-rail" d={segPath(sym.rails)} vectorEffect="non-scaling-stroke" />}
      {!sym.landing && (
        <>
          <path className="stairs-arrow" d={segPath([sym.shaft])} vectorEffect="non-scaling-stroke" />
          <path className="stairs-arrow-head" d={`M${pt(sym.head[0])}L${pt(sym.head[1])}L${pt(sym.head[2])}`} vectorEffect="non-scaling-stroke" />
          <g transform={`translate(${sym.label.x} ${sym.label.y}) rotate(${sym.labelAngle}) scale(${1 / k})`}>
            <text className="stairs-label" textAnchor="middle" dominantBaseline="central">
              UP
            </text>
          </g>
        </>
      )}
    </g>
  );
}

const StairsShape = memo(function StairsShape({ levelId, stairsId }: { levelId: Id; stairsId: Id }) {
  const st = useLayerPlan((s) => s.plan.levels[levelId]?.stairs[stairsId]);
  const ftf = useLayerPlan((s) => floorToFloor(s.plan, levelId));
  const viewMode = useLayerUi((s) => s.viewMode);
  // Selected itself, or as a piece of its selected staircase.
  const selected = useLayerUi((s) => s.selection.stairs.includes(stairsId) || (!!st?.staircaseId && s.selection.staircases.includes(st.staircaseId)));
  const k = useLayerUi(viewportScale);
  // A staircase's piece leaves its railings to the staircase (StaircaseShape).
  const member = useLayerPlan((s) => !!st?.staircaseId && !!s.plan.levels[levelId]?.staircases?.[st.staircaseId]);
  const sym = useMemo(() => (st ? stairsSymbol(member ? { ...st, railings: undefined } : st, flightSteps(st, ftf).risers) : null), [st, ftf, member]);
  if (!st || !sym || !isVisible(st.phase, viewMode)) return null;
  return <StairsGlyph sym={sym} k={k} id={stairsId} className={`stairs phase-${shownPhase(st.phase, viewMode)}${selected ? ' is-selected' : ''}`} />;
});

/**
 * A staircase's railing on the plan (derive/staircase.ts): the handrails as heavy lines, the newels
 * as squares, and the bullnose's outline round the starting newel.
 */
const StaircaseShape = memo(function StaircaseShape({ levelId, staircaseId }: { levelId: Id; staircaseId: Id }) {
  const viewMode = useLayerUi((s) => s.viewMode);
  const layout = useLayerPlan((s) => getStaircaseLayout(s.plan, levelId, staircaseId, viewMode));
  const phase = useLayerPlan((s) => {
    const first = layout ? s.plan.levels[levelId]?.stairs[layout.members[0]] : undefined;
    return first ? shownPhase(first.phase, viewMode) : 'existing';
  });
  if (!layout) return null;
  const half = (n: { at: Vec2; size: number }) => n.size / 2;
  return (
    <g className={`stairs staircase phase-${phase}`} data-staircase-id={staircaseId}>
      {layout.bullnose && <path className="stairs-body" d={polyPath(layout.bullnose)} vectorEffect="non-scaling-stroke" />}
      {layout.rails.length > 0 && <path className="stairs-rail" d={segPath(layout.rails.map((r) => [r.a, r.b] as [Vec2, Vec2]))} vectorEffect="non-scaling-stroke" />}
      {layout.newels.map((n, i) => (
        <rect key={i} className="stairs-newel" x={n.at.x - half(n)} y={n.at.y - half(n)} width={n.size} height={n.size} vectorEffect="non-scaling-stroke" />
      ))}
    </g>
  );
});

const StairsLayer = memo(function StairsLayer({ levelId }: { levelId: Id }) {
  const ids = useEntityIds(levelId, 'stairs');
  const staircases = useEntityIds(levelId, 'staircases');
  if (ids.length === 0) return null;
  return (
    <g className="layer-stairs" pointerEvents="none">
      {ids.map((id) => (
        <StairsShape key={id} levelId={levelId} stairsId={id} />
      ))}
      {staircases.map((id) => (
        <StaircaseShape key={id} levelId={levelId} staircaseId={id} />
      ))}
    </g>
  );
});

/**
 * The openings that the level below's stairs cut in this level's floor (DESIGN.md "Openings in 3D":
 * only where headroom under the floor is short, stairsHoleOutline): a dashed outline with an X, the
 * usual "open to below" mark, and the treads below it, faint. Nothing where the flight is not cut.
 */
const StairHolesLayer = memo(function StairHolesLayer({ levelId }: { levelId: Id }) {
  const belowId = useLayerPlan((s) => {
    const i = s.plan.levelOrder.indexOf(levelId);
    return i > 0 ? s.plan.levelOrder[i - 1] : null;
  });
  const stairs = useLayerPlan((s) => (belowId ? s.plan.levels[belowId]?.stairs : undefined));
  const ftf = useLayerPlan((s) => (belowId ? floorToFloor(s.plan, belowId) : 0));
  const ceiling = useLayerPlan((s) => (belowId ? (s.plan.levels[belowId]?.wallHeight ?? 0) : 0));
  const viewMode = useLayerUi((s) => s.viewMode);
  const holes = useMemo(() => {
    const out: { id: Id; start: number; outline: string; cross: string; treads: string }[] = [];
    for (const st of Object.values(stairs ?? {})) {
      if (!st.cutsFloorAbove || !isVisible(st.phase, viewMode)) continue;
      const hole = stairsHoleOutline(st, ftf, ceiling);
      if (!hole) continue;
      const start = stairsHoleStart(st, ftf, ceiling);
      const sym = stairsSymbol(st, flightSteps(st, ftf).risers);
      // Treads lie across the flight at increasing distance up it; keep the ones over the hole.
      const step = st.run / (sym.treads.length + 1);
      const treads = sym.treads.filter((_, i) => (i + 1) * step > start + 1e-6);
      out.push({ id: st.id, start, outline: polyPath(hole), cross: segPath([[hole[0], hole[2]], [hole[1], hole[3]]]), treads: segPath(treads) });
    }
    return out;
  }, [stairs, ftf, ceiling, viewMode]);
  if (holes.length === 0) return null;
  return (
    <g className="layer-stair-holes" pointerEvents="none">
      {holes.map((h) => (
        <g key={h.id} className="stair-hole" data-stair-hole={h.id} data-hole-start={h.start}>
          <path className="stair-hole-body" d={h.outline} vectorEffect="non-scaling-stroke" />
          {h.treads && <path className="stair-hole-tread" d={h.treads} vectorEffect="non-scaling-stroke" />}
          <path className="stair-hole-cross" d={h.cross} vectorEffect="non-scaling-stroke" />
        </g>
      ))}
    </g>
  );
});

/**
 * A floor opening on its level (DESIGN.md "Floor openings"): the outline dashed with an X, the usual
 * "open to below" mark, the guard's caps as bands on the floor round it (open where a flight from
 * below arrives), and an "Open to below" label; demolished red, new green. A selected opening shows
 * handles on its corners.
 */
const FloorOpeningShape = memo(function FloorOpeningShape({ levelId, openingId }: { levelId: Id; openingId: Id }) {
  const opening = useLayerPlan((s) => s.plan.levels[levelId]?.floorOpenings?.[openingId]);
  const viewMode = useLayerUi((s) => s.viewMode);
  const layout = useLayerPlan((s) => getFloorOpeningLayout(s.plan, levelId, openingId, viewMode));
  const selected = useLayerUi((s) => s.selection.floorOpenings.includes(openingId));
  const k = useLayerUi(viewportScale);
  const paths = useMemo(() => {
    if (!opening || !layout) return null;
    const o = opening.outline;
    // The X joins opposite corners of a four-sided opening, else those of its bounding box.
    const xs = o.map((p) => p.x);
    const ys = o.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const cross: [Vec2, Vec2][] =
      o.length === 4
        ? [
            [o[0], o[2]],
            [o[1], o[3]],
          ]
        : [
            [{ x: x0, y: y0 }, { x: x1, y: y1 }],
            [{ x: x1, y: y0 }, { x: x0, y: y1 }],
          ];
    return { outline: polyPath(o), cross: segPath(cross), caps: layout.caps.map(polyPath).join(''), at: interiorPoint(o) };
  }, [opening, layout]);
  if (!opening || !paths || !isVisible(opening.phase, viewMode)) return null;
  return (
    <g className={`floor-opening phase-${shownPhase(opening.phase, viewMode)}${selected ? ' is-selected' : ''}`} data-floor-opening-id={openingId}>
      <path className="floor-opening-body" d={paths.outline} vectorEffect="non-scaling-stroke" />
      {paths.cross && <path className="floor-opening-cross" d={paths.cross} vectorEffect="non-scaling-stroke" />}
      {paths.caps && <path className="floor-opening-rail" d={paths.caps} vectorEffect="non-scaling-stroke" />}
      <g transform={`translate(${paths.at.x} ${paths.at.y}) scale(${1 / k})`} className="floor-opening-label">
        <text textAnchor="middle" dominantBaseline="central">
          Open to below
        </text>
      </g>
      {selected && <OutlineHandles outline={opening.outline} className="deck-handle" />}
    </g>
  );
});

/** The level's floor openings, over the room fills and under the decks and roofs. Picking is done by the tools (selectTool hitTest). */
const FloorOpeningsLayer = memo(function FloorOpeningsLayer({ levelId }: { levelId: Id }) {
  const ids = useEntityIds(levelId, 'floorOpenings');
  const tool = useLayerUi((s) => s.activeTool);
  if (ids.length === 0) return null;
  return (
    <g className="layer-floor-openings" pointerEvents={tool === 'select' || tool === 'floorOpening' ? 'auto' : 'none'}>
      {ids.map((id) => (
        <FloorOpeningShape key={id} levelId={levelId} openingId={id} />
      ))}
    </g>
  );
});

/** A roof's plan paths, built once per roof object. */
const roofPathCache = new WeakMap<Roof, { outline: string; overhang: string; ridge: string }>();
function roofPaths(roof: Roof) {
  let hit = roofPathCache.get(roof);
  if (!hit) {
    hit = { outline: polyPath(roof.outline), overhang: polyPath(roofOutlineWithOverhang(roof)), ridge: segPath(roofRidgeLines(roof)) };
    roofPathCache.set(roof, hit);
  }
  return hit;
}

/**
 * A roof on the plan: the overhang outline lighter, the outline it bears on dashed, the ridge (or
 * hip lines) solid and thin; demolished roofs hatched red, new ones green, like walls. A selected
 * roof shows handles on its outline corners (the select tool drags them). `ghost`: the level
 * below's roof, faint and never selected.
 */
const RoofShape = memo(function RoofShape({ levelId, roofId, ghost }: { levelId: Id; roofId: Id; ghost?: boolean }) {
  const roof = useLayerPlan((s) => s.plan.levels[levelId]?.roofs?.[roofId]);
  const viewMode = useLayerUi((s) => s.viewMode);
  const selected = useLayerUi((s) => !ghost && s.selection.roofs.includes(roofId));
  if (!roof || !isVisible(roof.phase, viewMode)) return null;
  const d = roofPaths(roof);
  return (
    <g className={`roof phase-${shownPhase(roof.phase, viewMode)}${selected ? ' is-selected' : ''}${ghost ? ' roof-ghost' : ''}`} data-roof-id={ghost ? undefined : roofId}>
      <path className="roof-overhang" d={d.overhang} vectorEffect="non-scaling-stroke" />
      <path className="roof-outline" d={d.outline} vectorEffect="non-scaling-stroke" />
      {d.ridge && <path className="roof-ridge" d={d.ridge} vectorEffect="non-scaling-stroke" />}
      {selected && <OutlineHandles outline={roof.outline} className="roof-handle" />}
    </g>
  );
});

/** Corner handles of a selected roof or deck, constant on screen (only these follow the zoom). */
function OutlineHandles({ outline, className }: { outline: readonly Vec2[]; className: string }) {
  const k = useLayerUi(viewportScale);
  return (
    <>
      {outline.map((p, i) => (
        <rect key={i} className={className} x={p.x - 4 / k} y={p.y - 4 / k} width={8 / k} height={8 / k} vectorEffect="non-scaling-stroke" />
      ))}
    </>
  );
}

/**
 * A deck on the plan (DESIGN.md "Decks"): the outline filled light with the board joints, the
 * railing caps as bands (open where a flight of stairs reaches the deck), the support posts as
 * small dashed squares and a "Deck" label with its top against the floor; demolished hatched red,
 * new green, like roofs. A selected deck shows handles on its corners.
 */
const DeckShape = memo(function DeckShape({ levelId, deckId }: { levelId: Id; deckId: Id }) {
  const deck = useLayerPlan((s) => s.plan.levels[levelId]?.decks?.[deckId]);
  const viewMode = useLayerUi((s) => s.viewMode);
  const layout = useLayerPlan((s) => getDeckLayout(s.plan, levelId, deckId, viewMode));
  const selected = useLayerUi((s) => s.selection.decks.includes(deckId));
  const k = useLayerUi(viewportScale);
  const denom = useLayerPlan((s) => s.plan.settings.precisionDenominator);
  const paths = useMemo(
    () =>
      deck && layout
        ? {
            outline: polyPath(deck.outline),
            boards: segPath(layout.boardLines),
            caps: layout.caps.map(polyPath).join(''),
            posts: layout.posts.map((p) => polyPath(p.poly)).join(''),
            at: interiorPoint(deck.outline),
          }
        : null,
    [deck, layout],
  );
  if (!deck || !paths || !isVisible(deck.phase, viewMode)) return null;
  return (
    <g className={`deck phase-${shownPhase(deck.phase, viewMode)}${selected ? ' is-selected' : ''}`} data-deck-id={deckId}>
      <path className="deck-fill" d={paths.outline} vectorEffect="non-scaling-stroke" />
      {paths.boards && <path className="deck-boards" d={paths.boards} vectorEffect="non-scaling-stroke" />}
      {paths.posts && <path className="deck-post" d={paths.posts} vectorEffect="non-scaling-stroke" />}
      {paths.caps && <path className="deck-rail" d={paths.caps} vectorEffect="non-scaling-stroke" />}
      <g transform={`translate(${paths.at.x} ${paths.at.y}) scale(${1 / k})`} className="deck-label">
        <text className="deck-name" textAnchor="middle" y={-7} dominantBaseline="central">
          Deck
        </text>
        <text className="deck-top" textAnchor="middle" y={8} dominantBaseline="central">
          {deckTopWords(deck.elevation, denom)}
        </text>
      </g>
      {selected && <OutlineHandles outline={deck.outline} className="deck-handle" />}
    </g>
  );
});

/**
 * The level's decks, over the room fills and stair holes and under the roofs (an overhang draws over
 * the deck it shelters). Picking is done by the tools (selectTool hitTest).
 */
const DecksLayer = memo(function DecksLayer({ levelId }: { levelId: Id }) {
  const ids = useEntityIds(levelId, 'decks');
  const tool = useLayerUi((s) => s.activeTool);
  if (ids.length === 0) return null;
  return (
    <g className="layer-decks" pointerEvents={tool === 'select' || tool === 'deck' ? 'auto' : 'none'}>
      {ids.map((id) => (
        <DeckShape key={id} levelId={levelId} deckId={id} />
      ))}
    </g>
  );
});

/**
 * The level's roofs, above the room fills and below the walls. Picking is done by the tools
 * (selectTool hitTest), so the layer takes pointer events (for the cursor) only in the select and
 * roof tools.
 */
const RoofsLayer = memo(function RoofsLayer({ levelId }: { levelId: Id }) {
  const ids = useEntityIds(levelId, 'roofs');
  const tool = useLayerUi((s) => s.activeTool);
  if (ids.length === 0) return null;
  return (
    <g className="layer-roofs" pointerEvents={tool === 'select' || tool === 'roof' ? 'auto' : 'none'}>
      {ids.map((id) => (
        <RoofShape key={id} levelId={levelId} roofId={id} />
      ))}
    </g>
  );
});

/** The roofs of the level below, faint, so an upper floor is drawn knowing where a lower roof is. */
const RoofGhostLayer = memo(function RoofGhostLayer({ levelId }: { levelId: Id }) {
  const belowId = useLayerPlan((s) => {
    const i = s.plan.levelOrder.indexOf(levelId);
    return i > 0 ? s.plan.levelOrder[i - 1] : null;
  });
  const ids = useLayerPlan(useShallow((s) => Object.keys((belowId && s.plan.levels[belowId]?.roofs) || NO_RECORD)));
  if (!belowId || ids.length === 0) return null;
  return (
    <g className="layer-roof-ghost" pointerEvents="none" data-ghost-roofs={belowId}>
      {ids.map((id) => (
        <RoofShape key={id} levelId={belowId} roofId={id} ghost />
      ))}
    </g>
  );
});

/** The level has an underlay and it is not hidden. */
function useUnderlayShown(levelId: Id): boolean {
  const has = useLayerPlan((s) => !!s.plan.levels[levelId]?.underlay);
  const show = useLayerUi((s) => s.showUnderlay);
  return has && show;
}

/**
 * The level's image underlay, below everything else on the level: image pixel (0,0) at `origin`,
 * each pixel `scale` inches, turned by `rotation`. Picking is done by the tools (hitUnderlay), so
 * the image only takes pointer events (for the cursor) while it can be moved: the underlay tool is
 * active, or it is selected and unlocked. Never in the wall tool, and snapping ignores it.
 */
const UnderlayLayer = memo(function UnderlayLayer({ levelId }: { levelId: Id }) {
  const u = useLayerPlan((s) => s.plan.levels[levelId]?.underlay);
  const show = useLayerUi((s) => s.showUnderlay);
  const tool = useLayerUi((s) => s.activeTool);
  const selected = useLayerUi((s) => s.underlaySelected);
  if (!u || !show) return null;
  const interactive = !u.locked && (tool === 'underlay' || (selected && tool === 'select'));
  const transform = `translate(${u.origin.x} ${u.origin.y}) rotate(${u.rotation}) scale(${u.scale})`;
  return (
    <g
      className={`layer-underlay${selected ? ' is-selected' : ''}${u.locked ? ' is-locked' : ''}`}
      pointerEvents={interactive ? 'auto' : 'none'}
      data-underlay-level={levelId}
    >
      <image
        className="underlay-image"
        href={u.image}
        x={0}
        y={0}
        width={u.pixelWidth}
        height={u.pixelHeight}
        preserveAspectRatio="none"
        opacity={u.opacity}
        transform={transform}
      />
      {selected && (
        <rect
          className="underlay-outline"
          x={0}
          y={0}
          width={u.pixelWidth}
          height={u.pixelHeight}
          transform={transform}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
});

// Room fills and labels follow the entity pattern: the layer selects only the list of face ids
// (stable while a corner is dragged: a face id hashes its boundary nodes) and each face component
// selects primitive values of its own face, so a drag step re-renders only the faces it reshaped.

const NO_IDS: readonly Id[] = [];
const faceIndex = new WeakMap<FaceSet, Map<string, Face>>();
function findFace(set: FaceSet, id: string): Face | undefined {
  let byId = faceIndex.get(set);
  if (!byId) faceIndex.set(set, (byId = new Map(set.faces.map((f) => [f.id, f]))));
  return byId.get(id);
}

/** A primitive value of the level's face set in the current view mode, `fallback` when absent. */
function useFaceSetValue<T extends string | number | boolean | null>(levelId: Id, pick: (set: FaceSet, level: Level) => T, fallback: T): T {
  const viewMode = useLayerUi((s) => s.viewMode);
  return useLayerPlan((s) => {
    const level = s.plan.levels[levelId];
    return level ? pick(getFaces(level, viewMode), level) : fallback;
  });
}

/** Ids of an array-valued part of the level's face set, as the same array while they are unchanged. */
function useFaceSetIds(levelId: Id, pick: (set: FaceSet) => readonly Id[]): readonly Id[] {
  const viewMode = useLayerUi((s) => s.viewMode);
  return useLayerPlan(
    useShallow((s) => {
      const level = s.plan.levels[levelId];
      return level ? pick(getFaces(level, viewMode)) : NO_IDS;
    }),
  );
}

/** A face's net outline as a path, built once per face object (every face's fill selects it). */
const facePaths = new WeakMap<Face, string>();
function facePath(f: Face): string {
  let d = facePaths.get(f);
  if (d === undefined) facePaths.set(f, (d = polyPath(f.netPolygon)));
  return d;
}

const faceIdsOf = (set: FaceSet) => set.faces.map((f) => f.id);
const orphanIdsOf = (set: FaceSet) => set.orphanRoomIds;

const RoomFill = memo(function RoomFill({ levelId, faceId, tint }: { levelId: Id; faceId: string; tint: number }) {
  const d = useFaceSetValue(levelId, (set) => {
    const f = findFace(set, faceId);
    return f ? facePath(f) : null;
  }, null);
  const roomId = useFaceSetValue(levelId, (set) => findFace(set, faceId)?.roomId ?? null, null);
  const selected = useLayerUi((s) => roomId !== null && s.selection.rooms.includes(roomId));
  if (d === null) return null;
  return (
    <path
      className={`room-fill tint-${tint}${selected ? ' is-selected' : ''}`}
      d={d}
      data-face-id={faceId}
      vectorEffect="non-scaling-stroke"
    />
  );
});

/** Light tint under every enclosed area (net polygon), below the walls. */
const RoomFillsLayer = memo(function RoomFillsLayer({ levelId }: { levelId: Id }) {
  const ids = useFaceSetIds(levelId, faceIdsOf);
  // Over an underlay the tints go translucent so the image still shows through traced rooms.
  const overUnderlay = useUnderlayShown(levelId);
  if (ids.length === 0) return null;
  return (
    <g className={`layer-room-fills${overUnderlay ? ' over-underlay' : ''}`} pointerEvents="none">
      {ids.map((id, i) => (
        <RoomFill key={id} levelId={levelId} faceId={id} tint={i % ROOM_TINTS} />
      ))}
    </g>
  );
});

/** A room name (null for none) and an area line at a world point, constant on screen. */
function RoomLabelGroup({
  className,
  roomId,
  faceId,
  x,
  y,
  name,
  area,
  wrap = ROOM_NAME_WRAP,
}: {
  className: string;
  roomId: Id | undefined;
  faceId: string | undefined;
  x: number;
  y: number;
  name: string | null;
  /** Null hides the area line. */
  area: string | null;
  /** The name wraps onto a second line past this many characters (roomLabels.ts nameWrapFor). */
  wrap?: number;
}) {
  const k = useLayerUi(viewportScale);
  if (name === null && area === null) return null;
  // A long name wraps onto two lines; the first moves up so the last stays just above the area.
  const lines = name !== null ? roomNameLines(name, wrap) : [];
  const top = ROOM_NAME_DY - (lines.length - 1) * ROOM_NAME_LINE_PX;
  return (
    <g className={className} data-room-id={roomId} data-face-id={faceId} transform={`translate(${x} ${y}) scale(${1 / k})`}>
      {name !== null && (
        <text className="room-name" y={top} textAnchor="middle" dominantBaseline="central">
          {lines.length === 1
            ? name
            : lines.map((line, i) => (
                <tspan key={i} x={0} y={top + i * ROOM_NAME_LINE_PX}>
                  {line}
                </tspan>
              ))}
        </text>
      )}
      {area !== null && (
        <text className="room-area" y={name !== null ? ROOM_AREA_DY : 0} textAnchor="middle" dominantBaseline="central">
          {area}
        </text>
      )}
    </g>
  );
}

/** The shorter side of a face's bounding box, in inches (cached per face). */
const faceSpans = new WeakMap<Face, number>();
function faceSpan(f: Face): number {
  let span = faceSpans.get(f);
  if (span === undefined) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of f.netPolygon) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    faceSpans.set(f, (span = Math.min(maxX - minX, maxY - minY)));
  }
  return span;
}

/**
 * The label of a face: its room's name, if a room names it, and its net area. In a small room the
 * labels thin out so they never run over the walls: the area goes when the face's bounding box is
 * under 60 px on either side, the name under 40 px.
 */
const FaceLabel = memo(function FaceLabel({ levelId, faceId }: { levelId: Id; faceId: string }) {
  const x = useFaceSetValue(levelId, (set) => findFace(set, faceId)?.labelPoint.x ?? 0, 0);
  const y = useFaceSetValue(levelId, (set) => findFace(set, faceId)?.labelPoint.y ?? 0, 0);
  const area = useFaceSetValue(levelId, (set) => {
    const f = findFace(set, faceId);
    return f ? formatArea(f.netArea) : '';
  }, '');
  const roomId = useFaceSetValue(levelId, (set, level) => {
    const id = findFace(set, faceId)?.roomId;
    return id && level.rooms[id] ? id : null;
  }, null);
  const name = useLayerPlan((s) => (roomId ? (s.plan.levels[levelId]?.rooms[roomId]?.name ?? null) : null));
  const span = useFaceSetValue(levelId, (set) => {
    const f = findFace(set, faceId);
    return f ? faceSpan(f) : 0;
  }, 0);
  const width = useFaceSetValue(levelId, (set) => {
    const f = findFace(set, faceId);
    return f ? faceWidth(f) : 0;
  }, 0);
  const k = useLayerUi(viewportScale);
  const selected = useLayerUi((s) => roomId !== null && s.selection.rooms.includes(roomId));
  const editing = useLayerUi((s) => roomId !== null && s.roomEdit?.roomId === roomId);
  if (editing) return null;
  const px = span * k;
  const wrap = nameWrapFor(width, k);
  return (
    <RoomLabelGroup
      className={`room-label${roomId ? '' : ' unlabeled'}${selected ? ' is-selected' : ''}`}
      roomId={roomId ?? undefined}
      faceId={faceId}
      x={x}
      y={y}
      name={roomId && px >= MIN_ROOM_NAME_PX ? name : null}
      area={px >= MIN_ROOM_AREA_PX ? area : null}
      wrap={wrap}
    />
  );
});

/** A room whose anchor is in no face, or in one an earlier room names: a warning at its anchor. */
const OrphanLabel = memo(function OrphanLabel({ levelId, roomId }: { levelId: Id; roomId: Id }) {
  const room = useLayerPlan((s) => s.plan.levels[levelId]?.rooms[roomId]);
  const shared = useFaceSetValue(levelId, (set, level) => {
    const r = level.rooms[roomId];
    return !!r && !!faceAt(set, r.anchor);
  }, false);
  const selected = useLayerUi((s) => s.selection.rooms.includes(roomId));
  const editing = useLayerUi((s) => s.roomEdit?.roomId === roomId);
  if (!room || editing) return null;
  return (
    <RoomLabelGroup
      className={`room-label orphan${selected ? ' is-selected' : ''}`}
      roomId={roomId}
      faceId={undefined}
      x={room.anchor.x}
      y={room.anchor.y}
      name={room.name}
      area={shared ? 'shares an area' : 'not enclosed'}
    />
  );
});

const RoomAnchor = memo(function RoomAnchor({ levelId, roomId }: { levelId: Id; roomId: Id }) {
  const anchor = useLayerPlan((s) => s.plan.levels[levelId]?.rooms[roomId]?.anchor);
  const k = useLayerUi(viewportScale);
  return anchor ? <circle className="room-anchor" cx={anchor.x} cy={anchor.y} r={3.5 / k} /> : null;
});

/**
 * Room names and net areas at each face's label point, constant on screen. Unlabeled faces show
 * only their area; rooms whose anchor is in no face (or shares one) show at the anchor in a warning
 * colour (the same labels as roomLabels(), which picking uses). Picking is done by the tools
 * (roomLabels.ts), so the layer only takes pointer events (for the cursor) while the select or
 * room tool is active.
 */
const RoomLabelsLayer = memo(function RoomLabelsLayer({ levelId }: { levelId: Id }) {
  const faceIds = useFaceSetIds(levelId, faceIdsOf);
  const orphanIds = useFaceSetIds(levelId, orphanIdsOf);
  const tool = useLayerUi((s) => s.activeTool);
  const selected = useLayerUi((s) => s.selection.rooms);
  if (faceIds.length === 0 && orphanIds.length === 0) return null;
  const pickable = tool === 'select' || tool === 'room';
  return (
    <g className={`layer-room-labels${pickable ? ' pickable' : ''}`} pointerEvents={pickable ? 'auto' : 'none'}>
      {faceIds.map((id) => (
        <FaceLabel key={id} levelId={levelId} faceId={id} />
      ))}
      {orphanIds.map((id) => (
        <OrphanLabel key={`orphan-${id}`} levelId={levelId} roomId={id} />
      ))}
      {selected.map((id) => (
        <RoomAnchor key={`anchor-${id}`} levelId={levelId} roomId={id} />
      ))}
    </g>
  );
});

/** Small red circles on wall ends that join nothing (the loop is not closed there). */
const OpenEndsLayer = memo(function OpenEndsLayer({ levelId }: { levelId: Id }) {
  const set = useFaceSet(levelId);
  const nodes = useLayerPlan((s) => s.plan.levels[levelId]?.nodes);
  const k = useLayerUi(viewportScale);
  if (!set || !nodes || set.openEnds.length === 0) return null;
  return (
    <g className="layer-open-ends" pointerEvents="none">
      {set.openEnds.map((id) => {
        const n = nodes[id];
        return n ? <circle key={id} className="open-end" data-node-id={id} cx={n.x} cy={n.y} r={OPEN_END_PX / k} /> : null;
      })}
    </g>
  );
});

const OpeningsLayer = memo(function OpeningsLayer({ levelId }: { levelId: Id }) {
  const ids = useEntityIds(levelId, 'openings');
  return (
    <g className="layer-openings">
      {ids.map((id) => (
        <OpeningShape key={id} levelId={levelId} openingId={id} />
      ))}
    </g>
  );
});

const LabelsLayer = memo(function LabelsLayer({ levelId }: { levelId: Id }) {
  const ids = useEntityIds(levelId, 'walls');
  return (
    <g className="layer-labels" pointerEvents="none">
      {ids.map((id) => (
        <DimensionLabel key={id} levelId={levelId} wallId={id} />
      ))}
    </g>
  );
});

const NodesLayer = memo(function NodesLayer({ levelId }: { levelId: Id }) {
  const ids = useEntityIds(levelId, 'nodes');
  return (
    <g className="layer-nodes" pointerEvents="none">
      {ids.map((id) => (
        <NodeDot key={id} levelId={levelId} nodeId={id} />
      ))}
    </g>
  );
});

/**
 * Faint, non-interactive outline of another level's walls (the level below), for aligning upper
 * floors. Openings are ignored; the view mode still applies.
 */
export const GhostLevel = memo(function GhostLevel({ levelId }: { levelId: Id }) {
  const level = useLayerPlan((s) => s.plan.levels[levelId]);
  const viewMode = useLayerUi((s) => s.viewMode);
  const d = useMemo(() => {
    if (!level) return '';
    let path = '';
    for (const fp of getFootprints(level, viewMode).values()) path += polyPath(fp.poly);
    return path;
  }, [level, viewMode]);
  if (!d) return null;
  return (
    <g className="layer-ghost" pointerEvents="none" data-ghost-level={levelId}>
      <path className="ghost-wall" d={d} vectorEffect="non-scaling-stroke" />
    </g>
  );
});

// ---------------------------------------------------------------------------------------------
// Site layer (site mode): grade points and columns over the first floor's ghost.

/** A grade point: a small triangle with its elevation beside it, constant on screen. */
const GradePointShape = memo(function GradePointShape({ pointId }: { pointId: Id }) {
  const g = useLayerPlan((s) => s.plan.site.gradePoints[pointId]);
  const denom = useLayerPlan((s) => s.plan.settings.precisionDenominator);
  const selected = useLayerUi((s) => s.selection.gradePoints.includes(pointId));
  const k = useLayerUi(viewportScale);
  if (!g) return null;
  return (
    <g className={`grade-point${selected ? ' is-selected' : ''}`} data-grade-id={pointId} transform={`translate(${g.at.x} ${g.at.y}) scale(${1 / k})`}>
      <path className="grade-tri" d="M0 -7L6.5 5L-6.5 5Z" />
      <text className="grade-label" x={10} y={4}>
        {formatLengthCompact(g.elevation, denom)}
      </text>
    </g>
  );
});

/** A column's plan rectangle (a flue's circle): chimneys hatched like brick, posts and flues solid; demo hatched red, new green. */
const ColumnShape = memo(function ColumnShape({ columnId }: { columnId: Id }) {
  const c = useLayerPlan((s) => s.plan.site.columns[columnId]);
  const viewMode = useLayerUi((s) => s.viewMode);
  const selected = useLayerUi((s) => s.selection.columns.includes(columnId));
  if (!c || !isVisible(c.phase, viewMode)) return null;
  return (
    <g
      className={`column column-${c.kind} phase-${shownPhase(c.phase, viewMode)}${selected ? ' is-selected' : ''}`}
      data-column-id={columnId}
      transform={`translate(${c.at.x} ${c.at.y}) rotate(${c.rotation})`}
    >
      {c.kind === 'flue' ? (
        <circle className="column-body" r={c.width / 2} vectorEffect="non-scaling-stroke" />
      ) : (
        <rect className="column-body" x={-c.width / 2} y={-c.depth / 2} width={c.width} height={c.depth} vectorEffect="non-scaling-stroke" />
      )}
    </g>
  );
});

/** The site's grade points and columns (picking is done by the select tool, hitSite). */
const SiteLayer = memo(function SiteLayer() {
  const pointIds = useLayerPlan(useShallow((s) => Object.keys(s.plan.site.gradePoints)));
  const columnIds = useLayerPlan(useShallow((s) => Object.keys(s.plan.site.columns)));
  return (
    <g className="layer-site" pointerEvents="none">
      <g className="layer-columns">
        {columnIds.map((id) => (
          <ColumnShape key={id} columnId={id} />
        ))}
      </g>
      <g className="layer-grade-points">
        {pointIds.map((id) => (
          <GradePointShape key={id} pointId={id} />
        ))}
      </g>
    </g>
  );
});

/** Every level's roofs as faint ghosts, so a post is placed knowing where the roofs are. */
const SiteRoofGhosts = memo(function SiteRoofGhosts() {
  const keys = useLayerPlan(
    useShallow((s) => s.plan.levelOrder.flatMap((lid) => Object.keys(s.plan.levels[lid]?.roofs ?? NO_RECORD).map((rid) => `${lid}|${rid}`))),
  );
  if (keys.length === 0) return null;
  return (
    <g className="layer-roof-ghost" pointerEvents="none">
      {keys.map((k) => {
        const [lid, rid] = k.split('|');
        return <RoofShape key={k} levelId={lid} roofId={rid} ghost />;
      })}
    </g>
  );
});

/** What the 2D view shows in site mode: the first floor as a ghost, the roofs faintly, the site layer on top. */
export const SiteView = memo(function SiteView() {
  const ghostId = useLayerPlan((s) => siteGhostLevelId(s.plan));
  return (
    <>
      <PatternDefs />
      <g className="site-ghost">{ghostId && <GhostLevel levelId={ghostId} />}</g>
      <SiteRoofGhosts />
      <SiteLayer />
    </>
  );
});

export const PlanLayers = memo(function PlanLayers({ levelId }: { levelId: Id }) {
  return (
    <>
      <PatternDefs />
      <UnderlayLayer levelId={levelId} />
      <RoomFillsLayer levelId={levelId} />
      <StairHolesLayer levelId={levelId} />
      <FloorOpeningsLayer levelId={levelId} />
      <DecksLayer levelId={levelId} />
      <RoofGhostLayer levelId={levelId} />
      <RoofsLayer levelId={levelId} />
      <StairsLayer levelId={levelId} />
      <FixturesLayer levelId={levelId} />
      <WallsLayer levelId={levelId} />
      <OpeningsLayer levelId={levelId} />
      <RoomLabelsLayer levelId={levelId} />
      <LabelsLayer levelId={levelId} />
      <OpenEndsLayer levelId={levelId} />
      <NodesLayer levelId={levelId} />
    </>
  );
});
