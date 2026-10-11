/**
 * Hand the keyboard back to the plan after a field commits: blur the field and focus the 2D
 * canvas when it is on screen, so Ctrl+Z undoes the plan instead of the text in the field and the
 * tool hotkeys work again.
 */
export function releaseFocus(el: HTMLElement | null): void {
  el?.blur();
  const canvas = document.querySelector<SVGSVGElement>('svg.plan-canvas');
  if (canvas && canvas.getClientRects().length > 0 && canvas.getBoundingClientRect().width > 0) {
    canvas.focus({ preventScroll: true });
  }
}
