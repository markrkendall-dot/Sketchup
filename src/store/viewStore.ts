// The plan as the active design option sees it (derive/optionView.ts viewPlanOf), kept in step with
// the plan store and the UI store's active option. Everything that draws, checks or exports the
// design reads this store (or getViewPlan); edits go to the plan store, by the same ids.
import { createStore, useStore } from 'zustand';
import { resolveOptionId, viewPlanOf } from '../derive/optionView';
import type { Id, Plan } from '../model/types';
import { usePlanStore } from './planStore';
import { useUiStore } from './uiStore';

export interface ViewPlanState {
  plan: Plan;
  /** The option shown (resolved: always one the plan has). */
  optionId: Id | undefined;
}

const compute = (): ViewPlanState => {
  const plan = usePlanStore.getState().plan;
  const optionId = resolveOptionId(plan, useUiStore.getState().activeOptionId);
  return { plan: viewPlanOf(plan, optionId), optionId };
};

export const viewPlanStore = createStore<ViewPlanState>(compute);

const sync = () => {
  const next = compute();
  const cur = viewPlanStore.getState();
  if (next.plan !== cur.plan || next.optionId !== cur.optionId) viewPlanStore.setState(next, true);
};
// Subscribed before any component, so the view plan is current when they render.
usePlanStore.subscribe(sync);
useUiStore.subscribe(sync);

/** Select from the view plan (like usePlanStore's selector, with `s.plan` the option's plan). */
export function useViewPlanStore<T>(selector: (s: ViewPlanState) => T): T {
  return useStore(viewPlanStore, selector);
}

/** The view plan now. */
export const getViewPlan = (): Plan => viewPlanStore.getState().plan;

/** The active design option's id (resolved). */
export const getActiveOptionId = (): Id | undefined => viewPlanStore.getState().optionId;
