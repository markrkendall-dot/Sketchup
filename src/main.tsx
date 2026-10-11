import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getFootprints } from './derive/footprint';
import { getFaces } from './derive/rooms';
import { pruneSelection } from './editor2d/tools';
import { loadAutosave, startAutosave } from './io/file';
import { defaultLevelId } from './model/plan';
import { clearHistory, usePlanStore } from './store/planStore';
import { useUiStore } from './store/uiStore';
import './index.css';

declare global {
  interface Window {
    /** Dev-only debug handle for tests and the console. */
    __homeplan?: {
      planStore: typeof usePlanStore;
      uiStore: typeof useUiStore;
      derive: { getFaces: typeof getFaces; getFootprints: typeof getFootprints };
    };
  }
}

async function boot(): Promise<void> {
  const saved = await loadAutosave();
  if (saved) usePlanStore.getState().setPlan(saved);
  clearHistory();
  useUiStore.getState().setActiveLevel(defaultLevelId(usePlanStore.getState().plan));

  // Keep the active level valid when the plan is replaced (Open, New, or undo across them).
  // Drop selected ids that undo removed or a phase change hid.
  usePlanStore.subscribe((s, prev) => {
    const ui = useUiStore.getState();
    if (!s.plan.levels[ui.activeLevelId]) ui.setActiveLevel(defaultLevelId(s.plan));
    else if (s.plan !== prev.plan) pruneSelection();
  });
  startAutosave(usePlanStore);

  if (import.meta.env.DEV) window.__homeplan = { planStore: usePlanStore, uiStore: useUiStore, derive: { getFaces, getFootprints } };

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
