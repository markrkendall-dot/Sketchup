import { useMemo, useState } from 'react';
import { VIEW_MODE_LABEL, VIEW_MODES } from '../derive/phase';
import { planSvg } from '../io/exportPlan';
import { usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import Scene3D from '../view3d/Scene3D';
import { PanZoom } from './PanZoom';

type Tab = '3d' | 'plan';

/**
 * The viewer's shell: a bar with the plan's name, the 3D / Plan tabs and the Existing / Proposed /
 * All control, then the 3D view (Scene3D, with its own level checkboxes, elevations and Fit) or
 * the chosen level's plan drawing (io/exportPlan.ts planSvg, as an image so its own styles stay
 * inside it) under a pan and pinch-zoom wrapper.
 */
export function ViewerApp() {
  const [tab, setTab] = useState<Tab>('3d');
  const name = usePlanStore((s) => s.plan.name);
  const viewMode = useUiStore((s) => s.viewMode);
  const hasPhases = usePlanStore((s) =>
    s.plan.levelOrder.some((id) => {
      const l = s.plan.levels[id];
      const any = (items: Record<string, { phase: string }>) => Object.values(items).some((x) => x.phase !== 'existing');
      return !!l && (any(l.walls) || any(l.openings) || any(l.stairs) || any(l.roofs) || any(l.fixtures ?? {}));
    }),
  );
  return (
    <div className="viewer">
      <header className="viewer-bar">
        <span className="viewer-title" title={name}>
          {name}
        </span>
        <div className="viewer-tabs" role="tablist">
          {(['3d', 'plan'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === '3d' ? '3D' : 'Plan'}
            </button>
          ))}
        </div>
        {hasPhases && (
          <div className="viewer-tabs viewer-phases" role="group" aria-label="View mode">
            {VIEW_MODES.map((m) => (
              <button key={m} className={viewMode === m ? `active view-${m}` : `view-${m}`} aria-pressed={viewMode === m} onClick={() => useUiStore.getState().setViewMode(m)}>
                {VIEW_MODE_LABEL[m]}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="viewer-body">{tab === '3d' ? <Scene3D /> : <PlanTab />}</div>
    </div>
  );
}

/**
 * One level's plan drawing with a level picker; pinch or scroll to zoom, drag to pan, double-tap
 * to reset. The drawing is the plan export's SVG inlined (an <img> would blur when zoomed); its
 * own stylesheet travels with it, and the `:root` variables it declares are the ones the editor's
 * page defines anyway.
 */
function PlanTab() {
  const plan = usePlanStore((s) => s.plan);
  const viewMode = useUiStore((s) => s.viewMode);
  const activeLevelId = useUiStore((s) => s.activeLevelId);
  const levelId = plan.levels[activeLevelId] ? activeLevelId : plan.levelOrder[0];
  const svg = useMemo(() => {
    try {
      // The export sizes itself in inches for printing; here it fills the pan-zoom area instead.
      return planSvg(plan, levelId, viewMode).replace(/^<svg([^>]*?) width="[^"]*" height="[^"]*"/, '<svg$1');
    } catch {
      return null;
    }
  }, [plan, levelId, viewMode]);
  return (
    <>
      <div className="viewer-levels" role="tablist" aria-label="Level">
        {[...plan.levelOrder].reverse().map((id) => (
          <button key={id} role="tab" aria-selected={id === levelId} className={id === levelId ? 'active' : ''} onClick={() => useUiStore.getState().setActiveLevel(id)}>
            {plan.levels[id].name}
          </button>
        ))}
      </div>
      <PanZoom key={levelId}>
        {svg ? (
          <div className="viewer-plan" role="img" aria-label={`${plan.levels[levelId].name} plan`} dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <p className="viewer-empty">Nothing drawn on this level.</p>
        )}
      </PanZoom>
    </>
  );
}
