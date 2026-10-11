import { useEffect, useRef } from 'react';
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
  const left = Math.max(4, Math.min(menu.screen.x, width - MENU_WIDTH - 4));
  const top = Math.max(4, Math.min(menu.screen.y, height - (walkFrom ? 84 : 48)));
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
    </div>
  );
}
