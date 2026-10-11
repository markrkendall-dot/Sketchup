import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Camera, Object3D } from 'three';
import { App } from './App';
import { getLevelElevations } from './derive/levels';
import { getFootprints } from './derive/footprint';
import { getFaces } from './derive/rooms';
import { pruneDerivedCaches } from './derive/openings';
import { pruneSelection } from './editor2d/tools';
import { loadAutosave, startAutosave } from './io/file';
import { defaultLevelId } from './model/plan';
import { clearHistory, usePlanStore } from './store/planStore';
import { useUiStore } from './store/uiStore';
import { showNotice } from './ui/fileActions';
import './index.css';

declare global {
  interface Window {
    /** Dev-only debug handle for tests and the console. */
    __homeplan?: {
      planStore: typeof usePlanStore;
      uiStore: typeof useUiStore;
      derive: {
        getFaces: typeof getFaces;
        getFootprints: typeof getFootprints;
        getLevelElevations: typeof getLevelElevations;
        /** Loaded with the 3D code (derive/meshes.ts pulls in three). */
        getLevelMeshes?: typeof import('./derive/meshes').getLevelMeshes;
        triangleCount?: typeof import('./derive/meshes').triangleCount;
      };
      /** The live 3D scene while the 3D view is mounted. */
      scene3d?: { scene: Object3D; camera: Camera; controls: unknown; invalidate: () => void };
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
    // Levels went away (New, Open): forget what the derive caches kept per level id.
    if (s.plan.levelOrder !== prev.plan.levelOrder) pruneDerivedCaches(s.plan);
  });
  startAutosave(usePlanStore, {
    // A failure stays in the status bar until a later save works.
    onStatus: (error) => {
      if (error) showNotice(error, true);
      else if (useUiStore.getState().notice?.error) showNotice(null);
    },
  });

  if (import.meta.env.DEV) {
    const handle = {
      planStore: usePlanStore,
      uiStore: useUiStore,
      derive: { getFaces, getFootprints, getLevelElevations } as NonNullable<Window['__homeplan']>['derive'],
    };
    window.__homeplan = handle;
    void import('./derive/meshes').then((m) => {
      handle.derive.getLevelMeshes = m.getLevelMeshes;
      handle.derive.triangleCount = m.triangleCount;
    });
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
