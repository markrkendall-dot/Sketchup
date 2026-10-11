import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Camera, Object3D } from 'three';
import { App } from './App';
import { getLevelElevations } from './derive/levels';
import { getFootprints } from './derive/footprint';
import { getFaces } from './derive/rooms';
import { pruneDerivedCaches } from './derive/openings';
import { fallbackElevation, groundAt, planTerrain, terrainHeightAt } from './derive/site';
import { pruneSelection } from './editor2d/tools';
import { loadAutosave, startAutosave } from './io/file';
import { defaultLevelId } from './model/plan';
import { clearHistory, usePlanStore } from './store/planStore';
import { clearNoticeOnEdit, useUiStore } from './store/uiStore';
import { showNotice } from './ui/fileActions';
import './index.css';
import { PLAN_STYLES } from './editor2d/planStyles';

// The plan layers' styles, shared with the plan export (editor2d/planStyles.ts).
const planStyle = document.createElement('style');
planStyle.dataset.homeplan = 'plan-styles';
planStyle.textContent = PLAN_STYLES;
document.head.appendChild(planStyle);

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
        getSiteMeshes?: typeof import('./derive/meshes').getSiteMeshes;
        getTerrainGeometry?: typeof import('./derive/meshes').getTerrainGeometry;
        terrainHeightAt: typeof terrainHeightAt;
        groundAt: typeof groundAt;
        fallbackElevation: typeof fallbackElevation;
        planTerrain: typeof planTerrain;
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
    // Levels went away (New, Open): forget what the derive caches kept per level id, and a walk
    // start picked on a level that is gone.
    if (s.plan.levelOrder !== prev.plan.levelOrder) {
      pruneDerivedCaches(s.plan);
      const from = useUiStore.getState().walkFrom;
      if (from && !s.plan.levels[from.levelId]) useUiStore.getState().setWalkFrom(null);
    }
    // Any edit clears the status bar's notice (REVIEW-2 C3).
    clearNoticeOnEdit(s.plan, prev.plan);
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
      derive: { getFaces, getFootprints, getLevelElevations, terrainHeightAt, groundAt, fallbackElevation, planTerrain } as NonNullable<Window['__homeplan']>['derive'],
    };
    window.__homeplan = handle;
    void import('./derive/meshes').then((m) => {
      handle.derive.getLevelMeshes = m.getLevelMeshes;
      handle.derive.triangleCount = m.triangleCount;
      handle.derive.getSiteMeshes = m.getSiteMeshes;
      handle.derive.getTerrainGeometry = m.getTerrainGeometry;
    });
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
