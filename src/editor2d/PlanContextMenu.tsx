import { useEffect, useRef } from 'react';
import { dot, sub } from '../model/geometry';
import { formatLength } from '../model/units';
import { getPlan, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { showNotice } from '../ui/fileActions';

/** Width the menu is kept inside the canvas with, px (matches .plan-context-menu). */
const MENU_WIDTH = 190;

/**
 * The select tool's right-click menu over the 2D canvas (absolutely positioned in .canvas-host, at
 * the clicked point): "Walk from here" sets where the 3D walk starts (uiStore.walkFrom; walk.ts
 * walkStart uses it on that level), "Clear walk start" forgets it. Esc, a click anywhere else, or
 * choosing an item closes it.
 */
export function PlanContextMenu() {
  const menu = useUiStore((s) => s.contextMenu);
  const walkFrom = useUiStore((s) => s.walkFrom);
  const width = useUiStore((s) => s.canvasSize.width);
  const height = useUiStore((s) => s.canvasSize.height);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => useUiStore.getState().setContextMenu(null);
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  if (!menu) return null;
  const ui = () => useUiStore.getState();
  const walkHere = () => {
    ui().setWalkFrom({ levelId: menu.levelId, point: { ...menu.world } });
    ui().setContextMenu(null);
    showNotice('Walking starts here: press Walk (or F) in the 3D view.');
  };
  const clear = () => {
    ui().setWalkFrom(null);
    ui().setContextMenu(null);
    showNotice('Walking starts at the entry door again.');
  };
  // "Split wall here": a corner goes in at the clicked point along the wall's centerline, so part of
  // the wall can be marked demolished or moved on its own.
  const wall = menu.wallId ? getPlan().levels[menu.levelId]?.walls[menu.wallId] : undefined;
  const splitHere = () => {
    const level = getPlan().levels[menu.levelId];
    const w = level?.walls[menu.wallId!];
    if (!level || !w) return;
    const a = level.nodes[w.a];
    const b = level.nodes[w.b];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const at = len > 1e-9 ? dot(sub(menu.world, a), { x: (b.x - a.x) / len, y: (b.y - a.y) / len }) : 0;
    const problem = usePlanStore.getState().splitWall(menu.levelId, w.id, at);
    ui().setContextMenu(null);
    if (problem) showNotice(problem, true);
    else showNotice(`Split the wall ${formatLength(at, getPlan().settings.precisionDenominator)} from its start. Select either piece on its own now.`);
  };
  const rows = 1 + (walkFrom ? 1 : 0) + (wall ? 1 : 0);
  const left = Math.max(4, Math.min(menu.screen.x, width - MENU_WIDTH - 4));
  const top = Math.max(4, Math.min(menu.screen.y, height - (12 + 36 * rows)));
  return (
    <div
      ref={ref}
      className="menu plan-context-menu"
      role="menu"
      aria-label="Plan"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={walkHere}>
        Walk from here
      </button>
      {walkFrom && (
        <button type="button" role="menuitem" onClick={clear}>
          Clear walk start
        </button>
      )}
      {wall && (
        <button type="button" role="menuitem" onClick={splitHere} title="Put a corner here so the wall becomes two pieces">
          Split wall here
        </button>
      )}
    </div>
  );
}
