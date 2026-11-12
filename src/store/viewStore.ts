// The plan as the active design option sees it (derive/optionView.ts viewPlanOf), kept in step with
// the plan store and the UI store's active option. Everything that draws, checks or exports the
// design reads this store (or getViewPlan); edits go to the plan store, by the same ids.
import { createStore, useStore } from 'zustand';
import { hiddenStructureIds, resolveOptionId, viewPlanOf } from '../derive/optionView';
import type { Id, Plan } from '../model/types';
import { usePlanStore } from './planStore';
import { useUiStore } from './uiStore';

export interface ViewPlanState {
  plan: Plan;
  /** The option shown (resolved: always one the plan has). */
  optionId: Id | undefined;
  /**
   * Buildings whose whole content is other options' new work: left out of the Proposed and All
   * views (3D, the 3D bar's checkboxes, the site) and marked in the building list (optionView.ts hiddenStructureIds).
   */
  hiddenStructures: ReadonlySet<Id>;
}

const compute = (): ViewPlanState => {
  const plan = usePlanStore.getState().plan;
  const ui = useUiStore.getState();
  const optionId = resolveOptionId(plan, ui.activeOptionId);
  return { plan: viewPlanOf(plan, optionId), optionId, hiddenStructures: hiddenStructureIds(plan, optionId, ui.viewMode) };
};

export const viewPlanStore = createStore<ViewPlanState>(compute);

const sync = () => {
  const next = compute();
  const cur = viewPlanStore.getState();
  if (next.plan !== cur.plan || next.optionId !== cur.optionId || next.hiddenStructures !== cur.hiddenStructures) viewPlanStore.setState(next, true);
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

/** The buildings the view leaves out (ViewPlanState.hiddenStructures). */
export const getHiddenStructures = (): ReadonlySet<Id> => viewPlanStore.getState().hiddenStructures;

/** The active design option's id (resolved). */
export const getActiveOptionId = (): Id | undefined => viewPlanStore.getState().optionId;
