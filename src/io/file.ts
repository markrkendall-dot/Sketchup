import { get, set } from 'idb-keyval';
import { migrate } from '../model/plan';
import type { Plan } from '../model/types';
import type { usePlanStore } from '../store/planStore';

export const AUTOSAVE_KEY = 'homeplan:autosave';
const AUTOSAVE_DEBOUNCE_MS = 300;

/** Download file name for the plan: its name as a slug, plus the extension (without the dot). */
export function planFileName(plan: Pick<Plan, 'name'>, ext: string): string {
  const slug = plan.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'homeplan'}.${ext}`;
}

/** Trigger a browser download of a blob. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Trigger a browser download of the plan as JSON. */
export function downloadPlan(plan: Plan): void {
  downloadBlob(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }), planFileName(plan, 'json'));
}

/** Read and validate a plan file chosen by the user. Throws a readable Error. */
export async function readPlanFile(file: File): Promise<Plan> {
  const text = await file.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${file.name} is not valid JSON.`);
  }
  return migrate(json);
}

/** Why an autosave failed, in words for the status bar. */
export function autosaveFailureReason(err: unknown): string {
  const name = err instanceof Error || err instanceof DOMException ? err.name : '';
  if (name === 'QuotaExceededError') return 'the browser storage for this site is full. Use Save to keep a copy';
  const msg = err instanceof Error || err instanceof DOMException ? err.message : String(err);
  return msg || name || 'unknown error';
}

export interface AutosaveOptions {
  /** Store function; defaults to idb-keyval's set (tests pass their own). */
  save?: (key: string, plan: Plan) => Promise<void>;
  /**
   * Told about failures and recoveries: a message after a failed save, null after the next save
   * that works. Never throws into the caller.
   */
  onStatus?: (error: string | null) => void;
}

/**
 * Persist the plan to IndexedDB whenever it changes (debounced). Also flushes when the page is
 * hidden. A failed save (storage full, IndexedDB unavailable) is reported through onStatus and
 * retried with the next change. Returns an unsubscribe function.
 */
export function startAutosave(store: typeof usePlanStore, opts: AutosaveOptions = {}): () => void {
  const save = opts.save ?? ((key: string, plan: Plan) => set(key, plan));
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Plan | null = null;
  let failing = false;
  const report = (error: string | null) => {
    try {
      opts.onStatus?.(error);
    } catch (err) {
      console.warn('Autosave status handler failed', err);
    }
  };
  const failed = (err: unknown) => {
    console.warn('Autosave failed', err);
    failing = true;
    report(`Autosave failed: ${autosaveFailureReason(err)}.`);
  };
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    const plan = pending;
    pending = null;
    let result: Promise<void>;
    try {
      result = save(AUTOSAVE_KEY, plan);
    } catch (err) {
      failed(err);
      return;
    }
    result.then(
      () => {
        if (failing) {
          failing = false;
          report(null);
        }
      },
      failed,
    );
  };
  const unsubscribe = store.subscribe((state, prev) => {
    if (state.plan === prev.plan) return;
    pending = state.plan;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
  });
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);
  return () => {
    flush();
    unsubscribe();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flush);
  };
}

/** The last autosaved plan, or null if none (or unreadable). */
export async function loadAutosave(): Promise<Plan | null> {
  try {
    const raw: unknown = await get(AUTOSAVE_KEY);
    return raw === undefined ? null : migrate(raw);
  } catch (err) {
    console.warn('Ignoring unreadable autosave', err);
    return null;
  }
}
