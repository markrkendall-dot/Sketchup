// Plan-level commands shared by the toolbar buttons and the keyboard map: New, Open, Save, zoom to
// fit, and the status bar notices they report with.
import { siteGhostLevelId } from '../derive/site';
import { cancelActiveTool } from '../editor2d/tools';
import { fitLevel, initialViewport } from '../editor2d/viewport';
import { autosaveFailureReason, downloadPlan, planFileName, readPlanFile, type Autosave } from '../io/file';
import { library, writeLastPlanId } from '../io/library';
import { createEmptyPlan, defaultLevelId, migrate, type PlanTemplate } from '../model/plan';
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

/**
 * Replace the whole plan (switching property) and clear the undo history: undoing back into
 * another property would be a surprise, and the old plan is still in the library.
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

// The property library (io/library.ts): New, Open a file and the examples add a property and
// switch to it, so nothing replaces the plan the user was working on; it stays in the library.

let autosave: Pick<Autosave, 'flush'> | null = null;

/** main.tsx hands over the running autosave, so a switch can save the outgoing plan first. */
export function setAutosave(a: Pick<Autosave, 'flush'> | null): void {
  autosave = a;
}

/** Save the open plan's pending change now (before it is switched away from, copied or exported). */
export async function flushAutosave(): Promise<void> {
  await autosave?.flush();
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Make the plan the open property: the outgoing plan's pending autosave is written first (under
 * its own key), then the plan replaces it in the editor (undo history cleared) and is remembered
 * as the one to reopen. The plan must already be in the library.
 */
async function switchTo(plan: Plan): Promise<void> {
  await flushAutosave();
  replacePlan(plan);
  writeLastPlanId(plan.id);
}

/** Store a plan that is not in the library yet and open it; a failed store is said, the plan still opens. */
async function storeAndOpen(plan: Plan, add = false): Promise<Plan> {
  let stored = plan;
  try {
    stored = add ? await library.add(plan) : (await library.save(plan), plan);
  } catch (err) {
    showNotice(`Could not save in this browser: ${autosaveFailureReason(err)}.`, true);
  }
  await switchTo(stored);
  return stored;
}

/** Open a property from the library. */
export async function openProperty(id: string): Promise<boolean> {
  if (id === getPlan().id) return true;
  try {
    await flushAutosave();
    const plan = await library.load(id);
    if (!plan) {
      showNotice('That property is no longer in this browser.', true);
      return false;
    }
    await switchTo(plan);
    showNotice(`Opened ${plan.name}.`);
    return true;
  } catch (err) {
    showNotice(`Could not open that property: ${errorText(err)}`, true);
    return false;
  }
}

/**
 * Start a new, empty property from a template (model/plan.ts createEmptyPlan; the default is a
 * basement and two floors) with a name (blank: "Untitled plan"); the current one stays in the library.
 */
export async function newPlan(template: PlanTemplate = 'basementTwoStorey', name?: string): Promise<void> {
  const plan = await storeAndOpen(createEmptyPlan(name?.trim() || undefined, template));
  showNotice(`Started a new property, ${plan.name}. The one before is under Properties.`);
}

/** Copy a property in the library as "<name> copy" (the open one with its latest change). */
export async function duplicateProperty(id: string): Promise<Plan | null> {
  try {
    if (id === getPlan().id) await flushAutosave();
    const copy = await library.duplicate(id);
    showNotice(`Added ${copy.name}.`);
    return copy;
  } catch (err) {
    showNotice(`Could not copy that property: ${errorText(err)}`, true);
    return null;
  }
}

/** Rename a property: the open one through the plan (like the toolbar's name field), others in the library. */
export async function renameProperty(id: string, name: string): Promise<void> {
  const v = name.trim();
  if (!v) return;
  try {
    if (id === getPlan().id) {
      if (v !== getPlan().name) usePlanStore.getState().renamePlan(v);
      await flushAutosave();
    } else {
      await library.rename(id, v);
    }
  } catch (err) {
    showNotice(`Could not rename that property: ${errorText(err)}`, true);
  }
}

/**
 * Delete a property from the library, after confirming. Deleting the open one opens the most
 * recently modified of the others, or a new empty plan when it was the last.
 */
export async function deleteProperty(id: string, name: string): Promise<boolean> {
  if (!window.confirm(`Delete "${name}" from this browser? This cannot be undone. Use Export first to keep a copy.`)) return false;
  try {
    if (id === getPlan().id) {
      await flushAutosave();
      let next: Plan | null = null;
      for (const e of await library.list()) {
        if (e.id === id) continue;
        try {
          next = await library.load(e.id);
        } catch (err) {
          console.warn(`Skipping unreadable property ${e.id}`, err);
        }
        if (next) break;
      }
      if (next) await switchTo(next);
      else await storeAndOpen(createEmptyPlan());
    }
    await library.remove(id);
    showNotice(`Deleted ${name}.`);
    return true;
  } catch (err) {
    showNotice(`Could not delete ${name}: ${errorText(err)}`, true);
    return false;
  }
}

/** Download a property as JSON (the open one as it is now). */
export async function exportProperty(id: string): Promise<void> {
  try {
    if (id === getPlan().id) {
      savePlan();
      return;
    }
    const plan = await library.load(id);
    if (!plan) throw new Error('it is no longer in this browser');
    downloadPlan(plan);
    showNotice(`Saved a copy as ${planFileName(plan, 'json')} (your browser's downloads).`);
  } catch (err) {
    showNotice(`Could not export that property: ${errorText(err)}`, true);
  }
}

/** The bundled 146 Mick Road plans (docs/examples): the starter with its renovation, and the house rebuilt on its foundation. */
export type ExamplePlan = 'starter' | 'rebuild';

/**
 * Add a bundled 146 Mick Road plan (docs/examples) to the library and open it; the current
 * property stays as it is. Opened again it is another copy (a new id), so a changed copy is never
 * overwritten. The JSON loads on demand, so it is not part of the first download.
 */
export async function openExample(which: ExamplePlan = 'starter'): Promise<void> {
  try {
    const { default: example } = which === 'rebuild' ? await import('../../docs/examples/146-mick-road-rebuild.json') : await import('../../docs/examples/146-mick-road.json');
    const plan = await storeAndOpen(migrate(example), true);
    showNotice(which === 'rebuild' ? `Opened ${plan.name}: today's house in the Existing view, the rebuild in Proposed.` : `Opened the example: ${plan.name}. Replace its estimates with your measurements.`);
  } catch (err) {
    showNotice(`Could not open the example: ${errorText(err)}`, true);
  }
}

/**
 * Add a chosen plan file to the library and open it (a new id when the library already has the
 * file's). Errors are reported, not thrown.
 */
export async function openPlanFile(file: File): Promise<void> {
  let plan: Plan;
  try {
    plan = await readPlanFile(file);
  } catch (err) {
    const message = errorText(err);
    // Replace any earlier notice (e.g. "Saved a copy") with the rejection, which stays until the
    // next notice, and tell the user in the alert as well.
    showNotice(`Could not open ${file.name}: ${message}`, true);
    window.alert(message);
    return;
  }
  const stored = await storeAndOpen(plan, true);
  showNotice(`Opened ${file.name} as ${stored.name}; it is in Properties now.`);
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
