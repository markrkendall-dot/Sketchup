// Plan-level commands shared by the toolbar buttons and the keyboard map: New, Open, Save, zoom to
// fit, and the status bar notices they report with.
import { cancelActiveTool } from '../editor2d/tools';
import { fitLevel, initialViewport } from '../editor2d/viewport';
import { downloadPlan, planFileName, readPlanFile } from '../io/file';
import { createEmptyPlan, defaultLevelId } from '../model/plan';
import type { Plan } from '../model/types';
import { clearHistory, getPlan, usePlanStore } from '../store/planStore';
import { EMPTY_SELECTION, useUiStore } from '../store/uiStore';

let noticeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Show a message in the status bar. Info messages clear themselves after `ms`; errors stay until
 * replaced (or cleared with null).
 */
export function showNotice(text: string | null, error = false, ms = 4000): void {
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = null;
  const ui = useUiStore.getState();
  ui.setNotice(text === null ? null : { text, error });
  if (text !== null && !error) {
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      if (useUiStore.getState().notice?.text === text) useUiStore.getState().setNotice(null);
    }, ms);
  }
}

/**
 * Item 17: naming a room the same as another room on the level is allowed, but says so in the
 * status bar. Call it before the add or rename, with the room being renamed (if any) excluded.
 */
export function noteDuplicateRoomName(levelId: string, name: string, exceptRoomId?: string | null): boolean {
  const level = getPlan().levels[levelId];
  if (!level) return false;
  const wanted = name.trim().toLowerCase();
  const dup = Object.values(level.rooms).find((r) => r.id !== exceptRoomId && r.name.trim().toLowerCase() === wanted);
  if (!dup) return false;
  showNotice(`There is already a ${dup.name} on this level`);
  return true;
}

/** Fit the active level (and its underlay, when shown) into the 2D view. */
export function zoomToFit(): void {
  const ui = useUiStore.getState();
  const level = getPlan().levels[ui.activeLevelId];
  if (!level || ui.canvasSize.width === 0) return;
  ui.setViewport(fitLevel(level, ui.canvasSize, ui.showUnderlay) ?? initialViewport(ui.canvasSize));
}

/** True when the plan has anything worth asking about before it is replaced. */
export function planHasContent(plan: Plan): boolean {
  return plan.levelOrder.some((id) => {
    const l = plan.levels[id];
    return l && (Object.keys(l.walls).length > 0 || Object.keys(l.rooms).length > 0 || Object.keys(l.stairs).length > 0 || !!l.underlay);
  });
}

/**
 * Replace the whole plan (New, Open) and clear the undo history: undoing back into the previous
 * plan after opening a file would be a surprise, and the old plan is one Save away anyway.
 */
export function replacePlan(plan: Plan): void {
  cancelActiveTool();
  const ui = useUiStore.getState();
  ui.setSelection(EMPTY_SELECTION);
  ui.selectUnderlay(false);
  usePlanStore.getState().setPlan(plan);
  clearHistory();
  ui.setActiveLevel(defaultLevelId(plan));
  zoomToFit();
}

/** Start an empty plan, after confirming when the current one has walls (or rooms, stairs, images). */
export function newPlan(): void {
  const plan = getPlan();
  if (
    planHasContent(plan) &&
    !window.confirm(`Start a new, empty plan? "${plan.name}" will be replaced and Undo cannot bring it back. Use Save first to keep a copy.`)
  ) {
    return;
  }
  replacePlan(createEmptyPlan());
  showNotice('Started a new plan.');
}

/** Load a chosen plan file, replacing the current plan. Errors are reported, not thrown. */
export async function openPlanFile(file: File): Promise<void> {
  try {
    const plan = await readPlanFile(file);
    replacePlan(plan);
    showNotice(`Opened ${file.name}.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Replace any earlier notice (e.g. "Saved a copy") with the rejection, which stays until the
    // next notice, and tell the user in the alert as well.
    showNotice(`Could not open ${file.name}: ${message}`, true);
    window.alert(message);
  }
}

/** Ask for a plan file (the browser's file picker) and open it. */
export function choosePlanFile(): void {
  // Attached (and hidden) while the picker is open: a detached input can be collected before its
  // change event arrives.
  document.querySelector('input.plan-file-input')?.remove();
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.className = 'plan-file-input';
  input.hidden = true;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.remove();
    if (file) void openPlanFile(file);
  });
  input.addEventListener('cancel', () => input.remove());
  document.body.appendChild(input);
  input.click();
}

/** Download the plan as JSON. */
export function savePlan(): void {
  const plan = getPlan();
  downloadPlan(plan);
  showNotice(`Saved a copy as ${planFileName(plan, 'json')} (your browser's downloads).`);
}
