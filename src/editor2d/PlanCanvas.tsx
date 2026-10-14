import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { getPlan, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { Overlay } from './Overlay';
import { ChecksLayer } from './ChecksLayer';
import { GhostLevel, PlanLayers, SiteView } from './PlanLayers';
import { dispatchPointer, type ToolPointerEvent } from './tools';
import { fitLevel, initialViewport, screenToWorld, visibleBounds, zoomAt, type Size } from './viewport';

interface PanState {
  pointerId: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
}

function wheelFactor(e: WheelEvent): number {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const dy = e.deltaY * unit;
  // Pinch-zoom on trackpads arrives as ctrl+wheel with small deltas; make it a bit snappier.
  return Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015));
}

/** Once the display grid spacing is wider than this on screen, 1" lines are drawn between its lines. */
const FINE_GRID_FROM_PX = 200;

/**
 * Lines every displayGrid (12") and heavier every 10', over the visible range only. Zoomed in far
 * enough that the 12" spacing exceeds 200 px, lighter 1" lines fill in between (still only the
 * visible range, so at most a few dozen per axis) and the 12" lines get a little darker.
 */
const Grid = memo(function Grid({ size }: { size: Size }) {
  const viewport = useUiStore((s) => s.viewport);
  const show = useUiStore((s) => s.showGrid);
  const step = usePlanStore((s) => s.plan.settings.displayGrid);
  if (!show || size.width === 0 || step <= 0) return null;
  const vb = visibleBounds(viewport, size);
  const major = 120;
  const fine = step > 1 && step * viewport.k > FINE_GRID_FROM_PX;
  const path = (spacing: number, skipMultiple: number | null) => {
    if (spacing * viewport.k < 6) return '';
    let d = '';
    const x0 = Math.ceil(vb.minX / spacing) * spacing;
    for (let x = x0; x <= vb.maxX; x += spacing) {
      if (skipMultiple && Math.abs(x / skipMultiple - Math.round(x / skipMultiple)) < 1e-6) continue;
      const sx = Math.round(x * viewport.k + viewport.tx) + 0.5;
      d += `M${sx} 0V${size.height}`;
    }
    const y0 = Math.ceil(vb.minY / spacing) * spacing;
    for (let y = y0; y <= vb.maxY; y += spacing) {
      if (skipMultiple && Math.abs(y / skipMultiple - Math.round(y / skipMultiple)) < 1e-6) continue;
      const sy = Math.round(y * viewport.k + viewport.ty) + 0.5;
      d += `M0 ${sy}H${size.width}`;
    }
    return d;
  };
  return (
    <g className="grid" pointerEvents="none">
      {fine && <path className="grid-inch" d={path(1, step)} />}
      <path className={fine ? 'grid-minor grid-foot' : 'grid-minor'} d={path(step, major)} />
      <path className="grid-major" d={path(major, null)} />
    </g>
  );
});

/** North arrow in the canvas corner (site mode): points to true north, turned by the plan's north angle. */
const NorthArrow = memo(function NorthArrow() {
  const angle = usePlanStore((s) => s.plan.site.northAngle);
  const r = (angle * Math.PI) / 180;
  // The N sits past the tip and stays upright.
  const tip = { x: Math.sin(r) * 36, y: -Math.cos(r) * 36 };
  return (
    <g className="north-arrow" transform="translate(52 62)" pointerEvents="none" data-north-angle={angle}>
      <circle className="north-ring" r={28} />
      <g transform={`rotate(${angle})`}>
        <path className="north-head" d="M0 -24L8 10L0 4L-8 10Z" />
      </g>
      <g transform={`translate(${tip.x} ${tip.y})`}>
        <text className="north-label" textAnchor="middle" dominantBaseline="central">
          N
        </text>
      </g>
    </g>
  );
});

export function PlanCanvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<PanState | null>(null);
  const initialized = useRef(false);
  const viewport = useUiStore((s) => s.viewport);
  const levelId = useUiStore((s) => s.activeLevelId);
  const size = useUiStore((s) => s.canvasSize);
  const spaceHeld = useUiStore((s) => s.spaceHeld);
  const activeTool = useUiStore((s) => s.activeTool);
  const underlayMode = useUiStore((s) => s.underlayMode);
  const showBelow = useUiStore((s) => s.showLevelBelow);
  const siteMode = useUiStore((s) => s.siteMode);
  const belowId = usePlanStore((s) => {
    const i = s.plan.levelOrder.indexOf(levelId);
    return i > 0 ? s.plan.levelOrder[i - 1] : null;
  });

  // Track size; set the initial viewport once the canvas has a size.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const r = svg.getBoundingClientRect();
      const next: Size = { width: Math.round(r.width), height: Math.round(r.height) };
      const ui = useUiStore.getState();
      if (next.width !== ui.canvasSize.width || next.height !== ui.canvasSize.height) {
        ui.setCanvasSize(next);
      }
      if (!initialized.current && next.width > 0 && next.height > 0) {
        initialized.current = true;
        const level = getPlan().levels[ui.activeLevelId];
        ui.setViewport((level && fitLevel(level, next, ui.showUnderlay)) ?? initialViewport(next));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  // Wheel zoom about the cursor; must be non-passive to preventDefault.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const ui = useUiStore.getState();
      const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      ui.setViewport(zoomAt(ui.viewport, p, wheelFactor(e)));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const toToolEvent = useCallback((e: ReactMouseEvent): ToolPointerEvent => {
    const rect = svgRef.current!.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    return {
      screen,
      world: screenToWorld(useUiStore.getState().viewport, screen),
      button: e.button,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      modKey: e.ctrlKey || e.metaKey,
    };
  }, []);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current!;
    svg.focus({ preventScroll: true });
    svg.setPointerCapture(e.pointerId);
    const ui = useUiStore.getState();
    if (e.button === 1 || (e.button === 0 && ui.spaceHeld)) {
      e.preventDefault();
      panRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, tx: ui.viewport.tx, ty: ui.viewport.ty };
      return;
    }
    dispatchPointer('down', toToolEvent(e));
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    if (pan && pan.pointerId === e.pointerId) {
      const ui = useUiStore.getState();
      ui.setViewport({ ...ui.viewport, tx: pan.tx + e.clientX - pan.x, ty: pan.ty + e.clientY - pan.y });
      return;
    }
    dispatchPointer('move', toToolEvent(e));
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current!;
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    if (panRef.current?.pointerId === e.pointerId) {
      panRef.current = null;
      return;
    }
    dispatchPointer('up', toToolEvent(e));
  };

  const onPointerLeave = () => {
    if (panRef.current) return;
    const ui = useUiStore.getState();
    ui.setHover({});
    // Opening tools: no ghost while the pointer is off the canvas.
    if (ui.draft.openingPreview) ui.patchDraft({ openingPreview: null });
    if (ui.draft.stairsPreview) ui.patchDraft({ stairsPreview: null });
    if (ui.draft.columnPreview) ui.patchDraft({ columnPreview: null });
    if (ui.draft.fixturePreview) ui.patchDraft({ fixturePreview: null });
  };

  const cursor =
    panRef.current || spaceHeld
      ? 'grab'
      : activeTool === 'select'
        ? 'default'
        : activeTool === 'underlay' && underlayMode === 'move'
          ? 'move'
          : 'crosshair';

  return (
    <svg
      ref={svgRef}
      className="plan-canvas"
      tabIndex={0}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
      onDoubleClick={(e) => dispatchPointer('dblclick', toToolEvent(e))}
      onContextMenu={(e) => e.preventDefault()}
      aria-label="Floor plan"
    >
      <rect className="plan-bg" width="100%" height="100%" />
      <Grid size={size} />
      <g transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.k})`}>
        {siteMode ? (
          <SiteView />
        ) : (
          <>
            {showBelow && belowId && <GhostLevel levelId={belowId} />}
            {levelId && <PlanLayers levelId={levelId} />}
          </>
        )}
        <ChecksLayer />
      </g>
      {siteMode && <NorthArrow />}
      <Overlay />
    </svg>
  );
}
