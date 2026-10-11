import { Grid } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { getLevelElevations } from '../derive/levels';
import { usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { Controls } from './Controls';
import { LevelMeshes } from './LevelMeshes';
import { visible3dLevels } from './visibility';

/** Re-render the demand-driven canvas when the plan or a 3D-relevant UI setting changes. */
function InvalidateOnChange() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const offPlan = usePlanStore.subscribe((s, prev) => {
      if (s.plan !== prev.plan) invalidate();
    });
    // Not the whole ui store: the draft changes on every mouse move over the 2D plan.
    const offUi = useUiStore.subscribe((s, prev) => {
      if (
        s.viewMode !== prev.viewMode ||
        s.activeLevelId !== prev.activeLevelId ||
        s.hidden3dLevels !== prev.hidden3dLevels ||
        s.only3dActiveAndBelow !== prev.only3dActiveAndBelow ||
        s.layout !== prev.layout ||
        s.splitRatio !== prev.splitRatio
      )
        invalidate();
    });
    return () => {
      offPlan();
      offUi();
    };
  }, [invalidate]);
  return null;
}

/** Dev-only: expose the live scene for end-to-end checks. */
function DebugHandle() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!import.meta.env.DEV || !window.__homeplan) return;
    window.__homeplan.scene3d = { scene, camera, controls, invalidate };
    return () => {
      if (window.__homeplan?.scene3d?.scene === scene) delete window.__homeplan.scene3d;
    };
  }, [scene, camera, controls, invalidate]);
  return null;
}

/** 12" cells, 10' sections, at the bottom of the lowest slab. */
function GroundGrid() {
  const y = usePlanStore((s) => {
    const id = s.plan.levelOrder[0];
    return id ? (getLevelElevations(s.plan)[id]?.slabBottom ?? 0) : 0;
  });
  return (
    <Grid
      position={[0, y - 0.25, 0]}
      args={[1, 1]}
      cellSize={12}
      sectionSize={120}
      cellThickness={0.6}
      sectionThickness={1.1}
      cellColor="#c3c9d1"
      sectionColor="#97a0ab"
      infiniteGrid
      fadeDistance={9000}
      fadeStrength={1.2}
    />
  );
}

function Levels() {
  const order = usePlanStore((s) => s.plan.levelOrder);
  const hidden = useUiStore((s) => s.hidden3dLevels);
  const only = useUiStore((s) => s.only3dActiveAndBelow);
  const active = useUiStore((s) => s.activeLevelId);
  const shown = useMemo(
    () => visible3dLevels(order, { hidden3dLevels: hidden, only3dActiveAndBelow: only, activeLevelId: active }),
    [order, hidden, only, active],
  );
  return (
    <>
      {shown.map((id) => (
        <LevelMeshes key={id} levelId={id} />
      ))}
    </>
  );
}

/** Small overlay toolbar: level visibility and Fit. */
function View3dToolbar() {
  const order = usePlanStore((s) => s.plan.levelOrder);
  const names = usePlanStore((s) => s.plan.levelOrder.map((id) => s.plan.levels[id]?.name ?? '').join('\u0000'));
  const hidden = useUiStore((s) => s.hidden3dLevels);
  const only = useUiStore((s) => s.only3dActiveAndBelow);
  const { toggle3dLevel, setOnly3dActiveAndBelow, requestFit3d } = useUiStore.getState();
  const nameList = names.split('\u0000');
  return (
    <div className="view3d-toolbar" role="toolbar" aria-label="3D view">
      {order.map((id, i) => (
        <label key={id} title="Show this level in 3D">
          <input type="checkbox" checked={!hidden.includes(id)} onChange={() => toggle3dLevel(id)} />
          {nameList[i]}
        </label>
      ))}
      <span className="sep" />
      <label title="Hide the levels above the one being edited">
        <input type="checkbox" checked={only} onChange={(e) => setOnly3dActiveAndBelow(e.target.checked)} />
        Only active level and below
      </label>
      <span className="sep" />
      <button onClick={requestFit3d} title="Frame the visible levels">
        Fit
      </button>
    </div>
  );
}

/**
 * The 3D model: one group per level at its elevation, orbit controls, a ground grid. Renders on
 * demand only (frameloop="demand"), so an idle model costs nothing.
 */
export default function Scene3D() {
  return (
    <section className="view3d-host" aria-label="3D view">
      <Canvas
        className="view3d-canvas"
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ fov: 50, near: 1, far: 20000, position: [900, 700, 1200] }}
        gl={{ antialias: true, preserveDrawingBuffer: import.meta.env.DEV }}
      >
        <color attach="background" args={['#e9edf1']} />
        <hemisphereLight args={['#ffffff', '#b8b0a2', 1.7]} />
        <directionalLight position={[-700, 1600, 1100]} intensity={1.9} />
        <GroundGrid />
        <Levels />
        <Controls />
        <InvalidateOnChange />
        <DebugHandle />
      </Canvas>
      <View3dToolbar />
    </section>
  );
}
