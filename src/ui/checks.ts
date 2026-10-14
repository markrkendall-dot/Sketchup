// Keeps the UI's copy of the code checks (uiStore.issues) up to date: once at start, then
// CHECKS_DELAY_MS after the plan stops changing, so a drag does not re-run them at every step.

import { getIssues } from '../derive/checks';
import { usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';

export const CHECKS_DELAY_MS = 150;

/** Start keeping uiStore.issues current; returns a function that stops it. */
export function startChecks(): () => void {
  const run = () => useUiStore.getState().setIssues(getIssues(usePlanStore.getState().plan));
  run();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = usePlanStore.subscribe((s, prev) => {
    if (s.plan === prev.plan) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      run();
    }, CHECKS_DELAY_MS);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
