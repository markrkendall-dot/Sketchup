import { migrate } from '../model/plan';
import type { Plan } from '../model/types';
import type { usePlanStore } from '../store/planStore';
import { library, planKey } from './library';

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
  /** Store function, given the plan's library key; defaults to the library's save (tests pass their own). */
  save?: (key: string, plan: Plan) => Promise<unknown>;
  /**
   * Told about failures and recoveries: a message after a failed save, null after the next save
   * that works. Never throws into the caller.
   */
  onStatus?: (error: string | null) => void;
}

/** A running autosave: call it to stop (after a last flush); flush() saves what is pending now. */
export interface Autosave {
  (): void;
  /** Save the pending change at once; resolves when that save has finished (or failed, reported). */
  flush: () => Promise<void>;
}

/**
 * Persist the plan to its library key in IndexedDB whenever it changes (debounced). Also flushes
 * when the page is hidden. A failed save (storage full, IndexedDB unavailable) is reported through
 * onStatus and retried with the next change.
 *
 * When the store's plan is replaced by a different property (another id), the outgoing plan's
 * pending change is saved at once, under its own key, and the incoming plan is not saved until it
 * is edited: opening a property does not rewrite it. Whoever switches puts the incoming plan in
 * the library first (ui/fileActions.ts).
 */
export function startAutosave(store: typeof usePlanStore, opts: AutosaveOptions = {}): Autosave {
  const save = opts.save ?? ((_key: string, plan: Plan) => library.save(plan));
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Plan | null = null;
  let last: Promise<void> = Promise.resolve();
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
  const flush = (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending) return last;
    const plan = pending;
    pending = null;
    let result: Promise<unknown>;
    try {
      result = save(planKey(plan.id), plan);
    } catch (err) {
      failed(err);
      return last;
    }
    last = result.then(
      () => {
        if (failing) {
          failing = false;
          report(null);
        }
      },
      failed,
    );
    return last;
  };
  const unsubscribe = store.subscribe((state, prev) => {
    if (state.plan === prev.plan) return;
    if (state.plan.id !== prev.plan.id) {
      void flush();
      return;
    }
    pending = state.plan;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
  });
  const onHide = () => {
    if (document.visibilityState === 'hidden') void flush();
  };
  const onPageHide = () => void flush();
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);
  const stop = () => {
    void flush();
    unsubscribe();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onPageHide);
  };
  return Object.assign(stop, { flush });
}
