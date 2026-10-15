import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultLevelId, migrate } from '../model/plan';
import { clearHistory, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { ViewerApp } from './ViewerApp';
import '../index.css';
import './viewer.css';

// The standalone viewer (viewer.html): the 3D view and the 2D plans of one plan, baked into the
// page by scripts/build-viewer.mjs as <script type="application/json" id="homeplan-plan">. In
// development (no baked plan) it shows the starter. No autosave, no editing, no keyboard handler.

async function bakedPlan(): Promise<unknown> {
  const text = document.getElementById('homeplan-plan')?.textContent?.trim();
  if (text) return JSON.parse(text);
  if (import.meta.env.DEV) return (await import('../../docs/examples/146-mick-road.json')).default;
  throw new Error('No plan is baked into this page.');
}

async function boot(): Promise<void> {
  const root = document.getElementById('root')!;
  try {
    const plan = migrate(await bakedPlan());
    usePlanStore.getState().setPlan(plan);
    clearHistory();
    const ui = useUiStore.getState();
    ui.setActiveLevel(defaultLevelId(plan));
    ui.setLayout('3d');
    // It opens like the editor (MK, 15 Oct 2026): on the proposed design, roofs and furniture off;
    // Existing and All, the roofs and the furniture are a tap away.
    useUiStore.setState({ viewerMode: true, viewMode: 'proposed', show3dRoofs: false, showFurniture: false });
    document.title = `${plan.name.replace(/\s*\(.*\)\s*$/, '')} Viewer`;
    createRoot(root).render(
      <StrictMode>
        <Suspense fallback={<section className="view3d-host" aria-busy="true" />}>
          <ViewerApp />
        </Suspense>
      </StrictMode>,
    );
  } catch (e) {
    root.textContent = `This viewer could not load its plan: ${e instanceof Error ? e.message : String(e)}`;
  }
}

void boot();
