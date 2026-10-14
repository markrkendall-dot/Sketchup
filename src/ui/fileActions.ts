// Plan-level commands shared by the toolbar buttons and the keyboard map: New, Open, Save, zoom to
// fit, and the status bar notices they report with.
import { siteGhostLevelId } from '../derive/site';
import { cancelActiveTool } from '../editor2d/tools';
import { fitLevel, initialViewport } from '../editor2d/viewport';
import { downloadPlan, planFileName, readPlanFile } from '../io/file';
import { createEmptyPlan, defaultLevelId, migrate } from '../model/plan';
import type { Plan } from '../model/types';
import { clearHistory, getPlan, usePlanStore } from '../store/planStore';
import { EMPTY_SELECTION, useUiStore } from '../store/uiStore';

/**
 * Show a message in the status bar (null clears it). Info messages clear themselves after
 * NOTICE_MS (the store's setter keeps the timer); errors stay until replaced. A plan edit clears
 * either (main.tsx).
 */
export function showNotice(text: string | null, error = false): void {
  useUiStore.getState().setNotice(text === null ? null : { text, error });
}

/** The status bar message for a room name another room on the level already has, or null. */
export function duplicateRoomNotice(levelId: string, name: string, exceptRoomId?: string | null): string | null {
  const level = getPlan().levels[levelId];
  if (!level) return null;
  const wanted = name.trim().toLowerCase();
  const dup = Object.values(level.rooms).find((r) => r.id !== exceptRoomId && r.name.trim().toLowerCase() === wanted);
  return dup ? `There is already a ${dup.name} on this level` : null;
}

/**
 * Item 17: naming a room the same as another room on the level is allowed, but says so in the
 * status bar. Call it after the add or rename (a plan edit clears the notice, C3), with the
 * duplicate found before it (`duplicateRoomNotice`), or call this with the room excluded.
 */
export function noteDuplicateRoomName(levelId: string, name: string, exceptRoomId?: string | null): boolean {
  const text = duplicateRoomNotice(levelId, name, exceptRoomId);
  if (text) showNotice(text);
  return text !== null;
}

/** Fit the active level (and its underlay, when shown) into the 2D view; in site mode the first floor under the site layer. */
export function zoomToFit(): void {
  const ui = useUiStore.getState();
  const plan = getPlan();
  const level = plan.levels[ui.siteMode ? (siteGhostLevelId(plan) ?? ui.activeLevelId) : ui.activeLevelId];
  if (!level || ui.canvasSize.width === 0) return;
  ui.setViewport(fitLevel(level, ui.canvasSize, ui.showUnderlay) ?? initialViewport(ui.canvasSize));
}

/** True when the plan has anything worth asking about before it is replaced. */
export function planHasContent(plan: Plan): boolean {
  const site = plan.site;
  if (site && (Object.keys(site.gradePoints).length > 0 || Object.keys(site.columns).length > 0)) return true;
  return plan.levelOrder.some((id) => {
    const l = plan.levels[id];
    return (
      l &&
      (Object.keys(l.walls).length > 0 || Object.keys(l.rooms).length > 0 || Object.keys(l.stairs).length > 0 || Object.keys(l.roofs ?? {}).length > 0 || Object.keys(l.fixtures ?? {}).length > 0 || Object.keys(l.decks ?? {}).length > 0 || Object.keys(l.floorOpenings ?? {}).length > 0 || !!l.underlay)
    );
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

/**
 * Open the bundled 146 Mick Road starter plan (docs/examples), after confirming when the current
 * plan has content. The JSON loads on demand, so it is not part of the first download.
 */
export async function openExample(): Promise<void> {
  const current = getPlan();
  if (
    planHasContent(current) &&
    !window.confirm(`Open the 146 Mick Road example? "${current.name}" will be replaced and Undo cannot bring it back. Use Save first to keep a copy.`)
  ) {
    return;
  }
  try {
    const { default: example } = await import('../../docs/examples/146-mick-road.json');
    const plan = migrate(example);
    replacePlan(plan);
    showNotice(`Opened the example: ${plan.name}. Replace its estimates with your measurements.`);
  } catch (err) {
    showNotice(`Could not open the example: ${err instanceof Error ? err.message : String(err)}`, true);
  }
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
