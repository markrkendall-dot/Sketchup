import { memo, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getFootprints, type Footprint } from '../derive/footprint';
import { arcPath, getOpeningsByWall, openingSymbol, wallPieces, type WallPieces } from '../derive/openings';
import { isOpeningVisible, isVisible } from '../derive/phase';
import { faceAt, getFaces, type Face, type FaceSet } from '../derive/rooms';
import { floorToFloor, stairsSymbol, stairSteps, type StairsSymbol } from '../derive/stairs';
import { add, midpoint, polygonSignedArea, scale } from '../model/geometry';
import type { Id, Level, Opening, Vec2, ViewMode, Wall } from '../model/types';
import { formatArea, formatLengthCompact } from '../model/units';
import { usePlanStore } from '../store/planStore';
import { useUiStore, useViewportScale } from '../store/uiStore';
import { outlinePath } from './outline';
import { ROOM_AREA_DY, ROOM_NAME_DY } from './roomLabels';

/** Gap between a wall face and its dimension label, in screen px. */
const LABEL_GAP_PX = 11;
/** Hide labels on walls shorter than this on screen. */
const MIN_LABEL_WALL_PX = 34;
/** Spacing of the demolition hatch, in screen px. */
const HATCH_PX = 7;
/** Radius of the open wall end markers, screen px. */
const OPEN_END_PX = 4.5;
/** Room tints cycle through this many classes. */
const ROOM_TINTS = 4;
export const HATCH_DEMO_ID = 'hp-hatch-demo';

const pt = (p: Vec2) => `${p.x},${p.y}`;
const segPath = (segs: readonly (readonly [Vec2, Vec2])[]) => segs.map(([p, q]) => `M${pt(p)}L${pt(q)}`).join('');
const polyPath = (poly: readonly Vec2[]) => `M${poly.map(pt).join('L')}Z`;

/** A wall's footprint in the current view mode (undefined while the wall is hidden). */
function useFootprint(levelId: Id, wallId: Id | undefined): Footprint | undefined {
  const viewMode = useUiStore((s) => s.viewMode);
  return usePlanStore((s) => {
    const level = s.plan.levels[levelId];
    return level && wallId ? getFootprints(level, viewMode).get(wallId) : undefined;
  });
}

/** Faces, open ends and room labels of a level in the current view mode (memoized). */
function useFaceSet(levelId: Id): FaceSet | null {
  const viewMode = useUiStore((s) => s.viewMode);
  return usePlanStore((s) => {
    const level = s.plan.levels[levelId];
    return level ? getFaces(level, viewMode) : null;
  });
}

/** Hatch pattern for demolished walls; sized in world units so it stays constant on screen. */
const PatternDefs = memo(function PatternDefs() {
  const k = useViewportScale();
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

const wallClass = (wall: Wall) => `wall wall-${wall.kind} phase-${wall.phase}`;

/** Paint order of fill groups: where two styles meet, the later one's hairline wins consistently. */
const fillRank = (wall: Wall) => (wall.phase === 'demo' ? 0 : wall.phase === 'new' ? 10 : 20) + (wall.kind === 'interior' ? 0 : 1);

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
  const viewMode = useUiStore((s) => s.viewMode);
  const walls = usePlanStore((s) => s.plan.levels[levelId]?.walls);
  const fps = usePlanStore((s) => {
    const level = s.plan.levels[levelId];
    return level ? getFootprints(level, viewMode) : undefined;
  });
  const byWall = usePlanStore((s) => {
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
      if (fp) addToGroup(map, wallClass(wall), fillRank(wall), wall, fp, byWall, viewMode);
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
  const selected = useUiStore((s) => s.selection.walls);
  const hovered = useUiStore((s) => s.hover.wallId);
  return useMemo(() => {
    if (!walls || !fps || !byWall || (selected.length === 0 && !hovered)) return [];
    const map = new Map<string, StyleGroup>();
    const add = (id: Id) => {
      const wall = walls[id];
      const fp = fps.get(id);
      if (!wall || !fp) return;
      const sel = selected.includes(id);
      const hov = hovered === id;
      const cls = `${wallClass(wall)}${sel ? ' is-selected' : ''}${hov ? ' is-hovered' : ''}`;
      addToGroup(map, cls, (sel ? 200 : 100) + fillRank(wall), wall, fp, byWall, viewMode);
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
  const o = usePlanStore((s) => s.plan.levels[levelId]?.openings[openingId]);
  const wall = usePlanStore((s) => (o ? s.plan.levels[levelId]?.walls[o.wallId] : undefined));
  const fp = useFootprint(levelId, o?.wallId);
  const viewMode = useUiStore((s) => s.viewMode);
  const selected = useUiStore((s) => s.selection.openings.includes(openingId));
  const hovered = useUiStore((s) => s.hover.openingId === openingId);
  const sym = useMemo(() => (fp && o ? openingSymbol(fp, o) : null), [fp, o]);
  if (!o || !sym || !isOpeningVisible(o, wall, viewMode)) return null;
  const cls = `opening opening-${o.type} phase-${o.phase}${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}`;
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

const DimensionLabel = memo(function DimensionLabel({ levelId, wallId }: { levelId: Id; wallId: Id }) {
  const fp = useFootprint(levelId, wallId);
  const phase = usePlanStore((s) => s.plan.levels[levelId]?.walls[wallId]?.phase);
  const viewMode = useUiStore((s) => s.viewMode);
  const visible = !!phase && isVisible(phase, viewMode);
  const k = useViewportScale();
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  if (!fp || !visible || fp.length * k < MIN_LABEL_WALL_PX) return null;
  // Left side of a->b, just outside the wall face.
  const pos = add(midpoint(fp.a, fp.b), scale(fp.normal, fp.thickness / 2 + LABEL_GAP_PX / k));
  let angle = (Math.atan2(fp.dir.y, fp.dir.x) * 180) / Math.PI;
  if (angle > 90 || angle <= -90) angle += 180; // never upside down
  return (
    <g transform={`translate(${pos.x} ${pos.y}) rotate(${angle}) scale(${1 / k})`}>
      <text className="dim-label" textAnchor="middle" dominantBaseline="central">
        {formatLengthCompact(fp.length, denom)}
      </text>
    </g>
  );
});

const NodeDot = memo(function NodeDot({ levelId, nodeId }: { levelId: Id; nodeId: Id }) {
  const visible = useUiStore((s) => s.selection.nodes.includes(nodeId) || s.hover.nodeId === nodeId);
  const selected = useUiStore((s) => s.selection.nodes.includes(nodeId));
  const node = usePlanStore((s) => s.plan.levels[levelId]?.nodes[nodeId]);
  const k = useViewportScale();
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
function useEntityIds(levelId: Id, kind: 'walls' | 'nodes' | 'openings' | 'stairs'): Id[] {
  return usePlanStore(useShallow((s) => Object.keys(s.plan.levels[levelId]?.[kind] ?? NO_RECORD)));
}

/** Stairs symbol: outline, nosing lines, and an UP arrow pointing the way the flight climbs. */
export function StairsGlyph({ sym, k, className, id }: { sym: StairsSymbol; k: number; className: string; id?: Id }) {
  return (
    <g className={className} data-stairs-id={id}>
      <path className="stairs-body" d={polyPath(sym.outline)} vectorEffect="non-scaling-stroke" />
      {sym.treads.length > 0 && <path className="stairs-tread" d={segPath(sym.treads)} vectorEffect="non-scaling-stroke" />}
      <path className="stairs-arrow" d={segPath([sym.shaft])} vectorEffect="non-scaling-stroke" />
      <path className="stairs-arrow-head" d={`M${pt(sym.head[0])}L${pt(sym.head[1])}L${pt(sym.head[2])}`} vectorEffect="non-scaling-stroke" />
      <g transform={`translate(${sym.label.x} ${sym.label.y}) rotate(${sym.labelAngle}) scale(${1 / k})`}>
        <text className="stairs-label" textAnchor="middle" dominantBaseline="central">
          UP
        </text>
      </g>
    </g>
  );
}

const StairsShape = memo(function StairsShape({ levelId, stairsId }: { levelId: Id; stairsId: Id }) {
  const st = usePlanStore((s) => s.plan.levels[levelId]?.stairs[stairsId]);
  const ftf = usePlanStore((s) => floorToFloor(s.plan, levelId));
  const viewMode = useUiStore((s) => s.viewMode);
  const selected = useUiStore((s) => s.selection.stairs.includes(stairsId));
  const k = useViewportScale();
  const sym = useMemo(() => (st ? stairsSymbol(st, stairSteps(ftf).risers) : null), [st, ftf]);
  if (!st || !sym || !isVisible(st.phase, viewMode)) return null;
  return <StairsGlyph sym={sym} k={k} id={stairsId} className={`stairs phase-${st.phase}${selected ? ' is-selected' : ''}`} />;
});

const StairsLayer = memo(function StairsLayer({ levelId }: { levelId: Id }) {
  const ids = useEntityIds(levelId, 'stairs');
  if (ids.length === 0) return null;
  return (
    <g className="layer-stairs" pointerEvents="none">
      {ids.map((id) => (
        <StairsShape key={id} levelId={levelId} stairsId={id} />
      ))}
    </g>
  );
});

/** The level has an underlay and it is not hidden. */
function useUnderlayShown(levelId: Id): boolean {
  const has = usePlanStore((s) => !!s.plan.levels[levelId]?.underlay);
  const show = useUiStore((s) => s.showUnderlay);
  return has && show;
}

/**
 * The level's image underlay, below everything else on the level: image pixel (0,0) at `origin`,
 * each pixel `scale` inches, turned by `rotation`. Picking is done by the tools (hitUnderlay), so
 * the image only takes pointer events (for the cursor) while it can be moved: the underlay tool is
 * active, or it is selected and unlocked. Never in the wall tool, and snapping ignores it.
 */
const UnderlayLayer = memo(function UnderlayLayer({ levelId }: { levelId: Id }) {
  const u = usePlanStore((s) => s.plan.levels[levelId]?.underlay);
  const show = useUiStore((s) => s.showUnderlay);
  const tool = useUiStore((s) => s.activeTool);
  const selected = useUiStore((s) => s.underlaySelected);
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
  const viewMode = useUiStore((s) => s.viewMode);
  return usePlanStore((s) => {
    const level = s.plan.levels[levelId];
    return level ? pick(getFaces(level, viewMode), level) : fallback;
  });
}

/** Ids of an array-valued part of the level's face set, as the same array while they are unchanged. */
function useFaceSetIds(levelId: Id, pick: (set: FaceSet) => readonly Id[]): readonly Id[] {
  const viewMode = useUiStore((s) => s.viewMode);
  return usePlanStore(
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
  const selected = useUiStore((s) => roomId !== null && s.selection.rooms.includes(roomId));
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
}: {
  className: string;
  roomId: Id | undefined;
  faceId: string | undefined;
  x: number;
  y: number;
  name: string | null;
  area: string;
}) {
  const k = useViewportScale();
  return (
    <g className={className} data-room-id={roomId} data-face-id={faceId} transform={`translate(${x} ${y}) scale(${1 / k})`}>
      {name !== null && (
        <text className="room-name" y={ROOM_NAME_DY} textAnchor="middle" dominantBaseline="central">
          {name}
        </text>
      )}
      <text className="room-area" y={name !== null ? ROOM_AREA_DY : 0} textAnchor="middle" dominantBaseline="central">
        {area}
      </text>
    </g>
  );
}

/** The label of a face: its room's name, if a room names it, and its net area. */
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
  const name = usePlanStore((s) => (roomId ? (s.plan.levels[levelId]?.rooms[roomId]?.name ?? null) : null));
  const selected = useUiStore((s) => roomId !== null && s.selection.rooms.includes(roomId));
  const editing = useUiStore((s) => roomId !== null && s.roomEdit?.roomId === roomId);
  if (editing) return null;
  return (
    <RoomLabelGroup
      className={`room-label${roomId ? '' : ' unlabeled'}${selected ? ' is-selected' : ''}`}
      roomId={roomId ?? undefined}
      faceId={faceId}
      x={x}
      y={y}
      name={roomId ? name : null}
      area={area}
    />
  );
});

/** A room whose anchor is in no face, or in one an earlier room names: a warning at its anchor. */
const OrphanLabel = memo(function OrphanLabel({ levelId, roomId }: { levelId: Id; roomId: Id }) {
  const room = usePlanStore((s) => s.plan.levels[levelId]?.rooms[roomId]);
  const shared = useFaceSetValue(levelId, (set, level) => {
    const r = level.rooms[roomId];
    return !!r && !!faceAt(set, r.anchor);
  }, false);
  const selected = useUiStore((s) => s.selection.rooms.includes(roomId));
  const editing = useUiStore((s) => s.roomEdit?.roomId === roomId);
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
  const anchor = usePlanStore((s) => s.plan.levels[levelId]?.rooms[roomId]?.anchor);
  const k = useViewportScale();
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
  const tool = useUiStore((s) => s.activeTool);
  const selected = useUiStore((s) => s.selection.rooms);
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
  const nodes = usePlanStore((s) => s.plan.levels[levelId]?.nodes);
  const k = useViewportScale();
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
  const level = usePlanStore((s) => s.plan.levels[levelId]);
  const viewMode = useUiStore((s) => s.viewMode);
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

export const PlanLayers = memo(function PlanLayers({ levelId }: { levelId: Id }) {
  return (
    <>
      <PatternDefs />
      <UnderlayLayer levelId={levelId} />
      <RoomFillsLayer levelId={levelId} />
      <StairsLayer levelId={levelId} />
      <WallsLayer levelId={levelId} />
      <OpeningsLayer levelId={levelId} />
      <RoomLabelsLayer levelId={levelId} />
      <LabelsLayer levelId={levelId} />
      <OpenEndsLayer levelId={levelId} />
      <NodesLayer levelId={levelId} />
    </>
  );
});
