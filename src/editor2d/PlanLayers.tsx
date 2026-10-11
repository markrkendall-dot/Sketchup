import { memo, useMemo } from 'react';
import { getFootprints, type Footprint } from '../derive/footprint';
import { getGraph } from '../derive/graph';
import { add, midpoint, scale } from '../model/geometry';
import type { Id, Vec2 } from '../model/types';
import { formatLengthCompact } from '../model/units';
import { usePlanStore } from '../store/planStore';
import { useUiStore, useViewportScale } from '../store/uiStore';

/** Gap between a wall face and its dimension label, in screen px. */
const LABEL_GAP_PX = 11;
/** Hide labels on walls shorter than this on screen. */
const MIN_LABEL_WALL_PX = 34;

const pt = (p: Vec2) => `${p.x},${p.y}`;

function useFootprint(levelId: Id, wallId: Id): Footprint | undefined {
  return usePlanStore((s) => {
    const level = s.plan.levels[levelId];
    return level ? getFootprints(level).get(wallId) : undefined;
  });
}

const WallShape = memo(function WallShape({ levelId, wallId }: { levelId: Id; wallId: Id }) {
  const fp = useFootprint(levelId, wallId);
  const kind = usePlanStore((s) => s.plan.levels[levelId]?.walls[wallId]?.kind);
  // Caps only at free ends (degree 1), so a wall split by a T shows no seam.
  const caps = usePlanStore((s) => {
    const level = s.plan.levels[levelId];
    const w = level?.walls[wallId];
    if (!w) return 0;
    const g = getGraph(level);
    return (g.degree(w.a) === 1 ? 1 : 0) | (g.degree(w.b) === 1 ? 2 : 0);
  });
  const selected = useUiStore((s) => s.selection.walls.includes(wallId));
  const hovered = useUiStore((s) => s.hover.wallId === wallId);
  if (!fp || !kind) return null;
  const [la, lb, rb, ra] = fp.quad;
  let edges = `M${pt(la)}L${pt(lb)}M${pt(ra)}L${pt(rb)}`;
  if (caps & 1) edges += `M${pt(la)}L${pt(ra)}`;
  if (caps & 2) edges += `M${pt(lb)}L${pt(rb)}`;
  const cls = `wall wall-${kind}${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}`;
  return (
    <g className={cls} data-wall-id={wallId}>
      <polygon className="wall-fill" points={fp.quad.map(pt).join(' ')} />
      <path className="wall-edge" d={edges} vectorEffect="non-scaling-stroke" />
    </g>
  );
});

const DimensionLabel = memo(function DimensionLabel({ levelId, wallId }: { levelId: Id; wallId: Id }) {
  const fp = useFootprint(levelId, wallId);
  const k = useViewportScale();
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  if (!fp || fp.length * k < MIN_LABEL_WALL_PX) return null;
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

export const PlanLayers = memo(function PlanLayers({ levelId }: { levelId: Id }) {
  return (
    <>
      <WallsLayer levelId={levelId} />
      <LabelsLayer levelId={levelId} />
      <NodesLayer levelId={levelId} />
    </>
  );
});
