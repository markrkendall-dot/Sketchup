import { useRef, useState, type PointerEvent, type ReactNode, type WheelEvent } from 'react';

const MIN_SCALE = 0.1;
const MAX_SCALE = 20;

/**
 * Pan and zoom by pointer events, for touch (one finger pans, two pinch about their midpoint)
 * and a mouse (drag pans, the wheel zooms about the cursor); a double-tap or double-click resets.
 * The child is moved with a CSS transform; `touch-action: none` on the container (viewer.css)
 * keeps the browser from scrolling or zooming the page instead.
 */
export function PanZoom({ children }: { children: ReactNode }) {
  const [t, setT] = useState({ x: 0, y: 0, k: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastTap = useRef(0);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer (tests) has nothing to capture; the move handler still works by id.
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === 'touch' && pointers.current.size === 1) {
      const now = performance.now();
      if (now - lastTap.current < 300) setT({ x: 0, y: 0, k: 1 });
      lastTap.current = now;
    }
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    const rect = e.currentTarget.getBoundingClientRect();
    if (pointers.current.size === 1) {
      setT((s) => ({ ...s, x: s.x + next.x - prev.x, y: s.y + next.y - prev.y }));
    } else if (pointers.current.size === 2) {
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)![1];
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y) || 1;
      const d1 = Math.hypot(next.x - other.x, next.y - other.y) || 1;
      const mx = (next.x + other.x) / 2 - rect.left;
      const my = (next.y + other.y) / 2 - rect.top;
      setT((s) => {
        const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s.k * (d1 / d0)));
        const r = k / s.k;
        // Scale about the fingers' midpoint, then follow the midpoint's drift.
        return { k, x: mx - (mx - s.x) * r + (next.x - prev.x) / 2, y: my - (my - s.y) * r + (next.y - prev.y) / 2 };
      });
    }
    pointers.current.set(e.pointerId, next);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setT((s) => {
      const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s.k * Math.exp(-e.deltaY / 500)));
      const r = k / s.k;
      return { k, x: mx - (mx - s.x) * r, y: my - (my - s.y) * r };
    });
  };

  return (
    <div
      className="plan-zoom"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onWheel={onWheel}
      onDoubleClick={() => setT({ x: 0, y: 0, k: 1 })}
    >
      <div className="plan-zoom-content" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})` }}>
        {children}
      </div>
    </div>
  );
}
