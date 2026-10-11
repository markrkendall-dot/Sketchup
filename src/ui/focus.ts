/** The 2D plan canvas, when it is on screen (it stays mounted but hidden in the 3D-only layout). */
function visibleCanvas(): SVGSVGElement | null {
  const canvas = document.querySelector<SVGSVGElement>('svg.plan-canvas');
  return canvas && canvas.getClientRects().length > 0 && canvas.getBoundingClientRect().width > 0 ? canvas : null;
}

/**
 * Give the keyboard back to the plan: focus the 2D canvas when it is on screen, else just drop
 * focus from whatever holds it. A toolbar button that keeps focus after a click would otherwise
 * run its action again on the next Enter or Space (e.g. mid-draw, where Enter commits a length).
 */
export function focusCanvas(): void {
  const canvas = visibleCanvas();
  if (canvas) canvas.focus({ preventScroll: true });
  else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

/**
 * Hand the keyboard back to the plan after a field commits: blur the field and focus the 2D
 * canvas when it is on screen, so Ctrl+Z undoes the plan instead of the text in the field and the
 * tool hotkeys work again.
 */
export function releaseFocus(el: HTMLElement | null): void {
  el?.blur();
  visibleCanvas()?.focus({ preventScroll: true });
}
