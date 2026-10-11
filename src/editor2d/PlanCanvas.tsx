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
import { GhostLevel, PlanLayers } from './PlanLayers';
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

/** Lines every displayGrid (12") and heavier every 10', over the visible range only. */
const Grid = memo(function Grid({ size }: { size: Size }) {
  const viewport = useUiStore((s) => s.viewport);
  const show = useUiStore((s) => s.showGrid);
  const step = usePlanStore((s) => s.plan.settings.displayGrid);
  if (!show || size.width === 0 || step <= 0) return null;
  const vb = visibleBounds(viewport, size);
  const major = 120;
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
      <path className="grid-minor" d={path(step, major)} />
      <path className="grid-major" d={path(major, null)} />
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
  const showBelow = useUiStore((s) => s.showLevelBelow);
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
        ui.setViewport((level && fitLevel(level, next)) ?? initialViewport(next));
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
  };

  const cursor = panRef.current || spaceHeld ? 'grab' : activeTool === 'select' ? 'default' : 'crosshair';

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
        {showBelow && belowId && <GhostLevel levelId={belowId} />}
        {levelId && <PlanLayers levelId={levelId} />}
      </g>
      <Overlay />
    </svg>
  );
}
