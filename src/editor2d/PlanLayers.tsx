import { memo, useMemo } from 'react';
import { getFootprints, type Footprint } from '../derive/footprint';
import { arcPath, getOpeningsByWall, openingSymbol, wallPieces, type WallPieces } from '../derive/openings';
import { isOpeningVisible, isVisible } from '../derive/phase';
import { getFaces, type FaceSet } from '../derive/rooms';
import { add, midpoint, polygonSignedArea, scale } from '../model/geometry';
import type { Id, Opening, Vec2, ViewMode, Wall } from '../model/types';
import { formatArea, formatLengthCompact } from '../model/units';
import { usePlanStore } from '../store/planStore';
import { useUiStore, useViewportScale } from '../store/uiStore';
import { outlinePath } from './outline';
import { ROOM_AREA_DY, ROOM_NAME_DY, roomLabels } from './roomLabels';

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

const wallClass = (wall: Wall, selected: boolean, hovered: boolean) =>
  `wall wall-${wall.kind} phase-${wall.phase}${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}`;

/** Paint order of fill groups: where two styles meet, the later one's hairline wins consistently. */
const fillRank = (wall: Wall, selected: boolean, hovered: boolean) =>
  (selected ? 40 : hovered ? 30 : 0) + (wall.phase === 'demo' ? 0 : wall.phase === 'new' ? 10 : 20) + (wall.kind === 'interior' ? 0 : 1);

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

/**
 * Wall fills and outlines, merged into one path per style (kind, phase, selection, hover).
 *
 * Separate shapes that share an edge leave a faint anti-aliasing seam (or a doubled dot where two
 * strokes end) however they are drawn. One fill path with consistent winding has no internal edges,
 * and outline segments chained into polylines meet in line joins, so mitred corners and the two
 * halves of a wall split by a T read as one solid with one outline. The outline is the long edges (trimmed
 * where a T's butt wall meets the face), opening jambs, and end caps only at open ends and bevels:
 * never at joins. All fills are painted before all outlines.
 *
 * Each group lists its walls in data-wall-ids. Fills and outlines are recomputed for the whole
 * level on change; per-wall pieces are cached on the footprint object, which keeps its identity
 * while the wall is unchanged.
 */
function useWallGroups(levelId: Id): StyleGroup[] {
  const level = usePlanStore((s) => s.plan.levels[levelId]);
  const viewMode = useUiStore((s) => s.viewMode);
  const selected = useUiStore((s) => s.selection.walls);
  const hovered = useUiStore((s) => s.hover.wallId);
  return useMemo(() => {
    if (!level) return [];
    const fps = getFootprints(level, viewMode);
    const byWall = getOpeningsByWall(level);
    const map = new Map<string, StyleGroup>();
    for (const wall of Object.values(level.walls)) {
      const fp = fps.get(wall.id);
      if (!fp) continue;
      const sel = selected.includes(wall.id);
      const hov = hovered === wall.id;
      const cls = wallClass(wall, sel, hov);
      const pieces = wallPiecesFor(fp, wall, byWall.get(wall.id), viewMode);
      const fill = pieces.fills.map(orientedPath).join('');
      const edges = pieces.edges;
      const g = map.get(cls);
      if (g) {
        g.ids.push(wall.id);
        g.fill += fill;
        g.segs.push(...edges);
      } else map.set(cls, { cls, rank: fillRank(wall, sel, hov), ids: [wall.id], fill, segs: [...edges], edge: '' });
    }
    for (const g of map.values()) g.edge = outlinePath(g.segs);
    return [...map.values()].sort((p, q) => p.rank - q.rank);
  }, [level, viewMode, selected, hovered]);
}

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
      <g className="layer-wall-edges" pointerEvents="none">
        {groups.map((g) => (
          <g key={g.cls} className={g.cls} data-wall-ids={g.ids.join(' ')}>
            <path className="wall-edge" d={g.edge} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </g>
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

function useWallIds(levelId: Id): Id[] {
  const walls = usePlanStore((s) => s.plan.levels[levelId]?.walls);
  return useMemo(() => (walls ? Object.keys(walls) : []), [walls]);
}

function useNodeIds(levelId: Id): Id[] {
  const nodes = usePlanStore((s) => s.plan.levels[levelId]?.nodes);
  return useMemo(() => (nodes ? Object.keys(nodes) : []), [nodes]);
}

function useOpeningIds(levelId: Id): Id[] {
  const openings = usePlanStore((s) => s.plan.levels[levelId]?.openings);
  return useMemo(() => (openings ? Object.keys(openings) : []), [openings]);
}

/** Light tint under every enclosed area (net polygon), below the walls. */
const RoomFillsLayer = memo(function RoomFillsLayer({ levelId }: { levelId: Id }) {
  const set = useFaceSet(levelId);
  const selected = useUiStore((s) => s.selection.rooms);
  if (!set || set.faces.length === 0) return null;
  return (
    <g className="layer-room-fills" pointerEvents="none">
      {set.faces.map((f, i) => (
        <path
          key={f.id}
          className={`room-fill tint-${i % ROOM_TINTS}${f.roomId && selected.includes(f.roomId) ? ' is-selected' : ''}`}
          d={polyPath(f.netPolygon)}
          data-face-id={f.id}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
});

/**
 * Room names and net areas at each face's label point, constant on screen. Unlabeled faces show
 * only their area; rooms whose anchor is in no face (or shares one) show at the anchor in a warning
 * colour. Picking is done by the tools (roomLabels.ts), so the layer only takes pointer events
 * (for the cursor) while the select or room tool is active.
 */
const RoomLabelsLayer = memo(function RoomLabelsLayer({ levelId }: { levelId: Id }) {
  const set = useFaceSet(levelId);
  const level = usePlanStore((s) => s.plan.levels[levelId]);
  const k = useViewportScale();
  const tool = useUiStore((s) => s.activeTool);
  const selected = useUiStore((s) => s.selection.rooms);
  const editing = useUiStore((s) => s.roomEdit?.roomId ?? null);
  const labels = useMemo(() => (level && set ? roomLabels(level, set) : []), [level, set]);
  if (labels.length === 0) return null;
  const pickable = tool === 'select' || tool === 'room';
  return (
    <g className={`layer-room-labels${pickable ? ' pickable' : ''}`} pointerEvents={pickable ? 'auto' : 'none'}>
      {labels.map((l) => {
        const id = l.room?.id;
        const isSel = !!id && selected.includes(id);
        if (id && id === editing) return null;
        const cls = `room-label${l.room ? '' : ' unlabeled'}${l.orphan ? ' orphan' : ''}${isSel ? ' is-selected' : ''}`;
        return (
          <g
            key={l.face ? l.face.id : `orphan-${id}`}
            className={cls}
            data-room-id={id}
            data-face-id={l.face?.id}
            transform={`translate(${l.at.x} ${l.at.y}) scale(${1 / k})`}
          >
            {l.room && (
              <text className="room-name" y={ROOM_NAME_DY} textAnchor="middle" dominantBaseline="central">
                {l.room.name}
              </text>
            )}
            <text className="room-area" y={l.room ? ROOM_AREA_DY : 0} textAnchor="middle" dominantBaseline="central">
              {l.face ? formatArea(l.face.netArea) : l.orphan === 'shared' ? 'shares an area' : 'not enclosed'}
            </text>
          </g>
        );
      })}
      {selected.map((id) => {
        const room = level?.rooms[id];
        if (!room) return null;
        return <circle key={`anchor-${id}`} className="room-anchor" cx={room.anchor.x} cy={room.anchor.y} r={3.5 / k} />;
      })}
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
  const ids = useOpeningIds(levelId);
  return (
    <g className="layer-openings">
      {ids.map((id) => (
        <OpeningShape key={id} levelId={levelId} openingId={id} />
      ))}
    </g>
  );
});

const LabelsLayer = memo(function LabelsLayer({ levelId }: { levelId: Id }) {
  const ids = useWallIds(levelId);
  return (
    <g className="layer-labels" pointerEvents="none">
      {ids.map((id) => (
        <DimensionLabel key={id} levelId={levelId} wallId={id} />
      ))}
    </g>
  );
});

const NodesLayer = memo(function NodesLayer({ levelId }: { levelId: Id }) {
  const ids = useNodeIds(levelId);
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
      <RoomFillsLayer levelId={levelId} />
      <WallsLayer levelId={levelId} />
      <OpeningsLayer levelId={levelId} />
      <RoomLabelsLayer levelId={levelId} />
      <LabelsLayer levelId={levelId} />
      <OpenEndsLayer levelId={levelId} />
      <NodesLayer levelId={levelId} />
    </>
  );
});
