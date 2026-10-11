// The stores the plan layers (PlanLayers.tsx) read. On screen they are the app's stores; the plan
// export (io/exportPlan.ts) renders the same layers with renderToStaticMarkup inside a provider of
// two throwaway stores holding a snapshot (the plan, and the UI state with no hover, selection or
// draft). A server render reads a store's *initial* state (zustand's getServerSnapshot), which for
// a throwaway store is exactly that snapshot, so the layers need no export-only props.
import { createContext, useContext } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import type { Plan } from '../model/types';
import { usePlanStore } from '../store/planStore';
import { useUiStore, type UiState } from '../store/uiStore';

export interface PlanSnapshot {
  plan: Plan;
}

export interface LayerStores {
  plan: StoreApi<PlanSnapshot>;
  ui: StoreApi<UiState>;
}

export const LayerStoresContext = createContext<LayerStores | null>(null);

const livePlan = usePlanStore as unknown as StoreApi<PlanSnapshot>;
const liveUi = useUiStore as unknown as StoreApi<UiState>;

/** Select from the plan the layers draw (the app's plan, or the export's snapshot). */
export function useLayerPlan<T>(selector: (s: PlanSnapshot) => T): T {
  return useStore(useContext(LayerStoresContext)?.plan ?? livePlan, selector);
}

/** Select from the UI state the layers draw with (view mode, zoom, selection, hover). */
export function useLayerUi<T>(selector: (s: UiState) => T): T {
  return useStore(useContext(LayerStoresContext)?.ui ?? liveUi, selector);
}

/** Throwaway stores holding fixed states, for rendering the layers off screen. */
export function snapshotStores(plan: Plan, ui: UiState): LayerStores {
  return { plan: createStore<PlanSnapshot>(() => ({ plan })), ui: createStore<UiState>(() => ui) };
}
