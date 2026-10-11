import { memo } from 'react';
import { arcPath, openingSymbol, wallPoint } from '../derive/openings';
import { floorToFloor, STAIRS_DEFAULTS, stairsSymbol, stairSteps } from '../derive/stairs';
import { add, midpoint, normalize, perpLeft, scale, sub } from '../model/geometry';
import type { Vec2 } from '../model/types';
import { formatLengthCompact } from '../model/units';
import { usePlanStore } from '../store/planStore';
import {
  useUiStore,
  type OpeningPreview,
  type SnapResult,
  type Viewport,
  type WallPreview,
} from '../store/uiStore';
import { StairsGlyph } from './PlanLayers';
import { worldToScreen } from './viewport';

// Transient editor feedback, drawn in screen space. The only component that subscribes to
// uiStore.draft, so cursor moves never re-render the plan layers.

const pts = (list: Vec2[]) => list.map((p) => `${p.x},${p.y}`).join(' ');

function SnapMarker({ snap, v }: { snap: SnapResult; v: Viewport }) {
  const p = worldToScreen(v, snap.point);
  const guides = snap.guides.map((g, i) => {
    const a = worldToScreen(v, g.from);
    const b = worldToScreen(v, g.to);
    return <line key={i} className="snap-guide" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
  });
  let marker = null;
  switch (snap.kind) {
    case 'node':
      marker = <circle className="snap-marker" cx={p.x} cy={p.y} r={6} />;
      break;
    case 'midpoint':
      marker = <rect className="snap-marker" x={p.x - 5} y={p.y - 5} width={10} height={10} />;
      break;
    case 'wall':
      marker = (
        <polygon
          className="snap-marker"
          points={pts([
            { x: p.x, y: p.y - 6 },
            { x: p.x + 6, y: p.y },
            { x: p.x, y: p.y + 6 },
            { x: p.x - 6, y: p.y },
          ])}
        />
      );
      break;
    case 'guide':
      marker = <path className="snap-marker" d={`M${p.x - 5} ${p.y - 5}L${p.x + 5} ${p.y + 5}M${p.x - 5} ${p.y + 5}L${p.x + 5} ${p.y - 5}`} />;
      break;
    default:
      marker = <path className="snap-cross" d={`M${p.x - 6} ${p.y}H${p.x + 6}M${p.x} ${p.y - 6}V${p.y + 6}`} />;
  }
  return (
    <g>
      {guides}
      {marker}
    </g>
  );
}

function RubberBand({ preview, v, denom }: { preview: WallPreview; v: Viewport; denom: number }) {
  const dir = normalize(sub(preview.b, preview.a));
  const n = scale(perpLeft(dir), preview.thickness / 2);
  const quad = [add(preview.a, n), add(preview.b, n), sub(preview.b, n), sub(preview.a, n)].map((p) =>
    worldToScreen(v, p),
  );
  const a = worldToScreen(v, preview.a);
  const b = worldToScreen(v, preview.b);
  const m = midpoint(a, b);
  // Label on the left side, offset in screen px, kept upright.
  const off = scale(perpLeft(dir), (preview.thickness / 2) * v.k + 14);
  let angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  if (angle > 90 || angle <= -90) angle += 180;
  return (
    <g className={preview.typed ? 'rubber typed' : 'rubber'}>
      <polygon className="rubber-body" points={pts(quad)} />
      <line className="rubber-center" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      <g transform={`translate(${m.x + off.x} ${m.y + off.y}) rotate(${angle})`}>
        <text className="rubber-label" textAnchor="middle" dominantBaseline="central">
          {formatLengthCompact(preview.length, denom)}
        </text>
      </g>
    </g>
  );
}

/** Gap between the wall face and an opening's dimension line, in screen px. */
const OPENING_DIM_GAP_PX = 22;

/** Upright rotation (degrees) for text running along direction d. */
function uprightAngle(d: Vec2): number {
  let angle = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  if (angle > 90 || angle <= -90) angle += 180;
  return angle;
}

/**
 * A dimension line between two screen points with end ticks and a label on a pill. When the
 * segment is too short to hold the label, the label moves past the `far` end so it never sits on
 * the opening or the corner.
 */
function DimLine({
  a,
  b,
  n,
  text,
  strong,
  far,
}: {
  a: Vec2;
  b: Vec2;
  n: Vec2;
  text: string;
  strong: boolean;
  far: 'a' | 'b';
}) {
  const tick = (p: Vec2) => {
    const p0 = add(p, scale(n, 5));
    const p1 = sub(p, scale(n, 5));
    return `M${p0.x},${p0.y}L${p1.x},${p1.y}`;
  };
  const along = sub(b, a);
  const len = Math.hypot(along.x, along.y);
  const w = text.length * (strong ? 7.4 : 6.8) + 10;
  let m = midpoint(a, b);
  if (len < w + 8) {
    const u = len > 1e-6 ? scale(along, 1 / len) : { x: n.y, y: -n.x };
    m = far === 'a' ? sub(a, scale(u, w / 2 + 6)) : add(b, scale(u, w / 2 + 6));
  }
  return (
    <g className={strong ? 'opening-dim strong' : 'opening-dim'}>
      <path d={`M${a.x},${a.y}L${b.x},${b.y}${tick(a)}${tick(b)}`} />
      <g transform={`translate(${m.x} ${m.y}) rotate(${uprightAngle(len > 1e-6 ? along : { x: 1, y: 0 })})`}>
        <rect x={-w / 2} y={-9} width={w} height={18} rx={9} />
        <text textAnchor="middle" dominantBaseline="central">
          {text}
        </text>
      </g>
    </g>
  );
}

function OpeningGhost({ preview, v, denom }: { preview: OpeningPreview; v: Viewport; denom: number }) {
  const g = preview.geom;
  const map = (p: Vec2) => worldToScreen(v, p);
  const sym = openingSymbol(g, preview.opening);
  const segs = [...sym.lines, ...sym.dashed, ...(sym.leaf ? [sym.leaf] : [])]
    .map(([p, q]) => {
      const a = map(p);
      const b = map(q);
      return `M${a.x},${a.y}L${b.x},${b.y}`;
    })
    .join('');
  // Dimension lines on the cursor's side of the wall, from each end of the core interval (the
  // inside face of the corner) to the nearer jamb.
  const n = scale(g.normal, preview.cursorSide);
  const off = (g.thickness / 2) * v.k + OPENING_DIM_GAP_PX;
  const at = (s: number) => add(map(wallPoint(g, s, 0)), scale(n, off));
  const cls = `opening-ghost${preview.problem ? ' invalid' : ''}${preview.typed ? ' typed' : ''}`;
  return (
    <g className={cls}>
      <polygon className="opening-ghost-gap" points={pts(sym.gap.map(map))} />
      {segs && <path className="opening-ghost-line" d={segs} />}
      {sym.arc && <path className="opening-ghost-line" d={arcPath(sym.arc, map, sym.arc.r * v.k)} />}
      <DimLine
        a={at(g.s0)}
        b={at(sym.j0)}
        n={n}
        text={formatLengthCompact(preview.fromA, denom)}
        strong={preview.nearEnd === 'a'}
        far="a"
      />
      <DimLine
        a={at(sym.j1)}
        b={at(g.s1)}
        n={n}
        text={formatLengthCompact(preview.fromB, denom)}
        strong={preview.nearEnd === 'b'}
        far="b"
      />
    </g>
  );
}

function LengthBox({ text, at, error }: { text: string; at: Vec2; error: boolean }) {
  const width = Math.max(48, text.length * 8.5 + 20);
  return (
    <g className={error ? 'length-box error' : 'length-box'} transform={`translate(${at.x + 16} ${at.y + 18})`}>
      <rect width={width} height={24} rx={4} />
      <text x={10} y={12} dominantBaseline="central">
        {text}
        <tspan className="caret">|</tspan>
      </text>
    </g>
  );
}

/** Ghost of the stairs about to be placed, drawn in world space like the real symbol. */
function StairsGhost({ origin, direction, v }: { origin: Vec2; direction: number; v: Viewport }) {
  const levelId = useUiStore((s) => s.activeLevelId);
  const ftf = usePlanStore((s) => floorToFloor(s.plan, levelId));
  const sym = stairsSymbol({ origin, direction, ...STAIRS_DEFAULTS }, stairSteps(ftf).risers);
  return (
    <g transform={`translate(${v.tx} ${v.ty}) scale(${v.k})`}>
      <StairsGlyph sym={sym} k={v.k} className="stairs stairs-ghost" />
    </g>
  );
}

export const Overlay = memo(function Overlay() {
  const draft = useUiStore((s) => s.draft);
  const v = useUiStore((s) => s.viewport);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const cursor = draft.cursor ? worldToScreen(v, draft.cursor) : null;
  const box = draft.box
    ? { a: worldToScreen(v, draft.box.a), b: worldToScreen(v, draft.box.b) }
    : null;
  return (
    <g className="overlay" pointerEvents="none">
      {draft.wallPreview && <RubberBand preview={draft.wallPreview} v={v} denom={denom} />}
      {draft.openingPreview && <OpeningGhost preview={draft.openingPreview} v={v} denom={denom} />}
      {draft.stairsPreview && <StairsGhost origin={draft.stairsPreview.origin} direction={draft.stairsPreview.direction} v={v} />}
      {draft.snap && <SnapMarker snap={draft.snap} v={v} />}
      {box && (
        <rect
          className="select-box"
          x={Math.min(box.a.x, box.b.x)}
          y={Math.min(box.a.y, box.b.y)}
          width={Math.abs(box.b.x - box.a.x)}
          height={Math.abs(box.b.y - box.a.y)}
        />
      )}
      {cursor && draft.lengthBuffer && <LengthBox text={draft.lengthBuffer} at={cursor} error={draft.error} />}
    </g>
  );
});
