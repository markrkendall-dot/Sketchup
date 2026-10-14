import { memo } from 'react';
import { fixtureSymbol } from '../derive/casework';
import { arcPath, openingSymbol, wallPoint } from '../derive/openings';
import { FIXTURE_LABEL } from '../model/casework';
import { defaultGradeElevation } from '../derive/site';
import { floorToFloor, STAIRS_DEFAULTS, stairsSymbol, stairSteps } from '../derive/stairs';
import { add, dist, midpoint, normalize, perpLeft, scale, sub } from '../model/geometry';
import type { Underlay, Vec2 } from '../model/types';
import { formatPxScale, nearestAxis, pixelDistance } from '../model/underlay';
import { formatLength, formatLengthCompact, parseLength } from '../model/units';
import { usePlanStore } from '../store/planStore';
import {
  useUiStore,
  type Draft,
  type FixturePreview,
  type OpeningPreview,
  type RectPreview,
  type UnderlayMode,
  type SnapResult,
  type Viewport,
  type WallPreview,
} from '../store/uiStore';
import { FixtureGlyph, StairsGlyph } from './PlanLayers';
import { wallPreviewText } from './previewLabel';
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
    case 'ghost-node':
      // Hollow grey: a corner of the level below, not of this level.
      marker = <circle className="snap-marker ghost" cx={p.x} cy={p.y} r={7} />;
      break;
    case 'ghost-wall':
      marker = (
        <polygon
          className="snap-marker ghost"
          points={pts([
            { x: p.x, y: p.y - 7 },
            { x: p.x + 7, y: p.y },
            { x: p.x, y: p.y + 7 },
            { x: p.x - 7, y: p.y },
          ])}
        />
      );
      break;
    case 'face-corner':
      // A square turned to the corner: an outside (or inside) corner of a wall face.
      marker = (
        <g>
          <rect className="snap-marker" x={p.x - 6} y={p.y - 6} width={12} height={12} />
          <circle className="snap-marker" cx={p.x} cy={p.y} r={2} />
        </g>
      );
      break;
    case 'face-edge':
      marker = <path className="snap-marker" d={`M${p.x - 7} ${p.y + 5}L${p.x} ${p.y - 6}L${p.x + 7} ${p.y + 5}Z`} />;
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
          {wallPreviewText(preview, denom)}
        </text>
      </g>
    </g>
  );
}

/** Rectangle tool: the box's walls as one band (outside minus inside outline) and its size. */
function RectGhost({ preview, v }: { preview: RectPreview; v: Viewport }) {
  const xs = preview.corners.map((p) => p.x);
  const ys = preview.corners.map((p) => p.y);
  const h = preview.thickness / 2;
  const box = (grow: number) => {
    const a = worldToScreen(v, { x: Math.min(...xs) - grow, y: Math.min(...ys) - grow });
    const b = worldToScreen(v, { x: Math.max(...xs) + grow, y: Math.max(...ys) + grow });
    return `M${a.x},${a.y}H${b.x}V${b.y}H${a.x}Z`;
  };
  const inner = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) > preview.thickness;
  const center = preview.corners.map((p) => worldToScreen(v, p));
  const mid = worldToScreen(v, { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
  return (
    <g className={preview.typed ? 'rubber typed rect-ghost' : 'rubber rect-ghost'}>
      <path className="rubber-body" d={box(h) + (inner ? box(-h) : '')} fillRule="evenodd" />
      <polygon className="rubber-center" points={pts(center)} fill="none" />
      <Pill at={mid} text={preview.label} className="measure-readout" />
    </g>
  );
}

/**
 * Measure tool: a dimension line from the first point to the second (or the cursor) with its
 * length, and dashed x and y legs with theirs.
 */
function MeasureOverlay({ a: wa, b: wb, v, denom }: { a: Vec2; b: Vec2; v: Viewport; denom: number }) {
  const a = worldToScreen(v, wa);
  const b = worldToScreen(v, wb);
  const corner = worldToScreen(v, { x: wb.x, y: wa.y });
  const along = sub(b, a);
  const len = Math.hypot(along.x, along.y);
  const n = len > 1e-6 ? perpLeft(scale(along, 1 / len)) : { x: 0, y: -1 };
  const tick = (p: Vec2) => `M${p.x + n.x * 6},${p.y + n.y * 6}L${p.x - n.x * 6},${p.y - n.y * 6}`;
  const dx = Math.abs(wb.x - wa.x);
  const dy = Math.abs(wb.y - wa.y);
  // Keep the main readout above the line on screen.
  const off = scale(n.y > 0 ? scale(n, -1) : n, 16);
  const legs = dx > 0.5 && dy > 0.5;
  return (
    <g className="measure">
      {legs && <path className="measure-leg" d={`M${a.x},${a.y}L${corner.x},${corner.y}L${b.x},${b.y}`} />}
      <path className="measure-line" d={`M${a.x},${a.y}L${b.x},${b.y}${tick(a)}${tick(b)}`} />
      {legs && <Pill at={{ x: (a.x + corner.x) / 2, y: corner.y + (b.y > a.y ? -12 : 12) }} text={`dx ${formatLengthCompact(dx, denom)}`} className="measure-leg-label" />}
      {legs && <Pill at={{ x: corner.x + (b.x > a.x ? 30 : -30), y: (corner.y + b.y) / 2 }} text={`dy ${formatLengthCompact(dy, denom)}`} className="measure-leg-label" />}
      {len > 1 && <Pill at={add(midpoint(a, b), off)} text={formatLength(dist(wa, wb), denom)} className="measure-readout" />}
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

function LengthBox({ text, at, error, placeholder }: { text: string; at: Vec2; error: boolean; placeholder?: string }) {
  const shown = text || placeholder || '';
  const width = Math.max(48, shown.length * (text ? 8.5 : 7) + 20);
  return (
    <g className={error ? 'length-box error' : 'length-box'} transform={`translate(${at.x + 16} ${at.y + 18})`}>
      <rect width={width} height={24} rx={4} />
      <text x={10} y={12} dominantBaseline="central">
        {text}
        <tspan className="caret">|</tspan>
        {!text && placeholder && <tspan className="length-placeholder">{placeholder}</tspan>}
      </text>
    </g>
  );
}

/** A label on a pill, centred on a screen point. */
function Pill({ at, text, className }: { at: Vec2; text: string; className: string }) {
  const w = text.length * 6.9 + 16;
  return (
    <g className={className} transform={`translate(${at.x} ${at.y})`}>
      <rect x={-w / 2} y={-10} width={w} height={20} rx={10} />
      <text textAnchor="middle" dominantBaseline="central">
        {text}
      </text>
    </g>
  );
}

function CalibrationMarker({ p, label }: { p: Vec2; label: string }) {
  return (
    <g className="calib-marker">
      <circle cx={p.x} cy={p.y} r={7} />
      <path d={`M${p.x - 11} ${p.y}H${p.x + 11}M${p.x} ${p.y - 11}V${p.y + 11}`} />
      <text x={p.x + 9} y={p.y - 9}>
        {label}
      </text>
    </g>
  );
}

/**
 * Underlay tool, scale / rotate by two points: the clicked markers, the line to the second point
 * (or the cursor), a live readout of the pixel distance and what it means, and the typed distance.
 */
function UnderlayCalibration({ u, mode, draft, v, denom }: { u: Underlay; mode: UnderlayMode; draft: Draft; v: Viewport; denom: number }) {
  const pts = draft.underlayPoints;
  if (pts.length === 0) return null;
  const w1 = pts[0];
  const w2 = pts[1] ?? draft.cursor;
  const a = worldToScreen(v, w1);
  const b = w2 ? worldToScreen(v, w2) : null;
  let readout = '';
  if (w2) {
    if (mode === 'scale') {
      const px = pixelDistance(u, w1, w2);
      readout = `${px.toFixed(0)} px = ${formatLengthCompact(px * u.scale, denom)} now`;
      if (pts.length === 2 && draft.lengthBuffer) {
        try {
          const real = parseLength(draft.lengthBuffer);
          if (real > 0 && px > 0) readout = `${px.toFixed(0)} px = ${formatLength(real, denom)}: ${formatPxScale(real / px)}`;
        } catch {
          // Keep the live readout while the buffer is incomplete.
        }
      }
    } else {
      const { target, turn } = nearestAxis(w1, w2);
      readout = `turn ${turn >= 0 ? '+' : ''}${turn.toFixed(1)}° to ${target % 180 === 0 ? 'horizontal' : 'vertical'}`;
    }
  }
  const mid = b ? midpoint(a, b) : a;
  const along = b ? sub(b, a) : { x: 1, y: 0 };
  const len = Math.hypot(along.x, along.y);
  const n = len > 1e-6 ? perpLeft(scale(along, 1 / len)) : { x: 0, y: -1 };
  // Keep the readout above the line on screen.
  const off = scale(n.y > 0 ? scale(n, -1) : n, 20);
  return (
    <g className={`calibration calibration-${mode}`}>
      {b && <line className="calib-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />}
      <CalibrationMarker p={a} label="1" />
      {pts.length === 2 && b && <CalibrationMarker p={b} label="2" />}
      {readout && <Pill at={add(mid, off)} text={readout} className="calib-readout" />}
      {mode === 'scale' && pts.length === 2 && b && (
        <LengthBox text={draft.lengthBuffer} at={b} error={draft.error} placeholder="type the real distance" />
      )}
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

/**
 * Fixture tool: the ghost of the cabinet or appliance about to be placed, drawn in world space like
 * the real symbol, with its kind and width on a pill (green while the width is typed).
 */
function FixtureGhost({ preview, v, denom }: { preview: FixturePreview; v: Viewport; denom: number }) {
  const sym = fixtureSymbol({ id: 'ghost', kind: preview.kind, origin: preview.origin, direction: preview.direction, width: preview.width, depth: preview.depth, height: 1, elevation: 0, phase: 'existing' });
  const front = worldToScreen(v, midpoint(sym.front[0], sym.front[1]));
  const back = worldToScreen(v, preview.origin);
  const out = normalize(sub(front, back));
  const at = add(front, scale(out.x === 0 && out.y === 0 ? { x: 0, y: 1 } : out, 16));
  const text = `${FIXTURE_LABEL[preview.kind]} ${formatLengthCompact(preview.width, denom)}${preview.wallId ? '' : ' (free)'}`;
  return (
    <g className={`fixture-ghost${preview.typed ? ' typed' : ''}${preview.abuts ? ' abuts' : ''}`}>
      <g transform={`translate(${v.tx} ${v.ty}) scale(${v.k})`}>
        <FixtureGlyph sym={sym} k={v.k} className="fixture fixture-ghost-glyph" />
      </g>
      <Pill at={at} text={text} className="measure-readout" />
    </g>
  );
}

/** Roof and deck tools: the corners clicked so far, the edge to the cursor and the closing edge (dashed). */
function OutlineDraft({ points, cursor, v, kind }: { points: Vec2[]; cursor: Vec2 | null; v: Viewport; kind: 'roof' | 'deck' }) {
  const sp = points.map((p) => worldToScreen(v, p));
  const c = cursor ? worldToScreen(v, cursor) : null;
  const line = c ? [...sp, c] : sp;
  const closable = points.length >= 3 && !!c && Math.hypot(c.x - sp[0].x, c.y - sp[0].y) <= 10;
  return (
    <g className={`outline-draft ${kind}`}>
      {line.length >= 2 && <polyline className="outline-draft-line" points={pts(line)} />}
      {line.length >= 3 && !closable && <line className="outline-draft-close" x1={line[line.length - 1].x} y1={line[line.length - 1].y} x2={sp[0].x} y2={sp[0].y} />}
      {sp.map((p, i) => (
        <circle key={i} className={`outline-draft-point${i === 0 ? ' first' : ''}${i === 0 && closable ? ' closable' : ''}`} cx={p.x} cy={p.y} r={i === 0 ? 6 : 4} />
      ))}
    </g>
  );
}

/** Grade point tool: the clicked spot with the elevation box (what is typed, or the default as a placeholder). */
function GradeDraft({ at, text, error, v, placeholder }: { at: Vec2; text: string; error: boolean; v: Viewport; placeholder: string }) {
  const p = worldToScreen(v, at);
  return (
    <g className="grade-draft">
      <path className="grade-draft-tri" d={`M${p.x} ${p.y - 8}L${p.x + 7.5} ${p.y + 6}L${p.x - 7.5} ${p.y + 6}Z`} />
      <LengthBox text={text} at={p} error={error} placeholder={placeholder} />
    </g>
  );
}

/** Column tool: the column about to be placed (rotated rectangle at the snapped cursor), in screen space. */
function ColumnGhost({ at, kind, width, depth, v }: { at: Vec2; kind: 'chimney' | 'post'; width: number; depth: number; v: Viewport }) {
  const p = worldToScreen(v, at);
  const w = Math.max(width * v.k, 6);
  const d = Math.max(depth * v.k, 6);
  return (
    <g className={`column-ghost column-${kind}`} transform={`translate(${p.x} ${p.y})`}>
      <rect x={-w / 2} y={-d / 2} width={w} height={d} />
      <text x={w / 2 + 6} y={-d / 2 - 4}>
        {kind === 'chimney' ? 'Chimney (Tab: post)' : 'Post (Tab: chimney)'}
      </text>
    </g>
  );
}

export const Overlay = memo(function Overlay() {
  const draft = useUiStore((s) => s.draft);
  const v = useUiStore((s) => s.viewport);
  const denom = usePlanStore((s) => s.plan.settings.precisionDenominator);
  const tool = useUiStore((s) => s.activeTool);
  const underlayMode = useUiStore((s) => s.underlayMode);
  const levelId = useUiStore((s) => s.activeLevelId);
  const underlay = usePlanStore((s) => s.plan.levels[levelId]?.underlay);
  const calibrating = tool === 'underlay' && underlayMode !== 'move' && !!underlay;
  const gradeDefault = usePlanStore((s) => (tool === 'gradePoint' ? formatLength(defaultGradeElevation(s.plan), denom) : ''));
  const cursor = draft.cursor ? worldToScreen(v, draft.cursor) : null;
  const box = draft.box
    ? { a: worldToScreen(v, draft.box.a), b: worldToScreen(v, draft.box.b) }
    : null;
  return (
    <g className="overlay" pointerEvents="none">
      {draft.wallPreview && <RubberBand preview={draft.wallPreview} v={v} denom={denom} />}
      {tool === 'rect' && draft.rectStart && draft.rectPreview && <RectGhost preview={draft.rectPreview} v={v} />}
      {tool === 'measure' && draft.measure && (draft.measure.b ?? draft.snap?.point) && (
        <MeasureOverlay a={draft.measure.a} b={(draft.measure.b ?? draft.snap?.point)!} v={v} denom={denom} />
      )}
      {draft.openingPreview && <OpeningGhost preview={draft.openingPreview} v={v} denom={denom} />}
      {draft.stairsPreview && <StairsGhost origin={draft.stairsPreview.origin} direction={draft.stairsPreview.direction} v={v} />}
      {(tool === 'roof' || tool === 'deck') && draft.outlinePoints.length > 0 && <OutlineDraft points={draft.outlinePoints} cursor={draft.snap?.point ?? draft.cursor} v={v} kind={tool} />}
      {tool === 'column' && draft.columnPreview && <ColumnGhost {...draft.columnPreview} v={v} />}
      {tool === 'fixture' && draft.fixturePreview && <FixtureGhost preview={draft.fixturePreview} v={v} denom={denom} />}
      {tool === 'gradePoint' && draft.gradePending && (
        <GradeDraft at={draft.gradePending} text={draft.lengthBuffer} error={draft.error} v={v} placeholder={gradeDefault} />
      )}
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
      {calibrating && <UnderlayCalibration u={underlay} mode={underlayMode} draft={draft} v={v} denom={denom} />}
      {cursor && draft.lengthBuffer && !calibrating && tool !== 'gradePoint' && <LengthBox text={draft.lengthBuffer} at={cursor} error={draft.error} />}
    </g>
  );
});
