// Textures after the first frame (DESIGN.md "Load time"). Painting the procedural textures takes
// most of the time before the 3D view first shows (a second or more for a house), so a material is
// made in its flat colour and its textures are painted afterwards, a few at a time between frames,
// and swapped in; each batch redraws the demand-driven canvas. Where there is no window (node,
// tests) a job runs at once, so a material is exactly what it was before this queue.

type Job = () => void;

const jobs: Job[] = [];
let scheduled = false;
let redraw: (() => void) | null = null;
/** How long one batch may run before it yields to the browser, ms. */
const BUDGET_MS = 40;
/**
 * How much texture work to gather between redraws, ms: a redraw of the whole house costs a frame
 * (and uploads the new textures), so one per small batch would add more than the textures take;
 * the last batch always redraws.
 */
const REDRAW_AFTER_MS = 250;
let workSinceRedraw = 0;

/** The function that redraws the 3D view after a batch (Scene3D sets it while mounted). */
export function setTextureRedraw(fn: (() => void) | null): void {
  redraw = fn;
}

/** Run `job` (make a texture and give it to its material) after the next frame, or now without a window. */
export function deferTexture(job: Job): void {
  if (typeof window === 'undefined') {
    job();
    return;
  }
  jobs.push(job);
  schedule();
}

/**
 * A first batch waits for a frame (the one that shows the new materials in flat colours) and starts
 * once it is drawn; the batches after it only yield to the browser (input, a redraw) between them.
 */
function schedule(next = false): void {
  if (scheduled) return;
  scheduled = true;
  if (next) setTimeout(run, 0);
  else requestAnimationFrame(() => setTimeout(run, 0));
}

function run(): void {
  scheduled = false;
  const start = performance.now();
  while (jobs.length > 0 && performance.now() - start < BUDGET_MS) jobs.shift()!();
  workSinceRedraw += performance.now() - start;
  if (jobs.length === 0 || workSinceRedraw >= REDRAW_AFTER_MS) {
    workSinceRedraw = 0;
    redraw?.();
  }
  if (jobs.length > 0) schedule(true);
}

/** Run every waiting job now (before a capture, which must show the textures). */
export function flushTextures(): void {
  if (jobs.length === 0) return;
  while (jobs.length > 0) jobs.shift()!();
  workSinceRedraw = 0;
  redraw?.();
}

/** Whether textures are still waiting. */
export const texturesPending = (): boolean => jobs.length > 0;
