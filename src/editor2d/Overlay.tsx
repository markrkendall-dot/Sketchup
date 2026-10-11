import { memo } from 'react';
import { add, midpoint, normalize, perpLeft, scale, sub } from '../model/geometry';
import type { Vec2 } from '../model/types';
import { formatLengthCompact } from '../model/units';
import { usePlanStore } from '../store/planStore';
import { useUiStore, type SnapResult, type Viewport, type WallPreview } from '../store/uiStore';
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
