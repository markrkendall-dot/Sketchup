import { memo, useMemo } from 'react';
import { getFootprints, type Footprint } from '../derive/footprint';
import { getGraph } from '../derive/graph';
import { arcPath, openingsOnWall, openingSymbol, wallPieces } from '../derive/openings';
import { isOpeningVisible, isVisible } from '../derive/phase';
import { add, midpoint, scale } from '../model/geometry';
import type { Id, Vec2 } from '../model/types';
import { formatLengthCompact } from '../model/units';
import { usePlanStore } from '../store/planStore';
import { useUiStore, useViewportScale } from '../store/uiStore';

/** Gap between a wall face and its dimension label, in screen px. */
const LABEL_GAP_PX = 11;
/** Hide labels on walls shorter than this on screen. */
const MIN_LABEL_WALL_PX = 34;
/** Spacing of the demolition hatch, in screen px. */
const HATCH_PX = 7;
export const HATCH_DEMO_ID = 'hp-hatch-demo';

const pt = (p: Vec2) => `${p.x},${p.y}`;
const segPath = (segs: readonly (readonly [Vec2, Vec2])[]) => segs.map(([p, q]) => `M${pt(p)}L${pt(q)}`).join('');

function useFootprint(levelId: Id, wallId: Id | undefined): Footprint | undefined {
  return usePlanStore((s) => {
    const level = s.plan.levels[levelId];
    return level && wallId ? getFootprints(level).get(wallId) : undefined;
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

const WallShape = memo(function WallShape({ levelId, wallId }: { levelId: Id; wallId: Id }) {
  const fp = useFootprint(levelId, wallId);
  const wall = usePlanStore((s) => s.plan.levels[levelId]?.walls[wallId]);
  const openings = usePlanStore((s) => {
    const level = s.plan.levels[levelId];
    return level ? openingsOnWall(level, wallId) : undefined;
  });
  const viewMode = useUiStore((s) => s.viewMode);
  // Caps only at ends with no other visible wall, so a wall split by a T shows no seam.
  const caps = usePlanStore((s) => {
    const level = s.plan.levels[levelId];
    const w = level?.walls[wallId];
    if (!w) return 0;
    const g = getGraph(level);
    const free = (n: Id) =>
      !(g.adjacency.get(n) ?? []).some((id) => id !== wallId && isVisible(level.walls[id].phase, viewMode));
    return (free(w.a) ? 1 : 0) | (free(w.b) ? 2 : 0);
  });
  const selected = useUiStore((s) => s.selection.walls.includes(wallId));
  const hovered = useUiStore((s) => s.hover.wallId === wallId);
  const pieces = useMemo(() => {
    if (!fp || !wall) return null;
    const gaps: [number, number][] = [];
    for (const o of openings ?? []) {
      if (!isOpeningVisible(o, wall, viewMode)) continue;
      const sym = openingSymbol(fp, o);
      gaps.push([sym.j0, sym.j1]);
    }
    return wallPieces(fp, fp.quad, gaps);
  }, [fp, wall, openings, viewMode]);
  if (!fp || !wall || !pieces || !isVisible(wall.phase, viewMode)) return null;
  const [la, lb, rb, ra] = fp.quad;
  let edges = segPath(pieces.edges);
  if (caps & 1) edges += `M${pt(la)}L${pt(ra)}`;
  if (caps & 2) edges += `M${pt(lb)}L${pt(rb)}`;
  const cls = `wall wall-${wall.kind} phase-${wall.phase}${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}`;
  return (
    <g className={cls} data-wall-id={wallId}>
      {pieces.fills.map((poly, i) => (
        <polygon key={i} className="wall-fill" points={poly.map(pt).join(' ')} vectorEffect="non-scaling-stroke" />
      ))}
      <path className="wall-edge" d={edges} vectorEffect="non-scaling-stroke" />
    </g>
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

const WallsLayer = memo(function WallsLayer({ levelId }: { levelId: Id }) {
  const ids = useWallIds(levelId);
  return (
    <g className="layer-walls">
      {ids.map((id) => (
        <WallShape key={id} levelId={levelId} wallId={id} />
      ))}
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
    const fps = getFootprints(level);
    let path = '';
    for (const w of Object.values(level.walls)) {
      const fp = fps.get(w.id);
      if (!fp || !isVisible(w.phase, viewMode)) continue;
      path += `M${fp.quad.map(pt).join('L')}Z`;
    }
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
      <WallsLayer levelId={levelId} />
      <OpeningsLayer levelId={levelId} />
      <LabelsLayer levelId={levelId} />
      <NodesLayer levelId={levelId} />
    </>
  );
});
