import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadAutosave, startAutosave } from './io/file';
import { defaultLevelId } from './model/plan';
import { clearHistory, usePlanStore } from './store/planStore';
import { useUiStore } from './store/uiStore';
import './index.css';

declare global {
  interface Window {
    /** Dev-only debug handle for tests and the console. */
    __homeplan?: { planStore: typeof usePlanStore; uiStore: typeof useUiStore };
  }
}

async function boot(): Promise<void> {
  const saved = await loadAutosave();
  if (saved) usePlanStore.getState().setPlan(saved);
  clearHistory();
  useUiStore.getState().setActiveLevel(defaultLevelId(usePlanStore.getState().plan));

  // Keep the active level valid when the plan is replaced (Open, New, or undo across them).
  usePlanStore.subscribe((s) => {
    const ui = useUiStore.getState();
    if (!s.plan.levels[ui.activeLevelId]) ui.setActiveLevel(defaultLevelId(s.plan));
  });
  startAutosave(usePlanStore);

  if (import.meta.env.DEV) window.__homeplan = { planStore: usePlanStore, uiStore: useUiStore };

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
